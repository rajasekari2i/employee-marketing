# Feature Specification: Visit Outcomes — Order, No Order, Pin Capture and Offline Submission

**Feature Branch**: `006-visit-outcomes`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Enter Visit details for a beat shops. When I click the beat shop it should redirect to the visit page (section 1.7 Visit · last 5 + outcome), showing the list of last visit messages. Clicking Order should redirect to the order creation page (2.1 Outcome · Order), where we enter order lines, choose the brand and use the counter. Clicking No order should redirect to the no-order page (2.2 Outcome · No order). When we click capture location and review, we should show confirm and submit (2.3). If the shop doesn't have a location, we need an option to pin the shop location (1.8 Capture missing shop pin). This is a very important module of the marketing executive, so we need to maintain proper save and retrieve. We should not tell the marketing executive we are collecting the location while saving the order or no-order — this is very important. Very important: UI should look exactly the same as docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a shop and see its history (Priority: P1)

A Marketing Executive taps a shop on today's list and lands on that shop's visit screen. They see who the shop is, its address, the owner's name and a way to call them, and — most usefully — the **last five completed interactions** at that shop: when, what the outcome was, the order summary or the refusal reason, and who recorded it. Before choosing an outcome they answer whether a sample was shown.

**Why this priority**: This screen is the entry point to every outcome, and the five-visit history is what turns a cold call into an informed one — the executive walks in knowing the shop refused last time for stock reasons, or ordered 40 units a fortnight ago. It is valuable on its own even before any outcome can be recorded.

**Independent Test**: Tap a shop with prior history from today's list and confirm the screen opens with the shop's details and exactly its five most recent interactions, newest first, each showing outcome, summary and who recorded it.

**Acceptance Scenarios**:

1. **Given** the beat is running and the executive taps a shop row, **When** the visit screen opens, **Then** it shows the shop's code, name, full address, owner name and a working call action, plus its position in today's route ("Stop 3 of 12").
2. **Given** the shop has prior visits, **When** the executive reads the history, **Then** the five most recent completed interactions are listed newest first, each with its date, outcome, a summary (order lines or refusal reason) and who recorded it.
3. **Given** the shop has fewer than five prior visits, **When** the history is shown, **Then** only the ones that exist are listed, with no placeholder rows.
4. **Given** the shop has never been visited, **When** the history is shown, **Then** it says so plainly rather than showing an empty box.
5. **Given** the visit screen is open, **When** the executive reads the history, **Then** no distance, range verdict or quality flag appears anywhere in it.
6. **Given** the visit screen is open, **When** the executive tries to choose an outcome without answering "Sample shown?", **Then** they are required to answer first.
7. **Given** "Sample shown?" is answered, **When** the executive chooses, **Then** exactly two outcomes are offered — Order and No order.
8. **Given** the beat is not running, or the stop already has a completed outcome, **When** the executive opens the shop, **Then** no outcome can be recorded and the screen says why.

---

### User Story 2 - Record an order (Priority: P1)

The executive taps **Order** and builds the order line by line: pick a brand, set a quantity with the stepper or the keypad, add another line. The screen keeps a live count of brands and total quantity. They then review and submit.

**Why this priority**: An order is the product's whole commercial purpose — it is the outcome the business exists to capture, and the single most valuable action in the executive's day.

**Independent Test**: From the visit screen tap Order, add two or three brand/quantity lines, confirm the live totals track, submit, and confirm the stop is marked completed on today's list with the order recorded.

**Acceptance Scenarios**:

1. **Given** the executive taps "Order", **When** the order screen opens, **Then** the shop and stop are named, the sample-shown answer is carried through, and the last five visits remain visible as a compact strip.
2. **Given** the order screen is open, **When** the executive adds a line, **Then** they can choose from the company's **active brands only**, presented in the admin's display order.
3. **Given** a line exists, **When** the executive sets its quantity, **Then** both a stepper and direct keypad entry work, and the value must be a whole number of zero or more.
4. **Given** lines exist, **When** the executive reads the summary, **Then** the brand count and total quantity update live as lines change.
5. **Given** the executive tries to submit with every line at zero, **When** they submit, **Then** it is rejected — at least one line must exceed zero.
6. **Given** the executive adds a brand already on the order, **When** they confirm that line, **Then** it is rejected as a duplicate rather than creating a second line for the same brand.
7. **Given** a valid order, **When** the executive proceeds, **Then** the confirm step opens showing the outcome summary before anything is saved.
8. **Given** the order is submitted, **When** it succeeds, **Then** the executive is returned straight to today's list with that stop marked completed.

