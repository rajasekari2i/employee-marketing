# Feature Specification: The Manager App

**Feature Branch**: `010-manager-app`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "Manager login dashboard creation based on the UI (section-3.1 Manager · Previous-day report) … visits page (3.3) with filters and server-side pagination … order visit (3.4) with mark delivered … no-order visit (3.5) with last 5 reasons … out-of-range visit (3.6) with the map and distance … add extra shop to today (3.2) … attendance day sheet (3.7) and session edit (3.8). Very important UI should look exactly same like docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See yesterday at a glance (Priority: P1)

A manager starts the morning wanting to know how yesterday went and what needs chasing. They sign in and land on the previous-day report: six counts — assigned, visited, pending, order, no-order, out of range — a bar showing what proportion of visits were within range, and a list of the out-of-range visits with the shop, who recorded it, the flag and the distance. Filters let them change the date, narrow to one executive, or narrow to one beat.

**Why this priority**: This is the manager's reason to open the app. It is also the first screen any manager has ever had — until this feature they sign in and are told their screens are coming later. Nothing else here is reachable without it.

**Independent Test**: With a day of recorded visits, open the report and confirm every count matches the records, the within-range bar's proportions match the counts, and the out-of-range list contains exactly the flagged visits.

**Acceptance Scenarios**:

1. **Given** a manager signs in, **When** the app opens, **Then** they land on the previous-day report, defaulted to the previous business day and all beats.
2. **Given** the report is open, **When** the counts are read, **Then** assigned, visited, pending, order, no-order and out-of-range each match the day's records.
3. **Given** the report is open, **When** the within-range bar is read, **Then** it shows within, exceeded and not-visited as proportions with a legend and a percentage.
4. **Given** visits were flagged out of range, **When** the out-of-range section is read, **Then** each shows the shop, who recorded it, the flag and the measured distance.
5. **Given** the date, executive or beat filter is changed, **When** the report reloads, **Then** every count, the bar and the out-of-range list all recalculate.
6. **Given** a day on which nothing was recorded, **When** the report is read, **Then** it says so plainly rather than showing a bar with no proportions.
7. **Given** the report is open, **When** a count tile is tapped, **Then** the visits list opens already filtered to that count.

---

### User Story 2 - Work through the visits (Priority: P1)

The manager wants the detail behind the numbers. From "See all visits", a count tile, or the bottom bar, they reach a list of every visit: an order or no-order badge, the shop, the executive, the time, the outcome summary, a delivery or no-order chip, and the distance — marked as out when it exceeded the radius. Tabs narrow it to All, Order, No order or Out of range, and a date, an executive and a beat filter narrow it further. Ten visits load at a time, and scrolling brings the next ten.

**Why this priority**: The report says *how many*; this says *which*. A manager cannot act on a count. It is P1 with the report because the two are one workflow — every tile on the report leads here.

**Independent Test**: With a mixed day recorded, open the list, confirm the rows match the records, switch each tab and confirm the right subset appears with the right counts, then scroll past the tenth row and confirm the next ten append.

**Acceptance Scenarios**:

1. **Given** the list is open, **When** a row is read, **Then** it shows the outcome badge, shop, executive, time, summary, the delivery or no-order chip, and the distance.
2. **Given** a visit exceeded its radius, **When** its row is read, **Then** the distance is marked as out and visually distinguished.
3. **Given** a tab is selected, **When** the list reloads, **Then** only matching visits appear and each tab shows its own count.
4. **Given** an executive filter is set, **When** the list reloads, **Then** only that executive's visits appear; "All executives" restores the rest.
5. **Given** a beat filter is set, **When** the list reloads, **Then** only visits on that beat appear.
6. **Given** the list has opened, **When** the executive counts the rows, **Then** exactly ten have loaded, or all of them if there are fewer.
7. **Given** the manager scrolls to the end of the loaded rows, **When** more visits match, **Then** the next ten append without the rows above moving.
8. **Given** no visit matches the current filters, **When** the list is read, **Then** the manager is told so plainly rather than shown an empty panel.

---

### User Story 3 - Open a visit and act on it (Priority: P2)

