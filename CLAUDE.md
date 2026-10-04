# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state: docs/specs only, no code yet

This repository currently contains **no application source code** — only product/architecture documentation (`docs/`) and a freshly-initialized GitHub Spec Kit workflow (`.specify/`, `.claude/skills/speckit-*`). There is no `package.json`, build, lint, or test command to run yet. The monorepo, toolchain and first module are built by Spec Kit slice `001-foundation` (see "Build order" below).

Primary sources (read these, not this summary, for anything non-trivial):
- `docs/product/01-BRD.md` — business requirements, roles, business rules (`BUS-*`), risks, open decisions (`OD-*`)
- `docs/product/02-PRD.md` — screen-by-screen behaviour, functional requirements (`FR-*`), validation rules, NFRs
- `docs/product/03-ARCHITECTURE.md` — tech decisions (`D-*`), full Prisma schema, API surface, request pipeline, mobile architecture
- `docs/ui-design/Field_Sales_Beat_App.html` — the 37-artboard visual reference for the screen inventory in PRD §4
- `docs/coding_standard.md` — NestJS/TypeScript/Prisma coding rules (see caveat below)

When a requirement is ambiguous, BRD/PRD/ARCHITECTURE win over this file; this file is a map, not the source of truth.

## What this product is

Field Sales & Beat Execution: a company-scoped mobile app for distributor field teams (pilot: Sri Ramana Traders). A **beat** is a shop's fixed daily route. Executives visit shops, record one outcome per shop (order or no-order), and the server independently measures and stores the distance between the shop's approved coordinates and the executive's device location at submission time — this is the core "visit authenticity" concern (BRD §1). The system flags exceptions for manager review; it never blocks on them and never auto-accuses anyone.

Five roles, one per user per company in release 1: **System Admin** (platform, API-only, no mobile screens), **Company Admin** (masters, reports, salary — mobile), **Manager** (attendance, daily review, extra shops — mobile), **Marketing Executive** (runs the beat — mobile), **Employee** (attendance/salary subject only, no login). The Marketing Executive is **never** shown `distanceMeters`, `isExceedRange` or quality flags, in any screen or API response — this is enforced structurally (a serialisation interceptor keyed on a permission), not just hidden in the UI, and is covered by a test per endpoint.

## Build order (Spec Kit slices)

Architecture §21 lays out 16 slices, each a full vertical (migration + API + tests + mobile screen — "backend done, UI later" is explicitly disallowed by the engineering constitution). Build and reason about them in this order:

```
001-foundation        002-auth-and-session   003-company-and-users  004-masters
005-files-and-photos  006-shops              007-beat-plans         008-beat-day
009-visits-and-orders 010-extra-shops        011-attendance         012-manager-review
013-salary            014-reports-and-export 015-notifications      016-hardening
```

`009-visits-and-orders` is the critical path (visit submission) and `008-beat-day` (start/end lifecycle) gates it — nothing in 009–012 makes sense without 008 first. Use `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement` per slice.

## Testing policy (current)

**Do not write unit test cases or integration test cases for this application for now.** This is an explicit, standing instruction and overrides Architecture §19's testing strategy (Vitest unit tests, Jest/Testcontainers integration tests, etc.) and the "migration + API + tests + mobile screen" vertical described above — build each slice without its test layer until this policy changes. If a specific task explicitly asks for tests, that request overrides this note for that task only.

## Non-negotiable architectural rules

These come from Architecture §1 (decisions) and §21 (engineering constitution draft) and apply to every slice:

