# Field Sales & Beat Execution

A company-scoped Android app and API for distributor field teams. Pilot company: **Sri Ramana Traders**.

## Project Overview

A **beat** is a shop's fixed daily route. Marketing Executives work through that route, record one outcome per shop — an order or a no-order — and the server independently measures and stores how far the device was from the shop's approved coordinates at the moment of submission.

**The business problem is visit authenticity.** Paper registers and self-reported visits cannot distinguish a shop that was genuinely visited from one that was recorded from somewhere else, and that uncertainty poisons every number built on top of it — coverage, order rates, and ultimately pay. This system replaces the register with records whose provenance is measured rather than asserted.

It **flags, it never blocks, and it never accuses.** A visit outside the radius still saves; it simply appears in a manager's review queue.

### Key capabilities

| Capability | Who |
|---|---|
| Run the daily beat — start, visit, record an outcome, end | Marketing Executive |
| Capture a shop's location, accuracy-gated | Marketing Executive |
| Add an unplanned shop to today, without touching the beat plan | Executive, Manager |
| Previous-day report, visit review, mark orders delivered | Manager |
| Daily attendance with derived lateness and append-only amendments | Manager |
| Masters — users, shops, beat plans, brands, reasons | Company Admin |
| Company-wide visit history | Company Admin |
| Monthly salary run with versioned locking and PDF payslips | Company Admin |

### Roles

Five, one per user per company in release 1:

- **System Admin** — platform-level, API only, no mobile screens
- **Company Admin** — masters, reports, salary
- **Manager** — attendance, daily review, extra shops
- **Marketing Executive** — runs the beat
- **Employee** — attendance and pay subject only, **no login**

> **A rule that is enforced structurally, not by hiding UI:** a Marketing Executive is **never** shown `distanceMeters`, `isExceedRange` or quality flags, in any screen or any API response. The executive's history is a separate route backed by a separate projection from the manager's, so neither can acquire the other's fields through a refactor of one.

**Source of truth** is `docs/product/` — `01-BRD.md` (business requirements), `02-PRD.md` (screen-by-screen behaviour), `03-ARCHITECTURE.md` (decisions, schema, API surface). This README is a map; those documents win on anything non-trivial.

---

## Technology Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5.6 |
| API | NestJS 11, `nestjs-zod`, Prisma 6 |
| Database | PostgreSQL (schema + **row-level security**) |
| Mobile | React Native 0.87, React 19, **Android only** |
| Navigation | React Navigation 7 (native stack) |
| Styling | NativeWind 4 + explicit inline styles from the design boards |
| Auth | JWT (HS512) access + rotating refresh, Argon2 password hashing |
| Validation | Zod, shared between API and app |
| Logging | Pino (`nestjs-pino`) with a redaction list |
| PDF | `pdfkit`, server-side only |
| Monorepo | pnpm workspaces + Turborepo |
| Hosting | Railway (API, Postgres, volume for photos) |

**One contract.** Request and response shapes are defined once in `packages/shared` with Zod; the API derives DTOs via `nestjs-zod` and the app derives its types from the same schemas.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | **≥ 22** | enforced by `engines`; developed on 24.x |
| pnpm | **12.8.1** | pinned via `packageManager` — use `corepack enable` |
| PostgreSQL | 14+ | developed against 18.x |
| JDK | **17+** | for the Android build; developed on 21 |
| Android SDK | **compileSdk 37**, targetSdk 36 | Android Studio or `cmdline-tools` |
| Android device/emulator | **minSdk 24** (Android 7) | a **physical device** is needed for anything touching GPS or the camera |

`adb` must be on your `PATH`. There is no iOS target.

---

## Project Structure

```text
apps/
  api/                         NestJS API
    prisma/
      schema.prisma            every model, enum and index
      migrations/              hand-written SQL (see Troubleshooting)
      seed.ts                  roles, permissions, first System Admin
    scripts/generate-openapi.ts
    src/
      common/                  decorators, filters, guards, interceptors, pipes
      infra/                   prisma (+ tenant extension), time, storage,
                               security, logging, sms
      modules/                 one folder per aggregate:
                               auth, companies, users, roles, me, masters,
                               shops, beat-plans, assignments, visits,
                               attendance, reports, salary, files
  mobile/                      React Native app
    android/                   native project; product flavors = companies
    src/
      api/                     HTTP client, idempotency keys
      components/              shared UI (bottom bars, icons)
      features/                admin · manager · executive · auth · profile
      lib/                     location, outbox, permissions, secure session
      navigation/              one stack per role
      config.ts                build-time company config

packages/
  shared/                      Zod schemas, error codes, env validation
  config/                      shared ESLint/TS config

docs/
  product/                     BRD, PRD, ARCHITECTURE — the source of truth
  ui-design/                   Field_Sales_Beat_App.html — 37 design boards
  openapi.json                 generated, committed
  coding_standard.md           see the caveat in Coding Standards

specs/                         Spec Kit slices, 001 … 012
```

