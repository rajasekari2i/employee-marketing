# Implementation Plan: The Company Admin's Visits

**Branch**: `011-admin-visits` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-admin-visits/spec.md`

## Summary

Four boards (4.2–4.5), **zero new endpoints**, **zero migrations**, and one genuinely new screen. The Company Admin's bottom bar has carried a Visits item since the bar was first built, raising a "coming in a later update" alert every time it was tapped; this is the slice that gives it somewhere to go.

It is the smallest slice since `004`, and the reason is worth stating because it is also the design: **three of the four boards are not new screens.** Decoded and diffed, 4.4 and 4.5 are byte-identical to the Manager's 3.5 and 3.6, 4.3 differs from 3.4 by one name in the sample data, and 4.2 differs from 3.3 in exactly two places — a subtitle and a bottom bar (research.md §2). The work is therefore mostly *not writing things twice*.

Three things carry the design weight.

**Widening a role gate is a visibility change, and visibility is this product's most load-bearing rule.** `GET /visits` and `GET /visits/:id` carry `distanceMeters` and `isExceedRange`; the executive must never see either. That stays true here for a structural reason rather than a careful one: the executive's history was never the same route. `010` split `GET /visits` from `GET /visits/mine` precisely so neither could acquire the other's fields, and this slice adds a role to one of them without touching the other.

**One implementation per board pair, not two copies.** CLAUDE.md's fidelity rule is what decides this, not tidiness — a copy of the visits list in `features/admin/` would be a second place for board 4.2 to drift from 3.3, silently. The list body is extracted to a shared component with the two differences injected as props; the three detail screens are registered a second time in the admin stack rather than copied.

**One server change, and it is a rename that prevents a lie.** `markDelivered`'s `managerId` becomes `actorId`, because the value is written to `Order.deliveredBy` and read back as the attribution on the board. The race the widening creates — an admin and a manager marking the same order — needed no new code: `010`'s `409 ORDER_ALREADY_DELIVERED` already refuses a second marking rather than overwriting the first.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **No new dependency, no native rebuild, no new shared schema.**

**Storage**: PostgreSQL via Prisma. **No migration.** No model, column, enum, index or RLS policy is added or altered.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API.

**Performance Goals**: home to any visit detail in three taps or fewer (SC-001); the list's existing 10-row page is unchanged.

**Constraints**: pixel-exact match to boards 4.2–4.5; a Company Admin sees the measurement and an executive still never does; no visit is ever modified; a delivery is never attributed to the wrong person or overwritten.

**Scale/Scope**: 1 new mobile screen + 1 extracted shared component + 4 stack route registrations; 0 new API endpoints (3 gain a role); 0 Prisma changes; 1 changed service signature.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template. The operative gates are CLAUDE.md's "Non-negotiable architectural rules", which are the ten rules `03-ARCHITECTURE.md:1147-1175` tells us to paste there — the basis slices `002`–`010` used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | Nothing new is computed and nothing new is accepted. `deliveredAt` is still the server's clock and `deliveredBy` still the verified JWT's user; the request body is still `z.object({}).strict()`, so a client sending either gets a `400` rather than a silent strip. |
| 2. Tenant isolation, two layers | **PASS, vacuously — and checked anyway** | **No new tenant table**, so there is nothing to register in `TENANT_MODELS` and no new RLS policy. The risk a role widening actually carries is that a new caller reaches rows the extension does not scope; it does not, because the admin calls the *same* service, whose scope is `companyId` and nothing else. |
| 3. Commands are idempotent | **PASS** | The one command, `POST /orders/:id/deliver`, keeps its `RequireIdempotencyKeyGuard`. No new command. |
| 4. History is append-only | **PASS** | No visit is modified by anything here. Delivery is one-way with no un-deliver route, and a second marking is a `409`, not an overwrite — which is now also what arbitrates an admin/manager race. |
| 5. One contract | **PASS** | No new schema. `managerVisitsQuerySchema`, the detail response and `markDeliveredSchema` are reused unchanged by a second role. |
| 6. Role visibility is explicit and structural | **PASS — and it is the rule this slice is about** | See the note below. |
| 7. The field app assumes a bad network | **PASS** | The two reads reuse `010`'s stale-note fallback verbatim. The one command is made at a desk and is reported rather than queued, as `010` established. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | No new time is derived. `businessDate` and `occurredAt` come from the same projection the manager's list uses. |
| 9. No secret/token/precise coordinate in logs | **PASS** | `GET /visits/:id` returns coordinates in a **response body** for the map, as before; `latitude`/`longitude` are already on the deep redaction list. No coordinate is in any request this feature makes. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS with a documented exception** | There is no migration **because the feature needs none**, and the API is three existing routes gaining a role. The screens are the substance. Rule 10 forbids "backend done, UI later"; it does not require inventing schema. |

**No violations — Complexity Tracking is not needed.**

### Three things this check deliberately does not wave through

- **Rule 6, and the direction of the widening.** Every prior slice applied this rule by keeping the measurement away from the executive; `010` was the first to require the opposite for a manager, and this slice extends that to a second role. The danger is a quiet generalisation: "managers and admins both need it" becoming "make the projection role-aware", which puts the rule inside an `if`, in the one service where all three roles would meet. It is not done. The executive's `GET /visits/mine` and its service are untouched by this slice's diff, and quickstart Scenario 7 re-asserts the executive's exact key set — the cheap assertion that would catch a later refactor merging the two.

- **Rule 2, and what "vacuously" is hiding.** A slice with no migration can skip this row, and that is the wrong instinct for a slice whose entire content is *letting a new role call existing queries*. The question is not "is there a new table" but "does the new caller reach rows the old one could not". It does not — `ManagerVisitsService.list` filters on `companyId` alone and has no manager-level predicate to lose — and that is exactly why one route serves both roles rather than two. Had there been a per-manager scope, widening the gate would have silently removed it, and the honest design would have been a second service.

- **Rule 10, and a slice with no migration at all.** This is the first slice to ship none. The rule exists to stop a vertical being split into "backend now, UI later", and this slice is the opposite shape — almost entirely UI, over an API built two slices ago and always intended to carry this role (research.md §1). Stating it rather than leaving the row blank, because a future reader counting migrations per slice will find a gap here and should find the reason next to it.

**Post-Phase-1 re-check**: [data-model.md](./data-model.md) confirms there is no schema change to review, and [contracts/admin-visits.md](./contracts/admin-visits.md) reduces to three `@Roles` lines and one renamed parameter. Three guarantees are concrete rather than asserted: the executive's route and service appear nowhere in the diff; `409 ORDER_ALREADY_DELIVERED` makes an admin/manager race a refusal rather than an overwrite; and `markDelivered` takes its actor from the JWT, with the body `.strict()` and empty, so no client can name a different one. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/011-admin-visits/
├── plan.md                        # This file
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output — deliberately short
├── quickstart.md                  # Phase 1 output — grouped by user story
├── contracts/
│   └── admin-visits.md            # Phase 1 output
├── checklists/
│   └── requirements.md            # /speckit-specify output
└── tasks.md                       # Phase 2 output
```

