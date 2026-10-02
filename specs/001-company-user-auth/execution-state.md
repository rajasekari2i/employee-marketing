# Execution State

<!-- updated: 2026-10-02 -->
<!-- tracking: GitHub Issues #1-#41 on https://github.com/users/rajasekari2i/projects/3 (no BEADS) -->

## Current Position

- Active work unit: WU-04
- Current phase: not yet started
- Branch: `001-company-user-auth` (pushed; PR #75 open against `main`)
- Retry count: 0

## Work Unit Status

| WU | Tasks | GitHub Issues | Status | Phase | Retries |
|----|-------|---------------|--------|-------|---------|
| WU-01 | T001-T006 | #1-#6 | **COMPLETE** | COMMITTED (5b0faad, on `main`) | 0 |
| WU-02 | T007-T018 | #7-#18 | **COMPLETE** | COMMITTED (b5a5f98, on `main`) | 0 |
| WU-03 | T019-T021 | #19-#21 | **COMPLETE** | COMMITTED (997f337, branch `001-company-user-auth`, PR #75) | 2 (both legitimate FAILs, both fixed) |
| WU-04 | T022-T030 | #22-#30 | PENDING | — | 0 |
| WU-05 | T031-T036 | #31-#36 | PENDING | — | 0 |
| WU-06 | T037-T039 | #37-#39 | PENDING | — | 0 |
| WU-07 | T040-T041 | #40-#41 | PENDING | — | 0 |

## Blocked / Escalated

None currently.

## Project Context (tooling)

- Package manager: pnpm 12.8.1 (workspaces, `node-linker=hoisted`) + Turborepo 2.x
- API: NestJS 11, Node 22 LTS (dev machine runs Node 24, compatible), TypeScript strict, Prisma 6 (not yet installed as a dependency — WU-02), PostgreSQL 16
- Mobile: Bare React Native CLI (React Native 0.86, own `android/`/`ios/` native projects, no Expo SDK/EAS — switched 2026-10-02, see Architecture D-08), NativeWind 4, React Navigation 7
- Shared: `packages/shared` (Zod schemas + inferred types), built with tsup, dual CJS/ESM + types
- Lint: one shared ESLint 9 flat-config base at `packages/config/eslint-base.mjs` (type-checked rules via `typescript-eslint`), consumed by all three lintable packages (`api`, `mobile`, `@field-sales/shared`); one root `.prettierrc` (`singleQuote: true, trailingComma: "all"`)
- No test runner configured — CLAUDE.md's standing no-tests-for-now policy applies; VALIDATE phase runs `tsc --noEmit`, lint, and build only.

## Completed Work Units

| WU | Title | Key Files | Notes |
|----|-------|-----------|-------|
| WU-01 | Monorepo & tooling scaffold | `apps/api/**`, `apps/mobile/**`, `packages/config/**`, `packages/shared/**`, root `package.json`/`pnpm-workspace.yaml`/`turbo.json` | Fixed two real gaps found during VALIDATE: `packages/shared`/`apps/mobile` had no local `eslint` (fell through to a stray global v6.4.0); `apps/api`'s lint config never actually used the "shared" config. Resolved with a genuinely shared flat-config base + root Prettier config. |
| WU-02 | Prisma schema & initial migration | `apps/api/prisma/schema.prisma` (10 models + 4 enums), `apps/api/prisma/migrations/20261002105434_init_company_user_auth/` | Caught and fixed a real gap: the orchestrator's own task instructions had dropped two `@default(...)` values Architecture §7 specifies (`CompanySettings.payableUnitByStatus`/`notificationsEnabled`). Required a `prisma migrate reset --force` on the local dev DB to regenerate one clean migration — Prisma itself blocked this pending explicit user consent (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`), which was obtained before proceeding. Local DB setup: Postgres 16 on :5432, `postgres`/`postgres`, database `field_sales` created fresh. `users.roleId` is a mandatory (non-nullable) FK with `ON DELETE RESTRICT`. |
| WU-03 | Tenant isolation layer | `apps/api/src/infra/prisma/tenant.extension.ts`, `apps/api/src/common/interceptors/transaction.interceptor.ts`, `apps/api/prisma/migrations/20261002110942_rls_user_fileobject/`, `apps/api/src/app.module.ts` (CLS), `apps/api/package.json`/`.env`/`.env.example` (app_user role split) | Took 3 adversarial review rounds — 2 legitimate FAILs, both fixed: (1) System Admin's `companyId IS NULL` row was permanently unreachable under the initial RLS policy (SQL `NULL = anything` is never true) — added the `app.is_system_context` escape; (2) that escape was only applied to `users`, not `file_objects`, despite both needing it identically — fixed to match. Also discovered mid-review that `package.json`/`.env`/`.env.example` were never added to WU-03's written file scope even though the IMPLEMENT instructions always required them — amended the plan document itself (same pattern as the WU-04 `@Public()` amendment) rather than treating it as a one-off exception. `TransactionInterceptor` is built but deliberately NOT globally registered — that's WU-04's job (see below). |

## Architecture Pivot (2026-10-02, post-WU-03)

The user explicitly requested removing Expo entirely in favor of the bare React Native CLI, after being told Expo apps are already React Native (not a different framework) and understanding the tradeoffs: losing EAS's per-company build-profile mechanism (replaced by native Android product flavors / iOS schemes, see Architecture D-08 and §16.1 "One build per company"), and that WU-01's Expo-based mobile scaffold (already reviewed and merged to `main`) needs to be replaced. Updated: `docs/product/03-ARCHITECTURE.md` (D-08, §2, §3, §16, §16.1, §20, open-decision T-05), `specs/001-company-user-auth/plan.md`, `tasks.md`, `research.md`, `orchestration-plan.md`. The actual `apps/mobile` rebuild is tracked as its own follow-up work (not a renumbered WU — it replaces WU-01's mobile deliverable specifically).

## Established Patterns

- **ESLint**: every package's `eslint.config.mjs` imports `createBaseConfig` from `@field-sales/config/eslint-base.mjs` and spreads it first, then layers project-specific overrides. Root-level tool config files (`*.config.{js,cjs,ts}`, `babel.config.js`) get `tseslint.configs.disableTypeChecked` spread into a `files`-scoped override, since they sit outside each package's own `tsconfig.json` `include`.
- **tsconfig `exclude` is NOT inherited/merged** from a parent `extends` — any child tsconfig that adds its own `exclude` must repeat the base's exclusions too (a bug `apps/mobile/tsconfig.json` ran into against the now-superseded Expo base tsconfig; re-verify whichever base config the bare-RN rebuild uses has the same property, since this is a general TypeScript gotcha, not an Expo-specific one).
- **Env validation**: `packages/shared/src/env.ts`'s `loadEnv()` is the single source of truth for required env vars (Constitution rule 5); it throws rather than exiting, so callers that must hard-exit (`apps/api/src/main.ts`) catch and call `process.exit(1)` themselves.
- **Local dev database**: Postgres 16 on `localhost:5432`, role `postgres`/password `postgres`, database `field_sales`. `apps/api/.env` (gitignored) holds the working `DATABASE_URL`. Snake_case-in-Postgres/camelCase-in-Prisma via `@map`/`@@map` on every model (per `docs/coding_standard.md`, applied starting WU-02).
- **Destructive Prisma commands** (`migrate reset`, etc.): Prisma itself detects AI-agent invocation and refuses without `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set to the user's exact consent text. Always surface this to the user and wait for explicit, unambiguous consent before setting that env var — never route around it via raw `psql` DROP/CREATE.
- **Two DB connections, deliberately**: `apps/api/.env`'s `DATABASE_URL` connects as `app_user` (non-superuser, RLS-enforced — Postgres bypasses RLS entirely for superusers/table owners regardless of `FORCE`, so the live API must never connect as `postgres`). `MIGRATE_DATABASE_URL` (superuser) is a separate var, substituted in only for `prisma migrate *` commands: `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate dev --name <name>`.
- **RLS + the System Admin's NULL-companyId row (for WU-05)**: the `users`/`file_objects` RLS policies fail closed on `NULL`/unset `app.company_id` (SQL `NULL = x` is never true) — this correctly blocks tenant-scoped sessions from ever seeing the System Admin's row, but also means that row needs its own path:
  - **Seed script** (`prisma/seed.ts`, one-time deploy-time bootstrap, not a live request): use a **separate, unextended `PrismaClient`** connected via `MIGRATE_DATABASE_URL` (superuser) for the one insert that creates the `SYSTEM_ADMIN` `Role` row (`companyId: null`) and the seed `User` row. Bypasses RLS and the Layer-1 tenant extension entirely — appropriate for a trusted, non-request-driven action. Never give the *live* API process superuser DB credentials for this.
  - **System-Admin login lookup** (`/auth/login` with no `companyCode`, a genuine live-request runtime path, still connects as `app_user`): must `SELECT set_config('app.is_system_context', 'true', true)` inside its own transaction before querying `User` for a `companyId: null` row. This session flag is scoped **only** to `companyId IS NULL` rows (verified: setting it does NOT grant visibility into other tenants' real rows) — never set it for an ordinary tenant-scoped request.
  - Research.md #1 (reusing `/auth/login` with optional `companyCode`) and this `is_system_context` mechanism are two halves of the same System-Admin-login design — WU-05's coding subagent prompt must reference both.