Tapping a visit opens the right detail for what it is. An **order** shows its delivery status, the order lines with quantities and a total, and the visit's facts — executive, beat, sample shown, location verdict — with a **Mark as delivered** action and arrows to step through orders one at a time. A **no-order** shows the reason given, the sample and location chips, and the last five no-order reasons at that shop, noting when one reason repeats. An **out-of-range** visit opens read-only on a map showing the shop's pin, its radius ring and the point the submission came from, with the measured distance against the allowed radius.

**Why this priority**: Marking deliveries is the manager's other daily job, and the no-order history is what turns a list of refusals into a pattern worth acting on. It is P2 because the report and the list already let a manager *see* yesterday; this is what lets them *finish* it.

**Independent Test**: Open an order visit and mark it delivered, confirming who and when are recorded and the status changes; open a no-order visit at a shop with history and confirm the last five reasons appear newest first; open an out-of-range visit and confirm the map, the distance and the allowed radius.

**Acceptance Scenarios**:

1. **Given** an order visit, **When** it is opened, **Then** the delivery status card, the order lines with quantities, the total, and the visit facts are shown.
2. **Given** an undelivered order, **When** Mark as delivered is used, **Then** the status becomes delivered and records who marked it and when.
3. **Given** a delivered order, **When** it is opened, **Then** it shows as delivered and cannot be marked again.
4. **Given** an order visit, **When** the next or previous arrow is used, **Then** the next or previous order in the current filtered set opens, with its position shown.
5. **Given** a no-order visit, **When** it is opened, **Then** this visit's reason, the sample and location chips, and the last five no-order reasons at that shop appear newest first.
6. **Given** one reason repeats among those five, **When** the detail is read, **Then** the repetition is called out.
7. **Given** a visit is opened from the Out of range tab, **When** it loads, **Then** the read-only range screen opens with the map, the measured distance and the allowed radius — whatever its outcome.
8. **Given** an out-of-range **order** is opened from the Order tab, **When** it loads, **Then** the order detail opens so it can still be marked delivered.

---

### User Story 4 - Keep attendance (Priority: P2)

Each day the manager records who worked. A day sheet lists the eligible people for one business day with a morning and an evening cell each, and summary counts of present, late, absent-or-leave and not-marked. Previous and next move between days; today is marked and future dates cannot be edited. Tapping a cell opens the session editor: one status from Present, Absent, Leave, Holiday or Weekly off; Present requires an arrival time, from which the lateness is derived against the company's session start time. Changing something already recorded requires a reason, shows what was recorded before and by whom, and saves as an amendment that keeps the original.

**Why this priority**: It is the manager's other daily duty and the input payroll depends on — but it is a separate domain from visit review, with its own records, and the app is useful without it.

**Independent Test**: Open the day sheet, mark a morning session Present with a late arrival time and confirm the lateness is derived, then change it with a reason and confirm the original is preserved and the summary counts update.

**Acceptance Scenarios**:

1. **Given** the day sheet is open, **When** it is read, **Then** each eligible person has a morning and an evening cell and the summary counts match the cells.
2. **Given** a session is unmarked, **When** a status is chosen and saved, **Then** the cell shows it and the summary counts update.
3. **Given** Present is chosen, **When** no arrival time is given, **Then** it cannot be saved.
4. **Given** Present is saved with an arrival time, **When** the lateness is read, **Then** it is derived from the company's session start time, not typed by the manager.
5. **Given** a session already has a record, **When** it is edited, **Then** a reason is required, the previous value and who recorded it are shown, and saving keeps the original readable.
6. **Given** a future date, **When** the day sheet is read, **Then** its cells cannot be edited.
7. **Given** any cell, **When** it is read, **Then** its state is given by text as well as colour.
8. **Given** a late arrival, **When** the editor is read, **Then** it states that lateness does not change payable half-days unless a company policy says so.

---

### User Story 5 - Put a shop on someone's day (Priority: P3)

A manager learns a shop needs visiting today. From the report's action bar they open "Add shop to today", choose the executive, see that executive's beat and how far through it they are, search the company's shops, pick one, give a reason, and add it. The executive's beat plan is untouched and no other day changes.

**Why this priority**: It is occasional rather than daily, and the executive can already add their own extra shops. It is here because the report's action bar leads to it and the screen is incomplete without it.

**Independent Test**: Add a shop to an executive's day, confirm it appears as an extra stop on that executive's list with the manager recorded as the adder and the reason in the audit trail, and confirm the beat plan is unchanged.

