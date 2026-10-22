# Quickstart: The Company Admin's Visits

**Feature**: `011-admin-visits` | **Date**: 2026-10-22

The verification path for this feature. There are no automated tests (CLAUDE.md's standing policy), so this document **is** the test suite.

Contracts are in [`contracts/admin-visits.md`](./contracts/admin-visits.md); field-level rules are in [`data-model.md`](./data-model.md). Neither is repeated here.

**Two scenarios here are not about this feature's screens at all** — Scenario 7 (the executive's side) and Scenario 8 (the manager's side). They are the two ways this slice could have broken something that already worked, and they are marked *do not skip* for that reason.

## Prerequisites

```bash
pnpm dev
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:8081 tcp:8081 && adb reverse --list
```

**No migration to run** — this slice ships none. If `prisma migrate deploy` has anything to apply, it is from an earlier slice.

Data needed:

- **A Company Admin account.**
- **A Manager account**, for Scenarios 6 and 8.
- **A Marketing Executive account with recorded visits**, for Scenario 7.
- A completed day with **at least two executives** and a mix of orders and no-orders.
- **At least two out-of-range visits — one an order, one a no-order.** Scenario 5 is meaningless without both.
- **More than ten visits in total**, or Scenario 3's paging check proves nothing.
- **An undelivered order**, reachable by both the admin and the manager, for Scenario 6.
- **A shop with three or more previous no-order visits** for the last-five list.

> **Known limitations, not defects — both inherited from `010` by sharing its implementation.**
> 1. **The date / "All executives" / "All beats" chips on board 4.2 are not implemented.** Only the four tabs are. Expect them to be absent; this is recorded in the spec as a divergence, not a pass.
> 2. **The previous/next order arrows on board 4.3 render disabled.** Also inherited.
>
> One more, inherited from `006`: the dev build's `GOOGLE_MAPS_API_KEY` is empty, so **map tiles on board 4.5 render blank**. Judge the layout, the pin positions, the ring and the numbers; do not judge the tiles.

---

## US1 — The list

### Scenario 1 — The tab finally goes somewhere

1. Sign in as the **Company Admin**.
2. Tap **Visits** in the bottom bar.
3. **Expect** the visits list — **not** the "coming in a later update" alert.
4. **Expect** the bottom bar to be the **admin's four** items — Home · Visits · Beats · Shops — with **Visits** current.
5. Tap **Visits** again while it is open. **Expect** nothing to happen — no second copy of the screen pushed.
6. Go to Home, Shops, Beats, Users and Profile in turn, and tap Visits from each. **Expect** the list from every one of them.

*Covers FR-001, FR-002, FR-004.*

### Scenario 2 — The board, side by side

Compare against board **4.2**: the subtitle **"Company-wide visit history"** above the "Visits" title, the four-tab segmented control with its counts, the row layout — outcome badge, shop, executive, time, summary, delivery or no-order chip, distance — and the admin's bottom bar.

Then compare the same screen against board **3.3** as the Manager sees it. **Expect exactly two differences: the subtitle and the bottom bar.** Anything else that differs is a bug in the sharing, not a styling choice.

**Expect** no visible difference from 4.2, apart from the two known limitations above. *Covers FR-013, FR-032, FR-033.*

### Scenario 3 — Tabs, counts and paging

1. Note each tab's count on **All**.
2. Switch to **Order**. **Expect** only order visits, and the list restarted from the newest.
3. Switch to **No order**, then **Out of range**. **Expect** the right subset each time, and **Out of range to contain both orders and no-orders** — it is a measurement flag, not a third outcome.
4. On **All**, count the loaded rows. **Expect** exactly **ten** (or all of them, if fewer).
5. Scroll to the end. **Expect** the next ten to **append**, with the rows above not moving and no visit appearing twice.
6. Scroll fast enough to fire the end-reached handler twice. **Expect one** page appended, not two.
7. Scroll a tab to the very end and count. **Expect** the total to equal that tab's count.
8. Find a tab with no matches. **Expect** a plain "no visits match these filters" message, not an empty panel.

*Covers FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012; SC-004, SC-005.*

---

## US2 — The details

### Scenario 4 — Each kind of visit opens its own board

1. From the **Order** tab, open an order visit. **Expect** board **4.3**: the delivery status card, the order lines with brand and quantity, the total, and the visit facts — executive, beat, sample shown, location verdict.
2. From the **No order** tab, open a no-order visit. **Expect** board **4.4**: the reason given, the sample and location chips, and the **last five** no-order reasons at that shop, newest first. With fewer than five, expect what exists rather than padding.
3. From the **Out of range** tab, open a visit. **Expect** board **4.5**: the map with the shop pin, the radius ring and the submission point, the measured distance against the allowed radius, the accuracy and the submission time — **read-only**, with no action to accept, reverse or request a revisit.
4. From each, use the back control. **Expect** to return to the list, **on the tab you left**.

*Covers FR-014, FR-015, FR-016, FR-019, FR-028.*

### Scenario 5 — The tab decides the screen, not the visit *(do not skip)*

The one rule a reviewer is most likely to read as a bug.

1. Find an **out-of-range order**.
2. Open it from the **Out of range** tab. **Expect** board 4.5 — the read-only range screen.
3. Go back, switch to the **Order** tab, and open the **same visit**. **Expect** board 4.3 — the order detail, **with Mark as delivered available**.

**Both are correct.** An out-of-range order is still an order and must stay markable; the server returns one shape for all three screens and the client picks by the tab (FR-017).

*Covers FR-017.*

---

## US3 — Delivery

### Scenario 6 — Marking delivered, and the race

1. As the **Company Admin**, open an undelivered order (board 4.3) and use **Mark as delivered**.
2. **Expect** the status card to change to delivered, naming **the admin** and a time.
3. Reopen it. **Expect** delivered, and **no** way to mark it again.
4. Sign in as the **Manager** and open the same order. **Expect** it delivered and attributed to **the admin** — not to a manager, not to "unknown". *(This is the check the `managerId` → `actorId` rename exists for.)*
5. **The race.** Open the same undelivered order as the admin and as a manager at once, and mark it from both.
   - **Expect** one to succeed and the other to be refused plainly with "this order has already been marked delivered".
   - **Expect** the first marker's name and time to stand, unchanged.
6. Inspect the audit trail. **Expect** `order.delivered` recorded against the actor who actually marked it.

*Covers FR-020, FR-021, FR-022, FR-023; SC-006, SC-007.*

---

## Cross-cutting

### Scenario 7 — The executive's side is untouched *(do not skip)*

This slice widens the role gate on two routes that carry `distanceMeters` and `isExceedRange`. This is the check that it widened nothing else.

1. Sign in as a **Marketing Executive**.
2. Open **My visits**. **Expect** the history to load — a `403` here means `GET /visits/:id` has been declared before `GET /visits/mine` in the controller and is swallowing it.
3. Read the response body for `GET /visits/mine` (network inspector or API log). **Expect its key set to be exactly what it was before this slice** — and specifically **no** `distanceMeters`, **no** `isExceedRange`, **no** `flags`, **no** `reviewStatus`.
4. Open any visit detail the executive can reach. **Expect** no distance, no range verdict, no quality flag anywhere on screen.
5. Call `GET /visits` with the executive's token. **Expect `403`.**

*Covers FR-025, FR-026; SC-008.*

### Scenario 8 — The manager's own screens still work *(do not skip)*

The visits list was **extracted** from `ManagerVisitsScreen`, not copied. The manager's board is the one at risk from that.

1. Sign in as the **Manager** and open **Visits** (board 3.3).
2. **Expect** the subtitle **"Visit history · all executives"** and the **manager's three-item** bottom bar — Reports · Visits · Attendance.
3. Run Scenario 3's tab, count and paging checks again here. **Expect** identical behaviour.
4. From the previous-day report, tap a count tile. **Expect** the visits list to open **already on that tab** — the preset-tab path through the shared component.
5. Open one visit of each kind. **Expect** boards 3.4, 3.5 and 3.6 exactly as before.

*Covers FR-033; SC-010.*

### Scenario 9 — Offline

1. With the list loaded, turn off the network and pull to refresh. **Expect** the rows already on screen to **stay**, with a visible note that they are not fresh — not an empty list, not zeroes.
2. Scroll to the end while offline. **Expect** the pages already appended to stay, and a retry offered for the one that failed.
3. Open the app offline with nothing loaded. **Expect** to be told there is no connection.
4. Mark an order delivered offline. **Expect** to be told plainly rather than shown a success that did not happen. Reconnect and confirm **one** delivery was recorded, not two.

*Covers FR-030, FR-031.*

### Scenario 10 — Tenant isolation

1. As the Company Admin of company A, call `GET /visits/:id` with a visit id belonging to company B. **Expect `404`**, never the visit.
2. Call `POST /orders/:id/deliver` with company B's order id. **Expect `404`**, and confirm nothing was written.
3. Confirm no monetary value appears anywhere on boards 4.2–4.5.

*Covers FR-003, FR-029; SC-009.*

---

## Before calling the slice done

- [ ] Boards 4.2–4.5 compared side by side with the design file, and the **only** divergences are the two inherited limitations recorded at the top of this document.
- [ ] Boards 3.3–3.6 compared again after the extraction, and unchanged.
- [ ] The executive's `GET /visits/mine` key set re-checked by eye (Scenario 7.3), not assumed.
- [ ] `tsc --noEmit` clean in `apps/api` and `apps/mobile`.
- [ ] No "coming in a later update" alert left on the admin's bottom bar.
- [ ] `git diff` touches **no** file under `prisma/`, `packages/shared/`, or `my-visits.service.ts`.