1. **The server owns the truth.** `distanceMeters`, `isExceedRange`, flags, totals, payable units and audit records are always server-computed. A client-sent value for any of them is rejected by schema validation, never silently ignored.
2. **Tenant isolation, two independent layers.** Every tenant table carries `companyId`. Layer 1: a Prisma client extension injects/filters `companyId` from CLS-stored request context (never from client input) — a DMMF-driven test asserts every tenant model is registered. Layer 2: Postgres RLS with `FORCE ROW LEVEL SECURITY`, set via `SET LOCAL app.company_id` inside the same transaction as the Prisma extension's work. A new tenant table missing either layer must fail CI.
3. **Commands are idempotent.** Every state-changing POST takes an `Idempotency-Key`; a retry with the same key replays the stored response rather than duplicating the record. Keys are ULIDs minted on the mobile device so a timeout-retry carries the same key.
4. **History is append-only.** Attendance amendments, salary corrections, shop pin changes: new versioned rows with a reason and an actor, never an overwrite. `DailyAssignment` snapshots (shop list, sequence, effective radius) are frozen at creation — a later beat-plan or master-data edit never rewrites a past or in-progress day.
5. **One contract.** Request/response shapes are defined once in `packages/shared` with Zod; both the NestJS API (`nestjs-zod`) and the React Native app derive types and validation from it.
6. **Role visibility is explicit and structural**, not a UI-layer convenience (see Executive/range-fields rule above).
7. **The field app assumes a bad network.** Visit submission, extra-shop add, pin capture, and beat start/end are queued in a SQLite outbox and sync FIFO with the same idempotency key; reads are never queued (cached + a "showing saved data" banner instead).
8. **Times are UTC in storage, company-local in meaning.** Only a single `CompanyClock` service (Luxon) converts; `businessDate` is always derived from company timezone, not client clock.
9. **No secret, token, password, precise coordinate or free-text reason** in any log line or analytics payload (redaction list exists for exactly this).

## Core domain mechanics worth understanding before touching any slice

- **Beat-day state machine**: `(no row) → RUNNING → ENDED`, with a nightly job force-transitioning a forgotten day to `AUTO_CLOSED`. Lives on `DailyAssignment` (one row per executive per business day) — "is the beat running" is a single row lookup, not a join. Starting/ending twice returns the existing row with `200`, never an error (safe for double-taps and retries). No visit, extra stop, or pin capture is allowed outside `RUNNING`.
- **Visit submission critical path** (Architecture §10): idempotency check → tenant-scoped load of stop/assignment/shop inside the transaction → reject if not RUNNING/not-mine/already-completed/pin-not-approved → compute flags (`LOW_ACCURACY`, `STALE_LOCATION`, `MOCK_LOCATION_SUSPECTED`, `OFFLINE_SUBMISSION`) → Haversine distance against the **approved shop coordinate snapshot** → `effectiveRadius` = shop override or company default → `EXCEED_RANGE` + `PENDING_REVIEW` if exceeded → create Visit (+Order/OrderLines atomically) → mark stop `COMPLETED` → audit → commit → push notification *after* commit (so a push failure can't roll back a saved visit).
- **Extra shops** never touch the saved `BeatPlan` — they're `AssignmentStop` rows tagged `EXEC_EXTRA`/`MANAGER_EXTRA` on that day's `DailyAssignment` only.
- **Shop pin lifecycle**: a shop can exist without coordinates; first outcome there requires a saved, approved pin (accuracy-gated, source tracked as `GPS`/`MAP_SEARCH`/`MANUAL_DRAG`). Executives cannot edit a saved pin directly — only raise a `ShopPinChange` request for Manager/Admin approval, with full before/after history.
- **Salary**: `Σ(payable half-day units × the half-day rate effective on that date)`. Rate changes are effective-dated rows, never edits, so any historical month reproduces exactly. Finalising a run locks it; later corrections create a new version (v2, v3…) while earlier versions stay readable.
- **Auth**: username+password only — the company code comes from the mobile build config (one APK per company), not a login field. Access JWT 15 min, rotating refresh 60 days with reuse detection (a replayed refresh token revokes its whole token family). `tokenVersion` bump invalidates all outstanding access tokens without a per-request DB lookup.

Full data model, API surface table, and request-pipeline stage order are in Architecture §4, §7, §9 — read those directly when implementing a slice rather than re-deriving them.

## Coding standard — caveat

`docs/coding_standard.md` is written against generic NestJS/Prisma/Supabase conventions (strict TypeScript, no `any`, DTO validation via `class-validator`, guards-not-inline-ifs for authorization, the `TenantPrismaService.runInTenantContext` pattern, snake_case-in-Postgres/camelCase-in-code, hand-edited migrations for RLS/triggers, money-as-integer). **Apply those general rules**, but its concrete module list (`companies/roles/categories/departments/users/auth/profile/products/staff-orders/student-orders/payments/notifications`) and its "ProjectEstimation API" framing belong to a different project and do not match this one — for the actual module boundaries, API surface and request pipeline, follow `03-ARCHITECTURE.md` §3/§4/§9 instead. Note also that this project's request pipeline differs in one way `coding_standard.md` doesn't mention: tenant context here is Zod + `nestjs-zod` validated (not `class-validator`), per Architecture D-10.
