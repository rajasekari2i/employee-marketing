# Feature Specification: My Visits — Executive

**Feature Branch**: `008-my-visits`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "In marketting executive home page we have button 'My visits'. while clicking that button we need to show the list of previous visit based on the data. it should be server side paginated, first we need to show 10 visistes while scrolling down we need to fetch next 10 visist and show. Visit based on the every day as per the design. We have filter in the top of my visists order visists and no order visists. my visits page schould looke like (section-1.5 My visits). Very important UI should looks exactly same like the docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what I have recorded, grouped by day (Priority: P1)

An executive finishes a stop, or starts a new day, and wants to see what they have already recorded. They tap **My visits** in the bottom bar and the screen opens on their own history, newest first, with each business day as its own block: a day heading, a one-line summary of how that day went, and a row per visit showing the shop, what the outcome was, and the time it was recorded. Ten visits load straight away; scrolling to the bottom brings the next ten, and so on, without the executive doing anything but scroll.

**Why this priority**: This is the feature. Everything else on this screen narrows or re-slices this list, and without it the executive has no way at all to look back at their own work — the app records visits and then shows them nothing.

**Independent Test**: Record several visits across two or more business days, open My visits, and confirm each day appears as its own block with the right rows in the right order; then scroll past the tenth row and confirm older visits appear without a visible reload of what was already on screen.

**Acceptance Scenarios**:

1. **Given** an executive with recorded visits, **When** they tap My visits, **Then** the screen opens showing their own visits only, newest first, grouped under a heading per business day.
2. **Given** the list has opened, **When** the executive counts the rows, **Then** exactly ten visits have been loaded (or all of them, if there are fewer than ten).
3. **Given** the executive scrolls to the end of the loaded rows, **When** more visits exist, **Then** the next ten are fetched and appended below, and the rows already on screen do not move or reload.
4. **Given** a visit that recorded an order, **When** its row is shown, **Then** it carries the order mark and a summary of how many brands and what total quantity were ordered.
5. **Given** a visit that recorded a no-order, **When** its row is shown, **Then** it carries the no-order mark and the reason that was given.
6. **Given** a day heading, **When** it is shown, **Then** it reads as the business day it covers — today's day reads as "Today" alongside its date — and is followed by that day's count of orders and no-orders.
7. **Given** a business day whose visits span two fetched pages, **When** the second page arrives, **Then** that day appears **once**, with all of its visits under the single heading — never as two blocks with the same heading.
8. **Given** an executive with no recorded visits at all, **When** the screen opens, **Then** they are told so plainly rather than shown an empty panel.

---

### User Story 2 - Look at only orders, or only no-orders (Priority: P1)

The executive wants to see just the shops that ordered, or just the ones that did not and why. Three tabs at the top of the screen — All, Order, No order — each carrying its own count, switch the list between them.

**Why this priority**: The filter is drawn into the screen's header on the design and is named in the product requirements as part of what this screen *is*, not an addition to it. A visit history an executive cannot slice by outcome fails the main reason they open it — finding the no-orders they need to follow up.

**Independent Test**: With a mix of orders and no-orders recorded, switch to Order and confirm only order visits are listed, switch to No order and confirm only no-order visits are listed, and confirm each tab's count matches the number of visits that tab would show across the whole history, not just the loaded page.

**Acceptance Scenarios**:

1. **Given** the All tab is selected, **When** the list is shown, **Then** both orders and no-orders appear, interleaved in time order within each day.
2. **Given** the Order tab is selected, **When** the list is shown, **Then** only order visits appear, still grouped by day, and a day with no orders does not appear at all.
3. **Given** the No order tab is selected, **When** the list is shown, **Then** only no-order visits appear, with their reasons.
4. **Given** any tab is selected, **When** the executive reads the tab labels, **Then** each shows the total number of visits it covers **across the whole history being viewed**, not the number currently loaded.
5. **Given** the executive has scrolled deep into one tab, **When** they switch tabs, **Then** the new tab starts from its own newest visits rather than resuming at the previous tab's scroll depth.
6. **Given** a tab with no matching visits, **When** it is selected, **Then** the executive is told that tab is empty rather than shown a blank screen.

---

### User Story 3 - Keep reading when the connection is poor (Priority: P2)

The executive opens My visits in a shop basement or on a dead signal. Rather than a blank screen or a spinner that never ends, they see what was last loaded with an honest note that it is not fresh, and scrolling for more tells them plainly that it cannot be fetched right now.

