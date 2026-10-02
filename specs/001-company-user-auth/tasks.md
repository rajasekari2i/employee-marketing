---

description: "Task list for Company Provisioning, User Management & Sign-In"
---

# Tasks: Company Provisioning, User Management & Sign-In

**Input**: Design documents from `/specs/001-company-user-auth/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not included. CLAUDE.md's standing policy suspends unit/integration test authoring for this project "for now" — verification is the `quickstart.md` walkthrough (Phase 7, T073–T075). If a later request explicitly asks for tests, that overrides the policy for that task only.

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P4) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Every task names its exact file path(s)

## Path Conventions

Mobile + API monorepo per `plan.md`'s Project Structure: `apps/api/` (NestJS), `apps/mobile/` (Expo React Native), `packages/shared/` (Zod contracts). No `apps/` or `packages/` directories exist yet — Phase 1 creates them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the monorepo skeleton this and every later slice builds on.

- [ ] T001 Create the pnpm workspace root: `package.json`, `pnpm-workspace.yaml` (listing `apps/*` and `packages/*`), `turbo.json`, and `packages/config/` with shared `tsconfig.base.json`, `.eslintrc.cjs` and a Tailwind preset, per Architecture §3's monorepo layout
- [ ] T002 [P] Initialize `apps/api`: NestJS 11 on Node 22 LTS, TypeScript strict, with `apps/api/package.json`, `apps/api/src/main.ts` and `apps/api/src/app.module.ts` skeletons (Architecture D-02)
- [ ] T003 [P] Initialize `apps/mobile`: Expo (React Native) project with `apps/mobile/app.config.ts` reading `COMPANY_CODE`, `COMPANY_NAME`, `API_URL` and the Google Maps key from the EAS profile (Architecture §16.1), NativeWind + the shared Tailwind preset wired in, React Navigation installed
- [ ] T004 [P] Initialize `packages/shared` (Zod schemas + inferred types, built with `tsup`), with placeholder `packages/shared/src/index.ts` exporting nothing yet — later tasks add the real schemas
- [ ] T005 [P] Implement environment validation in `packages/shared/src/env.ts`: a Zod schema for `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL` (default `15m`), `JWT_REFRESH_TTL` (default `60d`), `FILE_URL_SECRET`, `RAILWAY_VOLUME_MOUNT_PATH`, `SEED_SYSTEM_ADMIN_USERNAME`, `SEED_SYSTEM_ADMIN_PASSWORD`, `LOG_LEVEL`; `apps/api/src/main.ts` calls it at boot and the process must refuse to start if a required value is missing or malformed (Architecture §17)
- [ ] T006 [P] Add Prisma to `apps/api`: run `prisma init`, set `datasource db { provider = "postgresql" }` and `generator client { provider = "prisma-client-js" }` in `apps/api/prisma/schema.prisma`

**Checkpoint**: Monorepo installs and both apps boot empty.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The data model, tenant-isolation pipeline, and working sign-in/token/file infrastructure that every user story's own test depends on — including User Story 1's, since provisioning a company must itself be called with a signed-in System Admin token.

**⚠️ CRITICAL**: No user story task may start until this phase is complete.

- [ ] T007 Add enums to `apps/api/prisma/schema.prisma`: `CompanyStatus { ACTIVE SUSPENDED }`, `UserStatus { ACTIVE INACTIVE }`, `RoleKey { SYSTEM_ADMIN COMPANY_ADMIN MANAGER MARKETING_EXECUTIVE EMPLOYEE }`, `PhotoKind { USER_AVATAR }` (data-model.md; `PhotoKind.SHOP` is added later by the `006-shops` slice, not here)
- [ ] T008 [P] Define the `Company` model in `apps/api/prisma/schema.prisma`: `id` (uuid, `@id @default(uuid())`), `code` (`String @unique`, platform-wide unique and immutable after creation per FR-003), `name` (`String`), `place`/`contactEmail`/`contactPhone` (`String?`), `timezone` (`String @default("Asia/Kolkata")`), `status` (`CompanyStatus @default(ACTIVE)`), `createdAt`/`updatedAt`
- [ ] T009 [P] Define the `CompanySettings` model in `apps/api/prisma/schema.prisma`: `companyId` (`String @id`, 1:1 to `Company` with `onDelete: Cascade`), and the architecture defaults — `defaultRadiusMeters Int @default(5)`, `maxAccuracyMeters Int @default(20)`, `maxLocationAgeSeconds Int @default(120)`, `morningSessionStart String @default("09:00")`, `eveningSessionStart String @default("14:00")`, `delay1hMinutes Int @default(60)`, `delay2hMinutes Int @default(120)`, `autoApproveExecPins Boolean @default(false)`, `beatNotStartedAt String @default("10:30")`, `beatNotEndedAt String @default("20:00")`, `beatAutoCloseAt String @default("23:00")`, `offlineMaxAgeHours Int @default(24)`, `payableUnitByStatus Json`, `notificationsEnabled Json`, `updatedAt` — created automatically whenever a `Company` is created (T041), not independently editable in this slice
- [ ] T010 [P] Define the `Role` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `key` (`RoleKey`), `companyId` (`String?`, `null` = platform-wide seeded role), `label` (`String`), `permissions` (`String[]`), `isSystem` (`Boolean @default(true)`), `@@unique([companyId, key])`
- [ ] T011 [P] Define the `User` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `companyId` (`String?`, `null` only for `SYSTEM_ADMIN` per FR-004), `roleId` (FK `Role`), `name` (`String`), `email` (`String?`, read-only to the user themself per FR-021), `username` (`String?`, unique within `(companyId)` case-insensitive per FR-006; **required** when `role.key != EMPLOYEE` and **must be null** when `role.key == EMPLOYEE` per FR-017), `passwordHash` (`String?`, same presence rule as `username`), `mobile` (`String?`), `photoId` (`String? @unique`, FK `FileObject`), `status` (`UserStatus @default(ACTIVE)`), `monthlySalary` (`Decimal? @db.Decimal(12,2)`), `tokenVersion` (`Int @default(0)`), `lastLoginAt` (`DateTime?`), `createdAt`/`updatedAt`; `@@unique([companyId, username])`, `@@index([companyId, status])`
- [ ] T012 [P] Define the `UserSalaryRate` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `companyId` (`String`), `userId` (FK `User`), `halfDayRate` (`Decimal @db.Decimal(12,2)`), `effectiveFrom` (`DateTime @db.Date`), `effectiveTo` (`DateTime? @db.Date`, `null` = open-ended per data-model.md), `createdByUserId` (`String`), `createdAt`; `@@index([companyId, userId, effectiveFrom])`
- [ ] T013 [P] Define the `RefreshToken` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `userId`, `familyId` (`String`, shared by every token descended from one login), `tokenHash` (`String @unique`, argon2id hash — the raw opaque value is never stored), `deviceId`/`userAgent` (`String?`), `usedAt`/`revokedAt` (`DateTime?`), `expiresAt` (`DateTime`), `createdAt`; `@@index([userId, familyId])`, `@@index([expiresAt])`
- [ ] T014 [P] Define the `OtpChallenge` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `userId`, `codeHash` (`String`), `purpose` (`String @default("PASSWORD_RESET")`), `attempts` (`Int @default(0)`, capped at 5 per FR-012), `consumedAt` (`DateTime?`), `expiresAt` (`DateTime`, `createdAt + 10 minutes` per FR-012), `createdAt`; `@@index([userId, createdAt])`
- [ ] T015 [P] Define the `FileObject` model in `apps/api/prisma/schema.prisma` (avatar-only subset): `id` (uuid), `companyId` (`String?`), `kind` (`PhotoKind`), `storageKey` (`String @unique`, shape `photos/<companyId>/<yyyy>/<mm>/<uuid>.webp`), `mimeType` (`String`), `byteSize` (`Int`), `width`/`height` (`Int?`), `sha256` (`String`), `thumbKey` (`String?`), `uploadedBy` (`String`), `createdAt`; `@@index([companyId, kind])`
- [ ] T016 [P] Define the `IdempotencyKey` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `key` (`String @unique`), `companyId`/`userId` (`String?`), `endpoint` (`String`), `requestHash` (`String`), `statusCode` (`Int?`), `response` (`Json?`), `createdAt` (Architecture §11)
- [ ] T017 [P] Define the `AuditEvent` model in `apps/api/prisma/schema.prisma`: `id` (uuid), `companyId` (`String?`), `actorUserId` (`String`), `action` (`String`), `entityType`/`entityId` (`String`), `before`/`after` (`Json?`), `createdAt` (Architecture §7/§18)
- [ ] T018 Generate and apply the initial migration: `pnpm --filter api exec prisma migrate dev --name init_company_user_auth`, confirming T008–T017 apply cleanly against a local Postgres 16 instance
- [ ] T019 Implement the Prisma tenant extension in `apps/api/src/infra/prisma/tenant.extension.ts`: a `TENANT_MODELS` set containing `User` and `FileObject`; for any operation against a model in that set, inject `companyId` from the CLS-stored request context on create/createMany and filter every read/write-scoped `where` by it, throwing if the context is missing (Architecture §5, Constitution rule 2); the DMMF-driven "every tenant model is registered" check described in Architecture §5 is a test and is deferred along with the rest of this project's test suite
- [ ] T020 Write the Postgres row-level-security migration `apps/api/prisma/migrations/<timestamp>_rls_user_fileobject/migration.sql`: `ALTER TABLE "User" ENABLE ROW LEVEL SECURITY; ALTER TABLE "User" FORCE ROW LEVEL SECURITY;` plus a `CREATE POLICY ... USING ("companyId" = current_setting('app.company_id', true)::uuid) WITH CHECK (...)` for both `User` and `FileObject`; explicitly do **not** enable RLS on `Company`, `Role`, `RefreshToken`, `OtpChallenge`, `AuditEvent` or `IdempotencyKey` (Architecture §5's documented exemption list)
- [ ] T021 Implement CLS wiring + `TransactionInterceptor` in `apps/api/src/common/interceptors/transaction.interceptor.ts`: opens a Prisma `$transaction`, runs `SELECT set_config('app.company_id', $1, true)` before the handler executes, and runs the rest of the request inside that transaction's CLS context (Architecture §5)
- [ ] T022 [P] Implement `RequestIdMiddleware` in `apps/api/src/common/middleware/request-id.middleware.ts` (stamps `x-request-id` into CLS) and wire Helmet, a strict CORS allowlist and body-size limits (10 MB multipart, 1 MB JSON) into `apps/api/src/main.ts` (Architecture §4, §20)
- [ ] T023 [P] Configure `ThrottlerGuard` in `apps/api/src/common/guards/` — or module-level config — for 10 requests/min per IP on `/auth/*`, a 6-failures-per-15-minutes lockout per username on `/auth/login` (FR-010), and 120 requests/min per authenticated user elsewhere (Architecture §4, §20)
- [ ] T024 [P] Implement `JwtAuthGuard` and `ActiveAccountGuard` in `apps/api/src/common/guards/`: the first verifies the HS512 access token and loads its claims; the second rejects when the user's `status != ACTIVE` or the company's `status != ACTIVE`, using one message that does not reveal which (FR-007)
- [ ] T025 [P] Implement `RolesGuard`, `PermissionsGuard` and the `@Roles()`/`@Permissions()` decorators in `apps/api/src/common/decorators/` and `apps/api/src/common/guards/`, matching the `resource:action:scope` permission-string format (Architecture §6)
- [ ] T026 [P] Implement `ZodValidationPipe` in `apps/api/src/common/pipes/zod-validation.pipe.ts` wired through `nestjs-zod`, consuming schemas from `packages/shared`
- [ ] T027 Implement `IdempotencyInterceptor` in `apps/api/src/common/interceptors/idempotency.interceptor.ts`: for annotated command handlers, look up `IdempotencyKey` by the `Idempotency-Key` header; an existing key with a matching request hash replays the stored `statusCode`/`response`; an existing key with a **different** hash returns `409 IDEMPOTENCY_KEY_REUSED` (Architecture §11)
- [ ] T028 [P] Implement `ProblemDetailsFilter` in `apps/api/src/common/filters/problem-details.filter.ts` emitting RFC 9457 `application/problem+json`, and define the error `code` constants in `packages/shared/src/errors.ts`: `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`, `TOKEN_EXPIRED`, `TOKEN_REUSED`, `FORBIDDEN_ROLE`, `CROSS_TENANT`, `VALIDATION_FAILED`, `USERNAME_TAKEN`, `COMPANY_CODE_TAKEN`, `IDEMPOTENCY_KEY_REUSED`, `OTP_INCORRECT`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXHAUSTED`, `RATE_LIMITED`, `NOT_FOUND`, `INTERNAL` (Architecture §4)
- [ ] T029 [P] Implement `AuditInterceptor` in `apps/api/src/common/interceptors/audit.interceptor.ts`: for handlers annotated `@Audited()`, writes one `AuditEvent` row inside the same transaction as the change (Architecture §7/§18)
- [ ] T030 [P] Define the base shared enums in `packages/shared/src/enums.ts` (`RoleKey`, `UserStatus`, `CompanyStatus` mirroring the Prisma enums from T007) so both API DTOs and mobile forms import one definition (Constitution rule 5)
- [ ] T031 Implement the argon2id password-hashing utility in `apps/api/src/infra/security/password.ts`: `hash()`/`verify()` with `memoryCost 19456 KiB, timeCost 2, parallelism 1` (Architecture §6)
- [ ] T032 Implement `TokenService` in `apps/api/src/modules/auth/token.service.ts`: signs HS512 access tokens (15 min; claims `sub, companyId, role, permissions, jti, ver`) and issues rotating refresh tokens (60 days; `familyId`, `jti`), storing only the refresh token's argon2id hash (Architecture §6)
- [ ] T033 Implement `POST /auth/login` in `apps/api/src/modules/auth/auth.controller.ts` + `auth.service.ts` per `contracts/auth.md`: body `{ companyCode?, username, password }` — `companyCode` omitted only for a `SYSTEM_ADMIN` login, scoping the username lookup to `companyId: null` in that case (research.md #1); wrong credentials → `401 INVALID_CREDENTIALS` with an identical message either way; inactive user or suspended company → `403 ACCOUNT_INACTIVE`; returns `{ accessToken, refreshToken, user: { id, name, role, companyId, permissions } }` (FR-005–FR-009)
- [ ] T034 Implement `POST /auth/refresh` in `apps/api/src/modules/auth/auth.controller.ts`: verifies the presented refresh token against its stored argon2id hash, marks it `usedAt`, issues a new pair in the same `familyId`; presenting an already-`usedAt` token revokes every token in that family and returns `409 TOKEN_REUSED` (FR-009, contracts/auth.md)
- [ ] T035 [P] Implement `POST /auth/logout` in `apps/api/src/modules/auth/auth.controller.ts`: revokes the presented refresh token (`revokedAt`), returns `204` (FR-023)
- [ ] T036 Implement `apps/api/prisma/seed.ts`: upserts exactly one `User` with `role.key = SYSTEM_ADMIN`, `companyId = null`, `username = SEED_SYSTEM_ADMIN_USERNAME`, `passwordHash = hash(SEED_SYSTEM_ADMIN_PASSWORD)` — upsert, not insert, so re-running the seed after a restart never duplicates it (research.md #2)
- [ ] T037 [P] Implement the `StorageAdapter` interface and `LocalVolumeAdapter` in `apps/api/src/infra/storage/`: `put/get/delete/exists`, writing under `process.env.RAILWAY_VOLUME_MOUNT_PATH` sharded as `photos/<companyId>/<yyyy>/<mm>/<uuid>.webp` (Architecture §12)
- [ ] T038 Implement the avatar upload pipeline in `apps/api/src/modules/files/files.service.ts`: accept multipart ≤10 MB, `image/jpeg|png|webp|heic`; verify magic bytes (not just the declared `Content-Type`); use `sharp` to auto-rotate from EXIF, strip all other metadata, resize to a 1600 px long edge, encode WebP quality 80, and write a 320 px thumbnail; compute `sha256` and reuse an existing `FileObject` row within the same company on a match instead of duplicating storage (contracts/files.md)
- [ ] T039 Implement `GET /files/:id?token=` in `apps/api/src/modules/files/files.controller.ts`: validates a 10-minute HMAC token (`fileId|userId|exp`) using `FILE_URL_SECRET`, serving the full image or, with `?thumb=1`, the 320 px thumbnail; `401/403 FORBIDDEN` on a missing/expired/invalid token, `404 NOT_FOUND` otherwise (contracts/files.md)
- [ ] T040 [P] Configure `pino` JSON logging in `apps/api/src/main.ts` with `requestId, companyId, userId, route, durationMs` fields and a redaction list covering `password`, `token`, `authorization`, `latitude`, `longitude`, `reasonText`, `otp` (Architecture §18, NFR-10)
- [ ] T041 [P] Scaffold `apps/mobile/src/navigation/RootNavigator.tsx` (role-based navigator stub reading `useSession().role`) and `apps/mobile/src/lib/secureSession.ts` (an `expo-secure-store`-backed session store with getters/setters for the access/refresh pair) and a typed fetch client scaffold in `apps/mobile/src/api/client.ts` that reads request/response shapes from `packages/shared`

**Checkpoint**: `pnpm --filter api dev` boots, Prisma migrations apply, `POST /auth/login` works end-to-end for the seeded System Admin, and the mobile app boots to an empty root navigator. Every user story below can now proceed.

---

## Phase 3: User Story 1 - Provision a company and its first administrator (Priority: P1) 🎯 MVP

**Goal**: A System Admin can create a company and its first Company Admin through the API, with the company fully isolated from every other company.

**Independent Test**: Call `POST /companies` with a System Admin token and a company + admin payload; confirm the company exists with `status: ACTIVE`, the admin can be found by username scoped to that company, and a second company with a colliding `code` is rejected (quickstart.md §1).

### Implementation for User Story 1

- [ ] T042 [P] [US1] Implement the role-seeding helper in `apps/api/src/modules/roles/roles.seed.ts`: given a `companyId`, insert the five `Role` rows (`COMPANY_ADMIN`, `MANAGER`, `MARKETING_EXECUTIVE`, `EMPLOYEE`, and `SYSTEM_ADMIN`'s platform-wide row only if it doesn't already exist with `companyId: null`) with `permissions` mirrored from the matrix in PRD §3
- [ ] T043 [US1] Implement `POST /companies` in `apps/api/src/modules/companies/companies.controller.ts` + `companies.service.ts` per `contracts/companies.md`: `@Roles('SYSTEM_ADMIN')`, `@SkipTenant()`, requires `Idempotency-Key`; in one transaction, create the `Company` (rejecting a duplicate `code` as `409 COMPANY_CODE_TAKEN`, FR-001/FR-003), its `CompanySettings` row with architecture defaults (T009), the seeded roles (T042), and the first `User` with `role.key = COMPANY_ADMIN` built from the request's nested `admin` object (FR-002); writes one `AuditEvent`
- [ ] T044 [US1] Implement `GET /companies` in `apps/api/src/modules/companies/companies.controller.ts`: `@Roles('SYSTEM_ADMIN')`, cursor-paginated (`?cursor=&limit=`), returns `{ id, code, name, status, timezone, createdAt }[]` (contracts/companies.md)
- [ ] T045 [US1] Implement `PATCH /companies/:id` in `apps/api/src/modules/companies/companies.controller.ts`: `@Roles('SYSTEM_ADMIN')`, optional `{ name, place, contactEmail, contactPhone, status }`; setting `status: SUSPENDED` must cause every user in that company — including its Company Admin — to be refused at their **next** sign-in attempt via the `ActiveAccountGuard` from T024 (FR-007)

**Checkpoint**: User Story 1 is independently complete — quickstart.md §1 and §5 (the tenant-isolation spot-check, which only needs `POST /companies` run twice) both pass.

---

## Phase 4: User Story 2 - Sign in and reach the right home screen (Priority: P2)

**Goal**: Company Admin, Manager and Marketing Executive accounts can sign in with username + password only and land on a role-appropriate screen; the Company Admin reaches a home screen with their name and an avatar menu (Profile, Log out); Employees can never sign in.

**Independent Test**: Sign in as a known active Company Admin and confirm the home screen renders their name with the avatar menu; sign in with a wrong password, an inactive account, and confirm each is refused with its specific message; confirm six wrong attempts lock the seventh (quickstart.md §2).

### Implementation for User Story 2

- [ ] T046 [P] [US2] Implement `GET /me` in `apps/api/src/modules/me/me.controller.ts` + `me.service.ts` per `contracts/me.md`: returns `{ id, name, email, username, role, companyId, status, photoUrl, permissions, company }`, with `company` only populated when `companyId` is not null
- [ ] T047 [US2] Add the app-logo asset (screen 0) at `apps/mobile/assets/logo.png` and a presentational `apps/mobile/src/components/AppLogo.tsx` (FR-026)
- [ ] T048 [US2] Build the Sign in screen (1.1) at `apps/mobile/src/features/auth/SignInScreen.tsx`: username + password fields via `react-hook-form` and the login Zod schema from `packages/shared`; renders `<AppLogo>`; maps `INVALID_CREDENTIALS` → "Username or password is incorrect.", `ACCOUNT_INACTIVE` → "This account is not active. Ask your administrator.", a network failure → "No internet connection. Check your signal and try again.", `RATE_LIMITED` → a message naming the lockout, and any other failure → "Something went wrong at our end. Try again in a moment." (PRD §5 error-message table, FR-005–FR-010)
- [ ] T049 [US2] Implement the login success path in `apps/mobile/src/features/auth/SignInScreen.tsx` + `apps/mobile/src/lib/secureSession.ts`: on `200`, store the access/refresh pair via T041's secure session store and attach a fetch/Axios interceptor that, on a `401` from an expired access token, calls `POST /auth/refresh` once and retries the original request, clearing the store and navigating back to Sign in on `TOKEN_REUSED` (research.md #6)
- [ ] T050 [US2] Implement role-based routing in `apps/mobile/src/navigation/RootNavigator.tsx`: after a successful login, `COMPANY_ADMIN` routes to the admin stack; `MANAGER` and `MARKETING_EXECUTIVE` route to a placeholder "your screens are coming in a later update" screen (their own stacks are out of scope here per spec.md's Assumptions)
- [ ] T051 [US2] Build the Company Admin Home screen (4.1) at `apps/mobile/src/features/admin/HomeScreen.tsx`: fetches `GET /me`, shows the signed-in user's `name`, and renders an avatar (top-right) that opens a dropdown offering **Profile** and **Log out** (FR-024)
- [ ] T052 [US2] Wire **Log out** from the Home screen's avatar menu in `apps/mobile/src/features/admin/HomeScreen.tsx`: calls `POST /auth/logout` with the stored refresh token, clears the secure session store, and navigates to the Sign in screen (FR-023)

**Checkpoint**: User Story 2 is independently complete — quickstart.md §2 passes, and this works whether or not User Story 1 ever ran (it only needs one already-existing user, which the seed/quickstart setup provides).

---

## Phase 5: User Story 3 - Company Admin manages users, starting with creating one (Priority: P3)

**Goal**: A Company Admin can view every user in their company and create a new one (any role), with login fields auto-hidden for Employees and duplicate usernames rejected.

**Independent Test**: As a signed-in Company Admin, open Users, create a Manager with full details, confirm they appear in the list, and confirm a repeated username is rejected; create an Employee and confirm no username/password fields were required (quickstart.md §3).

### Implementation for User Story 3

- [ ] T053 [P] [US3] Implement `GET /users` in `apps/api/src/modules/users/users.controller.ts` + `users.service.ts` per `contracts/users.md`: `@Roles('COMPANY_ADMIN')`, tenant-scoped automatically by T019's extension; query params `?cursor=&limit=&search=&role=&status=`, `search` matching `name`, `username` or `email` (FR-015)
- [ ] T054 [US3] Implement `POST /users` in `apps/api/src/modules/users/users.controller.ts`: requires `Idempotency-Key`; rejects with `400 VALIDATION_FAILED` when `username`/`temporaryPassword` are present for `role: EMPLOYEE` or missing for any other role (FR-017); applies the password policy to `temporaryPassword` — **minimum 8 characters, at least one letter and one digit** (FR-013); rejects a duplicate `(companyId, lower(username))` as `409 USERNAME_TAKEN` (FR-006, FR-018); when `halfDayRate` + `rateEffectiveFrom` are supplied, inserts one open-ended `UserSalaryRate` row (FR-016); writes one `AuditEvent` (@Audited)
- [ ] T055 [US3] Implement `PATCH /users/:id` in `apps/api/src/modules/users/users.controller.ts`: optional `{ name, email, status, photoFileId, monthlySalary }`; a cross-tenant `:id` must resolve as `404 NOT_FOUND` (the tenant extension already filters it out, so no special-case code is needed — only the correct not-found handling); setting `status: INACTIVE` bumps `tokenVersion` so outstanding access tokens for that user stop passing `ActiveAccountGuard`-equivalent checks immediately, while every other field and all history stays unchanged (FR-019)
- [ ] T056 [US3] Implement the rate-change path in `apps/api/src/modules/users/users.service.ts`: a `{ halfDayRate, rateEffectiveFrom }` update never edits the existing `UserSalaryRate` row — it sets that row's `effectiveTo = rateEffectiveFrom − 1 day` and inserts a new row with `effectiveTo: null` (FR-020, data-model.md)
- [ ] T057 [P] [US3] Implement `POST /users/:id/salary-rates` in `apps/api/src/modules/users/users.controller.ts` as a thin alias calling the T056 service method, matching the Architecture §9 API table exactly
- [ ] T058 [US3] Build the Users list screen (4.10) at `apps/mobile/src/features/admin/UsersListScreen.tsx`: search input (debounced, matches name/username/email), role and status filter chips, calling `GET /users`; each row shows initials, role, half-day rate and status (FR-015)
- [ ] T059 [US3] Build the User form screen (4.11) at `apps/mobile/src/features/admin/UserFormScreen.tsx` (new/edit states): photo picker, full name, email, status toggle, role picker, monthly salary, half-day rate + effective-from date; the username and temporary-password fields render only when the selected role is not Employee, driven by a single `role` watch in `react-hook-form` (FR-016, FR-017); submits to `POST /users`
- [ ] T060 [US3] Wire the User form's photo field in `apps/mobile/src/features/admin/UserFormScreen.tsx` to upload through `PATCH`/multipart against the files pipeline (T038) before submit, attaching the returned file id as `photoFileId` in the `POST /users` body
- [ ] T061 [US3] Add a **Deactivate** action to `apps/mobile/src/features/admin/UsersListScreen.tsx` (or a user-detail view reached from it): confirms with a dialog stating the user will no longer be able to sign in and that this cannot be undone from this screen, then calls `PATCH /users/:id { status: "INACTIVE" }` (PRD §17 UX rule, FR-019)

**Checkpoint**: User Story 3 is independently complete — quickstart.md §3 passes on top of a Company Admin created by either User Story 1's flow or the quickstart's own seed step.

---

## Phase 6: User Story 4 - View and update own profile, recover a forgotten password (Priority: P4)

**Goal**: Any signed-in user can see their own (mostly read-only) profile and change their photo/password; anyone can recover a forgotten password via a mobile-number OTP.

**Independent Test**: Open Profile as a signed-in Company Admin and change the password, confirming other sessions end; separately, run the forgot-password flow for a user who doesn't know their password, through to a successful sign-in with the new one (quickstart.md §4).

### Implementation for User Story 4

- [ ] T062 [P] [US4] Implement the `SmsAdapter` interface and `LogSmsAdapter` in `apps/api/src/infra/sms/`: `send(toE164: string, message: string): Promise<void>`; the log adapter writes the OTP at `debug` level only (never `info` or above, and never through the pino request-logging pipeline from T040) (research.md #5)
- [ ] T063 [US4] Implement `POST /auth/forgot-password` in `apps/api/src/modules/auth/auth.controller.ts` per `contracts/auth.md`: looks up `username`; when found, creates an `OtpChallenge` (6-digit code, hashed, `expiresAt = now + 10 minutes`) and sends it via `SmsAdapter`; always responds `200 { maskedMobile }` with identical shape and timing whether or not the username exists, so usernames cannot be enumerated (FR-011, Edge Cases)
- [ ] T064 [US4] Implement `POST /auth/verify-otp` in `apps/api/src/modules/auth/auth.controller.ts`: increments `attempts` on each wrong code and returns `400 OTP_INCORRECT` with `attemptsRemaining` until the cap of **5 attempts** is hit (`429 OTP_ATTEMPTS_EXHAUSTED`); `410 OTP_EXPIRED` once `expiresAt` has passed; on a correct code within the window, marks `consumedAt` and returns a short-lived `resetToken` (FR-012); a resend request (`POST /auth/forgot-password` again) less than **30 seconds** after the previous `OtpChallenge.createdAt` is rejected rather than creating a second live challenge
- [ ] T065 [US4] Implement `POST /auth/reset-password` in `apps/api/src/modules/auth/auth.controller.ts`: requires a valid `resetToken`, `newPassword` + `confirmPassword` matching and satisfying **minimum 8 characters, at least one letter and one digit, and different from the current password** (FR-013); on success, revokes every other active `RefreshToken` for that user (bumps `tokenVersion`) (FR-014)
- [ ] T066 [US4] Implement `POST /auth/change-password` in `apps/api/src/modules/auth/auth.controller.ts`: requires `currentPassword` (verified against the stored hash) plus `newPassword` twice under the same FR-013 policy; revokes every other active session on success (FR-014)
- [ ] T067 [US4] Implement `PATCH /me/photo` in `apps/api/src/modules/me/me.controller.ts`: multipart avatar upload reusing the T038 pipeline, updates only the caller's own `photoId` — no other field is reachable through this endpoint (FR-022)
- [ ] T068 [US4] Build the Profile screen (4.14) at `apps/mobile/src/features/admin/ProfileScreen.tsx`: shows name and email with a lock icon (read-only, FR-021), status, current photo with a "change photo" action calling `PATCH /me/photo`, and a "Change password" link
- [ ] T069 [US4] Build the Change password screen (1.10) at `apps/mobile/src/features/auth/ChangePasswordScreen.tsx`: current password + new password (×2) fields enforcing the FR-013 policy client-side before submit, calling `POST /auth/change-password`, and on success routing back to Sign in (since other sessions — including, potentially, this one's refresh token — were just revoked)
- [ ] T070 [US4] Build the Forgot password screen (1.2) at `apps/mobile/src/features/auth/ForgotPasswordScreen.tsx`: username entry → masked-mobile confirmation → 6-digit OTP entry (showing attempts remaining, an expiry countdown, and a resend action disabled until 30 seconds have passed) → new password entry (×2); chains `POST /auth/forgot-password` → `POST /auth/verify-otp` → `POST /auth/reset-password`, mapping `OTP_INCORRECT`/`OTP_EXPIRED` to the PRD §5 copy ("That code is not correct. N attempts left." / "That code has expired. Tap Resend OTP.")

**Checkpoint**: User Story 4 is independently complete — quickstart.md §4 passes against any existing user, regardless of whether it was created via User Story 1 or User Story 3.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all four stories together.

- [ ] T071 [P] Run the full `quickstart.md` walkthrough end-to-end against a freshly migrated and seeded database, confirming every numbered expectation in §1–§5 holds
- [ ] T072 [P] Audit every log statement touched by this feature against the NFR-10 redaction list (`password`, `token`, `authorization`, `latitude`, `longitude`, `reasonText`, `otp`) — grep `apps/api/src` for any direct `console.log`/unredacted `logger` call that could leak one of these
- [ ] T073 Re-run quickstart.md §5 (two companies, one with a deliberately repeated admin username) and confirm the `GET /users` list for one company never includes the other's rows
- [ ] T074 [P] Wire OpenAPI generation (`nestjs-zod` + `@nestjs/swagger`) for the `auth`, `companies`, `users`, `me` and `files` modules and commit the generated spec to `docs/openapi.json` (Architecture §9)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story**, including User Story 1 — its own independent test calls an authenticated endpoint, so login (T033) must already exist.
- **User Stories (Phase 3–6)**: All depend only on Foundational, not on each other:
  - **US1** (company provisioning) needs nothing from US2–US4.
  - **US2** (sign-in + home) needs an existing user to sign in as — satisfied by the seeded System Admin or any user US1/US3 creates, but does not need US1's or US3's *code* to exist, only *a* user row.
  - **US3** (user management) needs a signed-in Company Admin — satisfied the same way.
  - **US4** (profile + forgot password) needs any existing, signed-in-or-not user — same.
  - In practice, build in priority order (US1 → US2 → US3 → US4) since each successive story is easiest to demo once the previous one exists, but none of their *code* imports another's.
- **Polish (Phase 7)**: Depends on all four user stories being complete.

### Within Each User Story

- Backend model/service tasks before the screens that call them.
- `POST`/`PATCH` write endpoints before the screens that submit to them; `GET` endpoints can run in parallel with unrelated write endpoints in the same story.

### Parallel Opportunities

- All `[P]` tasks in Phase 1 (T002–T006) run in parallel.
- All `[P]` Prisma model tasks in Phase 2 (T008–T017) run in parallel (same file, but additive/non-overlapping sections — coordinate if more than one person edits `schema.prisma` at once), followed by the single T018 migration.
- T022–T030 (guards, pipes, filters, interceptors) are independent files and run in parallel.
- Once Phase 2 is checkpointed, US1, US2, US3 and US4 can be staffed to four different people simultaneously — none of them touches another's files except the shared `schema.prisma` (already finished in Phase 2) and `packages/shared` (additive exports, low collision risk).

---

## Parallel Example: Phase 2 Prisma models

```bash
Task: "Define the Company model in apps/api/prisma/schema.prisma"
Task: "Define the CompanySettings model in apps/api/prisma/schema.prisma"
Task: "Define the Role model in apps/api/prisma/schema.prisma"
Task: "Define the User model in apps/api/prisma/schema.prisma"
Task: "Define the UserSalaryRate model in apps/api/prisma/schema.prisma"
Task: "Define the RefreshToken model in apps/api/prisma/schema.prisma"
Task: "Define the OtpChallenge model in apps/api/prisma/schema.prisma"
Task: "Define the FileObject model in apps/api/prisma/schema.prisma"
Task: "Define the IdempotencyKey model in apps/api/prisma/schema.prisma"
Task: "Define the AuditEvent model in apps/api/prisma/schema.prisma"
# then, once all land: T018 migrate dev
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1).
2. **STOP and VALIDATE**: run quickstart.md §1 — a System Admin provisions "Sri Ramana Traders" and its first Company Admin, with the duplicate-code and idempotency-replay checks passing.
3. This alone is demoable to the business as "the platform can onboard a company," even with zero mobile screens built yet.

### Incremental Delivery

1. Setup + Foundational → working auth/tenant/file infrastructure, nothing user-visible yet.
2. Add US1 → System Admin can provision companies (API-only demo).
3. Add US2 → Company Admin can sign in and see Home (first real mobile demo).
4. Add US3 → Company Admin can staff the company with Managers/Executives/Employees.
5. Add US4 → self-service profile and password recovery round out the release.
6. Each story's checkpoint is independently demoable without the next one existing yet.
