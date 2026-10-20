# Phase 0 Research: The Manager App

**Feature**: `010-manager-app` | **Date**: 2026-10-20

Every decision below is grounded in code that already exists in this repository, in a board decoded from `docs/ui-design/Field_Sales_Beat_App.html`, or in the architecture's own API surface table. Where the design, the product requirements and the data model disagree, the disagreement is named rather than smoothed over.

**This is the largest slice so far** — eight boards where every previous one covered two at most. The research is organised so the three independent parts (review, attendance, extra shop) can be read separately, because they can also be *built* separately.

---

## §1 — Every route is already specified; use those paths

**Decision**: six endpoints, all taken verbatim from the architecture's API surface table rather than invented here.

`03-ARCHITECTURE.md:828-836`:

```
| GET  | `/visits`                       | Manager, Admin | filters: date, outcome, range, executive, beat, source |
| GET  | `/visits/:id`                   | Manager, Admin |                                                        |
| POST | `/orders/:id/deliver`           | Manager, Admin | marks delivered                                        |
| GET  | `/attendance?date=` · POST `/attendance` | Manager, Admin | upsert creates an amendment                   |
| POST | `/assignments/:id/stops/manager`| Manager        | extra shop with `reason`                               |
| GET  | `/reports/previous-day?date=`   | Manager, Admin |                                                        |
```

**Rationale**: the document already decided these, so there is no design question — only an instruction to follow. Two are worth drawing attention to:

- **`GET /visits` is a different route from `GET /visits/mine`**, which slice 008 built. That split is the architecture's own and it is load-bearing: the manager's list carries the measured distance, the range verdict and the flags, and the executive's must never. Slice 008's plan recorded the reasoning; this slice is the other half of it.
- **`GET /reports/previous-day` joins the `reports` module** slice 009 created for exactly this. That module was built one route wide with a note that this one would join it, so there is nothing to restructure.

**Module placement**:

| Route | Module | Why |
|---|---|---|
| `GET /visits`, `GET /visits/:id` | `visits` | where the visit aggregate already lives |
| `POST /orders/:id/deliver` | `visits` | an `Order` is only reachable through its `Visit`, and `Order` has no module of its own |
| `GET /reports/previous-day` | `reports` | created by slice 009 for this |
| `GET /attendance`, `POST /attendance` | **`attendance`** (new) | its own aggregate, its own model, its own versioning rules |
| `POST /assignments/:id/stops/manager` | `assignments` | beside the executive's `POST /assignments/:id/stops`, which is where slice 007 left room for it |

---

## §2 — The migration, and the three columns that were deliberately left for this slice

**Decision**: one migration, adding one model, three enums and three columns. Each of the three columns was omitted by an earlier slice **on purpose**, with a note naming this one.

### `Attendance` — a new model

Taken from `03-ARCHITECTURE.md:669` as written. Nothing about it is invented here.

**The versioning rule is the part to get right** (`03-ARCHITECTURE.md:756`): *"amendments insert a new row with `version + 1` and flip the old row's `isActive`. The unique key includes `version`, so history is append-only."* That is Constitution rule 4 expressed as a schema, and it is why FR-037 can promise that nothing is ever overwritten.

**`CompanySettings` already has everything this needs** — `morningSessionStart`, `eveningSessionStart`, `delay1hMinutes`, `delay2hMinutes` and `payableUnitByStatus` were all added by slice 001 **with no consumer**. This feature is that consumer. No settings work, no new configuration surface.

### `AssignmentStop.addReason` — left out by slice 007, on the record

Slice 007's own data model says it plainly:

> `AssignmentStop.addReason` appears in `03-ARCHITECTURE.md:585` but **not** in the repository schema; slice 005 omitted it deliberately. It is for manager-added extras, which are out of scope, so it stays omitted.

Manager-added extras are no longer out of scope, so the column arrives with its writer — which is the discipline the schema has followed throughout.

### `Order.deliveredAt` / `Order.deliveredBy` — the attribution FR-023 needs

The architecture's `Order` carries both; the repository's does not, because slice 006 had no one to write them. `deliveryStatus` is already there with `TO_DELIVER` as its default, so this is two nullable columns, not a state machine.

