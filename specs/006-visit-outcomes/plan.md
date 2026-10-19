# Implementation Plan: Visit Outcomes

**Branch**: `006-visit-outcomes` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-visit-outcomes/spec.md`

## Summary

The product's critical path: five screens that turn a shop on today's list into a recorded commercial outcome — the visit screen with the shop's last five interactions, order capture, no-order capture, the confirm step, and first-time pin capture for a shop that has never had its location saved.

Three things make this the largest and most consequential slice so far. It introduces the **submission transaction** that every later report and review depends on — one transaction that validates, measures, writes the visit with its order and lines, and marks the stop completed, in a fixed order. It introduces the app's **offline queue**, deferred in the previous slice and now required: a visit recorded in a basement is held on the device, survives a restart, and syncs exactly once. And it is the slice where the product's two hardest invariants stop being aspirational — exactly one outcome per stop, and the executive never learns what was measured.

Two deliberate divergences from the design, both taken with the user: the confirm sheet does not show the captured location, and the visit screen does not show the visit radius. The position is still captured and still measured; the executive is simply not told at submission time. Disclosure moves to the location-permission prompt.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7, `react-native-maps` and `@react-native-community/geolocation` (mobile, all already present). **One new runtime dependency**: `@react-native-async-storage/async-storage` for the held-submission queue (research.md §1). **No connectivity library** — sync is driven by request success, not by a reported connection state (research.md §2).

**Storage**: PostgreSQL via Prisma. Three new models (`Visit`, `Order`, `OrderLine`), four new enums, two enum extensions (`LocationSource.GPS`, `LocationStatus.PENDING_VERIFICATION`), one additive field pair on `AssignmentStop`, and five additive back-relations. On the device: one AsyncStorage key holding the ordered queue.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API. **A native rebuild is required** for the new storage module.

**Project Type**: Mobile app + API, monorepo — no new structure; new screens join `features/executive/`.

**Performance Goals**: A three-brand order submitted in under 60 seconds end to end (SC-001); a no-order in under 20 (SC-002); the queue syncs without the executive waiting on it.

**Constraints**: Pixel-exact match to boards 1.7, 1.8, 2.1, 2.2 and 2.3 **except** the two agreed removals (FR-018, FR-019, FR-043); one outcome per stop enforced in the database, not just in code; every quality flag and the distance server-computed and never client-settable; the same idempotency key from record time through every retry; recorded facts never recomputed when masters change; no coordinate in any log.

**Scale/Scope**: 5 new mobile screens + the device queue + its sync; 1 new API module (`visits`: 1 read, 2 commands) plus a widening of two existing endpoints; 3 new Prisma models; 4 new error codes; 1 new dependency.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template, so CLAUDE.md's "Non-negotiable architectural rules" remain the operative gates — the basis slices 002–005 used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | `distanceMeters`, `isExceedRange`, every flag, `reviewStatus`, `effectiveRadiusMeters`, the measured-against coordinates, `brandLabel`, `reasonLabel`, `totalQuantity` and `brandCount` are all server-derived and absent from every request schema. The device sends only its own position and the executive's choices. |
| 2. Tenant isolation, two layers | **PASS (to implement)** | All three new tables carry `companyId`, join `TENANT_MODELS`, and get `FORCE ROW LEVEL SECURITY`. **Plus the third scope** established in the previous slice: every query is additionally narrowed to the caller's own executive id. |
| 3. Commands are idempotent | **PASS** | Both commands require `Idempotency-Key`. This slice is where it earns its keep: the key is minted **at record time on the device** and reused across every retry for the life of a queued item, so a submission that is sent, loses its response, and is retried hours later still records once (research.md §3). |
| 4. History is append-only | **PASS** | A visit is written once and has no edit or delete route — FR-016's "cannot be edited" is enforced by there being no path that could. Every master value a visit depends on is snapshotted (`brandLabel`, `reasonLabel`, the shop coordinate, the radius), so later master edits cannot rewrite it (FR-026, SC-010). |
| 5. One contract | **PASS** | `packages/shared/src/visits.schema.ts`, wrapped via `createZodDto` in the controller, same split as every prior slice. |
| 6. Role visibility is explicit and structural | **PASS** | The seven range-bearing fields are never selected by an executive-facing query — a field never loaded cannot leak through a later refactor (research.md §8). The `POST /visits` response is three fields and carries no verdict. |
| 7. The field app assumes a bad network | **PASS** | **The partial recorded against the previous slice is now closed.** Visits and pin captures queue on the device, survive a restart, sync FIFO with the same idempotency key, and are flagged `OFFLINE_SUBMISSION` on arrival. Reads remain unqueued, as the rule specifies. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | `receivedAt` is the server's clock and is authoritative; `capturedAt`/`submittedAt` are stored as the device's claims and never used as the time of record. `CompanyClock` remains the only converter. |
| 9. No secret/token/precise coordinate in logs | **PASS** | `latitude`, `longitude` and `reasonText` are already on the deep redaction list — verified during the previous slice. No new log surface bypasses it. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS** | Migration, three endpoints, two widened endpoints and five screens land together. Tests excluded by standing policy. |

No violations — **Complexity Tracking is not needed.** Two items are recorded as known gaps rather than violations, below.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/visits.md` confirm the above holds in detail, and make three guarantees concrete rather than asserted. `@@unique([stopId])` turns "one outcome per stop" into a database fact that two concurrent submissions cannot both pass. `@@unique([orderId, brandId])` does the same for duplicate brands. And the seven never-selected fields are enumerated by name in both documents, so a later contributor adding an executive endpoint can see exactly what must not appear. No new violations introduced.