**Why this priority**: The field app assumes a bad network, and this is the first executive **read** screen with more than one page. It is P2 rather than P1 because the executive can still do their job without it — the list simply fails to load — but a history screen that goes blank on a weak signal is the kind of thing that makes a field app feel broken.

**Independent Test**: Load the list, drop the connection, and confirm the loaded visits stay on screen with a visible note; then scroll for more and confirm the failure is explained rather than silent; then restore the connection and confirm the list recovers.

**Acceptance Scenarios**:

1. **Given** the list has loaded and the connection then drops, **When** the executive pulls to refresh, **Then** the visits already on screen stay there and a visible note says they are showing what was last loaded.
2. **Given** no connection and nothing previously loaded, **When** the screen opens, **Then** the executive is told there is no connection, not shown an empty history.
3. **Given** the executive scrolls for more while offline, **When** the fetch fails, **Then** they are told the next page could not be loaded and can retry, and nothing already on screen is lost.
4. **Given** a visit is recorded while offline and is still waiting to sync, **When** the executive opens My visits, **Then** the screen accounts for it — it is not silently missing from the day's rows with no explanation.

---

### Edge Cases

- **A business day with visits but none matching the selected tab.** The day does not appear at all; it does not appear as an empty block with a heading and no rows.
- **Several visits at the same shop on the same day** (a manager-granted revisit). Each is its own row, in time order, under that day.
- **A visit recorded on a day whose beat was never started**, or on an extra-shop-only day. It still appears under that business day exactly like any other visit.
- **A visit recorded offline and synced days later.** It appears under **the business day it was recorded for**, not the day it reached the server — the day a visit belongs to is settled when it is recorded, not when it arrives.
- **The device clock is wrong.** The day a visit is grouped under never moves, because the business day comes from the record, not the phone.
- **A brand or a reason was renamed or retired after the visit.** The row still reads what was recorded at the time, not the current master data.
- **The executive scrolls to the very end of their history.** Loading stops cleanly and the screen says there is nothing older, rather than spinning forever or re-fetching the last page.
- **Two fetches are triggered by one fast scroll.** Exactly one page is appended; a visit never appears twice in the list.
- **A visit is recorded while the list is open.** Pulling to refresh brings it in; the list does not have to silently reorder itself underneath the executive's finger.
- **A deactivated executive's history.** Not reachable — they cannot sign in — and nothing is deleted.
- **A very long shop name.** The row keeps its shape; the name is shortened rather than wrapping the row.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the screen

- **FR-001**: The executive MUST be able to open My visits from the **My visits** item in the bottom bar, from any of their screens that shows it. That item MUST stop reporting that the screen is coming later.
- **FR-002**: The screen MUST show the signed-in executive's **own** visits and nothing else. No executive may see another's history through this screen, by any means.

#### What the list shows

- **FR-003**: Visits MUST be grouped by **business day**, newest day first, and newest visit first within a day — matching UI design reference section 1.5.
- **FR-004**: Each day MUST carry a heading naming the day, with today's day distinguished as "Today", and a summary of that day's orders and no-orders.
- **FR-005**: Each visit row MUST show the shop's name, a mark identifying the outcome as an order or a no-order, a one-line summary of the outcome, and the time it was recorded. For an order the summary MUST state how many brands and what total quantity; for a no-order it MUST state the reason given.
- **FR-006**: The labels shown for brands and reasons MUST be the ones recorded with the visit, so a later rename or retirement in the masters never rewrites what the history says.
- **FR-007**: The day a visit is grouped under MUST be the business day the visit was recorded for, derived from the record rather than from any timestamp the device supplied, so a slow sync or a wrong device clock can never move a visit to a different day.

#### Paging

- **FR-008**: The list MUST be paged by the server. The screen MUST NOT fetch the executive's whole history to display part of it.
- **FR-009**: The first fetch MUST return **10** visits. Reaching the end of the loaded rows MUST fetch the next **10** and append them, and so on until there are no more.
- **FR-010**: Appending a page MUST NOT disturb what is already on screen — no jump, no re-order, no visible reload of rows the executive is reading.
- **FR-011**: A day that spans a page boundary MUST render as **one** day block, not two blocks with the same heading.
- **FR-012**: The same visit MUST NOT appear twice, including when two fetches are triggered in quick succession, and including when a new visit is recorded between two fetches.
- **FR-013**: When there is nothing older to load, the screen MUST stop fetching and say so, rather than retrying or spinning.

#### Filtering

