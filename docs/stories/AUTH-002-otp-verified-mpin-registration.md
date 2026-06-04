# User Story: OTP-Verified Patient Registration — Mobile OTP + MPIN Setup

**Story ID:** AUTH-002
**Epic:** Authentication & Security Enhancement
**Feature:** Patient self-registration verified by SMS OTP, followed by MPIN setup with a locked, prefilled mobile number
**Priority:** P1 (High)
**Effort:** 1.5 days (12 hours)
**Sprint:** Auth Hardening
**Status:** Ready for Development
**Depends On:** AUTH-001 (Multi-Portal Authentication System — `/patient-login`, `/patient-register`, MPIN endpoints)

---

## Story Overview

**As a** new patient
**I want** to register by proving I own my mobile number (via SMS OTP) and then set a 4-digit MPIN
**So that** I can securely log in with mobile + MPIN without anyone being able to register using my number

**As a** clinic administrator
**I want** every self-registered patient account to have a genuinely verified mobile number
**So that** appointment notifications, ETAs, and OTPs always reach the real account owner

---

## Why This Enhancement?

### Current Gap:
- `/patient-register` creates an account with **no phone verification at all** — `phoneVerified` is blindly set to `true` (`server/auth.ts:743`)
- Anyone can register any mobile number with their own MPIN, hijacking notifications for that number
- The `/auth` page still exposes a legacy **Register** tab (username + password) that also creates unverified patient accounts
- Patients are asked to invent a **username** they will never use (login is mobile + MPIN)

### Real-World Use Case (Number Squatting):
A person registers on `/patient-register` using a neighbour's mobile number and their own MPIN.
- The real owner of the number can never self-register ("mobile already registered")
- Appointment OTPs/notifications go to a number whose account is controlled by someone else
- The clinic admin must manually intervene to reset the MPIN

This cannot be prevented with the current implementation.

### Solution:
Extend the patient registration flow to be OTP-first:
- **OTP gate** — registration starts with mobile number entry; an SMS OTP (existing MDT service) must be verified before any account data is collected
- **Server-side binding** — the verified phone is stored in the express session; the register API refuses any phone that was not verified in that session (closes the direct-API bypass)
- **Prefilled, locked mobile** — after OTP verification the wizard continues with the mobile number prefilled and read-only
- **No username** — server auto-generates one (`patient<last-6-digits>`); patients never see it
- **Register tab removed** from `/auth`; the only patient self-registration path is the OTP-gated wizard
- **Backward compatible** — existing login flows (`/patient-login` MPIN, `/auth` Login + Mobile Login tabs) and existing endpoints stay live and unchanged

---

## User Personas

### Primary: Lakshmi — The First-Time Patient
- **Role:** Patient booking her first appointment from her phone
- **Goal:** Create an account in under two minutes and log in with a simple PIN afterwards
- **Pain Point:** "I don't want to remember another username and password — and I want to be sure nobody else can sign up with my number."

### Secondary: Ravi — The Clinic Administrator
- **Role:** Manages patient accounts and resolves login issues at the clinic
- **Goal:** Trust that every self-registered account's mobile number is real
- **Pain Point:** "I keep getting walk-ins whose number is 'already registered' by someone else, and I have to untangle it manually."

---

## Detailed Sub-Stories

### Sub-Story 1: Remove Register Tab from `/auth`

**Story ID:** AUTH-002.1
**Points:** 1 | **Effort:** 0.5 hours

```gherkin
As a clinic staff member or admin
I want the /auth page to show only Login and Mobile Login tabs
So that patient self-registration happens exclusively through the verified OTP flow
```

### Sub-Story 2: Verify-Only OTP Endpoint with Session Binding

**Story ID:** AUTH-002.2
**Points:** 3 | **Effort:** 2 hours

```gherkin
As the system
I want a registration OTP verification endpoint that verifies the code and remembers the phone in the server session
So that the subsequent account-creation request can be trusted without re-sending the OTP
```

### Sub-Story 3: Harden the Patient Register API

**Story ID:** AUTH-002.3
**Points:** 3 | **Effort:** 2 hours

```gherkin
As the system
I want /api/auth/patient/register to require a session-verified phone and to auto-generate the username
So that accounts can only be created for numbers proven via OTP, with no unused username field
```

### Sub-Story 4: Five-Step Registration Wizard

