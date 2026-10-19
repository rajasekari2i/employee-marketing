# Quickstart: My Visits — Executive

**Feature**: `008-my-visits` | **Date**: 2026-10-20

The verification path for this feature. There are no automated tests (CLAUDE.md's standing policy), so this document **is** the test suite — every scenario below must be walked before the slice is called done.

Contracts are in [`contracts/my-visits.md`](./contracts/my-visits.md); field-level rules are in [`data-model.md`](./data-model.md). Neither is repeated here.

## Prerequisites

```bash
# Apply the migration (migrate dev cannot run here — the role lacks CREATEDB)
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy

# API + Metro
pnpm dev

# Physical device: the API must be reachable (lost on replug / adb restart)
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
adb reverse --list          # expect both
```

Data needed:

- An executive with visits on **at least three different business days**, so day grouping and the page boundary can both be seen.
- **More than 10 visits in total** — otherwise the second page never loads and the whole paging half of this feature goes untested. More than 20 is better.
- A mix of orders and no-orders **on the same day**, so a day summary reading "3 orders · 2 no order" can be checked against its rows.
- At least one day where **all** visits are orders, so the No order tab's day-omission rule can be seen.
- A second executive in the same company with visits of their own, for Scenario 10.

A reminder from slice 006's live debugging: check the data is plausible before judging the screen wrong.

---

## Scenario 0 — The migration backfilled

Run this **first**. Everything else depends on it, and the failure mode is silent.

```sql
-- every visit must have a business date, and it must match its assignment
SELECT count(*) AS missing FROM visits WHERE business_date IS NULL;
SELECT count(*) AS mismatched
FROM visits v JOIN daily_assignments a ON a.id = v.assignment_id
WHERE v.business_date <> a.business_date;
```

**Expect** `0` and `0`.

A previous slice added a column to this table without backfilling it and broke every visit submission in production — `20261019230000_backfill_stop_coords` is the repair. Do not skip this check.

*Covers the migration in data-model.md.*

## Scenario 1 — The entry point

1. Open the app as the executive, on Today's beat.
2. Tap **My visits** in the bottom bar.
3. **Expect** the My visits screen — not the "coming in a later update" alert.
4. **Expect** My visits to be the current bar item, in `#1D4ED8`, with Today and My totals muted.
5. Tap **Today**. **Expect** to return to the beat screen.
6. Tap **My totals**. **Expect** the "coming in a later update" alert — it is still out of scope.

*Covers FR-001.*

## Scenario 2 — The board, side by side

Open board 1.5 from `docs/ui-design/Field_Sales_Beat_App.html` next to the running screen and compare:

- Header: `52px 20px 12px` padding, column gap 14; "Your visit history" at 13 px `#5A6474` above **My visits** at 28 px / 700.
- The date-range button, right-aligned and bottom-aligned with the title: 40 px tall, radius 10, `1.5px solid #CBD2DD` on `#FFFFFF`, 600/13 `#141A26`, calendar icon on the left.
- Tab group: `#E6EAF1` track, 4 px padding, radius 12, gap 4. Each tab 38 px tall, radius 10, 700/14. Selected is `#FFFFFF` on `#141A26`; unselected is transparent on `#5A6474`. Labels carry counts — `All · 64`.
- Day heading: 12 px / 700, letter-spacing `0.06em`, **uppercase**, `#5A6474`, with the day's summary right-aligned at 12 px `#5A6474`. Padding `4px 2px 0`.
- Day card: `#FFFFFF`, `1px solid #DFE4EC`, radius 16, clipped.
- Row: `11px 14px` padding, gap 12, `1px solid #ECEFF4` bottom border. A 36×36 badge at radius 11 — `ORD` on `#E3EBFC`/`#1E3A8A`, `NO` on `#E9EDF3`/`#3A4353`, 11 px / 800. Shop name 15/700 ellipsised; summary 13 px `#3A4353`; time right-aligned in the mono face at 12 px `#5A6474`.
- Bottom bar: 84 px, `#FFFFFF`, `1px solid #DFE4EC` top border.

**Expect** no visible difference. *Covers FR-027. The **only** permitted difference is the waiting strip of Scenario 9, which must be absent while the outbox is empty — so with nothing queued, this comparison must show zero differences.*

## Scenario 3 — Grouped by day, newest first

1. Open the screen.
2. **Expect** today's visits under a heading reading **"Today · <day> <date>"**, and earlier days under headings reading just **"<day> <date>"**.
3. **Expect** days in descending order, and rows within each day newest first.
4. **Expect** each row to show the shop, an `ORD` or `NO` badge, a summary, and a time.
5. **Expect** an order row's summary to read `"N brands · N qty"`, and a no-order row's to read the reason.

*Covers FR-003, FR-004, FR-005, FR-006.*

## Scenario 4 — Exactly ten, then ten more *(the paging one)*

1. Open the screen and count the rows.
2. **Expect** exactly **10** visit rows loaded (day headings do not count).

```bash
# confirm the server, not the client, did the limiting
TOK=…
curl -s "http://localhost:3000/api/v1/visits/mine" -H "Authorization: Bearer $TOK" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['items']), d['nextCursor'] is not None)"
```

3. **Expect** `10 True`.
4. Scroll to the bottom. **Expect** the next ten to appear.
5. **Expect** the rows already on screen **not to move, re-order or flash**.
6. Keep scrolling to the very end. **Expect** loading to stop cleanly, with `nextCursor` null and no further requests — not a spinner that never resolves.

*Covers FR-008, FR-009, FR-010, FR-013.*

## Scenario 5 — A day that straddles a page boundary *(the one that is easy to get wrong)*

1. Find a business day with enough visits that it spans the 10-row boundary — or create one.
2. Open the screen and scroll past the boundary.
3. **Expect** that day to appear **once**, with all of its visits under the single heading.
4. **Expect NOT** to see the same day heading twice with the rows split between them.

*Covers FR-011. This is what `Visit.businessDate` and the day-major ordering exist for; if it fails, check the `ORDER BY` before anything else.*

## Scenario 6 — No duplicates, ever

1. Scroll through the entire history.
2. **Expect** every visit exactly once.

```bash
# the server's own ordering must be total and day-major
curl -s "http://localhost:3000/api/v1/visits/mine?limit=10" -H "Authorization: Bearer $TOK" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print([ (i['businessDate'], i['occurredAt']) for i in d['items'] ])"
```

3. **Expect** `businessDate` to be non-increasing down the list, and `occurredAt` non-increasing within each run of the same date.
4. Record a new visit while the list is open, then scroll for the next page. **Expect** no row to be served twice — the keyset cursor makes an insertion ahead of it invisible.
5. Scroll fast enough to trigger two end-of-list events. **Expect** one page appended, not two.

*Covers FR-012, SC-005.*

## Scenario 7 — The three tabs

1. Select **Order**. **Expect** only `ORD` rows.
2. Select **No order**. **Expect** only `NO` rows, each with its reason.
3. **Expect** the list to restart from the newest visit on each switch, not to resume at the previous scroll depth.
4. **Expect** a day with no matching rows to be **absent entirely** — not an empty heading.
5. On the **Order** tab, find a day that also had no-orders. **Expect** its heading to still read the day's full totals, e.g. *"3 orders · 2 no order"*, above three order rows.

```bash
# the filter must be applied in SQL — ten matching rows, not ten of which some are hidden
curl -s "http://localhost:3000/api/v1/visits/mine?outcome=NO_ORDER&limit=10" -H "Authorization: Bearer $TOK" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(set(i['outcome'] for i in d['items']), len(d['items']))"
```

6. **Expect** `{'NO_ORDER'} 10`.

*Covers FR-014, FR-016, FR-017, FR-018, and the day-summary rule from research.md §5. Step 5 is the subtle one — the summary is computed from the day's unfiltered visits, exactly as board 1.5's own script does.*

## Scenario 8 — The tab counts are totals, not page counts

1. Note the three tab counts when the screen opens.
2. Scroll to the very end of the **All** tab, counting rows.
3. **Expect** the row count to equal the `All` tab's number, and the counts **not to have changed** while scrolling.
4. Switch to **Order**, scroll to the end, count. **Expect** it to equal the `Order` number.
5. **Expect** `All = Order + No order`.

```sql
SELECT outcome, count(*) FROM visits WHERE executive_id = '<id>' GROUP BY outcome;
```

6. **Expect** these to match the tabs exactly.

*Covers FR-015, SC-009.*

## Scenario 9 — Offline

1. Load the list, then switch to aeroplane mode.
2. Pull to refresh. **Expect** the loaded visits to stay on screen with a visible note that they are not fresh — **not** a blank screen.
3. Scroll for the next page. **Expect** to be told it could not load, with a retry, and **nothing already loaded to disappear**.
4. Force-quit and reopen with no connection. **Expect** to be told there is no connection — **not** an empty history, and not a claim that there are no visits.
5. Restore the connection and retry. **Expect** the list to recover.
6. Still offline, record a visit from Today's beat so it queues. Open My visits. **Expect** a strip reporting that a submission is waiting to sync.
7. **Expect** that visit **not** to be listed as a history row — it is not on the server yet.
8. Restore the connection, let it sync, pull to refresh. **Expect** it to appear as an ordinary row under its business day, and the strip to vanish.

*Covers FR-024, FR-025, FR-026, FR-026a, SC-010, SC-011. Step 6's strip is this slice's **one agreed divergence** from board 1.5; step 8 confirms it disappears when the queue empties, which is what keeps Scenario 2 honest.*

## Scenario 10 — Nobody else's history, and nothing an executive must not see

```bash
# the response must carry none of these, on any row
curl -s "http://localhost:3000/api/v1/visits/mine" -H "Authorization: Bearer $TOK" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
banned={'distanceMeters','isExceedRange','flags','reviewStatus','effectiveRadiusMeters',
        'shopLatitude','shopLongitude','capturedLatitude','capturedLongitude',
        'accuracyMeters','reasonText'}
leaked=sorted({k for i in d['items'] for k in i} & banned)
print('leaked:', leaked or 'none')
print('row keys:', sorted(d['items'][0]) if d['items'] else '(no rows)')
"
```

1. **Expect** `leaked: none`, and the row keys to be exactly `businessDate, id, occurredAt, outcome, shopName, summary`.
2. **Expect** every returned visit to belong to the calling executive:

```sql
SELECT DISTINCT executive_id FROM visits WHERE id IN (…the returned ids…);
```

3. Sign in as the **second** executive and open My visits. **Expect** only their own visits — none of the first executive's.
4. Call the route with a **Company Admin** token. **Expect** `403 FORBIDDEN_ROLE`.
5. Call it with an unknown query field: `?executiveId=<the other executive>`. **Expect** `400 VALIDATION_FAILED` naming the unrecognised key — there is no such parameter, and `.strict()` says so rather than ignoring it.

*Covers FR-002, FR-022, FR-023, SC-007, SC-008.*

## Scenario 11 — The date range

1. **Expect** the control to read **All time** when the screen opens, and the list to reach back through the executive's whole history.
2. Open it and choose **Last 7 days**. **Expect** the list to restart, to contain only the last seven business days, and the **tab counts to change to match**.
3. **Expect** scrolling to end at the window's edge rather than continuing into older visits.
4. Choose **All time** again. **Expect** the full history back and the counts restored.

*Covers FR-019, FR-020, FR-021. Note FR-020 is a recorded departure from PRD FR-MY-02's "last 7 days" default, decided with the user — the preset is still here, it is simply not the default.*

## Scenario 12 — The empty states

1. Sign in as an executive with **no visits at all**. **Expect** a plain statement that there is no history yet — **not** a blank panel, and not a spinner.
2. With visits but none of one kind, select that tab. **Expect** a statement that the tab is empty, with the tabs and header still in place.
3. **Expect** the screen's layout to be intact in both cases — the header, the tabs and the bar all still rendered.

*Covers FR-007's empty case, FR-018, FR-028.*

## Scenario 13 — A long history stays usable

1. With 300+ visits (seed if necessary), scroll back through a month.
2. **Expect** scrolling to stay smooth and memory not to climb without bound.
3. **Expect** no request to fetch more than `limit` rows.

*Covers SC-002, SC-003.*

## Scenario 14 — History tells the truth about the past

1. Find a visit whose brand or reason has since been **renamed or deactivated** in the masters (rename one if needed).
2. **Expect** the row to still read what was recorded at the time, not the current master value.
3. Find a visit recorded offline and synced later (Scenario 9 produces one).
4. **Expect** it under **the business day it was recorded for**, not the day it reached the server.

*Covers FR-006, FR-007, and the edge case the business-date column exists for.*

---

## Before calling the slice done

- [ ] All 15 scenarios walked (0–14), on a physical device for everything except the `curl`/`SQL` steps.
- [ ] **Scenarios 0, 5, 6 and 10 must not be skipped** — the backfill, the day that straddles a page, the no-duplicates guarantee, and the privacy boundary. Each is a promise nothing else in the system double-checks.
- [ ] Scenario 2 is the fidelity check. Unlike slice 007 this feature has **one** agreed divergence and only one; with an empty outbox the comparison must show **zero** differences.
- [ ] `docs/openapi.json` regenerated to include `GET /visits/mine`.
- [ ] `pnpm build` and `pnpm lint` clean; `tsc --noEmit` clean in `apps/mobile`.