- **FR-014**: Three tabs — **All**, **Order**, **No order** — MUST filter the list, matching UI design reference section 1.5.
- **FR-015**: Each tab MUST show the number of visits it covers **across the whole history being viewed**, not the number currently loaded — so the counts do not grow as the executive scrolls.
- **FR-016**: Changing the tab MUST restart the list from that tab's newest visits.
- **FR-017**: Filtering MUST be applied by the server, so a page of ten is ten *matching* visits rather than ten visits of which some are hidden.
- **FR-018**: When a tab has no visits, the executive MUST be told so explicitly rather than shown a blank panel.

#### Date range

- **FR-019**: The screen MUST show the date-range control the design draws in its header, reading the range currently in view.
- **FR-020**: The range in view on opening MUST be **all of the executive's history**, newest first, and the control MUST read that range. *(Decided with the user on 2026-10-20 — see Assumptions. This is a recorded departure from the product requirements' "last 7 days" default, taken so that paging back through previous visits is actually exercised.)*
- **FR-021**: The control MUST offer a small set of preset ranges — all history, the last 7 days, and the last 30 days — and changing it MUST restart the list and recompute the tab counts for the new range.

#### What an executive is never shown

- **FR-022**: No screen or response in this feature MAY carry a visit's measured distance, its range verdict, its quality flags, its review status, the radius it was measured against, or the shop's coordinates. This MUST be enforced structurally — those values must never be put into the response — not by hiding them in the screen.
- **FR-023**: The executive's own captured position MUST NOT be shown or returned either. This screen is a record of what was done, not of where the phone was.

#### Working without a connection

- **FR-024**: This screen is a read, and reads are never queued. When a fetch fails because there is no connection, anything already loaded MUST stay on screen with a visible note that it is not fresh; when nothing has loaded, the executive MUST be told there is no connection rather than shown an empty history.
- **FR-025**: A failed request for the next page MUST be reported and retryable, and MUST NOT discard what is already loaded.
- **FR-026**: A visit still waiting to sync MUST NOT appear as a history row — the server owns what history is, and a row the executive could act on before the server has it would be a lie. Instead the screen MUST show how many of the executive's submissions are waiting, so the difference between "I recorded nothing that day" and "that visit has not reached the server yet" is always visible. *(Decided with the user on 2026-10-20. This strip is the **one agreed addition** to board 1.5 — see Assumptions.)*
- **FR-026a**: That strip MUST use the treatment board 1.3 already draws for the same purpose, placed below the tab group, and MUST be absent entirely when nothing is waiting — so the screen matches its board exactly in the ordinary case.

#### Fidelity

- **FR-027**: Every element of this screen MUST visually match its board in `docs/ui-design/Field_Sales_Beat_App.html` — section 1.5 — exactly in colors, spacing, typography, icon shapes, border radii and layout, with no approximated placeholders. This includes the header and its date-range control, the three-tab group, the day headings and their summaries, the visit rows and their outcome marks, and the bottom bar. **There is exactly one agreed addition** — the waiting-to-sync strip of FR-026a, which is absent whenever nothing is waiting. Any other difference from the board is a defect.
- **FR-028**: Loading more, refreshing, and every empty or offline state MUST be expressed within that layout rather than replacing it with a different screen.

### Key Entities

- **Visit (referenced, never written)**: a recorded outcome at a shop — which shop, order or no-order, what was ordered or why not, who recorded it, when, and the business day it belongs to. This feature only reads them.
- **Day group**: one business day's worth of an executive's visits, with the day it covers and its count of orders and no-orders. It exists only as a way of presenting the list.
- **Visit summary row**: what the executive is shown per visit — shop name, outcome, a one-line summary, and the time. Deliberately narrower than the manager's view of the same visit, which carries the measurement and the flags.
- **Page**: one server-returned slice of the filtered history, with a way to ask for the next one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An executive can go from any of their screens to seeing their most recent visits in under 3 seconds on a normal connection.
- **SC-002**: The first screenful never costs more than 10 visits' worth of data, however long the executive's history is.
- **SC-003**: An executive with 1,000 recorded visits can scroll back through a month of history without the screen slowing noticeably or running out of memory.
- **SC-004**: The screen delivered is visually indistinguishable from its board in the UI design reference, verified side by side. Exactly **one** difference is permitted — the waiting-to-sync strip (FR-026a), which is absent whenever nothing is waiting, so with an empty queue the comparison must show zero differences.
- **SC-005**: In 100% of cases, every visit the executive recorded appears exactly once in the All tab — zero duplicates and zero omissions — including across page boundaries and after a refresh.
- **SC-006**: 100% of day groups show a count of orders and no-orders that matches the rows beneath them.
- **SC-007**: Zero screens or responses in this feature expose a measured distance, a range verdict, a quality flag, a review status, a radius or a coordinate to an executive.
- **SC-008**: Zero cross-executive leakage: an executive can only ever retrieve their own visits, including by a direct request to the server.
- **SC-009**: Every tab's count equals the number of rows that tab yields when scrolled to the end, for 100% of ranges tested.
- **SC-010**: With the connection removed, zero already-loaded visits disappear from the screen, and the executive is always told why nothing new arrived.
- **SC-011**: Zero visits are silently missing: for 100% of submissions still waiting to sync, the screen shows that something is waiting rather than presenting the history as complete.

