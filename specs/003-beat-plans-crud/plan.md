# Implementation Plan: Beat Plans CRUD (Company Admin)

**Branch**: `003-beat-plans-crud` | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-beat-plans-crud/spec.md`

## Summary

Give the Company Admin a working beat-plan directory: wire the existing "Beat plans" tile (Admin home) and "Beats" bottom-nav item to a new list screen (board 4.6), add a "New beat plan" action that opens a form (board 4.7) in create mode, and make tapping any list row open the same form pre-filled in edit mode — mirroring the exact module/screen pattern `002-shops-crud` already established. Unlike that slice, this one has no blocking dependency: `User` (001) and `Shop` (002) both already exist, so `BeatPlan`/`BeatPlanShop` can be built in full now. The form's "add existing shops" and "assign an executive" pickers reuse `GET /shops` and `GET /users` as-is; "create a new shop in this beat" reuses the existing `ShopFormScreen` via a small callback extension rather than duplicating shop-creation UI.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged from `002-shops-crud`.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **No new dependency this time** — no map, no camera, no new native module; this slice is lighter than shops.

**Storage**: PostgreSQL via Prisma. New `BeatPlan` and `BeatPlanShop` models (companyId-scoped), plus two purely additive reverse-relation fields on existing models (`Shop.beatPlanShops`, `User.assignedBeatPlans`) — no changes to any existing column.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies; `quickstart.md`'s manual walkthrough is the verification path.

**Target Platform**: The same Android app + the same Node/NestJS API as every prior slice.

**Project Type**: Mobile app + API, monorepo — identical layout to `002-shops-crud`, no new structure.

**Performance Goals**: Beat-plan directory search/filter feels instant for 50+ plans (spec SC-001); saving a reordered 10-stop shop list preserves the exact sequence on reload (SC-006).

**Constraints**: Pixel-exact match to boards 4.6/4.7 (spec FR-015); two-layer tenant isolation on both new tables; every mutating endpoint idempotent; plan code unique per company; no hard delete, only deactivate; Admin-only role gating; the ordered shop list is saved as a **full replace** in the same `POST`/`PATCH` body, not through separate add/remove/reorder endpoints — this is what Architecture's own API surface table means by "shops and order in the body," and it matches how the form naturally works (build the list locally, save once).

**Scale/Scope**: 2 new mobile screens (`BeatPlansListScreen`, `BeatPlanFormScreen`), 1 small extension to `ShopsListScreen` (an optional multi-select "picker mode" for "Add existing shops"), 1 small extension to `ShopFormScreen` (an optional `onCreated` callback for "Create a new shop in this beat"), 1 new API module (`beat-plans`: list, create, update), 2 new Prisma models, 2 additive relation fields, zero new native dependencies.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so CLAUDE.md's "Non-negotiable architectural rules" remain the operative constitution (as in `002-shops-crud`'s plan):

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | Nothing client-computed exists for this entity (no derived flags like `locationStatus`); the Zod schema simply doesn't accept any field this feature doesn't intend the client to set. |
| 2. Tenant isolation, two layers | **PASS (to implement)** | `BeatPlan` and `BeatPlanShop` both carry `companyId`; registered in the Prisma extension and under `FORCE ROW LEVEL SECURITY`, same as every tenant table since `003-company-and-users`. |
| 3. Commands are idempotent | **PASS** | `POST /beat-plans` and `PATCH /beat-plans/:id` both require `Idempotency-Key`, reusing `RequireIdempotencyKeyGuard` as-is. |
| 4. History is append-only | **N/A for this feature** | Nothing here is a correction-of-an-approved-value the way `ShopPinChange` was. `BeatPlanShop` is current-state data (today's ordered list), not a history of past routes — the thing that actually needs append-only protection (a daily route snapshot, `DailyAssignment`) doesn't exist yet and is a later slice's job, not this one's. Replacing a plan's shop list wholesale on save is correct here, not a violation. |
| 5. One contract | **PASS** | `packages/shared/src/beat-plans.schema.ts`, mirrored into `beat-plans.controller.ts` via `createZodDto`, same as `shops.schema.ts`. |
| 6. Role visibility is explicit and structural | **PASS** | `@Roles('COMPANY_ADMIN')` + `RolesGuard` on the whole controller; the two new screens only exist inside `AdminNavigator`. |
| 7. The field app assumes a bad network | **N/A for this feature** | Same precedent as shops/users: the offline outbox rule is scoped to the Executive's field actions, not Company Admin management screens. |
| 8. Times are UTC in storage | **N/A** | `BeatPlan` has no business-date-bearing field; `workingDays` is a set of weekday numbers, not a date. |
| 9. No secret/token/precise-coordinate in logs | **N/A** | Nothing on `BeatPlan`/`BeatPlanShop` is a coordinate, secret, or token — no redaction-list change needed. |
| Testing policy | **PASS** | No test files planned; `quickstart.md` is the manual verification path. |

No violations — **Complexity Tracking is not needed.**

**Post-Phase-1 re-check**: `data-model.md` and `contracts/beat-plans.md` confirm the above holds once designed in detail — in particular, the full-replace semantics for `BeatPlanShop` (rule 4) and the absence of any client-settable derived field (rule 1) are both now concretely specified. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/003-beat-plans-crud/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── beat-plans.md     # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                            # + BeatPlan, BeatPlanShop models;
│   │                                             #   + Shop.beatPlanShops, User.assignedBeatPlans
│   │                                             #   reverse relations (additive only)
│   └── prisma/migrations/<new>_beat_plans/       # migration.sql for the above
└── src/modules/beat-plans/
    ├── beat-plans.module.ts                       # imports nothing extra — no FilesService needed
    ├── beat-plans.controller.ts                   # GET/POST /beat-plans, PATCH /beat-plans/:id
    └── beat-plans.service.ts                      # tenant-scoped CRUD + full-replace shop-list logic

packages/shared/src/
└── beat-plans.schema.ts                           # createBeatPlanSchema, updateBeatPlanSchema,
                                                    #   listBeatPlansQuerySchema

apps/mobile/src/
├── features/admin/
│   ├── BeatPlansListScreen.tsx                    # board 4.6 — mirrors ShopsListScreen.tsx
│   ├── BeatPlanFormScreen.tsx                      # board 4.7 — mirrors ShopFormScreen.tsx
│   ├── ShopsListScreen.tsx                        # + optional `selectionMode`/`onSelect` props,
│   │                                              #   reused as the "Add existing shops" picker
│   └── ShopFormScreen.tsx                         # + optional `onCreated` callback prop,
│                                                   #   reused for "Create a new shop in this beat"
└── navigation/RootNavigator.tsx                   # + BeatPlansList, BeatPlanForm routes;
                                                    #   HomeScreen's "Beat plans" tile and
                                                    #   AdminBottomNav's "Beats" item wired here too
```

**Structure Decision**: Same monorepo layout and per-slice vertical as `002-shops-crud` — one API module, one Zod contract file, two new screens under `apps/mobile/src/features/admin`. The only structural difference from the shops slice is reuse-by-extension: rather than a brand-new shop-picker screen, `ShopsListScreen` gains an optional selection mode, and `ShopFormScreen` gains an optional creation callback — both additive, backward-compatible props that leave their existing shops-feature behavior untouched.

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty.*
