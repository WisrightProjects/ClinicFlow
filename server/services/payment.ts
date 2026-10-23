// Booking payment logic: fee lookup, the online (currently simulated) payment path,
// and the guard that stops simulated payments from ever becoming real wallet money.

import { db } from '../db';
import {
  payments,
  appointments,
  walletTransactions,
  type Appointment,
  type Payment,
} from '@shared/schema';
import { calculateBookingFee, type BookingFee, type PaymentMethod } from '@shared/pricing';
import { eq, and, or, desc, lt, gt, inArray, isNull } from 'drizzle-orm';
import { storage } from '../storage';
import { hdfcGateway, HdfcGatewayError, type HdfcOrderStatus } from './hdfc-gateway';
import { ETAService } from './eta';
import { validateBookingEligibility } from './booking-validation';
import { DuplicateBookingError } from '../errors';

/**
 * How long a token is held while the patient is on HDFC's payment page.
 *
 * Deliberately longer than the walk-in hold (300s), which is tuned for someone standing
 * at the front desk. A hosted checkout routinely takes longer than that: a UPI collect
 * request alone gives the payer about five minutes to approve, before net-banking logins
 * or a 3DS challenge. Too short a hold turns "money taken, no token, wallet credit" from
 * an edge case into the normal outcome for anyone who does not pay instantly.
 */
const HDFC_HOLD_SECONDS = Number(process.env.HDFC_HOLD_SECONDS) || 20 * 60;

/**
 * Fallback age at which an unsettled order is retired when the gateway gives us no
 * `order_expiry` to go on. Only governs when polling stops — settle still accepts a
 * retired row, so a late confirmation is never lost.
 */
const STALE_ORDER_RETIRE_MS = 2 * 60 * 60 * 1000;

/** Postgres duplicate-key. Used to tell "already credited" from a real failure. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// NOTE: wallet.ts already imports this module (for paymentService), so importing it at
// the top level here would close a cycle. It is loaded lazily at the one call site
// instead — see creditUnbookedPayment.

/**
 * How the "Online" option behaves, from the ONLINE_PAYMENT_MODE env var:
 *  - `dummy` (default) — simulated payment, no money moves. Phase 1.
 *  - `off`             — option rejected server-side; use to disable instantly.
 *  - `live`            — real gateway. Not implemented yet; treated as `off` until Phase 2.
 */
export type OnlinePaymentMode = 'dummy' | 'off' | 'live';

export class PaymentService {
  /** Guards the background sweep against overlapping passes. See sweepStaleHdfcOrders. */
  private sweeping = false;

  /** The fee the patient is charged to book. Server is the authority. */
  getBookingFee(): BookingFee {
    return calculateBookingFee();
  }

  getOnlinePaymentMode(): OnlinePaymentMode {
    const mode = (process.env.ONLINE_PAYMENT_MODE || 'dummy').toLowerCase();
    return mode === 'off' || mode === 'live' ? mode : 'dummy';
  }

  /**
   * Whether the patient may currently choose "Online" at checkout.
   *
   * `live` additionally requires every HDFC credential to be present. This code ships to
   * production while the mode is still `dummy` and those variables are empty, so a
   * half-configured server must refuse the option rather than fail mid-payment.
   */
  isOnlinePaymentEnabled(): boolean {
    const mode = this.getOnlinePaymentMode();
    if (mode === 'dummy') return true;
    if (mode === 'live') return hdfcGateway.isConfigured();
    return false;
  }

  /** True when the live gateway should handle this booking rather than the simulator. */
  isLiveGatewayActive(): boolean {
    return this.getOnlinePaymentMode() === 'live' && hdfcGateway.isConfigured();
  }