## Assumptions

### Decisions taken with the user (2026-10-20)

Both were put to the user before the spec was finalised, because in each case the
product requirements, the design and the user's own instruction pointed different
ways, and choosing silently would have changed what gets built.

- **The screen opens on all history, not the documented last 7 days.** The product
  requirements say "a date-range control defaults to the last 7 days" (FR-MY-02)
  and the design draws the control reading exactly that. The user asked for this
  screen to page back through *previous visits*, ten at a time — which a 7-day
  window would largely defeat, since most executives would reach the end within
  one or two pages. The user chose all history. FR-021 keeps "Last 7 days" as a
  preset, so nothing FR-MY-02 describes is lost; what changes is which range the
  screen opens on. **This is a deliberate, recorded departure from FR-MY-02's
  default**, and reversing it is a one-line change to FR-020.

- **A queued visit is shown as a waiting count, not as a row.** This screen is a
  read, and reads are never queued, so a visit held in the device's outbox is not
  in the server's history and cannot be paged. Board 1.5 draws nothing for the
  case. The user chose the strip board 1.3 already uses, below the tabs, present
  only when something is waiting. **This is the single agreed divergence from
  board 1.5** — recorded here rather than discovered during review, because this
  feature's fidelity requirement is otherwise absolute.
- **The design draws a date-range control but no picker.** There is no board anywhere in the design for choosing a date range. Rather than invent a screen, FR-021 keeps the choice to a small preset list presented in place. A full custom range picker is out of scope.
- **`Visit` carries no business-day of its own.** The day a visit belongs to is settled by the day's assignment record, which is derived from the company's timezone and not from any device clock. FR-007 states this as a requirement because getting it wrong is invisible until an offline visit syncs across midnight and lands under the wrong day.
- **The time shown on a row is when the executive recorded the visit, not when the server received it.** For a visit synced hours later these differ, and the one the executive recognises is the time they were standing in the shop. The day grouping is unaffected either way (see FR-007), so a wrong device clock can make the time-of-day label odd but can never move the visit.

### Scope boundaries

- **My totals (design section 1.6) is out of scope.** It is its own screen with its own board, its own period switcher and its own aggregates. The bottom-bar item for it stays as it is.
- **The manager's and admin's visits list (sections 3.3 and 4.2) is out of scope**, along with everything it carries that an executive must never see — the out-of-range tab, the distance, the flags and the review actions.
- **Opening a visit to see its detail is out of scope.** The design gives the executive no detail screen for their own visit; the three detail boards (3.4–3.6) are the manager's. Rows on this screen are a record, not a door.
- **Editing or deleting a visit is out of scope and will stay so.** A submitted visit cannot be edited, which the confirm step already warns about.
- **Caching history for offline browsing is out of scope.** FR-024 keeps what was loaded in this session on screen; it does not promise that history survives the app being closed and reopened with no signal.
- **Filtering by shop, by beat or by free text is out of scope.** The design offers three outcome tabs and a date range, and nothing else.

### Reasonable defaults

- A page is ten visits because the user asked for ten; the screen asks for the next page as the executive nears the end of what is loaded, rather than waiting for them to hit the exact bottom, so the next rows are usually there before they are needed.
- Pull-to-refresh restarts the list from the newest visit, matching the behaviour today's beat screen already has.
- A day with no matching visits under the selected tab is omitted entirely, because the design's day heading exists to introduce rows and a heading with nothing under it reads as a fault.
- Rows within a day run newest first, consistent with the days themselves running newest first.
- The counts on the tabs describe the range currently in view, not all history, so that changing the range changes the counts to match what scrolling would actually produce.
