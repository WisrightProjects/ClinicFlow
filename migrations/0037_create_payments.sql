-- Create payments table: one row per booking payment attempt, whatever the method.
-- Mirrors shared/schema.ts `payments`.
--
-- `gateway` is the column that separates a real payment from a simulated one.
-- Rows with gateway = 'dummy' collected no money and must never be refunded to a
-- wallet (see server/services/payment.ts isSimulatedPayment).
CREATE TABLE IF NOT EXISTS "payments" (
  "id" serial PRIMARY KEY NOT NULL,
  "appointment_id" integer REFERENCES "appointments"("id"),
  "patient_id" integer NOT NULL REFERENCES "users"("id"),
  "schedule_id" integer REFERENCES "doctor_schedules"("id"),
  "method" varchar(20) NOT NULL,            -- wallet | online
  "gateway" varchar(30) NOT NULL,           -- wallet | dummy | razorpay
  "amount" decimal(10,2) NOT NULL,
  "platform_fee" decimal(10,2) NOT NULL,
  "gst_amount" decimal(10,2) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'created',  -- created | success | failed
  -- Populated by a real gateway in Phase 2; UNIQUE so a replayed webhook cannot be
  -- processed twice. NULL for wallet and dummy payments (Postgres allows many NULLs).
  "gateway_payment_id" varchar(100) UNIQUE,
  "wallet_transaction_id" integer REFERENCES "wallet_transactions"("id"),
  "metadata" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "payments_patient_idx" ON "payments" ("patient_id");
CREATE INDEX IF NOT EXISTS "payments_appointment_idx" ON "payments" ("appointment_id");
