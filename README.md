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

# Migrations need CREATE privileges that app_user does not have, so the
# privileged URL is passed inline for this one command — it is deliberately
# not stored as a second variable.
cd apps/api
DATABASE_URL="postgresql://postgres:<pwd>@localhost:5432/field_sales" pnpm exec prisma migrate deploy
DATABASE_URL="postgresql://postgres:<pwd>@localhost:5432/field_sales" pnpm exec prisma db seed
cd ../..
pnpm --filter @field-sales/shared build
```

`pnpm --filter @field-sales/shared build` matters more than it looks: the API imports `@field-sales/shared` from its **built** `dist`, so a schema added but not rebuilt fails to resolve with a confusing "has no exported member".

---

## Environment Configuration

### `apps/api/.env`

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **The only database variable the app needs.** Connects as `app_user`. Must not be a superuser or the table owner, or RLS is silently bypassed. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Distinct, 32+ characters each |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `15m` / `60d` |
| `FILE_URL_SECRET` | HMAC for signed file and payslip URLs |
| `PASSWORD_RESET_SECRET` | HMAC for reset tokens |
| `STORAGE_DRIVER` | `volume` (default) or `s3` |
| `RAILWAY_VOLUME_MOUNT_PATH` | Photo storage root. Required when `STORAGE_DRIVER=volume` |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required when `STORAGE_DRIVER=s3` |
| `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Optional. `S3_ENDPOINT` is required for anything other than AWS |
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

On the phone `localhost` means *the phone*, so both ports need forwarding: **8081** is Metro (the JS bundle — without it the app shows a red "Unable to load script" and never starts) and **3000** is the API (without it the app runs but reports *"No internet connection"*, because a failed `fetch` cannot tell "no signal" from "nothing listening").

`react-native run-android` recreates the 8081 tunnel automatically; **nothing recreates 3000**. Both die on every unplug, device reboot or `adb kill-server`, so re-run them and verify with `adb reverse --list` — bare `adb reverse` is not a list command. See Troubleshooting if either symptom persists.

### Other commands

```bash
pnpm build                                  # all packages
pnpm lint                                   # eslint --fix across the workspace
pnpm --filter api generate:openapi          # regenerate docs/openapi.json
pnpm --filter api exec prisma studio        # browse the database
```

---

## Deployment (Railway)

Hosting is Railway: the API, PostgreSQL, and a volume for photos. There is **no `railway.json`, `nixpacks.toml` or `Dockerfile` in this repo** — everything below is configured in Railway's dashboard.

### Service settings

This is a **pnpm workspace**, and that constrains all three settings:

| Setting | Value |
|---|---|
| **Root Directory** | `/` — the repo root |
| **Install** | `corepack enable && pnpm install --frozen-lockfile` |
| **Build** | `pnpm build` |
| **Start** | `node apps/api/dist/src/main` |

**Root Directory must be the repo root, not `apps/api`.** `apps/api/package.json` declares `"@field-sales/shared": "workspace:*"`, which only pnpm can resolve. Point Railway at `apps/api` and it finds no lockfile there, falls back to npm, and the build dies with:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

The lockfile and the `packageManager` field both live at the root, so building from there is what makes pnpm get selected at all.

`pnpm build` runs Turborepo, whose `build` task declares `dependsOn: ["^build"]` — so `@field-sales/shared` is built before the API that imports it. The API's own `build` runs `prisma generate` first, because a fresh container has no generated client and `nest build` does not create one.

The start command points at **`dist/src/main`**, not `dist/main`: `nest build` preserves the `src/` folder because the API's tsconfig also covers `prisma/` and `scripts/`.

### Database

Railway's Postgres provisions one database — `railway`, owned by the `postgres` superuser. Two connection strings matter, and they are not interchangeable:

| Use | Railway variable | Host |
|---|---|---|
| Migrations and `psql`, from your machine | `DATABASE_PUBLIC_URL` | `…proxy.rlwy.net` |
| The deployed API | `DATABASE_URL` | `postgres.railway.internal` |

The internal host only resolves inside Railway's network; the public one costs egress. Use each where it belongs.

### Migrations run themselves on deploy

**Prisma has no auto-migrate.** `prisma generate` builds the client and touches no database, and nothing in NestJS startup applies a migration — so something has to run `migrate deploy`.

That something is the container entrypoint (`apps/api/docker-entrypoint.sh`). Set **`MIGRATE_DATABASE_URL`** on the service and every deploy applies pending migrations **once, before the server starts**. If a migration fails the container never starts, which is what you want: a half-migrated schema serving traffic is worse than a deploy that visibly refuses.

