-- Phase 2: HDFC SmartGateway. See PAYMENT_FLOW_PLAN.md §15.
--
-- Adds the two columns the real-gateway path needs on top of the Phase 1 payments table:
--   gateway_order_id -- the order id we generate and send to HDFC
--   reservation_id   -- the token held while the patient is away paying
--
-- Both are nullable: wallet and dummy payments are instant and use neither.
--
-- It also makes wallet_transactions.reference_id unique, which is what makes a wallet
-- credit single-shot. See the note on that index below.
--
-- Safe to run against a database that already has the payments table (migration 0037).
-- Idempotent -- re-running it is a no-op.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS gateway_order_id VARCHAR(21),
  ADD COLUMN IF NOT EXISTS reservation_id INTEGER;

-- Unique, not just indexed. This is what stops a replayed webhook or a duplicated
-- initiate call from opening a second payment row against the same gateway order.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_gateway_order_id_unique'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_gateway_order_id_unique UNIQUE (gateway_order_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_reservation_id_fkey'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_reservation_id_fkey
      FOREIGN KEY (reservation_id) REFERENCES token_reservations(id);
  END IF;
END $$;

-- Lookup by gateway order id is already served by the unique constraint's own btree
-- above, so no second index is created for it — that would be pure write amplification
-- on a table the settle path updates two to four times per payment.

-- The stale-order sweep scans for unsettled gateway rows oldest-first. Partial, because
-- it only ever wants hdfc rows: a full index would be maintained on every wallet and
-- dummy payment insert to serve a query that can never return one.
CREATE INDEX IF NOT EXISTS payments_hdfc_unsettled_idx
  ON payments (created_at)
  WHERE gateway = 'hdfc' AND status IN ('created', 'failed');

-- One payment attempt in flight per patient per schedule.
--
-- booking-validation checks this too, but that is an unlocked SELECT: two taps on the
-- pay button can interleave before either payment row commits, producing two held tokens
-- and two gateway orders for the same patient. Both would consume a maxTokens slot, and
-- paying both turns the second into a refund. The constraint makes it structural.
--
-- Partial on 'created' so the row stops blocking retries the moment the attempt settles
-- or is abandoned.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_inflight_per_schedule
  ON payments (patient_id, schedule_id)
  WHERE gateway = 'hdfc' AND status = 'created';

-- Makes a wallet credit single-shot.
--
-- A payment that collected money but produced no booking is refunded to the wallet, and
-- that must happen exactly once however many callbacks, retries and sweeps arrive. The
-- credit carries the gateway order id as reference_id, so uniqueness on that column IS
-- the idempotency key: walletService.processTransaction writes the ledger row and the
-- balance in one transaction under a row lock, so a second attempt raises a duplicate
-- key instead of paying the patient twice.
--
-- Preferred over a claim flag on payments, which would need a separate write and could
-- leave a row marked "claimed" with no money credited if the process died in between —
-- a state no recovery sweep could tell apart from a completed credit.
--
-- Partial so the many rows with a NULL reference_id do not collide with each other.
-- Backfill-free: no other flow writes reference_id today.
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_reference_id_unique
  ON wallet_transactions (reference_id)
  WHERE reference_id IS NOT NULL;