---

### User Story 3 - Record a no-order (Priority: P1)

The shop did not order. The executive taps **No order**, picks one reason from the company's list, and — if the reason is "Other" — types what actually happened.

**Why this priority**: Refusals are as important as orders to the business: standardising them is what makes refusals countable instead of anecdotal, which is a stated business objective. It is also the more common outcome in the field.

**Independent Test**: From the visit screen tap No order, select a reason, submit, and confirm the stop is marked completed with that reason recorded; separately confirm "Other" cannot be submitted without text.

**Acceptance Scenarios**:

1. **Given** the executive taps "No order", **When** the screen opens, **Then** the company's **active reasons only** are listed in the admin's display order, with "Other" always last.
2. **Given** the reason list is shown, **When** the executive selects, **Then** exactly one reason can be chosen — it is a single-select, not a multi-select.
3. **Given** "Other" is selected, **When** the executive tries to proceed without typing anything, **Then** it is rejected — free text is required for Other, between 3 and 280 characters.
4. **Given** a reason other than "Other" is selected, **When** the executive proceeds, **Then** no free text is required.
5. **Given** the executive tries to proceed without selecting any reason, **When** they submit, **Then** it is rejected.
6. **Given** a valid no-order, **When** the executive proceeds, **Then** the confirm step opens, and on submission they return to today's list with the stop completed.

---

### User Story 4 - Capture a missing shop location (Priority: P2)

Some shops have never had their location saved. Standing at the shop door, the executive captures its pin — the app shows the device position on a map with a draggable marker and an accuracy reading, and refuses to save a pin that is not accurate enough. Once saved, they continue straight into recording the visit.

**Why this priority**: Without this, a shop with no saved location is a dead end — the executive cannot record anything there at all. It is P2 only because shops that already have pins (the majority) work without it.

**Independent Test**: Open a shop with no saved location, confirm the outcome path is blocked and the capture screen is offered, capture a pin at acceptable accuracy, and confirm the executive continues to the visit screen and can then record an outcome.

**Acceptance Scenarios**:

1. **Given** a shop has no saved location, **When** the executive opens it from today's list, **Then** they are taken to the capture screen rather than the outcome path, with a prominent notice explaining they must stand at the shop entrance and save its pin before recording anything.
2. **Given** the capture screen is open, **When** it loads, **Then** it shows the device's position on a map with a draggable marker, an accuracy ring, and an address search.
3. **Given** a position is read, **When** the executive reads the accuracy, **Then** it is shown as a number with a plain verdict — good enough to save, or too low to save.
4. **Given** accuracy is worse than the company's maximum, **When** the executive looks at the save action, **Then** it is disabled, with guidance to step outside away from walls, and a retry action that re-reads the position.
5. **Given** accuracy is acceptable, **When** the executive saves the pin, **Then** the point, its accuracy, how it was obtained (device position, address search, or dragged by hand), the capture time and who captured it are all recorded.
6. **Given** a pin is saved and the company auto-approves executive pins, **When** saving completes, **Then** the executive continues straight to the visit screen and can record an outcome immediately.
7. **Given** a pin is saved and the company does **not** auto-approve, **When** saving completes, **Then** the executive is told the location needs a manager's approval before an outcome can be recorded there, and the stop stays pending.
8. **Given** a shop already has a saved, approved pin, **When** the executive opens it, **Then** they cannot change that pin — they may only raise a correction request for a manager to approve.

---

### User Story 5 - Submit with no signal (Priority: P2)

The shop is in a basement with no bars. The executive records the outcome exactly as they would anywhere else, submits, and gets on with their day. The visit is held on the phone, shown as waiting to sync, and sent automatically the moment signal returns — once, never twice.

**Why this priority**: This is the difference between an app that works in the field and one that loses a day's work. It follows the outcome stories because there must be an outcome to queue, but it is not optional for a product whose users work inside buildings.

**Independent Test**: Put the device in airplane mode, record and submit an order, confirm it is accepted and shown as waiting to sync, restart the app to confirm it survived, then restore the connection and confirm it syncs exactly once with the stop marked completed.

**Acceptance Scenarios**:

