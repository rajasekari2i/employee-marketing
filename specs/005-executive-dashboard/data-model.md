# Phase 1 Data Model: Executive Dashboard — Today's Beat

Two new models and three new enums in `apps/api/prisma/schema.prisma`, taken from Architecture §4 and trimmed to what this slice can reach — the same posture `002-shops-crud`, `003-beat-plans-crud` and `004-brands-reasons-crud` used.

**Every multi-word column gets `@map("snake_case")`** — carried forward from the earlier slices, which needed a rename migration after `shopCode` shipped without one. Checked field by field below.

## Enums

```prisma
enum BeatDayStatus { RUNNING ENDED }
enum StopStatus    { PENDING COMPLETED SKIPPED REVISIT }
enum StopSource    { PLAN EXEC_EXTRA MANAGER_EXTRA }
```

Two different rules are at work here, deliberately (research.md §9):

- **`BeatDayStatus` omits `AUTO_CLOSED`**, which Architecture declares. Nothing in this slice can set it — auto-closing needs a scheduled-job runtime that does not exist — and nothing reads it. It is added additively by the slice that implements auto-close, exactly as `002-shops-crud` declared only the `LocationSource` values it could reach.
- **`StopStatus` and `StopSource` declare their full sets** even though only `PENDING` and `PLAN` have writers today, because this slice's own code **reads** the others: FR-011's ordering puts revisit between to-do and completed, FR-017 counts Revisit and Extra, and board 1.3 draws a chip for each. Declaring them is what lets that logic be written once, correctly, now.

## DailyAssignment

One row per executive per business day. Holds both the frozen route **and** the beat-day lifecycle, so "is the beat running?" is a single field on the row the screen already loaded (Architecture §9).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column — both isolation layers, per CLAUDE.md rule 2. |
| `businessDate` | `DateTime @db.Date @map("business_date")` | The company-local calendar date, from `CompanyClock` — never the device clock (FR-005). `@db.Date` so it carries no time component to be shifted across timezones. |
| `executiveId` | `String @map("executive_id")` | |
| `executive` | `User @relation(fields: [executiveId], references: [id])` | |
| `beatPlanId` | `String? @map("beat_plan_id")` | Nullable: a day can exist with no plan behind it once extra-shop-only days are possible. |
| `beatPlan` | `BeatPlan? @relation(fields: [beatPlanId], references: [id])` | |
| `beatPlanName` | `String? @map("beat_plan_name")` | **Snapshot** of the plan's name at creation (FR-007) — renaming the plan later never rewrites a past day's card. |
| `status` | `BeatDayStatus?` | **Null until the beat starts.** Null = not started, `RUNNING`, `ENDED`. This three-state-from-one-nullable-column is what makes the lifecycle a single lookup. |
| `startedAt` | `DateTime? @map("started_at")` | Server's own received-at instant, not the device's claim. |
| `startLatitude` | `Decimal? @db.Decimal(9, 6) @map("start_latitude")` | |
| `startLongitude` | `Decimal? @db.Decimal(9, 6) @map("start_longitude")` | |
| `startAccuracyMeters` | `Int? @map("start_accuracy_meters")` | Recorded, never blocking (FR-014). |
| `endedAt` | `DateTime? @map("ended_at")` | |
| `endLatitude` | `Decimal? @db.Decimal(9, 6) @map("end_latitude")` | |
| `endLongitude` | `Decimal? @db.Decimal(9, 6) @map("end_longitude")` | |
| `endAccuracyMeters` | `Int? @map("end_accuracy_meters")` | |
| `stops` | `AssignmentStop[]` | |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | |

**Indexes**: `@@unique([companyId, businessDate, executiveId])`, `@@index([companyId, businessDate])`, `@@index([companyId, executiveId, businessDate])`. Mapped to `daily_assignments`.

The unique index is **load-bearing, not decorative**: it is the entire concurrency guarantee behind creating the route on first open (research.md §1). Two devices, a double tap and a refresh storm all converge on one row because the database refuses the second insert, and the service treats that refusal as "re-read and return the winner".

*Deliberately omitted* vs. Architecture's model: `autoClosed`, `endNote`. `autoClosed` has no writer without the scheduled job, and pairs with the `AUTO_CLOSED` enum value that is likewise deferred. `endNote` has no field on board 1.3's end confirmation, so nothing can produce it.

## AssignmentStop

One shop's place on one day's route. A frozen snapshot — not a live view of the beat plan.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column. |
| `assignmentId` | `String @map("assignment_id")` | `@relation(..., onDelete: Cascade)` — a route's stops belong to it entirely. |
| `assignment` | `DailyAssignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)` | |
| `shopId` | `String @map("shop_id")` | |
| `shop` | `Shop @relation(fields: [shopId], references: [id])` | |
| `sequence` | `Int` | Copied from the beat plan's order at creation. Single word, no `@map`. |
| `source` | `StopSource @default(PLAN)` | Drives the "Extra" chip and the within-group ordering (FR-010, FR-011). |
| `status` | `StopStatus @default(PENDING)` | Drives the To do / Done filters and the status chip. |
| `addedByUserId` | `String? @map("added_by_user_id")` | Who added an extra stop (FR-009). Null for planned stops. |
| `addedAt` | `DateTime? @map("added_at")` | When an extra stop was added. |
| `effectiveRadiusMeters` | `Int @map("effective_radius_meters")` | **Snapshot** of `Shop.verificationRadiusMeters ?? CompanySettings.defaultRadiusMeters` at creation (FR-007). **Never returned to an executive** — see "What never reaches the executive" below. |

