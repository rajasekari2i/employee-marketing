---

description: "Task list for The Manager App"
---

# Tasks: The Manager App

**Input**: Design documents from `/specs/010-manager-app/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/manager-app.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md`'s 16 scenarios are the verification path (Polish, T338). They are **grouped by user story**, so each story can be verified as it lands rather than only at the end.

**Organization**: Grouped by user story (spec.md: US1–US2 are P1, US3–US4 are P2, US5 is P3). Task IDs continue the repo-wide sequence — 001 (T001–T074) … 009 (T283–T298) — so this feature starts at **T299**.

**⚠️ This is the largest slice in the repository.** Eight boards, six endpoints, one new model, where every previous slice covered one or two boards. **US4 (attendance) is the clean split point** if this is built in two passes: it is the only story with a migration of its own, and nothing before it depends on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/attendance/` (**new**), `apps/api/src/modules/visits/`, `apps/api/src/modules/reports/`, `apps/api/src/modules/assignments/`, `apps/api/prisma/`
- Shared: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/manager/` (**new**), `apps/mobile/src/components/`, `apps/mobile/src/navigation/`

## Board uuids (for the CLAUDE.md decode recipe)

| Board | uuid |
|---|---|
| 3.1 Previous-day report | `58a86d8e-eea6-41ac-a569-0a9265881f6c` |
| 3.2 Add shop to today | `47a5b552-8ab3-44cf-a169-3d8aeb692e06` |
| 3.3 Visits · list + filters | `d71d2e67-7b3b-479c-b242-96da6f4965de` |
| 3.4 Order visit · mark delivered | `ed0bcc77-19fe-47e8-9c6a-195998663d31` |
| 3.5 No-order visit · last 5 reasons | `eb30fec5-03ab-4e68-9c1d-0e0d3ee01126` |
| 3.6 Out-of-range visit · distance | `3a9dd747-c459-426e-b830-0060de3036f7` |
| 3.7 Attendance · day sheet | `71422460-a9d0-432c-bcf8-c0de656d0094` |
| 3.8 Session edit + amendment | `8f1020a5-3275-4f54-84b9-f10edb256cfe` |

---

## Phase 1: Setup