**Acceptance Scenarios**:

1. **Given** the add screen is open, **When** an executive is chosen, **Then** their beat and their progress through today are shown.
2. **Given** an executive is chosen, **When** the manager searches shops, **Then** matching shops appear, excluding any already on that executive's day today.
3. **Given** a shop is selected and a reason given, **When** it is added, **Then** it becomes an extra stop on that executive's day today, attributed to the manager.
4. **Given** no reason is given, **When** the manager tries to add, **Then** it is refused — the reason is required and is written to the audit trail.
5. **Given** a shop has just been added, **When** the beat plan is inspected, **Then** it is unchanged, and no other day is affected.

---

### Edge Cases

- **A manager with no executives**, or a day before any beat plan existed. Every count is zero and the screens say so rather than showing empty bars and blank panels.
- **A day with assigned stops but no visits.** Visited is zero, pending equals assigned, and the within-range bar is entirely "not visited".
- **An executive who never started the beat**, or whose day was auto-closed overnight. The report marks it rather than silently counting it as zero.
- **A visit recorded offline and synced after the report was read.** The figures change the next time the report is opened; nothing is stored that would keep them stale.
- **An out-of-range visit whose shop has since had its pin corrected.** The detail shows what the visit was measured against at the time, not the shop's current coordinates.
- **An order already marked delivered**, including by another manager a moment earlier. It cannot be marked twice, and the second attempt is reported plainly rather than silently overwriting who marked it.
- **Stepping past the last order** with the next arrow. The arrow is unavailable rather than wrapping around or erroring.
- **A shop with fewer than five previous no-order visits.** The history shows what exists and says so, rather than padding to five.
- **A no-order visit at a shop with no history at all.** The section says this is the first.
- **The same person has two sessions on one day.** Morning and evening are independent; marking one never implies the other.
- **An amendment to an amendment.** Each change keeps the one before it; the history is never collapsed.
- **An employee who joined mid-month**, or was deactivated. They appear only on days they were eligible, and deactivating never deletes past attendance.
- **Two managers editing the same session at once.** One wins; the other is told the record changed rather than silently overwriting it.
- **Adding an extra shop to an executive whose beat has not started, or has ended.** The same rules apply as for the executive's own additions.
- **A filter combination that matches nothing.** Each screen says so explicitly.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the manager app

- **FR-001**: A user whose role is Manager MUST land on the previous-day report when they sign in. They MUST no longer be told their screens are coming in a later update.
- **FR-002**: The app MUST provide the manager's bottom bar — **Reports · Visits · Attendance** — on every manager screen that the design shows it on.
- **FR-003**: The manager MUST reach their profile from the account menu, exactly as other roles do.
- **FR-004**: A manager MUST see only their own company's data, and MUST NOT be able to reach any other company's by any means.

#### The previous-day report

- **FR-005**: The report MUST default to the **previous business day**, all beats and all executives, matching UI design reference section 3.1.
- **FR-006**: It MUST show six counts — assigned, visited, pending, order, no-order and out of range — for the selected day and filters.
- **FR-007**: Each count MUST open the visits list already narrowed to what it counted.
- **FR-008**: A within-range bar MUST show within, exceeded and not-visited as proportions, with a legend and the within-range percentage.
- **FR-009**: An out-of-range section MUST list the flagged visits with shop, who recorded it, the flag and the measured distance, each opening its detail.
- **FR-010**: Filters MUST cover date, executive and beat, and changing any MUST recalculate every figure on the screen.
- **FR-011**: The report MUST show each executive's beat start and end times, and MUST mark a day that was auto-closed or never started.
- **FR-012**: An action bar MUST open "Add shop to today", labelled so it is clear the change is to one executive, today only, and that the beat plan is unchanged.

#### The visits list