**Module boundaries follow aggregates, not layers.** A module owns a thing that changes together — `attendance` owns its versioning rules, `salary` owns its lock — rather than being a horizontal slice of controllers or services.

---

## Getting Started

```bash
git clone git@github.com:rajasekari2i/employee-marketing.git
cd employee-marketing

corepack enable
pnpm install
```

Create the database and the two roles the API needs:

```bash
createdb field_sales
```

The runtime role must be **non-superuser and not the table owner** — RLS is bypassed entirely for superusers and, without `FORCE`, for owners. Migration `20261002110942_rls_user_fileobject` creates `app_user` for this.

```bash
cp apps/api/.env.example apps/api/.env       # then fill in real values
cp apps/mobile/.env.example apps/mobile/.env.dev

DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma db seed
pnpm --filter @field-sales/shared build
```

`pnpm --filter @field-sales/shared build` matters more than it looks: the API imports `@field-sales/shared` from its **built** `dist`, so a schema added but not rebuilt fails to resolve with a confusing "has no exported member".

---

## Environment Configuration

### `apps/api/.env`

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Runtime** connection as `app_user`. Must not be a superuser or the table owner, or RLS is silently bypassed. |
| `MIGRATE_DATABASE_URL` | **DDL** connection. Prisma reads only `DATABASE_URL`, so substitute this when migrating (below). |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Distinct, 32+ characters each |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `60d` |
| `FILE_URL_SECRET` | HMAC for signed file and payslip URLs |
| `PASSWORD_RESET_SECRET` | HMAC for reset tokens |
| `RAILWAY_VOLUME_MOUNT_PATH` | Photo storage root |
| `SEED_SYSTEM_ADMIN_USERNAME` / `_PASSWORD` | First System Admin, used by the seed |
| `LOG_LEVEL`, `PORT` | `info`, `3000` |

Validation rules live in `packages/shared/src/env.ts` — the API refuses to boot on a missing or malformed value rather than failing later.

### `apps/mobile/.env.<flavor>`

**One build per company** (Architecture D-08), so the company code is baked in rather than typed at login:

| Variable | Purpose |
|---|---|
| `APP_NAME` | Launcher label |
| `COMPANY_CODE` | Identifies the company — **not** a login field |
| `COMPANY_NAME` | Shown in the app |
| `API_URL` | e.g. `http://localhost:3000/api/v1` |
| `GOOGLE_MAPS_API_KEY` | Map tiles; empty in dev (see Troubleshooting) |

Flavors are `dev` and `srt`, declared in `android/app/build.gradle`. `.env.<flavor>` files are gitignored; `dotenv.gradle` turns them into `BuildConfig` fields that `react-native-config` reads, surfaced to JS by `src/config.ts`.

### Secrets

`.env*` files are gitignored and must stay that way. Production secrets live in Railway's environment, never in the repo. No secret, token, password, precise coordinate or free-text reason may appear in a log line — the Pino redaction list exists for exactly this.

---

## Run Locally

```bash
pnpm dev          # turbo: API (watch) + Metro, both persistent
```

Or individually:

```bash
pnpm --filter api dev
pnpm --filter mobile start
```

Build and install the Android app:

```bash
pnpm --filter mobile android        # dev flavor
pnpm --filter mobile android:srt    # Sri Ramana Traders flavor
```

### The step that is easy to forget

```bash
adb reverse tcp:3000 tcp:3000      # API
adb reverse tcp:8081 tcp:8081      # Metro
adb reverse --list                 # verify
```

On the phone `localhost` means *the phone*. `react-native run-android` recreates the 8081 tunnel automatically but **nothing recreates 3000** — and the app reports a lost tunnel as *"No internet connection"*, because a failed `fetch` cannot tell the two apart. Re-run after every unplug, device reboot or `adb kill-server`.

### Other commands

```bash
pnpm build                                  # all packages
pnpm lint                                   # eslint --fix across the workspace
pnpm --filter api generate:openapi          # regenerate docs/openapi.json
pnpm --filter api exec prisma studio        # browse the database
```

---

## Background Jobs

**None are built yet.** `@nestjs/schedule` is not a dependency and no job runs anywhere in the codebase. This is stated explicitly because `03-ARCHITECTURE.md` §14 specifies a full set, and their absence changes how the system behaves today:

