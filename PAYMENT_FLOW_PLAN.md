# Payment Options at Booking — Plan & Stories

**Status:** Phase 1 implemented on `feat/payment-options-dummy-gateway` — not yet committed
**Scope:** Phase 1 = Wallet + **Dummy** Online. Phase 2 = real payment gateway (later).

## Build status

| Item | State |
|---|---|
| Bug fix — appointment orphaned on rollback | ✅ done |
| Bug fix — wallet double-charge (row lock) | ✅ done |
| Bug fix — `-₹-21.00` display | ✅ done |
| `shared/pricing.ts` — single fee source | ✅ done |
| `payments` table + migration `0037` | ✅ done |
| `GET /api/booking/fee` | ✅ done |
| `POST /api/appointments` accepts `paymentMethod` | ✅ done |
| Simulated online booking (no wallet touched) | ✅ done |
| Refund guard for simulated payments | ✅ done |
| ₹1,000 starting balance removed | ✅ done |
| Payment screen + dummy gateway UI | ✅ done |
| Kill switch `ONLINE_PAYMENT_MODE` | ✅ done |
| Typecheck (79 baseline, unchanged) / build | ✅ green |
| Live smoke test on device | ⬜ pending |
| Postman collection | ⚠️ see note in §9 |

---

## 1. Goal

Today, clicking **Book Token** silently deducts ₹21 from the patient's wallet. There is no
choice, no price shown, and no confirmation of what is being charged.

We want the patient to:
1. See **how much** they are paying and **what for** (₹20 platform fee + 5% GST = ₹21)
2. **Choose** how to pay — Wallet or Online
3. Confirm, pay, and see their token booked

Phase 1 builds the whole experience with a **dummy** online payment, so the flow can be
approved by the client now. Phase 2 swaps the dummy step for a real gateway without
redesigning anything.

---

## 2. The current charge (unchanged)

| Item | Amount |
|---|---|
| Platform fee | ₹20.00 |
| GST @ 5% | ₹1.00 |
| **Total** | **₹21.00** |

> This is a **booking/platform fee**, not the doctor's consultation fee. The consultation
> fee is settled at the clinic. Everyone should be agreed on this before we build.

Today these numbers are hardcoded in `server/routes.ts:631-634`. We will move them to a
shared constant so the screen and the server can never disagree.

---

## 3. User Stories

### Story 1 — See what I'm paying before I pay

> **As a** patient
> **I want** to see the exact amount and its breakdown before confirming
> **So that** I know what I'm being charged and why.

