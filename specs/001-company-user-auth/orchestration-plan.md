# Orchestration Plan: Setup + Foundational (T001–T041)

<!-- status: in-progress -->
<!-- gate-iterations: 3 -->
<!-- gate-result: overridden (Completeness iter-3 residual -- WU-04 verification sentence -- fixed by user-approved Override, not a 4th review round) -->
<!-- user-approved: true -->
<!-- scope: specs/001-company-user-auth/tasks.md Phase 1 (Setup) + Phase 2 (Foundational) -->
<!-- tracking: GitHub Issues #1-#41 on project https://github.com/users/rajasekari2i/projects/3 (no BEADS per explicit user instruction) -->

## User's Original Request

Build the module at `specs/001-company-user-auth` (Company Provisioning, User Management & Sign-In), per `01-BRD.md`, `02-PRD.md`, `03-ARCHITECTURE.md` and the UI screen inventory, with task tracking in the GitHub project and no BEADS. User confirmed for this session: **full metaswarm orchestration** (plan-review-gate + per-WU adversarial review), starting scope **Setup + Foundational (T001–T041)**.

## Why sequential, not parallel, work units

Several work units below edit the same shared files (`apps/api/prisma/schema.prisma` in WU-01/WU-02; `apps/api/src/main.ts` in WU-01/WU-04/WU-07). The orchestrated-execution skill requires non-overlapping file scopes for parallel work units, so this plan runs WU-01 → WU-02 → WU-03 → WU-04 → WU-05 → WU-06 → WU-07 strictly in sequence. This is a deliberate, file-scope-driven decision, not under-parallelization for its own sake — it keeps every commit buildable on top of the last.

## On work-unit size vs. the "~5 files" guideline

The orchestrated-execution skill's pre-flight checklist guides toward "each work unit has a single responsibility (max ~5 files created/modified)." Four work units below exceed the file count — WU-01 (12 entries), WU-04 (11 entries), WU-05 (7 entries), WU-06 (6 entries) — and this is a deliberate, acknowledged choice, not an oversight:

- **WU-01** (monorepo scaffold): the 12 entries are six *new, empty projects/packages* (`apps/api`, `apps/mobile`, `packages/config`, `packages/shared`, plus workspace/turbo config and one `schema.prisma` stub line). There is no smaller grouping that doesn't either leave a project half-initialized at a checkpoint or create an artificial dependency between, say, `apps/api`'s `package.json` and `apps/mobile`'s `app.config.ts` — they are independent until WU-02+ start filling them in. Splitting this into 6 one-project WUs would add five extra IMPLEMENT→VALIDATE→REVIEW→COMMIT cycles for work that is not independently reviewable (an empty NestJS skeleton has nothing in it yet to adversarially check against a spec).
- **WU-04** (request pipeline): 11 entries, but each is a single small guard/pipe/filter/interceptor (most are 20–60 lines) that only has meaning as part of "every route in the app is now covered by this security/validation layer" — the DoD itself (item 10) *is* the cross-cutting integration check, so reviewing any one guard in isolation from the others would miss exactly the kind of gap this guideline exists to catch (a forgotten global registration). This WU is one responsibility — "the request pipeline is live" — expressed across many small files, not many responsibilities in one WU.
- **WU-05** (auth core): 7 entries are the single `auth` module's own internal layers (hashing utility, token service, controller, service, module file, the seed script that depends on it, and its one-line `app.module.ts` registration) — splitting the controller from its own service from its own module file would create sub-work-units with no independent DoD (a controller with no service does nothing).
- **WU-06** (files module): 6 entries, same reasoning as WU-05 — one module's own layers plus its registration line.

In every case, the excess is file *count* within one cohesive module, not scope beyond one responsibility — each WU still maps to exactly the task range stated (e.g. WU-04 = "the request pipeline exists and is wired in," entirely T022–T030) and none could be split without either stranding half-finished code at a checkpoint or reviewing a file in isolation from the other half of its own feature.

## Work Unit Decomposition

### WU-01: Monorepo & tooling scaffold

**Maps to**: tasks.md T001–T006 / GitHub issues #1–#6

