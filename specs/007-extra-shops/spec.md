# Feature Specification: Add Extra Shop — Executive

**Feature Branch**: `007-extra-shops`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Before the end the beat, we need 'Add extra shop' option as per the design we have new page to add the extra shop (1.4 Add extra shop (executive))"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a nearby shop to today's list (Priority: P1)

An executive is out on the beat and passes a shop that is not on today's route — a new customer, or one that belongs to a colleague's beat. While the beat is running they open "Add extra shop", see the shops around them that are not already on today's list with the closest first, pick one, and it becomes a stop on today's route straight away. Their saved beat plan is untouched.

**Why this priority**: This is the feature. Everything else on this screen exists to serve it, and without it the executive's only way to record a real visit to an unplanned shop is to not record it at all.

**Independent Test**: Start a beat, open the screen, pick the nearest listed shop, add it, and confirm it appears on today's list tagged as extra — then confirm the beat plan and tomorrow's route are byte-identical to before.

**Acceptance Scenarios**:

1. **Given** a running beat and a company shop that is not on today's list, **When** the executive opens the screen, **Then** that shop appears in the list with its distance, its location status and the beat it belongs to.
2. **Given** a shop is selected, **When** the executive confirms, **Then** the shop becomes a stop on today's route, tagged as added by that executive with the time it was added, and the executive returns to today's list where it shows as an extra stop.
3. **Given** a shop has just been added as an extra stop, **When** the beat plan behind today's route is inspected, **Then** it is unchanged — same shops, same order, same name.
4. **Given** a shop is already on today's list, **When** the executive opens the screen, **Then** that shop is not offered.
5. **Given** no shop has been selected, **When** the executive looks at the footer, **Then** it reads that a shop must be chosen and the add action is unavailable.

---

### User Story 2 - Find a shop that is not nearby (Priority: P1)

The shop the executive wants is not among the closest few — it is further down the list, or the executive is standing somewhere the positions do not help. They type part of the shop's name or the owner's name and the list narrows to matches.

**Why this priority**: Proximity alone fails the moment the list is long or the executive's position is poor. Without search the screen is unusable for any company with more than a handful of shops, so it ships with the core flow rather than after it.

**Independent Test**: Type a fragment of a shop's name, then of an owner's name, and confirm each narrows the list to the expected shops and that shops already on today's list stay excluded.

**Acceptance Scenarios**:

1. **Given** a search term matching part of a shop's name, **When** it is typed, **Then** only matching shops not already on today's list are listed.
2. **Given** a search term matching part of an owner's name, **When** it is typed, **Then** that owner's shops are listed.
3. **Given** a search term matching nothing, **When** it is typed, **Then** the executive is told plainly that no shop matches and is offered the option to create one.
4. **Given** a search term is cleared, **When** the list returns, **Then** it is ordered closest first again.

---

### User Story 3 - Add a shop that is not in the directory yet (Priority: P2)

The shop in front of the executive has never been entered into the system. From the same screen they open a form to create it, with their current position already filled in as the shop's location, and on saving it is both added to the company's shops and placed on today's list as an extra stop.

**Why this priority**: Real routes meet new shops, and an executive who cannot record one loses the visit entirely. It is P2 rather than P1 because an executive can still complete a day's work without it, and because it reaches beyond today's route into the company's master data, which carries its own review question.

**Independent Test**: From the picker, create a shop, and confirm it exists in the company's shop directory, is flagged for the Company Admin to review, and is on today's list as an extra stop.

**Acceptance Scenarios**:

1. **Given** the shop is not listed, **When** the executive chooses to create one, **Then** a shop form opens with the current position already set as the shop's location.
2. **Given** the form is completed and saved, **Then** the shop is created for the company and added to today's list as an extra stop in the same action.
3. **Given** a shop was created this way, **When** a Company Admin reviews the shop directory, **Then** the shop is identifiable as executive-created and awaiting confirmation.

---

### User Story 4 - Visit the extra shop like any other (Priority: P2)

Having added the shop, the executive taps it on today's list and records an order or a no-order exactly as they would for a planned stop — including capturing the shop's location first if it has none.