**Story ID:** AUTH-002.4
**Points:** 5 | **Effort:** 4 hours

```gherkin
As a new patient
I want a guided wizard: Mobile → OTP → Name → MPIN → Confirm MPIN
So that I verify my number once and finish registration with my mobile prefilled and locked
```

### Sub-Story 5: Error and Resend UX

**Story ID:** AUTH-002.5
**Points:** 2 | **Effort:** 1.5 hours

```gherkin
As a new patient
I want clear messages for already-registered numbers, wrong/expired OTPs, and a resend timer
So that I always know what went wrong and what to do next
```

### Sub-Story 6: End-to-End Testing and API Collection Update

**Story ID:** AUTH-002.6
**Points:** 2 | **Effort:** 2 hours

```gherkin
As a developer
I want the full flow tested with the mock SMS provider and the Postman collection updated
So that the feature is verifiable locally and the API surface is documented
```

---

## Acceptance Criteria

### AC1: Register Tab Removed
```gherkin
GIVEN I open /auth
WHEN the page renders
THEN I see exactly two tabs: "Login" and "Mobile Login"
AND no "Register" tab or registration form is reachable from this page
```

### AC2: Registration Starts with Mobile Entry
```gherkin
GIVEN I am on /patient-login
WHEN I click "Register here"
THEN I land on /patient-register at Step 1 of 5 asking only for my 10-digit mobile number
```

### AC3: OTP Sent to Unregistered Mobile
```gherkin
GIVEN I entered a valid 10-digit mobile number that is not registered
WHEN I tap "Send OTP"
THEN an SMS OTP is sent via the existing MDT SMS service
AND the wizard advances to Step 2 showing a 6-digit OTP input and a 60-second resend countdown
```

### AC4: Already-Registered Mobile Blocked
```gherkin
GIVEN I entered a mobile number that already has an account
WHEN I tap "Send OTP"
THEN no OTP is sent
AND I see the error "This mobile number is already registered. Please login using your MPIN."
AND a "Go to Login" action takes me back to /patient-login
```

### AC5: Wrong or Expired OTP Rejected
```gherkin
GIVEN an OTP was sent to my mobile
WHEN I enter a wrong code, or a code older than 10 minutes
THEN I see "Invalid or expired OTP" and remain on Step 2
AND after 5 wrong attempts the code is rejected with "Too many attempts. Please request a new OTP"
```

### AC6: Resend Cooldown
```gherkin
GIVEN I am on the OTP step
WHEN fewer than 60 seconds have passed since the last send
THEN the "Resend OTP" button is disabled and shows the remaining seconds
AND after the countdown ends I can resend (server still enforces its own cooldown)
```

### AC7: Verified Phone Is Prefilled and Locked
```gherkin
GIVEN I entered the correct OTP
WHEN the wizard advances to Step 3 (Name)
THEN my verified mobile number is displayed prefilled and read-only for the rest of the wizard
AND no username field is shown anywhere in the flow
```

### AC8: MPIN Set and Confirmed
```gherkin
GIVEN I entered my name and a 4-digit MPIN on Step 4
WHEN I enter a non-matching confirmation on Step 5
THEN I see "MPINs don't match" and cannot submit
AND when both match the account is created
```

### AC9: Post-Registration Redirect and Login
```gherkin
GIVEN my registration succeeded
WHEN the success message is shown
THEN I am redirected to /patient-login
AND I can immediately log in with my mobile number and new MPIN
```

### AC10: Direct API Bypass Blocked
```gherkin
GIVEN no OTP was verified in my server session (or it was verified more than 15 minutes ago)
WHEN POST /api/auth/patient/register is called with any mobile number
THEN the server responds 403 "Mobile number not verified. Please complete OTP verification first."
AND no account is created
```

### AC11: Deep-Link Always Starts at Step 1
```gherkin
GIVEN I navigate directly to /patient-register in a fresh tab
WHEN the page loads
THEN the wizard always starts at Step 1 (mobile entry)
AND I cannot reach the Name/MPIN steps without completing OTP verification in this visit
```

### AC12: Backward Compatibility
```gherkin
GIVEN the feature is deployed
WHEN existing users use /patient-login (mobile + MPIN) or /auth (Login, Mobile Login tabs)
THEN those flows behave exactly as before
AND the legacy endpoints /api/register, /api/register/verify-otp, /api/auth/request-otp and /api/auth/verify-otp remain live and unchanged
```

