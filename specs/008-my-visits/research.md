# Phase 0 Research: My Visits — Executive

**Feature**: `008-my-visits` | **Date**: 2026-10-20

Every decision below is grounded in code that already exists in this repository, in a board decoded from `docs/ui-design/Field_Sales_Beat_App.html`, or in the architecture's own API surface table. Where the design, the product requirements and the user's instruction disagree, the disagreement is named rather than smoothed over.

---

## §1 — The endpoint is already specified; use that path

**Decision**: `GET /visits/mine`, taken verbatim from the architecture's API surface table rather than invented here.

`03-ARCHITECTURE.md:828-831`:

```
| POST | `/visits`     | Exec            | the main command; see §10                                  |
| GET  | `/visits`     | Manager, Admin  | filters: date, outcome, range, executive, beat, source     |
| GET  | `/visits/mine`| Exec            | range fields stripped                                      |
| GET  | `/visits/:id` | Manager, Admin  |                                                            |
```

**Rationale**: the document already decided this, and the table makes the role split structural rather than incidental — `GET /visits` and `GET /visits/mine` are *different routes* precisely because they return different shapes to different roles. Building the executive's list as a filter on the manager's route would be the mistake this table was written to prevent.

"Range fields stripped" is the table's own shorthand for what this slice calls FR-022. This plan goes one step further than *stripping*: the fields are never selected (see §4), because a field dropped at a response boundary can be reinstated by a later refactor that only reads the select.

**Module placement**: `visits`, which already owns `POST /visits`, `GET /stops/:id`, `POST /shops/:id/pin` and (since 007) `GET /shops/nearby` — the executive's whole field-and-history surface, with the class-level `@Roles('MARKETING_EXECUTIVE')` and the `requireCompanyId`/`requireExecutiveId` helpers that give the three-layer scoping with nothing new to invent.

---

## §2 — `Visit` needs a business date of its own *(the one migration)*

**Decision**: denormalise `businessDate` onto `Visit` as a `@db.Date` column, written in `submitVisit` from the stop's assignment, backfilled for existing rows, and indexed.

**This is the decision the rest of the feature hangs on**, so the reasoning is given in full.

The screen groups by business day (FR-003) and must render a day that straddles a page boundary as **one** block, not two with the same heading (FR-011). A client can only do that safely if the server returns rows in **business-day-major order** — all of day D's visits, then all of day D−1's, contiguously. If two days can interleave in the result, the client's "group consecutive rows" logic produces duplicate headings and no amount of client-side merging fixes it cleanly.

Today the business day is **not on the visit**. It lives on `DailyAssignment.businessDate`, one join away via `Visit.assignmentId`. That leaves three options:

1. **Order by the relation** (`orderBy: { assignment: { businessDate: 'desc' } }`). Prisma supports relation ordering, but combining it with a `cursor` is fragile — the cursor's position is resolved from the cursor row's values for every `orderBy` field, and a relation-valued sort key makes that both slow and hard to index. Rejected.
2. **Order by a timestamp on the visit and hope days don't interleave.** They can: `submittedAt` is the device's claim, and a phone with a wrong clock can place a visit from day D−1 above one from day D. The day grouping would then split. Rejected — FR-011 would hold only when every device clock is correct, which is exactly the assumption this product refuses to make everywhere else.
3. **Put the business date on the visit.** One `DATE` column, written once at submission from the assignment that already owns it.

**Option 3, and it is the house pattern rather than a shortcut.** `Visit` already snapshots `reasonLabel` ("renaming a reason later never rewrites recorded history"), `shopLatitude`/`shopLongitude` and `effectiveRadiusMeters`; `OrderLine` snapshots `brandLabel`; `DailyAssignment` snapshots `beatPlanName`. Architecture §9 is titled "snapshots everywhere". A business date copied from the assignment is the same move, and it is a *derived-once, never-changes* value — `DailyAssignment.businessDate` is itself immutable (BUS-05: "a daily assignment is an immutable snapshot"), so this denormalisation can never drift from its source.

**What it buys, concretely:**