| Planned job | Status | What happens instead |
|---|---|---|
| `materialise-assignments` (00:05) | **not built** | A day is created **on read**, when the executive first opens the app. An executive who never opens it has no row for that day. |
| `beat-not-started-reminder` | not built | No reminder is sent. |
| `beat-not-ended-reminder` | not built | No reminder is sent. |
| `auto-close-beat-days` | not built | `AUTO_CLOSED` has no writer; a forgotten beat stays `RUNNING`. |
| `salary-draft` (monthly) | not built | The admin generates the run by hand from board 4.13. |
| `cleanup`, `photo-backup` | not built | Expired tokens and idempotency keys are not pruned. |

When these land they will call the same services the request path already uses; the service bodies do not need to change.

---

## Testing

> **There are currently no automated tests, by explicit standing instruction** recorded in `CLAUDE.md`. This overrides `03-ARCHITECTURE.md` §19's testing strategy (Vitest unit tests, Jest + Testcontainers integration tests). There is no test runner, no test script and no `*.spec.ts` file in the repository.

**Verification is the per-slice `quickstart.md`** — `specs/<slice>/quickstart.md` — a numbered scenario list run against a real device and a real database. Each one states what to expect and which requirement it covers, and marks the scenarios that must not be skipped.

What stands in for a test suite today:

```bash
pnpm lint                                        # eslint + prettier, workspace-wide
pnpm build                                       # compiles every package
pnpm --filter api exec tsc --noEmit              # API typecheck
pnpm --filter mobile exec tsc --noEmit           # app typecheck
```

Strict TypeScript with no `any` is doing a large share of the work that tests would otherwise do. **Treat a clean typecheck as necessary, not sufficient** — the two defects found in the salary slice (a `@Public()` route blocked by RLS, and a rupee glyph missing from the PDF font) both typechecked perfectly and were caught only by exercising the endpoint.

When the policy changes, `03-ARCHITECTURE.md` §19 is the plan to implement.

---

## Coding Standards

```bash
pnpm lint          # eslint --fix, prettier via eslint-plugin-prettier
```

Config is shared from `packages/config`. Strict TypeScript; `any` is not permitted.

### Architecture rules

These are non-negotiable and apply to every slice. The full text is in `CLAUDE.md` and `03-ARCHITECTURE.md` §21.

1. **The server owns the truth.** Distances, flags, totals, payable units, salary figures and audit records are always server-computed. A client-sent value for any of them is **rejected by schema validation** (`.strict()`), never silently ignored.
2. **Tenant isolation, two independent layers.** A Prisma client extension injects and filters `companyId` from CLS request context (never from client input); Postgres RLS with `FORCE ROW LEVEL SECURITY` enforces it again inside the same transaction. A new tenant table missing either layer must fail CI.
3. **Commands are idempotent.** Every state-changing `POST` takes an `Idempotency-Key`, minted on the device so a timeout-retry carries the same key.
4. **History is append-only.** Attendance amendments, salary corrections and pin changes create new versioned rows with a reason and an actor — never an overwrite. Daily assignment snapshots are frozen at creation.
5. **One contract.** Zod schemas in `packages/shared`, used by both sides.
6. **Role visibility is structural.** See the executive/range-fields rule above.
7. **The field app assumes a bad network.** Writes queue in an outbox and sync FIFO with the same idempotency key; reads are never queued — they fall back to what was last loaded, with a visible "not fresh" note.
8. **Times are UTC in storage, company-local in meaning.** Only `CompanyClock` converts, and it is the only place that knows what a day, week or month is.
9. **No secret, token, password, precise coordinate or free-text reason in any log line.**
10. **Every slice ships a migration, an API and the screens that use it.** "Backend done, UI later" is not a slice.

### UI fidelity

Every mobile screen must match its board in `docs/ui-design/Field_Sales_Beat_App.html` **exactly** — colours, spacing, typography, icon paths, radii, layout. Approximating with framework defaults is not acceptable; if matching needs a new dependency, add it.

That file is a compressed design-tool export, so **decode a board rather than grepping it**. The recipe is in `CLAUDE.md`. The per-board markup is the `__bundler/template` entry — the JavaScript assets are identical across every board and tell you nothing.

### `docs/coding_standard.md` — caveat

Apply its general TypeScript/NestJS/Prisma rules. **Ignore its module list and its "ProjectEstimation API" framing**: they belong to a different project. Two concrete divergences: this project validates with Zod and `nestjs-zod` (not `class-validator`), and money is `Decimal`, not integer minor units.

---

## Security

### Authentication

