# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ClinicFlow is a clinic appointment + token-queue management system: an Express/PostgreSQL backend and a React (Vite) SPA, also packaged as an Android app via Capacitor.

## Commands

```bash
npm run dev          # Dev server: Express + Vite middleware, HMR. tsx server/index.ts
npm run check        # TypeScript typecheck (tsc). There is NO test runner — see note below.
npm run build        # vite build (client → dist/public) + esbuild bundle (server → dist/index.js)
npm start            # Run production build (NODE_ENV=production node dist/index.js)
npm run build:android # vite build --mode capacitor + cap sync + cap build android

# Database (Drizzle, schema is shared/schema.ts)
npm run db:push      # Push schema to DB (dev) — no migration file
npm run db:generate  # Generate a SQL migration from schema changes
npm run db:migrate   # Apply migrations via tsx migrations/run.ts (used for prod)

# Seed / admin scripts (each is `tsx <file>`)
npm run create-super-admin | create-clinic-admin | create-test-doctor | create-test-patient
npm run seed-data | seed-policies | assign-doctor-to-attender | reset-password
```

There are **no automated tests** and no lint script. `npm run check` only runs `tsc`. Verification is manual: run the app and smoke-test via `curl` (per rule #9 below). Do not invent a test command.

Server listens on **port 5001** by default (`PORT` env overrides), auto-incrementing to the next free port if taken — see `findAvailablePort` in `server/index.ts`. (The README's "3000" is stale.)

## Architecture

**Stack:** React 18 + Wouter (routing) + TanStack Query + Tailwind/ShadCN on the client; Express + Passport (session auth) + Drizzle ORM + PostgreSQL on the server. Path aliases: `@/` → `client/src`, `@shared` → `shared`.

**Three layers, one shared schema:**
- `shared/schema.ts` — the single source of truth. Drizzle table defs + relations + `drizzle-zod` insert schemas + inferred TS types, all imported by both client and server. Add columns here first, then `db:generate`.
- `server/routes.ts` — **one ~4000-line file** registering every `/api/*` route. Pattern: validate (Zod) → call `storage` → return JSON.
- `server/storage.ts` — **one ~5300-line `storage` singleton** that is the entire DB-access layer. Almost all business logic and queries live here, not in services. This and `routes.ts` both far exceed the 600-line rule below; that rule describes the target, not the current reality. Don't refactor them unprompted, but don't grow them carelessly either.
- `server/services/` — narrower domain logic: `eta.ts` (queue ETA), `wallet.ts` (wallet/refunds), `notification.ts`, `sms.ts` (Twilio OTP).

**Auth is multi-modal** (`server/auth.ts`): passport-local username/password, **MPIN** (scrypt-hashed, with attempt lockout) for patients, **OTP-over-SMS** (Twilio) for phone-verified registration and forgot-MPIN, plus Firebase. Sessions are stored in Postgres (`connect-pg-simple`). Passwords and MPINs both use the `scrypt`+salt `hash.salt` format.

**Roles** — the canonical backend set (from `role ===` checks across server) is: `patient`, `doctor`, `attender`, `clinic_admin`, `super_admin`. ⚠️ The client is inconsistent: `client/src/App.tsx` `ProtectedRoute allowedRoles` also references `hospital_admin` and `clinicadmin`, which the backend never emits. Treat the backend five as authoritative and be careful when matching role strings.

**Core domain — token-based queue:** each appointment gets a sequential `tokenNumber` within a `doctorSchedule`. Status flows `token_started → in_progress → completed` (also `hold`, `pause`, `cancel`, `no_show`, `expired`). Attenders drive status; doctor arrival (`doctor_daily_presence`) triggers ETA recalculation and notification cascades. Walk-ins reserve tokens (`token_reservations`) that expire — a `setInterval` in `server/index.ts` calls `storage.expireStaleReservations()` every 60s. Cancellations/absences feed the wallet/refund system (`patient_wallets`, `wallet_transactions`, `appointment_refunds`).

**Client pages** are role-dashboard oriented (`client/src/pages/`), guarded by `ProtectedRoute`. Data fetching is React Query against `/api/*`; routing is Wouter. The same client builds for web and for Android (Capacitor, `mode === 'capacitor'` uses relative base path).

## Notes for future Claude
- Rule #8 below references `DriveEV-API.postman_collection.json`, but the repo's collection is `RouteMappy.postman_collection.json`. Both rules #8 and the Postman/Git-template wording appear carried over from another project — confirm intent with the user rather than silently following either name.
- `WARP.md` covers similar ground in more detail but includes generic/aspirational sections; prefer this file.

---

# ClinicFlow — Claude Development Rules

## Git Safety Rules

| Rule | Details |
|------|---------|
| Never run git write commands without asking | Applies to: add, commit, push, checkout, switch, branch, merge, rebase, reset, stash, cherry-pick, tag, restore |
| Before any git write command | 1. State the exact command, 2. State which branch, 3. Wait for confirmation |
| Read-only git commands | Allowed freely: status, log, diff, branch --show-current, remote -v |
| Never assume branch | Always confirm which branch before commit/push |
| Never stage files silently | Must list files and get approval first |

---

## Global Development Rules

| # | Rule | Summary |
|---|------|---------|
| 1 | File Size | No file >600 lines; split at 500 into utils/services; stop writing at 2000 lines |
| 2 | Folder Structure | routes/ = thin HTTP only; services/ = business logic; lib/ = singletons; utils/ = helpers |
| 3 | Code Style | Functional patterns, no nesting >3 levels, business logic never in routes/workers |
| 4 | Refactoring | Single-purpose functions; route handlers: validate → service → return |
| 5 | Documentation | One-line purpose comment at top of every file; typed inputs/outputs for all exports |
| 6 | Always Ask Before | New top-level folders, architecture decisions, refactors touching >3 files |
| 7 | Git Commits | NEVER commit unless explicitly asked — always wait for "commit" instruction |
| 8 | Postman Collection | Update DriveEV-API.postman_collection.json for every new endpoint |
| 9 | PR Review | Run /simplify, fix issues, smoke-test via curl before raising PR |

---

## Memory Rules

| Source | Rule |
|--------|------|
| feedback_never_kill_node.md | NEVER run `taskkill /F /IM node.exe` — kills all running Node apps |
| server process | Use `npx kill-port <port>` to stop the dev server, never kill all node processes |