Leave `MIGRATE_DATABASE_URL` unset and it skips them — for deployments that migrate from CI instead.

```bash
# privileged connection, used ONLY by the entrypoint; the app keeps running
# as the unprivileged DATABASE_URL role
MIGRATE_DATABASE_URL=postgresql://postgres:<pwd>@postgres.railway.internal:5432/railway
```

Two credentials is the price of the two-role design: `app_user` cannot `CREATE TABLE` by intent, because Postgres bypasses RLS for superusers. Confining the privilege to one release step is the whole point.

**The seed is separate and runs once**, by hand, for the first System Admin:

```bash
cd apps/api
DATABASE_URL="<DATABASE_PUBLIC_URL>" npx prisma db seed
```

Migration `20261002110942_rls_user_fileobject` is what creates the `app_user` role. **Change its password before going anywhere near production** — the migration hardcodes one and it is committed in this repo:

```sql
ALTER ROLE app_user PASSWORD '<a-new-strong-password>';
```

> That migration ends with `ALTER DEFAULT PRIVILEGES **FOR ROLE postgres**`, hardcoded. Railway's default user happens to be `postgres`, so tables created by later migrations are granted to `app_user` automatically. Migrate as a differently-named role and new tables silently become unreadable to the API.

### Variables on the API service

```bash
# RUNTIME — app_user, never postgres. Internal host.
DATABASE_URL=postgresql://app_user:<pwd>@postgres.railway.internal:5432/railway

JWT_ACCESS_SECRET=<32+ chars>
JWT_REFRESH_SECRET=<32+ chars, different>
FILE_URL_SECRET=<32+ chars>
PASSWORD_RESET_SECRET=<32+ chars, different>
RAILWAY_VOLUME_MOUNT_PATH=/data
SEED_SYSTEM_ADMIN_USERNAME=<username>
SEED_SYSTEM_ADMIN_PASSWORD=<8+ chars>
LOG_LEVEL=info
```

Those nine are exactly what `packages/shared/src/env.ts` validates. The process refuses to boot on a missing or too-short one and names it in the error, so a bad deploy fails loudly at startup rather than at the first request.

`DATABASE_URL` is the **only** database variable — on Railway and locally alike. The privileged connection is never stored anywhere; it is pasted inline for `prisma migrate deploy` and nowhere else. That is deliberate: a superuser URL sitting beside the app's own is one copy-paste away from becoming the app's connection, and that failure is silent.

`PORT` is injected by Railway.

### `DATABASE_URL` must be `app_user`, not `postgres`

The single most consequential line above.

**Postgres bypasses row-level security entirely for superusers.** Connect the API as `postgres` and every RLS policy in this application stops applying — silently. No error, nothing in the logs, and most screens keep working because the Prisma extension still filters by `companyId`. What you lose is the second, independent layer that exists precisely for the case where the first one has a gap.

This is the whole reason the project has two roles rather than one.

### Verify after deploying

```sql
-- both must be false
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_user';

-- every tenant table: rls enabled AND forced
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relkind = 'r' AND relrowsecurity ORDER BY relname;
```

Then confirm the API answers: an unauthenticated `GET /api/v1/salary-runs` should be `401`, not a connection error.

### Photo storage

Two backends, chosen by `STORAGE_DRIVER`, behind one `StorageAdapter` interface.

**`volume` (default).** A disk mounted into the container. **It has no credentials** — the app writes to it with ordinary filesystem calls. Attach the volume in Railway and set `RAILWAY_VOLUME_MOUNT_PATH` to the same mount path, or photos have nowhere to land.