### Known gaps, recorded rather than hidden

- **`MOCK_LOCATION_SUSPECTED` has no producer.** The installed positioning library does not expose Android's mock-location signal, so the flag is declared and never written (research.md §5). A mocked position is currently indistinguishable from a real one — a real hole in the anti-fraud story, closable later with a small native call or a library swap, neither of which changes this contract.
- **The dev build's Google Maps key is empty**, so board 1.8's map tiles render blank until one is configured (research.md §9). The capture flow — position, accuracy, verdict, save gate — works regardless; what is lost is seeing where the pin is being dropped. A configuration fix, not a design problem, and it affects the existing shop form equally.

## Project Structure

### Documentation (this feature)

```text
specs/006-visit-outcomes/
├── plan.md               # This file
├── research.md           # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── visits.md         # Phase 1 output
├── checklists/
│   └── requirements.md   # /speckit-specify output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                        # + Visit, Order, OrderLine; + VisitOutcome,
│   │                                        #   ReviewStatus, VisitFlag, DeliveryStatus;
│   │                                        #   + LocationSource.GPS,
│   │                                        #   + LocationStatus.PENDING_VERIFICATION;
│   │                                        #   + AssignmentStop.shopLatitude/Longitude;
│   │                                        #   + 5 additive back-relations
│   └── migrations/
│       ├── <ts>_visits/migration.sql        # tables, enums, enum ALTERs, indexes
│       └── <ts+>_rls_visits/migration.sql   # ENABLE/FORCE RLS + policies
└── src/
    ├── infra/prisma/tenant.extension.ts     # + 'Visit', 'Order', 'OrderLine'
    ├── modules/
    │   ├── visits/
    │   │   ├── visits.module.ts
    │   │   ├── visits.controller.ts         # GET /stops/:id, POST /visits
    │   │   ├── visits.service.ts            # the submission transaction + last-five
    │   │   └── shop-pin.controller.ts       # POST /shops/:id/pin
    │   ├── masters/{brands,reasons}.controller.ts  # + executive read, active-only
    │   └── assignments/assignments.service.ts      # + freeze shop coords onto new stops
    └── app.module.ts                        # + VisitsModule

packages/shared/src/
├── visits.schema.ts                         # submitVisitSchema, capturePinSchema
├── errors.ts                                # + 4 codes
└── index.ts                                 # + explicit re-export block

apps/mobile/
├── package.json                             # + @react-native-async-storage/async-storage
└── src/
    ├── lib/
    │   ├── outbox.ts                        # NEW — the held-submission queue + sync
    │   └── location.ts                      # permission rationale widened (FR-021)
    └── features/executive/
        ├── ShopVisitScreen.tsx              # board 1.7
        ├── CaptureShopPinScreen.tsx         # board 1.8
        ├── RecordOrderScreen.tsx            # board 2.1
        ├── RecordNoOrderScreen.tsx          # board 2.2
        ├── ConfirmSubmitSheet.tsx           # board 2.3 (location block removed)
        └── TodaysBeatScreen.tsx             # rows become tappable; queue count shown
```

**Structure Decision**: The same monorepo vertical as every prior slice. Two points are worth naming. The pin-capture command lives in its own controller inside the `visits` module rather than in `shops`, because it is the executive's field flow and shares this module's executive-scoping and its stop-coordinate snapshot — the admin's own pin setting stays in the shops module. And `outbox.ts` sits in `lib/` beside `location.ts` rather than inside a feature, because the next slices (extra shops, attendance) queue through the same machinery; its interface is deliberately small so the storage behind it can change without touching callers.

## Complexity Tracking

*No Constitution Check violations — this section is intentionally empty. The two known gaps above are recorded limitations of the environment and the installed library, not deviations from the rules.*
