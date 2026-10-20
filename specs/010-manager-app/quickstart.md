# Quickstart: The Manager App

**Feature**: `010-manager-app` | **Date**: 2026-10-20

The verification path for this feature. There are no automated tests (CLAUDE.md's standing policy), so this document **is** the test suite.

It is grouped by user story so it can be run in stages as each ships — US1 and US2 together are a usable increment, US4 is independent of everything before it.

Contracts are in [`contracts/manager-app.md`](./contracts/manager-app.md); field-level rules are in [`data-model.md`](./data-model.md). Neither is repeated here.

## Prerequisites

```bash
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy
pnpm dev
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:8081 tcp:8081 && adb reverse --list
```

Data needed, and the shape matters more than the volume — **every figure below is an arithmetic check, so know the right answer before looking at the screen**:

- **A Manager account.** There has never been one that could sign in to anything; create one if the pilot data has none.
- A completed previous day with **at least two executives**, each on a different beat.
- **Assigned stops that were not visited**, so pending is non-zero and the within-range bar has three segments.
- **At least two out-of-range visits — one an order, one a no-order.** Scenario 9 is meaningless without both.
- **An undelivered order**, and ideally a second manager account for the concurrency check.
- **A shop with three or more previous no-order visits**, one reason repeating, for Scenario 8.
- **A shop with no history at all**, for the first-visit case.
- Staff across several roles for the attendance roster.

> **Known limitation, not a defect.** The dev build's `GOOGLE_MAPS_API_KEY` is empty, so **map tiles on board 3.6 render blank** — the same gap already affecting the executive's pin-capture screen. Everything else on that screen works. Judge the layout, the pin positions, the ring and the numbers; do not judge the tiles.

---

## Scenario 0 — The migration

Run first; the rest depends on it.

```sql
SELECT count(*) FROM attendance;                             -- table exists
SELECT count(*) FROM assignment_stops WHERE add_reason IS NOT NULL;  -- column exists
SELECT count(*) FROM orders WHERE delivered_at IS NOT NULL;          -- columns exist
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'attendance';
```

**Expect** the three to run without error, and RLS to be both **enabled and forced** on `attendance`. Confirm `'Attendance'` is in `TENANT_MODELS` — a new tenant table missing either layer must fail CI.

*Covers data-model.md, Constitution rule 2.*

---

## US1 — The previous-day report

### Scenario 1 — A manager finally has an app

1. Sign in as the Manager.
2. **Expect** the previous-day report — **not** "your screens are coming in a later update".
3. **Expect** the bottom bar: Reports · Visits · Attendance, with Reports current.
4. Open the account menu. **Expect** Profile and Log out, and the same dropdown the other roles have — floating, not pushing the page down.
5. Open Profile. **Expect** the shared profile screen with the manager's name and role, and **the manager's bottom bar**.

*Covers FR-001, FR-002, FR-003.*

### Scenario 2 — The board, side by side

Compare against board 3.1: the header and its date, the account avatar, the filter row, the violet "Add extra shop to today" action bar with its "One executive, today only · beat plan unchanged" label, the six count tiles, the within-range bar with its legend and percentage, the "Out of range · N" section with "See all visits", and the bottom bar.

**Expect** no visible difference. *Covers FR-053.*

### Scenario 3 — The counts reconcile

```sql
-- assigned / visited / pending
SELECT s.status, count(*) FROM assignment_stops s
JOIN daily_assignments a ON a.id = s.assignment_id
WHERE a.business_date = '<date>' GROUP BY s.status;

-- order / no-order / out of range
SELECT outcome, is_exceed_range, count(*) FROM visits
WHERE business_date = '<date>' GROUP BY outcome, is_exceed_range;
```

1. **Expect** all six tiles to match exactly.
2. **Expect** `within + exceeded + notVisited` to equal **assigned**, and the percentage to be `within / visited`.
3. **Expect** the out-of-range section to list exactly the flagged visits, with shop, executive, flag and distance.
4. Change the date, then the executive, then the beat. **Expect** every figure to recalculate each time.
5. Pick a day with nothing recorded. **Expect** it to say so — not a bar with no proportions and six zeroes with no explanation.
6. **Expect** each executive's beat start and end times, with a day that was never started marked as such.

*Covers FR-005…FR-011, SC-004, SC-005.*

### Scenario 4 — Tiles drill through

1. Tap each of the six tiles.
2. **Expect** the visits list to open **already filtered** to what that tile counted, with its count matching.
3. Tap "See all visits" in the out-of-range section. **Expect** the list on the Out of range tab.

*Covers FR-007, FR-013.*

---

## US2 — The visits list

### Scenario 5 — The board, and the rows

Compare against board 3.3: the header, the date / All executives / All beats filter row, the four-tab group with counts, and the rows — `ORD` / `NO` badge, shop, executive and time, the summary, the delivery or no-order chip, and the distance.

1. **Expect** no visible difference.
2. **Expect** an out-of-range row's distance to read "· out" and to be visually distinguished.

*Covers FR-016, FR-053.*

### Scenario 6 — Tabs, filters and paging

1. **Expect** exactly **10** rows on opening.

```bash
TOK=…
curl -s "http://localhost:3000/api/v1/visits?limit=10" -H "Authorization: Bearer $TOK" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(len(d['items']), d['nextCursor'] is not None, d['counts'])"
```

2. Scroll to the end. **Expect** the next ten to append, with nothing above moving.
3. Walk every page. **Expect** each visit exactly once — **zero duplicates, zero omissions**.
4. Switch each tab. **Expect** only matching visits, and each tab's count to equal what scrolling it to the end yields.
5. **Expect the Out of range tab to contain both orders and no-orders** — it filters on the measurement, not the outcome.
6. Set an executive filter, then a beat filter. **Expect** the list and the counts to narrow, and "All executives" / "All beats" to restore.
7. Choose a filter combination matching nothing. **Expect** a plain statement, not an empty panel.

*Covers FR-014…FR-021, SC-006, SC-007.*

---

## US3 — Details and delivery

### Scenario 7 — An order, and marking it delivered

1. Open an order visit. **Expect** board 3.4: the delivery status card, the order lines with quantities, the total, and executive / beat / sample shown / location verdict.
2. **Expect** the position indicator ("1 / 112") and the previous and next arrows.
3. Step with next and previous. **Expect** one order at a time, within the current filter, and the arrows **unavailable at the ends** rather than wrapping.
4. Mark it delivered. **Expect** the card to become Delivered, naming who and when.

```sql
SELECT delivery_status, delivered_by, delivered_at FROM orders WHERE id = '<id>';
```

5. **Expect** all three populated, with `delivered_by` the manager.
6. **The concurrency check** — mark the *same* order from two sessions at once:

```bash
for i in 1 2; do
  curl -s -o /dev/null -w "%{http_code} " -X POST "http://localhost:3000/api/v1/orders/$ORDER/deliver" \
    -H "Authorization: Bearer $TOK" -H "Idempotency-Key: $(uuidgen)" \
    -H 'Content-Type: application/json' -d '{}' &
done; wait; echo
```

7. **Expect** one `200` and one `409 ORDER_ALREADY_DELIVERED`, and `delivered_by` to be **whoever won** — never overwritten.
8. Send a body carrying `deliveredBy` or `deliveredAt`. **Expect** `400`, not a silent strip.

*Covers FR-022…FR-025, SC-008.*

### Scenario 8 — A no-order, and its history

1. Open a no-order visit at a shop with history. **Expect** board 3.5: this visit's reason, the sample and location chips, and **the last five no-order reasons at that shop**, newest first.
2. With one reason repeating, **expect** the repetition called out.
3. Open one at a shop with fewer than five. **Expect** what exists, not padding.
4. Open one at a shop with no history. **Expect** it to say this is the first.

*Covers FR-026, FR-027.*

### Scenario 9 — Out of range, and the routing that decides the screen *(do not skip)*

1. From the **Out of range** tab, open the visit that is an **order**. **Expect** board 3.6 — read-only, with the map, the distance against the allowed radius, the order lines, the accuracy and the submission time. **Expect no Mark as delivered.**
2. From the **Order** tab, open **the same visit**. **Expect** board 3.4 — **with** Mark as delivered.
3. From the Out of range tab, open the one that is a **no-order**. **Expect** board 3.6 again, with the reason instead of lines.
4. **Expect** the map's shop pin, radius ring and submitted point to be positioned from the values **frozen on the visit**:

```sql
SELECT distance_meters, effective_radius_meters, shop_latitude, shop_longitude,
       captured_latitude, captured_longitude, accuracy_meters
FROM visits WHERE id = '<id>';
```

5. Change that shop's pin in the admin, reload the visit. **Expect the detail unchanged** — it shows what the visit was measured against, not where the shop is now.

*Covers FR-028, FR-029, FR-030. **Steps 1–2 are the point**: the same visit, two screens, decided by where the manager came from.*

### Scenario 10 — The executive's side is untouched *(do not skip)*

This feature deliberately shows a manager what every prior slice worked to keep from executives. Prove the other half still holds.

```bash
EXEC_TOK=…
curl -s "http://localhost:3000/api/v1/visits/mine" -H "Authorization: Bearer $EXEC_TOK" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
banned={'distanceMeters','isExceedRange','flags','reviewStatus','effectiveRadiusMeters',
        'shopLatitude','shopLongitude','capturedLatitude','capturedLongitude','accuracyMeters','reasonText'}
print('leaked:', sorted({k for i in d['items'] for k in i} & banned) or 'none')
print('row keys:', sorted(d['items'][0]))
"
```

1. **Expect** `leaked: none` and exactly the six keys slice 008 specified.
2. Walk the executive's My visits, My totals and Today screens. **Expect** no distance, no range verdict, no flag anywhere.
3. Call `GET /visits` (the manager's) with an **executive's** token. **Expect** `403 FORBIDDEN_ROLE`.
4. Call `GET /attendance` and `POST /orders/:id/deliver` with an executive's token. **Expect** `403` each.

*Covers FR-046, FR-047, SC-011. **This is the scenario that proves the inversion was done safely.***

---

## US4 — Attendance

### Scenario 11 — The day sheet

1. Open Attendance. **Expect** board 3.7: the date with a Today marker, the four summary counts, and a row per person with morning and evening cells.
2. **Expect the roster to be every active member of staff except the System Admin** — including the manager themselves.
3. **Expect** every cell's state to be readable as **text**, not colour alone.
4. **Expect** the summary counts to match the cells.
5. Move to previous and next days. **Expect** each to load its own records.
6. Move to a **future** date. **Expect** the cells to be uneditable.

*Covers FR-031…FR-033, FR-039, FR-040, FR-040a.*

### Scenario 12 — Recording a session

1. Tap an unmarked morning cell. **Expect** board 3.8 with the five statuses.
2. Choose **Present** without a time. **Expect** it cannot be saved.
3. Choose Present with a time **after** the company's morning start plus the one-hour threshold. Save.
4. **Expect** the lateness to be **derived and displayed**, not chosen.

```sql
SELECT status, actual_time, lateness_flag, payable_units, version, is_active, recorded_by
FROM attendance WHERE user_id='<id>' AND business_date='<date>' AND session='MORNING'
ORDER BY version;
```

5. **Expect** `lateness_flag` to match the company's thresholds and `payable_units` to come from `payableUnitByStatus`.
6. Send a body carrying `latenessFlag` or `payableUnits`. **Expect** `400`, not a silent strip.
7. **Expect** the summary counts to update.

*Covers FR-034, FR-035, SC-010.*

### Scenario 13 — An amendment keeps the original *(do not skip)*

1. Edit the session from Scenario 12.
2. **Expect** a reason to be **required**, and the previous value, its author and its time to be shown.
3. **Expect** the editor to state that lateness does not change payable half-days unless a policy says so.
4. Save with a reason.

```sql
SELECT version, status, is_active, change_reason, superseded_by_id, recorded_by
FROM attendance WHERE user_id='<id>' AND business_date='<date>' AND session='MORNING'
ORDER BY version;
```

5. **Expect two rows**: v1 with `is_active = false` and its original status intact, v2 active with the reason. **Nothing overwritten.**
6. Amend again. **Expect** three rows, each keeping the one before.
7. **The concurrency check** — amend the same session from two sessions at once. **Expect** one success and one `409 ATTENDANCE_VERSION_CONFLICT`, and **exactly one active row**:

```sql
SELECT count(*) FROM attendance
WHERE user_id='<id>' AND business_date='<date>' AND session='MORNING' AND is_active;
```

8. **Expect** `1`.
9. Try to write a future date directly. **Expect** `409 ATTENDANCE_DATE_IN_FUTURE`.

*Covers FR-036, FR-037, FR-038, SC-009.*

---

## US5 — Adding a shop to someone's day

### Scenario 14 — The manager's extra shop

1. From the report's action bar, open Add shop to today. **Expect** board 3.2.
2. Choose an executive. **Expect** their beat and progress ("5 of 12 done").
3. Search shops. **Expect** matches, and **shops already on that executive's day excluded**.
4. Select one, leave the reason **empty**. **Expect** it cannot be added.
5. Add with a reason.
6. **Expect** it on that executive's day, attributed to the manager:

```sql
SELECT s.source, s.add_reason, s.added_by_user_id, sh.name
FROM assignment_stops s JOIN shops sh ON sh.id = s.shop_id
WHERE s.source = 'MANAGER_EXTRA';

SELECT count(*) FROM beat_plan_shops WHERE beat_plan_id = '<id>';
```

7. **Expect** `MANAGER_EXTRA`, the reason stored, the manager as adder — and **the beat plan unchanged**.
8. **Expect** the reason in the audit trail.
9. Add the **same** shop again. **Expect** `409 SHOP_ALREADY_IN_BEAT`.
10. Try against an executive whose beat has not started. **Expect** `409 BEAT_NOT_STARTED`.

*Covers FR-041…FR-045, SC-013.*

---

## Cross-cutting

### Scenario 15 — Offline

1. Load each screen, then switch to aeroplane mode.
2. Pull to refresh. **Expect** what is on screen to stay, with a note that it is not fresh — not a blank screen and **not zeroes**, which would read as "nothing happened yesterday".
3. With nothing loaded, open offline. **Expect** to be told there is no connection.
4. Try to mark delivered and to save attendance offline. **Expect** each reported rather than silently lost, and **no duplicate record** when the connection returns.

*Covers FR-051, FR-052.*

---

## Before calling the slice done

- [ ] All 16 scenarios walked, on a physical device for everything except the `curl` / `SQL` steps.
- [ ] **Scenarios 0, 9, 10 and 13 must not be skipped** — the migration and its RLS, the routing that decides which detail screen opens, the proof that executives still cannot see a measurement, and the attendance amendment keeping its original. Each is a promise nothing else double-checks.
- [ ] **Scenario 10 is the one this whole feature rests on.** It inverts a rule five slices worked to enforce; the inversion is only safe if the other half is proven intact in the same run.
- [ ] Scenarios 2 and 5 are the fidelity checks, across all eight boards.
- [ ] `docs/openapi.json` regenerated with all six routes.
- [ ] `pnpm build` and `pnpm lint` clean; `tsc --noEmit` clean in `apps/mobile`.