1. **Given** there is no connection, **When** the executive submits a visit, **Then** it is accepted and held on the device, clearly marked as waiting to sync — never reported as a failure, and never silently discarded.
2. **Given** a visit is waiting to sync, **When** the executive closes the app entirely and reopens it, **Then** the queued visit is still there — nothing is lost to a restart.
3. **Given** a connection returns, **When** the queue syncs, **Then** held visits are sent in the order they were recorded and each disappears from the waiting state as it is accepted.
4. **Given** a queued visit is sent and the response is lost, **When** it is retried, **Then** the server records it exactly once — a retry can never produce a second visit or a second order.
5. **Given** a visit was recorded offline, **When** it reaches the server, **Then** it is marked as having been submitted offline, so a manager reviewing it knows the circumstances.
6. **Given** visits are waiting to sync, **When** the executive looks at the app, **Then** they can tell at a glance how many are waiting.
7. **Given** a queued visit is rejected by the server for a reason that will never resolve, **When** the sync runs, **Then** it stops being retried forever and is surfaced to the executive rather than cycling silently.
8. **Given** the executive tries to log out with visits still waiting, **When** they confirm, **Then** they are warned and the session is kept rather than losing the queue.

---

### Edge Cases

- A stop that already has a completed outcome cannot take a second one; the executive is told it is already recorded rather than being allowed to submit twice.
- A second outcome becomes possible only when a manager has granted a revisit, which arrives as its own stop.
- The beat ending between opening the outcome screen and submitting it causes the submission to be refused with a clear explanation — a day that is closed cannot gain new visits.
- A brand or reason deactivated by the admin after the executive opened the screen but before they submitted is rejected on submission rather than silently accepted.
- An order with a very large quantity is accepted; quantities are not capped, only required to be whole and not negative.
- Removing every line from an order and submitting is rejected, same as all-zero quantities.
- The shop's saved location being corrected by a manager after a visit was recorded never changes what that visit measured.
- A visit recorded offline and synced days later is still measured against the shop's location and the radius **as they were when the visit was recorded**, not as they are at sync time.
- Losing the connection mid-submission, where the server may or may not have received it, results in exactly one recorded visit.
- Two devices signed in as the same executive cannot both record an outcome for the same stop; the second is refused.
- The device clock being wrong does not change when the visit is recorded as having happened on the server's record.
- Capturing a pin and then losing signal before recording the outcome leaves the pin capture itself queued, in order, ahead of the visit that depends on it.
- An executive who denies location permission at the moment of submission cannot submit, and is told what to do — the visit is not saved without a position.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the visit

- **FR-001**: Tapping a shop on today's list MUST open that shop's visit screen when the shop has an approved location, and the location-capture screen when it does not.
- **FR-002**: An outcome MUST be recordable only for a stop on the executive's own route for today, only while the beat is running, and only when the shop has an approved location.
- **FR-003**: The visit screen MUST show the shop's code, name, address, owner and a call action, its position in today's route, and whether its location is saved — matching UI design reference section 1.7.
- **FR-004**: The visit screen MUST show the **last five completed interactions** at that shop, newest first, each with its date, outcome, a summary of the order or the refusal reason, and who recorded it. Fewer than five shows only what exists; none shows an explicit empty state.
- **FR-005**: "Sample shown?" MUST be answered Yes or No before either outcome can be chosen.
- **FR-006**: The executive MUST record exactly one primary outcome per stop — Order or No order, never both and never neither.

#### Order

- **FR-007**: The order screen MUST let the executive build one or more lines of brand and quantity, matching UI design reference section 2.1.
- **FR-008**: Brands offered MUST be the company's **active** brands only, in the display order the admin set.
- **FR-009**: Quantity MUST accept whole numbers of zero or more, through both a stepper and direct keypad entry.
- **FR-010**: The screen MUST show the brand count and total quantity live as lines change.
- **FR-011**: An order MUST have at least one line whose quantity exceeds zero; an order with no lines, or with every line at zero, MUST be rejected.
- **FR-012**: The same brand MUST NOT appear twice on one order.

#### No order

- **FR-013**: The no-order screen MUST offer the company's **active** reasons only, in display order, with "Other" always last — matching UI design reference section 2.2.
- **FR-014**: Exactly one reason MUST be selected; submitting with none is rejected.
- **FR-015**: Choosing "Other" MUST require free text of 3 to 280 characters; any other reason MUST NOT require text.

#### Confirm and submit

- **FR-016**: Submitting MUST pass through a confirmation step showing the outcome summary and the sample-shown answer, and warning that a submitted visit cannot be edited — matching UI design reference section 2.3 **except** for the location block, which is removed (see FR-018).
- **FR-017**: On successful submission the executive MUST return to today's list with that stop marked completed.

#### What the executive is never shown or told

