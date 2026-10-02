# Implementation Plan: Company Provisioning, User Management & Sign-In

**Branch**: `001-company-user-auth` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-company-user-auth/spec.md`

## Summary

Stand up the monorepo's first vertical slice: a System Admin can provision a company and its first Company Admin through the API only; any eligible role (Company Admin, Manager, Marketing Executive — never Employee) can sign in with just username + password, recover a forgotten password by OTP, and manage their own profile and session; and a Company Admin can view and create users in their company. Technically this is the auth/session stack (stateless JWT, rotating refresh, argon2id, OTP reset) plus the `Company` and `User` slivers of the data model, wired through the two-layer tenant-isolation pipeline, surfaced on the mobile app's Sign in, Forgot password, Company Admin Home, Profile and Users (list + form) screens.

## Technical Context

**Language/Version**: TypeScript throughout (strict mode); Node.js 22 LTS for the API, Expo SDK's current React Native runtime for mobile (per Architecture D-02, D-08).

**Primary Dependencies**: NestJS 11 + `nestjs-zod` + `@nestjs/jwt` + `argon2` + `@nestjs/throttler` + `@nestjs/schedule` (cleanup job) on the API; Prisma 6 as the ORM; Zod schemas in `packages/shared` shared by both sides; Expo (prebuild/EAS) + NativeWind (Tailwind) + React Navigation + TanStack Query + Zustand + MMKV + `react-hook-form` on mobile (D-03, D-08, D-09, D-10).

**Storage**: PostgreSQL 16 on Railway via Prisma migrations (D-04); user avatar photos through the `StorageAdapter` → Railway volume path described in Architecture §12 (only the `USER_AVATAR` `PhotoKind`, not shop photos — those stay out of scope here).

**Testing**: None for this feature. CLAUDE.md's standing testing policy explicitly suspends unit and integration test authoring project-wide "for now," overriding Architecture §19's Vitest/Jest strategy; this plan is verified instead through the manual/scripted walkthrough in `quickstart.md`. If a future task explicitly asks for tests, that request overrides the policy for that task only.

**Target Platform**: API as a single-replica Node service on Railway (Linux); mobile as an Android-first, iOS-ready Expo app, one build per company (D-08, §16.1).

**Project Type**: Mobile + API monorepo (existing architecture layout — `apps/api`, `apps/mobile`, `packages/shared`; this feature creates that layout, since no source code exists yet per CLAUDE.md).

**Performance Goals**: Sign-in and profile/user-admin requests meet the general API budget in NFR-02 (95th percentile under 3 s); Company Admin reaches a usable Home screen within the 3 s cold-start budget in NFR-14 with a warm cache.

**Constraints**: Stateless JWT only — no server-side session store (D-06); every tenant-scoped read/write to `User` goes through both the Prisma tenant extension and Postgres RLS (Architecture §5); `Company`, `Role`, `RefreshToken`, `OtpChallenge`, `AuditEvent`, `IdempotencyKey` are deliberately **not** RLS-enabled (guarded in application code instead, per the §5 caveat) because they are platform-level, pre-tenant-context, or already scoped by foreign key; every state-changing POST (`/companies`, `/users`, password change/reset) carries and checks an `Idempotency-Key` (D-15, BUS-22); sign-in, profile and user-admin actions are **not** part of the mobile offline queue — §16 limits queueing to visit submission, extra-shop, pin capture and beat start/end, so these flows simply fail fast and ask the user to retry when offline; no password, OTP, token or coordinate value may reach a log line (NFR-10).

**Scale/Scope**: Pilot is a single company (Sri Ramana Traders) but the schema and tenancy layers must already hold for many companies, since isolation is proven by this slice's own tests-equivalent (the quickstart walkthrough) before any later slice builds on it. In-scope screens: `0` (logo), `1.1` (sign in), `1.2` (forgot password · OTP), `1.10` (change password), `4.1` (Company Admin home), `4.10`/`4.11` (users list / user form), `4.14` (Company Admin profile) — eight screens plus the System-Admin-only company-provisioning API.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template (bracketed placeholders only) — it has not been ratified for this project. The project's actual governing rules are CLAUDE.md's "Non-negotiable architectural rules" (sourced from Architecture §1 and the §21 constitution draft). This feature is checked against those nine rules directly:

| # | Rule | Applies here? | Gate result |
|---|---|---|---|
| 1 | Server owns the truth | Yes — `companyId`, `role`, `tokenVersion` are always server-set, never trusted from the client (FR-025) | **PASS** |
| 2 | Tenant isolation, two independent layers | Yes — `User`, and the avatar's `FileObject`, carry `companyId` and get both the Prisma extension and Postgres RLS; `Company`/`Role`/`RefreshToken`/`OtpChallenge`/`AuditEvent`/`IdempotencyKey` are the architecture's documented RLS exemptions, guarded in code instead | **PASS** |
| 3 | Commands are idempotent | Yes — company provisioning, user creation, password change/reset all take an `Idempotency-Key` | **PASS** |
| 4 | History is append-only | Yes — role and half-day-rate changes create new dated rows (FR-020); deactivation never deletes (FR-019) | **PASS** |
| 5 | One contract | Yes — every request/response shape (login, company-create, user-create, profile, OTP) is defined once in `packages/shared` as Zod, consumed by both API and mobile | **PASS** |
| 6 | Role visibility is explicit and structural | Not triggered — this slice carries no `distanceMeters`/range fields; noted for later slices to continue the same interceptor pattern | **N/A** |
| 7 | The field app assumes a bad network | Partially — these flows are deliberately **excluded** from the offline outbox (per §16, only visit/extra-shop/pin/beat-day actions queue); on failure the UI shows a retry, it does not silently queue an auth or admin mutation | **PASS (by exclusion, documented)** |
| 8 | Times are UTC in storage, company-local in meaning | Yes — `createdAt`/`updatedAt`/OTP expiry are `timestamptz` UTC; no `businessDate` derivation is needed by this slice | **PASS** |
| 9 | No secret/token/password/coordinate in any log line | Yes — `password`, `token`, `authorization`, `otp` stay on the pino redaction list (Architecture §18) | **PASS** |

No violations to justify; **Complexity Tracking is empty**.

**Post-design re-check** (after Phase 1): `data-model.md` and `contracts/` confirm every tenant-scoped model (`User`, avatar `FileObject`) stays inside the two-layer isolation boundary, every mutating endpoint declares its `Idempotency-Key` requirement, the salary-rate shape is append-only by construction, and no contract exposes a client-settable `companyId`/`role`/`tokenVersion`. No new violations were introduced during design; the gate still passes.

## Project Structure

### Documentation (this feature)

```text
specs/001-company-user-auth/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