- **Username + password only.** The company comes from the build config, not a login field, so usernames are unique *within* a company rather than globally.
- **Argon2** password hashing (`src/infra/security/password.ts`).
- **Access JWT, HS512, 15 minutes.** Carries `sub`, `companyId`, `role`, `permissions` and `ver`.
- **Rotating refresh tokens, 60 days, with reuse detection** — replaying a used refresh token revokes its whole family.
- **`tokenVersion`** invalidates every outstanding access token for a user without a per-request database lookup.
- **Login throttling** via `login-throttler.guard.ts`.

### Authorization

Enforced by guards, never by inline conditionals:

| Guard | Responsibility |
|---|---|
| `jwt-auth.guard.ts` | Verifies the token; `@Public()` opts a route out |
| `active-account.guard.ts` | Rejects deactivated users and stale `tokenVersion` |
| `roles.guard.ts` | `@Roles(...)` |
| `permissions.guard.ts` | Fine-grained permissions, seeded per role |
| `require-idempotency-key.guard.ts` | Enforces rule 3 |

**Apply `@Roles` per method, never at class level.** A class-level gate has had to be unpicked twice — once when a Manager needed read access to one route of an admin-only controller, and once for a `@Public()` route on an otherwise gated controller.

### Tenant isolation

Both layers, always. RLS policies **fail closed**: with `app.company_id` unset, `NULLIF(...)` yields `NULL` and no row matches. A child table carries its own policy rather than relying on its parent — **RLS is not transitive**.

### Signed URLs

Files and payslips are served to `@Public()` routes authenticated by a short-lived HMAC in the query string, because the device hands the URL to the OS browser, which sends no `Authorization` header. **Never log such a URL whole.**

### Reporting

For a suspected vulnerability, contact the repository owner directly rather than opening a public issue.

---

## Troubleshooting

### "No internet connection" on the device, but the network is fine

`adb reverse --list` is almost certainly empty. The app's `fetch` cannot distinguish "no signal" from "nothing is listening at that address", so a dropped tunnel is reported as a connectivity problem. Re-run both `adb reverse` commands. The payslip PDF opens through the same tunnel in the system browser, so check this before suspecting the code.

### `prisma migrate dev` fails with **P3014**

The database role lacks `CREATEDB`, so Prisma cannot build its shadow database. **Migrations in this repo are hand-written** in Prisma's generated style and applied with `migrate deploy`, which needs no shadow database:

```bash
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy
```

Note the substitution: Prisma only ever reads `DATABASE_URL`.

### A query returns nothing, or a `404` on a row that plainly exists

Almost always RLS. Either `app.company_id` was never set for the request, or — the subtle case — the code is running **outside a transaction**. `set_config(..., true)` is *transaction-local*, so on a `@Public()` route (which has no CLS transaction) the setting is gone by the next statement and every row disappears. Open an explicit `prisma.$transaction` and set the config inside it.

### `@field-sales/shared` has no exported member …

The shared package is consumed from its build output. Run `pnpm --filter @field-sales/shared build` after changing a schema.

### Map tiles are blank

`GOOGLE_MAPS_API_KEY` is empty in the dev build. Pins, radius rings, distances and every number remain correct — only the tiles are missing. Affects the executive's pin capture, the admin's shop form and the out-of-range visit detail.

### An executive sees no beat for today

Check, in order: the executive has an **active** beat plan whose `workingDays` includes today (1 = Mon … 7 = Sun); a `DailyAssignment` row exists for the business date. Remember there is **no materialisation job** — the day is created when the executive first opens the app. And note that a day already created is **frozen**: assigning a beat plan later today will not retro-fill it.

### "Save shop pin" stays disabled

The 20 m gate is about **the phone's confidence in its own position** (Android's `coords.accuracy`), not distance from the shop — at pin-capture time the shop has no location to measure against. Indoors, Wi-Fi and cell positioning give 30–500 m. Step outside and retry. The gate is deliberate: the pin becomes the fixed reference every future visit at that shop is measured against.

### A salary month shows the wrong figures after a settings change

It should not — and if it does, that is a bug worth reporting. Units are **summed** from the `payableUnits` frozen onto each attendance row, never re-derived from `status`, precisely so that editing `payableUnitByStatus` cannot re-price a past month.

### Metro changes do not appear

A JS-only change needs a Metro reload, not a rebuild. A change to native code, a new native dependency or an `.env.<flavor>` edit needs `pnpm --filter mobile android` again.

---

## Build Order

Slices are vertical — migration, API and screens together. Built so far: `001` … `012`, under `specs/`.

```
001-company-user-auth    002-shops-crud          003-beat-plans-crud
004-brands-reasons-crud  005-executive-dashboard 006-visit-outcomes
007-extra-shops          008-my-visits           009-my-totals
010-manager-app          011-admin-visits        012-monthly-salary-run
```

Remaining: notifications, reports and CSV export, and hardening.

Work on a slice with the Spec Kit commands in order — `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`.