**Why this priority**: An extra stop that cannot be visited is decoration. It is P2 only because the visit machinery already exists; what is being proved here is that an extra stop is not a second-class one.

**Independent Test**: Add an extra shop, record an outcome at it, and confirm the visit is recorded with the same facts, checks and review routing as a planned stop, carrying its extra tag.

**Acceptance Scenarios**:

1. **Given** an extra stop whose shop has an approved location, **When** it is tapped, **Then** the visit screen opens exactly as for a planned stop.
2. **Given** an extra stop whose shop has no approved location, **When** it is tapped, **Then** the location-capture screen opens, as it would for a planned stop.
3. **Given** an outcome is recorded at an extra stop, **Then** the server measures and stores the distance, the radius in force and any flags exactly as for a planned stop, and the record carries the extra source.

---

### Edge Cases

- **The beat has not been started.** The screen cannot be reached, and today's list continues to explain that starting the beat is what unlocks recording visits and adding extra shops.
- **The beat has already been ended.** Adding is refused — the day is closed, and a shop added after the fact would misrepresent it.
- **Every eligible shop is already on today's list.** The list is empty and says so, rather than showing a blank panel; creating a new shop is still offered.
- **The device cannot get a position.** The executive is told what is wrong and can still search by name; the distances are simply absent rather than guessed, and adding still works.
- **Two devices, or a double tap, add the same shop at the same moment.** Exactly one extra stop results; the second attempt is reported as already added, not as a second stop and not as an unexplained failure.
- **The shop was added to today's list by a manager seconds ago.** The picker no longer offers it, and an add that was already in flight is refused as a duplicate rather than creating a second stop.
- **The shop is inactive in the company's directory.** It is not offered.
- **A shop is added and then the beat is ended without visiting it.** The stop remains on the day as an unvisited extra stop — the record of the day stays honest.
- **Today has no beat plan at all** (a non-working day, or no plan assigned). Once the beat is started, extra shops can still be added, and the day consists only of extra stops.
- **The connection drops while adding.** The executive is told the add did not complete and can retry; a retry never produces two stops.
- **The shop's location changes, or the company's radius changes, after the stop was added.** The stop keeps the values frozen when it was created, exactly as a planned stop does.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the screen

- **FR-001**: The executive MUST be able to open "Add extra shop" from today's beat screen while the beat is running, from the same action area as "End beat" — matching UI design reference section 1.3.
- **FR-002**: Adding an extra shop MUST be possible only while the executive's own beat for today is running — never before it is started, and never after it is ended.

#### Choosing a shop

- **FR-003**: The screen MUST list the company's active shops that are **not already on today's list**, matching UI design reference section 1.4.
- **FR-004**: The list MUST be ordered nearest first and MUST show each shop's distance from the executive's current position.
- **FR-005**: Each shop in the list MUST show its name, its address, whether its location is already saved or still needs capturing on arrival, and the beat plan it belongs to — or that it belongs to none.
- **FR-006**: Search MUST match a shop's name, its code and its owner's name, and MUST keep excluding shops already on today's list.
- **FR-007**: When nothing matches a search, and when there is no shop left to add, the executive MUST be told so explicitly rather than shown an empty panel.
- **FR-008**: Exactly one shop MUST be selectable at a time. Until one is selected the add action MUST be unavailable and the screen MUST say a shop needs choosing; once selected, the screen MUST name the shop and the position it will take on today's list.

#### Adding the shop

- **FR-009**: Adding MUST place the shop on **today's list only**, recorded as added by that executive, with the time it was added.
- **FR-010**: Adding MUST NOT modify the beat plan in any way, and MUST NOT affect any other day — past, present or future.
- **FR-011**: A shop that is already on today's list MUST NOT be addable a second time. This MUST be refused by the server, not only hidden by the picker, and the refusal MUST be reported to the executive in plain language.
- **FR-012**: Repeating the same add — a double tap, a retry after a lost response — MUST result in exactly one extra stop.
- **FR-013**: An extra stop MUST freeze the same facts a planned stop freezes at creation: the radius in force and the shop's approved location at that moment. Later changes to either MUST NOT alter it.
- **FR-014**: An extra stop MUST behave identically to a planned stop for recording outcomes, for the server's distance measurement and review routing, and in reporting — carrying its source so it can always be told apart.
- **FR-015**: Every add MUST be recorded in the company's audit trail with the acting executive and the shop added.