- Ordering becomes `(businessDate DESC, submittedAt DESC, id DESC)` — total, stable, day-major, and index-backed. FR-011 becomes a property of the query rather than a hope.
- A bad device clock can now only misplace a row **within** its own day. It can never move a visit to another day's block and it can never split a day. That is the precise safety property FR-007 asks for.
- The date-range filter (FR-021) is a predicate on one indexed column, in company-local terms, with no join.
- The per-day counts (FR-004) and the tab counts (FR-015) are two small aggregates on the same index.

**Index**: `@@index([companyId, executiveId, businessDate, submittedAt, id])`. The existing three indexes on `Visit` serve the shop's history (`companyId, shopId, receivedAt`), the day's visits (`companyId, assignmentId`) and the review queue (`companyId, reviewStatus`) — none of them serves "this executive's visits, newest first", which is every query this feature makes.

**Migration shape**: one `ALTER TABLE … ADD COLUMN`, one `UPDATE … FROM daily_assignments` backfill, one `CREATE INDEX`, then `SET NOT NULL`. The backfill is mandatory and is called out as its own task — `20261019230000_backfill_stop_coords` exists in this repository precisely because a previous slice added a column without backfilling it and **every visit submission broke in production as a result**. That lesson is not re-learned here.

**Alternatives considered**: a database view, or computing the group key in the API after fetching. Both leave the ordering problem unsolved, which is the whole reason the column exists.

---

## §3 — Keyset pagination, not offset

**Decision**: cursor pagination on `(businessDate, submittedAt, id)`, page size 10, following the exact shape `ShopsService.list` and `UsersService.list` already use — Prisma's `cursor` + `skip: 1`, with `nextCursor` set to the last row's id when a full page came back and `null` otherwise.

**Rationale**: `D-15` (`03-ARCHITECTURE.md:31`) names cursor pagination as the API style, and `:795` says "lists take `?cursor=&limit=&…filters`". Three list endpoints in this codebase already implement it identically, so this is a pattern to follow, not a choice to make.

It also happens to be the only way FR-012 can hold. The spec requires that a visit never appear twice **including when a new visit is recorded between two fetches**. With `OFFSET`, a visit inserted at the head of the list shifts every later row down by one, so page 2 re-serves the last row of page 1 — a duplicate the client cannot detect. A keyset cursor asks for "the rows after *this specific row*", so an insertion ahead of the cursor is invisible to later pages. The requirement is satisfied by the mechanism rather than by a de-duplication pass.

**Page size 10** is the user's explicit instruction. The shared query schema keeps the house `min(1).max(100)` bound with the default changed to 10 for this endpoint, so a client cannot ask for an unbounded page.

**Ordering direction**: descending on all three keys. `id` is the final tiebreak and makes the ordering total, which is what a cursor needs to be correct.

---

## §4 — What an executive may see in their own history

**Decision**: a response shape authored for this screen, carrying exactly what board 1.5 draws. It does **not** reuse, extend or filter whatever shape the manager's `GET /visits` will return.

**Rationale**: this is the first executive-facing *list* of visits, and it reads the same rows that will drive the manager's list (board 3.3) — a list that deliberately carries `distanceMeters`, `isExceedRange`, the flags and the review status, and has an "Out of range" tab built on them. The two views are one table apart. A shared shape with a role-conditional filter would put the product's most load-bearing privacy rule inside an `if`.

So the executive's projection selects, per visit: `id`, `businessDate`, `shopName`, `outcome`, `summary`, `occurredAt`. **Nothing else is selected from `Visit` at all.**

### What never appears in this shape

Listed by name so a later contributor sees the boundary rather than infers it:

- `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus` — the measurement and the verdict. FR-022, SC-007, and the standing rule from CLAUDE.md.
- `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude` — what the verdict was measured against. With a coordinate and a radius a device can compute its own verdict, which is the inference `assignments.service.ts` drops both fields at its boundary to prevent.
- `capturedLatitude`, `capturedLongitude`, `accuracyMeters` — **the executive's own position**. FR-023. Easy to wave through on the grounds that it is their own data, but this screen is a record of what was done, not of where the phone was, and returning it would put a precise coordinate into a list payload for no purpose the board has.
- `reasonText` — the free-text half of a no-order reason. The board's row shows the reason *label*, and `reasonText` is on the log redaction list; a list endpoint is not where it belongs.
- `sampleShown`, `stopId`, `assignmentId`, `executiveId` — not drawn by the board and not needed to render it.