- **FR-018**: The confirmation step MUST NOT display the captured location, its accuracy, its freshness, or the capture time. The executive is not told that a position is being captured as part of saving an order or a no-order.
- **FR-019**: The visit screen MUST NOT display the shop's visit radius.
- **FR-020**: No screen in this feature MUST ever show the executive the measured distance, whether the visit fell inside or outside the allowed radius, or any quality flag — including in the five-visit history and in the sync state of a queued visit.
- **FR-021**: The app's location-permission request MUST state that location is saved when recording visits, not only when starting and ending the beat, so what the app does is disclosed honestly at the point permission is granted.

#### What is captured and who decides it

- **FR-022**: At submission the app MUST send the captured position, its accuracy, when it was captured, when it was submitted, any mock-location signal the device reports, and a key that identifies the submission uniquely.
- **FR-023**: The app MUST NOT send, and MUST NOT be able to influence, the measured distance, the range verdict, or any quality flag. These are determined solely by the server.
- **FR-024**: The server MUST determine and store, for every visit: whether accuracy was poorer than the company's limit, whether the position was older than the company's limit, whether a mock location was signalled, whether it arrived from the offline queue, the measured distance from the shop's approved location, the radius in force, and whether that radius was exceeded.
- **FR-025**: A visit that exceeded the radius MUST be accepted and routed for manager review — never blocked, and never presented to the executive as a problem.
- **FR-026**: The recorded facts and flags of a visit MUST NOT change if the shop's location, the radius, or the brand and reason masters change afterwards.
- **FR-027**: A visit and its order lines MUST be recorded together as one unit — it MUST be impossible to end up with a visit whose order is missing, or an order with no visit.
- **FR-028**: Every submission MUST be recorded in the company's audit trail with the acting executive.

#### Location capture for a shop with none

- **FR-029**: A shop with no saved location MUST show a prominent notice that the location must be saved before an outcome can be recorded there, matching UI design reference section 1.8.
- **FR-030**: The capture screen MUST show the device's position on a map with a draggable marker, an accuracy ring, and an address search.
- **FR-031**: Accuracy MUST be shown as a number with a plain verdict, and saving MUST be disabled while accuracy is worse than the company's maximum, with guidance and a retry action.
- **FR-032**: Saving MUST record the point, its accuracy, how it was obtained, when, and by whom.
- **FR-033**: Whether a captured location becomes immediately usable or waits for approval MUST follow the company's own setting; when it waits, the executive MUST be told an outcome cannot be recorded there yet.
- **FR-034**: An executive MUST NOT be able to change a location that is already saved; they may only raise a correction request for a manager to decide.

#### Working without a connection

- **FR-035**: A visit submitted without a connection MUST be accepted, held on the device, and shown as waiting to sync — never reported as a failure and never discarded.
- **FR-036**: Held submissions MUST survive the app being closed and reopened, and MUST be sent in the order they were recorded once a connection returns.
- **FR-037**: A held submission MUST carry the same unique key from the moment it is recorded, so that a retry — including one after a lost response — records it exactly once.
- **FR-038**: A submission that arrived from the queue MUST be marked as such on the server, so a manager reviewing it knows the circumstances.
- **FR-039**: The executive MUST be able to see how many submissions are waiting to sync.
- **FR-040**: A held submission the server permanently rejects MUST stop being retried and MUST be surfaced to the executive rather than failing silently forever.
- **FR-041**: Logging out with submissions still waiting MUST warn the executive and keep the session rather than discarding the queue.
- **FR-042**: A location capture recorded offline MUST queue ahead of any visit that depends on it, so they arrive in a workable order.

#### Fidelity

- **FR-043**: Every screen in this feature MUST visually match its corresponding board in `docs/ui-design/Field_Sales_Beat_App.html` — sections 1.7, 1.8, 2.1, 2.2 and 2.3 — exactly in colors, spacing, typography, icon shapes, border radii and layout, with no approximated placeholders, **except** the two deliberate removals in FR-018 and FR-019.

### Key Entities

