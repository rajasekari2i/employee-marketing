# Implementation Plan: Add Extra Shop — Executive

**Branch**: `007-extra-shops` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-extra-shops/spec.md`

## Summary

One new screen — board 1.4 — that lets an executive put an unplanned shop onto today's route while the beat is running, and the dashed button on board 1.3 that opens it.

The notable thing about this slice is how little of it is new. `StopSource.EXEC_EXTRA`, `AssignmentStop.addedByUserId` / `addedAt` and the `@@unique([assignmentId, shopId])` constraint have been in the schema since slice 005 with no writer; `TodaysBeatScreen` already renders the `EX` badge, the violet "Extra" chip and the planned-plus-extra counts; `orderStops` already sorts extras ahead of planned stops within their status group. **There is no migration.** The work is two endpoints at paths the architecture already specifies, one screen, and one entry point.

Three things carry real design weight. The **picker read** must rank shops by distance without ever handing the device a coordinate or a radius — the first time an executive is shown a distance at all, which is why the spec separates it carefully from the measurement a visit is judged by. The **add** must be impossible to perform twice, which the existing unique constraint already guarantees and this feature only has to report well. And the **plan-less day** — a non-working day, or an executive with no beat plan — must become startable, because today it is not, and that is precisely the day an executive most needs to add a shop.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7, `@react-native-community/geolocation`, `@react-native-async-storage/async-storage` (mobile). **No new dependency, and no native rebuild** — every module this feature touches is already linked.

**Storage**: PostgreSQL via Prisma. **No migration.** No new model, no new column, no new enum value. The feature writes `AssignmentStop` rows through fields that already exist, and makes `DailyAssignment.beatPlanId` carry the null it was already declared nullable for.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API.

**Project Type**: Mobile app + API, monorepo — no new structure; the new screen joins `features/executive/`.

**Performance Goals**: today's list to an added shop in under 20 s for a nearby shop (SC-001); any shop in a 500-shop directory found by name in under 30 s (SC-002). The picker is bounded by the architecture's `LIMIT 200`.

**Constraints**: pixel-exact match to board 1.4 and to board 1.3's dashed action, with **zero** divergences — unlike the previous slice, nothing here is deliberately removed; the shop coordinates and the effective radius never leave the server; the picker's distance must never be confused with a visit's measured distance; one stop per shop per day enforced in the database, not in code; the same idempotency key from record time through every retry.

**Scale/Scope**: 1 new mobile screen + 1 entry point; 2 new API endpoints; 0 Prisma models; 1 new error code; 1 new outbox kind; 1 behavioural change to an existing slice (the plan-less day).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template. The operative gates are CLAUDE.md's "Non-negotiable architectural rules", which are the ten rules `03-ARCHITECTURE.md:1147-1175` tells us to paste there — the basis slices 002–006 used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | `effectiveRadiusMeters`, the frozen shop coordinates, the stop's `sequence` and the picker's `distanceMeters` are all server-derived. The device sends only its own position and a `shopId`. `addExtraStopSchema` is `.strict()`, so a body carrying `distanceMeters` or `effectiveRadiusMeters` is **rejected with 400**, not stripped — the hole found live in slice 006 and closed there. |
| 2. Tenant isolation, two layers | **PASS** | No new table, so no new RLS surface. Every query goes through `scopeToCaller` (`SET LOCAL app.company_id`) and the Prisma extension, **plus** the third executive-id scope slices 005/006 established: a stop can only ever be added to the caller's own assignment. |
| 3. Commands are idempotent | **PASS** | `POST /assignments/:id/stops` requires `Idempotency-Key`. The key is minted on the device when the add is recorded and reused for the life of the queued item, so a retry after a lost response adds the shop once. |
| 4. History is append-only | **PASS** | An extra stop is a new row, never an edit. The beat plan is not written at all (FR-010, SC-004). `effectiveRadiusMeters` and the shop coordinates are snapshotted at creation exactly as `ensureTodayRoute` does, so later master edits cannot rewrite the day (FR-013). There is no remove-stop route. |
| 5. One contract | **PASS** | `packages/shared/src/extra-shops.schema.ts`, wrapped via `createZodDto` in the controller — the same split every prior slice used. |
| 6. Role visibility is explicit and structural | **PASS, and the one to watch** | The picker response is a purpose-built shape that never selects `latitude`, `longitude` or `verificationRadiusMeters` — it does **not** reuse `ShopListItem`, which returns raw coordinates and is documented "Company Admin only". A field never selected cannot leak through a later refactor. See the note below on the distance this screen does show. |
| 7. The field app assumes a bad network | **PASS** | The add queues through the existing `outbox.ts`, as `03-ARCHITECTURE.md:1016` requires of extra-shop addition. The picker is a read and stays unqueued, as the same line requires. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | `addedAt` is the server's clock. The business date comes from `CompanyClock`, never from the device. |
| 9. No secret/token/precise coordinate in logs | **PASS** | `latitude` and `longitude` are already on the deep redaction list. The picker takes a position as a query parameter, so **request-query logging must be confirmed to redact it** — called out as a task rather than assumed, since every prior position arrived in a body. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS with a note** | API and screen ship together. There is **no migration, and that is correct** — the schema already carries every field this feature writes. The rule exists to forbid "backend done, UI later", not to require a migration that has no work to do. |

**No violations — Complexity Tracking is not needed.**

### Two things this check deliberately does not wave through

- **Rule 6 and the distance on screen 1.4.** This feature shows an executive a distance for the first time. It is a different quantity from the one rule 6 protects — measured from where they are *now*, to a shop **not** on today's route, rounded for display, and deciding nothing. FR-EXTRA-08's exclusion does double duty: because a shop already on today's list is never offered, the picker cannot be used to range-find a stop the executive is about to visit. That bound is real but it is not absolute, and `research.md §3` records the residual inference honestly rather than claiming zero. The user was asked before the spec was written and chose to match the board knowing this.

- **Rule 10 and the plan-less day.** Making a day with no beat plan startable changes behaviour that slice 005 shipped. It is in scope because PRD FR-ASSIGN-10 promises it and `DailyAssignment.beatPlanId` was made nullable for exactly this, but it is a change to an existing state machine and is listed as its own work item so it is reviewed as one.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/extra-shops.md` confirm the above in detail. Three guarantees are concrete rather than asserted: `@@unique([assignmentId, shopId])` makes "a shop cannot be added twice" a database fact two concurrent requests cannot both pass; the picker's response fields are enumerated by name, with the forbidden ones listed alongside, so a later contributor can see exactly what must not appear; and `.strict()` on both new schemas means a client-supplied server-owned field is a 400 rather than a silent strip. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/007-extra-shops/
├── plan.md                    # This file
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── quickstart.md              # Phase 1 output
├── contracts/
│   └── extra-shops.md         # Phase 1 output
├── checklists/
│   └── requirements.md        # /speckit-specify output
└── tasks.md                   # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/src/
├── modules/
│   ├── assignments/
│   │   ├── assignments.controller.ts     # + POST /assignments/:id/stops
│   │   ├── assignments.service.ts        # + addExtraStop(); plan-less day creation
│   │   └── extra-stop.service.ts         # NEW — the add transaction, incl. new-shop create
│   └── visits/
│       ├── visits.controller.ts          # + GET /shops/nearby (executive field flow,
│       │                                 #   same placement reasoning as POST /shops/:id/pin)
│       └── nearby-shops.service.ts       # NEW — bounding box + haversine ranking
└── (no prisma/migrations change — nothing to migrate)

