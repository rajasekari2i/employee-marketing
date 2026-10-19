# Phase 1 Data Model: My Visits — Executive

**Feature**: `008-my-visits` | **Date**: 2026-10-20

This feature **reads** visits. It writes exactly one new value, on one existing model, at submission time.

## The one schema change

| Element | Change | Why |
|---|---|---|
| `Visit.businessDate` | **NEW** — `DateTime @db.Date @map("business_date")` | The day a visit belongs to, snapshotted from its assignment. Makes day-major ordering, day grouping, the day counts and the range filter all properties of one indexed column (research.md §2). |
| `Visit` index | **NEW** — `@@index([companyId, executiveId, businessDate, submittedAt, id], map: "visits_exec_history_idx")` | Serves every query this feature makes. None of the three existing indexes covers "this executive's visits, newest first". **The explicit `map:` is required, not cosmetic** — see below. |

Nothing else changes. No new model, no new enum value, no new tenant table — so **no new RLS surface**; `visits` is already `FORCE ROW LEVEL SECURITY` with a `visits_tenant_isolation` policy and is already in `TENANT_MODELS`.

### `Visit.businessDate` in detail

| Property | Value |
|---|---|
| Type | `DateTime @db.Date` — a calendar date with no time component, exactly as `DailyAssignment.businessDate` stores it |
| Nullable | **No**, after the backfill. Every visit belongs to a day. |
| Source | `DailyAssignment.businessDate` of the stop's assignment, read in the same transaction as the write |
| Written | Once, in `VisitsService.submitVisit`. Never updated. |
| Can it drift from its source? | **No.** `DailyAssignment` is an immutable snapshot (BUS-05), so the value it was copied from cannot change. |
| Client-supplied? | **Never.** Not in `submitVisitSchema`, which is `.strict()` — a client sending it gets a `400`. |

**Migration sequence** — four statements, in this order, hand-written in Prisma's generated style (`migrate dev` cannot run here; the role lacks CREATEDB, P3014):

1. `ALTER TABLE "visits" ADD COLUMN "business_date" DATE;` — nullable first, so it applies to a populated table.
2. `UPDATE "visits" v SET "business_date" = a."business_date" FROM "daily_assignments" a WHERE a."id" = v."assignment_id" AND v."business_date" IS NULL;` — **the backfill, and it is not optional.** `20261019230000_backfill_stop_coords` exists in this repository because a previous slice added a column and skipped this step, and every visit submission broke as a result. Written to be a correct no-op on a fresh database and idempotent if re-run.
3. `CREATE INDEX "visits_exec_history_idx" ON "visits"("company_id", "executive_id", "business_date" DESC, "submitted_at" DESC, "id" DESC);`

   **Name the index explicitly.** Prisma's default name for a five-column index on this table would be
   `visits_company_id_executive_id_business_date_submitted_at_id_idx` — **64 characters**, one over
   Postgres' 63-byte identifier limit, which Postgres silently truncates. A hand-written migration and
   a later `prisma migrate diff` would then disagree about the name and the next `migrate dev` on a
   developer machine would try to create a second, near-identical index. The longest index name
   currently in this schema is 59 characters (`daily_assignments_company_id_executive_id_business_date_idx`),
   so this is the first one to cross the line. `map:` in the schema and the same literal in the SQL keeps
   both sides agreeing.
4. `ALTER TABLE "visits" ALTER COLUMN "business_date" SET NOT NULL;` — only after the backfill, so it cannot fail on existing rows.

## Entity: the day group *(a read projection — not a table)*

One business day's worth of one executive's visits, as the screen renders it.

| Field | Type | Source |
|---|---|---|
| `businessDate` | `string` (`YYYY-MM-DD`) | `Visit.businessDate` |
| `label` | `string` | Formatted by the client: `"Today · Tue 29 Sep"` for today's business date, `"Mon 28 Sep"` otherwise |
| `orderCount` | `number` | Count of that day's `ORDER` visits — **the whole day's**, see below |
| `noOrderCount` | `number` | Count of that day's `NO_ORDER` visits — **the whole day's** |
| `items` | `VisitRow[]` | The day's visits that match the active tab |

**`orderCount`/`noOrderCount` ignore the active tab.** This is read off board 1.5's own component script, not inferred: it renders `items` *filtered* by the tab but computes the summary from the day's *unfiltered* list. So on the Order tab a day showing three order rows still reads "3 orders · 2 no order" (research.md §5).

The consequence for the contract is the load-bearing part: **the counts cannot be derived from the rows returned**, because when a tab is active the server sends only matching rows. They travel as day metadata alongside the page.