**Note a naming difference, and keep the repository's.** The architecture writes `DeliveryStatus { PENDING DELIVERED }`; the repository has `{ TO_DELIVER DELIVERED }`, which is also what board 3.3's chip says ("To deliver"). The repository and the design agree, so the architecture's spelling is the outlier and is not adopted.

### What is *not* in this migration

- **`ReviewStatus` stays two-valued.** The architecture lists `{ NOT_REQUIRED PENDING_REVIEW ACCEPTED REVISIT_REQUESTED }`; the repository has the first two because slice 006 had no writer for the others. Reviewing a visit is out of scope (spec, *Scope boundaries*), so they stay unbuilt rather than being added with no writer.
- **`StopSource.MANAGER_EXTRA` already exists** with no writer — declared by slice 005, used by nothing. This feature is its first writer, exactly as `EXEC_EXTRA` was slice 007's.

---

## §3 — The manager's projection is a different shape, not a wider one

**Decision**: `GET /visits` returns a shape authored for the manager. It does **not** extend, wrap or role-filter the shape `GET /visits/mine` returns.

**Rationale**: this is the inversion the whole feature turns on. Slice 008 built the executive's list with a six-field projection and wrote the forbidden fields out by name — `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, every coordinate. The manager's list is built on precisely those: board 3.3's distance column, its "· out" marker and its Out-of-range tab have no other source.

A single shape with a role-conditional projection would put the product's most load-bearing privacy rule inside an `if`, in the one service where both roles meet. Two shapes in two services means the executive's cannot acquire a field by someone editing the manager's.

**Concretely**: `my-visits.service.ts` (slice 008) is not touched by this feature. A new `manager-visits.service.ts` sits beside it. Both read `Visit`; neither can widen the other.

**The guard that makes this testable**: slice 008's quickstart asserts the executive row's exact key set. This slice's quickstart asserts the manager's *includes* the measurement — and re-runs slice 008's assertion unchanged, so the executive's side is proven untouched by the same test run (SC-011).

---

## §4 — "Out of range" is a filter, not an outcome

**Decision**: the Out-of-range tab filters on `isExceedRange`, orthogonally to `outcome`. Which detail screen opens is decided by **the tab the manager came from**, not by what the visit is.

**Rationale**: read off board 3.3's own component script, which routes exactly this way:

```js
href: base + (cur === 'out' ? 'VisitReview.dc.html'
                            : v.kind === 'order' ? 'OrderDetail.dc.html'
                                                 : 'NoOrderDetail.dc.html')
```

and the filter is `cur === 'out' ? v.out : v.kind === cur` — `out` is a boolean beside `kind`, not a third value of it.

FR-MGR-16 states the consequence and the spec makes it FR-029: an out-of-range **order** opened from the Order tab shows board 3.4 **so it can still be marked delivered**, while the same visit opened from the Out-of-range tab shows the read-only board 3.6. The same row, two destinations, decided by context.

**Why that matters for the contract**: the detail route cannot infer its own screen. The client asks for a visit and tells the server nothing about which screen it wants — so `GET /visits/:id` returns everything both screens need, and the client picks. One round trip, one shape, no mode parameter to get wrong.

---

## §5 — The previous-day report is five aggregates, and slice 009 paid for three

**Decision**: `GET /reports/previous-day` computes its six counts and its three proportions from the same tables slice 009's totals already read, through the same indexes.

| Figure | Source |
|---|---|
| Assigned, pending | `AssignmentStop` on the day's `DailyAssignment`s |
| Visited | those at `COMPLETED` |
| Order, no-order | `Visit` by `outcome` |
| Out of range | `Visit` where `isExceedRange` |
| Within / exceeded / not visited | the three above, as proportions |
| Beat start and end per executive | `DailyAssignment.startedAt` / `endedAt` / `status` |

**`Visit.businessDate` and `visits_exec_history_idx` do most of the work again.** Slice 008 added them so My visits could page day-major; slice 009 found a period filter was then a range scan. Here the filter is a single date, which is the same scan with a narrower bound. **Without that column this report would join `DailyAssignment` on every aggregate.**

