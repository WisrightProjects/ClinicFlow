// Domain errors that callers need to branch on, rather than matching message text.

/**
 * A patient already holds a token for this schedule.
 *
 * Exists as a type because the online-payment path has to tell this apart from a general
 * booking failure — money has already been collected by then, and the two cases produce
 * different explanations to the patient. Matching on the message string instead means a
 * reworded message silently changes which refund reason is recorded.
 *
 * The message is kept verbatim so existing callers that still test it keep working.
 */
export const DUPLICATE_BOOKING_MESSAGE =
  'You already have an appointment booked with this doctor for this schedule. Please check your existing appointments.';

export class DuplicateBookingError extends Error {
  constructor(message: string = DUPLICATE_BOOKING_MESSAGE) {
    super(message);
    this.name = 'DuplicateBookingError';
  }
}
