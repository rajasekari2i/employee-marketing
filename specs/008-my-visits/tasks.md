---

description: "Task list for My Visits — Executive"
---

# Tasks: My Visits — Executive

**Input**: Design documents from `/specs/008-my-visits/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/my-visits.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md`'s 15 manual scenarios (0–14) are the verification path (Polish, T282).

**Organization**: Grouped by user story (spec.md: US1 and US2 are P1, US3 is P2). Task IDs continue the repo-wide sequence — 001 (T001–T074), 002 (T075–T107), 003 (T108–T135), 004 (T136–T172), 005 (T173–T203), 006 (T204–T234), 007 (T235–T261) — so this feature starts at **T262**.

**One migration, no new dependency, no native rebuild.** `FlatList` is React Native core and four admin screens already use it. If you find yourself adding a package, stop — something has been misread.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US3
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/visits/`, `apps/api/prisma/`
- Shared: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/executive/`, `apps/mobile/src/components/`, `apps/mobile/src/navigation/`

## Board uuids (for the CLAUDE.md decode recipe)

| Board | uuid |
|---|---|
| **1.5 My visits (executive)** | `94506a6c-c909-40f9-b3d2-e0cca7bad3f5` |
| 1.3 Today's beat (for the bottom bar and the waiting strip) | `20463df0-5cdd-44a1-bce2-f24ff89bf4c6` |

---

## Phase 1: Setup