The index's leading columns are `(companyId, executiveId, …)`. The manager's unfiltered report spans *all* executives, so it does not use the index's second column — Postgres scans the day's visits, which for one company-day is hundreds of rows. That is acceptable and is recorded rather than optimised prematurely; if it ever is not, the fix is an index led by `(companyId, businessDate)`, not a change of shape.

**FR-011's auto-closed and never-started marks** come from `DailyAssignment.status`: `null` is never started, `ENDED` normally, and the nightly `AUTO_CLOSED` transition the architecture describes. That nightly job does not exist yet, so `AUTO_CLOSED` has no writer today — the report reads the field correctly and will simply never see that value until the job ships. **Stated rather than quietly rendered as a state that cannot occur.**

---

## §6 — Lateness is derived, never sent

**Decision**: the client sends a status and, for `PRESENT`, an arrival time. The server derives `latenessFlag` and `payableUnits`. Both are absent from the request schema, which is `.strict()`.

**Rationale**: this is Constitution rule 1 in a new domain. The product has spent five slices making sure a device cannot assert what it is measured as — distance, range verdict, flags — and lateness is the same kind of value: a judgement the company's settings make, not a fact the device observes. FR-035 and SC-010 say so; `.strict()` makes a client that sends `latenessFlag` a `400` rather than a silent strip.

**The rule**: `actualTime` against `CompanySettings.morningSessionStart` or `eveningSessionStart` for that session, with `delay1hMinutes` and `delay2hMinutes` as the thresholds — `ON_TIME`, `DELAY_1H`, `DELAY_2H`. All four settings already exist with the right defaults.

