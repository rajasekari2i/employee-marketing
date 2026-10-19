# Feature Specification: My Totals — Executive

**Feature Branch**: `009-my-totals`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "In marketting executive home page we have button 'My Totals'. while clicking that button we need to show the report page as per the UI (section-1.6 My totals) Today, This week, This month. It show orders count, no order count, total qty. Quantity by brand, orders per day . this week. highlite the current day. Very important UI should looks exactly same like the docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See how I am doing, for a period I choose (Priority: P1)

An executive wants to know where they stand — today, this week, or this month. They tap **My totals** in the bottom bar and the screen opens on their own figures: how much of the beat they have completed, as a percentage and as "visited of assigned", and three plain counts — orders, no-orders and total quantity. Three tabs switch the period, and **everything on the screen recalculates** for the period chosen.

**Why this priority**: This is the feature. The other two sections break those same numbers down; without the headline figures and the period switcher there is nothing to break down, and the executive has no way to see their own performance at all.

**Independent Test**: Record a known mix of orders and no-orders today, open My totals, and confirm the completion percentage, the visited/assigned line and the three counts match what was recorded; then switch to This week and This month and confirm every figure changes to that period's numbers.

**Acceptance Scenarios**:

1. **Given** an executive with visits recorded, **When** they tap My totals, **Then** the screen opens showing their own figures only, for the default period.
2. **Given** the screen is open, **When** the executive reads the header, **Then** it names the period in view in plain words — a date for today, a date span for the week, a month and year for the month.
3. **Given** a period is selected, **When** the completion card is read, **Then** it shows a percentage, a progress bar filled to that percentage, and a line reading how many of the period's assigned shops were visited.
4. **Given** a period is selected, **When** the three tiles are read, **Then** they show the count of orders, the count of no-orders, and the total quantity ordered across the period.
5. **Given** the executive switches tab, **When** the new period loads, **Then** every figure on the screen — the completion card, all three tiles, and both sections below — recalculates for that period.
6. **Given** a period in which the executive was assigned nothing, **When** the completion card is read, **Then** it says so plainly rather than showing a meaningless percentage or a division error.
7. **Given** an executive who has recorded nothing at all, **When** the screen opens, **Then** they are told so plainly rather than shown a screen of zeroes with no explanation.

---

### User Story 2 - See what I am actually selling (Priority: P2)

The executive wants to know which products are moving. A "Quantity by brand" section lists the brands they sold in the period with the quantity for each, and a bar whose length compares that brand against the strongest one, so the ranking is readable at a glance.

**Why this priority**: It is the question an executive asks second, after "how am I doing" — and it is the only place in their app that tells them. It is P2 rather than P1 because the screen is already useful without it, but the board shows it and the screen is not complete until it is there.

**Independent Test**: Record orders across two or more brands with different quantities, open My totals, and confirm each brand appears with the right quantity, ordered strongest first, with the longest bar on the largest quantity.

**Acceptance Scenarios**:

1. **Given** orders recorded across several brands, **When** the section is read, **Then** each brand appears with its total quantity for the period.
2. **Given** several brands, **When** the bars are compared, **Then** the longest belongs to the largest quantity and the others are proportional to it.
3. **Given** brands are listed, **When** their order is read, **Then** they run largest quantity first.
4. **Given** a brand that was renamed or retired after the orders were recorded, **When** the section is read, **Then** it shows the name that was recorded at the time.
5. **Given** a period with no orders at all, **When** the section is read, **Then** it says there is nothing to show rather than rendering an empty card.

---

### User Story 3 - See the shape of my week (Priority: P2)

The executive wants to see which days are strong and which are weak. A small chart shows how many orders they recorded on each day of the current week, with today's bar picked out so they can see where they are in the week.

**Why this priority**: It answers "am I behind?" at a glance, which no other screen does. P2 for the same reason as the brand section — the screen works without it, but the board shows it.

**Independent Test**: Record a different number of orders on two or more days of the current week, open My totals, and confirm each day's bar carries the right count, with the tallest on the busiest day and today's bar visibly distinct from the rest.

**Acceptance Scenarios**:

