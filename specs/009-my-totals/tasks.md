---

description: "Task list for My Totals — Executive"
---

# Tasks: My Totals — Executive

**Input**: Design documents from `/specs/009-my-totals/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/executive-totals.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md`'s 12 manual scenarios are the verification path (Polish, T298).

**Organization**: Grouped by user story (spec.md: US1 is P1, US2 and US3 are P2). Task IDs continue the repo-wide sequence — 001 (T001–T074), 002 (T075–T107), 003 (T108–T135), 004 (T136–T172), 005 (T173–T203), 006 (T204–T234), 007 (T235–T261), 008 (T262–T282) — so this feature starts at **T283**.

**No migration, no new dependency, no native rebuild.** Every figure is an aggregate over tables that exist, through indexes that exist. If you find yourself writing a migration or adding a charting library, stop — something has been misread.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US3
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/reports/` (**new**), `apps/api/src/infra/time/`
- Shared: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/executive/`, `apps/mobile/src/components/`, `apps/mobile/src/navigation/`

## Board uuid (for the CLAUDE.md decode recipe)

| Board | uuid |
|---|---|
| **1.6 My totals (executive)** | `ef79b256-19a4-4963-b087-47a8ee0a71f7` |

---

## Phase 1: Setup

- [X] T283 [P] Create `packages/shared/src/reports.schema.ts` with `executiveTotalsQuerySchema` exactly as `contracts/executive-totals.md` specifies: a single field `period: z.enum(['TODAY','THIS_WEEK','THIS_MONTH']).default('THIS_WEEK')`, wrapped in `.strict()`. The default is `THIS_WEEK` because that is board 1.6's own default state (FR-007). Header comment must record **what the absences are protecting**, because this schema is unusually small and a later contributor will be tempted to widen it: there is no `executiveId` (the caller's id comes from the verified JWT), and **no `from`/`to`** — the architecture's table writes this route as `?from=&to=`, but resolving "what is Monday of this week, in my company's timezone?" on the device would be a second conversion point, which Constitution rule 8 puts in exactly one place, and a wrong device timezone would get it wrong **silently**, leaving the executive's figures disagreeing with their manager's for the same person and period. `.strict()` makes all three a `400` naming the key rather than something the server must remember to ignore. `from`/`to` is the manager's arbitrary-range shape and belongs to slice 014.
- [X] T284 Add an explicit re-export block for `reports.schema.ts` to `packages/shared/src/index.ts` — value export then `export type`, no `export *`, matching the `visits.schema` / `extra-shops.schema` / `my-visits.schema` blocks already at the end of that file. Depends on T283.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work can begin until this phase is complete. Every aggregate in Phases 3–5 is scoped by the period T285 resolves.