This is the first feature in the repo, so it also lays down the monorepo skeleton the architecture document describes. Only the pieces this feature needs are listed; later slices (shops, beat plans, visits, attendance, salary…) add their own modules/features alongside these without restructuring them.

```text
field-sales/                                  # repo root (pnpm workspaces + Turborepo)
├─ apps/
│  ├─ api/                                    # NestJS
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma                     # Company, CompanySettings, Role, User,
│  │  │  │                                    # UserSalaryRate, RefreshToken, OtpChallenge,
│  │  │  │                                    # FileObject, AuditEvent, IdempotencyKey (this slice's subset)
│  │  │  └─ seed.ts                           # one-time bootstrap: the first SYSTEM_ADMIN user
│  │  ├─ src/
│  │  │  ├─ main.ts  app.module.ts
│  │  │  ├─ common/                           # guards (Jwt, ActiveAccount, Roles, Permissions),
│  │  │  │                                    # ZodValidationPipe, IdempotencyInterceptor,
│  │  │  │                                    # TransactionInterceptor, ProblemDetailsFilter
│  │  │  ├─ infra/                            # prisma client + tenant extension, cls, storage
│  │  │  │                                    # adapter, sms adapter (OTP), clock
│  │  │  └─ modules/
│  │  │     ├─ auth/                          # login, refresh, logout, forgot/verify/reset,
│  │  │     │                                 # change-password
│  │  │     ├─ companies/                     # System-Admin-only provisioning
│  │  │     ├─ roles/                         # seeded role + permission rows
│  │  │     ├─ users/                         # Company Admin CRUD, salary-rate history
│  │  │     ├─ me/                            # /me, /me/photo
│  │  │     ├─ files/                         # avatar upload + signed URL serving
│  │  │     └─ audit/                         # AuditEvent writer used by users + auth
│  │  └─ test/                                # present but empty per the no-tests-for-now policy
│  └─ mobile/                                 # Expo React Native
│     ├─ app.config.ts                        # per-company build config (COMPANY_CODE, API_URL)
│     ├─ src/
│     │  ├─ api/                              # typed client + query hooks generated from
│     │  │                                    # packages/shared
│     │  ├─ features/
│     │  │  ├─ auth/                          # 1.1 sign in, 1.2 forgot password, 1.10 change password
│     │  │  └─ admin/                         # 4.1 home, 4.10 users list, 4.11 user form, 4.14 profile
│     │  ├─ components/  theme/  navigation/  # role-based navigator picks the admin stack
│     │  └─ lib/                              # secure-store session storage, logger
│     └─ assets/                              # screen 0 — app logo
├─ packages/
│  └─ shared/                                 # Zod schemas + inferred types for every contract
│     └─ src/{auth,companies,users,me}.schema.ts
├─ turbo.json  pnpm-workspace.yaml  package.json
```

**Structure Decision**: Mobile + API monorepo, matching Architecture §3 exactly. This feature creates `apps/api`, `apps/mobile` and `packages/shared` for the first time (001-foundation's concern) and populates only the `auth`, `companies`, `roles`, `users`, `me`, `files` and `audit` API modules plus the mobile `auth` and `admin` features — every other module/feature directory named in Architecture §3 is created by its own later slice, not by this one.

## Complexity Tracking

*No Constitution Check violations — table intentionally empty.*
