# Quickstart: Executive Dashboard — Today's Beat

Manual validation guide — no automated tests exist for this app yet (CLAUDE.md standing policy). Run through this after implementation.

## Prerequisites

- API and Postgres running with both new migrations applied (`DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy` — the app role cannot create tables, and `migrate dev` cannot build its shadow database in this environment).
- A company with: a **Marketing Executive** user who can sign in, an **active beat plan assigned to that executive** whose working days include today, and several shops on that plan — at least one **with** an approved location pin and at least one **without**, so both row states are exercised.
- A second executive in the same company with their own plan, for the isolation check.
- **A native rebuild is required** — `pnpm --filter mobile android`. This slice adds a native geolocation module and two manifest permissions, so a Metro reload is not enough, unlike every prior slice.
- A device or emulator with location enabled. On an emulator, set a mock position before starting.

## Scenario 1 — The executive finally has a screen

1. Sign in as the Marketing Executive.
2. **Expected**: you land on **Today's beat**, not the old "coming soon" placeholder. The header shows today's date, a greeting with your first name, a refresh control and the avatar menu. A three-tab bar sits at the bottom: Today, My visits, My totals — with Today active and the other two clearly marked as not yet available.

## Scenario 2 — Today's route appears on first open

1. Confirm in the database that no route row exists for this executive and today's date, then open the screen.
2. **Expected**: the blue card shows the beat plan's name, the total stop count and a "Not started" tag; every shop on the plan is listed in sequence. A row for a shop with a pin reads "Pin saved"; one without reads "No pin yet — capture first". Every row's history chip reads "First visit" (no visits exist yet).
3. Close and reopen the app, then pull to refresh.
4. **Expected**: the same single route — **no duplicate row** is created for the day.

## Scenario 3 — The locked state before starting

1. With the beat not started, tap any shop row.
2. **Expected**: nothing opens. A strip reads "Start the beat to record visits and add extra shops." There is no "Add extra shop" action.

## Scenario 4 — Start the beat

1. Tap **Start beat** on a fresh install.
2. **Expected**: the app asks for location permission, explaining why. Grant it.
3. **Expected**: the card switches to the running state — progress as completed-of-total, counts for Pending / Completed / Revisit / Extra, a start time, an elapsed timer that ticks, and a strip naming the shop nearest to where you started. The locked strip is gone.
4. Background the app for a minute and return.
5. **Expected**: still running, with the elapsed time correct — not reset.
6. Tap **Start beat** twice in quick succession (reinstall and repeat if needed to reach the button).
7. **Expected**: exactly one beat day; the second tap is harmless and never shows an error.

## Scenario 5 — Starting without a location

1. Deny location permission (or disable location on the device) and tap **Start beat**.
2. **Expected**: the beat does **not** start, and you are told plainly that a location is required, with a way to retry. The screen stays in the not-started state.
3. Re-enable location, retry.
4. **Expected**: it starts normally.
5. Set the emulator to a deliberately poor-accuracy fix and start.
6. **Expected**: the start **succeeds** — poor accuracy is recorded, never blocking.

## Scenario 6 — To do / Done / All

1. With the beat running, read the three tabs.
2. **Expected**: each carries a live count, and To do + Done = All. Since no visits exist yet, Done is 0 and To do equals All.
3. Switch between all three.
4. **Expected**: the correct subset each time; an empty tab shows an empty state rather than an error.

## Scenario 7 — End the beat

1. With stops still pending, tap **End beat**.
2. **Expected**: a confirmation appears **inline in the same card** — not a new screen — showing the end time, saying how many stops are pending, naming them, and warning they will be recorded as not visited.
3. Choose **Keep going**.
4. **Expected**: the day is still running; nothing was recorded.
5. Tap **End beat** again and confirm.
6. **Expected**: the card becomes the dark closed-day summary — start → end times, total duration, a "Closed" tag, and totals for Visited / Orders / No order / Not visited. Orders and No order read 0 (no visit recording yet); Not visited matches the pending count.
7. Tap any row; look for an "Add extra shop" action.
8. **Expected**: nothing is actionable, and a strip reads "Beat ended for today. Your list starts again tomorrow morning."
9. Leave the app and return.
10. **Expected**: still closed — the day does not reopen.

## Scenario 8 — The route is a frozen snapshot

1. With today's route already created, sign in as a Company Admin and change the beat plan: rename it, reorder its shops, add one and remove one.
2. Return to the executive and refresh Today.
3. **Expected**: today's route is **unchanged** — same name on the card, same stops, same order. The edits apply to tomorrow's route, not today's.

## Scenario 9 — Isolation

1. Sign in as the second executive in the same company.
2. **Expected**: their own route only — never the first executive's stops, counts or beat day, under any tab or refresh.

## Scenario 10 — Degrading without a connection

1. With the day loaded, turn off the network and pull to refresh.
2. **Expected**: the already-loaded day stays on screen and you are told the refresh failed — stale data is never silently presented as fresh.
3. Still offline, try to start (or end) the beat.
4. **Expected**: it fails with a clear message and does **not** appear to have succeeded. Per plan.md's Complexity Tracking, start and end are deliberately **not** queued offline in this slice.

## Scenario 11 — No beat today

1. Sign in as an executive whose plan's working days exclude today.
2. **Expected**: the screen says today is not a working day on their plan — not an empty list, not an error.
3. Sign in as an executive with no active beat plan at all.
4. **Expected**: the screen says they have no beat plan — a different message from the one above (FR-008).

## Scenario 12 — Business date, not device date

1. With a route loaded, change the **device's** timezone or clock to a date where it would be "tomorrow" while the company's timezone is still today.
2. Refresh.
3. **Expected**: the same route — the business date follows the company's timezone, never the device.

## Scenario 13 — UI fidelity spot-check

1. Decode board 1.3 from `docs/ui-design/Field_Sales_Beat_App.html` (the recipe is in CLAUDE.md; its uuid is `20463df0-5cdd-44a1-bce2-f24ff89bf4c6`, titled "Today's beat") and switch its state enum through **not started → running → ending → ended**, comparing each side by side with the running app at the same device width.
2. Compare: the blue card and its "Not started" chip; the white Start beat button with its play glyph; the running card's progress bar colours and four-column counts; the light-blue running strip with its dot, elapsed time and End beat button; the amber inline confirmation with its warning triangle and its two buttons; the dark closed card with its "Closed" chip; the three filter tabs; each row's sequence badge, status chip, pin chip and history chip; and the three-item bottom bar.
3. **Expected**: no visible difference (SC-003). Any mismatch is a bug against FR-024, not "close enough".

## Scenario 14 — No coordinates in the logs

1. Start and end a beat, then search the API logs for the latitude and longitude you used.
2. **Expected**: zero matches — coordinates are redacted (FR-026, Constitution rule 9).