- **FR-013**: The list MUST be reachable from "See all visits", from any count tile, and from the bottom bar, matching UI design reference section 3.3.
- **FR-014**: Tabs MUST filter **All / Order / No order / Out of range**, each showing its own count for the current filters.
- **FR-015**: Date, executive and beat filters MUST apply alongside the tabs, with "All executives" and "All beats" as the unfiltered choices.
- **FR-016**: Each row MUST show the outcome badge, the shop, the executive, the time, the outcome summary, the delivery or no-order chip, and the distance — marked as out and visually distinguished when the radius was exceeded.
- **FR-017**: The list MUST be paged by the server: **10** visits on opening, and the next **10** when the manager reaches the end of what is loaded, until there are none left.
- **FR-018**: Appending a page MUST NOT disturb the rows already on screen, and no visit MUST ever appear twice.
- **FR-019**: Filtering MUST be applied by the server, so a page of ten is ten *matching* visits.
- **FR-020**: Changing any filter or tab MUST restart the list from the newest matching visit.
- **FR-021**: When nothing matches, the manager MUST be told so explicitly rather than shown an empty panel.

#### Visit details

- **FR-022**: An order visit MUST open a detail showing the delivery status, the order lines with brand and quantity, the total quantity, and the visit's facts — executive, beat, sample shown and the location verdict — matching UI design reference section 3.4.
- **FR-023**: An undelivered order MUST offer **Mark as delivered**, which records who marked it and when, and afterwards shows as delivered.
- **FR-024**: An order already delivered MUST NOT be markable again, and a second attempt MUST be reported plainly rather than overwriting who marked it.
- **FR-025**: Previous and next arrows MUST move one order at a time through the set the manager was looking at, showing the position, and MUST be unavailable at the ends rather than wrapping.
- **FR-026**: A no-order visit MUST open a detail showing the reason given, the sample-shown and location chips, and the **last five** no-order reasons at that shop, newest first, matching UI design reference section 3.5.
- **FR-027**: When one reason repeats among those five, the repetition MUST be called out. When there are fewer than five, the detail MUST show what exists rather than padding.
- **FR-028**: An out-of-range visit MUST open a **read-only** detail showing a map with the shop's pin, its radius ring and the point the submission came from, the measured distance against the allowed radius, the outcome's own detail, and the location accuracy and submission time — matching UI design reference section 3.6.
- **FR-029**: Opening a visit **from the Out of range tab** MUST always show the range detail; opening it from the Order or No-order tab MUST show that outcome's detail, so an out-of-range order can still be marked delivered.
- **FR-030**: Every detail MUST show what the visit was measured against **at the time it was recorded**, so a later correction to the shop's location never rewrites it.

#### Attendance

- **FR-031**: The day sheet MUST list the eligible people for one business day, each with a morning and an evening cell, matching UI design reference section 3.7.
- **FR-032**: Day navigation MUST be previous and next with today marked, and a **future date MUST NOT be editable**.
- **FR-033**: Summary counts MUST show present, late, absent-or-leave and not-marked.
- **FR-034**: Each session MUST take exactly one status from **Present, Absent, Leave, Holiday, Weekly off**, matching UI design reference section 3.8.
- **FR-035**: Present MUST require an arrival time, and the lateness — on time, one hour delay, two hour delay — MUST be **derived by the server** from the company's session start time, never typed or chosen.
- **FR-036**: Exactly one active record MUST exist per person, date and session.
- **FR-037**: Changing an existing record MUST require a reason, MUST show what was recorded before and by whom, and MUST save as an amendment that **keeps the previous value readable**. Nothing is ever overwritten.
- **FR-038**: The editor MUST state that lateness does not change payable half-days unless the company sets a policy.
- **FR-039**: Every cell's state MUST be given by text as well as colour, never by colour alone.
- **FR-040**: The day sheet MUST list **every active member of the company's staff except the System Admin** — Employees, Marketing Executives, Managers and Company Admins alike. *(Decided with the user on 2026-10-20; see Assumptions.)*
- **FR-040a**: A manager therefore appears on their own day sheet and MAY record their own attendance. Every such record is attributed and amendable on the same terms as anyone else's, so a self-recorded entry is never less traceable than one recorded for someone else.

#### Adding a shop to someone's day

- **FR-041**: The screen MUST let the manager choose an executive, and MUST then show that executive's beat for today and how far through it they are, matching UI design reference section 3.2.
- **FR-042**: The manager MUST be able to search the company's shops and pick one, with shops already on that executive's day excluded.
- **FR-043**: A **reason MUST be required**, and MUST be written to the audit trail with the manager and the executive.
- **FR-044**: Adding MUST place the shop on that executive's day only. It MUST NOT modify the beat plan and MUST NOT affect any other day.
- **FR-045**: The same rules that govern an executive's own additions MUST apply — a shop already on the day cannot be added twice, a repeat of the same request adds one stop, and the day must be running.