#### Creating a shop that is not listed

- **FR-016**: The screen MUST offer "Shop not listed — create new", which opens the shop form with the executive's current position already filled in as the shop's location.
- **FR-017**: A shop created this way MUST be added to today's list as an extra stop as part of the same action — the executive MUST NOT have to find it again afterwards.
- **FR-018**: A shop created by an executive MUST be identifiable to the Company Admin as executive-created and awaiting their confirmation.

#### Location — what it is used for and what is said about it

- **FR-019**: The screen MUST capture the executive's position when it opens, and use it solely to order the list and show distances.
- **FR-020**: The app's location-permission request MUST state that location is also used to find shops near the executive, so that what the app does remains fully disclosed at the point permission is granted.
- **FR-021**: The distance shown on this screen is the executive's distance to a shop they are choosing. It MUST NOT be, and MUST NOT be presented as, the distance a visit is measured at. The rule that an executive is never shown a visit's measured distance, its range verdict or any quality flag MUST remain unbroken by this feature.
- **FR-022**: Nothing the device sends MUST be able to influence what the server records for a stop or a visit — the radius, the frozen location, the measured distance and the flags remain the server's alone.

#### Working without a connection

- **FR-023**: An add submitted without a connection MUST be accepted, held on the device, and shown as waiting to sync — never reported as a failure and never discarded. Held adds MUST survive the app being closed and reopened, and MUST carry the same unique key from the moment they are recorded so a retry adds the shop exactly once.
- **FR-024**: Choosing a shop MUST require a connection, because the list of shops that can be added is read from the server. When there is none, the executive MUST be told that plainly rather than shown an empty list. A shop whose add is still waiting to sync MUST be shown as waiting rather than as a stop that can be opened.

#### Fidelity

- **FR-025**: Every screen in this feature MUST visually match its board in `docs/ui-design/Field_Sales_Beat_App.html` — section 1.4, and the added action on section 1.3 — exactly in colors, spacing, typography, icon shapes, border radii and layout, with no approximated placeholders.

### Key Entities

- **Extra stop**: a stop on one day's route that did not come from the beat plan — which shop, where it sits in the day, who added it, when, and the radius and shop location frozen at that moment. It is an ordinary stop in every respect except its source.
- **Today's route** *(referenced)*: the day's list of stops for one executive, which an extra stop joins and nothing else about which changes.
- **Beat plan** *(referenced, never written)*: the saved route an extra stop must never touch.
- **Shop** *(referenced, created in User Story 3)*: the company's record of a shop — its name, code, owner, address and saved location.
- **Shop choice** *(a read, for the picker)*: what the executive is shown per shop while choosing — name, address, location status, beat membership and distance. Deliberately narrower than the admin's view of a shop.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An executive can go from today's list to an added extra shop in under 20 seconds when the shop is among the nearest few.
- **SC-002**: An executive can find and add any shop in a 500-shop company directory by name in under 30 seconds.
- **SC-003**: The screen delivered is visually indistinguishable from its board in the UI design reference, verified side by side, with zero documented divergences.
- **SC-004**: In 100% of cases, adding an extra shop leaves the beat plan byte-identical and leaves every other day's route unchanged.
- **SC-005**: 100% of adds result in exactly one extra stop, including double taps, retries and concurrent attempts from two devices. Zero duplicates.
- **SC-006**: Zero shops already on today's list can be added again, whether through the picker or by a direct request to the server.
- **SC-007**: Zero screens in this feature show an executive a visit's measured distance, its range verdict or any quality flag.
- **SC-008**: 100% of extra stops accept outcomes, distance measurement and review routing identically to planned stops, and carry their source through to reporting.
- **SC-009**: Zero cross-executive leakage: an executive can only ever add a stop to their own day for today.
- **SC-010**: 100% of adds appear in the company's audit trail with the acting executive.
- **SC-011**: 100% of adds submitted without a connection are eventually recorded on the server, with zero lost to an app restart and zero recorded twice.

