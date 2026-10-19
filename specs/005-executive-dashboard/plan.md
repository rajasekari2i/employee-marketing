# Implementation Plan: Executive Dashboard — Today's Beat

**Branch**: `005-executive-dashboard` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-executive-dashboard/spec.md`

## Summary

Give the Marketing Executive their first working screen. Today an executive who signs in gets a one-line "coming soon" placeholder; this slice builds their whole mobile shell — a third navigation stack, a three-tab bottom bar — and the **Today's beat** screen (board 1.3) in all four of its states: not started, running, the inline end-confirmation, and ended.

Behind it, two new tables carry both the day's frozen route and its lifecycle on one row, so "is the beat running?" is a single field on the record the screen has already loaded. Today's route is created **the first time the executive opens the screen** on a working day rather than by an overnight job — the user's decision — with a unique index on `(company, business date, executive)` as the concurrency guarantee rather than a scheduler or a lock.

Three things make this slice materially different from the four admin CRUD slices before it. It is the **first feature to read the device's position**, which the app cannot do at all today and which forces a native rebuild. It introduces the **first company-local date derivation**, as a single `CompanyClock` service. And it is the first screen where Constitution rule 6 bites in a concrete way: the stop payload deliberately withholds `effectiveRadiusMeters` so the device cannot derive its own range verdict.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **One new runtime dependency**: `@react-native-community/geolocation`. Permissions use React Native core's `PermissionsAndroid` — no second package (research.md §3). **No new API dependency**: `CompanyClock` uses Node's built-in `Intl`, not Luxon (research.md §2).

**Storage**: PostgreSQL via Prisma. Two new models (`DailyAssignment`, `AssignmentStop`), three new enums, and three additive back-relations on `User`, `BeatPlan` and `Shop`. No existing column changes.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API as every prior slice. **Unlike every prior slice, this one requires a native rebuild** (`pnpm --filter mobile android`), not a Metro reload — a new native module plus two new manifest permissions.

**Project Type**: Mobile app + API, monorepo — no new structure, but the first `features/executive/` folder alongside `features/admin/` and `features/auth/`.

**Performance Goals**: The route loads and renders within the spec's 10-second sign-in-to-visible target (SC-001); start-to-running within 15 seconds including the permission grant (SC-002); the elapsed timer stays accurate to the second across backgrounding (SC-009).

**Constraints**: Pixel-exact match to board 1.3 in all four states (FR-024); two-layer tenant isolation on both new tables **plus** per-executive scoping within the tenant; both commands idempotent and replay-safe beyond what the idempotency key alone gives; the business date always company-local; no coordinate in any log (FR-026); and the executive payload free of radius, distance and flag fields.

**Scale/Scope**: 1 new mobile screen + 1 new bottom-nav component + a third navigation stack; 1 new API module (`assignments`: 1 read, 2 commands); 1 new shared service (`CompanyClock`); 2 new Prisma models, 3 enums, 3 additive relations; 2 new error codes; 1 new native dependency.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template, so CLAUDE.md's "Non-negotiable architectural rules" (mirroring Architecture §21) remain the operative gates — the same basis slices 002–004 used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | `businessDate`, `startedAt`/`endedAt`, every stop's `sequence`, `source`, `status` and `effectiveRadiusMeters`, and the nearest-shop distance are all server-derived. The device's `capturedAt` is stored as a *claim*, never used as the authoritative time. None of these appears as a key in any request schema, so sending one fails validation rather than being dropped. |
| 2. Tenant isolation, two layers | **PASS (to implement)** | Both new tables carry `companyId`, are registered in `TENANT_MODELS`, and get `FORCE ROW LEVEL SECURITY` with the fail-closed policy in a sibling `_rls_assignments` migration. **Plus a third scope**: every query is additionally narrowed to the caller's own `executiveId`, so tenant isolation alone is never what keeps two executives apart. |
| 3. Commands are idempotent | **PASS** | Both commands require `Idempotency-Key`. They go further than the key: a repeat start on a running day — even with a *different* key — returns the running day rather than erroring or duplicating, which is what FR-021 and the architecture's state machine actually demand. |
| 4. History is append-only | **PASS** | The route is a frozen snapshot by construction (`beatPlanName`, `effectiveRadiusMeters` copied at creation), so later master-data edits cannot rewrite a past day — this is the rule's central concern. Ending the beat deliberately does **not** retro-stamp pending stops as skipped; "not visited" is counted at read time, so the record keeps what was true. |
| 5. One contract | **PASS** | `packages/shared/src/assignments.schema.ts`, wrapped into the controller via `createZodDto`, same split as every prior slice. |
| 6. Role visibility is explicit and structural | **PASS** | The executive payload carries no distance, no range verdict, no quality flag — and deliberately **not** `effectiveRadiusMeters`, which would let the device derive the verdict itself (research.md §5). The field is stored but never serialised. The screen exists only inside the new executive stack. |
| 7. The field app assumes a bad network | **PARTIAL — see Complexity Tracking** | Reads degrade correctly (the loaded day stays visible, a failed refresh says so). Start and end are **not** queued offline; they require a connection. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | A single new `CompanyClock` service is the only place the conversion happens, satisfying the rule's "only one converter" requirement. `businessDate` is a `@db.Date` column so a calendar date cannot be timezone-shifted. |
| 9. No secret/token/precise coordinate in logs | **PASS (to implement)** | This is the first feature in the product to handle real coordinates. `latitude`/`longitude` must be added to the existing pino redaction list, which already covers `reasonText`, `password` and `token`. FR-026 is the requirement; the redaction entry is the implementation. |
| 10. Every slice ships a migration, an API, and the screen that uses it | **PASS** | Migration, three endpoints and board 1.3 all land together. Tests are excluded by the standing policy. |

One partial — recorded in **Complexity Tracking** rather than waved through.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/assignments.md` confirm the above holds once designed in detail. Three points are now concrete rather than asserted: the unique index is named as the actual concurrency mechanism for create-on-first-open (rule 1 and 3); `effectiveRadiusMeters` is documented as stored-but-never-serialised with the reasoning attached, so a later slice does not "helpfully" add it back (rule 6); and the deliberate choice *not* to rewrite stop status on end is recorded as an append-only consequence (rule 4). No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/005-executive-dashboard/
├── plan.md                   # This file
├── research.md               # Phase 0 output
├── data-model.md             # Phase 1 output
├── quickstart.md             # Phase 1 output
├── contracts/
│   └── assignments.md        # Phase 1 output
├── checklists/
│   └── requirements.md       # /speckit-specify output
└── tasks.md                  # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                          # + DailyAssignment, AssignmentStop,
│   │                                          #   BeatDayStatus/StopStatus/StopSource enums,
│   │                                          #   + 3 additive back-relations
│   └── migrations/
│       ├── <ts>_assignments/migration.sql     # tables, enums, indexes
│       └── <ts+>_rls_assignments/migration.sql# ENABLE/FORCE RLS + policies
└── src/
    ├── infra/
    │   ├── prisma/tenant.extension.ts         # + 'DailyAssignment', 'AssignmentStop'
    │   └── time/company-clock.service.ts      # NEW — the single UTC↔company-local converter
    ├── common/ (logger redaction)             # + latitude/longitude to the redaction list
    ├── modules/assignments/
    │   ├── assignments.module.ts
    │   ├── assignments.controller.ts          # GET /today, POST /:id/start, POST /:id/end
    │   └── assignments.service.ts             # create-on-first-open, lifecycle, ordering,
    │                                          #   counts, nearest-shop distance
    └── app.module.ts                          # + AssignmentsModule

