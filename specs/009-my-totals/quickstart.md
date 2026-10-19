# Quickstart: My Totals — Executive

**Feature**: `009-my-totals` | **Date**: 2026-10-20

The verification path for this feature. There are no automated tests (CLAUDE.md's standing policy), so this document **is** the test suite — every scenario below must be walked before the slice is called done.

Contracts are in [`contracts/executive-totals.md`](./contracts/executive-totals.md); field-level rules are in [`data-model.md`](./data-model.md). Neither is repeated here.

## Prerequisites

```bash
# No migration in this slice — nothing to apply.
pnpm dev

# Physical device: the API must be reachable (lost on replug / adb restart)
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
adb reverse --list          # expect both
```

Data needed, and the shape matters here more than the volume — **every scenario below is an arithmetic check, so you must know the right answer before you look at the screen**:

- An executive with visits on **several days of the current week, including today**, with a *different* number of orders per day so the bars differ and the tallest is unambiguous.
- **A Sunday with at least one order** — Scenario 7 is the whole reason this slice departs from the board, and without Sunday data it tests nothing.
- A day with **zero** orders inside the current week, so the zero column can be seen.
- Orders across **at least three brands** with clearly different quantities, and **more brands than the board's three rows**, so Scenario 6's scrolling and the sum check are both real.
- A day where the executive visited **fewer stops than were assigned**, so completion is not 100%.
- At least one **extra shop** added and visited (slice 007), for Scenario 5.
- A second executive in the same company with visits of their own, for Scenario 9.
- Ideally a **brand renamed after** some orders were recorded, for Scenario 6 step 5.

---

## Scenario 1 — The entry point

1. Open the app as the executive, on Today's beat.
2. Tap **My totals** in the bottom bar.
3. **Expect** the My totals screen — not the "coming in a later update" alert.
4. **Expect** My totals to be the current bar item in `#1D4ED8`, with Today and My visits muted.
5. Tap **Today**, then **My visits**. **Expect** both to navigate. **Expect no item in the bar to raise the coming-soon alert any more** — this slice makes the bar fully live.

*Covers FR-001.*

## Scenario 2 — The board, side by side

Open board 1.6 from `docs/ui-design/Field_Sales_Beat_App.html` next to the running screen and compare:

- Header: `52px 20px 12px` padding, column gap 12; the period label at 13 px `#5A6474` above **My totals** at 28 px / 700.
- Period tabs: `#E6EAF1` track, 4 px padding, radius 12, gap 4; each segment flex-1, **38 tall, radius 10, 700/14**; selected `#FFFFFF` on `#141A26`, unselected transparent on `#5A6474`.
- Completion card: `#1D4ED8`, radius 18, padding 16, gap 10. "Beat completion" 13 px `#D3DFFB` on the left, the percentage at **30 px / 700** on the right, baseline-aligned. Bar 8 px tall, radius 999, track `#4169E1`, fill **`#F2C572`**. Then "N of N assigned shops visited" at 13 px `#D3DFFB`.
- Three tiles: 3-column grid, gap 8; each `#FFFFFF`, `1px solid #DFE4EC`, radius 14, padding `10px 12px`, gap 2. Label 12 px / 600 `#5A6474`; value 24 px / 700 — **Orders in `#1D4ED8`**, the other two in `#141A26`.
- "QUANTITY BY BRAND" heading: 12 px / 700, letter-spacing `0.06em`, uppercase, `#5A6474`. Card `#FFFFFF`, `1px solid #DFE4EC`, radius 16, padding `6px 14px`. Each row: column gap 6, padding `10px 0`, `1px solid #ECEFF4` bottom border; name 14 px / 600 and quantity 14 px / 700 in the **mono** face, space-between; bar 8 px tall, radius 999, track `#ECEFF4`, fill `#1D4ED8`.
- "ORDERS PER DAY · THIS WEEK" card: same card treatment, padding `12px 14px`, **110 px tall**, columns bottom-aligned with gap 10. Per column: the count in **mono 11 px / 700 `#3A4353`** above the bar, the bar at `border-radius: 6px 6px 2px 2px`, the day name 11 px / 600 `#5A6474` below. Today's bar `#1D4ED8`, the rest `#9DB5F0`.
- Bottom bar: 84 px, `#FFFFFF`, `1px solid #DFE4EC` top border.

**Expect exactly two differences, both agreed and both named in the spec**: the weekly chart has **seven** columns where the board draws six, and the brand card grows past three rows (the screen scrolls) where the board's fits exactly. **Every colour, radius, font and spacing value must match.** Any third difference is a defect.

*Covers FR-026, SC-003.*

## Scenario 3 — The three periods

1. **Expect** the screen to open on **This week**.
2. **Expect** the header to read the week's span — e.g. *"Mon 28 Sep – Sun 4 Oct"*.
3. Switch to **Today**. **Expect** the header to read today's date, and **every** figure to change: completion, all three tiles, and the brand list.
4. Switch to **This month**. **Expect** the month and year, and every figure to change again.
5. **Expect the weekly chart NOT to change** in steps 3 and 4 — it is labelled "this week" and shows the current week in all three periods.

```bash
TOK=…
for p in TODAY THIS_WEEK THIS_MONTH; do
  curl -s "http://localhost:3000/api/v1/reports/executive-totals?period=$p" -H "Authorization: Bearer $TOK" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('$p', d['period']['label'], d['totals'], 'week', d['week']['from'], d['week']['to'])"
done
```

6. **Expect** the three `week.from`/`week.to` to be **identical** across all three periods.

*Covers FR-003, FR-004, FR-005, FR-007, FR-016.*

## Scenario 4 — The figures reconcile *(the one that matters most)*

For the selected period, check every number against the records:

```sql
-- orders, no-orders, total quantity
SELECT v.outcome, count(*) FROM visits v
WHERE v.executive_id = '<id>' AND v.business_date BETWEEN '<from>' AND '<to>'
GROUP BY v.outcome;

SELECT sum(o.total_quantity) FROM orders o JOIN visits v ON v.id = o.visit_id
WHERE v.executive_id = '<id>' AND v.business_date BETWEEN '<from>' AND '<to>';
```

1. **Expect** the Orders tile, the No order tile and the Total qty tile to match these exactly.
2. **Expect** the brand quantities to **sum exactly to the Total qty tile** — nothing is capped, so nothing is unaccounted for.
3. With **This week** selected, **expect** the weekly chart's counts to sum to the Orders tile.

*Covers SC-004, SC-005, SC-006, FR-011, FR-015a.*

## Scenario 5 — Beat completion, including extra shops

```sql
SELECT s.status, s.source, count(*) FROM assignment_stops s
JOIN daily_assignments a ON a.id = s.assignment_id
WHERE a.executive_id = '<id>' AND a.business_date BETWEEN '<from>' AND '<to>'
GROUP BY s.status, s.source;
```

1. **Expect** "assigned" to equal **all** stops in that result, `PLAN` and `EXEC_EXTRA` alike.
2. **Expect** "visited" to equal the `COMPLETED` ones.
3. **Expect** the percentage to be `round(visited / assigned × 100)`, the bar filled to it, and **never above 100%** — visit an extra shop and confirm the ratio still behaves.
4. Select a period in which **nothing was assigned** (a holiday week, or a month before the beat plan existed). **Expect** the card to say so in words — **not** `0%`, not `NaN%`, not a blank.

*Covers FR-008, FR-009, FR-010, SC-007.*

## Scenario 6 — Quantity by brand

1. **Expect** every brand ordered in the period to appear — count them against the records and confirm none is missing.
2. **Expect** them ordered largest quantity first, with the longest bar on the largest and the others proportional to it.
3. With **more brands than fit the screen**, scroll. **Expect** every brand reachable and **nothing clipped**.
4. **Expect** the quantities to sum to the Total qty tile (repeat of Scenario 4 step 2 — it is the guarantee this scrolling buys).
5. Rename a brand in the master **after** its orders were recorded, then reload. **Expect** the brand to appear **once**, under a name that was recorded with an order — **not** split into two rows, and **not** showing the new master name.
6. Select a period with no orders. **Expect** the section to say there is nothing to show rather than render an empty card.

*Covers FR-013, FR-014, FR-015, FR-015a. Step 5 is the subtle one — the grouping key is the brand, the label is a snapshot.*

## Scenario 7 — The weekly chart, and the Sunday that proves it *(do not skip)*

1. **Expect seven columns**, Monday to Sunday.
2. **Expect** today's column to be visibly distinct — `#1D4ED8` against `#9DB5F0`.
3. **Expect** each column's count above its bar, the day name below, and the tallest bar on the busiest day with the rest proportional.
4. **Expect** a day with no orders to appear as a zero column, not to be omitted.
5. **With an order recorded on Sunday**: expect it to appear in the Sunday column **and** to be included in the Orders tile for This week.

**This is the scenario the whole divergence from the board exists for.** With the board's six columns that Sunday order would be counted in every other figure on the screen and invisible here. If there is no Sunday data, create some — otherwise this scenario tests nothing.

*Covers FR-017, FR-018, FR-019, FR-020.*

## Scenario 8 — Periods are the company's, not the phone's

1. Change the **device** timezone to something far away (e.g. `Pacific/Auckland`) while the company stays `Asia/Kolkata`.
2. Reload My totals.
3. **Expect** the period label, the boundaries, the figures and the highlighted "today" column to be **unchanged** — they are the company's calendar, resolved server-side.
4. **Expect** the same figures a manager would see for this executive and period.

*Covers FR-006, and Constitution rule 8. Easy to skip and the exact thing that would be wrong if the client resolved the dates.*

## Scenario 9 — Nobody else's totals, and nothing an executive must not see

```bash
curl -s "http://localhost:3000/api/v1/reports/executive-totals?period=THIS_MONTH" -H "Authorization: Bearer $TOK" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
banned={'distanceMeters','isExceedRange','flags','reviewStatus','effectiveRadiusMeters',
        'exceedRangeCount','outOfRangeCount','latitude','longitude',
        'orderValue','totalValue','amount','price','revenue'}
def keys(o,acc=None):
    acc = acc if acc is not None else set()
    if isinstance(o,dict):
        for k,v in o.items(): acc.add(k); keys(v,acc)
    elif isinstance(o,list):
        for v in o: keys(v,acc)
    return acc
print('leaked:', sorted(keys(d) & banned) or 'none')
print('top-level keys:', sorted(d))
"
```

1. **Expect** `leaked: none`, and the top-level keys to be exactly `brands, completion, period, totals, week`.
2. Sign in as the **second** executive. **Expect** their own figures only — none of the first executive's.
3. Call the route with a **Company Admin** token. **Expect** `403 FORBIDDEN_ROLE`.
4. Call it with `?executiveId=<the other executive>`. **Expect** `400 VALIDATION_FAILED` naming the unrecognised key — there is no such parameter.
5. Call it with `?from=2020-01-01&to=2030-01-01`. **Expect** `400` — dates are not accepted from the client.
6. Call it with `?period=THIS_YEAR`. **Expect** `400`.

*Covers FR-002, FR-021, FR-022, FR-023, SC-008, SC-009.*

## Scenario 10 — Nothing recorded yet

1. Sign in as an executive with **no visits at all**.
2. **Expect** a well-formed screen, not an error: zeroes in the tiles, the completion card saying nothing was assigned, and the brand section saying there is nothing to show.
3. **Expect** the executive to be told plainly that there is nothing yet — not a wall of zeroes with no explanation.
4. **Expect** the weekly chart to show seven zero columns with today still highlighted.

*Covers FR-007's empty case, FR-010, FR-027.*

## Scenario 11 — Offline

1. Load the screen, then switch to aeroplane mode.
2. Pull to refresh. **Expect** the figures already on screen to stay, with a visible note that they are not fresh — **not** a blank screen and **not** a screen of zeroes.
3. Switch period while offline. **Expect** to be told it could not load, with what was on screen preserved.
4. Force-quit and reopen with no connection. **Expect** to be told there is no connection — **not** zeroes, which would read as "you did nothing".
5. Restore the connection and retry. **Expect** the figures to return.
6. Record a visit offline so it queues, then open My totals. **Expect** the screen to account for the fact that something has not reached the server rather than presenting the totals as complete.

*Covers FR-024, FR-025, SC-010.*

## Scenario 12 — A late sync changes yesterday

1. Record a visit while offline on one business day.
2. Let it sync on a later day.
3. Open My totals for **This week** and **This month**.
4. **Expect** the visit counted under **the business day it was recorded for**, not the day it synced — so a figure for an earlier day legitimately changes after the fact.

*Covers the spec's edge case, and the reason nothing here is stored.*

---

## Before calling the slice done

- [ ] All 12 scenarios walked, on a physical device for everything except the `curl`/`SQL` steps.
- [ ] **Scenarios 4, 5, 7 and 9 must not be skipped** — the figures reconciling to the records, completion never exceeding 100%, the Sunday column, and the privacy boundary. Each is a promise nothing else in the system double-checks.
- [ ] Scenario 2 is the fidelity check, and this slice has **exactly two** agreed divergences. A third is a defect.
- [ ] Scenario 8 is the one most likely to be waved through, and is exactly what breaks if the client ever resolves the dates.
- [ ] `docs/openapi.json` regenerated to include `GET /reports/executive-totals`.
- [ ] `pnpm build` and `pnpm lint` clean; `tsc --noEmit` clean in `apps/mobile`.
