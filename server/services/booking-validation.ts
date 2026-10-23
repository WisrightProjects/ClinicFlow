// Shared eligibility checks for booking a token: does this doctor work at this clinic,
// is the schedule live, is there room left.
//
// Extracted so the online-payment path cannot drift from the direct booking path. The
// existing POST /api/appointments handler still carries its own inline copy of these
// checks; it can adopt this later, but changing it was out of scope for Phase 2.

import { db } from '../db';
import { storage } from '../storage';
import { appointments, tokenReservations, payments } from '@shared/schema';
import { and, eq, ne, gt } from 'drizzle-orm';
import { isScheduleEnded } from './schedule-resolution';
import { DUPLICATE_BOOKING_MESSAGE } from '../errors';
import type { DoctorSchedule } from '@shared/schema';

/**
 * Validates the extra fields required when booking on someone else's behalf.
 * Returns the message to show, or null when the fields are fine (or unused).
 */
export function validateOnBehalfFields(body: {
  isOnBehalf?: unknown;
  guestName?: string;
  guestPhone?: string;
}): string | null {
  if (!body.isOnBehalf) return null;
  if (!body.guestName?.trim()) {
    return 'Patient name is required when booking for someone else';
  }
  if (!/^\d{10}$/.test(body.guestPhone?.trim() || '')) {
    return 'A valid 10-digit phone number is required when booking for someone else';
  }
  return null;
}

export interface BookingRequest {
  doctorId: number;
  clinicId: number;
  scheduleId: number;
  date: Date;
  /**
   * When set, also rejects a patient who already holds a token or has a payment in
   * flight for this schedule. Essential before sending someone to a payment gateway:
   * without it they are charged real money and only then told they are a duplicate.
   */
  patientId?: number;
}

export type BookingValidation =
  | { ok: true; schedule: DoctorSchedule }
  | { ok: false; message: string };

/**
 * Runs every check that must pass before a patient may hold or buy a token.
 *
 * Returns a message rather than throwing, because all of these are user-actionable 400s
 * ("booking is closed", "schedule is full") rather than server faults.
 */
export async function validateBookingEligibility(
  req: BookingRequest
): Promise<BookingValidation> {
  // None of these depend on each other's results, and this runs synchronously while the
  // patient waits on the pay button — so they go out together rather than one at a time.
  // getSpecificSchedule filters on the schedule id, so the count and duplicate checks can
  // use req.scheduleId directly instead of waiting for the schedule row to come back.
  const [doctor, clinic, doctorClinics, schedule, bookedCount, duplicate] = await Promise.all([
    storage.getUser(req.doctorId),
    storage.getClinic(req.clinicId),
    storage.getDoctorClinics(req.doctorId),
    storage.getSpecificSchedule(req.doctorId, req.clinicId, req.scheduleId, req.date),
    storage.getAppointmentCountForDoctor(req.doctorId, req.clinicId, req.scheduleId),
    req.patientId
      ? checkPatientDuplicate(req.patientId, req.scheduleId)
      : Promise.resolve(null),
  ]);

  if (!doctor || doctor.role !== 'doctor') {
    return { ok: false, message: 'Invalid doctor' };
  }

  if (!clinic) {
    return { ok: false, message: 'Invalid clinic' };
  }
  const isAssociated =
    doctor.clinicId === req.clinicId || doctorClinics.some((dc) => dc.id === req.clinicId);
  if (!isAssociated) {
    return { ok: false, message: 'Doctor is not associated with this clinic' };
  }

  if (!schedule) {
    return { ok: false, message: 'Invalid or inactive schedule for this appointment' };
  }

  if (schedule.scheduleStatus === 'completed') {
    return {
      ok: false,
      message:
        'Cannot book appointment: Schedule has been completed. The doctor has finished for this session.',
    };
  }

  if (schedule.bookingStatus === 'closed') {
    return {
      ok: false,
      message: 'Cannot book appointment: Booking is currently closed for this schedule.',
    };
  }

  // A schedule whose end time has passed cannot take new tokens, even though it is
  // still flagged active.
  //
  // Uses the shared helper rather than comparing against server-local time: schedule
  // times are stored as IST wall-clock, so a UTC-hosted server reading "17:00" as
  // 17:00 UTC would be off by five and a half hours. isScheduleEnded also handles the
  // negative-offset case for times before 05:30.
  if (isScheduleEnded(schedule)) {
    return {
      ok: false,
      message: `Cannot book appointment: This schedule has already ended at ${schedule.endTime}.`,
    };
  }

  if (schedule.maxTokens != null && bookedCount >= schedule.maxTokens) {
    return {
      ok: false,
      message: `Maximum number of tokens (${schedule.maxTokens}) has been reached for this schedule`,
    };
  }

  if (duplicate) return { ok: false, message: duplicate };

  return { ok: true, schedule };
}

/**
 * Whether this patient already has — or is in the middle of getting — a token for this
 * schedule. Returns the message to show, or null when they are clear to book.
 *
 * createAppointment enforces the same rule, but only at insert time. On the online path
 * that is after the gateway has taken the money, which turns a situation we could have
 * prevented for free into a refund.
 */
async function checkPatientDuplicate(
  patientId: number,
  scheduleId: number
): Promise<string | null> {
  // Independent of each other, and both run on every booking attempt. The doctor is not
  // part of either filter: a schedule belongs to exactly one doctor, so scheduleId
  // already pins it.
  const [existing, inFlight] = await Promise.all([
    db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, patientId),
          eq(appointments.scheduleId, scheduleId),
          ne(appointments.status, 'cancel')
        )
      )
      .limit(1),

    // A live hold with a payment still in flight. Without this, repeated taps each open
    // a new session and each consumes a token slot for the length of the hold.
    db
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(tokenReservations, eq(payments.reservationId, tokenReservations.id))
      .where(
        and(
          eq(payments.patientId, patientId),
          eq(payments.scheduleId, scheduleId),
          eq(payments.status, 'created'),
          eq(tokenReservations.status, 'pending'),
          gt(tokenReservations.expiresAt, new Date())
        )
      )
      .limit(1),
  ]);

  if (existing.length > 0) return DUPLICATE_BOOKING_MESSAGE;

  if (inFlight.length > 0) {
    return 'You already have a payment in progress for this schedule. Please complete it, or wait a few minutes and try again.';
  }

  return null;
}