**Acceptance criteria**
- Tapping **Book Token** opens a Payment screen (replaces today's "Confirm Booking" dialog)
- Screen shows: Doctor name, clinic, date/time, token estimate
- Screen shows the breakdown: Platform Fee ₹20.00 · GST (5%) ₹1.00 · **Total ₹21.00**
- The amount is fetched from the server, never hardcoded in the app
- "Booking for someone else?" (existing feature) still works on this screen

---

### Story 2 — Pay from my wallet

> **As a** patient with enough wallet balance
> **I want** to pay using my wallet
> **So that** booking is instant and I don't re-enter payment details.

**Acceptance criteria**
- Payment screen shows two options: **Wallet** and **Online**
- The Wallet option displays the current balance, e.g. "Wallet — Balance ₹1,000.00"
- Wallet is **pre-selected** when balance ≥ ₹21
- When balance < ₹21, Wallet is **disabled** and shows "Insufficient balance (₹X)"
- Confirming with Wallet deducts ₹21, books the token, shows the success screen
- The wallet transaction appears in Transaction History as **-₹21.00** (not `-₹-21.00`)

---

### Story 3 — Pay online (dummy, Phase 1)

> **As a** patient with no wallet balance
> **I want** to pay online
> **So that** I can still book a token.

**Acceptance criteria**
- Selecting **Online** and confirming shows a simulated payment screen for the same ₹21
- On "Payment Successful", the token is booked and the success screen appears
- **The wallet is not touched at all** — no debit, no credit, no wallet transaction row
- The payment is recorded in the DB as `gateway = 'dummy'` so it is permanently
  distinguishable from a real payment (see §5)
- The Online option is **live in production** (required for bank/gateway validation), but
  sits behind a server-side **kill switch** (`ONLINE_PAYMENT_MODE = dummy | off | live`)
  so it can be switched the moment the real gateway is approved — no redeploy needed

---

### Story 4 — Token booked confirmation

> **As a** patient
> **I want** clear confirmation after paying
> **So that** I know my token number and when to arrive.

**Acceptance criteria**
- Success screen shows: ✅ Token Booked, token number, doctor, clinic, date, estimated time
- Shows how it was paid ("Paid ₹21.00 via Wallet" / "via Online")
- Existing behaviour is preserved: ETA calculated, appointment list + wallet balance refreshed

---

### Story 5 — Fake payments must never become real money

> **As the** business
> **I want** dummy payments clearly marked and excluded from refunds
> **So that** test bookings cannot create real wallet balance.

**Why this matters:** the existing refund logic (`server/services/wallet.ts:349`) refunds any
appointment where `isPaid = true` by **crediting the patient's wallet**. If a dummy online
payment sets `isPaid = true`, then booking → cancelling would credit ₹21 of *real, spendable*
wallet money for a payment that never happened. Repeatable, unlimited.

**Acceptance criteria**
- Every payment writes a row to a new `payments` table with a `gateway` column
- Dummy payments are `gateway = 'dummy'`
- Cancelling a dummy-paid appointment **does not credit the wallet** — the refund is
  recorded as `refundType: 'none'` with a note
- Reports/queries can exclude dummy payments with a single `WHERE gateway <> 'dummy'`

**Refund rule by payment type:**

| Paid via | Refund goes to | Phase |
|---|---|---|
| Wallet | Wallet (unchanged) | now |
| Online — **dummy** | **Nothing.** No money came in, so none goes out | now |
| Online — real gateway | Wallet (client decision, confirmed) | Phase 2 |

---

### Story 6 — Remove the ₹1,000 free starting balance

> **As the** business
> **I want** new patients to start with ₹0 wallet
> **So that** test credit does not become real spendable money.

**Acceptance criteria**
- `getOrCreateWallet()` creates new wallets with **₹0.00**, not ₹1,000
  (`server/services/wallet.ts:58`)
- Existing wallet balances are **not** modified by this change
- A new patient sees "Wallet — Insufficient balance (₹0.00)" and uses Online instead

> ⚠️ **Consequence — read §6.1.** With ₹1,000 gone and no top-up feature, a new patient's
> only way to pay is Online, which in Phase 1 is free. See the risk note below.

---

## 4. Screen flow

```
[ Book Token ]
      │
      ▼
┌─────────────────────────────────┐
│ Confirm & Pay                   │
│ Dr. Senthil · City Clinic       │
│ Today, 10:00 AM                 │
│─────────────────────────────────│
│ Platform Fee          ₹20.00    │
│ GST (5%)               ₹1.00    │
│ Total                 ₹21.00    │
│─────────────────────────────────│
│ ◉ Wallet — Balance ₹1,000.00    │
│ ○ Online (UPI / Card)           │
│─────────────────────────────────│
│ [ Cancel ]        [ Pay ₹21 ]   │
└─────────────────────────────────┘
      │
      ├── Wallet ──► deduct ₹21 ─────────────┐
      │                                       │
      └── Online ──► ┌──────────────────┐     │
                     │ Processing...    │     │
                     │ (dummy, ~2s)     │     │
                     │ Payment Success  │     │
                     └──────────────────┘     │
                                              ▼
                              ┌───────────────────────────┐
                              │ ✅ Token Booked           │
                              │ Token #5 · Dr. Senthil    │
                              │ Est. 10:45 AM             │
                              │ Paid ₹21.00 via Wallet    │
                              └───────────────────────────┘
```

**Insufficient balance variant:** Wallet row renders greyed with
`Wallet — Insufficient balance (₹4.00)`, and Online is pre-selected instead.

---

## 5. Technical plan

### 5.1 Schema (`shared/schema.ts`)

**New table `payments`** — one row per payment attempt. Needed for Phase 2 anyway, so we
build it now and dummy rows simply carry `gateway = 'dummy'`.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `appointmentId` | int FK → appointments | nullable (set after booking) |
| `patientId` | int FK → users | |
| `scheduleId` | int FK → doctor_schedules | |
| `method` | varchar(20) | `wallet` \| `online` |
| `gateway` | varchar(30) | `wallet` \| `dummy` \| later `razorpay` |
| `amount` | decimal(10,2) | 21.00 |
| `platformFee` | decimal(10,2) | 20.00 |
| `gstAmount` | decimal(10,2) | 1.00 |
| `status` | varchar(20) | `created` \| `success` \| `failed` |
| `gatewayPaymentId` | varchar(100) | null for dummy; unique when present (Phase 2 idempotency) |
| `walletTransactionId` | int FK → wallet_transactions | wallet payments only |
| `metadata` | text | JSON |
| `createdAt` / `updatedAt` | timestamp | |

**New shared pricing constant** (`shared/pricing.ts`) so client and server agree:
`PLATFORM_FEE = 20.00`, `GST_RATE = 0.05`, plus a `calculateBookingFee()` helper.

No change needed to `appointments` — `paymentMethod` already exists and will hold
`wallet` or `online`.

### 5.2 Backend

| Endpoint | Purpose |
|---|---|
| `GET /api/booking/fee` | returns `{ platformFee, gstAmount, total }` for the screen |
| `POST /api/appointments` | extended: accepts `paymentMethod: 'wallet' \| 'online'` |

- Server **recomputes** ₹21 itself and ignores any amount sent by the client
- `paymentMethod: 'wallet'` → existing balance check + debit (unchanged behaviour)
- `paymentMethod: 'online'` → **skip all wallet logic**, write a `payments` row with
  `gateway: 'dummy', status: 'success'`, then create the appointment
- Online path is rejected with `400` when the feature flag is off
- Refund guard in `walletService`: skip wallet credit when the appointment's payment
  `gateway = 'dummy'`

New thin service `server/services/payment.ts` to hold this logic — keeps `routes.ts` and
`storage.ts` from growing (they are already ~4000 / ~5300 lines).

### 5.3 Frontend

- `client/src/pages/patient-booking-page.tsx` — replace the "Confirm Booking" dialog
  (line 400-449) with the new payment sheet
- New `client/src/components/booking/payment-options.tsx` — the fee breakdown + the two
  payment choices
- New `client/src/components/booking/dummy-payment-screen.tsx` — the simulated gateway
- Wallet balance read from the existing `/api/wallet/summary` query
- Reuse existing `invalidateWalletQueries()` on success

### 5.4 Prerequisite bug fixes (do these first)

These are harmless today but become money bugs the moment payments are real:

1. **`server/storage.ts:1870`** — inside `db.transaction`, `createAppointment()` inserts via
   the global `db` instead of `tx`. If the wallet step fails, the appointment survives
   unpaid. → pass `tx` through.
2. **`server/storage.ts:1873`** — the wallet is read without a row lock (`.for('update')`),
   unlike `walletService.processTransaction`. A double-tap on Book Token can double-charge.
   → lock the row and re-check balance inside the transaction.
3. **`client/.../wallet-transactions.tsx:194`** — booking stores `amount` as `-21` while every
   other transaction stores positive, so the UI renders **`-₹-21.00`**. → store positive,
   consistent with `processTransaction`.

---

## 6. Client decisions (answered)

| # | Question | Answer |
|---|---|---|
| 1 | Dummy Online — live or demo-only? | **Live.** Ships to Play Store so the bank team can validate the flow and issue the real gateway. |
| 2 | Is ₹21 the platform fee? | **Yes** — platform fee only, not the consultation fee. |
| 3 | Refund destination? | **Always the wallet.** (Dummy payments excepted — nothing to refund.) |
| 4 | ₹1,000 free starting balance? | **Remove it.** It was test-only credit for fresh accounts. |

### 6.1 ⚠️ Risk created by answers 1 + 4 combined

Decisions 1 and 4 interact, and the result needs to be a conscious choice:

- New patients start at **₹0** wallet (decision 4) → the Wallet option is unavailable to them
- Their only option is **Online**, which in Phase 1 charges **nothing** (decision 1)

**So between Play Store release and gateway approval, effectively every new booking is free.**
Wallet balance can only arrive via refunds, and there is no top-up feature yet.

This may be perfectly acceptable — it is a short window, the loss is capped at the ₹21
platform fee per booking, and the clinic still collects the consultation fee in person. But it
should be a decision, not a surprise.

**Mitigations included in this plan:**

1. **Kill switch** — `ONLINE_PAYMENT_MODE` env var (`dummy` / `off` / `live`). Flip to `off`
   or `live` instantly without a redeploy once the gateway is approved.
2. **Every dummy payment tagged** `gateway = 'dummy'` → exact count and value of free
   bookings is queryable at any time.
3. **No refunds on dummy payments** → fake money can never become spendable wallet balance.
4. **Optional (client's call):** show a small line on the dummy screen such as
   *"Test transaction — no amount will be debited."* This is honest to the patient and
   reads well to a reviewing bank team, but it does advertise that bookings are free.

### 6.2 Remaining question

| # | Question | Why it matters |
|---|---|---|
| 5 | Existing wallets already holding the ₹1,000 test credit — leave them, or zero them out? | Plan assumes **leave them untouched**. Zeroing production balances is a destructive change and needs explicit sign-off. |

---

## 7. Out of scope (Phase 1)

- Real payment gateway integration, webhooks, signature verification
- Token reservation during online payment *(only needed for a real gateway, which is async —
  the dummy is instant, so this is not needed yet)*
- Split payments (part wallet + part online)
- Wallet top-up via gateway
- Refunds back to bank/source *(client confirmed: refunds always go to the wallet)*

---

## 7.1 Release / rollout

The goal of Phase 1 is a Play Store build the bank team can validate.

- The Clinik Android app loads the **live site** in a WebView, so the payment screens
  themselves ship with a normal **web redeploy** — no app rebuild required for the UI.
- A **Play Store release is still needed** for the bank team to review a published app.
  That means `npm run build:android`, a version bump, and a store submission.
- Recommended order:
  1. Fix the 3 prerequisite bugs → verify
  2. Build payment screens + `payments` table + dummy flow → verify on staging
  3. Deploy web → smoke-test in the existing app on a real device
  4. Bump version, build APK/AAB, submit to Play Store
  5. Bank validates → gateway credentials issued → Phase 2 begins
- When the gateway is approved, flip `ONLINE_PAYMENT_MODE` and implement the Phase 2
  webhook path. The screens do not change.

---

## 8. Phase 2 preview (for context only — not being built now)

A real gateway is **asynchronous**: the patient leaves for a checkout screen and the
authoritative confirmation arrives at our server by **webhook**, possibly after they close
the app. So the online path becomes:

```
reserve token (10 min hold) → create gateway order → patient pays
   → webhook verifies signature → convert reservation into appointment
   → (abandoned? hold expires, no token, no charge)
```

The existing `token_reservations` table + the 60s `expireStaleReservations()` sweep already
provide this hold mechanism. Because Phase 1 puts the payment decision on the server and
records every payment in the `payments` table, Phase 2 changes the middle step only — the
screens, pricing, and success flow stay exactly the same.

---

## 9. Estimated change surface

| Area | Files |
|---|---|
| Schema | `shared/schema.ts`, new `shared/pricing.ts`, 1 migration |
| Backend | `server/routes.ts` (booking route), new `server/services/payment.ts`, `server/services/wallet.ts` (refund guard), `server/storage.ts` (3 bug fixes) |
| Frontend | `patient-booking-page.tsx`, 2 new components |
| Postman | ⚠️ **not updated** — see note below |

> **Postman note.** Rule #8 says to update `DriveEV-API.postman_collection.json`, which does
> not exist. The only collection in this repo is `RouteMappy.postman_collection.json`, and its
> contents are a geocoding API from a different project — not ClinicFlow. Rather than add
> ClinicFlow endpoints to an unrelated collection, this is flagged for a decision: create a
> proper `ClinicFlow.postman_collection.json`, or point rule #8 at the right file.

## 9.1 ⚠️ Deploy requires a migration step

Previous releases here shipped as web redeploys only, with no database step. **This one
cannot.** Migration `0037` creates the `payments` table, and both new paths use it:

- Online booking inserts into `payments` inside its transaction — **no table means online
  booking fails outright**
- Refund checks read `payments` — no table means the cancel endpoint errors

`npm run db:migrate` must run against production as an explicit part of this deploy.

> This repo has been bitten by exactly this before: the comment at the top of
> `migrations/0036_create_device_tokens.sql` records that `device_tokens` was created with
> `db:push` in dev but never migrated to prod, so pushes failed silently in production.

---

## 10. Verifying after deploy

Endpoints to smoke-test (per rule #9):

```bash
# Fee + whether online is enabled (needs an authenticated session cookie)
curl -s -b cookies.txt http://localhost:5001/api/booking/fee

# Wallet booking
curl -s -b cookies.txt -X POST http://localhost:5001/api/appointments \
  -H 'Content-Type: application/json' \
  -d '{"doctorId":1,"clinicId":1,"scheduleId":1,"date":"2026-07-24T10:00:00.000Z","paymentMethod":"wallet"}'

# Online (simulated) booking — must NOT change wallet balance
curl -s -b cookies.txt -X POST http://localhost:5001/api/appointments \
  -H 'Content-Type: application/json' \
  -d '{"doctorId":1,"clinicId":1,"scheduleId":1,"date":"2026-07-24T10:00:00.000Z","paymentMethod":"online"}'
```

Checks worth doing by hand:

1. Book with wallet → balance drops exactly ₹21, history shows **−₹21.00** (single minus)
2. Book online → wallet balance **unchanged**, `payments` row has `gateway = 'dummy'`
3. Cancel the online booking → **no** wallet credit, toast says cancelled without a refund
4. Cancel the wallet booking → ₹21 credited back
5. Set `ONLINE_PAYMENT_MODE=off`, restart → Online option greyed out, API rejects it
6. Register a brand-new patient → wallet starts at **₹0.00**, not ₹1,000

---

**Next step:** validate these stories, answer §6, then we branch and build.

---

# Phase 2 — HDFC SmartGateway (real gateway)

> **Status: plan, awaiting sign-off. No code written yet.**
> UAT credentials received 23 Oct 2026. Merchant ID `SG6353`, Basic Auth integration.

## 11. What changes, and what does not

Phase 1 deliberately put the payment decision on the server and recorded every payment
in the `payments` table, so Phase 2 replaces **one step in the middle**. These stay exactly
as they are:

- The fee (`shared/pricing.ts`), the fee endpoint, and the booking screens
- Wallet payments and wallet refunds
- The `dummy` gateway and `isSimulatedPayment` — still the guard that stops simulated
  money becoming real money

What changes: choosing "Online" stops being instant. It becomes a round trip to HDFC.

---

## 12. Credentials

All five come from the dashboard's downloaded `config.json`. They live in `.env`
(gitignored, confirmed untracked) and must be added to the Coolify environment too.

```
HDFC_MERCHANT_ID              # SG6353
HDFC_API_KEY                  # Basic auth for the Session + Order Status APIs
HDFC_RESPONSE_KEY             # stored, but NOT used by this design — see note below
HDFC_PAYMENT_PAGE_CLIENT_ID   # 'hdfcmaster' in UAT; merchant ID in production
HDFC_BASE_URL                 # https://smartgateway.hdfcuat.bank.in (UAT)
HDFC_WEBHOOK_USER             # we choose these two and type them into the
HDFC_WEBHOOK_PASS             # dashboard's Webhooks tab (Basic HTTPS auth)
```

`HDFC_BASE_URL` is what flips UAT → production. Production is
`https://smartgateway.hdfc.bank.in` and comes with a different set of keys.

> **On the Response Key.** It exists to verify the signature on the return redirect. This
> design never trusts that redirect (§13.1) — it re-queries Order Status instead, which is
> strictly stronger. So the key is recorded for completeness but no code reads it. If that
> ever changes, it is the right key for the job.

---

## 13. The flow

A real gateway is **asynchronous**. The patient leaves our site, pays on HDFC's page, and
the authoritative answer arrives at our server — possibly after they have closed the app.
So the token has to be **held** while they pay, and the result has to be settled from a
source we trust.

```
1. Patient taps "Pay ₹21 online"
2. Server validates the booking, reserves a token, writes a `payments` row
   (status = created), calls HDFC /session, returns the payment URL
3. Patient pays on HDFC's hosted page
4. Two things race back to us:
     a. the browser returns to return_url
     b. HDFC POSTs the webhook
   Whichever arrives first settles the order. The other is a no-op.
5. Settle = ask HDFC server-to-server what actually happened, then
   convert the reservation into a real appointment
6. Abandoned? The hold expires on its own, no token, no charge.
```

### 13.1 Never trust the callback payload

Both the return redirect and the webhook carry a payment status. **Neither is used to
decide anything.** They are treated purely as a nudge saying "order X may have changed",
and the only field read from them is `order_id`.

The actual status comes from calling HDFC's **Order Status API** server-to-server with our
API key. A booking is created only when that call returns `CHARGED` **and** the amount
matches what we recorded.

Without this, anyone who can guess an order ID can POST us a fake success and book for free.

### 13.2 Settling exactly once

The return and the webhook can arrive simultaneously. Both would otherwise create an
appointment — the patient gets two tokens for one payment.

The fix is a single conditional update that only one caller can win:

```sql
UPDATE payments SET status = 'success'
 WHERE id = ? AND status = 'created'
RETURNING *;
```

Postgres serialises this. The winner gets a row back and does the work; the loser gets
nothing and returns quietly. One function, `settleHdfcOrder(orderId)`, is called by both
endpoints and contains this.

**The same guard is needed on the reservation**, for a different race. The 60-second
`expireStaleReservations` sweep is a read-then-update with no lock. So this can happen:

```
settle reads the reservation           → still "pending"
the sweep expires it and shifts the
  next patient down onto token N
settle inserts its appointment         → also token N
```

Two patients, one token. So the reservation is claimed with its own conditional update,
inside the settle transaction:

```sql
UPDATE token_reservations SET status = 'confirmed'
 WHERE id = ? AND status = 'pending' AND expires_at > now()
RETURNING *;
```

Zero rows back means the hold is gone — take the wallet-credit path in §14.4.

### 13.3 The order ID

HDFC requires it to be under 21 characters, alphanumeric, and **non-sequential**. So it
cannot be `payments.id` — sequential IDs would let anyone enumerate other people's orders.

`'CF' + 16 random hex chars` = 18 characters. Generated with `crypto.randomBytes`.

---

## 14. The token hold

`token_reservations` already does this, but it was built for walk-ins and needs two changes.

### 14.1 `confirmTokenReservation` cannot be reused

`storage.ts:5340` hardcodes `isWalkIn: true`, `isPaid: false`, `isRefundEligible: false`
and requires a `guestName`. An online patient booking is the opposite of all four.

**Needs a sibling function** — `confirmReservationAsPaidBooking(reservationId, appointmentData, fee)`
— that converts the same reservation into a real patient appointment with `isPaid: true`,
inserts the `payments` row, and marks the reservation confirmed, all in one transaction.
The existing walk-in function is left untouched.

### 14.2 The hold is 5 minutes, not 10

`reserveNextToken` reads `token_reservation_timeout_seconds` and **defaults to 300**.
Five minutes is enough for a walk-in attender but tight for a patient doing a UPI
handoff — switching to the UPI app, approving, waiting for the bank, coming back.

**Resolved in code: the gateway path now has its own hold**, `HDFC_HOLD_SECONDS`,
defaulting to **1200 seconds (20 minutes)**. The walk-in hold keeps its 300s default, so
the front desk is unaffected. Nothing to change in `admin_configurations`.

> **Why a separate value was needed.** At 300 seconds a UPI collect or an OTP checkout
> routinely outlives the hold, which made §14.4's wallet credit the **normal outcome for
> any slow payer** rather than the rare edge case it is described as.
>
> There was a second, worse consequence. The backstop sweep only examines orders **older
> than 15 minutes** — so with a 5-minute hold, *every* order the sweep rescued was
> already past expiry, and its booking path could never once succeed. A lost webhook plus
> a lost redirect always meant a refund, even with the slot sitting free.
>
> Both are now fixed: the hold is 20 minutes, and §14.4 re-reserves a fresh token when
> the original hold lapsed but the schedule still has room.

### 14.3 Expiry shifts the queue

`expireStaleReservations` (storage.ts:5272) does more than mark a row expired — when a
hold lapses it **shifts every later token down by one** so the queue has no gap. Correct
behaviour, but it means an expired slot is genuinely gone: the token number now belongs
to somebody else. This is why the late-payment case below cannot simply re-use it.

### 14.4 Money collected but no booking — agreed behaviour

**Decision (23 Oct): credit the wallet and let the patient rebook.**

> **Refined in code: try to give them a token first.** If the hold lapsed but the
> schedule still has capacity and has not ended, settlement re-runs the full eligibility
> check and issues a **fresh** token rather than refunding. The patient only falls
> through to wallet credit when a booking is genuinely impossible. This also makes the
> sweep's booking path reachable at all — see §14.2.

**The rule is broader than just an expired hold.** Once Order Status says `CHARGED`, HDFC
has taken real money. From that point on, *every* path that fails to produce an appointment
must credit ₹21 to the patient's wallet and notify them. Never silently drop it.

That covers all of:

| Failure | Why it happens |
|---|---|
| Hold expired | patient took too long |
| Reservation claim lost (§13.2) | the sweep got there first |
| Duplicate booking | patient already has a token on this schedule |
| Schedule cancelled or ended | doctor's session is over |
| Any insert error | anything unforeseen |

This is real money HDFC collected, so unlike a `dummy` payment it is legitimately
spendable — the `isSimulatedPayment` guard correctly leaves it alone.

> ⚠️ **`confirmReservationAsPaidBooking` must not bypass the duplicate check.**
> `storage.createAppointment` is what enforces "already have an appointment on this
> schedule". If the new function inserts directly instead of calling it, that check is
> silently lost — and a patient who starts two online payments for the same schedule and
> pays both would get two tokens. Call `createAppointment(data, tx)` inside it, and route
> its failure to the wallet credit above.

Rejected: booking them anyway. The token may already belong to another patient, and
forcing it past `maxTokens` corrupts the queue for everyone else.

### 14.5 Never mark an abandoned payment `failed`

An abandoned booking leaves a `payments` row sitting at `created`. **Leave it there.**

It is tempting to sweep those rows to `failed` for tidiness. Don't — it breaks the
compare-and-swap in §13.2. A patient who pays by UPI slowly, or whose webhook is delayed,
would settle later, lose the `WHERE status = 'created'` guard, and get **nothing**: money
taken, no token, no wallet credit, no error anywhere.

Instead, add a **backstop** to the existing 60-second `setInterval` in `server/index.ts`:

> For every `payments` row still at `created` and older than ~15 minutes, call Order
> Status. If HDFC says `CHARGED`, run it through `settleHdfcOrder` — which will credit
> the wallet, since the hold is long gone.

Without this, a single missed webhook plus a patient who closed the app equals money
collected and nothing given back, with no record that anything went wrong.

---

## 15. Schema changes (migration 0039)

| Change | Why |
|---|---|
| `paymentGateways` += `'hdfc'` | `shared/pricing.ts` enum |
| `payments.gateway_order_id` varchar(21) **unique** | the ID we send HDFC; unique so a replayed webhook cannot create a second row |
| `payments.reservation_id` int FK → `token_reservations.id` | links the held token to the payment being attempted |
| partial UNIQUE on `wallet_transactions.reference_id` | makes the wallet credit single-shot. The credit carries the gateway order id as its reference, and `processTransaction` writes the ledger row and the balance together under a row lock — so a retried webhook or an overlapping sweep raises a duplicate key instead of paying the patient twice. Backfill-free: no other flow writes `reference_id` today |

> **Why a unique index rather than a claim flag on `payments`.** A boolean flag needs its
> own write, separate from the credit itself. A crash in between leaves a row marked
> "claimed" with no money credited — and no recovery sweep can tell that apart from a
> completed credit, so the patient is simply never paid. The unique index has no such
> window: the credit either lands or it raises, atomically.

`gatewayPaymentId` already exists and stays as-is — it holds HDFC's own transaction ID,
returned by the Order Status call.

> ## ⚠️ 0039 must run on production BEFORE this code deploys
>
> Not alongside it, and not after. This is more dangerous than §9.1's usual warning.
>
> Drizzle builds `select()` and `.returning()` by naming **every column in the schema**.
> The moment `shared/schema.ts` gains `gateway_order_id` and `reservation_id`, every query
> against `payments` asks for them — including queries that have nothing to do with the
> gateway. Against a database without those columns, Postgres answers
> `column "gateway_order_id" does not exist`, and these break:
>
> | Breaks | Consequence |
> |---|---|
> | `getPaymentForAppointment` | feeds `isSimulatedPayment` → **every cancel and refund fails** |
> | `createOnlineBooking` | the existing dummy online path stops working |
> | `recordWalletPayment` | wallet bookings lose their payment record |
>
> **This happens with `ONLINE_PAYMENT_MODE` still set to `dummy`.** Nothing needs to be
> switched on for it to bite. Patients who have never seen the gateway lose the ability to
> cancel a booking.
>
> The migration is additive and idempotent, so running it early is safe and running it
> twice is harmless. Run it first.
>
> **Check before merging:** does Coolify auto-deploy `main`? If it does, the migration has
> to be run before the PR is merged, not after.
>
> `device_tokens` and `payments` both reached production unmigrated before — that is
> exactly this mistake, and it was only survivable because those paths were new.

---

## 16. Two things that will bite

### 16.1 The Android app will break the payment flow

`capacitor.config.ts` has **no `allowNavigation`**. Capacitor sends navigation to any
unlisted host out to the system browser — so HDFC's payment page would open in Chrome and
the return would land in Chrome, not in the app. The patient pays and never comes back.

```ts
server: {
  url: 'https://clinik.co.in',
  allowNavigation: ['smartgateway.hdfcuat.bank.in', 'smartgateway.hdfc.bank.in'],
}
```

Two lines — but it is compiled into the APK, so it cannot be fixed by a web redeploy.
It is proven first in the **staging APK** (§20), and only then carried into the production
AAB at the very end.

UPI adds a second layer: the payment page hands off to `upi://` / `intent://` URLs to open
GPay or PhonePe. WebViews do not handle those by default. **This must be tested on a real
device early** — the result decides whether more native work is needed.

> ### ✅ Confirmed on a real device (24 Oct) — and the first host list was wrong
>
> An in-app UAT payment opened in **Chrome**, exactly as predicted. The cause was more
> basic than expected: checkout does not run on the `smartgateway.` host at all.
>
> | | |
> |---|---|
> | Session API | `smartgateway.hdfcuat.bank.in` |
> | **Checkout page** | **`gateway.hdfcuat.bank.in`** |
>
> Different hostname, so the original two-entry list never matched and every payment was
> handed to the system browser. The list is now **wildcards** covering `*.hdfc.bank.in`,
> `*.hdfcuat.bank.in`, `*.hdfcbank.com` and the two juspay domains, since checkout also
> hops to the issuing bank and to a 3DS host and those cannot be enumerated in advance.
>
> **Still open: UPI app handoff.** `upi://` and `intent://` links are not HTTP, so
> `allowNavigation` does not cover them and a WebView will not open GPay or PhonePe
> without native handling. Card and net banking should work after this fix; the UPI
> buttons may not. Verify on the next device build.

> ### ⚠️ Original note — superseded by the result above
>
> The two SmartGateway hosts cover only the **first hop**. Checkout does not stay on
> them:
>
> | Payment method | Where it actually navigates |
> |---|---|
> | Net banking | the issuing **bank's own domain** |
> | Cards | a **3DS / ACS** challenge host |
> | Either | possibly a **Juspay-hosted** checkout domain |
>
> None of those match `smartgateway.hdfc*.bank.in`. Each one Capacitor does not
> recognise gets handed to Chrome — so the patient finishes paying in Chrome, the
> `return_url` lands in Chrome, and the app never learns what happened. That is the
> precise failure this section exists to prevent, and the current list only fixes the
> first step of it.
>
> **The list cannot be written from the docs — it has to come from a real UAT payment.**
> During staging testing, record every host the WebView navigates to for a card payment,
> a net-banking payment and a UPI payment, then add them all **before** building the AAB.
> Getting this wrong is only discoverable on a real device, and fixing it after the Play
> submission costs a resubmission.

### 16.2 The session cookie will not be there on return

`auth.ts:86` sets `sameSite: "lax"`. A browser does not send a Lax cookie on a **cross-site
POST**, which is how HDFC returns the patient. So `req.user` will be undefined in the
return handler.

The handler therefore must not read `req.user` at all. It looks the order up by
`order_id`, settles it, and then 302-redirects to a normal same-site page where the
patient's session works again as usual.

(`express.urlencoded` is already mounted at `index.ts:33`, so the form POST body parses.)

### 16.3 Every order needs a customer email

`customer_email` is required by the Session API, but most patients registered with phone +
MPIN and have no email. Needs confirming on production:

```sql
SELECT count(*) FROM users WHERE role='patient' AND (email IS NULL OR email='');
```

If high — as expected — we send a per-patient placeholder rather than failing the booking.

---

## 17. Testing — staging, never production

**Decision (23 Oct): a staging deployment on Coolify.**

UAT credentials must never run against `clinik.co.in`. A sandbox payment is not tagged
`dummy`, so the refund path would treat it as real and credit actual wallet balance — the
exact hole `isSimulatedPayment` exists to close. HDFC also requires `return_url` to be
HTTPS with no IP and no query string, so a plain local server cannot be used either.

Staging needs:

- Its own hostname (e.g. `staging.clinik.co.in`) with a valid certificate
- **Its own database** — never pointed at `CLINIK-PROD`
- `HDFC_BASE_URL` set to the UAT host
- Its webhook URL + Basic auth username/password entered in the dashboard

> **Building the staging database.** Use `db:push` then `db:baseline`, not
> `db:migrate:prod`. CLAUDE.md records that the older migrations are **not idempotent**,
> so replaying the full set onto an empty database breaks. `db:baseline` marks them
> applied without executing them, after which migration `0039` applies normally.

Production keeps `ONLINE_PAYMENT_MODE` unchanged until staging passes.

### 17.1 Smoke tests

1. Pay with a UAT test card → token created, `payments.status = 'success'`, wallet untouched
2. Abandon at the HDFC page → hold expires, no token, no charge. The `payments` row
   **stays at `created`** — see §14.5; do not "clean up" these rows
3. Fire the webhook twice for the same order → **one** appointment, not two
4. POST a forged "success" for an order that was never paid → rejected (Order Status says otherwise)
5. Pay, then let the hold expire before settling → ₹21 in the wallet, notification sent
6. Pay on a **real Android device** → payment page opens in-app, UPI handoff returns correctly
7. Wallet booking and dummy booking still behave exactly as before

---

## 18. Change surface

| Area | Files |
|---|---|
| Schema | `shared/schema.ts`, `shared/pricing.ts`, migration `0039` |
| New service | `server/services/hdfc-gateway.ts` — session create, order status, Basic auth |
| Payment service | `server/services/payment.ts` — `settleHdfcOrder`, extend `isOnlinePaymentEnabled` |
| Storage | `server/storage.ts` — `confirmReservationAsPaidBooking` (new; walk-in path untouched) |
| Routes | `server/routes.ts` — initiate, return, webhook |
| Client | `patient-booking-page.tsx` — redirect to the payment URL, handle the return states |
| Native | `capacitor.config.ts` — `allowNavigation` → new AAB |
| Config | `token_reservation_timeout_seconds` → 600 |

Rule #1 note: `routes.ts` and `storage.ts` are already far over the 600-line limit. The
gateway logic goes in a **new service file**, not into either of them; routes stay thin.

---

## 18.1 Two rules for whoever writes the code

**Fail closed on missing config.** This code ships to production web while
`ONLINE_PAYMENT_MODE` is still `dummy`, so the HDFC env vars will be empty there. The
webhook endpoint must **reject** when `HDFC_WEBHOOK_USER` or `HDFC_WEBHOOK_PASS` is unset
— not compare empty against empty and let the caller through. Same for
`isOnlinePaymentEnabled`: no keys means online is off.

**Do not reconstruct HDFC endpoints from memory.** The Session API is confirmed from the
docs. The **Order Status API**, the **webhook payload shape**, and the **return_url
parameters** have not been read yet and must be fetched from
`smartgateway.hdfcbank.com/docs` before anything is written against them.

---

## 19. Order of work

| # | Step | Who |
|---|---|---|
| 1 | Sign off on this plan | owner |
| 2 | Stand up staging on Coolify, its own database (§17) | us |
| 3 | Build the server path, migration included | dev |
| 4 | Test on staging with UAT cards — §17.1 items 1–5 | dev |
| 5 | Build the **staging APK** — staging URL + `allowNavigation` (§20) | dev |
| 6 | Real-device test, especially the UPI handoff — §17.1 item 6 | us |
| 7 | Send the APK to HDFC for their UAT sign-off | us |
| 8 | Bank approves → request production credentials | bank |
| 9 | Production AAB + Play release + flip `ONLINE_PAYMENT_MODE` | us |

**Before step 9:** decide what happens to the **₹20,116** of legacy wallet balances. They
are simulated credit today and become real spendable money the moment the gateway goes
live. This is a business decision, it is the last gate, and it is the one item on this
list that cannot be fixed afterwards.

---

## 20. The staging APK — how the bank reviews this

HDFC will want to see the payment flow working in their UAT environment before issuing
production credentials. The obvious move is to put a build on the Play Store for them.
**Don't.** A Play release is slow, it is public, and it would disturb the listing review
already in flight.

Hand them a **sideloadable APK pointed at staging** instead.

### 20.1 Why the APK cannot carry the integration

The Android app is a **WebView shell**. `capacitor.config.ts` contains one line that
decides everything it does:

```ts
url: 'https://clinik.co.in'
```

There are no screens and no payment code inside the APK — it opens a browser window onto
the website. An APK built before this work and one built after are **identical**. All the
payment logic ships with a normal web deploy.

The consequence: *which server the APK points at* is the only thing that separates a bank
test build from the real app. So that is the knob we turn.

### 20.2 What the staging build changes

| Setting | Production | Staging APK |
|---|---|---|
| `server.url` | `https://clinik.co.in` | `https://staging.clinik.co.in` |
| `appId` | `com.wisright.clinikflow` | **unchanged** — see below |
| `allowNavigation` | added at step 9 | **added here, proven here** |
| Distribution | Play Store | direct `.apk` file |
| Gateway keys | none yet | HDFC **UAT** |
| Database | `CLINIK-PROD` | staging database |

Only the URL changes. The app ID stays the same.

### 20.2.1 Why the app ID stays the same

A separate `appId` (e.g. `.staging`) would let both apps sit on one device, which is
tidier. It was rejected because it **breaks push notifications**:
`android/app/google-services.json` is keyed to `com.wisright.clinikflow`, and Firebase
refuses a package name it has not been issued. Booking confirmations are precisely what
the bank will be watching, so losing them to gain tidiness is a bad trade.

**The cost of keeping it: the APK will not install over the Play Store version.** Android
rejects an APK whose package name matches an installed app but whose signing key differs —
and the staging build is signed locally, not by Play. The reviewer sees a bare
"App not installed" with no explanation.

Likely to come up: the bank may already have installed Clinik from Play in order to review
it. So the handover note to HDFC must say, in as many words:

> Please uninstall the existing Clinik app before installing this build.

`capacitor.config.ts` currently hardcodes the URL with no environment switch. This needs a
small build-time switch rather than hand-editing the file before each build, which is how
a staging URL eventually ships to production by accident.

### 20.3 What this buys us

Testing the WebView questions **before** they are expensive to get wrong:

1. Does HDFC's payment page open **inside** the app, or escape to Chrome? (§16.1)
2. Does the UPI handoff to GPay/PhonePe return the patient to the app?
3. Does `return_url` land back in the WebView with the session intact? (§16.2)

Each of these is a native-side problem. Finding one at step 5 costs a rebuild. Finding it
at step 9 costs a failed Play review and a resubmission.

### 20.4 Rules for the staging build

- **Never to the Play Store.** Direct file transfer to the bank only.
- **Never pointed at `clinik.co.in`.** UAT keys plus the production database is the one
  combination that turns test payments into real wallet money (§17).
- **Tell the recipient to uninstall the Play version first** (§20.2.1), or the install
  silently fails on a signature mismatch.
- **Deleted when the bank is done.** A build pointed at staging should not stay in
  circulation once it has served its purpose.