packages/shared/src/
├── extra-shops.schema.ts                 # NEW — addExtraStopSchema, nearbyShopsQuerySchema
├── errors.ts                             # + SHOP_ALREADY_IN_BEAT (3 places)
└── index.ts                              # + explicit re-export block

apps/mobile/src/
├── lib/
│   ├── outbox.ts                         # + 'STOP' HeldKind
│   └── location.ts                       # permission rationale widened (FR-020)
├── navigation/RootNavigator.tsx          # + AddExtraShop route
└── features/executive/
    ├── AddExtraShopScreen.tsx            # NEW — board 1.4
    ├── TodaysBeatScreen.tsx              # + dashed "Add extra shop to today" (board 1.3,
    │                                     #   RUNNING state); pinStatus widened
    └── executiveDesign.ts                # + board 1.4 tokens
```

**Structure Decision**: no new structure. The add joins the `assignments` module, which owns the `DailyAssignment` aggregate. `GET /shops/nearby` joins the `visits` module, which is already where the executive's `/shops`-path field routes live (`visits.controller.ts:34-36` records the reasoning for `POST /shops/:id/pin`, and this follows it) — the admin-only `shops` module stays admin-only. Both paths are taken verbatim from `03-ARCHITECTURE.md:824-826` rather than invented.