**DoD**:
1. pnpm workspace root exists (`package.json`, `pnpm-workspace.yaml` listing `apps/*` and `packages/*`, `turbo.json`) and `packages/config/` holds a shared `tsconfig.base.json`, `.eslintrc.cjs` and Tailwind preset (T001)
2. `apps/api` is a NestJS 11 project (Node 22 LTS, TypeScript strict) that boots via `pnpm --filter api dev` to an empty `/healthz`-less root (T002)
3. `apps/mobile` is a bare React Native CLI project (own `android`/`ios` native projects, no Expo SDK/EAS — Architecture D-08, updated 2026-10-02) that reads `COMPANY_CODE`, `COMPANY_NAME`, `API_URL` **and the Google Maps key** per company via native build variants (an Android product flavor per company in `android/app/build.gradle`, surfaced to JS via a native-config bridge; Architecture §16.1), with NativeWind + the shared Tailwind preset and React Navigation installed, booting via `pnpm --filter mobile start` + `pnpm --filter mobile android` (T003)
4. `packages/shared` builds with `tsup` from a placeholder `src/index.ts` (T004)
5. `packages/shared/src/env.ts` Zod-validates `DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL(default 15m), JWT_REFRESH_TTL(default 60d), FILE_URL_SECRET, RAILWAY_VOLUME_MOUNT_PATH, SEED_SYSTEM_ADMIN_USERNAME, SEED_SYSTEM_ADMIN_PASSWORD, LOG_LEVEL`; `apps/api/src/main.ts` calls it at boot and the process exits non-zero if a required value is missing/malformed (T005)
6. `apps/api/prisma/schema.prisma` has `datasource db { provider = "postgresql" }` and `generator client { provider = "prisma-client-js" }` (T006)

**File scope**: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `packages/config/**`, `apps/api/package.json`, `apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/mobile/**` (new project), `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/env.ts`, `apps/api/prisma/schema.prisma` (datasource/generator block only)

**Dependencies**: none

**Human checkpoint**: No — pure scaffolding, fully reversible, no data/security surface yet.

---

### WU-02: Prisma schema & initial migration

**Maps to**: tasks.md T007–T018 / GitHub issues #7–#18

**DoD** (one item per data-model.md entity, exact field constraints as specified):
1. Enums added: `CompanyStatus{ACTIVE SUSPENDED}`, `UserStatus{ACTIVE INACTIVE}`, `RoleKey{SYSTEM_ADMIN COMPANY_ADMIN MANAGER MARKETING_EXECUTIVE EMPLOYEE}`, `PhotoKind{USER_AVATAR}` (T007)
2. `Company` model: `id` uuid pk, `code String @unique` (platform-wide unique, immutable per FR-003), `name String`, `place/contactEmail/contactPhone String?`, `timezone String @default("Asia/Kolkata")`, `status CompanyStatus @default(ACTIVE)`, timestamps (T008)
3. `CompanySettings` model: `companyId String @id` (1:1 Cascade), architecture-default fields exactly as listed in data-model.md (T009)
4. `Role` model: `id, key RoleKey, companyId String?, label String, permissions String[], isSystem Boolean @default(true)`, `@@unique([companyId, key])` (T010)
5. `User` model: all fields per data-model.md, `username`/`passwordHash` nullable and required-only-when-role≠EMPLOYEE (enforced in service code, not the DB, per FR-017), `@@unique([companyId, username])`, `@@index([companyId, status])` (T011)
6. `UserSalaryRate` model: `halfDayRate Decimal @db.Decimal(12,2)`, `effectiveFrom DateTime @db.Date`, `effectiveTo DateTime? @db.Date` (null = open-ended), `@@index([companyId, userId, effectiveFrom])` (T012)
7. `RefreshToken` model: `familyId String`, `tokenHash String @unique`, `usedAt/revokedAt DateTime?`, `expiresAt DateTime`, `@@index([userId, familyId])`, `@@index([expiresAt])` (T013)
8. `OtpChallenge` model: `codeHash String`, `purpose String @default("PASSWORD_RESET")`, `attempts Int @default(0)`, `expiresAt DateTime`, `@@index([userId, createdAt])` (T014)
9. `FileObject` model (avatar-only): `kind PhotoKind`, `storageKey String @unique`, `sha256 String`, `@@index([companyId, kind])` (T015)
10. `IdempotencyKey` model: `key String @unique`, `endpoint String`, `requestHash String`, `statusCode Int?`, `response Json?` (T016)
11. `AuditEvent` model: `actorUserId String`, `action String`, `entityType/entityId String`, `before/after Json?` (T017)
12. `pnpm --filter api exec prisma migrate dev --name init_company_user_auth` applies cleanly against a local Postgres 16 instance (T018)