- [X] T262 [P] Create `packages/shared/src/my-visits.schema.ts` with `myVisitsQuerySchema` exactly as `contracts/my-visits.md` specifies: `cursor: z.string().min(1).optional()`, `limit: z.coerce.number().int().min(1).max(100).default(10)`, `outcome: z.enum(['ORDER','NO_ORDER']).optional()`, `range: z.enum(['ALL','LAST_7_DAYS','LAST_30_DAYS']).default('ALL')` — all wrapped in `.strict()`. The default `limit` is **10** (the user's explicit instruction) while the house `min(1).max(100)` bound is kept, so a client cannot ask for an unbounded page. Header comment must record **why `.strict()` is here and what it is protecting**: there is deliberately no `executiveId` parameter — the caller's id comes from the verified JWT — so a hand-crafted `?executiveId=<someone else>` must be a `400` naming the unrecognised key, not a silently ignored field. That is what makes SC-008 ("zero cross-executive leakage") a thing that cannot be expressed rather than a guard to get right. Also note that `businessDate`, `distanceMeters` and every other server-owned value are absent by construction — this is a read, and the query carries no field the server owns.
- [X] T263 Add an explicit re-export block for `my-visits.schema.ts` to `packages/shared/src/index.ts` — value export then `export type`, no `export *`, matching the `visits.schema` / `extra-shops.schema` blocks already at the end of that file. Depends on T262.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work can begin until this phase is complete. T265's backfill in particular gates everything — without it the new column is null on every existing row and the whole screen renders empty.

- [X] T264 Add to `apps/api/prisma/schema.prisma`, on the existing `Visit` model, exactly as `data-model.md` specifies. **Field**: `businessDate DateTime @db.Date @map("business_date")` — a calendar date with no time component, the same type `DailyAssignment.businessDate` uses, **not nullable** once T265 has backfilled. Place it beside `submittedAt`/`receivedAt` with a comment recording that it is a snapshot of the stop's assignment's business day, taken once at submission and never updated — it cannot drift, because `DailyAssignment` is itself an immutable snapshot (BUS-05). **Index**: `@@index([companyId, executiveId, businessDate, submittedAt, id], map: "visits_exec_history_idx")`. **The explicit `map:` is required, not cosmetic** — Prisma's default name would be `visits_company_id_executive_id_business_date_submitted_at_id_idx`, **64 characters against Postgres' 63-byte identifier limit**, which Postgres truncates silently; a hand-written migration and a later `migrate diff` would then disagree about the name and the next `migrate dev` would try to create a second near-identical index. The longest index name currently in this schema is 59 characters, so this is the first to cross the line. None of `Visit`'s three existing indexes (`companyId, shopId, receivedAt` / `companyId, assignmentId` / `companyId, reviewStatus`) serves "this executive's visits, newest first", which is every query this feature makes. **No RLS change** — `visits` is already `FORCE ROW LEVEL SECURITY` with `visits_tenant_isolation`, and `'Visit'` is already in `TENANT_MODELS`.
- [X] T265 Write the migration `apps/api/prisma/migrations/<ts>_visit_business_date/migration.sql` by hand in Prisma's generated style (`migrate dev` cannot run here — the role lacks CREATEDB, P3014; see `20261019140000_assignments/migration.sql` for the precedent and its explanatory header). **Four statements, in this order**: (1) `ALTER TABLE "visits" ADD COLUMN "business_date" DATE;` — nullable first, so it applies to a populated table; (2) **the backfill** — `UPDATE "visits" v SET "business_date" = a."business_date" FROM "daily_assignments" a WHERE a."id" = v."assignment_id" AND v."business_date" IS NULL;`, written to be a correct no-op on a fresh database and idempotent if re-run; (3) `CREATE INDEX "visits_exec_history_idx" ON "visits"("company_id", "executive_id", "business_date" DESC, "submitted_at" DESC, "id" DESC);`; (4) `ALTER TABLE "visits" ALTER COLUMN "business_date" SET NOT NULL;` — only after the backfill, so it cannot fail on existing rows. **Step 2 is not optional and must not be deferred.** `20261019230000_backfill_stop_coords` exists in this repository because slice 006 added `assignment_stops.shop_latitude/longitude` without backfilling and **every visit submission was refused in production as a result**; carry a header comment naming that migration so the next person adding a column to a populated table sees the lesson. Apply with `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy`, then run quickstart Scenario 0's two `SELECT`s and confirm both return `0`.
- [X] T266 Write the new column in `apps/api/src/modules/visits/visits.service.ts`'s `submitVisit`. Two edits: the stop load at `visits.service.ts:234` already selects `assignment: { select: { status: true } }` — add `businessDate: true` to that select; and the `tx.visit.create` at `:333` gains `businessDate: stop.assignment.businessDate`. **Do not add `businessDate` to `submitVisitSchema`** — it is `.strict()`, so a client sending it gets a `400`, and the day a visit belongs to is the server's to decide from the assignment record, never the device's (Constitution rules 1 and 8). Add a comment saying exactly that, so a later contributor does not "helpfully" accept it from the body.

**Checkpoint**: the column exists, is backfilled, is indexed, is written on every new visit, and the contract is in place.

---

## Phase 3: User Story 1 - See what I have recorded, grouped by day (Priority: P1) 🎯 MVP

**Goal**: Tapping **My visits** opens the executive's own history, grouped by business day, newest first, ten visits at a time, with the next ten arriving on scroll.

**Independent Test**: Record visits across two or more business days (more than 10 in total), open My visits, confirm each day is its own block with the right rows in the right order, then scroll past the tenth row and confirm older visits append without the rows above moving (quickstart Scenarios 1, 3, 4, 5, 6).

- [X] T267 [US1] Create `apps/api/src/modules/visits/my-visits.service.ts` implementing the paged read. Follow `assignments.service.ts`'s class structure exactly — module-level fallback client, narrowed `Tx` type, `tx()`, and `scopeToCaller()` setting both `app.company_id` and CLS at the top of every public method — **plus** the executive narrowing slices 005–007 established: `where: { executiveId }` taken from the JWT, never a parameter. **Ordering is `[{ businessDate: 'desc' }, { submittedAt: 'desc' }, { id: 'desc' }]` and must not be changed**: `businessDate` first makes the result day-major, which is what makes FR-011 (one block per day across a page boundary) a property of the query rather than a hope; `id` last makes the ordering total, which a keyset cursor requires to be correct. **Paging is Prisma `cursor: { id }` + `skip: 1`**, exactly as `ShopsService.list` (`shops.service.ts:158-174`) already does — not `OFFSET`, which would re-serve page 1's last row whenever a visit is recorded between two fetches (FR-012). `nextCursor` = the last row's `id` when `rows.length === limit`, else `null`. An unknown or stale cursor returns an empty page, **not** an error. Apply `range` here: `LAST_7_DAYS`/`LAST_30_DAYS` filter `businessDate >= <today − N + 1>` where "today" is the company-local business date from `CompanyClock` — never the device clock (rule 8); `ALL` applies no date predicate.
- [X] T268 [US1] Map the per-visit projection in `my-visits.service.ts` and return **exactly** these six fields, which is why this shape exists instead of being shared with the manager's future `GET /visits` (data-model.md, *Entity: the visit row*): `id`, `businessDate` (`YYYY-MM-DD`), `shopName` (from `Shop.name`), `outcome` (`'ORDER' | 'NO_ORDER'`), `summary`, `occurredAt` (`Visit.submittedAt`, ISO). Compose `summary` **server-side** from recorded snapshots — `"{brandCount} brands · {totalQuantity} qty"` from the visit's `Order` for an `ORDER`, and `Visit.reasonLabel` for a `NO_ORDER` — so the two outcome shapes cannot drift between the API and the screen, and so a brand or reason renamed later never rewrites history (FR-006). In the same method build `days[]`: one `{ businessDate, orderCount, noOrderCount }` per business date present in `items`, where **both counts are the whole day's and ignore the `outcome` filter** — board 1.5 computes its summary from the day's *unfiltered* list (`const o = g.items.filter(...)` over `g.items`, not over the filtered `items`), so on the Order tab a day showing three order rows still reads "3 orders · 2 no order". A client cannot derive these from the rows returned. **Never select** `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude`, `capturedLatitude`, `capturedLongitude`, `accuracyMeters`, `reasonText`, `sampleShown`, `stopId`, `assignmentId` or `executiveId`. Put that list in a comment above the select with the one-line test a reviewer can apply: **if a field is not visible on board 1.5, it must not be in the select.** The executive's own captured position is excluded too (FR-023) — their own data, but this screen is a record of what was done, not of where the phone was.
- [X] T269 [US1] Add `GET /visits/mine` to `apps/api/src/modules/visits/visits.controller.ts` with a `MyVisitsQueryDto extends createZodDto(myVisitsQuerySchema)` declared locally in the controller (the established split), the company id and the caller's own executive id from `requireCompanyId`/`requireExecutiveId`, and **no `Idempotency-Key`** — this is a read. The class-level `@ApiTags('visits') @UseGuards(RolesGuard) @Roles('MARKETING_EXECUTIVE')` already covers the role. Register `MyVisitsService` in `apps/api/src/modules/visits/visits.module.ts`. Add a comment recording that the path is taken verbatim from `03-ARCHITECTURE.md:830` and that the manager's `GET /visits` on the line above is a **separate route by design**, not a role-filtered variant of this one — that table split is what keeps the measurement and the flags out of an executive response structurally.
- [X] T270 [P] [US1] Add board 1.5's tokens to `apps/mobile/src/features/executive/executiveDesign.ts`, decoded from uuid `94506a6c-c909-40f9-b3d2-e0cca7bad3f5` (CLAUDE.md recipe — decode, do not grep the raw file). Reuse by name wherever the hex already matches: `TAB_TRACK` is `#E6EAF1` (the tab track), `BORDER` is `#DFE4EC` (the day card and the bar's top edge), `ROW_SEPARATOR` is `#ECEFF4` (the row divider), `CHIP_PIN_OK_BG`/`CHIP_PIN_OK_FG` are `#E3EBFC`/`#1E3A8A` (the `ORD` badge), `CHIP_PENDING_BG`/`CHIP_PENDING_FG` are `#E9EDF3`/`#3A4353` (the `NO` badge), `FIELD_BORDER` is `#CBD2DD` (the date button's hairline), `INK`/`MUTED`/`LABEL` are `#141A26`/`#5A6474`/`#3A4353`. Add only what is genuinely new, with the geometry board 1.5 states: header padding `52px 20px 12px` and column gap 14; the date button 40 tall / radius 10; the segment **38 tall, radius 10, 700/14** (`.seg`); the day card radius 16; the row `11px 14px` padding with a 36×36 radius-11 badge at 11/800. **Note while you are here, do not fix**: board 1.3's `.tab` is `36px / 600` while the existing `FilterTab` in `TodaysBeatScreen.tsx:1224` renders `38px / 600` — so it matches neither board exactly, and it must **not** be reused for board 1.5, whose segment is `38px / 700`. Build board 1.5's segment separately (T276) and leave slice 005's screen alone; the 1.3 discrepancy is recorded in the Notes at the end of this file.
- [X] T271 [P] [US1] Create a pure grouping helper — `apps/mobile/src/features/executive/groupVisitsByDay.ts` — that turns `(items, days)` from one or more pages into the flat render sequence the list draws: `{ kind: 'day', businessDate, label, orderCount, noOrderCount } | { kind: 'visit', ... }`. Rules, all of them load-bearing: (a) group **consecutive** rows by `businessDate` — safe only because the server's ordering is day-major, so do not sort client-side; (b) **merging a newly-arrived page into the existing sequence must not emit a second header for a day that is already open** (FR-011) — this is the function's whole reason for existing; (c) `label` is `"Today · <EEE d MMM>"` when `businessDate` equals the company-local business date the screen was opened with, and `"<EEE d MMM>"` otherwise — board 1.5 shows both forms; (d) the day's summary text is `"{orderCount} orders · {noOrderCount} no order"` taken from `days[]`, **never counted from the rows**, because under a tab filter the rows are a subset; (e) a day with no rows produces no header at all — board 1.5 ends with `.filter((g) => g.items.length)`. Keeping this a pure function (no hooks, no components) is what makes the page-merge rule reviewable on its own.
- [X] T272 [US1] Create `apps/mobile/src/features/executive/MyVisitsScreen.tsx` matching board 1.5 **exactly** (uuid `94506a6c-c909-40f9-b3d2-e0cca7bad3f5`) — this slice has **exactly one** agreed divergence, the waiting strip of T279, which is absent whenever the outbox is empty, so with nothing queued the screen must be indistinguishable from the board (FR-027, quickstart Scenario 2). Header: `52px 20px 12px` padding, column gap 14; a row with `justify-content: space-between; align-items: flex-end` holding, on the left, `"Your visit history"` at 13 px `#5A6474` above `"My visits"` at 28 px / 700, and on the right the date-range button — 40 tall, radius 10, `1.5px solid #CBD2DD` on `#FFFFFF`, 600/13 `#141A26`, calendar icon (`<rect x="3" y="5" width="18" height="16" rx="2"/>` + `M3 10h18M8 3v4M16 3v4`, stroke-width 1.8) — reading the active range (wired in T280; render it reading **"All time"** for now, which is FR-020's default). Main: `padding: 0 20px`, column gap 8. Day header: a `space-between` row with `4px 2px 0` padding holding the day label at **12 px / 700, letter-spacing `0.06em`, uppercase, `#5A6474`** and the summary at 12 px `#5A6474`. Day card: `#FFFFFF`, `1px solid #DFE4EC`, radius 16, clipped. Row: `11px 14px` padding, gap 12, `1px solid #ECEFF4` bottom border; a 36×36 radius-11 badge reading `ORD` on `#E3EBFC`/`#1E3A8A` or `NO` on `#E9EDF3`/`#3A4353` at 11 px / 800; shop name 15/700 single-line ellipsised; summary 13 px `#3A4353`; the time right-aligned in the **mono** face at 12 px `#5A6474`, rendered as `10:20` from `occurredAt` in company-local time. Bottom bar via the existing `ExecutiveBottomNav` with `active="MyVisits"`. Include the no-history empty state (FR-018, quickstart Scenario 12) — a plain statement, never a blank panel.
- [X] T273 [US1] Render the sequence from T271 with a **`FlatList`** in `MyVisitsScreen.tsx` and wire paging. `FlatList`, not `ScrollView` + `.map()` (the shape the other executive screens use for one bounded day) and not `SectionList`: SC-003 requires an executive with 1,000 visits to scroll back a month without slowdown, the day header is **not sticky** on the board, and one flat sequence makes the page-merge rule a data transformation rather than a list-component feature. `keyExtractor` must be stable per entry (`day:<date>` / `visit:<id>`). Fetch the next page from `onEndReached` with `onEndReachedThreshold` around `0.5` so the next ten usually arrive before the executive reaches the bottom (FR-010's "no visible reload"), **guarded by an in-flight ref** so one fast scroll cannot fire two fetches and append a page twice (FR-012). Stop when `nextCursor` is `null` and say there is nothing older — never keep spinning or re-request the last page (FR-013). Pull-to-refresh restarts from the newest visit, matching `TodaysBeatScreen`'s existing `refreshControl`. **Appending must not disturb rows already on screen** — append to the existing sequence, never rebuild it from scratch.
- [X] T274 [US1] Make the entry point live. In `apps/mobile/src/components/ExecutiveBottomNav.tsx` replace the **My visits** item's `onPress={() => comingSoon('My visits')}` with a navigation callback (add an `onMyVisitsPress` prop alongside the existing `onTodayPress`) — **leave My totals calling `comingSoon`**, it is board 1.6 and out of scope. Add `MyVisits: undefined` to `ExecutiveStackParamList` and register the screen in `apps/mobile/src/navigation/RootNavigator.tsx`. Pass `active="MyVisits"` from `MyVisitsScreen` and keep `TodaysBeatScreen` passing `active="Today"`, so the current item renders in `#1D4ED8` on each.

**Checkpoint**: an executive can open their history, see it grouped by day, and scroll back through it ten at a time. US1 demonstrable — this is the MVP.

---

## Phase 4: User Story 2 - Look at only orders, or only no-orders (Priority: P1)

**Goal**: Three tabs — All, Order, No order — each carrying its own count, switch the list between outcomes.

**Independent Test**: With a mix of orders and no-orders recorded, switch to Order and confirm only order visits are listed, switch to No order and confirm only no-order visits are listed, and confirm each tab's count matches what scrolling that tab to the end actually yields (quickstart Scenarios 7, 8).

- [X] T275 [US2] Add the outcome filter and the tab counts to `apps/api/src/modules/visits/my-visits.service.ts`. The `outcome` filter applies **in SQL**, on the same `where` the list already uses, so a page of ten is ten *matching* visits rather than ten of which some are hidden (FR-017). The counts are one `groupBy` on `outcome` over that same `where` **minus the outcome predicate**, giving `{ all, order, noOrder }` with `all = order + noOrder`, scoped to the active `range` — they are totals for the range in view, not for the page (FR-015), which is why board 1.5 shows `All · 64` beside five rows. Return `counts` **only on the first page** (when no `cursor` was supplied): they cannot change as the executive scrolls, so re-sending them per page would be noise. Confirm `days[]` from T268 still reports each day's **unfiltered** totals — this is the step where it is easiest to accidentally start counting the filtered rows. Extends T267/T268 — same file, lands after them.
- [X] T276 [US2] Add the tab group to `apps/mobile/src/features/executive/MyVisitsScreen.tsx`, below the header row and inside the header block. Track: `flexDirection: 'row'`, gap 4, padding 4, radius 12, `backgroundColor: TAB_TRACK` (`#E6EAF1`). Each segment: `flex: 1`, **height 38, radius 10, fontSize 14, fontWeight '700'** — board 1.5's `.seg`. Selected is `#FFFFFF` on `#141A26`; unselected is transparent on `#5A6474`. Labels carry the counts from T275 — `All · 64`, `Order · 41`, `No order · 23`. **Do not reuse `FilterTab` from `TodaysBeatScreen.tsx:1224`**: it is board 1.3's control at weight 600, and board 1.5's is 700 (see T270's note). Changing the tab must **restart the list from that tab's newest visits** — reset the cursor, the sequence and the scroll position — not resume at the previous tab's depth (FR-016).
- [X] T277 [US2] Add the per-tab empty state to `MyVisitsScreen.tsx`: when the selected tab returns no visits, say so explicitly with the header, the tabs and the bottom bar all still rendered (FR-018, FR-028, quickstart Scenario 12) — never a blank panel and never a spinner that has stopped. Keep it distinct from T272's "no history at all" copy: "you have no no-order visits in this range" and "you have not recorded anything yet" are different facts and the executive should be able to tell which they are looking at.

**Checkpoint**: US1 + US2 is the complete P1 increment — the screen the product requirements describe.

---

## Phase 5: User Story 3 - Keep reading when the connection is poor (Priority: P2)

**Goal**: A dropped connection degrades this screen rather than blanking it, and a visit still waiting to sync is never silently missing.

**Independent Test**: Load the list, drop the connection, confirm the loaded visits stay with a visible note; scroll for more and confirm the failure is explained and retryable; restore and confirm recovery (quickstart Scenario 9).

- [X] T278 [US3] Handle the offline and stale cases in `apps/mobile/src/features/executive/MyVisitsScreen.tsx`. **Nothing here is queued** — `03-ARCHITECTURE.md:1016` says only visit submission, extra-shop addition, pin capture and beat start/end are queueable, and reads fall back to the last cached payload with a visible banner. So: a failed **refresh** keeps the loaded sequence on screen and shows a note that it is not fresh, following the wording `TodaysBeatScreen` already uses ("Could not refresh. Showing the last loaded day."); a failed **next-page** fetch is reported with a retry and **discards nothing already loaded** (FR-025); and a first load with no connection says there is no connection rather than showing an empty history, which an executive would read as "I have no visits" (FR-024, quickstart Scenario 9 step 4). Distinguish `ApiError` with `code === 'NETWORK_ERROR'` from a real server error, as `AddExtraShopScreen` does. **Do not add persisted caching** — history surviving an app restart with no signal is explicitly out of scope; in-session is what the architecture's "last cached payload" asks for here.
- [X] T279 [US3] Add the waiting-to-sync strip to `MyVisitsScreen.tsx`, **placed below the tab group**, reading the outbox through the existing `subscribeOutbox` from `apps/mobile/src/lib/outbox.ts` and reusing the strip treatment `TodaysBeatScreen.tsx:552-573` already renders (`RUNNING_BG` / `RUNNING_BORDER` / `RUNNING_INK`, `11px 14px` padding, radius 14, 13 px copy). A queued visit MUST **not** be faked into a history row — it has no server id, it is not in the server's history, and a row the executive could read as recorded before the server has it would be a lie (FR-026). The strip only reports how many submissions are waiting, so the difference between "I recorded nothing that day" and "that visit has not reached the server yet" is always visible (SC-011). **It must be absent entirely when the queue is empty** (FR-026a) — this is the slice's single agreed divergence from board 1.5, and what keeps quickstart Scenario 2's side-by-side honest is that with an empty outbox there is nothing extra to see.

**Checkpoint**: all three stories complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T280 Wire the date-range control in `apps/mobile/src/features/executive/MyVisitsScreen.tsx` (FR-019, FR-020, FR-021). The button T272 already renders becomes interactive: tapping it opens a compact preset chooser offering **All time** (the default), **Last 7 days** and **Last 30 days**, and the button reads whichever is active. Choosing one sets `range` on the query, **restarts the list** and **recomputes the tab counts** for the new range (they describe the range in view, not all history). **There is no custom date picker** — no board anywhere in the design shows one, not here, not on the manager's list (3.3), not on the admin's (4.2) — so this is a small overlay in the design system's existing sheet treatment over an unchanged screen, and the screen beneath still matches board 1.5. **FR-020's "All time" default is a recorded departure from PRD FR-MY-02's "last 7 days"**, decided with the user and written up in spec.md under *Decisions taken with the user*; the 7-day window survives as a preset, so nothing FR-MY-02 describes is lost. The server side already accepts `range` from T267 — this task is the client half only.
- [X] T281 [P] Regenerate `docs/openapi.json` to include `GET /visits/mine`, mirroring how `007`'s T260 did it (`pnpm --filter api generate:openapi`).
- [ ] T282 [P] **(blocked — needs a physical device; the server half was verified live, see the note at the end of this file)** Run all 15 scenarios in `specs/008-my-visits/quickstart.md` (0–14) on a physical device, except the `curl`/`SQL` steps. **Scenario 0 runs first and must not be skipped** — it proves the backfill landed, and the failure mode is silent (the screen simply renders empty). **Scenarios 5, 6 and 10 are the other three that must not be skipped**: the day that straddles a page boundary, the no-duplicates guarantee, and the privacy boundary — each is a promise nothing else in the system double-checks. Scenario 2 is the fidelity check: with an empty outbox the comparison must show **zero** differences from board 1.5.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T262–T263)**: T262 → T263 sequential (same package; T263 re-exports T262).
- **Foundational (T264–T266)**: T264 → T265 sequential. T266 depends on T264 (the column must exist in the schema before it can be written).
- **User Stories (Phases 3–5)**: all depend on Foundational, and specifically on **T265's backfill** — without it every existing visit has a null business date and the screen renders empty.
- **Polish (T280–T282)**: T280 depends on T272; T281–T282 depend on the stories you intend to ship.

### User Story Dependencies

- **US1 (P1)**: Foundational only. The MVP.
- **US2 (P1)**: T275 **extends T267/T268's file** — it lands after them, not alongside. T276/T277 edit T272's screen.
- **US3 (P2)**: T278/T279 both edit T272/T273's screen, so they land after US1's screen work. Independent of US2.

### Within Each User Story

- Service before controller; API before the screen that calls it; design tokens (T270) and the grouping helper (T271) before the screen (T272); the screen before its paging (T273).

### Parallel Opportunities

- T270 (mobile tokens) and T271 (the pure grouping helper) alongside T267–T269 (the API) — different packages, no shared files.
- T281 and T282.
- **Serialization points to respect**: `my-visits.service.ts` is edited by T267, T268 then T275 in that order. `MyVisitsScreen.tsx` by T272, T273, T276, T277, T278, T279 then T280 — it is the busiest file in the slice, so finish each phase before starting the next rather than interleaving. `visits.controller.ts` by T269 only. `executiveDesign.ts` by T270 only.

---

## Implementation Strategy

### MVP (US1)

1. Setup (T262–T263)
2. Foundational (T264–T266) — **blocks everything; T265's backfill especially**
3. US1 (T267–T274) → validate: quickstart Scenarios 0, 1, 2, 3, 4, 5, 6
4. **Stop and demo** — an executive can scroll back through their own history, grouped by day

### Incremental Delivery

5. US2 (T275–T277) → Scenarios 7, 8, 12 — the tabs and their counts. **US1 + US2 is the P1 release.**
6. US3 (T278–T279) → Scenario 9 — the screen survives a bad signal
7. Polish (T280–T282) → Scenarios 11, 13, 14 + the full quickstart

### Notes

- `[P]` = different files, no dependencies.
- **Do not add**: a second distance or measurement anywhere, `distanceMeters`/`isExceedRange`/`flags`/`reviewStatus`/`effectiveRadiusMeters`/any coordinate in an executive response, a visit detail route for the executive (boards 3.4–3.6 are the manager's; rows here are a record, not a door), a visit edit or delete route, offset pagination, persisted offline caching of history, a custom date picker, a connectivity library, or anything from board 1.6 (My totals). Each is a reasoned exclusion (plan.md, research.md §§3/4/8/9, spec.md *Scope boundaries*), not an oversight.
- **One agreed divergence from the design, and only one**: the waiting-to-sync strip (T279), absent when the outbox is empty. Any other difference from board 1.5 is a defect.
- **`occurredAt` is `submittedAt`, a client-supplied timestamp** — a deliberate, bounded exception to "the server owns the truth" (research.md §7), taken so an offline visit synced four hours later does not display a time the executive never experienced. It is safe **only because** the sort is day-major on the server-owned `businessDate`: a wrong device clock can misplace a row within its day and nothing more. Do not "simplify" the ordering to a single timestamp key.
- **Found while decoding, deliberately not fixed here**: board 1.3's `.tab` is `36px / 600`, while `FilterTab` in `TodaysBeatScreen.tsx:1224` renders it at `38px / 600` — a 2 px height discrepancy on slice 005's screen that predates this slice. It is recorded rather than fixed because `TodaysBeatScreen` is not this feature's file and a silent change there would be scope creep; board 1.5's own segment is `38px / 700` and is built separately (T276). Worth raising as its own small fix.
- Commit after each task or logical group; stop at any checkpoint to validate.


---

## T282 — what was verified without a device, and what still needs one

The slice was built and then exercised against a **live API and a real
Postgres**, using a throwaway company (`SMK8`) seeded with 27 visits across
seven business days — removed afterwards, so the database is back exactly as
it was found. What that run proved:

| Quickstart scenario | Verified | Evidence |
|---|---|---|
| 0 — the migration backfilled | **yes** | `0` visits with a null `business_date`, `0` disagreeing with their assignment, and `visits_exec_history_idx` present under its explicit (un-truncated) name |
| 4 — exactly ten, then ten more | **yes** | first page exactly 10 rows with a non-null `nextCursor`; walking every page gave 3 pages and 27 rows |
| 5 — a day that straddles a page boundary | **yes** | day runs came back as `['10-19','10-18','10-17','10-16','10-15']` — **each business date in exactly one contiguous run**, which is what FR-011 needs from the server |
| 6 — no duplicates, ever | **yes** | 27 ids, 0 duplicates; `businessDate` non-increasing across the whole walk; `occurredAt` non-increasing within every day |
| 7 — the tabs filter in SQL | **yes** | `?outcome=ORDER` returned 10 rows all `ORDER`; `?outcome=NO_ORDER` likewise. **And the day summaries stayed unfiltered** — while filtered to orders a day still reported `3 orders · 2 no order`, which is the subtle rule read off board 1.5's own script |
| 8 — tab counts are range totals | **yes** | scrolling each tab to the end gave 25 / 15 / 10 against `counts {all: 25, order: 15, noOrder: 10}` — exact match, and the counts did not move while paging |
| 10 — the privacy boundary | **yes** | row keys are exactly `businessDate, id, occurredAt, outcome, shopName, summary` — zero of the 16 forbidden fields present. A Company Admin token → `403`; a second executive → their own (empty) history; `?executiveId=<other>` → `400 VALIDATION_FAILED` naming the unrecognised key |
| 11 — the date range | **yes** | with visits seeded 10 and 40 days back: `ALL` → 27 rows (oldest `09-09`), `LAST_30_DAYS` → 26 (oldest `10-09`), `LAST_7_DAYS` → 25 (oldest `10-15`) — **and the tab counts changed with the range**, which is FR-021 |
| 12 — empty states | server half | the second executive's history returns `items: []` with `counts` all zero, which is what the screen renders its empty state from |
| validation | **yes** | `limit=0` → `400`; `range=LAST_YEAR` → `400`; an unknown cursor → an empty page, **not** an error |

**Still needs a physical device** — none of this can be judged from a server:

- **Scenario 2**, the side-by-side fidelity check against board 1.5. This decides FR-027, and with an empty outbox the comparison must show **zero** differences.
- **Scenario 1**'s UI half — the bottom-bar item navigating instead of alerting, and My totals still alerting.
- **Scenario 3**'s UI half — the `Today ·` label, the badges, the mono time.
- **Scenarios 4, 5 and 6's UI halves** — that appending a page does not move the rows above it, and that one fast scroll appends one page.
- **Scenario 9**, offline: the stale note, the retryable page failure, and the waiting strip appearing and then vanishing once the queue drains.
- **Scenario 13**, a 300+ visit history scrolling smoothly.
- **Scenario 14**'s UI half.

## One contract addition made during implementation

`todayBusinessDate` was added to the response. Board 1.5 labels one group
`"Today · Tue 29 Sep"` and the rest `"Tue 29 Sep"`, so the screen has to know
which business date is today — and it must not ask the device, whose timezone
can be wrong (Constitution rule 8 puts that conversion in exactly one place).
The server already resolves this date for the range filter, so returning it
costs nothing. `contracts/my-visits.md` has been updated to match.