#### What a manager may see — and what they may not

- **FR-046**: A manager **MAY** see what an executive may not: the measured distance, whether the radius was exceeded, the quality flags and the review status. These screens exist to surface exactly those, and they MUST be shown.
- **FR-047**: Nothing in this feature MAY expose a manager's view of a visit to an **executive**. The executive's existing screens MUST be unchanged by this work, and the rule that an executive is never shown a measured distance, a range verdict or a quality flag MUST remain unbroken.
- **FR-048**: No monetary value MUST appear anywhere in this feature — order value is not captured in release 1.
- **FR-049**: A manager MUST NOT be able to change what was recorded about a visit. Marking an order delivered and amending attendance are the only writes in this feature, and neither alters a visit's outcome, its measurement or its flags.
- **FR-050**: A manager's data scope — for the report, the visits list, attendance and extra-shop additions — MUST be **the whole company**: every executive and every member of staff. *(Decided with the user on 2026-10-20 — a recorded departure from FR-MGR-01's "own team" wording; see Assumptions.)*

#### Working without a connection

- **FR-051**: These screens are reads. When a fetch fails, anything already on screen MUST stay with a visible note that it is not fresh; when nothing has loaded, the manager MUST be told there is no connection rather than shown zeroes or an empty list.
- **FR-052**: Marking an order delivered and saving attendance are commands and MUST NOT be silently lost. A repeat of either MUST NOT create a second record.

#### Fidelity

- **FR-053**: Every screen in this feature MUST visually match its board in `docs/ui-design/Field_Sales_Beat_App.html` — sections 3.1 through 3.8 — exactly in colors, spacing, typography, icon shapes, border radii and layout, with no approximated placeholders.
- **FR-054**: Loading, refreshing and every empty or offline state MUST be expressed within those layouts rather than replacing them with a different screen.

### Key Entities

- **Previous-day report** *(a read projection)*: one business day's counts, proportions and flagged visits, for a set of filters.
- **Visit** *(referenced; only its delivery status is written)*: a recorded outcome, with — for a manager — the measurement, the verdict and the flags the executive never sees.
- **Order and order line** *(referenced; delivery status written)*: what was ordered, and whether it has been delivered, by whom and when.
- **Attendance record** *(created and amended)*: one person, one business day, one session, one status, with an arrival time when present, a derived lateness, the payable units, who recorded it and when. Amendments add a version and keep the one before.
- **Extra stop** *(created)*: a stop added to one executive's day by a manager, with the required reason.
- **Eligible person** *(referenced)*: someone whose attendance is kept for a given day.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager can complete a full morning review — open the report, open the out-of-range visits, and act on them — in under 10 minutes.
- **SC-002**: A manager can record a full day's attendance in under 5 minutes.
- **SC-003**: Every screen delivered is visually indistinguishable from its board in the UI design reference, verified side by side, with zero undocumented divergences.
- **SC-004**: In 100% of cases, the report's six counts reconcile exactly to the underlying records for the selected day and filters.
- **SC-005**: The within-range bar's three proportions sum to the visits plus the not-visited stops, for 100% of days tested.
- **SC-006**: Each visits-list tab's count equals the number of rows that tab yields when scrolled to the end, for 100% of filter combinations tested.
- **SC-007**: 100% of visits appear exactly once across a full scroll — zero duplicates and zero omissions — including across page boundaries.
- **SC-008**: Zero orders can be marked delivered twice, including by two managers at once, and the recorded marker is never overwritten.
- **SC-009**: 100% of attendance amendments preserve the previous value, its reason and its author, and zero attendance records are ever overwritten.
- **SC-010**: 100% of lateness flags are derived by the server from the company's session start time; zero are accepted from the client.
- **SC-011**: Zero executives can see a measured distance, a range verdict or a quality flag as a result of this work.
- **SC-012**: Zero screens in this feature expose another company's data, or any monetary value.
- **SC-013**: 100% of extra shops added by a manager carry the manager, the executive and the reason into the audit trail, and leave the beat plan byte-identical.