  /**
   * Records a payment row for a booking that was already paid from the wallet.
   * The wallet debit itself stays in storage.createAppointmentWithWalletPayment.
   */
  async recordWalletPayment(appointment: Appointment, fee: BookingFee): Promise<Payment> {
    const [payment] = await db
      .insert(payments)
      .values({
        appointmentId: appointment.id,
        patientId: appointment.patientId!,
        scheduleId: appointment.scheduleId,
        method: 'wallet',
        gateway: 'wallet',
        amount: fee.total.toFixed(2),
        platformFee: fee.platformFee.toFixed(2),
        gstAmount: fee.gstAmount.toFixed(2),
        status: 'success',
        walletTransactionId: appointment.walletTransactionId,
        metadata: JSON.stringify({ gstRate: fee.gstRate }),
      })
      .returning();

    return payment;
  }

  /**
   * Books an appointment paid by the simulated online gateway.
   * Deliberately does NOT touch the wallet: no debit, no credit, no wallet transaction.
   * The appointment insert and the payment row share one transaction, so a failure
   * cannot leave a token without its payment record.
   */
  async createOnlineBooking(
    appointmentData: Omit<Appointment, 'id'> & { tokenNumber?: number },
    fee: BookingFee
  ): Promise<{ appointment: Appointment; payment: Payment }> {
    // Hard stop. This books a token without collecting anything, which is correct only
    // while the simulator is the gateway. Reached in `live` mode it would hand out free
    // bookings against a gateway that is genuinely charging everyone else.
    if (this.getOnlinePaymentMode() !== 'dummy') {
      throw new Error('Simulated booking refused: the live payment gateway is active.');
    }

    const gateway = 'dummy';

    return await db.transaction(async (tx) => {
      const appointment = await storage.createAppointment(appointmentData, tx);

      const [payment] = await tx
        .insert(payments)
        .values({
          appointmentId: appointment.id,
          patientId: appointment.patientId!,
          scheduleId: appointment.scheduleId,
          method: 'online',
          gateway,
          amount: fee.total.toFixed(2),
          platformFee: fee.platformFee.toFixed(2),
          gstAmount: fee.gstAmount.toFixed(2),
          status: 'success',
          metadata: JSON.stringify({
            gstRate: fee.gstRate,
            simulated: true,
            note: 'Simulated payment — no funds were collected.',
          }),
        })
        .returning();

      return { appointment, payment };
    });
  }