---

## Technical Implementation

### Part 1: Remove Register Tab (0.5 hours)

#### Task 1.1: Trim `/auth` to Two Tabs

**File:** `client/src/pages/auth-page.tsx`

Remove the Register `TabsTrigger`/`TabsContent` (lines 69, 80-82), the entire `RegisterForm` component (lines 147-260), the `registerSchema`/`RegisterData` definitions (lines 27-39), and now-unused imports. Change the tab grid:

```tsx
<TabsList className="grid w-full grid-cols-2">
  <TabsTrigger value="login">Login</TabsTrigger>
  <TabsTrigger value="mobile-login">Mobile Login</TabsTrigger>
</TabsList>
```

### Part 2: Verify-Only OTP Endpoint (2 hours)

#### Task 2.1: Session Type Extension

**File:** `server/auth.ts`

```typescript
declare module "express-session" {
  interface SessionData {
    registrationPhone?: string;        // OTP-verified phone for pending registration
    registrationVerifiedAt?: number;   // epoch ms, valid for 15 minutes
  }
}
```

#### Task 2.2: `POST /api/register/verify-phone`

**File:** `server/auth.ts` (add beside `/api/register/verify-otp`, line 386)

Reuses the existing storage helpers (`getValidOtp`, `incrementOtpAttempts`, `markOtpAsVerified`) but does **not** create a user — it only marks the session:

```typescript
// Verify registration OTP only — binds the verified phone to the session (AUTH-002)
app.post("/api/register/verify-phone", async (req, res) => {
  try {
    let { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ message: "Phone number and OTP are required" });
    }
    phone = phone.replace(/\D/g, "");
    if (phone.length > 10) phone = phone.slice(-10);

    const otpRecord = await storage.getValidOtp(phone, otp);
    if (!otpRecord) {
      return res.status(401).json({ message: "Invalid or expired OTP" });
    }
    if (otpRecord.verificationAttempts >= 5) {
      return res.status(429).json({ message: "Too many attempts. Please request a new OTP" });
    }
    await storage.incrementOtpAttempts(otpRecord.id);
    await storage.markOtpAsVerified(otpRecord.id);

    req.session.registrationPhone = phone;
    req.session.registrationVerifiedAt = Date.now();

    res.json({ verified: true, phone });
  } catch (error) {
    console.error("Registration phone verification error:", error);
    res.status(500).json({ message: "Failed to verify OTP" });
  }
});
```

The send step reuses `POST /api/register/request-otp` (`server/auth.ts:336`) unchanged — it already rejects registered numbers and rate-limits. Only its 400 message changes (Task 3.2).

### Part 3: Harden the Register API (2 hours)

#### Task 3.1: Session Guard + Auto-Username in `/api/auth/patient/register`

**File:** `server/auth.ts` (lines 689-757)

Request body becomes `{ name, mobileNumber, mpin }` (no `username`). After format validation, add:

```typescript
// AUTH-002: phone must have been OTP-verified in this session within 15 minutes
const verifiedPhone = req.session.registrationPhone;
const verifiedAt = req.session.registrationVerifiedAt ?? 0;
const VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
if (verifiedPhone !== mobileNumber || Date.now() - verifiedAt > VERIFICATION_WINDOW_MS) {
  return res.status(403).json({
    message: "Mobile number not verified. Please complete OTP verification first.",
  });
}
```

Auto-generate the username (collision-safe), replacing the username checks at lines 700-718:

```typescript
let username = `patient${mobileNumber.slice(-6)}`;
if (await storage.getUserByUsername(username)) {
  username = `patient${mobileNumber.slice(-6)}${randomBytes(2).toString("hex")}`;
}
```

On success, clear the session flags so the verification cannot be reused:

```typescript
delete req.session.registrationPhone;
delete req.session.registrationVerifiedAt;
```

#### Task 3.2: Already-Registered Message

**File:** `server/auth.ts:351` (in `/api/register/request-otp`) and `server/auth.ts:723` (in `/api/auth/patient/register`)

```typescript
return res.status(400).json({
  message: "This mobile number is already registered. Please login using your MPIN.",
  code: "ALREADY_REGISTERED",
});
```

