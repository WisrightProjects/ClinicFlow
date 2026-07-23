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