- [X] T299 [P] Add three error codes to `packages/shared/src/errors.ts` in the established three places (`ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`), with a comment naming this slice: `ORDER_ALREADY_DELIVERED` → `409` → `'Order already delivered'`; `ATTENDANCE_DATE_IN_FUTURE` → `409` → `'Cannot record attendance for a future date'`; `ATTENDANCE_VERSION_CONFLICT` → `409` → `'This attendance record changed'`. All 409, following the existing state-machine refusals (`SHOP_ALREADY_IN_BEAT`, `STOP_ALREADY_COMPLETED`, `BEAT_DAY_ENDED`). Reuse `NOT_FOUND`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REUSED`, `BEAT_NOT_STARTED`, `BEAT_DAY_ENDED` and `SHOP_ALREADY_IN_BEAT` unchanged. The file is additive-only.
- [X] T300 [P] Create `packages/shared/src/manager-visits.schema.ts` with `managerVisitsQuerySchema` exactly as `contracts/manager-app.md` specifies: `cursor` optional, `limit` 1–100 default **10**, `date` matching `^\d{4}-\d{2}-\d{2}$` optional, `outcome` enum `['ORDER','NO_ORDER']` optional, **`outOfRange` as a separate `z.coerce.boolean().optional()`**, `executiveId` and `beatPlanId` optional — all `.strict()`. Header comment must record **why `outOfRange` is its own field and not a third value of `outcome`** (research.md §4): board 3.3's own script filters `cur === 'out' ? v.out : v.kind === cur`, so `out` is a boolean beside `kind`, which is why the Out-of-range tab contains both orders and no-orders and why FR-029 has to route by the tab rather than the outcome.
- [X] T301 [P] Create `packages/shared/src/attendance.schema.ts` with `attendanceDayQuerySchema` (`date` optional, `.strict()`) and `recordAttendanceSchema` per the contract: `userId`, `businessDate`, `session` enum `['MORNING','EVENING']`, `status` enum `['PRESENT','ABSENT','LEAVE','HOLIDAY','WEEKLY_OFF']`, `actualTime` optional datetime, `changeReason` optional `trim().min(3).max(280)` — `.strict()` plus a `.refine` asserting `(status === 'PRESENT') === (actualTime !== undefined)` with the message `'actualTime is required for PRESENT and not allowed otherwise'`. **Header comment must list what is absent and why**: `latenessFlag`, `payableUnits`, `version`, `isActive`, `recordedBy`, `recordedAt`, `supersededById`. `latenessFlag` is the one to explain — it looks like an observation the device could make, but it is the company's settings applied to an arrival time, exactly as `distanceMeters` is the company's radius applied to a position. A client sending it gets a `400` (Constitution rule 1, FR-035, SC-010). Note also that `changeReason` is **required only on an amendment**, and that the server decides which case it is — the client never declares it.
- [X] T302 [P] Add `previousDayQuerySchema` to `packages/shared/src/reports.schema.ts` (created by slice 009): `date` matching `^\d{4}-\d{2}-\d{2}$` optional, `executiveId` optional, `beatPlanId` optional, `.strict()`. Add a comment recording **why `date` is accepted here when slice 009's totals deliberately refused `from`/`to`**: board 3.1 has a date control and a manager genuinely needs to look back at an arbitrary day, and a single explicit date is not a *period calculation* — the server still resolves "the previous business day" when none is given and still interprets the value in the company's timezone, so `CompanyClock` remains the only thing that knows what a day is.
- [X] T303 Add explicit re-export blocks for `manager-visits.schema.ts` and `attendance.schema.ts` to `packages/shared/src/index.ts`, and extend the existing `reports.schema` block with `previousDayQuerySchema` — value exports then `export type`, no `export *`, matching the blocks already at the end of that file. Depends on T300–T302.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [X] T304 Add to `apps/api/prisma/schema.prisma` exactly as `data-model.md` specifies. **Three new enums**: `AttendanceSession { MORNING EVENING }`, `AttendanceStatus { PRESENT ABSENT LEAVE HOLIDAY WEEKLY_OFF }`, `LatenessFlag { ON_TIME DELAY_1H DELAY_2H }` — taken verbatim from `03-ARCHITECTURE.md:269-271`. **New model `Attendance`** with every field and `@map` from data-model.md, critically `@@unique([companyId, userId, businessDate, session, version])` — **including `version` is the versioning guarantee**, because it makes a second writer unable to reuse a version, so two managers amending at once produce one winner and one `P2002` rather than a silent overwrite — plus `@@index([companyId, businessDate, session, isActive])` and `@@index([companyId, userId, businessDate])`. **Additive on `AssignmentStop`**: `addReason String? @map("add_reason")` — the column slice 007's data model recorded as *"for manager-added extras, which are out of scope, so it stays omitted"*; it arrives now **with its writer**. **Additive on `Order`**: `deliveredAt DateTime? @map("delivered_at")` and `deliveredBy String? @map("delivered_by")`. **Do NOT widen `ReviewStatus`** — `ACCEPTED` and `REVISIT_REQUESTED` have no writer because reviewing a visit is out of scope, and this schema does not add enum values without one. **Do NOT rename `DeliveryStatus`** — the architecture writes `{ PENDING DELIVERED }` but the repository has `{ TO_DELIVER DELIVERED }`, which is also what board 3.3's chip reads ("To deliver"), so the repository and the design agree and the architecture is the outlier.
- [X] T305 Write the DDL migration `apps/api/prisma/migrations/<ts>_attendance_and_manager/migration.sql` by hand in Prisma's generated style (`migrate dev` cannot run here — the role lacks CREATEDB, P3014; see `20261019140000_assignments/migration.sql` for the precedent and its header). Include the three `CREATE TYPE` statements, the `attendance` table with every column and all three indexes, and the three `ALTER TABLE … ADD COLUMN` statements for `assignment_stops.add_reason`, `orders.delivered_at` and `orders.delivered_by`. **All three columns are nullable, so no backfill is needed** — unlike `20261019230000_backfill_stop_coords` and slice 008's `business_date`, nothing here has a meaning for rows that predate it: a stop added before this slice had no reason, and an order not yet delivered has no deliverer. Say so in the header, so the absence of a backfill reads as a decision rather than an oversight. Apply with `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy`.
- [X] T306 Write the sibling RLS migration `apps/api/prisma/migrations/<later-ts>_rls_attendance/migration.sql`, copying `20261019170018_rls_visits/migration.sql`: `ENABLE` and `FORCE ROW LEVEL SECURITY` on `"attendance"`, and an `attendance_tenant_isolation` policy with `USING` and `WITH CHECK` both `"company_id" = NULLIF(current_setting('app.company_id', true), '')`. Keep the fail-closed rationale comment. **`Attendance` is the only new tenant table in this slice**, so this is the only place Layer 2 needs extending. Carry the note those migrations all carry — that RLS separates **companies**, not two people inside one — and add the slice-specific half: attendance is company-wide by decision (FR-050), so unlike the executive routes there is deliberately **no third narrowing** here, and that is correct rather than missing. Timestamp must sort after T305.
- [X] T307 Register `'Attendance'` in `TENANT_MODELS` in `apps/api/src/infra/prisma/tenant.extension.ts`, with a comment naming this slice and its RLS migration, matching the existing blocks. This Set is the only Layer-1 guard, and a new tenant table missing either layer must fail CI (Constitution rule 2).
- [X] T308 [P] Create `apps/mobile/src/components/ManagerBottomNav.tsx` — **Reports · Visits · Attendance** — modelled on `AdminBottomNav.tsx` and `ExecutiveBottomNav.tsx`, which are already siblings rather than one parameterised component. Same geometry as both: 84 px tall plus the bottom inset, `#FFFFFF`, `1px solid #DFE4EC` top border, each item `flex: 1` with a 24 px outline icon above a 12 px / 600 label, active in `#1D4ED8` and inactive in `#5A6474`. Decode the icons from board 3.1's own nav (uuid `58a86d8e-eea6-41ac-a569-0a9265881f6c`) rather than reusing the executive's. A third sibling follows the reasoning `ExecutiveBottomNav`'s header already records: each bar is written around its own role's item set and route names, and a generic version of three would be harder to read than three small files.
- [X] T309 [P] Create `apps/mobile/src/features/manager/managerDesign.ts`, decoding boards 3.1 and 3.3 (CLAUDE.md recipe — decode, do not grep). Re-export the shared base tokens from `../admin/adminDesign` as `executiveDesign.ts` does — `BG`, `BLUE`, `INK`, `MUTED`, `LABEL`, `BORDER`, `DANGER`, `ROLE_LABELS` — and add only what boards 3.1–3.8 introduce: the violet action-bar fill and ink (`#EFE9FB` / `#5B2FA6`, the same pair the executive's Extra chip uses), the delivery chips (`To deliver` on `#EFE9FB`/`#5B2FA6`, `Delivered` on `#E3EBFC`/`#1E3A8A`, `No order` on `#E9EDF3`/`#3A4353`), the out-of-range distance ink `#7A4105`, and the within-range bar's three segment colours. Reuse by name wherever the hex already matches.

**Checkpoint**: the schema, both isolation layers, the contracts and the manager's shell components are in place. **Confirm quickstart Scenario 0 before going further** — RLS enabled *and* forced on `attendance`, and `'Attendance'` in `TENANT_MODELS`.

---

## Phase 3: User Story 1 - See yesterday at a glance (Priority: P1) 🎯 MVP

**Goal**: A manager signs in and lands on the previous-day report — six counts, the within-range bar, the flagged visits, and filters for date, executive and beat.

**Independent Test**: With a completed day recorded, open the report and confirm every count matches the records, the bar's three segments sum to assigned, and the out-of-range list contains exactly the flagged visits (quickstart Scenarios 1, 2, 3).

- [X] T310 [US1] Create `apps/api/src/modules/reports/previous-day.service.ts` — joining the `reports` module **slice 009 created one route wide for exactly this**. Follow `executive-totals.service.ts`'s class structure exactly (module-level fallback client, narrowed `Tx` type, `tx()`, `scopeToCaller()` setting both `app.company_id` and CLS). Compute: assigned, visited and pending from `AssignmentStop` on the day's `DailyAssignment`s (`@@index([companyId, assignmentId, status])`), **counting every `source`** so a manager-added extra is in both halves exactly as slice 009 established; order and no-order from `Visit` by `outcome`; out-of-range from `Visit` where `isExceedRange`. The three proportions are `within` (visited and not exceeded), `exceeded`, and `notVisited` (assigned − visited) — **`within + exceeded + notVisited === assigned` by construction** (SC-005). `withinPercent` is `within / visited`, and must handle a day with no visits without dividing by zero. Also return `outOfRangeVisits[]` (shop, executive, flag, distance, visit id) and `executives[]` with `name`, `beatPlanName`, `startedAt`, `endedAt` and `dayState`. **`dayState` is `NOT_STARTED | RUNNING | ENDED | AUTO_CLOSED` from `DailyAssignment.status`** — and `AUTO_CLOSED` has **no writer yet** because the nightly job is unbuilt, so read the field correctly and do not synthesise the value (research.md §5). **Scope is company-wide, not the caller's own executives** (FR-050) — this is the first service in the repo where the absence of a third executive-id narrowing is correct; say so in a comment so it is not "fixed" later.
- [X] T311 [US1] Add `GET /reports/previous-day` to `apps/api/src/modules/reports/reports.controller.ts` with a `PreviousDayQueryDto extends createZodDto(previousDayQuerySchema)` declared locally. **The controller is currently `@Roles('MARKETING_EXECUTIVE')` at class level** — change it so `/reports/executive-totals` keeps that role and this route takes `@Roles('MANAGER')`, by moving the decorator from the class to each method rather than widening the class-level one; a class-level `@Roles('MARKETING_EXECUTIVE','MANAGER')` would make an executive's token acceptable on the manager's route. Register `PreviousDayService` in `reports.module.ts`. No `Idempotency-Key`, no `@Audited` — a read.
- [X] T312 [US1] Create `apps/mobile/src/features/manager/PreviousDayReportScreen.tsx` matching board 3.1 exactly (uuid `58a86d8e-eea6-41ac-a569-0a9265881f6c`). The header with its date and "all beats" subtitle and the shared `AccountMenu`; the filter row (date, All executives, Location status); the **violet action bar** reading "Add extra shop to today" with its "One executive, today only · beat plan unchanged" label (wired in T335); the six count tiles; the within-range bar with its three segments, legend and percentage; the "Out of range · N" section with "See all visits" and a row per flagged visit; and `ManagerBottomNav` with Reports active. Handle the empty day explicitly (FR-006's edge case) — a day with nothing recorded says so rather than rendering a bar with no proportions and six unexplained zeroes.
- [X] T313 [US1] Make the manager app reachable. In `apps/mobile/src/navigation/RootNavigator.tsx` add a `ManagerStackParamList` and a `ManagerNavigator`, and change `stackForRole` so `MANAGER` returns it instead of `ComingSoonNavigator` — **this is the line slice 001 left with the comment "their own stacks are out of this story's scope"**. Register the report as the initial route, plus `Profile` and `ChangePassword` (board 1.10 is "all users"). Add the manager branch to `apps/mobile/src/features/profile/ProfileScreen.tsx`'s bottom-bar picker — **one branch, not a screen**: boards 1.9, 3.9 and 4.14 are identical apart from the bar, the role label already comes from `/me`, and the picker already switches on it. **`ComingSoonNavigator` now serves only `SYSTEM_ADMIN` and `EMPLOYEE`** — update its comment, which still names `MANAGER`.

**Checkpoint**: a manager can sign in and see yesterday. **This is the first manager screen that has ever existed** — US1 demonstrable, and the MVP.

---

## Phase 4: User Story 2 - Work through the visits (Priority: P1)

**Goal**: Every visit, filterable by outcome, out-of-range, executive and beat, ten at a time.

**Independent Test**: Open the list, confirm the rows match the records, switch each tab and confirm the right subset with the right counts, then scroll past the tenth row and confirm the next ten append (quickstart Scenarios 5, 6).

- [X] T314 [US2] Create `apps/api/src/modules/visits/manager-visits.service.ts` — **a new file, deliberately NOT an extension of `my-visits.service.ts`** (research.md §3). This is the inversion the whole feature turns on: slice 008's executive projection lists `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus` and `effectiveRadiusMeters` as forbidden **by name**, and board 3.3's distance column, its "· out" marker and its Out-of-range tab have no source but those. Two services producing two shapes means neither can acquire the other's fields by someone refactoring one; a shared shape with a role-conditional projection would put the product's most load-bearing rule inside an `if`, in the one service where both roles meet. Return per row: `id`, `businessDate`, `outcome`, `shopName`, `executiveName`, `occurredAt`, `summary`, `deliveryStatus` (null for a no-order), **`distanceMeters`** and **`isExceedRange`**. Keyset paging on `[{businessDate:'desc'},{submittedAt:'desc'},{id:'desc'}]` with Prisma `cursor` + `skip: 1`, exactly as `my-visits.service.ts` does — **not `OFFSET`**, which would re-serve a row whenever a visit is recorded between two fetches (FR-018). Apply `outcome` and `outOfRange` **independently** in SQL, plus `date`, `executiveId` and `beatPlanId` — the beat filter reaches `Visit → AssignmentStop → DailyAssignment.beatPlanId` and **no index serves it directly**, which is recorded rather than pre-optimised. Return `counts` (all / order / noOrder / outOfRange) on the first page only, for the current filters minus the tab.
- [X] T315 [US2] Add `GET /visits` to `apps/api/src/modules/visits/visits.controller.ts` with a `ManagerVisitsQueryDto extends createZodDto(managerVisitsQuerySchema)` declared locally and `@Roles('MANAGER')` on the method. **The class is `@Roles('MARKETING_EXECUTIVE')`**, so apply the same per-method treatment as T311 — never widen the class decorator, or every executive route in this controller would accept a manager and vice versa. Register `ManagerVisitsService` in `visits.module.ts`. Add a comment recording that this route and `GET /visits/mine` are **separate by design** per `03-ARCHITECTURE.md:829-830`, and that the split is what keeps the measurement out of an executive response structurally.
- [X] T316 [US2] Create `apps/mobile/src/features/manager/ManagerVisitsScreen.tsx` matching board 3.3 exactly (uuid `d71d2e67-7b3b-479c-b242-96da6f4965de`): the header, the date / All executives / All beats filter row, the four-tab group with counts, and the rows — the `ORD` / `NO` badge, shop, executive and time, the outcome summary, the delivery or no-order chip, and the distance **rendered as "N m · out" in `#7A4105` when the radius was exceeded** (FR-016). Use a `FlatList` with `onEndReached` and an in-flight ref guard, as `MyVisitsScreen` does — `onEndReached` can fire twice on one fast scroll and would otherwise append a page twice. Changing any tab or filter restarts the list from the newest matching visit (FR-020). Include the no-match empty state (FR-021).
- [X] T317 [US2] Wire the drill-through from `PreviousDayReportScreen.tsx`: each of the six count tiles opens the visits list **already filtered to what that tile counted** (FR-007) — assigned and pending map to the day with no outcome filter, order and no-order to the outcome tabs, out-of-range to `outOfRange: true` — and "See all visits" in the out-of-range section opens the list on the Out of range tab (FR-013). The date, executive and beat filters in force on the report carry through, so the list opens describing the same slice the manager was looking at.

**Checkpoint**: US1 + US2 is the complete P1 increment — a manager can see yesterday and work through it.

---

## Phase 5: User Story 3 - Open a visit and act on it (Priority: P2)

**Goal**: Boards 3.4, 3.5 and 3.6, with Mark as delivered.

**Independent Test**: Mark an order delivered and confirm who and when are recorded; open a no-order at a shop with history and confirm the last five reasons; open an out-of-range visit and confirm the map, the distance and the allowed radius (quickstart Scenarios 7, 8, 9).

- [X] T318 [US3] Add `getVisitDetail(companyId, visitId)` to `manager-visits.service.ts`, returning **one shape that serves all three detail boards** (research.md §4). The client picks the screen; the server cannot know which, because the same out-of-range order shows board 3.6 from the Out-of-range tab and board 3.4 from the Order tab (FR-029) — so return everything all three need and let the client choose, rather than taking a mode parameter that could be got wrong. Identity (`shopName`, `executiveName`, `beatPlanName`, `businessDate`, `occurredAt`, `sampleShown`); `order` when `ORDER` (lines of `{brandLabel, quantity}` from the recorded snapshots, `totalQuantity`, `deliveryStatus`, `deliveredAt`, `deliveredByName`); `noOrder` when `NO_ORDER` (`reasonLabel` plus `lastFiveReasons[]` — that **shop's** last five no-order visits **by anyone**, newest first, each with date, reason and recorder, the same shape `getStopDetail` already computes narrowed to no-orders); `measurement` (`distanceMeters`, `isExceedRange`, `effectiveRadiusMeters`, `accuracyMeters`, `flags`, `submittedAt`); and `location` (`shopLatitude`, `shopLongitude`, `capturedLatitude`, `capturedLongitude`). **Every measurement and location value is the one frozen on the `Visit`**, never the shop's current row (FR-030) — slice 006 snapshotted them for exactly this, and a later pin correction must not rewrite what a visit was judged against.
- [X] T319 [US3] Add `GET /visits/:id` to `visits.controller.ts`, `@Roles('MANAGER')` per-method as in T315. Unknown visit or another company's → `404 NOT_FOUND`, never a `403` that would confirm the row exists.
- [X] T320 [US3] Create `apps/api/src/modules/visits/order-delivery.service.ts` implementing `markDelivered(companyId, managerId, orderId)` in one transaction: load the order tenant-scoped (unknown → `404`); **reject when `deliveryStatus` is already `DELIVERED` → `409 ORDER_ALREADY_DELIVERED`**; otherwise set `deliveryStatus: 'DELIVERED'`, `deliveredAt` to the **server's** clock and `deliveredBy` to the caller. The refusal is the point, not defensiveness: reporting success would tell this manager they marked something another manager actually marked, and would overwrite the attribution FR-023 exists to record (FR-024, SC-008). There is **no un-deliver route** — delivery is one-way by decision.
- [X] T321 [US3] Add `POST /orders/:id/deliver` to `visits.controller.ts`: `@Roles('MANAGER')`, `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('order.delivered', 'Order')` — `order_marked_delivered` is in the PRD's own analytics list. The body is `markDeliveredSchema`, which is `z.object({}).strict()`: **empty on purpose**, because who marked it is the JWT's and when is the server's clock, so a body carrying `deliveredBy` or `deliveredAt` must be a `400` rather than a silent strip. Returns `200` with `{ orderId, deliveryStatus, deliveredAt, deliveredByName }`. Register `OrderDeliveryService` in `visits.module.ts`.
- [X] T322 [US3] Create `apps/mobile/src/features/manager/OrderVisitScreen.tsx` matching board 3.4 exactly (uuid `ed0bcc77-19fe-47e8-9c6a-195998663d31`): the position indicator ("1 / 112"), the delivery status card with its two states (`Waiting for delivery` on `#EFE9FB`/`#5B2FA6` with the ordered time, `Delivered` on `#E3EBFC`/`#1E3A8A` naming who and when), the order-lines table with brand, quantity and the total, and the Visit facts — executive and time, beat, sample shown, and the location verdict. **Mark as delivered** calls T321 with a device-minted `Idempotency-Key`, and reports `409 ORDER_ALREADY_DELIVERED` in plain language rather than as an unexplained failure. Previous and next arrows step one order at a time **through the set the manager was looking at**, and MUST be **unavailable at the ends rather than wrapping** (FR-025).
- [X] T323 [US3] Create `apps/mobile/src/features/manager/NoOrderVisitScreen.tsx` matching board 3.5 exactly (uuid `eb30fec5-03ab-4e68-9c1d-0e0d3ee01126`): the header reading "No order · {executive} · {date, time}", the shop, the reason given, the sample-shown and location chips, and the **"Last 5 no-order reasons here · Newest first"** section. When one reason repeats, render the board's own callout — *"'Stock sufficient' 3 times in the last 5 no-order visits. Last order here was 08 Sep."* (FR-027). With fewer than five, show what exists and say so rather than padding; with none, say this is the first.
- [X] T324 [US3] Create `apps/mobile/src/features/manager/OutOfRangeVisitScreen.tsx` matching board 3.6 exactly (uuid `3a9dd747-c459-426e-b830-0060de3036f7`): a **read-only** screen with the map showing the shop pin, its radius ring and the submitted point; "Distance from shop" against "Allowed radius"; the order lines or the no-order reason; and the GPS accuracy with the submission time. Use `react-native-maps`, **already linked since slice 006 — no new dependency and no native rebuild**. **Known limitation to expect, not fix**: the dev build's `GOOGLE_MAPS_API_KEY` is empty so **tiles render blank**, exactly as on `CaptureShopPinScreen` and the admin's shop form; the pin, the ring, the submitted point and every number are correct regardless and the tiles appear when a key is configured. **No Mark as delivered on this screen** — it is read-only (FR-028).
- [X] T325 [US3] Wire the tab-aware routing from `ManagerVisitsScreen.tsx` (FR-029, the subtle one). Opening a row **from the Out of range tab** always goes to `OutOfRangeVisitScreen`, whatever the outcome; from the **Order** or **No order** tab it goes to `OrderVisitScreen` or `NoOrderVisitScreen` — so the same out-of-range order shows the read-only range screen from one tab and the delivery screen from the other. This is board 3.3's own rule, read off its script: `cur === 'out' ? 'VisitReview' : v.kind === 'order' ? 'OrderDetail' : 'NoOrderDetail'`. Pass the current filter set so T322's prev/next arrows can step the same list.

**Checkpoint**: a manager can finish yesterday — see a visit, understand it, and mark a delivery.

---

## Phase 6: User Story 4 - Keep attendance (Priority: P2)

**Goal**: The day sheet and the session editor, with append-only amendments.

**Independent Test**: Mark a morning session Present with a late arrival and confirm the lateness is derived; amend it with a reason and confirm the original is preserved and the counts update (quickstart Scenarios 11, 12, 13).

**This story is independent of US1–US3 and US5.** It is the clean split point if this slice is built in two passes.

- [X] T326 [US4] Create `apps/api/src/modules/attendance/attendance.service.ts` with the day-sheet read. Follow `assignments.service.ts`'s class structure (module-level fallback client, narrowed `Tx`, `tx()`, `scopeToCaller()`). The roster is **every active member of the company's staff except the System Admin** — Employees, Marketing Executives, Managers and Company Admins alike (FR-040, decided with the user) — so **a manager appears on their own sheet** (FR-040a); note that in a comment, because it looks like a bug and is not. Return `businessDate`, `isToday`, `isFuture` (all from `CompanyClock`, never a device date), the four counts (present, late, absent-or-leave, not-marked), and per person their `morning` and `evening` cells from the **active** rows only (`isActive: true`), with `null` for an unmarked session — **never omitted**, because the sheet is a grid.
- [X] T327 [US4] Add the derivation to `attendance.service.ts`: `latenessFlag` from `actualTime` against `CompanySettings.morningSessionStart` or `eveningSessionStart` for that session, with `delay1hMinutes` and `delay2hMinutes` as the thresholds → `ON_TIME` / `DELAY_1H` / `DELAY_2H`; and `payableUnits` from `CompanySettings.payableUnitByStatus`, the JSON map seeded as `{"PRESENT":1,"HOLIDAY":1,"WEEKLY_OFF":1,"LEAVE":0,"ABSENT":0}`. **All five settings already exist** — slice 001 added them with no consumer, and this is that consumer, so there is no settings work and no new configuration surface. **Lateness must NEVER reduce `payableUnits`** (`OD-01`, FR-038). Both values are server-derived and both are absent from the request schema: lateness looks like an observation a device could make, but it is the company's settings applied to an arrival time, exactly as `distanceMeters` is the company's radius applied to a position (Constitution rule 1, SC-010). Session start times are company-local, so `CompanyClock` resolves the comparison.
- [X] T328 [US4] Add `recordAttendance(companyId, managerId, input)` to `attendance.service.ts` — **the append-only write**, in one transaction, in the order `contracts/manager-app.md` specifies. Reject a **future** business date against `CompanyClock` → `409 ATTENDANCE_DATE_IN_FUTURE`. Load the active row for `(userId, businessDate, session)`; if one exists and `changeReason` is absent → `400` — **the server decides whether this is a first record or an amendment; the client never declares it**, and requiring a reason to record a plain Present would be noise. Derive the two values (T327). **Insert** at `version = (existing?.version ?? 0) + 1`, then set the previous row's `isActive = false` and its `supersededById` — **both in the same transaction**, because two active rows for one session, or none, are each corrupt. Catch `P2002` on the version key → `409 ATTENDANCE_VERSION_CONFLICT`, which is what makes two managers amending at once produce one winner rather than a lost update. **Never an UPDATE of the status, time or flag** — Constitution rule 4, FR-037, SC-009.
- [X] T329 [US4] Create `apps/api/src/modules/attendance/attendance.module.ts` and `attendance.controller.ts` — a **new module**, because attendance is its own aggregate with its own model and its own versioning rules. `@ApiTags('attendance') @Controller('attendance') @UseGuards(RolesGuard) @Roles('MANAGER')`, with `GET /attendance` (an `AttendanceDayQueryDto`, no idempotency key) and `POST /attendance` (a `RecordAttendanceDto`, `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('attendance.record', 'Attendance')` — the PRD's analytics list has both `attendance_submitted` and `attendance_amended`). Import `AssignmentsModule` for `CompanyClock`, as `VisitsModule` and `ReportsModule` both do. Register `AttendanceModule` in `apps/api/src/app.module.ts`.
- [X] T330 [US4] Create `apps/mobile/src/features/manager/AttendanceDayScreen.tsx` matching board 3.7 exactly (uuid `71422460-a9d0-432c-bcf8-c0de656d0094`): the title with the date and a **Today** marker, previous/next day navigation, the four summary counts, and the grid — a row per person with their name and role and a morning and an evening cell. **Every cell's state must be readable as text, not colour alone** (FR-039, and an accessibility requirement rather than a preference). A future date renders its cells uneditable (FR-032). `ManagerBottomNav` with Attendance active.
- [X] T331 [US4] Create `apps/mobile/src/features/manager/AttendanceSessionScreen.tsx` matching board 3.8 exactly (uuid `8f1020a5-3275-4f54-84b9-f10edb256cfe`): the header reading "{date} · {Morning|Evening} session (starts {time})" and the person's name; the five status choices — Present, Absent, Leave, Holiday, Weekly off; the **Arrival time** field with its "Derived automatically" lateness display; and, **when a record already exists**, the board's own amendment block — *"Already recorded at 09:30 as Absent by you. Saving creates an amendment; the original stays in the audit trail."* — with the **required** "Reason for change" field and the note that *"Late flags are reported separately and don't change payable half-days unless your company sets a policy."* The action reads **Save amendment** in that case. Present without an arrival time cannot be saved (FR-035). Report `409 ATTENDANCE_VERSION_CONFLICT` as "this record changed — reload and try again", never as a silent overwrite.

**Checkpoint**: attendance works end to end, with its history provably intact.

---

## Phase 7: User Story 5 - Put a shop on someone's day (Priority: P3)

**Goal**: Board 3.2 — a manager adds an extra shop to a named executive's day, with a required reason.

**Independent Test**: Add a shop to an executive's day; confirm it appears as an extra stop attributed to the manager with the reason stored, and the beat plan unchanged (quickstart Scenario 14).

- [X] T332 [US5] Add the manager branch to `apps/api/src/modules/assignments/extra-stop.service.ts` — **a second entry point, not a second implementation**. Slice 007 built the whole transaction and its research recorded that building the executive's route at that path "leaves the manager's as a sibling rather than a refactor"; this is that sibling. **Exactly three differences, and nothing else**: (1) `source: 'MANAGER_EXTRA'` — an enum value slice 005 declared with no writer, and this is its first; (2) `reason` is **required** and written to `AssignmentStop.addReason`, the column T304 adds; (3) **the assignment is not the caller's own** — the manager chooses a person, so the executive-id narrowing every prior route applies is replaced by a company-scope one. **That third point is the one to call out in a comment**: it is the first route in the repo where the absence of an executive narrowing is correct rather than a bug, and it will look wrong to anyone who has read the other services. `addedByUserId` already means "who added this stop" and takes the manager's id unchanged. The `RUNNING` check, the frozen radius and coordinates, the appended sequence, the `@@unique([assignmentId, shopId])` duplicate guard and the audit write are all reused untouched. **No `newShop` branch** — a manager at a desk picks from the directory, and board 3.2 offers search and no create.
- [X] T333 [US5] Add `POST /assignments/:id/stops/manager` to `apps/api/src/modules/assignments/assignments.controller.ts` with a `ManagerAddStopDto extends createZodDto(managerAddStopSchema)` (`shopId` and a required `reason` of `trim().min(3).max(280)`, `.strict()`), `@Roles('MANAGER')` per-method (the class is `@Roles('MARKETING_EXECUTIVE')` — same treatment as T311 and T315), `@UseGuards(RequireIdempotencyKeyGuard)` and `@Audited('extra-shop.manager-create', 'AssignmentStop')`. Path taken verbatim from `03-ARCHITECTURE.md:825`, which sits one line below the executive's — note that in a comment.
- [X] T334 [US5] Create `apps/mobile/src/features/manager/AddShopToTodayScreen.tsx` matching board 3.2 exactly (uuid `47a5b552-8ab3-44cf-a169-3d8aeb692e06`): the header reading "{date} · today only"; the violet explanatory banner — *"This adds one extra stop to the executive's day. The **beat plan is not changed**, and tomorrow's list is unaffected."*; the **Executive** picker showing the chosen person's beat and progress ("Priya S · Anna Nagar North · 5 of 12 done"); the **Shop to add** search with its selectable rows and pin chips; the **required** "Reason for adding (recorded in the audit log)" field; and the footer reading "{name} will see … as an extra stop today" with **Add to today's plan**, disabled until a shop is chosen. Shops already on that executive's day are excluded from the picker.
- [X] T335 [US5] Wire the violet action bar on `PreviousDayReportScreen.tsx` to open T334, and register the screen in the manager stack. The bar already renders from T312; this gives it its destination (FR-012).

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T336 Handle the offline, stale and empty states across all eight manager screens. **These are reads** — `03-ARCHITECTURE.md:1016` says only visit submission, extra-shop addition, pin capture and beat start/end are queueable, and reads fall back to the last loaded payload with a visible note. So a failed refresh keeps what is on screen and says it is not fresh, following the wording `TodaysBeatScreen` already uses; a first load with no connection says there is no connection — **never zeroes**, which on the report would read as "nothing happened yesterday" (FR-051). The two commands (mark delivered, save attendance) are the manager's, made at a desk rather than in a shop, so they are **reported rather than queued** — but a repeat must not create a second record, which their `Idempotency-Key`s already guarantee (FR-052). Distinguish `ApiError` with `code === 'NETWORK_ERROR'` from a real server error, as `MyVisitsScreen` does.
- [X] T337 [P] Regenerate `docs/openapi.json` to include all six new routes — `GET /reports/previous-day`, `GET /visits`, `GET /visits/{id}`, `POST /orders/{id}/deliver`, `GET /attendance`, `POST /attendance` and `POST /assignments/{id}/stops/manager` — mirroring how `009`'s T297 did it (`pnpm --filter api generate:openapi`).
- [ ] T338 [P] Run all 16 scenarios in `specs/010-manager-app/quickstart.md` on a physical device, except the `curl`/`SQL` steps. **Scenarios 0, 9, 10 and 13 must not be skipped** — the migration and its RLS, the routing that decides which detail screen opens, the proof that executives still cannot see a measurement, and the attendance amendment keeping its original. **Scenario 10 is the one this whole feature rests on**: it inverts a rule five slices worked to enforce, and the inversion is only safe if the other half is proven intact in the same run. Scenario 9 needs **both** an out-of-range order and an out-of-range no-order or it tests nothing. Scenarios 2 and 5 are the fidelity checks across all eight boards. Expect blank map tiles on board 3.6 — a known environment gap, not a defect.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T299–T303)**: T299–T302 are independent; T303 re-exports T300–T302 and lands last.
- **Foundational (T304–T309)**: T304 → T305 → T306 sequential. T307 follows T304. T308 and T309 are mobile-only and independent of all of it.
- **User Stories (Phases 3–7)**: all depend on Foundational. **US4 additionally depends on T305's `attendance` table and T306's RLS** — it is the only story that does.
- **Polish (T336–T338)**: T336 depends on the screens you ship; T337–T338 on the stories.

### User Story Dependencies

- **US1 (P1)**: Foundational only. The MVP, and the story that creates the manager stack.
- **US2 (P1)**: T317 edits T312's screen, so it lands after US1. T314/T315 are independent of US1's API.
- **US3 (P2)**: T318 **extends T314's file**; T325 edits T316's screen. Both land after US2.
- **US4 (P2)**: **independent of US1–US3 and US5** apart from the stack T313 creates. The clean split point.
- **US5 (P3)**: T335 edits T312's screen; T332 extends slice 007's service.

### Within Each User Story

- Service before controller; API before the screen that calls it; the screen before its wiring.

### Parallel Opportunities

- T299–T302 (four different files).
- T308 and T309 (mobile) alongside T304–T307 (schema and API).
- Within US3: T320/T321 (delivery) alongside T318/T319 (detail read) — different services.
- **US4's whole API (T326–T329) alongside US2 or US3**, since it shares no file with either.
- T337 and T338.
- **Serialization points to respect**: `manager-visits.service.ts` is edited by T314 then T318. `visits.controller.ts` by T315, T319 then T321. `attendance.service.ts` by T326, T327 then T328. `PreviousDayReportScreen.tsx` by T312, T317 then T335. `ManagerVisitsScreen.tsx` by T316 then T325. `RootNavigator.tsx` by T313, and again by each story that adds a route.

---

## Implementation Strategy

### MVP (US1)

1. Setup (T299–T303)
2. Foundational (T304–T309) — **blocks everything**; confirm Scenario 0's RLS check before going on
3. US1 (T310–T313) → validate: quickstart Scenarios 1, 2, 3, 4
4. **Stop and demo** — a manager can sign in and see yesterday, for the first time in the product's life

### Incremental Delivery

5. US2 (T314–T317) → Scenarios 5, 6. **US1 + US2 is the P1 release.**
6. US3 (T318–T325) → Scenarios 7, 8, 9, 10
7. US4 (T326–T331) → Scenarios 11, 12, 13 — **independent; can run in parallel with US2/US3 if staffed**
8. US5 (T332–T335) → Scenario 14
9. Polish (T336–T338) → Scenario 15 + the full quickstart

### If this slice is split in two

**Cut after US3.** Pass one is US1–US3 plus Setup, Foundational and Polish — the manager's review workflow, no attendance. Pass two is US4 and US5. The only cost is running T305's migration in two parts, or shipping the whole migration in pass one and leaving the `attendance` table unused until pass two — the latter is simpler and harmless.

### Notes

- `[P]` = different files, no dependencies.
- **Do not add**: a visit review route or `ReviewStatus`'s other two enum values, a CSV export, a push notification, an un-deliver route, the nightly auto-close job, salary, the Company Admin role on any of these routes, the admin's mirror screens (4.2–4.5), or any monetary value anywhere. Each is a reasoned exclusion (research.md §12, spec.md *Scope boundaries*), not an oversight.
- **The rule this slice inverts, and the one it must not.** A manager sees the measured distance, the range verdict and the flags; an executive still never does. The two projections live in two services (`manager-visits.service.ts`, `my-visits.service.ts`) **and must not be merged, parameterised or refactored into one** — that would put the product's most load-bearing rule inside an `if`. Scenario 10 proves both halves in one run.
- **Never widen a class-level `@Roles`.** Three controllers in this slice gain a manager route beside existing executive ones. Widening the class decorator would make every route in that controller accept both roles; move it to the methods instead (T311, T315, T333).
- **`latenessFlag` and `payableUnits` are derived, never accepted.** They look like facts a device could report; they are the company's settings applied to one. Same reasoning as `distanceMeters`.
- **An attendance amendment is an insert plus a flip, never an update.** If a task seems to call for `prisma.attendance.update` on a status, time or flag, re-read data-model.md's state transitions before writing it.
- **Three columns arrive with their writers**, as this schema has done throughout: `addReason` (deferred by slice 007 by name), `deliveredAt` and `deliveredBy`. None needs a backfill, and T305 says why.
- Commit after each task or logical group; stop at any checkpoint to validate.

---

## T338 — verification note (2026-10-20)

**Not run.** T338 is a physical-device walkthrough and there is no device
attached to this environment, so it stays open; GitHub issue #339 carries
it with `help wanted`, as slices 006, 008 and 009 did for theirs.

What *was* verified in its place, on a real Postgres with a throwaway
company that has since been removed:

- **Scenario 0** — both migrations applied forward on a clean database, and
  `attendance_tenant_isolation` confirmed present with `FORCE ROW LEVEL
  SECURITY`.
- **Scenarios 1, 3, 4, 6, 7, 8, 11, 12, 14** — every route exercised over
  HTTP with real JWTs: the previous-day report's counts and proportions,
  the visits list and its three filters with keyset paging, the three
  detail payloads, mark-delivered including its second attempt
  (`409 ORDER_ALREADY_DELIVERED`), the attendance day sheet, a record, an
  amendment, and a manager extra stop.
- **Scenario 9** — an out-of-range order and an out-of-range no-order both
  present in the same run, each opening from the Out of range tab.
- **Scenario 10** — the one this feature rests on. In the same run, an
  executive's `GET /visits/mine` was re-checked key by key and still
  carries no `distanceMeters`, no `isExceedRange` and no flags. This caught
  a real regression while it was being built: `@Get('visits/:id')` had been
  declared before `@Get('visits/mine')`, so Nest matched the wildcard first
  and the executive's own history answered `403`. The route order is now
  fixed and carries a warning comment in `visits.controller.ts`.
- **Scenario 13** — an amendment keeps the original readable: version 1
  stays in the table with `isActive = false` and its own reason and actor.

**Left for the device**: Scenarios 2 and 5 (board fidelity across all eight
screens), 15 (offline, stale and empty states), and the map tiles on board
3.6 — which will render blank until `GOOGLE_MAPS_API_KEY` is configured, a
known environment gap rather than a defect.