  /** Most recent successful payment for an appointment, if any. */
  async getPaymentForAppointment(appointmentId: number): Promise<Payment | undefined> {
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.appointmentId, appointmentId), eq(payments.status, 'success')))
      .orderBy(desc(payments.id))
      .limit(1);

    return payment;
  }

  /**
   * True when the appointment was paid by a simulated gateway.
   *
   * Refunds credit the patient's wallet with real, spendable balance. A simulated
   * payment collected nothing, so refunding it would mint money out of nothing —
   * book online (free), cancel, receive real wallet credit, repeat. Callers must
   * skip the wallet credit when this returns true.
   */
  async isSimulatedPayment(appointmentId: number): Promise<boolean> {
    const payment = await this.getPaymentForAppointment(appointmentId);
    if (payment) return payment.gateway === 'dummy';

    // No payments row: either a booking made before this table existed (wallet-paid,
    // refundable) or a walk-in. Fall back to the appointment's own method — only
    // treat it as simulated if it explicitly claims an online payment we cannot verify.
    const [appointment] = await db
      .select({ paymentMethod: appointments.paymentMethod })
      .from(appointments)
      .where(eq(appointments.id, appointmentId));

    return appointment?.paymentMethod === 'online';
  }

  /** Validates a client-supplied payment method, defaulting to wallet. */
  normalizePaymentMethod(value: unknown): PaymentMethod {
    return value === 'online' ? 'online' : 'wallet';
  }

  /**
   * Holds a token and opens an HDFC payment session for it.
   *
   * No appointment and no money yet — this only reserves the patient's place in the queue
   * while they are away paying, and records enough to finish the booking when the gateway
   * confirms. If they abandon, the hold lapses on its own and nothing was charged.
   */
  async initiateHdfcBooking(params: {
    patient: { id: number; email?: string | null; phone?: string | null };
    schedule: { id: number; doctorId: number; clinicId: number };
    date: Date;
    isOnBehalf: boolean;
    guestName?: string;
    guestPhone?: string;
  }): Promise<{ paymentUrl: string; orderId: string; expiresAt: Date; fee: BookingFee }> {
    const fee = this.getBookingFee();
    const orderId = hdfcGateway.generateOrderId();

    const reservation = await storage.reserveNextToken(
      params.schedule.id,
      params.patient.id,
      HDFC_HOLD_SECONDS
    );

    // Everything settleHdfcOrder will need to finish the booking later, when the patient
    // is no longer in front of us and there may be no session to read.
    const appointmentData = {
      doctorId: params.schedule.doctorId,
      clinicId: params.schedule.clinicId,
      scheduleId: params.schedule.id,
      patientId: params.patient.id,
      date: params.date.toISOString(),
      status: 'token_started',
      consultationFee: fee.total,
      isPaid: true,
      paymentMethod: 'online',
      isRefundEligible: true,
      isOnBehalf: params.isOnBehalf,
      guestName: params.guestName ?? null,
      guestPhone: params.guestPhone ?? null,
    };

    let payment: Payment;
    try {
      [payment] = await db
      .insert(payments)
      .values({
        patientId: params.patient.id,
        scheduleId: params.schedule.id,
        method: 'online',
        gateway: 'hdfc',
        amount: fee.total.toFixed(2),
        platformFee: fee.platformFee.toFixed(2),
        gstAmount: fee.gstAmount.toFixed(2),
        status: 'created',
        gatewayOrderId: orderId,
        reservationId: reservation.id,
        metadata: JSON.stringify({ gstRate: fee.gstRate, appointmentData }),
      })
      .returning();
    } catch (err) {
      // The one-in-flight constraint fired: a second tap raced the first. Release this
      // attempt's hold and tell the patient to finish the one already open.
      await storage.cancelTokenReservation(reservation.id, params.patient.id);
      if (isUniqueViolation(err)) {
        throw new Error(
          'You already have a payment in progress for this schedule. Please complete it, or wait a few minutes and try again.'
        );
      }
      throw err;
    }

    try {
      const session = await hdfcGateway.createSession({
        orderId,
        amount: fee.total,
        customerId: String(params.patient.id),
        // customer_email is mandatory at the gateway, but most patients registered with
        // phone + MPIN and have none. A per-patient placeholder keeps the order unique
        // and traceable without inventing an address that might reach a real person.
        customerEmail: params.patient.email?.trim() || `patient${params.patient.id}@clinik.co.in`,
        customerPhone: params.patient.phone || '0000000000',
        returnUrl: this.getReturnUrl(),
        description: 'Clinik booking fee',
      });

      return {
        paymentUrl: session.payment_links.web,
        orderId,
        expiresAt: reservation.expiresAt,
        fee,
      };
    } catch (err) {
      // The gateway never opened and the patient never received a payment URL, so this
      // order can never be paid. Release the hold immediately rather than making the
      // next patient wait out the timeout, and delete the row outright — left as
      // 'failed' it would match the sweep's revival window and be polled every minute
      // for two hours for an answer that cannot change.
      //
      // The cleanup gets its own try/catch so a failure in it cannot replace the
      // gateway error: the route distinguishes 502 from 500 by the error's type, and a
      // surviving payment row would also block the patient's retry.
      try {
        await storage.cancelTokenReservation(reservation.id, params.patient.id);
        await db.delete(payments).where(eq(payments.id, payment.id));
      } catch (cleanupError) {
        console.error('[hdfc] failed to roll back an initiate attempt:', cleanupError);
      }
      throw err;
    }
  }

  /**
   * Where HDFC sends the patient back to. Must be absolute HTTPS with no query string
   * and no IP address, which is why it cannot simply be derived from the request.
   */
  private getReturnUrl(): string {
    // No fallback on purpose — isConfigured() already refuses to enable the gateway
    // without this, so defaulting here would only reintroduce the risk it guards against.
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    if (!base) throw new Error('PUBLIC_BASE_URL must be set to use the payment gateway');
    return `${base}/api/payments/hdfc/return`;
  }

  /**
   * Settles an HDFC order exactly once, whatever nudged us into looking at it.
   *
   * Called by the browser return, by the webhook, and by the stale-order sweep. All three
   * can fire for the same order, possibly at the same moment, so this is written to be
   * safe to call any number of times concurrently.
   *
   * Two rules hold the whole thing together (PAYMENT_FLOW_PLAN.md §13):
   *
   *  1. The caller's payload is never trusted. Only `orderId` is taken from it; what
   *     actually happened is read back from HDFC over an authenticated server-to-server
   *     call. Otherwise anyone who guesses an order id could post us a fake success.
   *
   *  2. Once HDFC says CHARGED, the patient's money is gone and we owe them something.
   *     Every path from that point either creates their appointment or credits their
   *     wallet. None of them may silently drop it.
   */
  async settleHdfcOrder(orderId: string): Promise<
    | { outcome: 'booked'; appointment: Appointment }
    | { outcome: 'refunded_to_wallet'; reason: string }
    // `order` rides along so the sweep can decide whether to retire the row without
    // asking HDFC a second question it already has the answer to.
    | { outcome: 'pending'; status: string; order?: HdfcOrderStatus }
    | { outcome: 'not_paid'; status: string; order?: HdfcOrderStatus }
    | { outcome: 'already_settled'; settledAs: 'booked' | 'refunded' | 'unknown' }
    | { outcome: 'unknown_order' }
  > {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.gatewayOrderId, orderId));

    if (!payment) return { outcome: 'unknown_order' };
    // 'failed' is not terminal here: an order marked dead on expiry can still be reported
    // CHARGED by a slow upstream bank, and that money must still reach the patient. Only
    // 'success' means we have already accounted for it.
    //
    // Report HOW it was settled. The browser return often loses this race to the webhook,
    // and telling a patient "booked" when their money actually went back to the wallet
    // sends them looking for a token that does not exist.
    if (payment.status === 'success') {
      return {
        outcome: 'already_settled',
        settledAs: payment.appointmentId
          ? 'booked'
          : payment.walletTransactionId
            ? 'refunded'
            : 'unknown',
      };
    }

    // The authority. Throws if HDFC is unreachable -- callers let that propagate so the
    // order stays at 'created' and the sweep retries, rather than being wrongly failed.
    const order = await hdfcGateway.getOrderStatus(orderId, String(payment.patientId));

    // Still in flight. Distinct from failure: a UPI collect or 3DS challenge is routinely
    // unfinished when the browser returns, and telling the patient it failed makes them
    // pay a second time.
    if (hdfcGateway.isPending(order.status)) {
      return { outcome: 'pending', status: order.status, order };
    }

    if (!hdfcGateway.isCharged(order.status)) {
      // Terminal failure — declined card, rejected UPI. Release the hold and close the
      // row now. Left alone, the dead reservation keeps occupying a maxTokens slot and
      // the in-flight check would refuse the patient's immediate retry with "you already
      // have a payment in progress" for the rest of the hold window.
      await this.releaseFailedAttempt(payment);
      return { outcome: 'not_paid', status: order.status, order };
    }

    // HDFC returns amount as a JSON number (21), while we store a decimal string
    // ("21.00"). Compare numerically, with a tolerance for float representation.
    const expected = parseFloat(payment.amount);
    const charged = Number(order.amount);
    // Number.isFinite first, because the comparison alone fails OPEN: if the gateway
    // omits or renames `amount`, Number(undefined) is NaN and `NaN > 0.01` is false —
    // so the one check guarding against a wrong-amount charge would be skipped and the
    // order booked as correctly paid.
    if (!Number.isFinite(charged) || Math.abs(charged - expected) > 0.01) {
      console.error(
        `[hdfc] AMOUNT MISMATCH on ${orderId}: gateway ${order.amount} vs expected ${expected} — flagged for reconciliation`
      );

      const flagged = await db
        .update(payments)
        .set({
          status: Number.isFinite(charged) ? 'success' : 'failed',
          gatewayPaymentId: order.id,
          metadata: JSON.stringify({
            ...this.parseMetadata(payment.metadata),
            amountMismatch: { gateway: order.amount, expected, detectedAt: new Date().toISOString() },
          }),
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, payment.id), inArray(payments.status, ['created', 'failed'])))
        .returning();

      if (flagged.length === 0) return { outcome: 'already_settled', settledAs: 'unknown' };

      // The amount is wrong but the money is real, so the patient is still owed it back.
      // Credit what HDFC actually took, not what we expected — that is what left their
      // account. The discrepancy stays recorded above for reconciliation.
      if (Number.isFinite(charged) && charged > 0) {
        await this.creditUnbookedPayment(flagged[0], orderId, 'amount_mismatch', charged);
        return { outcome: 'refunded_to_wallet', reason: 'amount_mismatch' };
      }

      // No usable amount — we cannot know what to return, so this one genuinely needs a
      // human. Left as 'failed' with the discrepancy in metadata.
      return { outcome: 'not_paid', status: 'AMOUNT_MISMATCH' };
    }

    // Claim the right to settle. Only one caller can move the row off 'created', so a
    // simultaneous return and webhook cannot both go on to create an appointment.
    const claimed = await db
      .update(payments)
      .set({
        status: 'success',
        gatewayPaymentId: order.id,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), inArray(payments.status, ['created', 'failed'])))
      .returning();

    // Another caller won the claim between our read and this update. They are settling
    // it right now; their outcome is not knowable from here without re-reading, and the
    // caller only needs to know it is in hand.
    if (claimed.length === 0) return { outcome: 'already_settled', settledAs: 'unknown' };

    const metadata = this.parseMetadata(payment.metadata);

    // From here the money is real and ours to account for. Any failure below falls
    // through to the wallet credit.
    try {
      if (payment.reservationId && metadata.appointmentData) {
        const booked = await storage.confirmReservationAsPaidBooking(
          payment.reservationId,
          payment.id,
          {
            ...metadata.appointmentData,
            date: new Date(metadata.appointmentData.date),
          }
        );

        if (booked) {
          // The direct booking route does this inline; a gateway booking is created here
          // instead, so without it every online appointment would have a null ETA until
          // some unrelated event happened to recalculate the queue.
          await this.applyInitialETA(booked.appointment);
          return { outcome: 'booked', appointment: booked.appointment };
        }
      }

      // The hold lapsed while they were paying. That does not have to mean no token:
      // if the schedule still has capacity, give them a fresh one. Without this the
      // sweep could never produce a booking at all — it only examines orders older than
      // 15 minutes, which is always past the hold, so every order it rescues would be
      // refunded even when a slot was sitting free.
      if (metadata.appointmentData) {
        const rebooked = await this.rebookWithFreshToken(payment, metadata.appointmentData);
        if (rebooked) {
          await this.applyInitialETA(rebooked);
          return { outcome: 'booked', appointment: rebooked };
        }
      }

      return await this.creditUnbookedPayment(payment, orderId, 'hold_expired');
    } catch (err) {
      console.error(`[hdfc] booking failed after payment on ${orderId}:`, err);
      const reason = err instanceof DuplicateBookingError ? 'duplicate_booking' : 'booking_failed';
      return await this.creditUnbookedPayment(payment, orderId, reason);
    }
  }

  /**
   * Gives the patient their money back as wallet balance when a paid order could not
   * become a booking. This is real money HDFC collected, so unlike a `dummy` payment it
   * is legitimately spendable.
   */
  /**
   * Frees a patient to try again after a payment that definitively failed: releases the
   * held token and closes the payment row. Never called for a pending or charged order.
   */
  private async releaseFailedAttempt(payment: Payment): Promise<void> {
    try {
      if (payment.reservationId) {
        await storage.cancelTokenReservation(payment.reservationId, payment.patientId);
      }
      await db
        .update(payments)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, 'created')));
    } catch (err) {
      // Best effort. The hold expires on its own and the sweep retries the row.
      console.error(`[hdfc] could not release failed attempt ${payment.gatewayOrderId}:`, err);
    }
  }

  /**
   * Issues a brand-new token for a payment whose original hold lapsed.
   *
   * Re-runs the full eligibility check first — the schedule may have filled, closed or
   * ended while the patient was paying — so this can only ever place someone into a slot
   * they would have been allowed to book anyway. Returns null when that is not possible,
   * and the caller falls back to crediting the wallet.
   */
  private async rebookWithFreshToken(
    payment: Payment,
    appointmentData: Record<string, any>
  ): Promise<Appointment | null> {
    try {
      const date = new Date(appointmentData.date);
      const check = await validateBookingEligibility({
        doctorId: appointmentData.doctorId,
        clinicId: appointmentData.clinicId,
        scheduleId: appointmentData.scheduleId,
        date,
        patientId: payment.patientId,
      });
      if (!check.ok) return null;

      // Short hold: it is claimed immediately on the next line, and a long one would
      // linger if the conversion failed.
      const reservation = await storage.reserveNextToken(
        appointmentData.scheduleId,
        payment.patientId,
        60
      );

      const booked = await storage.confirmReservationAsPaidBooking(reservation.id, payment.id, {
        ...appointmentData,
        date,
      });

      if (!booked) {
        await storage.cancelTokenReservation(reservation.id, payment.patientId);
        return null;
      }
      return booked.appointment;
    } catch (err) {
      console.error(`[hdfc] could not re-book ${payment.gatewayOrderId} after hold expiry:`, err);
      return null;
    }
  }

  /**
   * Persists the queue position estimate for a freshly created appointment.
   * Bookkeeping only — the token is real and paid for whether or not this succeeds.
   */
  private async applyInitialETA(appointment: Appointment): Promise<void> {
    try {
      const eta = await ETAService.calculateInitialETA(
        appointment.scheduleId,
        appointment.tokenNumber,
        new Date(appointment.date)
      );
      await storage.updateAppointmentETA(appointment.id, eta);
      appointment.estimatedStartTime = eta;
    } catch (etaError) {
      console.error('[hdfc] could not calculate initial ETA:', etaError);
    }
  }

  private async creditUnbookedPayment(
    payment: Payment,
    orderId: string,
    reason: 'hold_expired' | 'duplicate_booking' | 'booking_failed' | 'amount_mismatch',
    /** Credit this instead of the payment's own amount. Used when the gateway charged
     *  something other than what we asked for — the patient is owed what actually left
     *  their account. */
    amountOverride?: number
  ): Promise<{ outcome: 'refunded_to_wallet'; reason: string }> {
    const messages: Record<string, string> = {
      hold_expired: 'Your token was released before payment completed',
      duplicate_booking: 'You already have an appointment for this schedule',
      booking_failed: 'We could not confirm your token',
      amount_mismatch: 'There was a problem confirming your payment amount',
    };
    const why = messages[reason];
    const amount = amountOverride ?? parseFloat(payment.amount);

    // Lazy: breaks the payment <-> wallet import cycle described at the top of the file.
    const { walletService } = await import('./wallet');

    // The database enforces single payout: wallet_transactions.reference_id is uniquely
    // indexed, and processTransaction writes the ledger row and the balance together
    // under a row lock. So a second attempt — a retried webhook, an overlapping sweep —
    // raises a duplicate key here rather than crediting the patient twice.
    let txn: { id: number };
    try {
      txn = await walletService.processTransaction({
        patientId: payment.patientId,
        amount,
        transactionType: 'wallet_topup',
        description: `${why} — ₹${amount.toFixed(2)} added to your wallet`,
        referenceId: orderId,
        metadata: { source: 'hdfc', orderId, reason },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Already credited. Recover the existing row so the payment can still be linked to
      // it — this is the path a credit interrupted before linking comes back through.
      const [existing] = await db
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(eq(walletTransactions.referenceId, orderId))
        .limit(1);
      if (!existing) throw err;
      txn = existing;
    }

    await db
      .update(payments)
      .set({ walletTransactionId: txn.id, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    return { outcome: 'refunded_to_wallet', reason };
  }

  /**
   * Catches orders whose callbacks never arrived.
   *
   * A patient can pay by UPI and close the app before the redirect fires, and a webhook
   * can be lost. Those rows sit at 'created' forever, so money would be collected with
   * nothing given back and no record that anything went wrong.
   *
   * Deliberately does NOT mark old rows 'failed'. That would break the compare-and-swap
   * in settleHdfcOrder and strand a slow payment with neither booking nor refund.
   */
  async sweepStaleHdfcOrders(olderThanMinutes = 15): Promise<void> {
    if (!hdfcGateway.isConfigured()) return;

    // The caller is a 60s setInterval that does not await us, and one pass can take
    // longer than that (25 orders x two calls, each with a 20s timeout). Overlapping
    // passes would examine the same rows concurrently, which is how a single payment
    // ends up credited to a wallet twice.
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.runSweep(olderThanMinutes);
    } finally {
      this.sweeping = false;
    }
  }

  private async runSweep(olderThanMinutes: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

    // Oldest first. Without an order, a backlog of abandoned orders would be re-polled
    // every minute forever and a genuinely stuck payment further down would never be
    // reached.
    // Retired orders are re-checked for a bounded window, not forever. A bank can report
    // CHARGED after we gave up, and that money still has to reach the patient — but an
    // unbounded re-check would recreate the starvation this ordering exists to prevent.
    const revivalWindow = new Date(Date.now() - 2 * 60 * 60_000);

    // Two separate budgets rather than one query. Retired rows are always the oldest, so
    // under a single oldest-first limit a backlog of them would fill the window every
    // pass and newly unsettled orders would never be looked at.
    const [fresh, revivable] = await Promise.all([
      db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.gateway, 'hdfc'),
            eq(payments.status, 'created'),
            lt(payments.createdAt, cutoff)
          )
        )
        .orderBy(payments.createdAt)
        .limit(20),

      db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.gateway, 'hdfc'),
            eq(payments.status, 'failed'),
            gt(payments.updatedAt, revivalWindow)
          )
        )
        .orderBy(payments.updatedAt)
        .limit(5),
    ]);

    const unsettled = [...fresh, ...revivable];

    for (const row of unsettled) {
      if (!row.gatewayOrderId) continue;
      try {
        const result = await this.settleHdfcOrder(row.gatewayOrderId);
        if (result.outcome === 'booked' || result.outcome === 'refunded_to_wallet') {
          console.log(`[hdfc] sweep settled ${row.gatewayOrderId}: ${result.outcome}`);
          continue;
        }
        // Both a terminal failure and an abandoned checkout still sitting at NEW are
        // candidates for retirement; retireIfExpired decides using HDFC's own expiry,
        // reusing the status settle already fetched rather than asking again.
        //
        // Only rows still at 'created' can be retired — the conditional UPDATE inside
        // would match nothing for a row already 'failed', so calling it for one is a
        // guaranteed no-op.
        if (
          row.status === 'created' &&
          (result.outcome === 'not_paid' || result.outcome === 'pending') &&
          result.order
        ) {
          await this.retireIfExpired(row, result.order);
        }
      } catch (err) {
        // Leave it as it is and try again next sweep. An unreachable gateway is not
        // evidence that the patient did not pay.
        if (err instanceof HdfcGatewayError && !err.httpStatus) {
          // No HTTP status means the request never landed — timed out or unreachable.
          // Abandon the gateway half of the pass rather than waiting out a 20s timeout
          // for every remaining row; the next tick retries from the top. `break`, not
          // `return`: stranded-payment recovery below is pure database work and must
          // still run, or money already taken sits uncredited for the whole outage.
          console.warn('[hdfc] gateway unreachable, abandoning rest of sweep pass');
          break;
        }
        // An error that DID reach the gateway — a 401 from a rotated key, a 5xx — is
        // logged rather than swallowed, or lost callbacks would go unsettled silently.
        console.error(`[hdfc] sweep error on ${row.gatewayOrderId}:`, err);
      }
    }

    await this.sweepStrandedPayments();
  }

  /**
   * Marks an order dead once HDFC says its own payment window has closed.
   *
   * This is narrower than it looks, and deliberately so: it is HDFC confirming the order
   * can no longer be paid, not us assuming abandonment after a timer. A row retired here
   * can still be revived — settleHdfcOrder accepts 'failed' — so a late CHARGED from a
   * slow bank is not lost. That is what §14.5 forbids giving up on.
   */
  private async retireIfExpired(row: Payment, order: HdfcOrderStatus): Promise<void> {
    // Deliberately NOT gated on isPending. An abandoned checkout sits at "NEW" forever —
    // the patient opened the page and walked away — and "NEW" is a pending status.
    // Skipping those would leave them at 'created' permanently, and because the sweep
    // takes the oldest 25 first, abandoned orders would accumulate at the head of the
    // queue and crowd out newer orders that still need settling. HDFC declaring the
    // payment window closed is the real gate.
    const expiry = order.order_expiry ? new Date(order.order_expiry) : null;

    if (expiry && !isNaN(expiry.getTime())) {
      if (expiry > new Date()) return;
    } else {
      // No usable expiry from the gateway. Fall back to elapsed time rather than never
      // retiring the row — an order left at 'created' forever would sit at the head of
      // the oldest-first sweep window and crowd out newer orders permanently. Generous,
      // because this only decides when to stop polling: settle still accepts 'failed',
      // so a late CHARGED is not lost.
      const age = Date.now() - new Date(row.createdAt ?? Date.now()).getTime();
      if (age < STALE_ORDER_RETIRE_MS) return;
    }

    await db
      .update(payments)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(payments.id, row.id), eq(payments.status, 'created')));
  }

  /**
   * Catches money we took and then lost track of.
   *
   * A payment marked 'success' whose booking and wallet credit are both missing means the
   * process died between claiming the row and settling it. Nothing else revisits these:
   * the main sweep only scans 'created', and a webhook retry returns already_settled.
   */
  private async sweepStrandedPayments(): Promise<void> {
    const cutoff = new Date(Date.now() - 5 * 60_000);
    const stranded = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.gateway, 'hdfc'),
          eq(payments.status, 'success'),
          isNull(payments.appointmentId),
          isNull(payments.walletTransactionId),
          lt(payments.updatedAt, cutoff)
        )
      )
      .orderBy(payments.updatedAt)
      .limit(25);

    for (const row of stranded) {
      if (!row.gatewayOrderId) continue;
      try {
        console.warn(`[hdfc] stranded payment ${row.gatewayOrderId} — crediting wallet`);
        await this.creditUnbookedPayment(row, row.gatewayOrderId, 'booking_failed');
      } catch (err) {
        console.error(`[hdfc] could not recover stranded ${row.gatewayOrderId}:`, err);
      }
    }
  }

  private parseMetadata(raw: string | null): Record<string, any> {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * Whether a booking paid this way may be refunded to the wallet.
   * Wallet payments always can. Online payments only once a real gateway is
   * collecting money — a simulated payment has nothing to give back.
   */
  isRefundableMethod(method: PaymentMethod): boolean {
    // Only reached by the direct booking route, which rejects `online` outright once a
    // real gateway is active (it must go through the checkout flow instead). So an
    // online booking arriving here is always a simulated one, which collected nothing
    // and has nothing to refund. Gateway bookings set isRefundEligible themselves.
    return method === 'wallet';
  }
}

export const paymentService = new PaymentService();