## Assumptions

### Decisions taken with the user (2026-10-19)

- **The screen matches the board, including distances and nearest-first ordering.** The user was asked directly, because showing a distance tells the executive the app is reading their location — and the previous feature deliberately made the submit screen silent about exactly that. The decision was to match the board. The two are not in conflict: the earlier requirement was that the executive not be told a position is being captured **as part of saving an order or a no-order** (006 FR-018), and that stands untouched. Here the position is used to help the executive find a shop, which is visible and useful to them. The consequence is recorded in FR-020: the permission wording must widen to cover it.
- **Scope is the executive's flow only.** The manager's "Add extra shop to today" screen (design section 3.2, PRD FR-EXTRA-05) and the push notification it sends (FR-EXTRA-09) are out of this feature; the product documentation marks both as a later release.

### Resolutions of conflicts found in the product documentation

- **Open decision OD-08 is taken as its documented default, which three sources agree on.** The business requirements record "Does the executive's extra shop need manager approval first?" as answered "No; added immediately and shown to the manager as an extra visit", but still marked *needs client confirmation*. The architecture resolves the same question as "No for release 1; flag it as an extra visit", and the design agrees — the board's button adds the shop to today's list with no approval step anywhere on the screen. This feature therefore implements immediate addition. It stays listed here because "needs client confirmation" is the client's word to give; what has changed is that the default is well-supported rather than merely assumed. **If the client confirms otherwise, this feature changes shape.**
- **A shop created by an executive may not be immediately visitable.** FR-EXTRA-04 requires executive-created shops to be marked for Company Admin review, while recording any outcome requires an *approved* shop location. Whether the executive can record an outcome at the shop they just created therefore depends on the same company auto-approval setting already flagged in the previous feature. **With auto-approval off, an executive can create a shop but not record anything at it** — the same dead-end, now reachable by a second route, and the same recommendation applies: the pilot company should have auto-approval enabled.
- **"Marked for Company Admin review" uses the location-approval state that already exists** rather than introducing a separate shop-review queue. The admin sees the shop with its location awaiting confirmation. A dedicated review surface for executive-created shops is a Company Admin feature, not this one.

### Scope boundaries

- **The manager's extra-shop flow is out of scope**, including choosing an executive, the reason it requires, and the push notification to that executive.
- **Removing an extra stop is out of scope.** Nothing in the design or the requirements offers it, and a stop that can be silently removed would undermine the day's record. A stop added by mistake stays on the day, unvisited.
- **Reordering today's list is out of scope.** Extra stops take their place by the existing ordering rules.
- **The Company Admin's review surface for executive-created shops is out of scope** (see above).
- **Browsing shops offline is out of scope; adding offline is not.** The architecture names extra-shop addition as one of the four queueable commands, so a submitted add is held on the device and syncs exactly once (FR-023). The *picker* is a read, which the same rule says is never queued — so the screen still needs a connection to be useful (FR-024). Caching the shop directory for offline browsing is a separate concern.
- **A stop added while offline cannot be visited until it syncs**, because the identity a visit is recorded against is the server's. The executive sees it as waiting rather than as a stop they can open. Closing that gap would mean letting the device mint an identity the server adopts — a change to how visits are recorded, not to this feature.

### Reasonable defaults

- The picker offers only **active** shops. An inactive shop is one the company has withdrawn, and putting it back on a route through a side door would defeat that.
- Distance is shown rounded the way the board shows it — metres while close, kilometres once far — because it is an aid to recognising which shop is meant, not a measurement.
- A poor or missing position degrades the screen rather than blocking it: the list falls back to a stable order, distances are omitted, and search still works. Refusing to let an executive add a shop because a GPS fix was slow would be the worse failure.
- An extra stop joins today's list under the ordering already in force — extra stops first within their status group — rather than being inserted at a chosen position. The design shows no way to choose a position.
- The shop form reached from "Shop not listed" is the form that already exists for creating a shop, with its location pre-filled, rather than a second cut-down form that could drift from it.