**`payableUnits` likewise** comes from `CompanySettings.payableUnitByStatus`, the JSON map slice 001 seeded as `{"PRESENT":1,"HOLIDAY":1,"WEEKLY_OFF":1,"LEAVE":0,"ABSENT":0}`. Lateness does **not** reduce it (FR-008 of the PRD's attendance set, and `OD-01`), which the editor must say in words — FR-038.

**Session start times are company-local**, so `CompanyClock` resolves the comparison. The device's clock never enters it.

---

## §7 — An amendment is a new row, never an update

**Decision**: `POST /attendance` is an upsert from the caller's point of view and an **insert** from the database's. Creating the first record for a session writes `version: 1`. Changing it writes `version: n+1` and flips the previous row's `isActive` to false, in one transaction.

**Rationale**: `03-ARCHITECTURE.md:756` specifies it, Constitution rule 4 requires it, and FR-037 promises the previous value stays readable. `@@unique([companyId, userId, businessDate, session, version])` makes a duplicate version unrepresentable rather than merely unlikely.

**A reason is required only on an amendment**, not on a first record — FR-037 says "changing an existing record", and requiring a reason to record a plain Present would be noise. The server decides which case it is from whether an active row exists; the client does not declare it.

**The concurrency case is real** and the spec names it: two managers editing the same session at once. The unique key on `version` means the second insert fails rather than both succeeding — so the loser is told the record changed and re-reads, instead of silently overwriting the winner. Same shape as the `P2002` handling slices 005 and 007 already use.

---

## §8 — Paging the manager's visits

**Decision**: keyset pagination on `(businessDate, submittedAt, id)`, page size 10 — the same mechanism slice 008 built for `GET /visits/mine`, for the same reason.

**Rationale**: FR-018 requires that no visit appear twice across a scroll. With `OFFSET`, a visit recorded between two fetches shifts every later row down and page 2 re-serves page 1's last row. The keyset cursor asks for "the rows after *this specific row*", so an insertion ahead of it is invisible to later pages.

The ordering is the same day-major one, which matters less here than on board 1.5 — the manager's list has no day headings — but keeping it identical means one ordering rule in the product rather than two.

**The filters are the difference**: outcome, out-of-range, executive and beat, all applied in SQL so a page of ten is ten *matching* visits (FR-019). The beat filter reaches through `Visit → AssignmentStop → DailyAssignment.beatPlanId`; no index serves it directly, which is recorded here rather than pre-optimised.

---

## §9 — The manager's extra shop reuses the executive's transaction

**Decision**: `POST /assignments/:id/stops/manager` is a second entry point into `ExtraStopService`, not a second implementation.

**Rationale**: slice 007 built the whole transaction — the running-day check, the frozen radius and coordinates, the appended sequence, the `@@unique([assignmentId, shopId])` duplicate guard, the audit write — and its research recorded that "building the executive one at that path leaves the manager's as a sibling rather than a refactor". This is that sibling.

**The three differences, and nothing else**:

1. `source: 'MANAGER_EXTRA'` rather than `EXEC_EXTRA`.
2. `addReason` is **required**, and written to the new column (§2).
3. The assignment is looked up by **executive and date**, because the manager chooses a person rather than acting on their own day. The executive-scope narrowing that every prior slice applied is therefore replaced by a company-scope one — this is the first route where that is correct rather than a mistake, so it is called out.

`addedByUserId` already means "who added this stop" and takes the manager's id with no change.

---

## §10 — The manager app shell

**Decision**: a new `ManagerStack` with its own three-item bottom bar — **Reports · Visits · Attendance** — modelled on `AdminBottomNav` and `ExecutiveBottomNav`, which are already siblings rather than one parameterised component.

**Rationale**: `RootNavigator` currently routes `MANAGER` to `ComingSoonNavigator`, with a comment from slice 001 saying their stack is out of that story's scope. This feature is that scope. A third bar follows the two existing ones for the reason `ExecutiveBottomNav`'s header already records: each is written around its own role's item set and route names, and a generic version of three would be harder to read than three small files.

**The account menu is already shared.** The profile work extracted `AccountMenu` into one component for every role, and `ProfileScreen` already picks its bottom bar from the role `/me` returns. The manager's profile therefore needs **one branch in that existing picker**, not a screen.

---

## §11 — The map, and a limitation that is already known

**Decision**: board 3.6 uses `react-native-maps`, which is already a dependency — slice 006 added it for the executive's pin-capture screen. **No new dependency and no native rebuild.**

**The limitation, stated because it will look like a defect**: slice 006 recorded that the dev build's `GOOGLE_MAPS_API_KEY` is empty, so **map tiles render blank**. The same gap already affects `CaptureShopPinScreen` and the admin's shop form. Everything else on board 3.6 — the distance, the allowed radius, the accuracy, the submission time, the outcome detail — works regardless, and the tiles appear the moment a key is configured.

The three things the map draws are all server-supplied and all already stored: the shop's approved coordinate **as frozen on the stop**, the radius **as frozen on the stop**, and the visit's own captured point. FR-030 requires exactly that — the visit shows what it was measured against, not what the shop's coordinates are today.

---

## §12 — What this slice does not build

Recorded so each is visibly a decision rather than an omission:

- **Reviewing a visit** (`POST /visits/:id/review`, and `ReviewStatus`'s other two values). Adjudicating an exception is a different decision from seeing it.
- **CSV export** (FR-MGR-08). Its own slice, with its own audit requirements — `/reports/*/export.csv` is marked "streamed, audited" in the same table.
- **The push notification** to an executive when a manager adds a shop (FR-EXTRA-09). Notifications are their own slice.
- **The nightly auto-close job.** The report reads `AUTO_CLOSED` correctly; nothing writes it yet (§5).
- **Salary.** Attendance is its input; this slice records attendance and computes nothing about pay.
- **The Company Admin's mirror screens** (4.2–4.5). The routes are marked "Manager, Admin" and will serve them, but the screens are not this feature.

---

## Summary of new surface

| Layer | What is added |
|---|---|
| Prisma | **One migration**: the `Attendance` model with append-only versioning; three enums (`AttendanceSession`, `AttendanceStatus`, `LatenessFlag`); `AssignmentStop.addReason`; `Order.deliveredAt` / `deliveredBy`. Plus RLS and `TENANT_MODELS` for `Attendance` — the only new tenant table. |
| Shared | `manager-visits.schema.ts`, `attendance.schema.ts`, `reports.schema.ts` (extended); error codes for the delivery and amendment refusals. |
| API | Six routes at the paths `03-ARCHITECTURE.md:828-836` already specifies, across a new `attendance` module and the existing `visits`, `reports` and `assignments` ones. |
| Mobile | Eight screens, a `ManagerStack`, a `ManagerBottomNav`, one branch in `ProfileScreen`'s bar picker, and `managerDesign.ts`. **No new dependency and no native rebuild.** |
