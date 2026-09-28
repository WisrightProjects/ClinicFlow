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
npm run db:push         # Push schema to DB (dev only) — no migration file
npm run db:generate     # Generate a SQL migration from schema changes
npm run db:migrate      # Apply migrations in DEV — tsx migrations/run.ts
npm run db:migrate:prod # Apply migrations in PROD — node migrations/run.js (plain JS, no tsx)
npm run db:baseline     # Mark all existing migrations applied WITHOUT running them

# Seed / admin scripts (each is `tsx <file>`)
npm run create-super-admin | create-clinic-admin | create-test-doctor | create-test-patient
npm run create-attender | assign-doctor-to-attender | reset-password
npm run seed-data | seed-policies | add-chennai-hospitals
```

`npm start` uses POSIX `NODE_ENV=... node` syntax — it fails in PowerShell; run it through the Bash tool (or set the env var separately).

**Verification.** There are **no automated tests** and no lint script; `npm run check` only runs `tsc`. Do not invent a test command. Two things to know before trusting it:
- It does **not** pass on a clean `main` — ~79 pre-existing errors (server/storage.ts 30, routes.ts 17, auth.ts 7, services/eta.ts 7, seed-data.ts 6, shared/schema.ts 4, rest scattered). Treat it as a *delta* check: record the count before your change and make sure you didn't add to it.
- `tsconfig.json` includes only `server/**/*` and `shared/**/*`, so **the client is never typechecked**, and it compiles with `"module": "commonjs"` even though the package is ESM (`"type": "module"`) — which is where the `import.meta` error in `server/vite.ts` comes from. A clean `npm run check` says nothing about `client/`.

Real verification is manual — run the app and smoke-test via `curl` (per rule #9 below).

**Ports.** Dev listens on **5001** by default (`PORT` overrides), auto-incrementing to the next free port if taken — see `findAvailablePort` in `server/index.ts`. The Docker image sets `PORT=3000` and `EXPOSE 3000`, so 3000 is correct *in the container* (the README's "3000" for local dev is still stale).

## Architecture

**Stack:** React 18 + Wouter (routing) + TanStack Query + Tailwind/ShadCN on the client; Express + Passport (session auth) + Drizzle ORM + PostgreSQL on the server. Path aliases: `@/` → `client/src`, `@shared` → `shared`.

**Three layers, one shared schema:**
- `shared/schema.ts` — the single source of truth. Drizzle table defs + relations + `drizzle-zod` insert schemas + inferred TS types, all imported by both client and server. Add columns here first, then `db:generate`.
- `server/routes.ts` — **one ~4000-line file** registering every `/api/*` route. Pattern: validate (Zod) → call `storage` → return JSON.
- `server/storage.ts` — **one ~5300-line `storage` singleton** that is the entire DB-access layer. Almost all business logic and queries live here, not in services. This and `routes.ts` both far exceed the 600-line rule below; that rule describes the target, not the current reality. Don't refactor them unprompted, but don't grow them carelessly either.
- `server/services/` — narrower domain logic: `eta.ts` (queue ETA), `wallet.ts` (wallet/refunds), `payment.ts` (booking payment), `schedule-resolution.ts` (settling an ended schedule's leftover tokens), `notification.ts`, `sms.ts` (Twilio OTP).
- `shared/pricing.ts` — booking-fee constants and payment enums shared by client and server.

**Auth is multi-modal** (`server/auth.ts`): passport-local username/password, **MPIN** (scrypt-hashed, with attempt lockout) for patients, **OTP-over-SMS** (Twilio) for phone-verified registration and forgot-MPIN, plus Firebase. Sessions are stored in Postgres (`connect-pg-simple`). Passwords and MPINs both use the `scrypt`+salt `hash.salt` format.

**Roles** — the canonical backend set (from `role ===` checks across server) is: `patient`, `doctor`, `attender`, `clinic_admin`, `super_admin`. ⚠️ The client is inconsistent: `client/src/App.tsx` `ProtectedRoute allowedRoles` (lines ~51–69) also references `hospital_admin` and `clinicadmin`, which the backend never emits. Treat the backend five as authoritative and be careful when matching role strings.

**Core domain — token-based queue:** each appointment gets a sequential `tokenNumber` within a `doctorSchedule`. Status flows `token_started → in_progress → completed` (also `hold`, `pause`, `cancel`, `no_show`, `expired`). Attenders drive status; doctor arrival (`doctor_daily_presence`) triggers ETA recalculation and notification cascades. Walk-ins reserve tokens (`token_reservations`) that expire — a `setInterval` in `server/index.ts` calls `storage.expireStaleReservations()` every 60s. Cancellations/absences feed the wallet/refund system (`patient_wallets`, `wallet_transactions`, `appointment_refunds`). Once a schedule's end time passes, `services/schedule-resolution.ts` settles the leftovers: `seen → completed` (no refund), `no_show` (no refund), `refund → cancel` + wallet refund.

**Payments (newest area, Phase 1).** `shared/pricing.ts` holds the flat ₹20 platform fee + 5% GST; **the server is the authority** — the client calls `GET /api/booking/fee` to display the breakdown and never sends an amount back. `ONLINE_PAYMENT_MODE` (env) selects `dummy` (default — simulated, books the token without collecting money), `off` (option rejected server-side), or `live` (real gateway, **not implemented**; `payment.ts` deliberately treats it as `off` rather than booking for free). Simulated (`gateway: 'dummy'`) payments must never turn into real wallet money — that guard lives in `server/services/payment.ts`. Rows land in the `payments` table (migration 0037).

**Push notifications.** `server/firebase-admin.ts` sends FCM to tokens in `device_tokens` (migration 0036). It loads credentials from `FIREBASE_SERVICE_ACCOUNT` (raw JSON *or* base64) in preference to `server/firebase-service-account.json`, because the git-ignored key file is wiped on every Coolify redeploy. `services/notification.ts` maps each notification type to the in-app deep-link route the push should open.

**Migrations are hand-rolled, not drizzle-kit's runner** (`migrations/run.js` / `run.ts`). Both apply every `*.sql` in `migrations/` in **filename sort order**, skip files containing `rollback`, and record each in a `migrations` table. Things that bite:
- `db:migrate` (tsx) is dev-only; production must use `db:migrate:prod` (plain JS) because the image installs with `--omit=dev` and tsx isn't present there. The `migrations/` folder also has to be `COPY`'d into the image — omitting it is how `device_tokens` and `payments` both reached production unmigrated.
- `db:baseline` records all migrations as applied without executing them. Run it once against a DB that was built with `db:push`; the older migrations are **not** idempotent, so replaying them breaks.
- Numbering already collides (two each of `0000_`, `0002_`, `0004_`, `0012_`, plus a stray `002_`), and sort order is what actually decides execution — pick a new prefix carefully.
- `server/migrations/007_admin_configurations.sql` sits outside the runner's directory and therefore **never runs**.

**Client data fetching.** `client/src/lib/queryClient.ts` sets an app-wide default `queryFn` that treats `queryKey[0]` as the URL and fetches with `credentials: "include"` — so most queries are just `useQuery({ queryKey: ["/api/..."] })`. Defaults are `staleTime: Infinity`, `refetchOnWindowFocus: false`, `refetchInterval: false`, `retry: false`: **nothing ever auto-refetches**, so any mutation must explicitly `invalidateQueries` or the UI goes stale.

**Client pages** are role-dashboard oriented (`client/src/pages/`), guarded by `ProtectedRoute`. Routing is Wouter. The same client builds for web and for Android (Capacitor: `mode === 'capacitor'` sets Vite `base` to `./` for relative asset paths). Several near-duplicate pages exist (`clinic-admin-dashboard` vs `-fixed`, `attender-dashboard` vs `simple-attender-dashboard`) — check `App.tsx` for which one is actually routed before editing.

## Notes for future Claude
- Rule #8 below references `DriveEV-API.postman_collection.json`, but the repo's collection is `RouteMappy.postman_collection.json`. Both rules #8 and the Postman/Git-template wording appear carried over from another project — confirm intent with the user rather than silently following either name.
- `.cursor/rules/*.mdc` and `.windsurfrules` (950 lines) are **Task Master AI template scaffolding**, not ClinicFlow rules — there is no `tasks.json` in the repo, and the `list` / `generate` / `parse-prd` npm scripts point at that same unused `scripts/dev.js`. Don't follow them and don't import them here.
- `WARP.md` covers similar ground in more detail but includes generic/aspirational sections; prefer this file.
- The root `README.md` contains a plaintext production `DATABASE_URL` (with password) and default test-account passwords. Don't copy either into code, docs, or commits.

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