- **Visit**: one completed interaction at one shop on one day — who recorded it, at which stop, whether a sample was shown, which outcome, the position and accuracy captured at submission, the server's measured distance and radius verdict, its quality flags, and whether it needs manager review. Immutable once recorded.
- **Order** *(part of a visit)*: the commercial result of an order outcome — exists only as part of its visit, never alone.
- **Order line**: one brand and one quantity on an order, keeping the brand's name as it read at the time so a later rename never rewrites history.
- **No-order reason** *(referenced)*: the standardised refusal chosen from the company's list, with free text when the reason is "Other".
- **Shop location** *(referenced, extended here)*: the shop's saved point, how it was obtained, its accuracy, who captured it and when, and whether it is approved. This feature adds the executive's own first-capture path.
- **Stop** *(referenced, from today's route)*: what the visit is recorded against, and what gets marked completed.
- **Held submission** *(on the device)*: a recorded outcome or location capture waiting for a connection — its payload, its unique key, when it was recorded, and its sync state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An executive can go from tapping a shop to a submitted order in under 60 seconds for a three-brand order.
- **SC-002**: An executive can record a no-order in under 20 seconds.
- **SC-003**: Every screen delivered is visually indistinguishable from its board in the UI design reference, verified side by side — with the two documented removals being the only differences.
- **SC-004**: Zero visits anywhere in the system display a distance, a range verdict or a quality flag to an executive.
- **SC-005**: 100% of submissions result in exactly one recorded visit, including double taps, lost responses, retries and offline syncs. Zero duplicates.
- **SC-006**: 100% of visits recorded without a connection are eventually recorded on the server, with zero lost to an app restart.
- **SC-007**: 100% of visits have a server-measured distance and radius verdict stored, and zero have one supplied by the device.
- **SC-008**: 100% of visits that exceeded the radius are accepted and routed to review; zero are blocked.
- **SC-009**: Zero visits record an order without its lines, or lines without their visit.
- **SC-010**: A visit's recorded facts remain identical after the shop's location, radius, brands or reasons are later changed, in 100% of cases.
- **SC-011**: Zero cross-executive leakage: an executive can never open, record against, or see the history of another executive's stop.

## Assumptions

### Decisions taken with the user (2026-10-19)

- **The executive is not shown that a location is captured when saving an outcome.** The design's confirm sheet and PRD FR-VISIT-09 both display "Your location", its accuracy, freshness and capture time; the user asked for this not to be surfaced, and chose to remove it. The visit screen's "Visit radius" line (board 1.7, FR-VISIT-02) is removed on the same grounds. **These are the only two deliberate divergences from the design in this feature**, and both are recorded in FR-018, FR-019 and FR-043. The position itself is still captured and still sent — nothing about the server's measurement changes.
- **Because the display is removed, disclosure moves to the permission prompt** (FR-021). The app already asks for location permission with a reason; that wording must cover recording visits, not just starting and ending the beat. This keeps the app honest about what it does while meeting the user's requirement that the submission screens stay silent about it.
- **The offline queue is built in this feature**, not deferred. PRD FR-VISIT-13 and the product's own constitution both require it, and the user confirmed. This is the slice where the app stops assuming a connection: it is a substantial addition covering on-device storage, ordered sending, sync state and a visible waiting count.

### Resolutions of conflicts found in the product documentation

- **Pin approval versus recording an outcome.** FR-PIN-07 says the executive continues straight to the visit screen after saving a pin, but FR-VISIT-01 requires an *approved* location before any outcome, and FR-PIN-06 says a captured pin may be left pending per a company setting. Taken together these dead-end the executive at a new shop. This feature honours the company setting (FR-033): with auto-approval on, capture flows straight into recording, exactly as the design shows; with it off, the executive is told the location needs approval first. **The pilot should have auto-approval enabled, or an executive standing at a new shop cannot record anything there** — this is called out for a decision rather than silently assumed.
- **"Last five visits" means the last five completed interactions at that shop by anyone**, not only by the current executive — the point is the shop's history, and the design shows who recorded each one.

### Scope boundaries

- **Granting a revisit is a manager action and is out of scope.** This feature refuses a second outcome on a completed stop; the manager feature that authorises one, and creates the revisit stop, is separate.
- **Marking an order delivered is out of scope** — a manager or admin action in a later feature.
- **The manager's own review screens are out of scope**, including the out-of-range queue this feature feeds. This feature produces the records; reviewing them is a separate feature.
- **Correction requests for an already-saved pin are raised here but decided elsewhere** — the executive can raise one (FR-034); the manager's approval screen is a separate feature.
- **The executive's own "My visits" and "My totals" screens remain out of scope**, as in the previous feature.

### Reasonable defaults

- An order's quantity has no upper limit — only whole and not negative. A shop ordering an unusually large amount is a real business event, not an input error to reject.
- The brand's name is kept with each order line as it read at the time, so renaming or retiring a brand later never rewrites what an order recorded.
- The five-visit history excludes any visit still waiting to sync on this device, since it is not yet a recorded fact — avoiding a history that disagrees with the server's.
- A held submission is retried on reconnection and on app start; it is given up on only when the server rejects it in a way that cannot resolve by retrying (FR-040).
- Brands and reasons are read from the masters the admin already manages; this feature does not create or change them.