## Assumptions

### Decisions taken with the user (2026-10-20)

Both were put to the user because neither had a defensible default — the first is contradicted by the data model, the second by the design.

- **A manager's scope is the whole company, not a named team.** The product requirements say the report defaults to "the manager's own team" (FR-MGR-01), but **there is no manager-to-executive relationship anywhere in the data model** — no team, no reporting line, nothing recording which executives are whose. Implementing "own team" would mean inventing that relationship and giving the Company Admin a way to set it, which is a feature in its own right. The user chose company-wide. **This is a recorded departure from FR-MGR-01's wording.** It is also a cheap one to reverse: every screen here filters by executive already, so a reporting line added later narrows them without changing their shape.

- **The attendance roster is every active member of staff except the System Admin.** The Employee role "only exists for attendance and pay", but executives are salaried from attendance too, so the roster was never only Employees — and board 3.7 shows a role beside each name and a roster far larger than one manager's executives, which only makes sense if it spans roles. The user chose to include Managers and Company Admins as well. The consequence is recorded as FR-040a rather than left implicit: **a manager appears on their own day sheet and can record their own attendance.** That is acceptable because every record carries its author and every change is an amendment, so a self-recorded entry is exactly as traceable as any other — but it is a real property of the design and should not be discovered at review.

### Conflicts found in the product documentation, and how they are resolved

- **The manager's visibility is the exact inverse of the executive's, and that is deliberate.** Every prior feature has enforced that an executive is never shown a measured distance, a range verdict or a quality flag. This feature exists to show a manager precisely those things — the out-of-range tab, the distance column and the range detail screen are all built on them. FR-046 and FR-047 state both halves so neither is weakened by the other: the manager's need to see is not a reason to relax the executive's rule, and the executive's rule is not a reason to withhold from the manager.
- **"Out of range" is a property of the measurement, not a third outcome.** A visit is an order or a no-order; exceeding the radius is a flag on top. That is why the Out-of-range tab can contain both kinds, and why FR-029 routes by the tab the manager came from rather than by the visit's outcome.
- **The attendance records this feature needs do not exist yet.** The architecture describes them in full — status, session, arrival time, derived lateness, payable units, versioned amendments — but nothing has been built. This feature creates them.
- **The out-of-range map will render blank in the current dev build.** Slice 006 recorded that `GOOGLE_MAPS_API_KEY` is empty there, so map tiles do not load — the same gap already affects the executive's pin-capture screen and the admin's shop form. Board 3.6 is built around a map, so this feature inherits that limitation: everything else on the screen — the distance, the allowed radius, the accuracy, the outcome — works regardless, and the tiles appear as soon as a key is configured. **This is an environment gap, not a scope decision**, but it will make the screen look wrong in review unless it is known.

### Scope boundaries

- **Reviewing or reversing a visit is out of scope.** Accepting an exception or granting a revisit is a separate decision with its own rules; this feature lets a manager *see* flagged visits, not adjudicate them.
- **CSV export of any view is out of scope** (FR-MGR-08). Export is its own slice, with its own audit requirements.
- **The push notification to an executive when a manager adds a shop is out of scope** (FR-EXTRA-09). Notifications are their own slice.
- **Salary is out of scope.** Attendance is the input to it; computing or finalising pay is not here.
- **The Company Admin's own visits list and details (4.2–4.5) are out of scope**, even though they mirror the manager's.
- **Changing a company's session start times is out of scope** — attendance reads them; the Company Admin sets them.
- **Editing a shop, a beat plan or an executive from these screens is out of scope.** The manager reads master data here and changes none of it.
- **Caching any of these screens for offline use is out of scope.** What was loaded in a session stays on screen; nothing is promised to survive the app closing.

### Reasonable defaults

- The report opens on the previous business day because that is what the design shows and what the manager's morning routine is; today's figures are reachable by changing the date.
- A page is ten visits, matching the executive's own history screen and the user's instruction.
- The visits list orders newest first, consistent with every other list in the product.
- Day boundaries, session start times and "today" are the company's, never the device's — so a manager and an executive in different timezones see the same day.
- Payable units follow the company's configured mapping from status; this feature records attendance and does not reinterpret what a status is worth.
- An amendment records the manager who made it, the time, and the reason, alongside the value it replaced.
