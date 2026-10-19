# Quickstart: Visit Outcomes

Manual validation guide — no automated tests exist for this app yet (CLAUDE.md standing policy).

## Prerequisites

- API and Postgres running with both new migrations applied (`DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy` — the app role cannot create tables and `migrate dev` cannot build its shadow database here).
- A company with: a Marketing Executive who can sign in, an active beat plan assigned to them covering today, **several brands and several reasons** (including the system "Other"), and at least three shops on the plan — **one with an approved pin, one with no pin at all**, and one with prior visit history.
- The executive's **beat started** — no outcome can be recorded otherwise.
- **A native rebuild** (`pnpm --filter mobile android`) — this slice adds a storage module.
- For the device to reach the API over USB: `adb reverse tcp:3000 tcp:3000`.
- **Known limitation**: the dev build's `GOOGLE_MAPS_API_KEY` is empty, so Scenario 4's map tiles will be blank. Everything else on that screen works. Set a key if you want to verify the map visually.

## Scenario 1 — The visit screen and the shop's history

1. From today's list, tap a shop that has an approved pin and prior visits.
2. **Expected**: the visit screen opens showing the shop's code, name, address, owner and a working call action, plus "Stop N of M". The **last five** completed interactions are listed newest first — each with date, outcome, a summary (order lines or the reason) and who recorded it.
3. Check a shop with fewer than five prior visits, and one with none.
4. **Expected**: only the ones that exist; an explicit empty state for none — never placeholder rows.
5. Read the whole screen carefully.
6. **Expected**: **no visit radius anywhere** (FR-019), and no distance, range verdict or flag in any history row (FR-020).
7. Try to choose an outcome without answering "Sample shown?".
8. **Expected**: blocked until answered. Then exactly two outcomes are offered.

## Scenario 2 — Record an order

1. Tap **Order**. Add a brand and set a quantity with the stepper, then another with the keypad.
2. **Expected**: only **active** brands are offered, in the admin's display order. The brand count and total quantity update live.
3. Try to add the same brand twice.
4. **Expected**: rejected as a duplicate — no second line for that brand.
5. Set every line to zero and try to continue.
6. **Expected**: rejected — at least one line must exceed zero.
7. Build a valid three-brand order and continue.
8. **Expected**: the confirm sheet shows the outcome summary and sample-shown answer, and warns the visit cannot be edited — and shows **no location, no accuracy, no capture time** (FR-018).
9. Submit.
10. **Expected**: straight back to today's list with the stop marked completed, and **no distance or range result shown anywhere**.

## Scenario 3 — Record a no-order

1. On another shop, tap **No order**.
2. **Expected**: only **active** reasons, in display order, with **"Other" last**. Single-select.
3. Select "Other" and try to continue without typing.
4. **Expected**: rejected — text required, 3–280 characters.
5. Select a different reason.
6. **Expected**: no text required.
7. Submit.
8. **Expected**: back to today's list, stop completed.

## Scenario 4 — Capture a missing shop pin

1. From today's list, tap the shop with **no pin**.
2. **Expected**: you land on the capture screen, **not** the outcome path, with a prominent notice to stand at the entrance and save the pin first.
3. **Expected**: a map with a draggable marker, an accuracy ring and address search. *(Tiles blank without a Maps key — see Prerequisites.)*
4. Check the accuracy reading and verdict.
5. **Expected**: a number plus a plain verdict. With accuracy worse than the company maximum, **Save is disabled** with guidance and a working Retry.
6. Save at acceptable accuracy.
7. **Expected with auto-approve ON**: straight to the visit screen; an outcome can now be recorded.
8. **Expected with auto-approve OFF**: told the location needs approval first; the stop stays pending and no outcome can be recorded.
9. Re-open a shop whose pin is already approved and try to move it.
10. **Expected**: not possible — only a correction request.

## Scenario 5 — One outcome per stop

1. Submit an outcome for a stop, then try to record a second on the same stop.
2. **Expected**: refused, saying it is already recorded.
3. From two devices signed in as the same executive, submit for the same stop at the same moment.
4. **Expected**: exactly one visit exists. Confirm in the database.