**The one-line test a reviewer can apply**: if a field is not visible on board 1.5, it must not be in the select.

---

## §5 — The day summary ignores the tab filter

**Decision**: each day group carries its own `orderCount` and `noOrderCount` for the **whole day**, computed server-side, regardless of which tab is active.

**This is read directly off the board's own logic**, not inferred. Decoding board 1.5's component script:

```js
const groups = raw.map((g) => {
  const items = g.items.filter((v) => cur === 'all' || v.kind === cur);
  const o = g.items.filter((v) => v.kind === 'order').length;
  return { day: g.day, items, sum: o + ' orders · ' + (g.items.length - o) + ' no order' };
}).filter((g) => g.items.length);
```

The rendered rows are `items` — **filtered**. The summary `sum` is computed from `g.items` — **unfiltered**. So on the Order tab, a day showing three order rows still reads "3 orders · 2 no order".

**Why it matters for the API**: it means the day summary **cannot be derived from the rows returned**. When the Order tab is active the server sends only order rows, but the heading above them must still state the day's no-order count. The counts therefore travel alongside the page as day metadata, not as something the client tallies.

The final `.filter((g) => g.items.length)` is the other half: a day with no rows under the active tab is omitted entirely — no empty heading. That matches the spec's edge case and is the client's rule, since the server simply never sends rows for such a day.

---

## §6 — Tab counts describe the range, not the page

**Decision**: the three tab counts (`All · 64`, `Order · 41`, `No order · 23`) are totals for the **range currently in view**, computed server-side and returned with the first page.

**Rationale**: the board shows `All · 64` while a screen holds roughly five rows, so the counts were never page counts. FR-015 states it and SC-009 tests it: every tab's count must equal the number of rows that tab yields when scrolled to the end.

**Where they come from**: one `groupBy` on `outcome` over the same `where` clause the list uses, minus the outcome filter. Two numbers; `All` is their sum. Returned on the first page only — they cannot change as the executive scrolls, so re-sending them with every page would be noise.

**What they do *not* include**: anything waiting in the device's outbox. The counts describe the server's history, which is what this screen shows; the waiting strip (§8) is what accounts for the rest.

---

## §7 — Which time a row shows, and which time it sorts by

**Decision**: both are `submittedAt` — the moment the executive pressed submit, converted to company-local time for display. Not `receivedAt`.

**Rationale**: the board's rows read `10:20`, `12:05`, `14:02` — times an executive recognises as "when I was in that shop". For a visit recorded on a dead signal and synced four hours later, `receivedAt` is the sync time and would read as a visit that never happened at that hour. `submittedAt` is the device's claim, and for *this* purpose the device's claim is the honest answer.

**The risk this takes, and the bound on it**: `submittedAt` is client-supplied, so a wrong device clock produces a wrong time. The bound is §2's: because `businessDate` is the major sort key and comes from the server's assignment record, a bad clock can misplace a row **within** its day and nothing more. It cannot move a visit to another day, cannot split a day group, and cannot break pagination — a keyset cursor needs the ordering to be *total and stable*, not for its values to be sane.

`receivedAt` stays the authoritative time everywhere it already is (ordering of the shop's last-five, the manager's review). This decision is scoped to what this one screen displays and sorts.

---

## §8 — Offline: the list is a read, so nothing here is queued

**Decision**: no outbox involvement. The list keeps its last successful payload in memory and says so when a refresh fails; a queued *visit* is accounted for by a count strip, not by a fabricated row.

**Rationale**: `03-ARCHITECTURE.md:1016` is explicit — "Only visit submission, extra-shop addition, pin capture and beat start/end are queueable. Reads are never queued; they fall back to the last cached payload with a visible 'showing saved data' banner." This screen is a read on every one of its requests.

`TodaysBeatScreen` already establishes the in-memory half of that posture: a failed refresh keeps `data` and shows *"Could not refresh. Showing the last loaded day."* This screen follows it. **Persisted** read caching — history surviving an app restart with no signal — is deliberately not built: the architecture's "last cached payload" is satisfied in-session, no board asks for more, and the spec puts offline browsing of history out of scope.