**Indexes**: `@@unique([assignmentId, shopId])`, `@@index([companyId, assignmentId, status])`, `@@index([companyId, shopId])`. Mapped to `assignment_stops`.

*Deliberate tightening* vs. Architecture, which specifies `@@unique([assignmentId, shopId, sequence])`: that three-column form would permit the same shop twice on one day at two different sequence numbers, which contradicts BUS-08 ("an assigned shop accepts at most one completed primary outcome per executive per day"). The two-column form makes the duplicate unrepresentable, and matches the `@@unique([beatPlanId, shopId])` precedent `003-beat-plans-crud` already set for the same shape of data.

*Deliberately omitted*: `addReason` (manager-extra only — no writer until the manager's add-shop feature), and the `visits Visit[]` back-relation (`Visit` does not exist yet).

## Additive relations on existing models

Schema-only additions. No existing column, index or constraint changes.

```prisma
model User     { /* …unchanged… */  assignments DailyAssignment[] }
model BeatPlan { /* …unchanged… */  assignments DailyAssignment[] }
model Shop     { /* …unchanged… */  assignmentStops AssignmentStop[] }
```

`schema.prisma`'s existing comment on `BeatPlan` already anticipates this exact addition.

## What never reaches the executive

`effectiveRadiusMeters` is stored on every stop and is **excluded from every response this feature returns** (research.md §5). It is not itself a measurement, but it is the threshold every range verdict is computed against — sending it would let the device derive "am I inside the radius?", which is the inference Constitution rule 6 exists to prevent. The field is written at creation because the server needs it when visit submission is built; it simply never leaves the server.

No distance, `isExceedRange` or quality-flag field exists on either model in this slice — those arrive with visit submission.

## Validation rules

Enforced in `packages/shared/src/assignments.schema.ts` and the services.

- `latitude`: required, `-90 ≤ v ≤ 90`. `longitude`: required, `-180 ≤ v ≤ 180`. Both are rejected rather than clamped.
- `accuracyMeters`: required, non-negative integer. Recorded, never a reason to reject a start or end (FR-014).
- `capturedAt`: required ISO-8601 instant — the device's claim about when it read the position. Stored for later quality checks; the authoritative `startedAt`/`endedAt` is always the **server's** own clock, so a wrong device clock cannot move a beat in time.
- **Server-only, never accepted from a client** (CLAUDE.md rule 1): `id`, `companyId`, `businessDate`, `executiveId`, `beatPlanId`, `beatPlanName`, `status`, `startedAt`, `endedAt`, every `AssignmentStop` field including `sequence`, `source`, `status` and `effectiveRadiusMeters`. None appears as a key in any request schema, so a client that sends one fails validation rather than having it quietly dropped.

## State transitions

**`DailyAssignment.status`** — the whole lifecycle, with no arrow back:

```
   null (not started) ──POST /assignments/:id/start──▶ RUNNING ──POST /assignments/:id/end──▶ ENDED
```

| Attempt | Result |
|---|---|
| `start` on a not-started day | Starts it; `200` with the running day |
| `start` on a `RUNNING` day | **Returns it unchanged**, `200` — never an error (FR-021, Architecture §10) |
| `start` on an `ENDED` day | `409 BEAT_DAY_ENDED` — the state machine has no such arrow |
| `end` on a `RUNNING` day | Ends it; `200` with the ended day |
| `end` on an `ENDED` day | **Returns it unchanged**, `200` — never an error |
| `end` on a not-started day | `409 BEAT_NOT_STARTED` |

Returning the current row for a repeat is a stronger guarantee than the `Idempotency-Key` alone, which only replays a byte-identical request: here even a *different* key must not produce a second start.

**`AssignmentStop.status`**: every stop is created `PENDING` and nothing in this slice changes it. Visit submission moves stops to `COMPLETED`; manager review produces `REVISIT`. Ending the beat deliberately does **not** rewrite pending stops to `SKIPPED` — "not visited" is counted at read time from stops still `PENDING` or `SKIPPED`, so the record keeps what was actually true rather than being retro-stamped.

## Snapshot rule, restated

A route, once created, is immutable with respect to its sources. A later edit to the beat plan's name, its shop list or their order; a later edit to a shop's radius override; a later change to the company's default radius — none of them alter a `DailyAssignment` or its `AssignmentStop` rows (FR-007, SC-005). This is the same "snapshots everywhere" rule Architecture §9 states, and it is why `beatPlanName` and `effectiveRadiusMeters` are copied rather than joined.
