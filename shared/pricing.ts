// Single source of truth for the booking fee so client and server can never disagree.

/** Flat platform fee charged per appointment booking (₹). Not the consultation fee. */
export const PLATFORM_FEE = 20.0;

/** GST applied on top of the platform fee. */
export const GST_RATE = 0.05;

export interface BookingFee {
  /** Platform fee before tax. */
  platformFee: number;
  /** GST charged on the platform fee. */
  gstAmount: number;
  /** GST rate used, as a fraction (0.05 = 5%). */
  gstRate: number;
  /** Amount actually charged to the patient. */
  total: number;
}

/** Rounds to 2 decimals without float drift (e.g. 1.005 -> 1.01). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Computes the booking fee breakdown. The server is the authority — the client calls
 * GET /api/booking/fee to display it and never sends an amount back.
 */
export function calculateBookingFee(): BookingFee {
  const platformFee = round2(PLATFORM_FEE);
  const gstAmount = round2(platformFee * GST_RATE);
  return {
    platformFee,
    gstAmount,
    gstRate: GST_RATE,
    total: round2(platformFee + gstAmount),
  };
}

/** Payment methods a patient can choose at booking. */
export const paymentMethods = ["wallet", "online"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

/**
 * Which processor actually handled a payment.
 * `dummy` = simulated online payment (Phase 1); no money moved, never refundable.
 */
export const paymentGateways = ["wallet", "dummy", "razorpay"] as const;
export type PaymentGateway = (typeof paymentGateways)[number];

/** Lifecycle of a payment attempt. */
export const paymentStatuses = ["created", "success", "failed"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];
