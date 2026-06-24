# User Story: Ended-Schedule Token Resolution (Attender)

**Story ID:** CF-002
**Epic:** Queue & Token Management
**Feature:** When a doctor's schedule ends with tokens still unsettled (stuck at `token_started`), let the attender settle them inside the existing attender dashboard — bulk-first (one action for all), with per-token exception overrides — reusing the existing refund engine.
**Priority:** P1 (High)
**Effort:** ~2.5 days (20 hours)
**Sprint:** TBD
**Status:** Draft — awaiting validation (do NOT implement until approved)
**Depends On:** None (PRs #62–#66 already shipped the "ended" display guards)

---

## Story Overview

**As a** clinic attender
**I want** to settle the leftover tokens of a schedule once its time has ended
**So that** patients who were not consulted get refunded, patients who were seen are closed correctly, and no money is held indefinitely

**As a** patient who paid via the app
**I want** my token to reach a clear final state (Completed / Refunded / Missed) after the schedule ends
**So that** I am not left with a "stuck" appointment and my money is returned if I was not seen

---

## Why This Feature?

### Current Gap (confirmed in code)
When a schedule's end time passes and the attender has taken **no action**, any token still at `token_started` stays there **forever**:
- No refund fires.
- No `no_show` / `completed` is set.
- "Ended" is only a **client-side display label** (`now > endTime`); nothing on the server settles the tokens.
- The only existing settlement paths are **attender-triggered**: per-token `PATCH /api/appointments/:id/status` and schedule-level `POST /api/schedules/:id/cancel-with-refunds`.

### The two real-world scenarios (from product discussion)
1. **Doctor never attended** → booked patients were not consulted → they should be **refunded** (app-paid only; walk-ins paid cash are excluded).
2. **Doctor attended and saw everyone, but the attender forgot to mark them** → those tokens should be **Completed with NO refund**.

The system **cannot tell these apart on its own** — both look identical in the DB (`token_started`, end time passed). Therefore a **human (the attender) must decide**; the software must never auto-refund a patient who was actually seen. This story implements the **manual, attender-driven** resolution. (Automatic detection / escalation / grace-period auto-action is explicitly **out of scope** — future story.)

### Out of scope (deliberately)
- Mid-schedule emergency cancellation — already handled by `cancel-with-refunds` and is **unchanged** by this story.
- Any background job / auto-refund / auto-no-show timer.
- Clinic-admin escalation screen.

---

## What ALREADY exists (reused, not rebuilt)

| Capability | Location | Reused for |
|---|---|---|
| Per-token refund (guards `isRefundEligible`, `isPaid`, `hasBeenRefunded`, `patientId`) | `server/services/wallet.ts:333` `processSingleAppointmentRefund()` | The "Refund / doctor absent" outcome |
| Bulk schedule refund | `server/services/wallet.ts:197` `processScheduleCancellationRefunds()` | Reference / fallback |
| Per-token status update + auto-refund on `cancel` | `server/routes.ts:765` `PATCH /api/appointments/:id/status` | Pattern reference; **not modified** |
| Schedule cancel + refund-all | `server/routes.ts:3867` `POST /api/schedules/:id/cancel-with-refunds` | Pattern reference |
| Attender dashboard + token list + arrival toggle | `client/src/pages/attender-dashboard.tsx` | Host screen for all new UI |
| Per-token action buttons | `client/src/components/appointment-actions.tsx` | Extended with a Refund action for ended schedules |
| Attender data feed | `GET /api/attender/:id/doctors/appointments` (used at `attender-dashboard.tsx:99`) | Already returns schedules + `endTime` + appointments → banner computed client-side |

**Implication:** the refund logic is **already built and battle-tested**. The genuinely new work is (a) a way to mark stuck tokens **Completed without refund**, (b) allowing **No-show** on an ended schedule whose doctor was never marked arrived, and (c) the UI to drive it bulk-first.

---

## The real constraint that drives the design

The existing per-token endpoint (`PATCH /api/appointments/:id/status`, routes.ts:765–907) has rules that **block** the resolution outcomes we need:

| Desired outcome | Maps to status | Works via existing `/status` endpoint? |
|---|---|---|
| **Refund** (doctor absent) | `cancel` (already auto-refunds at routes.ts:856) | ✅ Yes — allowed from `token_started`, NOT pre-arrival blocked |
| **No-show** (patient didn't turn up) | `no_show` | ⚠️ Blocked — `no_show` is in `preArrivalBlockedStatuses` (routes.ts:811); if the doctor was never marked arrived, the call 400s |
| **Seen / Completed** (forgot to mark) | `completed` | ❌ No — `completed` is only reachable from `in_progress` (routes.ts:790), and `in_progress` is pre-arrival blocked |

**Decision:** Add a **separate, dedicated endpoint** for ended-schedule resolution instead of editing the shared `/status` transition table. This **isolates the new rules** so the live per-token flow on **active** schedules is byte-for-byte unchanged → near-zero breakage risk.

---

## Detailed Sub-Stories

### Sub-Story 1: "Needs resolution" banner on the attender dashboard
**Story ID:** CF-002.1 · **Points:** 2 · **Effort:** 2h

```gherkin
As an attender
I want a banner when a schedule has ended with unsettled tokens
So that I know which schedules still need me to act
```
Compute **client-side** in `attender-dashboard.tsx` from data already loaded: a schedule is "needs resolution" when `now > endTime` (for today's date) AND it has ≥1 appointment with status `token_started` or `hold`. Render an amber `<Alert>` (component already imported) listing the doctor + count. Tapping it scrolls/expands that schedule's token list. No backend change.

---

### Sub-Story 2: Bulk-decision bar inside the ended schedule's token list
**Story ID:** CF-002.2 · **Points:** 3 · **Effort:** 4h

```gherkin
As an attender
I want one action that settles ALL unsettled tokens of an ended schedule
So that I do not click through 20 tokens one by one
```
Above the existing appointment rows (only when the schedule is "ended + has unsettled tokens"), show two buttons:
- **"Doctor saw everyone → mark all completed"** → all unsettled tokens = `seen`.
- **"Doctor didn't attend → refund all unseen"** → all unsettled app-paid tokens = `refund`; walk-ins = `no_show`.

This sets a pending choice per token client-side; nothing is sent until the attender confirms. After bulk, the attender can override individual exceptions (Sub-Story 3).

---

### Sub-Story 3: Per-token override (exception handling)
**Story ID:** CF-002.3 · **Points:** 3 · **Effort:** 4h

```gherkin
As an attender
I want to change the outcome of individual tokens after a bulk choice
So that I can correct the few exceptions (e.g. 2 of 20 actually no-showed)
```
Each unsettled token row offers three outcomes: **Seen**, **No-show**, **Refund** (Refund hidden for walk-ins / unpaid). Reuse / extend `appointment-actions.tsx` so these appear **only for ended-schedule resolution mode**; the normal Start/Hold/No-Show/Complete buttons remain unchanged for active schedules. A confirm dialog shows the summary (X completed, Y no-show, Z refund, **₹ total**) before submitting.

---

### Sub-Story 4: Resolution endpoint (the new backend)
**Story ID:** CF-002.4 · **Points:** 5 · **Effort:** 6h

```gherkin
As the system
I want a single authoritative endpoint to settle an ended schedule's tokens
So that completed/no-show/refund outcomes are applied atomically without touching the live status flow
```
New `POST /api/schedules/:id/resolve-tokens` (attender / clinic_admin only). Body: an array of `{ appointmentId, outcome: 'seen' | 'no_show' | 'refund' }`. Server-side it:
1. Verifies the caller manages this schedule's doctor/clinic.
2. **Verifies the schedule has actually ended** server-side (`now > schedule.date + endTime`) — do not trust the client.
3. For each appointment, **only** if it is still `token_started` or `hold` (skip already-terminal rows):
   - `seen` → set `completed` (no refund).
   - `no_show` → set `no_show` (no refund), per policy.
   - `refund` → set `cancel` + call existing `processSingleAppointmentRefund()`.
4. Skips walk-ins / unpaid for `refund` (the refund helper already guards this).
5. Optionally marks the schedule settled (see Open Decision D) so the banner clears.
Returns a summary `{ completed, noShow, refunded, totalRefund }`.

---

### Sub-Story 5: Patient-facing final states
**Story ID:** CF-002.5 · **Points:** 2 · **Effort:** 2h

```gherkin
As a patient
I want my ended-schedule token to show a clear final status
So that I understand whether I was seen, missed, or refunded
```
No new patient code expected — `completed` / `no_show` / `cancel`+refund already drive existing patient "My Appointments" badges and the refund notification (`processSingleAppointmentRefund` already notifies). Verify the wording reads sensibly ("Refunded", "Completed", "Missed appointment"). Before resolution, the patient continues to see the existing `token_started` state (no "pending review" status is added in this story unless requested).

---

## Acceptance Criteria

### AC1: Banner appears only for ended + unsettled schedules
```gherkin
GIVEN a schedule whose end time has passed today
AND it has at least one token in token_started or hold
WHEN the attender opens their dashboard
THEN an "Action required" banner names the doctor and unsettled count
AND no banner appears for active schedules or fully-settled ended schedules
```

### AC2: Bulk "refund all unseen" settles every unsettled token in one action
```gherkin
GIVEN an ended schedule with 5 unsettled app-paid tokens and 1 walk-in
WHEN the attender chooses "Doctor didn't attend — refund all unseen" and confirms
THEN the 5 app-paid tokens are cancelled and refunded to wallets
AND the walk-in is marked no_show with no refund
AND each refunded patient receives a refund notification
```

### AC3: Bulk "mark all completed" closes tokens with NO refund
```gherkin
GIVEN an ended schedule with unsettled tokens where the doctor actually saw everyone
WHEN the attender chooses "Doctor saw everyone — mark all completed" and confirms
THEN every unsettled token becomes completed
AND no wallet refund is issued for any of them
```

### AC4: Per-token override works after a bulk choice
```gherkin
GIVEN the attender has bulk-selected "refund all unseen"
WHEN they change one token to "Seen" before confirming
THEN that token is completed with no refund
AND the remaining tokens are still refunded
```

### AC5: Refund total is shown before applying
```gherkin
GIVEN the attender has chosen outcomes for all unsettled tokens
WHEN the confirm dialog opens
THEN it shows counts of completed / no-show / refund and the total ₹ to be refunded
AND nothing is written to the DB until "Confirm & apply" is pressed
```

### AC6: Server rejects resolution on a non-ended schedule
```gherkin
GIVEN a schedule whose end time has NOT passed
WHEN POST /api/schedules/:id/resolve-tokens is called
THEN the server responds 400 and makes no changes
```

### AC7: Already-settled tokens are never double-processed
```gherkin
GIVEN a token already in completed / no_show / cancel
WHEN a resolve request includes it
THEN it is skipped (no duplicate refund, no status change)
AND processSingleAppointmentRefund's hasBeenRefunded guard prevents any double refund
```

### AC8: Active-schedule flow is unchanged
```gherkin
GIVEN an active (not ended) schedule
WHEN the attender uses the normal Start / Hold / No-Show / Complete buttons
THEN behaviour is identical to before this story
AND no resolution banner, bulk bar, or Refund-outcome button appears
```

### AC9: Walk-ins are never refunded
```gherkin
GIVEN a walk-in (cash, no patientId / isPaid false) token on an ended schedule
WHEN any resolution outcome is applied
THEN no wallet refund is created for it
```

### AC10: Authorisation
```gherkin
GIVEN a user who is not the attender/clinic_admin managing this schedule
WHEN they call POST /api/schedules/:id/resolve-tokens
THEN the server responds 403
```

---

## Technical Implementation

### Part 1: Backend resolution endpoint (6h)

**File:** `server/routes.ts` — add a NEW endpoint (do **not** edit the existing `/api/appointments/:id/status` block at 765–907).

Shape (illustrative — final code at implementation time):
```typescript
// POST /api/schedules/:id/resolve-tokens
app.post("/api/schedules/:id/resolve-tokens", async (req, res) => {
  if (!req.user || !['attender', 'clinic_admin'].includes(req.user.role)) return res.sendStatus(403);
  const scheduleId = parseInt(req.params.id);
  const { resolutions } = req.body; // [{ appointmentId, outcome: 'seen'|'no_show'|'refund' }]

  const schedule = await storage.getSpecificSchedule(scheduleId); // existing method
  if (!schedule) return res.status(404).json({ message: 'Schedule not found' });

  // Server-side "ended" check — combine schedule.date + schedule.endTime, compare to now.
  if (!isScheduleEnded(schedule)) {
    return res.status(400).json({ message: 'Schedule has not ended yet' });
  }
  // (authorise that req.user manages this doctor/clinic — reuse existing helper used elsewhere)

  const summary = { completed: 0, noShow: 0, refunded: 0, totalRefund: 0 };
  for (const { appointmentId, outcome } of resolutions) {
    const appt = await storage.getAppointment(appointmentId);
    if (!appt || appt.scheduleId !== scheduleId) continue;
    if (!['token_started', 'hold'].includes(appt.status)) continue; // skip terminal

    if (outcome === 'seen') {
      await storage.updateAppointmentStatus(appointmentId, 'completed', 'Resolved after schedule end — patient consulted');
      summary.completed++;
    } else if (outcome === 'no_show') {
      await storage.updateAppointmentStatus(appointmentId, 'no_show', 'Resolved after schedule end — patient did not attend');
      summary.noShow++;
    } else if (outcome === 'refund') {
      await storage.updateAppointmentStatus(appointmentId, 'cancel', 'Doctor unavailable — schedule ended');
      const r = await walletService.processSingleAppointmentRefund(appointmentId, 'Doctor unavailable — schedule ended', req.user!.id);
      if (r.refunded) { summary.refunded++; summary.totalRefund += r.refundAmount; }
    }
  }
  // Open Decision D: optionally storage.completeSchedule(scheduleId) here (status-only) so the banner clears.
  res.json(summary);
});
```

**Notes / cautions for implementation:**
- `storage.updateAppointmentStatus` is the same low-level setter used by the existing endpoint; confirm it does **not** itself enforce the transition table (the transition validation lives in the route, not the storage method — verify before relying on this). If it does validate, add a dedicated storage setter for resolution.
- `isScheduleEnded()` must correctly combine the schedule's **date** + **endTime** in the server timezone (the client currently computes this only for "today"). Get this right to avoid wrongly allowing/blocking.
- ETA: the live `/status` endpoint calls `ETAService` on complete. For an **ended** schedule ETA is irrelevant; the new endpoint should **skip** ETA calls (or guard them) — confirm skipping does not break anything downstream.

### Part 2: Frontend — banner + bulk bar + overrides (8h)

**File:** `client/src/pages/attender-dashboard.tsx`
- Add an `isScheduleEndedUnsettled(schedule)` helper (mirror the client `isEndTimePassed` logic already used in `patient-clinic-details.tsx` / `patient-dashboard.tsx`).
- Render the amber `<Alert>` banner (component already imported).
- Render the bulk-decision bar above the token rows for such schedules.
- Add `resolveTokensMutation` → `POST /api/schedules/:id/resolve-tokens`; on success invalidate `[\`/api/attender/${user?.id}/doctors/appointments\`]` and `["schedulesToday"]` (same keys other mutations already invalidate).
- Confirm dialog reuses existing `Dialog` components already imported.

**File:** `client/src/components/appointment-actions.tsx`
- Add an optional `resolutionMode` (+ chosen-outcome) path that renders **Seen / No-show / Refund** instead of the normal buttons. Guard so default behaviour is **unchanged** when `resolutionMode` is not set.

### Part 3: Verify patient states (2h)
- Manually confirm `completed` / `no_show` / `cancel`+refund render correctly on patient "My Appointments" and that the existing refund notification fires. No code expected; fix wording only if needed.

---

## File Summary

| File | Action | Approx. |
|------|--------|---------|
| `server/routes.ts` | **NEW** endpoint `POST /api/schedules/:id/resolve-tokens` (existing `/status` block untouched) | +50 lines |
| `server/storage.ts` | Possibly a small `isScheduleEnded` helper and/or a resolution-safe status setter if `updateAppointmentStatus` validates transitions | +0–25 lines |
| `client/src/pages/attender-dashboard.tsx` | Banner + bulk bar + `resolveTokensMutation` + confirm dialog | +120 lines |
| `client/src/components/appointment-actions.tsx` | Optional `resolutionMode` rendering Seen/No-show/Refund | +30 lines |
| `server/services/wallet.ts` | **No change** — `processSingleAppointmentRefund` reused as-is | 0 |

**Backend changes required:** one new endpoint; reuse of the existing refund service; possibly one small storage helper. **No schema change.** **No new table.**

---

## Breakage Analysis (will it break the existing flow?)

| Existing flow | Impact | Why |
|---|---|---|
| Per-token Start/Hold/No-Show/Complete on **active** schedules (`/status`) | **None** | That endpoint and its transition table are not edited; new logic lives in a separate endpoint. UI changes are gated on "ended + unsettled". |
| Mid-schedule emergency `cancel-with-refunds` | **None** | Untouched and unreferenced by the new endpoint. |
| Existing `processSingleAppointmentRefund` callers (patient self-cancel, attender cancel) | **None** | Function reused unmodified; `hasBeenRefunded` guard prevents double refunds. |
| Booking / ETA / walk-in reservation | **None expected** | New endpoint skips ETA for ended schedules; no booking paths touched. ⚠️ Verify ETA-skip assumption during implementation. |
| Schedule visibility / "ended" display (PRs #62–#66) | **None** | Those are read-side display guards; this adds a write-side settle action. |

**Residual risks to watch (call out, don't hide):**
1. **`updateAppointmentStatus` transition validation** — if the storage setter (not just the route) enforces `token_started → completed` as invalid, the `seen` outcome will fail. **Must verify first**; if so, add a dedicated resolution setter. *(This is the single most important thing to confirm before coding.)*
2. **Server-side "ended" calculation** — date + endTime + timezone must match the client's notion, or schedules get wrongly accepted/blocked.
3. **Concurrency** — two attenders resolving the same schedule; mitigated by the `token_started/hold`-only guard + `hasBeenRefunded` guard, but confirm.
4. **Schedule post-state (Open Decision D)** — if we don't mark the schedule settled, the banner could reappear until all tokens are terminal (acceptable) or we mark it completed (cleaner). Needs a product call.

---

## Open Decisions (need product/client answer before/at implementation)

- **A. No-show charge policy:** is `no_show` fully charged, partially charged, or refunded? (Affects whether `no_show` ever triggers a partial refund.)
- **B. Bulk default for walk-ins under "refund all unseen":** mark them `no_show` (assumed here) or `completed`?
- **C. Who can resolve:** attender only, or also clinic_admin? (Endpoint currently allows both.)
- **D. Schedule post-resolution state:** after all tokens settled, mark the schedule `completed` (status-only via `storage.completeSchedule`) so it disappears from "needs resolution", or leave as-is?
- **E. Does a "Pending review" patient status get added** before the attender resolves, or keep showing the existing `token_started`? (This story assumes the latter — no patient-side change.)

---

## UI Test Setup

| Field | Value |
|-------|-------|
| **App URL** | http://localhost:5001 |
| **Login as** | Attender (managing a doctor with a schedule) |
| **Test data** | A doctor schedule whose end time is in the **past today**, with several `token_started` appointments — at least one app-paid (`isPaid=true`) and one walk-in (no `patientId`). |
| **Reproduce gap** | Before this story: such tokens stay `token_started`, no refund. After: banner → bulk → confirm settles them. |
| **Verify refunds** | DB: check `wallet_transactions` / `appointment_refunds` rows created only for app-paid tokens; `appointments.hasBeenRefunded=true`. |
| **Non-UI checks** | AC6/AC7/AC9/AC10 via `curl` against `POST /api/schedules/:id/resolve-tokens` (ended check, double-process guard, walk-in exclusion, 403). |
| **Regression** | AC8 — confirm an **active** schedule's token buttons behave exactly as before. |

---

## Notes
- This story is **manual, attender-driven** by design — it encodes the agreed principle that the software flags but a **human decides**, so a consulted-but-unmarked patient is never silently auto-refunded.
- The refund engine is **reused, not rebuilt**; the new surface area is one endpoint + dashboard UI.
- **Confirm Residual Risk #1 (`updateAppointmentStatus` transition validation) before writing code** — it determines whether the `seen → completed` path needs a dedicated storage setter.