**The queued visit** (FR-026, and the slice's one agreed divergence). A visit in the outbox has no server id and is not in the server's history, so it cannot be paged and must not be faked into a row — a row the executive could read as recorded, before the server has it, would be a lie of exactly the kind this product avoids elsewhere. Instead the screen shows how many submissions are waiting, reusing the strip `TodaysBeatScreen` already renders from `subscribeOutbox`. It is absent when the queue is empty, so in the ordinary case the screen matches its board exactly.

---

## §9 — The date-range control, and the picker the design does not have

**Decision**: the control is the button board 1.5 draws, reading the active range. Tapping it opens a compact preset chooser — **All time** (the default, FR-020), **Last 7 days**, **Last 30 days**. There is no custom date picker.

**Rationale, and the tension it resolves**: `02-PRD.md` FR-MY-02 says the control "defaults to the last 7 days" and the board draws it reading exactly that. The user asked for a screen that pages back through previous visits ten at a time, which a 7-day window largely defeats. **The user was asked directly and chose all history**; FR-021 keeps "Last 7 days" as a preset so nothing FR-MY-02 describes is lost. What changed is the default, and reversing it is a one-line change.

**On the picker**: no board anywhere in the design shows a date-range picker — not here, not on the manager's list (3.3), not on the admin's (4.2). Rather than invent a screen, the chooser is a small overlay in the design system's existing sheet treatment, over an unchanged screen. The *screen* still matches board 1.5; the overlay is transient. This is recorded here rather than discovered at review, because this feature's fidelity requirement is otherwise absolute.

**Range boundaries are company-local**: "last 7 days" is seven business dates ending today *in the company's timezone*, resolved by `CompanyClock` — never from the device clock (rule 8). The filter is a comparison on the `businessDate` column §2 adds, so it needs no join and no timestamp arithmetic.

---

## §10 — The entry point

**Decision**: the **My visits** item in `ExecutiveBottomNav`, which currently calls `comingSoon('My visits')`.

Decoding board 1.5 confirms the bar is the same three-item bar board 1.3 draws, with My visits as the current item in `#1D4ED8`. The component already renders all three items and already takes an `active` prop typed `'Today' | 'MyVisits' | 'MyTotals'` — slice 005 built it that way deliberately, recording that "all three render even though only Today is built, because omitting two would visibly change the bar's spacing". So the entry point is a prop and a handler, not a new control.

**My totals stays `comingSoon`.** It is its own board (1.6) with its own period switcher and aggregates, and the spec puts it out of scope.

---

## §11 — Rendering a long, grouped, paged list

**Decision**: one `FlatList` over a **flat array of rows** — day headers and visit rows in one sequence — rather than a `SectionList` or a `ScrollView`.

**Rationale**: SC-003 requires an executive with 1,000 visits to scroll back through a month without the screen slowing or running out of memory, which rules out the `ScrollView` + `.map()` shape the executive screens have used so far (those render one bounded day). `FlatList` is already used by four admin screens here, so it is the established component.

A flat array rather than `SectionList` because the day header is not sticky on the board — it scrolls with its rows — and because `onEndReached` paging, header/row key management and the "merge the next page into the current day" rule are all simpler over one sequence. The grouping is built by a pure function from the page's rows plus the day metadata, so the merge is a data transformation rather than a list-component feature.

**Paging trigger**: `onEndReached` with a threshold of roughly half a screen, so the next ten are usually fetched before the executive reaches the bottom (FR-010's "no visible reload"), guarded by an in-flight flag so one fast scroll cannot fire two fetches (FR-012).

---

## Summary of new surface

| Layer | What is added |
|---|---|
| Prisma | **One column and one index.** `Visit.businessDate` (`@db.Date`), `@@index([companyId, executiveId, businessDate, submittedAt, id])`. One migration: add, backfill from `daily_assignments`, index, set not-null. No new model, no new enum, no new RLS surface. |
| Shared | `my-visits.schema.ts` — `myVisitsQuerySchema` (`.strict()`); re-exports in `index.ts`. No new error code. |
| API | `GET /visits/mine` at the path `03-ARCHITECTURE.md:830` already specifies, backed by a new `my-visits.service.ts` in the visits module. One line added to `submitVisit` to write the new column. |
| Mobile | `MyVisitsScreen` (board 1.5), one `ExecutiveStackParamList` entry, the bottom bar's My visits handler, and board-1.5 tokens in `executiveDesign.ts`. No new dependency and **no native rebuild**. |
