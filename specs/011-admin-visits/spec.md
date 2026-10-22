# Feature Specification: The Company Admin's Visits

**Feature Branch**: `011-admin-visits`

**Created**: 2026-10-22

**Status**: Implemented — merged as [PR #373](https://github.com/rajasekari2i/employee-marketing/pull/373), commit `6039d11`. Written after the fact; see *Assumptions → How this document came to be written late*.

**Input**: User description: "Company admin visits — the Visits tab on the admin bottom bar (section 4.2 Visits · list + filters) and the three detail boards behind it (4.3 Order visit · mark delivered, 4.4 No-order visit · last 5 reasons, 4.5 Out-of-range visit · distance). Very important UI should look exactly same like docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The Visits tab finally goes somewhere (Priority: P1)

A Company Admin opens the app and taps **Visits** in the bottom bar. Until now that tap raised a "coming in a later update" alert — the only one of the admin's four tabs with no destination. It now opens a list of every visit recorded in the company: an order or no-order badge, the shop, the executive, the time, the outcome summary, a delivery or no-order chip, and the measured distance, marked as out when it exceeded the shop's radius. Four tabs narrow it to All, Order, No order or Out of range. Ten visits load at a time and scrolling brings the next ten.

**Why this priority**: It is the whole feature's entry point and the only screen here that is new. The three detail boards are reached from it and are unreachable without it. It is also the last "coming soon" alert left on the admin's bottom bar.

**Independent Test**: Sign in as a Company Admin, tap Visits, and confirm the list opens on a day with recorded visits; switch each tab and confirm the right subset and count; scroll past the tenth row and confirm the next ten append.

**Acceptance Scenarios**:

1. **Given** a Company Admin is signed in, **When** they tap Visits in the bottom bar, **Then** the company-wide visits list opens — not the "coming in a later update" alert.
2. **Given** the list is open, **When** a row is read, **Then** it shows the outcome badge, the shop, the executive, the time, the outcome summary, the delivery or no-order chip, and the distance.
3. **Given** a visit exceeded its radius, **When** its row is read, **Then** the distance is marked as out and visually distinguished.
4. **Given** a tab is selected, **When** the list reloads, **Then** only matching visits appear and each tab shows its own count.
5. **Given** the list has opened, **When** the rows are counted, **Then** exactly ten have loaded, or all of them if there are fewer.
6. **Given** the admin scrolls to the end of the loaded rows, **When** more visits match, **Then** the next ten append without the rows above moving, and no visit appears twice.
7. **Given** no visit matches the current tab, **When** the list is read, **Then** the admin is told so plainly rather than shown an empty panel.
8. **Given** the list is open, **When** the bottom bar is read, **Then** it is the **admin's** four items — Home · Visits · Beats · Shops — with Visits current, never the manager's three.

---

### User Story 2 - Open a visit and read what was recorded (Priority: P1)

Tapping a row opens the right detail for what it is. An **order** shows its delivery status, the order lines with quantities and a total, and the visit's facts — executive, beat, sample shown, location verdict. A **no-order** shows the reason given, the sample and location chips, and the last five no-order reasons at that shop. An **out-of-range** visit opens read-only on a map showing the shop's pin, its radius ring and the point the submission came from, with the measured distance against the allowed radius.

**Why this priority**: A list of rows a Company Admin cannot open is not a feature. P1 with the list because the two are one workflow — every row leads here, and the boards (4.3–4.5) exist for no other reason.

**Independent Test**: From each tab, open a visit of that kind and confirm the matching board appears with the recorded values; open an out-of-range order from the Order tab and confirm the order detail opens, then the same visit from the Out of range tab and confirm the read-only range detail opens instead.

**Acceptance Scenarios**:

1. **Given** an order visit, **When** it is opened, **Then** the delivery status card, the order lines with quantities, the total, and the visit facts are shown.
2. **Given** a no-order visit, **When** it is opened, **Then** this visit's reason, the sample and location chips, and the last five no-order reasons at that shop appear newest first.
3. **Given** a visit is opened **from the Out of range tab**, **When** it loads, **Then** the read-only range detail opens with the map, the measured distance and the allowed radius — whatever its outcome.
4. **Given** an out-of-range **order** is opened **from the Order tab**, **When** it loads, **Then** the order detail opens, so it can still be marked delivered.
5. **Given** any detail is open, **When** the back control is used, **Then** the admin returns to the list they came from, on the tab they left.
6. **Given** any detail is open, **When** its measurement is read, **Then** it is what the visit was measured against at the time it was recorded, not the shop's current coordinates.

---

### User Story 3 - Mark an order delivered (Priority: P2)

A Company Admin working through yesterday's orders marks one delivered from board 4.3, exactly as a Manager does from 3.4. The order shows as delivered afterwards, recording that it was this admin and when.

**Why this priority**: It is the only write in the feature, and the admin is the second role to have it rather than the first — a Manager has been able to do this since slice 010, so nothing is blocked without it. It is here because board 4.3 is titled "Order visit · **mark delivered**" and ships the action; a read-only copy of that board would not match the design.

**Independent Test**: Mark an undelivered order delivered as a Company Admin, confirm the status changes and records the admin's own name and the server's time, then confirm a Manager opening the same order sees it delivered and cannot mark it again.

**Acceptance Scenarios**:

1. **Given** an undelivered order, **When** the admin uses Mark as delivered, **Then** the status becomes delivered and records who marked it and when.
2. **Given** an order the **admin** marked, **When** anyone opens it, **Then** the attribution names the admin — not a manager, and not "unknown".
3. **Given** an order already delivered, **When** the admin opens it, **Then** it shows as delivered and cannot be marked again.
4. **Given** a Manager marks an order delivered a moment before the admin tries, **When** the admin's attempt reaches the server, **Then** it is refused plainly and the Manager's attribution stands — it is never silently overwritten.

---

### Edge Cases

- **A company with no visits at all**, or a brand-new company. Every tab is empty and says so rather than showing a blank panel.
- **A tab that matches nothing** while others match plenty. The count for that tab reads zero and the list says so explicitly.
- **A visit recorded offline and synced after the list was read.** The figures change the next time the list is opened; nothing is cached that would keep them stale.
- **An out-of-range visit whose shop has since had its pin corrected.** The detail shows what the visit was measured against at the time, not the shop's current coordinates.
- **An order already marked delivered**, including by a Manager a moment earlier. It cannot be marked twice, and the second attempt is reported plainly.
- **An admin and a manager marking the same order at the same instant.** One wins; the other is told the order is already delivered.
- **Scrolling fast enough to fire two page requests at once.** One page is appended, not two, and no row is served twice.
- **Another company's visit id, typed or replayed.** It is not found — never another company's data.
- **An executive who signs in while all this exists.** Their screens are unchanged and still show no distance, no range verdict and no quality flag.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the screens

- **FR-001**: The **Visits** item on the Company Admin's bottom bar MUST open the company-wide visits list. It MUST NOT raise the "coming in a later update" alert.
- **FR-002**: The list and the three details MUST be reachable from every admin screen that carries the bottom bar, and the bar MUST show **Visits** as the current item while the list is open.
- **FR-003**: A Company Admin MUST see only their own company's visits, and MUST NOT be able to reach another company's by any means, including by visit id.
- **FR-004**: The bottom bar on these screens MUST be the **admin's** four items — Home · Visits · Beats · Shops — never the Manager's three.

#### The visits list (board 4.2)

- **FR-005**: The list MUST show every visit in the company, newest first, matching UI design reference section 4.2.
- **FR-006**: Tabs MUST filter **All / Order / No order / Out of range**, each showing its own count for the current filters.
- **FR-007**: Each row MUST show the outcome badge, the shop, the executive, the time, the outcome summary, the delivery or no-order chip, and the distance — marked as out and visually distinguished when the radius was exceeded.
- **FR-008**: The list MUST be paged by the server: **10** visits on opening, and the next **10** when the admin reaches the end of what is loaded, until there are none left.
- **FR-009**: Appending a page MUST NOT disturb the rows already on screen, and no visit MUST ever appear twice.
- **FR-010**: Filtering MUST be applied by the server, so a page of ten is ten *matching* visits.
- **FR-011**: Changing a tab MUST restart the list from the newest matching visit.
- **FR-012**: When nothing matches, the admin MUST be told so explicitly rather than shown an empty panel.
- **FR-013**: The screen's subtitle MUST read **"Company-wide visit history"** — the one line of copy board 4.2 does not share with board 3.3.

#### The visit details (boards 4.3, 4.4, 4.5)

- **FR-014**: An order visit MUST open a detail showing the delivery status, the order lines with brand and quantity, the total quantity, and the visit's facts — executive, beat, sample shown and the location verdict — matching UI design reference section 4.3.
- **FR-015**: A no-order visit MUST open a detail showing the reason given, the sample-shown and location chips, and the **last five** no-order reasons at that shop, newest first, matching UI design reference section 4.4.
- **FR-016**: An out-of-range visit MUST open a **read-only** detail showing a map with the shop's pin, its radius ring and the point the submission came from, the measured distance against the allowed radius, the outcome's own detail, and the location accuracy and submission time — matching UI design reference section 4.5.
- **FR-017**: Which detail opens MUST be decided by the **tab the admin came from**, not by the visit's outcome: from Out of range, always the range detail; from Order or No order, that outcome's detail. An out-of-range order MUST therefore still be reachable as an order, so it can be marked delivered.
- **FR-018**: Every detail MUST show what the visit was measured against **at the time it was recorded**, so a later correction to the shop's location never rewrites it.
- **FR-019**: Leaving a detail MUST return the admin to the list they came from, on the tab they left.

#### Delivery

- **FR-020**: An undelivered order MUST offer **Mark as delivered** to a Company Admin, which records who marked it and when, and afterwards shows as delivered.
- **FR-021**: Who marked it MUST be taken from the authenticated session and when from the server's clock. Neither MUST be accepted from the device.
- **FR-022**: An order already delivered MUST NOT be markable again, by anyone. A second attempt MUST be reported plainly rather than overwriting who marked it first — including when the first marker was a Manager and the second a Company Admin, or the reverse.
- **FR-023**: The recorded marker MUST read back as whichever role actually marked it. A delivery marked by an admin MUST NOT be attributed to a manager, or to no one.

#### What an admin may see — and what an executive still may not

- **FR-024**: A Company Admin **MAY** see what an executive may not: the measured distance, whether the radius was exceeded, the quality flags and the review status. These screens exist to surface exactly those, and they MUST be shown. *(The product's capability matrix already grants the Company Admin read on "Distance and range flags".)*
- **FR-025**: Nothing in this feature MAY expose any of that to an **executive**. The executive's own history screens MUST be unchanged by this work, and the rule that an executive is never shown a measured distance, a range verdict or a quality flag MUST remain unbroken.
- **FR-026**: Widening the manager's routes to the Company Admin MUST NOT widen the executive's. The executive's own history MUST remain a **separate route backed by a separate projection**, so neither can acquire the other's fields by a refactor of one.
- **FR-027**: A Company Admin MUST NOT be able to change what was recorded about a visit. Marking an order delivered is the only write in this feature, and it alters no outcome, no measurement and no flag.
- **FR-028**: Adjudicating a flagged visit — accepting an exception or requesting a revisit — MUST remain unavailable to the Company Admin in this feature. The range detail is read-only.
- **FR-029**: No monetary value MUST appear anywhere in this feature — order value is not captured in release 1.

#### Working without a connection

- **FR-030**: These screens are reads. When a fetch fails, anything already on screen MUST stay with a visible note that it is not fresh; when nothing has loaded, the admin MUST be told there is no connection rather than shown zeroes or an empty list.
- **FR-031**: Marking an order delivered is a command and MUST NOT be silently lost. A repeat of it MUST NOT create a second record or a second attribution.

#### Fidelity

- **FR-032**: Every screen in this feature MUST visually match its board in `docs/ui-design/Field_Sales_Beat_App.html` — sections 4.2 through 4.5 — exactly in colors, spacing, typography, icon shapes, border radii and layout, with no approximated placeholders.
- **FR-033**: Where a board here is identical to its Manager twin, the two MUST be **one implementation**, not two copies. A copy is a second place for the boards to drift apart, which is what the fidelity rule forbids.
- **FR-034**: Loading, refreshing and every empty or offline state MUST be expressed within those layouts rather than replacing them with a different screen.

### Key Entities

- **Visit** *(referenced; nothing about it is written)*: a recorded outcome, with — for an admin as for a manager — the measurement, the verdict and the flags the executive never sees.
- **Order and order line** *(referenced; delivery status written)*: what was ordered, and whether it has been delivered, by whom and when.
- **Delivery marker** *(written)*: the user who marked an order delivered — now either a Manager or a Company Admin, recorded as whichever it was.

**No new entity, and no schema change.** This feature introduces no table, no column and no enum; see [data-model.md](./data-model.md).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Company Admin can go from the home screen to any recorded visit's detail in **three taps or fewer** (Visits → tab → row).
- **SC-002**: Zero "coming in a later update" alerts remain on the Company Admin's bottom bar.
- **SC-003**: Every screen delivered is visually indistinguishable from its board in the UI design reference, verified side by side, with zero undocumented divergences.
- **SC-004**: Each tab's count equals the number of rows that tab yields when scrolled to the end, for 100% of tab combinations tested.
- **SC-005**: 100% of visits appear exactly once across a full scroll — zero duplicates and zero omissions — including across page boundaries.
- **SC-006**: Zero orders can be marked delivered twice, including by an admin and a manager at once, and the recorded marker is never overwritten.
- **SC-007**: 100% of deliveries marked by a Company Admin read back attributed to that admin.
- **SC-008**: Zero executives can see a measured distance, a range verdict or a quality flag as a result of this work — the executive's own history returns the **same key set** it returned before it.
- **SC-009**: Zero screens in this feature expose another company's data, or any monetary value.
- **SC-010**: Boards 4.2–4.5 and their Manager twins 3.3–3.6 are served by **one implementation each**; zero duplicated screen components exist between them.

## Assumptions

### How this document came to be written late

This slice was built and merged before its specification was written — the reverse of the Spec Kit order every slice from `001` to `010` followed. The user asked for the spec docs immediately afterwards, and this set was written against the merged code and the design boards rather than ahead of them.

That is worth stating rather than hiding, because it changes what these documents are evidence of. **Every requirement below was checked against what shipped**, and the two places where the implementation does not meet its board are recorded as divergences rather than quietly dropped from the requirements (see *Known divergences*). Where a prior slice's spec would be a plan, this one is a plan and a record at once.

### Decisions taken while building

- **One route for two roles, not two routes.** `GET /visits` could have been duplicated as an admin-only path. It was not, because the service behind it scopes by company alone — there has never been a manager-level filter in it — so both roles ask the identical question of identical rows. A second route would be the same query written twice, and two places for the company scope to be got wrong. The role gate is widened instead; the architecture's own API table (`03-ARCHITECTURE.md:829-833`) already marks all three routes "Manager, Admin", so this is the slice that delivers the half `010-manager-app` deferred.

- **One component for two boards, imported across role folders.** `AdminVisitsScreen` imports the list body from `features/manager/`, which looks like a layering smell and was chosen deliberately. Decoding boards 3.3 and 4.2 shows they differ in exactly two places — the subtitle and the bottom bar — so a copy in `features/admin/` would be a second place for them to drift. Both differences are passed in as props. The same reasoning registers the Manager's three **detail** components a second time in the admin stack rather than copying them: boards 4.4 and 4.5 decode **byte-identical** to 3.5 and 3.6, and 4.3 differs from 3.4 only in one name in the sample data.

- **The admin gets the action on board 4.3, not a read-only copy of it.** The board is titled "Order visit · mark delivered" and carries the button in both its states. The product's capability matrix grants the Company Admin `U` on "Order delivery status" independently. Shipping the board without its action would have diverged from the design to enforce a restriction the product does not ask for.

### Conflicts found in the product documentation, and how they are resolved

- **`010-manager-app`'s contract said these routes were `@Roles('MANAGER')` "in this slice", and named this one as where the Company Admin is added.** It was explicit about it: *"The architecture marks several 'Manager, Admin'; the Company Admin's mirror screens (4.2–4.5) are a later feature and the role is added then."* That is this feature, and it is why no decision had to be revisited to widen the gate.

- **"Out of range" is a property of the measurement, not a third outcome.** A visit is an order or a no-order; exceeding the radius is a flag on top. That is why the Out-of-range tab contains both kinds, and why FR-017 routes by the tab the admin came from rather than by the visit's outcome. Unchanged from `010`; restated because board 4.2 inherits it whole.

- **The product requirements describe board 4.2 as "four filter tabs" (PRD §4) while the board itself also shows a date, an executive and a beat chip.** The board wins on what must be built; the PRD line is a summary, not a narrowing. The chips were not built — see *Known divergences* — and this is the gap the two documents between them make easy to miss.

### Known divergences from the boards — inherited, not introduced

Both were inherited verbatim from `010-manager-app` by sharing its implementation, which is the point of sharing it: fixing either fixes both boards at once.

- **The date / "All executives" / "All beats" filter chips on board 4.2 are not implemented.** Only the four tabs are. The chips are present on boards 3.3 and 4.2 alike and were never built in `010`; `GET /visits` already accepts `date`, `executiveId` and `beatPlanId`, so the gap is entirely in the screen. **This is a real divergence from FR-032**, recorded rather than waived, and is the most visible thing a side-by-side review of board 4.2 will find.

- **The previous/next order arrows on board 4.3 render disabled.** `010` built them that way on 3.4 on the record — the detail route opens one visit at a time and does not carry the filtered set through — and board 4.3 inherits it.

### Shipped in the same commit, but not part of this feature

The merged commit also moved the app's Android runtime permissions into one module and added a launch-time ask for location and camera, and fixed the camera **Take photo** buttons on the shop form and the profile screen, which did nothing when the permission had not been granted. None of that is specified here: it belongs to no slice, touches no board in 4.2–4.5, and is recorded in the commit message and in [research.md §7](./research.md) so it is not mistaken for part of this feature's scope.

### Scope boundaries

- **Reviewing or reversing a visit is out of scope.** `POST /visits/:id/review` stays Manager-only; the Company Admin's range detail is read-only (FR-028).
- **Board 4.1's other tiles and the rest of the admin app are out of scope** — this feature adds one destination to an existing bottom bar and changes nothing else on it.
- **Attendance, salary, reports and CSV export are out of scope**, including the Company Admin's own report screens.
- **The previous-day report for a Company Admin is out of scope** — the architecture marks `/reports/previous-day` "Manager, Admin", but no admin board shows it and no admin screen reaches it.
- **Filtering by date, executive or beat is out of scope as built** — the API supports it, the screen does not (see *Known divergences*).
- **No schema change, no migration, no new error code.** Everything this feature needs already exists.
- **Caching any of these screens for offline use is out of scope.** What was loaded in a session stays on screen; nothing is promised to survive the app closing.

### Reasonable defaults

- The list orders newest first, consistent with every other list in the product.
- A page is ten visits, matching the manager's list and the executive's own history.
- Day boundaries and "today" are the company's, never the device's.
- The admin's Visits tab, while the list is open, is inert rather than re-entrant — tapping the current tab does nothing rather than pushing a second copy of the screen.