packages/shared/src/
├── assignments.schema.ts                      # startBeatSchema / endBeatSchema
├── errors.ts                                  # + BEAT_DAY_ENDED, BEAT_NOT_STARTED
└── index.ts                                   # + explicit re-export block

apps/mobile/
├── package.json                               # + @react-native-community/geolocation
├── android/app/src/main/AndroidManifest.xml   # + ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION
└── src/
    ├── lib/location.ts                        # NEW — permission request + one position read
    ├── components/ExecutiveBottomNav.tsx      # NEW — Today · My visits · My totals
    ├── features/executive/
    │   ├── executiveDesign.ts                 # board 1.3's own tokens
    │   └── TodaysBeatScreen.tsx               # board 1.3, all four states
    └── navigation/RootNavigator.tsx           # + ExecutiveStack and its branch in stackForRole
```

**Structure Decision**: The same monorepo vertical as the four preceding slices — one API module, one Zod contract file, one screen — with two genuinely new pieces that are not CRUD scaffolding. `features/executive/` is a new sibling to `features/admin/`, carrying its own design-token file the way `adminDesign.ts` does, because board 1.3 uses several colours no admin board does. `infra/time/company-clock.service.ts` sits beside the Prisma infra rather than inside the assignments module, because Constitution rule 8 requires it to be *the* conversion point for every future feature (attendance, salary, reminders), not this feature's helper.

## Complexity Tracking

> One Constitution Check result is **PARTIAL**; recorded here rather than waved through.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Rule 7 ("the field app assumes a bad network") is only partly met: **starting and ending the beat require a connection** and are not queued in an offline outbox. Reads degrade correctly — an already-loaded day stays visible, and a failed refresh says so rather than showing stale data as fresh. | The offline outbox the rule describes does not exist anywhere in the app — no queue, no connectivity state, no sync machinery. Building it here would mean inventing the product's entire offline substrate inside a screen whose other 90% has nothing to do with it, and doing so *before* its primary consumer exists: the rule's own examples lead with visit submission, which is the next slice. Queuing a beat **start** is also the least safe thing to queue first — a start carries a timestamp and a location whose whole purpose is to prove when and where the day began, so replaying one hours later from a queue records something that did not happen. | Queuing start/end in a hand-rolled local queue just for this screen — rejected: a one-off queue with its own semantics would have to be reconciled with (or thrown away for) the real outbox when visit submission builds it, and it would be the only part of the app behaving that way. Blocking the slice until the outbox exists — rejected: it inverts the build order, since the outbox is specified around visit submission and hardening, both later slices. **The honest statement for the user: an executive with no signal cannot start or end a beat, and is told so clearly rather than being left to think it worked.** |
