# Quickstart: Add Extra Shop — Executive

**Feature**: `007-extra-shops` | **Date**: 2026-10-19

The verification path for this feature. There are no automated tests (CLAUDE.md's standing policy), so this document **is** the test suite — every scenario below must be walked on a real device before the slice is called done.

Contracts are in [`contracts/extra-shops.md`](./contracts/extra-shops.md); field-level rules are in [`data-model.md`](./data-model.md). Neither is repeated here.

## Prerequisites

```bash
# API + Metro
pnpm dev

# Physical device: the API must be reachable (lost on replug / adb restart)
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
adb reverse --list          # expect both
```

Data needed in the pilot company:

- An executive with an active beat plan covering today, and **at least one shop not on that plan** — the picker has nothing to show otherwise.
- At least one shop with `locationStatus = 'APPROVED'` and real coordinates, and one with `locationStatus = 'NONE'`, so both chips on board 1.4 can be seen.
- At least one shop belonging to a *different* beat plan, so the beat chip shows a name rather than "No beat".
- Company settings with `autoApproveExecPins` **on** for scenarios 9–10; see the note at the end.

A reminder from the live debugging in slice 006: a shop's pin may be nonsense (the pilot data had an Erode shop pinned in Siberia). Check the coordinates are plausible before judging a distance wrong.

---

## Scenario 1 — The entry point appears only while running

1. Open the app as the executive, before starting the beat.
2. **Expect** the locked strip: *"Start the beat to record visits and add extra shops."* No dashed button.
3. Start the beat.
4. **Expect** the dashed button *"Add extra shop to today"* in that same slot — `1.5px dashed #1D4ED8`, 48 px tall, 14 px radius, plus-icon on the left.
5. End the beat.
6. **Expect** the ended strip, and the dashed button gone.

*Covers FR-001, FR-002.*

## Scenario 2 — The board, side by side

Open board 1.4 from `docs/ui-design/Field_Sales_Beat_App.html` next to the running screen and compare:

- Header: back chevron in a 44 px white square, `Tue, 29 Sep · <beat plan>` at 13 px `#5A6474`, title 24 px / 700.
- Violet banner `#EFE9FB` on `#4C2690`, info icon, the exact sentence about today's list only.
- Search box: 48 px, radius 12, `1.5px solid #CBD2DD`, placeholder *"Search shop name or owner"*.
- Section head *"Nearby · not in today's list"* with *"Closest first"* on the right.
- Rows: 22 px radio, name 15/700, address 12 px ellipsised, two chips, distance right-aligned in the mono face.
- Selected row: background `#E3EBFC`, border `2px solid #1D4ED8`, filled radio.
- Dashed *"Shop not listed — create new"*.
- Footer: the unselected and selected variants.

**Expect** no visible difference. *Covers FR-025 — and unlike slice 006 there are no agreed divergences, so any difference is a defect.*

## Scenario 3 — Nearest first, with the right chips

1. Open the screen with location permission granted.
2. **Expect** the list ordered closest first, each row showing a distance (`90 m`, `1.2 km`).
3. **Expect** a shop with a saved pin to show *"Pin saved"* on `#E3EBFC`/`#1E3A8A`, and one without to show *"No pin — capture on arrival"* on `#FCEFD9`/`#7A4105`.
4. **Expect** the beat chip to show a plan name, or *"No beat"*.
5. **Expect** no shop that is already on today's list.

*Covers FR-003, FR-004, FR-005.*

## Scenario 4 — Search

1. Type part of a shop's name. **Expect** the list to narrow.
2. Clear it, type part of an owner's name. **Expect** that owner's shops.
3. Search for a shop that *is* already on today's list. **Expect** it absent — the exclusion survives search.
4. Search for a shop far outside the nearby window. **Expect** it found — search lifts the bounding box.
5. Type nonsense. **Expect** an explicit "no match" message and the create-new action still offered, **not** a blank panel.

*Covers FR-006, FR-007.*

## Scenario 5 — Selecting and adding

1. Select a shop. **Expect** the footer to read *"Adding **&lt;name&gt;** as stop N today."* with N = today's stop count **+ 1**, and the button enabled.
2. Before selecting anything, **expect** *"Choose a shop to continue."* and a disabled `#CBD2DD` button.
3. Add the shop.
4. **Expect** to land back on today's list, with the shop present, badged `EX`, chipped **Extra** in violet.
5. **Expect** the header counts to read one more extra (`… planned + N extra`).

*Covers FR-008, FR-009.*

## Scenario 6 — The beat plan is untouched *(the one that matters most)*

1. Before adding, open the Company Admin's beat plan for that executive and note its shops and their order.
2. Add an extra shop as in Scenario 5.
3. Re-open the beat plan.
4. **Expect** it byte-identical — same shops, same order, same name.
5. **Expect** tomorrow's assignment, when it is created, to contain only the planned shops.

```sql
-- the extra stop exists on the day, and only on the day
SELECT s.source, s.added_by_user_id, s.added_at, sh.name
FROM assignment_stops s JOIN shops sh ON sh.id = s.shop_id
WHERE s.source <> 'PLAN';

-- the plan has not grown
SELECT COUNT(*) FROM beat_plan_shops WHERE beat_plan_id = '<id>';
```

*Covers FR-010, SC-004, BUS-16.*

## Scenario 7 — A shop cannot be added twice *(the concurrency one)*

1. Add a shop. Confirm it is on the list.
2. Re-open the picker. **Expect** that shop no longer offered.
3. Now force the race — bypass the picker and hit the endpoint directly, twice at once, with **different** idempotency keys:

```bash
TOK=…  ASSIGN=…  SHOP=…
for i in 1 2 3 4 5 6 7 8; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    "http://localhost:3000/api/v1/assignments/$ASSIGN/stops" \
    -H "Authorization: Bearer $TOK" \
    -H "Idempotency-Key: $(uuidgen)" \
    -H 'Content-Type: application/json' \
    -d "{\"shopId\":\"$SHOP\"}" &
done; wait
```

4. **Expect** exactly one `201` and seven `409 SHOP_ALREADY_IN_BEAT`.
5. **Expect** exactly one row:

```sql
SELECT COUNT(*) FROM assignment_stops WHERE assignment_id = '<id>' AND shop_id = '<id>';
```

*Covers FR-011, SC-005, SC-006. This is the database constraint doing the work, not application code.*

## Scenario 8 — Exactly once under retry

1. Add a shop with a fixed `Idempotency-Key`, then repeat the **same** request with the **same** key.
2. **Expect** the second to replay the first response, not a `409`, and still exactly one row.
3. Repeat with the same key but a different `shopId`. **Expect** `409 IDEMPOTENCY_KEY_REUSED`.

*Covers FR-012.*

## Scenario 9 — Visiting the extra stop

1. Tap the extra stop on today's list.
2. **Expect** the visit screen (board 1.7) if the shop's pin is approved, or the capture screen (board 1.8) if not — the same routing a planned stop gets.
3. Record an order.
4. **Expect** it to submit normally and the stop to go `COMPLETED`.
5. **Expect** the server to have measured it like any other visit:

```sql
SELECT v.distance_meters, v.is_exceed_range, v.review_status, v.flags, s.source
FROM visits v JOIN assignment_stops s ON s.id = v.stop_id
WHERE s.source = 'EXEC_EXTRA';
```

6. **Expect** nothing on any executive screen to have shown a distance, a range verdict or a flag.

*Covers FR-014, SC-008, SC-007.*

## Scenario 10 — Creating a shop from the field

1. Tap *"Shop not listed — create new"*.
2. **Expect** the shop form with the current position already filled in.
3. Save.
4. **Expect** the shop created **and** on today's list as an extra stop, without having to find it again.
5. **Expect** no shop code to have been typed.
6. Check the admin's shop directory. **Expect** the shop present and identifiable as awaiting confirmation.

```sql
SELECT name, shop_code, location_status, location_source, location_captured_by
FROM shops ORDER BY created_at DESC LIMIT 1;
```

7. **Expect** `location_source = 'GPS'` and `location_captured_by` = the executive.

*Covers FR-016, FR-017, FR-018.*

## Scenario 11 — Offline

1. Put the device in aeroplane mode **while the picker is already open and populated**.
2. Select a shop and add it.
3. **Expect** the add accepted and shown as waiting to sync — **not** an error.
4. Force-quit and reopen the app. **Expect** it still waiting.
5. **Expect** the stop not yet openable — it is waiting, not a stop.
6. Restore the connection.
7. **Expect** it to sync, appear on today's list as `EX`/Extra, and then be openable.
8. **Expect** exactly one row — no duplicate from the retry.
9. Now open the picker *while offline*. **Expect** to be told plainly there is no connection, **not** an empty list.

*Covers FR-023, FR-024, SC-011.*

## Scenario 12 — Degradation without a position

1. Revoke location permission (or disable location) and open the picker.
2. **Expect** the screen still usable: the list present, ordered by name, **no** distances, and search working.
3. **Expect** adding to still work.

*Covers the spec's "a poor or missing position degrades the screen rather than blocking it".*

## Scenario 13 — The state machine refuses the rest

With the beat **not started**, and again with it **ended**, call the endpoint directly:

```bash
curl -s -X POST "http://localhost:3000/api/v1/assignments/$ASSIGN/stops" \
  -H "Authorization: Bearer $TOK" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d "{\"shopId\":\"$SHOP\"}"
```

**Expect** `409 BEAT_NOT_STARTED` and `409 BEAT_DAY_ENDED` respectively.

Then confirm the guards that protect the boundary:

- Another executive's `assignmentId` → **404**, never 403.
- A Company Admin's token → **403 FORBIDDEN_ROLE**.
- A body carrying `effectiveRadiusMeters`, `shopLatitude`, `sequence` or `source` → **400**, not a silent strip. *(This is the hole found live in slice 006; `.strict()` is what closes it.)*
- `GET /shops/nearby?excludeAssignment=<another executive's>` → **404**.

*Covers FR-002, FR-022, SC-009.*

## Scenario 14 — The plan-less day

1. Pick a weekday the executive's beat plan does **not** cover (or deactivate the plan).
2. Open today's screen.
3. **Expect** the no-beat card still explaining *why* the day is empty.
4. **Expect** the beat to be startable anyway.
5. Start it, add an extra shop, record an outcome.
6. **Expect** a day consisting only of extra stops, with `beat_plan_id` null:

```sql
SELECT id, beat_plan_id, beat_plan_name, status FROM daily_assignments
ORDER BY created_at DESC LIMIT 1;
```

*Covers PRD FR-ASSIGN-10, and the one behavioural change this slice makes to slice 005.*

## Scenario 15 — Nothing left to add

1. Add every eligible shop, or test in a company whose shops are all on today's list.
2. **Expect** an explicit empty state, **not** a blank white panel, with create-new still offered.

*Covers FR-007.*

---

## Before calling the slice done

- [ ] All 15 scenarios walked on a physical device.
- [ ] Scenarios 6, 7 and 11 are the ones that must not be skipped — the beat-plan guarantee, the concurrency guarantee and the offline guarantee. Each is a promise the product makes that nothing else in the system double-checks.
- [ ] `docs/openapi.json` regenerated to include both new routes.
- [ ] Confirmed that the request logger redacts `lat` / `lng` **query** parameters, not only body fields — this is the first endpoint to take a position in the query string (Constitution rule 9).

## A note on `autoApproveExecPins`

Scenario 10 assumes it is **on**. With it off, an executive can create a shop and then be unable to record anything there, because an outcome requires an `APPROVED` location — the same dead-end slice 006 flagged for pin capture, now reachable by a second route. That is correct behaviour for the setting, not a bug in this feature, but it makes for a poor first run. **The pilot company should have it enabled.**