**File scope**: `apps/api/prisma/schema.prisma` (model/enum bodies), `apps/api/prisma/migrations/<timestamp>_init_company_user_auth/**`

**Dependencies**: WU-01

**Human checkpoint**: **YES — database schema change.** Report the generated migration SQL before proceeding to WU-03.

---

### WU-03: Tenant isolation layer

**Maps to**: tasks.md T019–T021 / GitHub issues #19–#21

**DoD**:
1. `apps/api/src/infra/prisma/tenant.extension.ts` defines `TENANT_MODELS = {User, FileObject}`; for any operation against those models it injects `companyId` from CLS on `create`/`createMany` and filters every read/write-scoped `where` by it, throwing when the CLS context is missing (T019; the DMMF-driven "every tenant model registered" **test** is explicitly deferred per CLAUDE.md's no-tests-for-now policy — noted, not silently dropped)
2. Migration `apps/api/prisma/migrations/<timestamp>_rls_user_fileobject/migration.sql` enables + forces RLS on `User` and `FileObject` with a `current_setting('app.company_id', true)::uuid` policy; `Company/Role/RefreshToken/OtpChallenge/AuditEvent/IdempotencyKey` are explicitly **not** touched by this migration (Architecture §5 exemption list) (T020)
3. CLS module wired into `apps/api/src/app.module.ts`; `apps/api/src/common/interceptors/transaction.interceptor.ts` opens a Prisma `$transaction`, runs `SELECT set_config('app.company_id', $1, true)`, and runs the rest of the request inside that transaction's CLS context (T021)

**File scope**: `apps/api/src/infra/prisma/tenant.extension.ts`, `apps/api/prisma/migrations/<timestamp>_rls_user_fileobject/migration.sql`, `apps/api/src/common/interceptors/transaction.interceptor.ts`, `apps/api/src/app.module.ts` (CLS registration only), `apps/api/package.json` (adding `nestjs-cls` only, plus the mechanical `pnpm-lock.yaml` update that follows from it), `apps/api/.env`/`.env.example` (documenting/switching to the non-superuser `app_user` connection this work unit's design requires — see DoD item 2's "non-superuser role" note below). **Amendment, written here after this work unit's own checkpoint review flagged the gap** (same pattern as WU-04's `@Public()` addition): the IMPLEMENT-phase instructions always required these three files — CLS needs a declared dependency to resolve, and switching to a non-superuser connection needs somewhere to document and configure it — but this line originally omitted them. No code or behavior is affected by this amendment, only the written record now matching what was always actually necessary.
2a. **Non-superuser connection role (load-bearing for DoD item 2 above)**: Postgres RLS is bypassed entirely for superusers and (without `FORCE`) for table owners — `FORCE ROW LEVEL SECURITY` only forces it for the table's owner, not for every other role. Since the local dev setup previously connected as the `postgres` superuser, the migration must also create a plain, unprivileged, non-owner role (e.g. `app_user`) with ordinary CRUD grants, and `apps/api/.env`'s `DATABASE_URL` must switch to it — otherwise every policy in DoD item 2 would silently never apply. A separate `MIGRATE_DATABASE_URL` (superuser) is needed for schema/DDL changes, since `app_user` deliberately lacks those privileges.
2b. **`company_id IS NULL` rows (the System Admin's own `User` row, and any System-Admin-owned `FileObject`)**: in SQL, `NULL = anything` — including `NULL = NULL` — is never `TRUE`, so the policies in DoD item 2 must include an explicit escape for this case or that row becomes permanently unreadable/uninsertable under any `app.company_id` value, silently blocking the login and seed work this schema exists for (found during this work unit's own checkpoint review, not foreseen when the DoD was first written). The escape is a dedicated session flag, `app.is_system_context`, set only by code genuinely acting as the platform itself — verified live to not grant visibility into other tenants' real rows when set. Applies **identically** to both the `users` and `file_objects` policies (data-model.md: a `FileObject`'s `companyId` "matches the owning user's company," so it is nullable for the same reason `User.companyId` is) — a first pass at this fix only updated `users` and left `file_objects`'s policy comment claiming a parity it didn't have; both are now identical on purpose.

