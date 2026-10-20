# Phase 1 Data Model: The Manager App

**Feature**: `010-manager-app` | **Date**: 2026-10-20

## The migration

One migration, in three parts. Each part was left for this slice **on the record** by an earlier one.

### Part 1 — `Attendance`, a new model

Taken from `03-ARCHITECTURE.md:669`. Nothing here is invented.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String` | tenant key; RLS and the Prisma extension both key on it |
| `userId` | `String` | the person whose attendance this is |
| `businessDate` | `DateTime @db.Date` | company-local calendar date, from `CompanyClock` — never a device date |
| `session` | `AttendanceSession` | `MORNING` \| `EVENING` |
| `status` | `AttendanceStatus` | `PRESENT` \| `ABSENT` \| `LEAVE` \| `HOLIDAY` \| `WEEKLY_OFF` |
| `actualTime` | `DateTime?` | **required when `PRESENT`**, null otherwise (FR-035) |
| `latenessFlag` | `LatenessFlag?` | **server-derived**, never accepted from a client |
| `payableUnits` | `Decimal @db.Decimal(4, 2)` | **server-derived** from `CompanySettings.payableUnitByStatus` |
| `version` | `Int @default(1)` | 1 for a first record; `n+1` for each amendment |
| `isActive` | `Boolean @default(true)` | exactly one active row per (person, date, session) |
| `supersededById` | `String?` | the amendment that replaced this row |
| `changeReason` | `String?` | **required on an amendment**, null on a first record (FR-037) |
| `recordedBy` | `String` | the manager who recorded or amended it |
| `recordedAt` | `DateTime @default(now())` | the server's clock |

**Constraints**

- `@@unique([companyId, userId, businessDate, session, version])` — **the versioning guarantee.** Including `version` is what makes the history append-only: a second writer cannot reuse a version, so two managers amending at once produce one winner and one `P2002`, not a silent overwrite (research.md §7).
- `@@index([companyId, businessDate, session, isActive])` — the day sheet's own query.
- `@@index([companyId, userId, businessDate])` — one person's history, which salary will need.

**Three new enums**: `AttendanceSession { MORNING EVENING }`, `AttendanceStatus { PRESENT ABSENT LEAVE HOLIDAY WEEKLY_OFF }`, `LatenessFlag { ON_TIME DELAY_1H DELAY_2H }`.

**RLS and `TENANT_MODELS`**: `Attendance` is the **only new tenant table** in this slice, so it needs both isolation layers — `ENABLE`/`FORCE ROW LEVEL SECURITY` with an `attendance_tenant_isolation` policy, and registration in `TENANT_MODELS`. A new tenant table missing either must fail CI (Constitution rule 2).

### Part 2 — `AssignmentStop.addReason`

`addReason String? @map("add_reason")`.

Slice 007's data model recorded why it was absent: *"It is for manager-added extras, which are out of scope, so it stays omitted."* Manager-added extras are now in scope, so the column arrives **with its writer** — the discipline this schema has followed throughout.

Nullable, because a planned stop and an executive's own extra have no reason. **Required in the service** for `MANAGER_EXTRA` (FR-043), which is where the rule belongs: the column describes three kinds of stop, only one of which needs it.

### Part 3 — `Order.deliveredAt` / `Order.deliveredBy`

`deliveredAt DateTime? @map("delivered_at")`, `deliveredBy String? @map("delivered_by")`.

The architecture's `Order` carries both; the repository's does not, because slice 006 had nobody to write them. `deliveryStatus` already exists and already defaults to `TO_DELIVER`, so this is two nullable columns rather than a state machine.

**Keep the repository's enum spelling.** The architecture writes `DeliveryStatus { PENDING DELIVERED }`; the repository has `{ TO_DELIVER DELIVERED }`, which is also what board 3.3's chip reads ("To deliver"). The repository and the design agree, so the architecture is the outlier here.

### What is deliberately *not* in this migration

- **`ReviewStatus` stays two-valued.** `ACCEPTED` and `REVISIT_REQUESTED` have no writer because reviewing a visit is out of scope. Adding an enum value with no writer is the thing this schema has consistently avoided.
- **`StopSource.MANAGER_EXTRA` already exists**, declared by slice 005 with no writer. This slice is its first.
- **No new `CompanySettings` field.** Every setting attendance needs — `morningSessionStart`, `eveningSessionStart`, `delay1hMinutes`, `delay2hMinutes`, `payableUnitByStatus` — was added by slice 001 with no consumer. This feature is that consumer.

## Entity: the manager's visit row *(a read projection)*

What board 3.3 draws per visit. **Authored for the manager and deliberately not shared with `GET /visits/mine`** (research.md §3).

| Field | Type | Source |
|---|---|---|
| `id` | string | `Visit.id` |
| `businessDate` | `YYYY-MM-DD` | `Visit.businessDate` |
| `outcome` | `'ORDER' \| 'NO_ORDER'` | drives the `ORD` / `NO` badge |
| `shopName` | string | `Shop.name` |
| `executiveName` | string | `User.name` |
| `occurredAt` | ISO | `Visit.submittedAt` |
| `summary` | string | `"{brandCount} brands · {totalQuantity} qty"` or the reason label |
| `deliveryStatus` | `'TO_DELIVER' \| 'DELIVERED' \| null` | null for a no-order — drives the chip |
| **`distanceMeters`** | number | **the measurement** |
| **`isExceedRange`** | boolean | drives the "· out" marker and its colour |

**The last two are the point.** Slice 008's executive projection lists both as forbidden by name; here they are required. The two shapes live in two services so neither can acquire the other's fields by accident, and the quickstart asserts both sides in one run.

## Entity: the visit detail *(a read projection)*

One shape serving boards 3.4, 3.5 and 3.6 — **the client picks the screen, the server does not** (research.md §4). So the detail carries everything all three need:

| Group | Fields |
|---|---|
| Identity | `id`, `outcome`, `shopName`, `executiveName`, `beatPlanName`, `businessDate`, `occurredAt` |
| Order *(when `ORDER`)* | `lines[]` of `{ brandLabel, quantity }`, `totalQuantity`, `deliveryStatus`, `deliveredAt`, `deliveredByName` |
| No-order *(when `NO_ORDER`)* | `reasonLabel`, and `lastFiveReasons[]` of `{ businessDate, reasonLabel, executiveName }` |
| The measurement | `distanceMeters`, `isExceedRange`, `effectiveRadiusMeters`, `accuracyMeters`, `submittedAt`, `flags[]` |
| The map | `shopLatitude`, `shopLongitude`, `capturedLatitude`, `capturedLongitude` |

**Every map and measurement value is the one frozen on the visit**, not the shop's current state (FR-030). `Visit.shopLatitude`/`shopLongitude` and `Visit.effectiveRadiusMeters` were snapshotted at submission by slice 006 precisely so a later pin correction cannot rewrite what a visit was judged against.

**`lastFiveReasons` is the shop's**, by anyone, newest first — the same shape `getStopDetail` already computes for the executive's visit screen, narrowed to no-orders (FR-026).

## Entity: the previous-day report *(a read projection)*

| Group | Fields |
|---|---|
| Period | `businessDate`, `label` |
| Counts | `assigned`, `visited`, `pending`, `order`, `noOrder`, `outOfRange` |
| Proportions | `within`, `exceeded`, `notVisited`, `withinPercent` |
| Flagged | `outOfRangeVisits[]` — shop, executive, flag, distance, visit id |
| Per executive | `name`, `beatPlanName`, `startedAt`, `endedAt`, `dayState` (`NOT_STARTED` \| `RUNNING` \| `ENDED` \| `AUTO_CLOSED`) |

`within + exceeded + notVisited` equals `assigned` by construction — `within` and `exceeded` partition the visits, `notVisited` is the rest (SC-005).

**`AUTO_CLOSED` has no writer yet.** The nightly job the architecture describes is not built, so the field is read correctly and will simply never carry that value until it ships (research.md §5). Recorded rather than rendered as a state that cannot occur.

## Entity: the attendance day sheet *(a read projection)*

| Group | Fields |
|---|---|
| Day | `businessDate`, `isToday`, `isFuture` *(drives FR-032's edit lock)* |
| Counts | `present`, `late`, `absentOrLeave`, `notMarked` |
| Per person | `userId`, `name`, `roleLabel`, and `morning` / `evening` cells |
| Per cell | `status \| null`, `actualTime`, `latenessFlag`, `recordedByName`, `recordedAt`, `version` |

**The roster is every active member of staff except the System Admin** (FR-040), decided with the user — so a manager appears on their own sheet (FR-040a).

A cell with no record is `status: null` and renders as "not marked"; it is never omitted, because the sheet is a grid.

## Validation rules

| Rule | Where enforced | Failure |
|---|---|---|
| The caller is a Manager | `@Roles` on each controller | `403 FORBIDDEN_ROLE` |
| Only the caller's own company | RLS + the Prisma extension + `scopeToCaller` | — |
| `PRESENT` requires `actualTime` | Zod refinement | `400 VALIDATION_FAILED` |
| A non-`PRESENT` status must not carry `actualTime` | Zod refinement | `400 VALIDATION_FAILED` |
| An amendment requires `changeReason` | service — it knows whether an active row exists | `400 VALIDATION_FAILED` |
| `latenessFlag` / `payableUnits` / `version` in the body | Zod `.strict()` | `400 VALIDATION_FAILED` |
| A future date cannot be written | service, against `CompanyClock` | `409 ATTENDANCE_DATE_IN_FUTURE` |
| Two managers amending at once | **database** — `@@unique([…, version])` | `409 ATTENDANCE_VERSION_CONFLICT` |
| An order already delivered | service | `409 ORDER_ALREADY_DELIVERED` |
| A manager extra shop without a reason | Zod | `400 VALIDATION_FAILED` |
| The shop is already on that day | **database** — `@@unique([assignmentId, shopId])` | `409 SHOP_ALREADY_IN_BEAT` *(exists)* |

## State transitions

### An attendance session

```
(no row) ──record──> v1 active
   v1 active ──amend(reason)──> v1 inactive, v2 active ──amend(reason)──> v2 inactive, v3 active …
```

Never an update. Each arrow is an insert plus a flip, in one transaction. There is no transition back to "no row": attendance, once recorded, is history.

### An order's delivery

```
TO_DELIVER ──mark delivered──> DELIVERED
```

One-way. There is no un-deliver route, by decision — FR-024 refuses a second marking rather than letting it overwrite who marked it first.

### A visit

**None.** This feature never changes a visit's outcome, its measurement or its flags (FR-049). The only write that touches a visit's neighbourhood is its order's delivery status.
