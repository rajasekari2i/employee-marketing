# Feature Specification: Executive Dashboard — Today's Beat (Start / Running / End)

**Feature Branch**: `005-executive-dashboard`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Executive Dashboard creation, need to create the executive dashboard. with start the beat, show todo, done & all beats, Executive dashboard looks like the UI (section-1.3 Today's beat · start/ running / end ). Very important UI should looks exactly same like the docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See today's route before starting (Priority: P1)

A Marketing Executive signs in on their company's build and lands on **Today's beat**. Before doing anything else they see which beat plan they are running today, how many stops it has, a "Not started" tag, and the full ordered list of shops — so they can plan their route. The list is visible but locked: rows cannot be opened and nothing can be recorded until the beat starts.

**Why this priority**: Today this role has no screens at all — an executive who signs in sees only a "coming soon" placeholder. Until the route is visible, the executive cannot work and nothing else in this feature has a surface to live on. Being able to see the day's route is useful on its own, even before starting is possible.

**Independent Test**: Sign in as a Marketing Executive whose beat plan covers today, confirm the Today screen opens with the plan name, the stop count, the "Not started" tag, the locked strip, and every shop listed in sequence — all without starting anything.

**Acceptance Scenarios**:

1. **Given** an executive whose beat plan includes today, **When** they sign in, **Then** the Today's beat screen opens showing today's date, a greeting with their first name, the beat plan name, the total stop count, and a "Not started" tag.
2. **Given** the screen is open and not started, **When** the executive reads the list, **Then** every shop on the plan appears in its planned sequence, each showing its sequence number, name, status, address, and whether its location pin is saved.
3. **Given** the screen is open and not started, **When** the executive taps any shop row, **Then** nothing opens — rows are not actionable before the beat starts.
4. **Given** the screen is open and not started, **When** the executive looks below the card, **Then** a locked strip reads "Start the beat to record visits and add extra shops."
5. **Given** today is not a working day on the executive's beat plan, or they have no beat plan at all, **When** they open the screen, **Then** it explains which of the two situations applies rather than showing an empty list or an error.
6. **Given** the route for today already exists, **When** a Company Admin edits the underlying beat plan later that same day, **Then** today's route is unchanged — it was frozen when it was created.

---

### User Story 2 - Start the beat (Priority: P1)

The executive taps **Start beat**. Their current location and the time are captured, the day moves to running, and the screen switches to the running card — progress, counts, elapsed time, and an **End beat** control. From this point the day is open for work.

**Why this priority**: Starting the beat is the gate the whole product hangs on — no visit, extra shop or pin capture is allowed outside a running day. It is also the single action the feature description names first.

**Independent Test**: With the beat not started, tap Start beat, grant location, and confirm the card switches to running with a start time, the elapsed timer counting, and the locked strip replaced.

**Acceptance Scenarios**:

1. **Given** the beat has not started, **When** the executive taps "Start beat" and location is available, **Then** the day is marked running, the moment of starting and the captured coordinates are recorded, and the card switches to the running state.
2. **Given** the beat is running, **When** the executive reads the card, **Then** it shows completed-of-total progress, counts for Pending, Completed, Revisit and Extra, the start time, and how long the beat has been running.
3. **Given** the beat is running, **When** the executive reads the strip under the card, **Then** it names the shop nearest to where they started.
4. **Given** the executive taps "Start beat" twice quickly, or retries after a timeout, **Then** exactly one beat day is recorded and the second attempt simply returns the running day — never an error, never a duplicate.
5. **Given** location permission has never been requested, **When** the executive taps "Start beat", **Then** they are asked for location permission first, with an explanation of why it is needed.
6. **Given** location permission is denied, or the device cannot get a fix, **When** the executive taps "Start beat", **Then** the beat does not start and they are told plainly that a location is required, with a way to retry.
7. **Given** the reading the device returns is of poor accuracy, **When** the executive starts the beat, **Then** the start still succeeds — accuracy is recorded but never blocks starting.

---

### User Story 3 - Filter the list by To do, Done and All (Priority: P1)

The executive switches between **To do**, **Done** and **All** to see what is left, what is finished, and the whole day, each tab carrying a live count.

**Why this priority**: Named explicitly in the feature description, and it is how the executive navigates a 13-stop day in the field. It is also useful immediately: even on day one, "To do" is the working list.

**Independent Test**: Open the screen with a mix of pending and completed stops, switch between the three tabs, and confirm each shows the right subset and the counts add up.

**Acceptance Scenarios**:

1. **Given** the screen is open, **When** the executive reads the three tabs, **Then** each shows its own live count, and To do plus Done equals All.
2. **Given** the executive selects "To do", **Then** only stops still to be visited are listed; selecting "Done" lists only completed ones; selecting "All" lists every stop.
3. **Given** a list is shown, **When** the executive reads its order, **Then** stops still to do come first, then stops needing a revisit, then completed ones, with extra shops first inside their own group and tagged "Extra".
4. **Given** a tab's filter matches nothing, **When** it is selected, **Then** an empty state is shown rather than an error.

---

### User Story 4 - End the beat (Priority: P2)

At the close of the day the executive taps **End beat**. An inline confirmation appears in the same card — never a separate screen — stating the end time and naming any shops still pending. They can keep going or confirm, and confirming closes the day for good.

**Why this priority**: Closing the day is what makes the day's record complete and reportable for the manager. It matters, but the day is already usable and recordable once it has started, which is why it follows starting.

**Independent Test**: With the beat running and at least one pending stop, tap End beat, confirm the inline warning names that shop, choose "Keep going" and confirm nothing changed, then end for real and confirm the day closes.

**Acceptance Scenarios**:

1. **Given** the beat is running, **When** the executive taps "End beat", **Then** a confirmation appears inline in the same card — not a new screen — showing the end time and offering "Keep going" and "End beat".
2. **Given** stops are still pending, **When** the confirmation appears, **Then** it says how many are pending, names them, and warns they will be recorded as not visited.
3. **Given** the confirmation is open, **When** the executive chooses "Keep going", **Then** the day stays running and nothing is recorded.
4. **Given** the confirmation is open, **When** the executive confirms, **Then** the location and time are captured the same way as starting, and the day is closed.
5. **Given** the day is closed, **When** the executive looks at the list, **Then** no row is actionable and a strip reads "Beat ended for today. Your list starts again tomorrow morning."
6. **Given** the executive confirms twice, or retries after a timeout, **Then** the day is closed once and the second attempt returns the closed day rather than an error.

---

### User Story 5 - See the day's summary once ended (Priority: P2)

After ending, the card becomes a closed-day summary: when the beat started and ended, how long it ran, and the day's totals.

**Why this priority**: It closes the loop for the executive and is the same record the manager reviews the next morning. It is read-only, so it carries no risk and adds value only after ending exists.

**Independent Test**: End a beat, then confirm the card shows start → end times, the duration, a "Closed" tag, and totals for visited, orders, no-order and not visited.

**Acceptance Scenarios**:

1. **Given** the day is closed, **When** the executive reads the card, **Then** it shows the start and end times, the total duration, and a "Closed" tag.
2. **Given** the day is closed, **When** the executive reads the totals, **Then** they show visited, orders, no-order and not-visited counts for the day.
3. **Given** the day is closed, **When** the executive leaves the app and returns the same day, **Then** the closed summary is still shown — the day does not reopen.

---

### User Story 6 - Refresh the day (Priority: P3)

The executive re-fetches the day — by the refresh control in the header or by pulling the list down — to pick up a shop a manager added, or after a patchy-signal period.

**Why this priority**: A convenience that matters in the field, but the screen already loads the day when opened, so nothing is blocked without it.

**Independent Test**: Open the screen, change the day's data from elsewhere, refresh, and confirm the screen reflects the change without signing out.

**Acceptance Scenarios**:

1. **Given** the screen is open, **When** the executive taps the refresh control, **Then** the day is re-fetched and the card, counts and list all update.
2. **Given** the screen is open, **When** the executive pulls the list down, **Then** the same refresh happens.
3. **Given** a refresh fails because there is no connection, **When** it completes, **Then** the previously loaded day stays on screen and the executive is told the refresh did not succeed — stale data is never silently presented as fresh.

---

### Edge Cases

- An executive whose beat plan has no shops sees a valid, empty route for the day rather than an error, and can still start and end the beat.
- A beat plan that is deactivated after today's route was created does not change or remove that route.
- A shop deactivated after the route was created still appears on today's route — the route is a frozen snapshot.
- A shop with no approved location pin is listed and clearly marked as needing its pin captured first.
- The business date is the company's local date, not the device's — an executive whose phone clock or timezone is wrong still gets the correct day.
- Opening the app just before and just after local midnight yields yesterday's day and then a fresh day, with the previous day no longer editable.
- A beat left running overnight is **not** closed automatically in this feature — it stays running until the executive ends it. Automatic closing at a company cut-off is a later feature.
- Starting a beat, closing the app, and reopening it resumes the running day with the elapsed time still correct.
- Two devices signed in as the same executive both see one shared day; starting on one shows as running on the other after a refresh.
- Losing connectivity mid-day leaves the already-loaded day on screen; starting or ending with no connection fails with a clear message rather than appearing to succeed.
- A manager-added extra shop appears on the next refresh, tagged "Extra", without disturbing the planned stops' sequence.

## Requirements *(mandatory)*

### Functional Requirements

#### The executive's app shell

- **FR-001**: A signed-in Marketing Executive MUST land on the Today's beat screen instead of the current "coming soon" placeholder.
- **FR-002**: The executive MUST have their own bottom navigation with exactly three destinations — Today, My visits, My totals — matching UI design reference section 1.3. Only Today is delivered by this feature; the other two MUST be present and clearly marked as not yet available rather than omitted, so the navigation matches the design.
- **FR-003**: The header MUST show today's date and a greeting with the executive's first name, the screen title, a refresh control, and an account menu behind the avatar offering Profile and Log out — matching the design.
- **FR-004**: Screens and data in this feature MUST be available only to the Marketing Executive role, and each executive MUST see only their own day.

#### Today's route

- **FR-005**: The system MUST give each executive at most one route per business day, where the business day is derived from the company's own timezone and never from the device clock.
- **FR-006**: When an executive opens Today and no route exists yet for that business date, the system MUST create it from their active beat plan if that plan covers today's weekday, and MUST do so once — a second open, or two devices opening at the same moment, MUST NOT produce a second route.
- **FR-007**: A route MUST be frozen at creation: each stop copies the shop's identity, its position in the plan, and the location-check radius in force at that moment. Later edits to the beat plan, the shop, or company settings MUST NOT alter a route that already exists.
- **FR-008**: Where no route can be created, the screen MUST distinguish the reasons — today is not a working day on the plan, or the executive has no active beat plan at all — rather than showing a generic empty state.
- **FR-009**: Each stop MUST carry a status of pending, completed, skipped or revisit, and a source of planned, executive-added or manager-added, with extra stops recording who added them and when.
- **FR-010**: Each row MUST show the stop's sequence number (or an "extra" marker in place of it), shop name, status tag, address, whether the shop's pin is saved, and a summary of the previous outcome at that shop — matching UI design reference section 1.3.
- **FR-011**: The list MUST be ordered to-do first, then revisit, then completed, with extra stops first within their group.
- **FR-012**: The screen MUST offer To do, Done and All filters, each with a live count.
- **FR-013**: The executive MUST be able to re-fetch the day from a header control and by pulling the list down.

#### The beat day

- **FR-014**: The executive MUST be able to start the beat, which records the moment of starting, their coordinates and the reading's accuracy. A location is required; poor accuracy MUST be recorded but MUST NOT block starting.
- **FR-015**: The app MUST request location permission before the first start, explaining why it is needed, and MUST fail clearly — without starting the beat — when permission is refused or no fix can be obtained, offering a retry.
- **FR-016**: Before the beat starts, stop rows MUST NOT be openable and no extra shop may be added; the list MUST still be fully visible, with the locked strip reading "Start the beat to record visits and add extra shops."
- **FR-017**: While running, the card MUST show completed-of-total progress, counts for Pending, Completed, Revisit and Extra, the start time, the elapsed duration, and the shop nearest the point where the beat started.
- **FR-018**: Ending the beat MUST be confirmed **inline in the same card**, never on a separate screen. The confirmation MUST state the end time, say how many stops are still pending and name them, warn that they will be recorded as not visited, and offer both "Keep going" and "End beat".
- **FR-019**: Ending MUST capture coordinates, accuracy and time the same way starting does, and MUST close the day.
- **FR-020**: Once the day is closed, no further change to that day MUST be possible, and the locked strip MUST read "Beat ended for today. Your list starts again tomorrow morning."
- **FR-021**: A day MUST be startable once and closable once. A repeated start or end — a double tap, or a retry after a timeout — MUST return the existing day rather than failing or creating a second record.
- **FR-022**: Once closed, the card MUST show the start and end times, the total duration, a "Closed" tag, and the day's totals for visited, orders, no-order and not visited.
- **FR-023**: Start and end times, their locations, and the day's status MUST be recorded so that the Manager and Company Admin features built later can read them.

#### Fidelity and resilience

- **FR-024**: Every state this feature delivers — not started, running, ending (the inline confirmation), and ended, each with its To do / Done / All filters and the stop list — MUST visually match its corresponding board in `docs/ui-design/Field_Sales_Beat_App.html` (section 1.3) exactly: colors, spacing, typography, icon shapes, border radii, and layout, with no approximated placeholders.
- **FR-025**: A failed read MUST leave the previously loaded day visible and say the refresh failed; a failed start or end MUST say so plainly and MUST NOT appear to have succeeded.
- **FR-026**: No precise coordinate captured by this feature may appear in any log or analytics payload.

### Key Entities

- **Daily route** *(one per executive per business day)*: the frozen snapshot of that executive's day — which beat plan it came from, the plan's name at the time, and the day's lifecycle: whether it is running or closed, when it started and ended, and where. Carries the day, so "is the beat running?" is answered by this one record.
- **Stop** *(a shop's place on one daily route)*: its sequence, its status, where it came from (planned or added, and by whom), and the location-check radius frozen at creation. A stop points at a shop but keeps its own snapshot of what mattered that day.
- **Beat plan** *(referenced, not owned here)*: the admin-managed route this feature copies from. This feature only reads it, at the moment a route is created.
- **Shop** *(referenced, not owned here)*: supplies the name, address and pin status shown on each row. Whether a shop has an approved pin determines how its row is marked.
- **Executive** *(referenced, not owned here)*: the company user who runs the beat. Each sees only their own route.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Marketing Executive can sign in and see today's route, correctly populated from their beat plan, in under 10 seconds on a normal connection — with no manual setup step on the day.
- **SC-002**: An executive can go from opening the app to a running beat in under 15 seconds and no more than two taps plus granting location.
- **SC-003**: Every state delivered by this feature is visually indistinguishable — colors, spacing, type, icon shapes, border radii, layout — from its corresponding board in the UI design reference, verified by side-by-side comparison.
- **SC-004**: 100% of executives have at most one route and at most one beat day per business date, with zero duplicates produced by repeated opens, double taps, retries or two devices.
- **SC-005**: 100% of routes, once created, are unchanged by later edits to the beat plan, the shop master, or company settings.
- **SC-006**: Zero beats start without a recorded location; 100% of refused-permission and no-fix attempts leave the beat not started and tell the executive why.
- **SC-007**: The To do, Done and All counts agree with the list contents in 100% of cases, with To do plus Done equal to All.
- **SC-008**: Zero cross-executive leakage: an executive never sees another executive's route or day under any filter, refresh or retry.
- **SC-009**: A beat that is started, with the app then closed and reopened, resumes as running with the elapsed time correct to within a second in 100% of cases.

## Assumptions

### Scope boundaries — what this feature deliberately does not do

- **Recording a visit is out of scope.** This feature delivers the dashboard and the day's lifecycle. Tapping a shop row to record an order or a no-order is the next feature; until it exists, rows are listed and tagged but opening one leads nowhere. This matches the product's own build order, where visit capture is its own slice.
- **Adding an extra shop is out of scope.** The design shows an "Add extra shop to today" action while running; this feature renders the day's data model so extra stops are supported and displayed when they exist, but the screen for adding one is a separate feature. Manager-added extras appear here as soon as that feature exists.
- **Capturing a missing shop pin is out of scope.** Rows are marked "No pin yet — capture first" per the design, but the capture screen itself is a separate feature.
- **My visits and My totals are out of scope.** The design's bottom bar has three destinations; this feature builds the navigation with all three so the chrome matches, and delivers only Today.
- **Automatic closing of a forgotten beat is out of scope**, as are the "beat not started" and "beat not ended" reminders. All three need a scheduled-job runtime the system does not have yet. A beat left running stays running until the executive ends it. The company settings that configure these times already exist and are left untouched for the feature that adds them.

### Decisions and defaults

- **Today's route is created the first time the executive opens the screen** on a working day, rather than overnight in advance — confirmed with the user on 2026-10-19. The product documentation describes an overnight job, but the system has no scheduled-job runtime at all, and an overnight job that fails or does not run leaves the executive with an empty screen and no way to recover. Creating on first open needs no new infrastructure and cannot leave a working day without a route. The trade-off, accepted: the snapshot is taken when the executive first opens the app rather than at a fixed early-morning moment, so a beat-plan edit made earlier that morning is picked up by a route created afterwards. Moving to a scheduled job later does not change anything an executive sees.
- **The previous-outcome summary on each row shows "First visit" for every shop until visit history exists.** The design shows entries like "Last: Order · 22 Sep", which depend on recorded visits — none exist yet. The row keeps its place and styling, using the design's own wording for a shop with no history, and becomes real when visit recording is built.
- **The Revisit and Extra counts, and the day's order / no-order totals, will read zero until the features that produce them exist.** They are shown as the design draws them rather than hidden, so the card does not change shape later.
- **Device location is a new capability for this app.** No location permission or positioning capability exists today — the only mapping in the app is an admin picking a point on a map, never a device reading. This feature introduces the device's own positioning, the Android location permissions, and the permission request flow. That requires a native rebuild of the app rather than a JavaScript-only update.
- **Poor accuracy never blocks starting or ending.** Accuracy is recorded for the manager's later review; the product's rule is that exceptions are flagged, never blocking.
- **The nearest-shop line on the running card is measured from the point the beat started**, using the shops on today's route that have an approved pin; shops without a pin cannot be measured and are excluded from that comparison only.
- **Executive permissions already exist** in the system's role definitions for reading a daily assignment and creating a beat day; this feature is the first to put endpoints behind them, and does not change what any role is allowed to do.
- **A route is created only from an active beat plan assigned to that executive.** An executive with no plan, or whose plan does not cover today's weekday, gets the explanatory state rather than an empty route.
- **Offline support is limited to reads.** Constitution-level offline queuing of field actions is scoped to visit submission and pin capture in a later hardening feature; here, an already-loaded day stays visible without a connection, and starting or ending requires one.