**A day with no matching rows is omitted entirely** — the board's final `.filter((g) => g.items.length)`. The server simply never sends rows for such a day, and the client never synthesises an empty heading.

## Entity: the visit row *(a read projection)*

What the executive is shown per visit. **This shape is authored for this screen and is deliberately not shared with the manager's visit list**, which carries the measurement and the flags and has an "Out of range" tab built on them (research.md §4).

| Field | Type | Source |
|---|---|---|
| `id` | `string` | `Visit.id` — the cursor key and the list key, not a link; this screen has no detail view |
| `businessDate` | `string` (`YYYY-MM-DD`) | `Visit.businessDate` — the grouping key |
| `shopName` | `string` | `Shop.name` |
| `outcome` | `'ORDER' \| 'NO_ORDER'` | `Visit.outcome` — drives the `ORD`/`NO` badge |
| `summary` | `string` | For `ORDER`: `"{brandCount} brands · {totalQuantity} qty"` from `Order`. For `NO_ORDER`: `Visit.reasonLabel`. Composed server-side. |
| `occurredAt` | `string` (ISO) | `Visit.submittedAt` — rendered as `10:20` in company-local time |

### What never appears in this shape

Listed by name so the boundary is visible rather than inferred (FR-022, FR-023, SC-007):

- `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus` — the measurement and the verdict.
- `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude` — what the verdict was measured against. A coordinate plus a radius lets the device compute its own verdict.
- `capturedLatitude`, `capturedLongitude`, `accuracyMeters` — **the executive's own position.** Their own data, but this screen is a record of what was done, not of where the phone was.
- `reasonText` — the free-text half of a no-order reason, and on the log redaction list. The board's row shows the *label*.
- `sampleShown`, `stopId`, `assignmentId`, `executiveId`, `shopId` — not drawn by the board.

**The test a reviewer can apply in one line**: if a field is not visible on board 1.5, it must not be in the `select`.

**`summary` is composed on the server, not the device**, for the same reason `distanceLabel` was in slice 007: the labels are recorded snapshots (`reasonLabel`, `Order.brandCount`/`totalQuantity`), and composing them once server-side means the two outcome shapes cannot drift between the API and the screen.

## Entity: the page *(a read projection)*

| Field | Type | Notes |
|---|---|---|
| `items` | `VisitRow[]` | Up to `limit` rows, already ordered `businessDate DESC, submittedAt DESC, id DESC` |
| `days` | `DaySummary[]` | One entry per business date present in `items`: `{ businessDate, orderCount, noOrderCount }` |
| `nextCursor` | `string \| null` | The last row's `id`, or `null` when there is nothing older |
| `counts` | `{ all, order, noOrder }` *(first page only)* | Totals for the **range in view**, not the page |

`counts` is returned only when no `cursor` was supplied. They cannot change as the executive scrolls, so re-sending them per page would be noise.

## Ordering, and why it is exactly this

```
ORDER BY business_date DESC, submitted_at DESC, id DESC
```

| Key | Why it is here |
|---|---|
| `business_date DESC` | **Day-major.** Guarantees every day's visits arrive contiguously, which is what makes FR-011 (one block per day across a page boundary) a property of the query rather than a hope. |
| `submitted_at DESC` | Newest first within a day, matching what the row displays. |
| `id DESC` | Makes the ordering **total**, which a keyset cursor requires to be correct. |

A wrong device clock can therefore misplace a row **within** its day and nothing more — it cannot move a visit to another day, split a day group, or break pagination.

## Validation rules

| Rule | Where enforced | Failure |
|---|---|---|
| The caller is a Marketing Executive | `@Roles` on the controller | `403 FORBIDDEN_ROLE` |
| Only the caller's own visits are returned | service, `executiveId` from the JWT — never a parameter | — (no leak is possible; there is no parameter to abuse) |
| `cursor` is a visit id | service; an unknown id yields an empty page, not an error | `200` with `items: []` |
| `limit` is 1–100, default 10 | Zod | `400 VALIDATION_FAILED` |
| `outcome` is `ORDER`/`NO_ORDER`/absent | Zod enum | `400 VALIDATION_FAILED` |
| `range` is a known preset | Zod enum | `400 VALIDATION_FAILED` |
| No unknown query field | Zod `.strict()` | `400 VALIDATION_FAILED` |

## State transitions

**None.** This feature reads a terminal record. A visit has no lifecycle an executive can move it through: `FR-VISIT-12`'s "a submitted visit cannot be edited" already holds, there is no edit or delete route, and the spec puts both permanently out of scope. The only thing that changes over time is how many visits exist.