1. **Given** orders recorded across the week, **When** the chart is read, **Then** each day shows its own count of orders, its bar, and its day name.
2. **Given** the chart is shown, **When** today's column is compared with the others, **Then** it is visibly distinct.
3. **Given** the busiest day of the week, **When** the bars are compared, **Then** it has the tallest bar and the others are proportional to it.
4. **Given** a day with no orders, **When** its column is read, **Then** it shows zero with no bar rather than being omitted, so the week's shape stays readable.
5. **Given** the executive switches period, **When** the chart is read, **Then** it still shows **the current week** — this one section does not follow the period tabs.

---

### Edge Cases

- **No assignment at all in the period** (a new executive, or a holiday week). The completion card cannot divide by zero; it states there was nothing assigned.
- **More visits than assigned shops is impossible**, because an extra shop added during the day becomes a stop on that day and counts in both halves of the ratio.
- **A day the executive did not work.** It contributes nothing to any total and appears as a zero column in the weekly chart.
- **A visit recorded on a day whose beat was never started**, or on an extra-shop-only day. It counts like any other visit, and its day counts in the assigned total.
- **A visit recorded offline and synced later.** It counts towards **the business day it was recorded for**, not the day it reached the server — so yesterday's total can still change after a late sync.
- **A no-order visit.** It counts towards visits and towards completion, and contributes zero quantity.
- **An order whose every line is zero** cannot exist — at least one line must exceed zero — so no brand is listed with a quantity of zero.
- **A brand retired mid-period.** Its quantities still count, under the name recorded with the order.
- **The week spans a month boundary** (for example Mon 28 Sep – Sun 4 Oct). The week is still one week and the header names the span.
- **Today is the first day of the week.** The chart shows the rest of the week as zero columns rather than hiding them.
- **A very large quantity.** It stays readable in the tile and in the brand row rather than overflowing or being truncated.
- **The connection drops.** The figures already on screen stay, with an honest note; a period switch that cannot load says so.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the screen

- **FR-001**: The executive MUST be able to open My totals from the **My totals** item in the bottom bar, from any of their screens that shows it. That item MUST stop reporting that the screen is coming later.
- **FR-002**: The screen MUST show the signed-in executive's **own** figures and nothing else. No executive may see another's totals through this screen, by any means.

#### Choosing a period

- **FR-003**: Three tabs — **Today**, **This week**, **This month** — MUST switch the period, matching UI design reference section 1.6.
- **FR-004**: The header MUST name the period currently in view in plain words: the date for Today, the span for This week, the month and year for This month.
- **FR-005**: Switching period MUST recalculate the completion card, all three tiles and the Quantity by brand section. The weekly chart is the single exception (FR-016).
- **FR-006**: Period boundaries MUST be the company's own calendar days, so an executive whose device is set to another timezone sees the same period as their manager. A week runs **Monday to Sunday**; a month is the calendar month.
- **FR-007**: The period in view when the screen opens MUST be **This week**.

#### The headline figures

- **FR-008**: The completion card MUST show the percentage of the period's assigned shops that were visited, a progress bar filled to that percentage, and a line stating how many of how many were visited.
- **FR-009**: "Assigned" MUST mean every shop on the executive's route for the days in the period, including shops added during a day; "visited" MUST mean those where an outcome was recorded. The percentage therefore can never exceed 100%.
- **FR-010**: When nothing was assigned in the period, the card MUST say so rather than show a percentage.
- **FR-011**: Three tiles MUST show the count of order visits, the count of no-order visits, and the total quantity ordered across the period.
- **FR-012**: Large numbers MUST be shown with thousands separators, as the design does.

#### Quantity by brand