### Part 4: Five-Step Wizard (4 hours)

#### Task 4.1: Rework `/patient-register`

**File:** `client/src/pages/auth/patient-register.tsx`

New step map (wizard state is in-memory only, so a fresh page load always starts at Step 1 — satisfies AC11):

| Step | Title | API call on Next |
|------|-------|------------------|
| 1 | Mobile number | `POST /api/register/request-otp` `{ phone }` |
| 2 | Enter OTP (6 digits, resend w/ 60s countdown) | `POST /api/register/verify-phone` `{ phone, otp }` |
| 3 | Full name (mobile shown read-only) | — |
| 4 | Set MPIN (existing keypad) | — |
| 5 | Confirm MPIN | `POST /api/auth/patient/register` `{ name, mobileNumber, mpin }` |

Schema changes — drop `username`, add `otp`:

```typescript
const patientRegisterSchema = z.object({
  mobileNumber: z.string().length(10).regex(/^\d{10}$/, "Mobile number must contain only digits"),
  otp: z.string().length(6, "OTP must be 6 digits").regex(/^\d{6}$/),
  name: z.string().min(2, "Name is required"),
  mpin: z.string().length(4).regex(/^\d{4}$/),
  confirmMpin: z.string().length(4).regex(/^\d{4}$/),
}).refine((d) => d.mpin === d.confirmMpin, { message: "MPINs don't match", path: ["confirmMpin"] });
```

Reuse the OTP digit-boxes pattern from `MobileLoginForm` (`client/src/pages/auth-page.tsx:483-531`) and the 60-second countdown pattern (`auth-page.tsx:287-294`). Keep the existing `Progress` bar (`value={(currentStep / 5) * 100}`) and the existing MPIN keypad handlers unchanged.

On `ALREADY_REGISTERED` error, render the message with a "Go to Login" button navigating to `/patient-login` (AC4).

#### Task 4.2: Read-Only Mobile Display

From Step 3 onward, render the verified number as a disabled input with a lock icon:

```tsx
<Input value={form.getValues("mobileNumber")} readOnly disabled className="bg-muted" />
```

### Part 5: Error and Resend UX (1.5 hours)

- Map server responses: 401 → "Invalid or expired OTP", 429 → show server cooldown/attempts message, 403 (register) → restart wizard at Step 1 with a toast "Verification expired — please verify your number again"
- Resend button: disabled while countdown > 0, re-calls `request-otp`, resets countdown to 60

### Part 6: Testing + Collection (2 hours)

- Run locally with `MDT_SMS_MOCK=true` (OTP prints to server console) and walk all 12 ACs
- curl checks for AC10: call `/api/auth/patient/register` with and without a verified session cookie
- Add `POST /api/register/verify-phone` and the changed register body to `RouteMappy.postman_collection.json`

---

## File Summary

| File | Action | Approximate Lines |
|------|--------|-------------------|
| `client/src/pages/auth-page.tsx` | Modify — remove Register tab, `RegisterForm`, `registerSchema`, unused imports | −120 lines |
| `client/src/pages/auth/patient-register.tsx` | Modify — 3-step → 5-step wizard, OTP steps, drop username, locked mobile | +180 / −60 lines |
| `server/auth.ts` | Modify — session typing, `verify-phone` endpoint, register guard + auto-username, error messages | +75 / −20 lines |
| `RouteMappy.postman_collection.json` | Modify — add `verify-phone`, update register request body | +40 lines |

**No database changes** — `otp_verifications` table and `users.mpin*` columns (migration 0031) already exist. Legacy endpoints (`/api/register`, `/api/register/verify-otp`, Firebase verify) remain live and untouched per scope decision.

---

## UI Test Setup

| Field | Value |
|-------|-------|
| **App URL** | http://localhost:5001 |
| **Test Route** | `/patient-register` (entry via "Register here" on `/patient-login`); `/auth` for AC1 |
| **Login as** | None — registration is a public flow. For AC9, log in as the newly created patient (mobile + MPIN) |
| **Test Data** | Run dev server with `MDT_SMS_MOCK=true` — OTP codes print to the server console. Use a fresh 10-digit mobile not present in `users`; reuse an existing patient's number for AC4 |
| **Non-testable ACs** | AC10 — API-level only, verify via curl with/without the session cookie; AC12 (endpoint liveness part) — verify via curl |