## Scenario 6 — Offline: the heart of this slice

1. Put the device in **airplane mode**.
2. Record and submit a full order.
3. **Expected**: accepted and shown as **waiting to sync** — not an error, not discarded.
4. Record a no-order at another shop too.
5. **Force-close the app completely and reopen it.**
6. **Expected**: both are still waiting — nothing lost to a restart (FR-036).
7. **Expected**: the executive can see how many are waiting (FR-039).
8. Try to log out.
9. **Expected**: warned, and the session is kept (FR-041).
10. Turn airplane mode off and bring the app to the foreground.
11. **Expected**: both sync, **in the order recorded**, and the waiting count drops to zero. Both stops show completed.
12. In the database, confirm both visits carry the **`OFFLINE_SUBMISSION`** flag.

## Scenario 7 — Submitting exactly once

1. With the API stopped mid-submission (or the network cut just after sending), let the app retry.
2. Restart the API and let the queue sync.
3. **Expected**: **exactly one** visit and one order — never two. Confirm the count in the database.
4. Double-tap Submit on a fast connection.
5. **Expected**: one visit.

## Scenario 8 — The server owns the measurement

1. Submit a visit from a position **well outside** the shop's radius (move the pin, or use a mock position).
2. **Expected on the device**: nothing unusual — it submits normally, with no warning, no distance and no verdict (FR-025).
3. In the database, inspect that visit.
4. **Expected**: `distanceMeters` populated, `isExceedRange = true`, `EXCEED_RANGE` in `flags`, `reviewStatus = PENDING_REVIEW`.
5. Submit with a deliberately stale or low-accuracy position.
6. **Expected**: accepted, with `STALE_LOCATION` / `LOW_ACCURACY` flagged — never blocked.
7. Attempt a submission with `distanceMeters` or `isExceedRange` in the request body (via curl).
8. **Expected**: rejected as a validation failure — not silently ignored.

## Scenario 9 — Recorded facts never change

1. Note a submitted order's recorded brand names and the visit's distance.
2. As the Company Admin: rename a brand used on it, retire a reason used on another visit, change the company's default radius, and have a manager move the shop's pin.
3. Re-read the original visit and order in the database.
4. **Expected**: identical — brand labels, reason label, distance, radius and the measured-against coordinate all unchanged (FR-026, SC-010).

## Scenario 10 — Offline visits are measured as of when they were recorded

1. Go offline and record an outcome at a shop.
2. While it is still queued, have a manager approve a change to that shop's pin.
3. Reconnect and let it sync.
4. **Expected**: the visit is measured against the coordinate frozen on the stop **before** the change, not the new one (research.md §4).

## Scenario 11 — Guard rails

1. End the beat, then try to submit a queued or new visit.
2. **Expected**: refused with a clear explanation — a closed day gains no visits.
3. Deactivate a brand in the admin app, then submit an order using it from a screen opened beforehand.
4. **Expected**: rejected on submission, not silently accepted.
5. As a second executive, try to open or submit against the first executive's stop.
6. **Expected**: not found — never another executive's data.

## Scenario 12 — UI fidelity spot-check

1. Decode boards 1.7, 1.8, 2.1, 2.2 and 2.3 (recipe in CLAUDE.md) and compare each side by side with the running app at the same device width.
2. Compare: the visit screen's header, pin chip, history rows and sample-shown control; the capture screen's banner, accuracy chip and disabled save state; the order screen's line rows, brand picker, stepper and live totals; the no-order reason list with "Other" last; and the confirm sheet.
3. **Expected**: no visible difference **except** the two agreed removals — the confirm sheet's location block and the visit screen's "Visit radius" line (FR-018, FR-019, FR-043). Any other mismatch is a bug.

## Scenario 13 — No coordinates in the logs

1. Submit a visit and capture a pin, then search the API logs for the coordinates used.
2. **Expected**: zero matches — redacted at any nesting depth, along with `reasonText`.

## Scenario 14 — Permission disclosure

1. On a fresh install, trigger the location permission prompt.
2. **Expected**: the rationale mentions that location is saved when **recording visits**, not only when starting and ending the beat (FR-021) — since the submission screens deliberately say nothing about it.
