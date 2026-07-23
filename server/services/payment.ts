// Booking payment logic: fee lookup, the online (currently simulated) payment path,
// and the guard that stops simulated payments from ever becoming real wallet money.

import { db } from '../db';
import { payments, appointments, type Appointment, type Payment } from '@shared/schema';
import { calculateBookingFee, type BookingFee, type PaymentMethod } from '@shared/pricing';
import { eq, and, desc } from 'drizzle-orm';
import { storage } from '../storage';

/**
 * How the "Online" option behaves, from the ONLINE_PAYMENT_MODE env var:
 *  - `dummy` (default) — simulated payment, no money moves. Phase 1.
 *  - `off`             — option rejected server-side; use to disable instantly.
 *  - `live`            — real gateway. Not implemented yet; treated as `off` until Phase 2.
 */
export type OnlinePaymentMode = 'dummy' | 'off' | 'live';

export class PaymentService {
  /** The fee the patient is charged to book. Server is the authority. */
  getBookingFee(): BookingFee {
    return calculateBookingFee();
  }

  getOnlinePaymentMode(): OnlinePaymentMode {
    const mode = (process.env.ONLINE_PAYMENT_MODE || 'dummy').toLowerCase();
    return mode === 'off' || mode === 'live' ? mode : 'dummy';
  }

  /** Whether the patient may currently choose "Online" at checkout. */
  isOnlinePaymentEnabled(): boolean {
    // 'live' is not wired up yet — refuse it rather than silently booking for free.
    return this.getOnlinePaymentMode() === 'dummy';
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
   * Whether a booking paid this way may be refunded to the wallet.
   * Wallet payments always can. Online payments only once a real gateway is
   * collecting money — a simulated payment has nothing to give back.
   */
  isRefundableMethod(method: PaymentMethod): boolean {
    if (method === 'wallet') return true;
    return this.getOnlinePaymentMode() === 'live';
  }
}

export const paymentService = new PaymentService();