- **FR-013**: The section MUST list the brands ordered in the period with each brand's total quantity, largest first, each with a bar proportional to the largest quantity in the list.
- **FR-014**: Brand names MUST be the ones recorded with the order, so a later rename or retirement never rewrites what the totals say.
- **FR-015**: The section MUST list **every** brand ordered in the period — none is hidden — and MUST scroll when there are more than fit. *(Decided with the user on 2026-10-20; the board draws three rows in a container with no room to grow, so this is one of the slice's two agreed divergences — see Assumptions.)*
- **FR-015a**: Because nothing is hidden, the brand quantities MUST always add up to the Total quantity tile exactly. A discrepancy is a defect, not a consequence of truncation.

#### Orders per day

- **FR-016**: The chart MUST always show **the current week**, whichever period tab is selected — the design labels it "this week" and the product requirements say the same.
- **FR-017**: The chart MUST show one column per day of the current week, each with that day's count of order visits, a bar proportional to the week's busiest day, and the day's name.
- **FR-018**: Today's column MUST be visibly distinct from the others.
- **FR-019**: A day with no orders MUST still appear, as a zero column, so the shape of the week stays readable.
- **FR-020**: The chart MUST cover **Monday to Sunday — seven columns** — so an order recorded on any day of the week is visible in it. *(Decided with the user on 2026-10-20; the board draws six columns labelled Mon–Sat, so this is the slice's second agreed divergence — see Assumptions.)*

#### What an executive is never shown

- **FR-021**: No screen or response in this feature MAY carry a visit's measured distance, its range verdict, its quality flags, its review status, the radius it was measured against, or any coordinate. This MUST be enforced structurally — those values must never be put into the response — not by hiding them in the screen.
- **FR-022**: **Order value MUST NOT be shown.** Release 1 captures quantity only; there is no price and no monetary total anywhere on this screen.
- **FR-023**: The figures MUST describe only the executive's own work. No company, team or peer comparison appears on this screen.

#### Working without a connection

- **FR-024**: This screen is a read, and reads are never queued. When a fetch fails because there is no connection, anything already on screen MUST stay with a visible note that it is not fresh; when nothing has loaded, the executive MUST be told there is no connection rather than shown a screen of zeroes.
- **FR-025**: A visit still waiting to sync has not reached the server and MUST NOT be counted. The screen MUST account for that rather than letting the totals look complete when they are not.

#### Fidelity

- **FR-026**: Every element of this screen MUST visually match its board in `docs/ui-design/Field_Sales_Beat_App.html` — section 1.6 — exactly in colors, spacing, typography, bar shapes, border radii and layout, with no approximated placeholders. This includes the header and its period tabs, the blue completion card and its progress bar, the three tiles, the brand rows and their bars, the weekly chart and its columns, and the bottom bar. **There are exactly two agreed divergences**, both decided with the user and both correctness-driven: the weekly chart has seven columns rather than six (FR-020), and the brand section scrolls rather than being capped at what fits (FR-015). Every colour, radius, font and spacing value in both remains the board's. Any other difference is a defect.
- **FR-027**: Loading, refreshing and every empty or offline state MUST be expressed within that layout rather than replacing it with a different screen.

### Key Entities

- **Period**: the span the screen is describing — one day, one week, or one month of the company's own calendar — with a plain-language name.
- **Completion**: how much of the period's route was covered, as visited, assigned, and the percentage between them.
- **Outcome totals**: the count of orders, the count of no-orders, and the total quantity ordered in the period.
- **Brand total**: one brand's recorded name and its total quantity for the period.
- **Day total**: one day of the current week, its count of order visits, and whether it is today.
- **Visit, Order, Order line, Daily route** *(all referenced, never written)*: the records these figures are computed from. This feature only reads them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An executive can go from any of their screens to seeing their current figures in under 3 seconds on a normal connection.
- **SC-002**: Switching period updates every figure on the screen in under 2 seconds.
- **SC-003**: The screen delivered is visually indistinguishable from its board in the UI design reference, verified side by side, apart from the **two** agreed divergences named in FR-026 — a seventh column in the weekly chart, and a scrolling brand section. Every other difference is a defect.
- **SC-004**: In 100% of cases, the figures reconcile exactly to the underlying records — the order count, the no-order count and the total quantity each match what a direct count of that executive's visits for the period produces.
- **SC-005**: The brand quantities add up to the Total quantity tile **exactly**, for 100% of periods tested — nothing is hidden, so nothing is unaccounted for.
- **SC-006**: The weekly chart's order counts sum to the week's order count when the week period is selected, for 100% of weeks tested.
- **SC-007**: Beat completion never exceeds 100% and is never shown as a percentage when nothing was assigned.
- **SC-008**: Zero screens or responses in this feature expose a measured distance, a range verdict, a quality flag, a review status, a radius, a coordinate, or any monetary value.
- **SC-009**: Zero cross-executive leakage: an executive can only ever retrieve their own totals, including by a direct request to the server.
- **SC-010**: With the connection removed, zero already-loaded figures disappear from the screen, and the executive is always told why nothing new arrived.

## Assumptions

### Decisions taken with the user (2026-10-20)

Both were put to the user before the spec was finalised, because in each case board 1.6 is a static mock whose sample data quietly answers a question real data would reopen. Both answers depart from the board, and both are **correctness-driven rather than aesthetic** — every colour, radius, font and spacing value stays the board's.

- **The weekly chart covers Monday to Sunday — seven columns, not the board's six.** The board draws six bars labelled Mon–Sat and its sample week reads "Mon 28 Sep – Sat 3 Oct", which is coherent for a six-day working week. But nothing in the business or product requirements fixes the week at six days, and `BeatPlan.workingDays` is configurable per plan, so a Sunday working day is representable. With six columns an order recorded on a Sunday would be **counted in the completion card, the tiles and the brand totals while being invisible in the chart** — a silent inconsistency between two halves of one screen, not a design choice. The seventh column makes the bars slightly narrower and changes nothing else.

- **Quantity by brand lists every brand and scrolls.** The board draws three rows in a container with no room to grow. Capping the list would hide brands; letting it overflow would break the layout. Scrolling the section keeps every brand visible, and has the further benefit that the brand quantities now reconcile exactly to the Total quantity tile (FR-015a) rather than being a subset of it. The cost is a scrolling region the board does not draw.

### Conflicts found in the product documentation, and how they are resolved

- **The weekly chart does not follow the period tabs.** FR-MY-04 says the period switcher "recalculates everything shown", while FR-MY-05 and the design both say the chart is "orders per day **for the current week**". The design settles it: the section is titled "Orders per day · this week" and its data does not change with the tab. FR-016 implements the design, and FR-005 is written to name the exception rather than leave the contradiction standing.
- **"Assigned" includes shops added during the day.** The design's line reads "visited of assigned shops", which could be read as the beat plan's shops only. That reading lets the ratio exceed 100% — an executive who visits all twelve planned shops plus two extras would be shown 14 of 12. Counting every stop on the day in both halves keeps the percentage meaningful and matches what today's beat screen already counts.
- **Order value is excluded, and this is settled rather than assumed.** FR-MY-06 and open decision OD-07 both state that release 1 captures quantity only and shows no order value. FR-022 states it as a requirement so it cannot drift back in.

### Scope boundaries

- **My visits (design section 1.5) is out of scope** — it is its own screen and is already built.
- **The manager's and admin's reports are out of scope**, along with everything they carry that an executive must never see: out-of-range counts, distances, flags and per-executive comparisons.
- **Tapping a figure to see what it is made of is out of scope.** The design offers no drill-down from this screen; the numbers are a summary, not a door.
- **Choosing an arbitrary date range is out of scope.** The design offers exactly three periods and no date picker.
- **Exporting or sharing the totals is out of scope.** No board offers it, and the reporting and export work is a later slice.
- **Caching totals for offline viewing is out of scope.** What was loaded in this session stays on screen; the figures are not promised to survive the app being closed and reopened with no signal.
- **Comparing against a target, a quota or a previous period is out of scope.** Nothing in the design or the requirements defines one.

### Reasonable defaults

- The screen opens on **This week**, which is the design's own default state and the period an executive is most often asking about.
- Quantity is a count of units, never a value — consistent with everything else in release 1.
- A brand's bar is measured against the largest brand in the list, not against the period's total, so the comparison stays legible when one brand dominates.
- A day's bar in the weekly chart is measured against the busiest day of that week, for the same reason.
- Totals are recomputed from the records each time rather than being stored, so a late offline sync is reflected the next time the screen is opened.
- Pull-to-refresh reloads the period in view, matching the behaviour today's beat screen already has.