- [X] T285 Add three period helpers to `apps/api/src/infra/time/company-clock.service.ts`, each taking and returning a `YYYY-MM-DD` business-date string: `startOfWeek(businessDate)` → the **Monday** of that date's week; `startOfMonth(businessDate)` → the 1st of that month; `endOfMonth(businessDate)` → the last day of that month. `startOfWeek` is one line on top of the existing `weekdayOf`, which already returns `1 = Monday … 7 = Sunday` — the convention `BeatPlan.workingDays` stores — so Monday is `businessDate − (weekdayOf(businessDate) − 1)` days. **The arithmetic belongs here and nowhere else**: the service's own header records that "a later feature that needs real time arithmetic adopts Luxon **inside this service**, without touching a single caller — which is the whole point of funnelling the conversion through one class" (Constitution rule 8). Parse via the existing `T00:00:00.000Z` UTC-midnight convention so a date can never shift by a day. Keep the existing `Intl`-based implementation; do not introduce Luxon for arithmetic this simple.
- [X] T286 Create the **new `reports` module** — `apps/api/src/modules/reports/reports.module.ts`, `reports.controller.ts` and `executive-totals.service.ts` — and register `ReportsModule` in `apps/api/src/app.module.ts` after `VisitsModule`. The module `imports: [AssignmentsModule]` for `CompanyClock`, which that module exports and `VisitsModule` already imports the same way. The controller is `@ApiTags('reports') @Controller('reports') @UseGuards(RolesGuard) @Roles('MARKETING_EXECUTIVE')` with a `GET executive-totals` handler taking an `ExecutiveTotalsQueryDto extends createZodDto(executiveTotalsQuerySchema)` declared locally, plus the defensive `requireCompanyId`/`requireExecutiveId` helpers copied from `visits.controller.ts`. **No `Idempotency-Key` and no `@Audited`** — this is a read, and `/reports/*/export.csv` is the audited route, not this one. The service follows `assignments.service.ts`'s class structure exactly (module-level fallback client, narrowed `Tx` type, `tx()`, `scopeToCaller()` setting both `app.company_id` and CLS) plus the executive narrowing slices 005–008 established. **In this task it resolves the period only** and returns the `period` block — `{ period, from, to, label }` per `data-model.md` — so the endpoint is live and checkable before any aggregate exists. Add a comment recording that the path is taken verbatim from `03-ARCHITECTURE.md:837`, that this module is where slice 014's `previous-day`, `shop-history` and CSV export routes will join, and **the trap in `contracts/executive-totals.md`**: that table marks this route "all, scoped", and when Manager is added their report carries an out-of-range count, so widening *this* response by role would put the privacy rule inside an `if` — the fix then is a sibling route or a second projection, not a conditional field.

**Checkpoint**: `GET /reports/executive-totals?period=…` returns a correctly-resolved, company-local period for all three tabs. The boundaries are the thing everything else is scoped by, so confirm them before going further.

---

## Phase 3: User Story 1 - See how I am doing, for a period I choose (Priority: P1) 🎯 MVP

**Goal**: Tapping **My totals** opens the executive's own figures — beat completion as a percentage and as "visited of assigned", plus counts of orders, no-orders and total quantity — with three tabs that recalculate everything.

**Independent Test**: Record a known mix of orders and no-orders today, open My totals, confirm the completion percentage, the visited/assigned line and the three counts match the records; then switch to This week and This month and confirm every figure changes (quickstart Scenarios 1, 3, 4, 5).