**Dependencies**: WU-02

**Human checkpoint**: **YES — security-sensitive code (tenant isolation / RLS).** This is Constitution rule 2; report the RLS policy SQL and the extension's `TENANT_MODELS` set before proceeding.

---

### WU-04: Request pipeline — guards, validation, idempotency, errors, audit

**Maps to**: tasks.md T022–T030 / GitHub issues #22–#30

**DoD**:
1. `RequestIdMiddleware` stamps `x-request-id` into CLS; `main.ts` wires Helmet, a strict CORS allowlist, and body limits (10 MB multipart / 1 MB JSON) (T022)
2. `ThrottlerGuard` config: 10 req/min per IP on `/auth/*`, 6-failures-per-15-min lockout per username on `/auth/login` (FR-010), 120 req/min per user elsewhere (T023)
3. `JwtAuthGuard` verifies the HS512 access token; `ActiveAccountGuard` rejects `status != ACTIVE` user or company with one message that does not reveal which (FR-007) (T024)
4. `RolesGuard`, `PermissionsGuard`, `@Roles()`/`@Permissions()` decorators matching `resource:action:scope` (T025)
5. `ZodValidationPipe` wired through `nestjs-zod`, consuming `packages/shared` schemas (T026)
6. `IdempotencyInterceptor`: same `Idempotency-Key` + same request hash replays the stored response; same key + different hash → `409 IDEMPOTENCY_KEY_REUSED` (T027)
7. `ProblemDetailsFilter` emits RFC 9457 `application/problem+json`; `packages/shared/src/errors.ts` defines the full code list from contracts/auth.md + contracts/files.md (T028)
8. `AuditInterceptor` writes one `AuditEvent` row inside the same transaction for `@Audited()` handlers (T029)
9. `packages/shared/src/enums.ts` mirrors the Prisma enums from WU-02/T007 (T030)
10. `JwtAuthGuard`, `ActiveAccountGuard`, `ZodValidationPipe`, `ProblemDetailsFilter` and `IdempotencyInterceptor` are registered as global providers (`APP_GUARD`/`APP_PIPE`/`APP_FILTER`/`APP_INTERCEPTOR`) in `apps/api/src/app.module.ts`, so every route is actually covered by them rather than only being available for opt-in use — this item is a correctness addition this orchestration plan makes on top of T022–T030's literal text (no single T-number names "global registration" explicitly), needed so the pipeline guards/pipes/filters WU-04 builds are not merely defined but inert. **Verified concretely** (same pattern as WU-05 DoD item 7 and WU-06 DoD item 4): boot `pnpm --filter api dev`, then send an unauthenticated request to any route guarded by `@Roles()`/`@Permissions()` and confirm it is rejected with `401`/`403` rather than reaching the handler — proving `JwtAuthGuard`/`ActiveAccountGuard` are globally active, not merely defined; separately, send a request with a deliberately malformed body to any Zod-validated route and confirm a `400 VALIDATION_FAILED` problem-details response, proving `ZodValidationPipe` and `ProblemDetailsFilter` are both globally wired
11. A `@Public()` decorator (metadata-only, read via `Reflector`) that `JwtAuthGuard`/`ActiveAccountGuard` check and short-circuit on, and that `TransactionInterceptor` (built in WU-03, deliberately left **unregistered** there — see `specs/001-company-user-auth/execution-state.md`'s "Established Patterns") also checks and skips. **This item did not exist in the original WU-03/WU-04 split and is added here after WU-03's own checkpoint review surfaced the gap**: registering `TransactionInterceptor` as a global `APP_INTERCEPTOR` *without* a public-route skip would break every future public endpoint (`/auth/login`, `/auth/refresh`, `/auth/forgot-password`, …) by forcing them through a tenant-scoped transaction before any tenant identity exists. WU-04 registers `TransactionInterceptor` as a global `APP_INTERCEPTOR` *together with* this skip mechanism — never one without the other.

**File scope**: `apps/api/src/common/middleware/request-id.middleware.ts`, `apps/api/src/main.ts` (helmet/cors/body-limit section), `apps/api/src/common/guards/*.ts`, `apps/api/src/common/decorators/*.ts` (including the new `@Public()` decorator), `apps/api/src/common/pipes/zod-validation.pipe.ts`, `apps/api/src/common/interceptors/idempotency.interceptor.ts`, `apps/api/src/common/interceptors/audit.interceptor.ts`, `apps/api/src/common/interceptors/transaction.interceptor.ts` (adding the `@Public()` skip check only — built in WU-03, not otherwise touched here), `apps/api/src/common/filters/problem-details.filter.ts`, `packages/shared/src/errors.ts`, `packages/shared/src/enums.ts`, `apps/api/src/app.module.ts` (global provider registration only)

**Dependencies**: WU-01, WU-03 (guards/interceptors read the CLS tenant context WU-03 establishes)

**Human checkpoint**: **YES — security-sensitive code (auth/role guards).** Report the guard list and the error-code table before proceeding.

---

### WU-05: Auth core — hashing, tokens, login/refresh/logout, seed

**Maps to**: tasks.md T031–T036 / GitHub issues #31–#36

**DoD** (per `contracts/auth.md`):
1. `apps/api/src/infra/security/password.ts`: argon2id `hash()`/`verify()` with `memoryCost 19456 KiB, timeCost 2, parallelism 1` (T031)
2. `TokenService`: HS512 access tokens (15 min; claims `sub, companyId, role, permissions, jti, ver`), rotating refresh tokens (60 days; `familyId, jti`), only the refresh token's argon2id hash is ever stored (T032)
3. `POST /auth/login`: body `{ companyCode?, username, password }`, `companyCode` omitted only for a `SYSTEM_ADMIN` login (scoped to `companyId: null`); `401 INVALID_CREDENTIALS` on wrong username/password (identical message either way); `403 ACCOUNT_INACTIVE` on inactive user/suspended company; success returns `{ accessToken, refreshToken, user }` (T033)
4. `POST /auth/refresh`: verifies the presented token's argon2id hash, marks `usedAt`, issues a new pair in the same `familyId`; a reused token revokes the whole family and returns `409 TOKEN_REUSED` (T034)
5. `POST /auth/logout`: revokes the presented refresh token, `204` (T035)
6. `apps/api/prisma/seed.ts` first upserts the platform-wide `Role` row (`key: SYSTEM_ADMIN, companyId: null`) if it doesn't already exist, **then** upserts exactly one `User` with `role.key = SYSTEM_ADMIN`, `companyId = null`, from `SEED_SYSTEM_ADMIN_USERNAME`/`PASSWORD`, idempotent on re-run — this Role bootstrap step is a correction this orchestration plan adds on top of T036's literal text: `User.roleId` is a mandatory FK (data-model.md/T011), and no task in T001–T041 otherwise creates this Role row (it is only ever created, per-company, by T042 in the later User-Story-1 scope) — without it, T036 cannot satisfy its own foreign key and WU-05's checkpoint login could never succeed (T036)
7. `AuthModule` is registered in `apps/api/src/app.module.ts`'s `imports` array — verified the same concrete way as WU-06's files-module check: boot `pnpm --filter api dev`, confirm Nest's startup log lists the `/auth/login`, `/auth/refresh` and `/auth/logout` routes, then execute the Human Checkpoint below (a real login against the seeded System Admin) as the end-to-end proof the module is actually reachable, not merely defined

**File scope**: `apps/api/src/infra/security/password.ts`, `apps/api/src/modules/auth/token.service.ts`, `apps/api/src/modules/auth/auth.controller.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/modules/auth/auth.module.ts`, `apps/api/prisma/seed.ts`, `apps/api/src/app.module.ts` (register `AuthModule` only)

**Dependencies**: WU-02, WU-03, WU-04

**Human checkpoint**: **YES — security-sensitive (password hashing, token issuance) and this is the capability every later story's independent test depends on.** Report a successful login against the seeded System Admin before proceeding.

---

### WU-06: Avatar file pipeline

**Maps to**: tasks.md T037–T039 / GitHub issues #37–#39

**DoD** (per `contracts/files.md`):
1. `StorageAdapter` interface (`put/get/delete/exists`) + `LocalVolumeAdapter` writing under `RAILWAY_VOLUME_MOUNT_PATH`, sharded `photos/<companyId>/<yyyy>/<mm>/<uuid>.webp` (T037)
2. Avatar upload pipeline: multipart ≤10 MB `image/jpeg|png|webp|heic`; magic-byte check; `sharp` auto-rotate + strip EXIF + resize-1600px-long-edge + WebP-q80 + 320px thumbnail; `sha256` dedupe within company (T038)
3. `GET /files/:id?token=`: 10-minute HMAC token (`fileId|userId|exp`) against `FILE_URL_SECRET`; `401/403 FORBIDDEN` on bad/missing/expired token, `404 NOT_FOUND` otherwise; `?thumb=1` serves the 320px thumbnail (T039)
4. `FilesModule` is registered in `apps/api/src/app.module.ts`'s `imports` array; since CLAUDE.md's no-tests-for-now policy means `tsc`/lint/build alone cannot catch a forgotten import (an unregistered module is still valid TypeScript), this is verified concretely by booting the API (`pnpm --filter api dev`) and confirming Nest's own startup log lists the `GET /files/:id` route, then issuing one real request — a valid signed URL returns the image/thumbnail, and a request with no token returns `403 FORBIDDEN` rather than Nest's generic `404` for an unmapped route (which would indicate the module never got wired in)

**File scope**: `apps/api/src/infra/storage/storage-adapter.interface.ts`, `apps/api/src/infra/storage/local-volume.adapter.ts`, `apps/api/src/modules/files/files.service.ts`, `apps/api/src/modules/files/files.controller.ts`, `apps/api/src/modules/files/files.module.ts`, `apps/api/src/app.module.ts` (register `FilesModule` only)

**Dependencies**: WU-02 (`FileObject`), WU-03 (tenant scoping), WU-04 (guards)

**Human checkpoint**: No — no external credentialed service involved (local volume adapter only; Railway/S3 swap is a later-slice concern per Architecture D-11). The registration check in DoD item 4 above substitutes for a checkpoint here, since it's a concrete, self-verifiable step rather than something needing human judgment.

---

### WU-07: Observability + mobile skeleton

**Maps to**: tasks.md T040–T041 / GitHub issues #40–#41

**DoD**:
1. `pino` JSON logging in `apps/api/src/main.ts` with `requestId, companyId, userId, route, durationMs` fields and a redaction list covering `password, token, authorization, latitude, longitude, reasonText, otp` (T040)
2. `apps/mobile/src/navigation/RootNavigator.tsx` (role-based navigator stub reading `useSession().role`), `apps/mobile/src/lib/secureSession.ts` (`react-native-keychain`-backed getters/setters for the access/refresh pair), `apps/mobile/src/api/client.ts` (typed fetch client scaffold reading shapes from `packages/shared`) (T041)

**File scope**: `apps/api/src/main.ts` (pino section), `apps/mobile/src/navigation/RootNavigator.tsx`, `apps/mobile/src/lib/secureSession.ts`, `apps/mobile/src/api/client.ts`

**Dependencies**: Technically only WU-04 (shares `main.ts`, must come after its edits land) and WU-01 (mobile scaffold) — WU-07 does not use anything WU-05 or WU-06 build. It is nonetheless scheduled **last** in this plan's execution order (after WU-06), purely so this plan has one single, unambiguous commit sequence to follow; it is not blocked by WU-05/WU-06 and could be moved earlier in a future revision if parallel execution is ever desired.

**Human checkpoint**: No.

---

## API Contract (endpoints built in this scope)

Reproduced from `contracts/auth.md` and `contracts/files.md` (already adversarially-designed in the Phase 1 plan — not re-derived here):

### `POST /auth/login` — public
Request: `{ companyCode?: string; username: string; password: string }`. Response `200`: `{ accessToken, refreshToken, user: { id, name, role, companyId, permissions } }`. Errors: `401 INVALID_CREDENTIALS`, `403 ACCOUNT_INACTIVE`, `429 RATE_LIMITED`.

### `POST /auth/refresh` — public (presents a refresh token)
Request: `{ refreshToken: string }`. Response `200`: new token pair. Errors: `TOKEN_EXPIRED`, `409 TOKEN_REUSED`.

### `POST /auth/logout` — any authenticated role
Request: `{ refreshToken: string }`. Response `204`.

### `GET /files/:id?token=&thumb=` — any role holding a valid signed token
Response: image bytes. Errors: `401/403 FORBIDDEN`, `404 NOT_FOUND`.

(`forgot-password`/`verify-otp`/`reset-password`/`change-password`, `/companies`, `/users`, `/me` are User Stories 1–4, out of this T001–T041 scope — they are separate, later work units per `tasks.md`.)

## Security Considerations

- **Trust boundaries**: `/auth/login`, `/auth/refresh` are public (unauthenticated) inputs — every field is untrusted and Zod-validated (WU-04/T026). `/auth/logout` and `/files/:id` require a valid bearer/token.
- **Input validation**: every request body validated against a `packages/shared` Zod schema before reaching a handler (Constitution rule 5).
- **Rate limiting**: `/auth/login` at 10/min/IP plus the 6-failures/15-min per-username lockout (FR-010); general authenticated traffic at 120/min/user (WU-04/T023).
- **AuthN/AuthZ**: `JwtAuthGuard` → `ActiveAccountGuard` → `RolesGuard`/`PermissionsGuard`, in that order, on every non-public route (WU-04).
- **Secrets management**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FILE_URL_SECRET`, `SEED_SYSTEM_ADMIN_PASSWORD` are env-only, Zod-validated at boot (WU-01/T005), never committed; `.gitignore` already covers `.env*` (verify in WU-01).
- **Password/token storage**: passwords argon2id-hashed (WU-05/T031); refresh tokens stored only as an argon2id hash, never the raw opaque value (data-model.md).
- **Tenant isolation**: two independent layers (Prisma extension + Postgres RLS) on every `User`/`FileObject` operation (WU-03) — Constitution rule 2, the project's single highest-stakes rule.

## External Dependencies

- **PostgreSQL 16**: required, local dev instance, `DATABASE_URL`, a **direct connection** (not a transaction/statement-mode pooler) — Architecture §5 warns that `SET LOCAL app.company_id` (WU-03) only holds under a direct connection or a transaction-mode pooler; a statement-mode pooler would silently defeat RLS. This scope only ever runs against a local dev Postgres with a direct connection, so the caveat doesn't bind yet — it becomes relevant again at Railway deployment (out of scope here, and already Railway's own configuration per Architecture §5/§17, not something this plan's code needs to enforce).
- No other credentialed external service is touched in T001–T041 — SMS (OTP), Firebase (push) and Google Maps are not needed until later work units (US4, 015-notifications, 006-shops respectively). No external-service human checkpoint is needed for this scope.

## Human Checkpoints (summary)

| After WU | Reason | What's reported |
|---|---|---|
| WU-02 | Database schema change | Generated migration SQL |
| WU-03 | Security-sensitive (tenant isolation / RLS) | RLS policy SQL + `TENANT_MODELS` set |
| WU-04 | Security-sensitive (auth/role guards) | Guard list + error-code table |
| WU-05 | Security-sensitive (password/token issuance); unblocks every later story | Successful login against the seeded System Admin |

## Dependency Graph

Actual technical dependencies (what each WU reads/needs):

```
WU-01 → WU-02 → WU-03 → WU-04 → WU-05
                            │     └──→ WU-06
                            └──────────────→ WU-07
```

This plan's **actual execution order is the single strict chain** `WU-01 → WU-02 → WU-03 → WU-04 → WU-05 → WU-06 → WU-07`, matching "Why sequential, not parallel, work units" above. The graph is shown only to document that WU-07's true dependencies are narrower (WU-01 + WU-04 only) — this plan still runs it last, not in parallel with WU-05/WU-06, to keep one unambiguous commit sequence.