### Source Code (repository root)

```text
apps/api/src/modules/visits/
├── visits.controller.ts           # @Roles('MANAGER') → @Roles('MANAGER', 'COMPANY_ADMIN') on 3 routes
└── order-delivery.service.ts      # managerId → actorId (and the comments that named a manager)

apps/mobile/src/
├── components/AdminBottomNav.tsx  # + optional onVisitsPress, defaulting to the coming-soon alert
├── navigation/RootNavigator.tsx   # + AdminVisits, + OrderVisit/NoOrderVisit/OutOfRangeVisit in the admin stack
├── features/admin/
│   ├── AdminVisitsScreen.tsx      # NEW — board 4.2, a wrapper over the shared list
│   ├── HomeScreen.tsx             # + onVisitsPress
│   ├── ShopsListScreen.tsx        # + onVisitsPress
│   ├── BeatPlansListScreen.tsx    # + onVisitsPress
│   └── UsersListScreen.tsx        # + onVisitsPress
├── features/profile/ProfileScreen.tsx   # + onVisitsPress on the admin's bar
└── features/manager/
    ├── visitsListShared.tsx       # NEW — extracted from ManagerVisitsScreen, boards 3.3 AND 4.2
    └── ManagerVisitsScreen.tsx    # now a wrapper over it (−487 lines, no behaviour change)
```

Unchanged and deliberately absent from that tree: `prisma/`, `packages/shared/`, `my-visits.service.ts`, `manager-visits.service.ts`, and the three detail screen components — which are **registered** in the admin stack but not edited.

**Structure Decision**: no new module and no new feature folder. The server change is two lines in a controller and a parameter rename; the mobile change extracts a shared component **in place**, in `features/manager/`, rather than promoting it to a neutral `features/visits/`. Promoting it would have turned this slice's diff into a rename of `010`'s work, obscuring both; the import from `features/admin/` into `features/manager/` is the honest record of where the screens came from (research.md §4).

## Complexity Tracking

*Not needed — no Constitution violations to justify.*

Worth stating anyway, since this slice is far **smaller** than its predecessor rather than larger: **the size is the design's, not the feature's.** Four boards would ordinarily be four screens; they are one new screen because three of them already existed under a different bottom bar, and because the fidelity rule makes sharing the implementation the safer option rather than merely the shorter one (research.md §4). The cost of that choice is recorded where it falls — the two stacks now share route names as a contract between them (research.md §5) — rather than left for a future rename to discover.