- [X] T287 [US1] Add the completion aggregate to `apps/api/src/modules/reports/executive-totals.service.ts`. Two indexed reads, not a join through visits: find the period's `DailyAssignment` ids for the caller (`@@index([companyId, executiveId, businessDate])`), then `groupBy` `status` over their `AssignmentStop`s (`@@index([companyId, assignmentId, status])`). Return `{ assignedStops, visitedStops, completionRate }` where `assignedStops` is **every** stop on those days **whatever its `source`** — counting only `PLAN` stops would let an executive who visited 12 planned shops plus 2 extras (slice 007) read "14 of 12" with a progress bar at 117%; counting every stop in both halves makes `completionRate ≤ 100` true by construction (FR-009, SC-007). `visitedStops` is those at `status: 'COMPLETED'`, which is what `submitVisit` already sets — it is the **stop** that is or is not covered, so do not count visits here. `completionRate` is `Math.round(visited / assigned * 100)`, and **`null` — not `0` — when `assignedStops` is 0** (FR-010): a holiday week and a wasted week are different facts, and `0%` says the wrong one. Never emit `NaN`.
- [X] T288 [US1] Add the outcome totals to the same service: `{ orderCount, noOrderCount, totalQuantity }`. The two counts are one `groupBy` on `Visit.outcome` filtered by `executiveId` and `businessDate` between the period's `from` and `to` — a range scan on the third column of `visits_exec_history_idx`, whose first two are already pinned, which is the index slice 008 added. `totalQuantity` sums `Order.totalQuantity` for the period's order visits; that column is already server-derived from the submitted lines (slice 006 stores it "because the manager's list and the reports sort and filter on them" — this is one of those reports), so summing it is summing a value the server already owns rather than re-deriving one. **Select nothing else from `Visit`**: not `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters` or any coordinate, and **compute no out-of-range count in any period** — the manager's report has one (PRD FR-MGR-02) and this screen must not, because "how many of my visits were flagged" tells the executive what an individual flag would (FR-021, SC-008). Put that list in a comment with the one-line test: **if a number is not visible on board 1.6, it must not be in the response.**
- [X] T289 [P] [US1] Add board 1.6's tokens to `apps/mobile/src/features/executive/executiveDesign.ts`, decoded from uuid `ef79b256-19a4-4963-b087-47a8ee0a71f7` (CLAUDE.md recipe — decode, do not grep the raw file). Reuse by name wherever the hex already matches: `BLUE` (`#1D4ED8`) is the completion card, the Orders tile value, the brand bar fill and today's column; `ON_BLUE_MUTED` (`#D3DFFB`) is the card's secondary copy; `BLUE_CHIP` (`#4169E1`) is the progress track; `AMBER_ACCENT` (`#F2C572`) is the progress fill; `TAB_TRACK` (`#E6EAF1`) is the tab track; `BORDER` (`#DFE4EC`) is every card hairline; `ROW_SEPARATOR` (`#ECEFF4`) is the brand row divider **and** the brand bar's own track; `SEGMENT_HEIGHT` (38) is the period segment, identical to board 1.5's `.seg` at 700/14. Add only what is genuinely new: the weekly chart's inactive column `#9DB5F0`, the chart card's fixed height `110`, the chart's maximum bar height `54`, and the completion percentage's 30 px size. Note in the comment that the chart's bar radius is asymmetric — `6px 6px 2px 2px`.
- [X] T290 [US1] Create `apps/mobile/src/features/executive/MyTotalsScreen.tsx` matching board 1.6, with the header, the period tabs, the completion card and the three tiles. Header: `52px 20px 12px` padding, column gap 12; the period label at 13 px `#5A6474` above **My totals** at 28 px / 700. Tabs: `#E6EAF1` track, 4 px padding, radius 12, gap 4; each segment flex-1, 38 tall, radius 10, **700**/14; selected `#FFFFFF` on `#141A26`, unselected transparent on `#5A6474`; labels `Today` / `This week` / `This month` with **no counts** (unlike board 1.5's). Completion card: `#1D4ED8`, radius 18, padding 16, gap 10; a `space-between` + `align-items: baseline` row with "Beat completion" at 13 px `#D3DFFB` and the percentage at **30 px / 700**; then a bar 8 px tall at radius 999, track `#4169E1`, fill **`#F2C572`** at the completion width; then "N of N assigned shops visited" at 13 px `#D3DFFB`. When `completionRate` is `null`, render copy saying nothing was assigned — **never `0%`, never `NaN%`, never an empty bar with a number missing**. Three tiles: a 3-column grid, gap 8; each `#FFFFFF`, `1px solid #DFE4EC`, radius 14, padding `10px 12px`, gap 2; label 12 px / 600 `#5A6474`, value 24 px / 700 — **Orders in `#1D4ED8`**, No order and Total qty in `#141A26`. Format large numbers with thousands separators, as the board does (`1,286`) (FR-012). Switching tab refetches and **recalculates everything** (FR-005). Bottom bar via the existing `ExecutiveBottomNav` with `active="MyTotals"`.
- [X] T291 [US1] Make the entry point live. In `apps/mobile/src/components/ExecutiveBottomNav.tsx` replace the **My totals** item's `onPress={() => comingSoon('My totals')}` with a new `onMyTotalsPress` prop, alongside the `onTodayPress` and `onMyVisitsPress` slice 008 added. **That was the last caller of `comingSoon`, so delete the now-dead helper** rather than leaving it to rot. Add `MyTotals: undefined` to `ExecutiveStackParamList` and register the screen in `apps/mobile/src/navigation/RootNavigator.tsx`. Pass the new prop from all three executive screens — `TodaysBeatScreen`, `MyVisitsScreen` and `MyTotalsScreen` — so every tab navigates from everywhere, and pass `active="MyTotals"` from this screen. After this task **no item in the executive's bottom bar raises the coming-soon alert** (quickstart Scenario 1 step 5).

**Checkpoint**: an executive can see their completion and their three headline figures for any of the three periods. US1 demonstrable — this is the MVP.

---

## Phase 4: User Story 2 - See what I am actually selling (Priority: P2)

**Goal**: A "Quantity by brand" section lists the brands sold in the period with their quantities and proportional bars.

**Independent Test**: Record orders across several brands with different quantities, open My totals, and confirm each brand appears with the right quantity, largest first, with the longest bar on the largest — and that the quantities sum exactly to the Total qty tile (quickstart Scenario 6).

- [X] T292 [US2] Add the brand aggregate to `executive-totals.service.ts`: `groupBy` `OrderLine` summing `quantity`, filtered through the relations `order.visit.executiveId` and `order.visit.businessDate` between the period's bounds. **Group by `brandId`, and label each group with the most recently recorded `brandLabel` among that brand's lines in the period** — not by `brandLabel`, and never by joining the current `Brand.label` (research.md §5). Grouping by label would satisfy FR-014 literally but would split one product into two rows with two names the moment an admin fixed a typo mid-period, and this screen exists to answer "which products are moving". Joining the live master would be the current value FR-014 forbids, and a retired brand would render blank. Return every brand, ordered **largest quantity first** (FR-013, FR-015) — nothing is capped, which is what earns the guarantee that `Σ brands[].quantity === totals.totalQuantity` exactly (FR-015a, SC-005). The relation walk is along unique indexes (`Order.visitId` is `@unique`, `OrderLine` has `@@unique([orderId, brandId])`) driven by the visit index; **if it ever proves slow**, the recorded fix is to fetch the period's visit ids once and group by `orderId IN (…)`, not to add an index speculatively.
- [X] T293 [US2] Add the Quantity by brand section to `MyTotalsScreen.tsx`. Heading `QUANTITY BY BRAND` at 12 px / 700, letter-spacing `0.06em`, uppercase, `#5A6474`. Card `#FFFFFF`, `1px solid #DFE4EC`, radius 16, padding `6px 14px`. Each row: column, gap 6, padding `10px 0`, `1px solid #ECEFF4` bottom border; a `space-between` row at 14 px with the name at 600 and the quantity at 700 **in the mono face**; then a bar 8 px tall at radius 999, track `#ECEFF4`, fill `#1D4ED8`, width `quantity / largestQuantity * 100%` — **measured against the largest brand in the list, not the period total**, so the comparison stays legible when one brand dominates. **Every brand renders; none is capped** (FR-015). Implement that by letting the card grow and making the **page** scroll — not by nesting a scrolling card inside a scrolling screen, which React Native handles poorly and which would trap the gesture (research.md §6). At three brands nothing overflows and the screen is pixel-identical to the board. Add the empty state for a period with no orders: say there is nothing to show rather than render an empty card (FR-013's empty case).

**Checkpoint**: US1 + US2 covers everything above the fold on board 1.6.

---

## Phase 5: User Story 3 - See the shape of my week (Priority: P2)

**Goal**: A chart of orders per day across the current week, with today's column picked out.

**Independent Test**: Record a different number of orders on two or more days of the current week, open My totals, and confirm each day's bar carries the right count, the tallest is on the busiest day, and today's column is visibly distinct (quickstart Scenario 7).

- [X] T294 [US3] Add the weekly series to `executive-totals.service.ts`: `{ from, to, days }`, where `days` is **always seven entries, Monday to Sunday**, each `{ businessDate, label, orderCount, isToday }`. The counts are one `groupBy` on `Visit.businessDate` where `outcome = 'ORDER'`, for the current week's bounds from `CompanyClock.startOfWeek` — then **materialise all seven days from the date range and fill missing ones with `orderCount: 0`**, because a `groupBy` returns no row for a day with no orders and omitting it would collapse the week's shape, which is the only thing the chart is for (FR-019). **Return this on every response whatever `period` was asked for, with its own `from`/`to` being the current week's, not the selected period's** (FR-016): PRD FR-MY-04 says the switcher recalculates everything shown, but FR-MY-05 and the design both say the chart is for the current week, and decoding board 1.6 settles it — `perDay` is computed outside the period lookup entirely. Returning it only for `THIS_WEEK` would make the screen fetch twice. `isToday` is **server-computed** from the company's business date, for the same reason slice 008 returns `todayBusinessDate`: a phone in the wrong timezone would otherwise highlight the wrong column (rule 8).
- [X] T295 [US3] Add the Orders per day chart to `MyTotalsScreen.tsx`. Heading `ORDERS PER DAY · THIS WEEK`, same `.sec` treatment as T293's. Card `#FFFFFF`, `1px solid #DFE4EC`, radius 16, padding `12px 14px`, **fixed height 110**, `flexDirection: row`, `alignItems: 'flex-end'`, gap 10. Each column: `flex: 1`, centred, gap 4 — the count above in **mono 11 px / 700 `#3A4353`**, then the bar at `width: '100%'`, `height: round(orderCount / busiestDay * 54)` px with **asymmetric radius `6px 6px 2px 2px`**, then the day name below at 11 px / 600 `#5A6474`. Today's bar is `#1D4ED8`; every other day is `#9DB5F0` (FR-018). The bar is measured against the **busiest day of that week**, not the period total. **Seven columns, Monday to Sunday** — this is the slice's first agreed divergence from the board, which draws six labelled Mon–Sat; with six, an order recorded on a Sunday would be counted in the completion card, the tiles and the brand totals while being invisible here (FR-020). A day with zero orders renders its column with the count `0` and no bar height, never omitted.

**Checkpoint**: all three stories complete — the screen matches board 1.6 apart from its two agreed divergences.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T296 Handle the offline, stale and nothing-yet cases in `apps/mobile/src/features/executive/MyTotalsScreen.tsx`. **Nothing here is queued** — `03-ARCHITECTURE.md:1016` says only visit submission, extra-shop addition, pin capture and beat start/end are queueable, and reads fall back to the last loaded payload with a visible note. So: a failed refresh keeps the figures on screen with a note that they are not fresh, following the wording `TodaysBeatScreen` already uses; a failed period switch says so and preserves what was showing; and **a first load with no connection says there is no connection — never a screen of zeroes**, which an executive would read as "I did nothing" (FR-024). Distinguish `ApiError` with `code === 'NETWORK_ERROR'` from a real server error, as `MyVisitsScreen` does. Add the nothing-recorded-yet state (FR-027, quickstart Scenario 10): an executive with no visits gets a well-formed screen — zeroes in the tiles, the completion card saying nothing was assigned, the brand section saying there is nothing to show, seven zero columns with today still highlighted — **plus a plain statement that there is nothing yet**, so it does not read as a fault. Surface the outbox's waiting count through the existing `subscribeOutbox` so the totals are not presented as complete while a submission has not reached the server (FR-025). **Do not add persisted caching** — out of scope.
- [X] T297 [P] Regenerate `docs/openapi.json` to include `GET /reports/executive-totals`, mirroring how `008`'s T281 did it (`pnpm --filter api generate:openapi`).
- [ ] T298 [P] **(blocked — needs a physical device; the server half was verified live, see the note at the end of this file)** Run all 12 scenarios in `specs/009-my-totals/quickstart.md` on a physical device, except the `curl`/`SQL` steps. **Scenarios 4, 5, 7 and 9 must not be skipped** — the figures reconciling to the records, completion never exceeding 100%, the Sunday column, and the privacy boundary; each is a promise nothing else in the system double-checks. **Scenario 7 needs Sunday data to test anything at all** — create some if the fixture has none, since it is the whole reason this slice departs from the board. **Scenario 8 is the one most likely to be waved through** and is exactly what breaks if the client ever resolves the dates: change the device timezone and confirm nothing on the screen moves. Scenario 2 is the fidelity check, and this slice has **exactly two** agreed divergences — a third is a defect.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T283–T284)**: T283 → T284 sequential (same package; T284 re-exports T283).
- **Foundational (T285–T286)**: T285 → T286 (the service calls the clock helpers).
- **User Stories (Phases 3–5)**: all depend on Foundational — every aggregate is scoped by the period T285/T286 resolve.
- **Polish (T296–T298)**: T296 depends on T290; T297–T298 depend on the stories you intend to ship.

### User Story Dependencies

- **US1 (P1)**: Foundational only. The MVP.
- **US2 (P2)**: T292 **extends T286/T287/T288's file** — it lands after them. T293 edits T290's screen.
- **US3 (P2)**: T294 extends the same service file; T295 edits the same screen. Independent of US2 in logic, but both queue behind US1 on those two files.

### Within Each User Story

- Service before controller; API before the screen that calls it; design tokens (T289) before the screen (T290).

### Parallel Opportunities

- T289 (mobile tokens) alongside T285–T288 (the clock helpers and the API) — different packages, no shared files.
- T297 and T298.
- **Serialization points to respect**: `executive-totals.service.ts` is edited by T286, T287, T288, T292 then T294 in that order. `MyTotalsScreen.tsx` by T290, T293, T295 then T296 — finish each phase before starting the next rather than interleaving. `company-clock.service.ts` by T285 only. `ExecutiveBottomNav.tsx` by T291 only.

---

## Implementation Strategy

### MVP (US1)

1. Setup (T283–T284)
2. Foundational (T285–T286) — **blocks everything**; confirm the period boundaries before going further
3. US1 (T287–T291) → validate: quickstart Scenarios 1, 3, 4, 5, 8
4. **Stop and demo** — an executive can see their completion and headline figures for all three periods

### Incremental Delivery

5. US2 (T292–T293) → Scenario 6 — quantity by brand, and the sum guarantee
6. US3 (T294–T295) → Scenario 7 — the week's shape, including Sunday
7. Polish (T296–T298) → Scenarios 2, 10, 11, 12 + the full quickstart

### Notes

- `[P]` = different files, no dependencies.
- **Do not add**: a migration, a charting library, a materialised totals table, offset or cached aggregates, an out-of-range count in any period, any monetary value (`OD-07` — release 1 is quantity only), any figure describing another executive (no team total, no company average, no rank), a drill-down from any number, an arbitrary date range, a target or quota, a comparison with a previous period, or persisted offline caching. Each is a reasoned exclusion (plan.md, research.md §§1/3/4/10, spec.md *Scope boundaries*), not an oversight.
- **Two agreed divergences from the design, and only two**: seven columns in the weekly chart instead of six (T295), and an uncapped brand list that lets the page scroll (T293). Both are correctness-driven and every colour, radius, font and spacing value stays the board's. Any third difference from board 1.6 is a defect.
- **The one-line test for any new field**: if a number is not visible on board 1.6, it must not be in the response. An aggregate screen invites "while we're here" additions — an average, a best day, a rank — and two of those would breach FR-023 by describing other people.
- **`completionRate` is `null`, not `0`, when nothing was assigned.** Easy to "simplify" into a zero, and it would make a holiday week and a wasted week read identically.
- **The period is the server's.** The client sends a name and never a date. If a task ever seems to need `from`/`to` in the query, re-read research.md §2 before adding it.
- **Recorded for slice 014, not solved here**: `03-ARCHITECTURE.md:837` marks this route "all, scoped". When Manager and Admin are added, their report carries an out-of-range count, and widening this response by role would put the privacy rule inside an `if` — the fix then is a sibling route or a second projection.
- Commit after each task or logical group; stop at any checkpoint to validate.


---

## T298 — what was verified without a device, and what still needs one

The slice was built and then exercised against a **live API and a real
Postgres**, using a throwaway company (`SMK9`) seeded to make every figure
hand-checkable — six business days spanning three periods, a day with **zero**
orders, a **Sunday** with one, one `EXEC_EXTRA` stop per day, stops left
`PENDING` so completion is not 100%, and **one brand renamed mid-period**. The
company was removed afterwards; the database is back exactly as it was found.

What that run proved:

| Quickstart scenario | Verified | Evidence |
|---|---|---|
| 3 — the three periods | **yes** | `Tue, 20 Oct` / `Mon 19 Oct – Sun 25 Oct` / `October 2026`, each with its own figures — **and the `week` span identical across all three**, which is FR-016 |
| 4 — the figures reconcile | **yes** | completion, both counts, `Σ brands === totalQuantity` and `Σ week.days === orderCount` all checked against the seeded truth for **all three periods**: `completion OK, totals OK, brands sum OK, week sums OK` |
| 5 — completion includes extras | **yes** | 9 of 12 → 75% for the week, 11 of 14 → 79% for the month, with one `EXEC_EXTRA` stop per day counted in **both** halves; never above 100% |
| 5 (empty) — nothing assigned | **yes** | the second executive returns `completionRate: null`, not `0` — a holiday week and a wasted week cannot read the same |
| 6 — quantity by brand | **yes** | 3 rows, 3 unique brand ids, **0 duplicates**, sorted largest-first, summing exactly to the Total qty tile |
| 6 step 5 — a renamed brand | **yes** | the renamed brand appears **once**, labelled `Brand 1 RENAMED LATER` — the later recorded snapshot. The current master value (`Brand 1 CURRENT NAME`) never appears |
| 7 — the weekly chart | **yes** | **seven** days Mon–Sun; the **Sunday** order appears in the Sun column *and* in the week's Orders tile; Wed–Sat render as zero columns rather than being omitted; `isToday` on Tue only |
| 9 — the privacy boundary | **yes** | `leaked: none` against a 16-name banned list including `outOfRangeCount` and every monetary spelling; top-level keys exactly `brands, completion, period, totals, week`. Company Admin → `403`; `?executiveId=` → `400` naming the key; **`?from=&to=` → `400`**, so the client cannot supply dates; `?period=THIS_YEAR` → `400` |
| 10 — nothing recorded | **yes** | the second executive gets a well-formed response of zeroes with `completionRate: null` and seven weekday entries — not an error |
| `CompanyClock` helpers | **yes** | checked directly against Sunday weeks (`2026-10-18` → `12th–18th`), a month-boundary week (`28 Sep → 4 Oct`), a year-boundary week (`28 Dec → 3 Jan`), and February in both a leap and a non-leap year |
| `formatQuantity` | **yes** | matches `Intl` `en-IN` exactly for `0, 5, 94, 315, 1286, 5742, 128600, 1234567`, without depending on Hermes' reduced ICU |

**Still needs a physical device** — none of this can be judged from a server:

- **Scenario 2**, the side-by-side fidelity check against board 1.6. This decides FR-026, and the slice has **exactly two** agreed divergences; a third is a defect.
- **Scenario 1**'s UI half — every bottom-bar item navigating, and **no item raising the coming-soon alert any more**.
- The UI halves of Scenarios 3, 5, 6, 7 and 10 — the tabs recalculating, the amber progress bar, the brand bars and the page scrolling past three brands, the chart's column heights and today's tint, and the empty-state copy.
- **Scenario 8** — change the device timezone and confirm nothing on the screen moves. Structurally guaranteed (the query carries a period name and no date; the server resolves from `company.timezone`), but worth seeing.
- **Scenario 11**, offline: the stale note, the preserved figures, and the waiting strip.
- **Scenario 12**, a late sync changing an earlier day's figures.