**`s3`.** Any S3-compatible endpoint — AWS, Railway object storage, MinIO, R2:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<access key>
S3_SECRET_ACCESS_KEY=<secret key>
S3_ENDPOINT=https://<endpoint>     # omit for AWS, required for everyone else
S3_FORCE_PATH_STYLE=true           # true for everything except AWS
```

Validation is conditional: pick a driver and only its variables are required, so a wrong combination fails **at boot naming the missing variable** rather than at the first upload.

Either way, photos are keyed by **what they are**:

```
user-profile/<companyId>/<yyyy>/<mm>/<uuid>.webp
shop-picture/<companyId>/<yyyy>/<mm>/<uuid>.webp
```

On S3 those slashes are part of a flat key rather than real folders, so **nothing needs pre-creating in the bucket** — the first upload materialises the prefix. The `FileObject.kind` column (`USER_AVATAR` / `SHOP_PHOTO`) remains the authoritative distinction; the prefix exists so a human browsing the bucket or the volume can tell them apart too.

Files written before this split keep their original `photos/...` keys and keep working: every read uses the `storageKey` stored on the row, never a path rebuilt from its parts.

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

### Two tunnels, two different failures

Most device problems are one of these, and they are easy to mix up because the fix *looks* the same:

| Port | Serves | Symptom when it is down |
|---|---|---|
| **8081** | Metro — the JavaScript bundle | **Red screen, "Unable to load script".** The app cannot start at all |
| **3000** | The API — data | The app runs, but says *"No internet connection"* |

Running the 3000 command will never fix an 8081 problem, or the reverse. Read the symptom first, then pick.

### Red screen: "Unable to load script"

The app cannot reach **Metro**. In likelihood order:

**1. Metro is not running.** This is the usual cause. `adb reverse` only forwards a port — if nothing is listening on 8081 on your machine, the tunnel leads nowhere and the error is identical to having no tunnel.

```bash
curl -s localhost:8081/status      # expect: packager-status:running
pnpm --filter mobile start         # if it is not
```

**2. The device is not attached or not authorised.** `adb devices` must show `device` — not `unauthorized`, not `offline`.

**3. The tunnel did not survive.** `adb reverse --list` must print both lines:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
adb reverse --list
```

Note that bare `adb reverse` is **not** a list command — it only prints usage, so it is possible to think you checked when you did not.

**4. More than one device is attached.** `adb reverse` then fails; name the one you mean with `adb -s <serial> reverse tcp:8081 tcp:8081`.

**5. Then reload on the phone — press `R` twice**, or Dismiss and reopen. **The red screen never retries by itself**, so a fixed tunnel still shows the old error until you reload. This is why the fix often looks like it did not work.

Still failing:

```bash
adb kill-server && adb start-server          # then replug, redo the reverses
pnpm --filter mobile start --reset-cache     # stale Metro cache
pnpm --filter mobile android                 # last resort: reinstall
```

### "No internet connection" on the device, but the network is fine

`adb reverse --list` is almost certainly missing the **3000** line. The app's `fetch` cannot distinguish "no signal" from "nothing is listening at that address", so a dropped tunnel is reported as a connectivity problem.

The asymmetry that causes this repeatedly: `react-native run-android` recreates the **8081** tunnel automatically, but **nothing ever recreates 3000**. So the state right after a reinstall is usually "app loads fine, no data" — Metro is up because the CLI restored it, and the API is unreachable because nobody restored that one. Run both commands, every time, not just the one the error names.

The payslip PDF opens in the system browser through this same tunnel, so check it before suspecting the code.

### Railway build fails with `EUNSUPPORTEDPROTOCOL` / `Unsupported URL Type "workspace:"`

Railway is running **npm** against a **pnpm** workspace. The giveaway is that it ran npm at all: `pnpm-lock.yaml` and the `packageManager` field are both at the repo root, so pnpm is detected when the build starts there. It falls back to npm when the service's **Root Directory** is set to `apps/api`, where there is no lockfile — and `apps/api/package.json` declares `"@field-sales/shared": "workspace:*"`, which npm cannot resolve.

Set Root Directory to `/` and set the install, build and start commands explicitly. See [Deployment](#deployment-railway).

### Deployed API exits immediately with `MODULE_NOT_FOUND`

The start command is probably `node dist/main`. The compiled entry is **`dist/src/main.js`** — `nest build` preserves the `src/` folder because the API's tsconfig also covers `prisma/` and `scripts/`. Use `node apps/api/dist/src/main`, or `pnpm --filter api start:prod`, which points at the same place.

### Deployed API fails on `@prisma/client` / "did not initialize yet"

`prisma generate` has not run. A fresh container has no generated client, and `nest build` does not create one. The API's `build` script runs it first, and `postinstall` runs it on install — so this should only appear if the build command was overridden to call `nest build` directly.

### `prisma migrate dev` fails with **P3014**

The database role lacks `CREATEDB`, so Prisma cannot build its shadow database. **Migrations in this repo are hand-written** in Prisma's generated style and applied with `migrate deploy`, which needs no shadow database:

```bash
cd apps/api
DATABASE_URL="postgresql://postgres:<pwd>@localhost:5432/field_sales" pnpm exec prisma migrate deploy
```

Prisma only ever reads `DATABASE_URL`, which is why the privileged connection is passed inline for this command rather than kept as a second variable.

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
