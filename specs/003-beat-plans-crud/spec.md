# Feature Specification: Beat Plans CRUD (Company Admin)

**Feature Branch**: `003-beat-plans-crud`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "CRUD functionality implementation, Company admin login we have "Beat Plan" in the Dashboard as well as bottom menu we have "Beats", when ever user click the button need to redirect to the Beat Plans list page as mentioned in the UI(section - 4.6 Beat plans · list), while clicking the "New beat plan" button. it should redirect to the New beat plan creation page as mentioned in the UI(section- 4.7 New beat plan). If we click the Beat plans on the list it should redirect to the same edit page UI looks like the create page. Very important UI should looks exactly same like the docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a beat plan in the directory (Priority: P1)

A Company Admin opens the "Beat plans" tile from the Admin home screen, or the "Beats" item on the bottom navigation bar, and lands on the beat plan directory (list). From there they search or filter to find a specific plan among potentially many, without scrolling through the whole list.

**Why this priority**: Every other beat-plan action (create, edit) starts from this list. Without reliable find-and-browse, admins cannot manage their beat plans at all.

**Independent Test**: Can be fully tested by tapping "Beat plans"/"Beats" from both entry points and confirming the same list screen opens, then searching/filtering it and confirming the result set narrows correctly — delivers value even before create/edit exists.

**Acceptance Scenarios**:

1. **Given** the Company Admin is on the Admin home screen, **When** they tap the "Beat plans" tile, **Then** the beat plan directory list opens showing all beat plans for their company.
2. **Given** the Company Admin is on any admin screen, **When** they tap "Beats" on the bottom navigation bar, **Then** the same beat plan directory list opens.
3. **Given** the beat plan directory is open, **When** the admin types a beat plan name or assigned executive's name into search, **Then** only matching plans remain visible.
4. **Given** the beat plan directory is open, **When** the admin selects the "Unassigned" quick filter, **Then** only plans with no assigned executive are shown; selecting "Inactive" shows only deactivated plans; selecting "All" clears both filters.

---

### User Story 2 - Create a new beat plan (Priority: P1)

A Company Admin taps "New beat plan" from the directory and fills in the new-plan form — name, code, assigned executive, working days, and an ordered list of shops — then saves it so the plan becomes available for the executive's daily route.

**Why this priority**: Building new routes is the core reason the directory exists; without creation, the feature has no entry point for new data.

**Independent Test**: Can be fully tested by tapping "New beat plan," completing the form, saving, and confirming the plan now appears in the directory — independently valuable even if editing isn't built yet.

**Acceptance Scenarios**:

1. **Given** the Company Admin is on the beat plan directory, **When** they tap "New beat plan," **Then** the beat plan form opens empty, titled for creation, with no pre-filled data and no shops yet in the ordered list.
2. **Given** the new-plan form is open, **When** the admin enters a name and code, optionally assigns an executive, toggles the working days, adds one or more existing shops to the ordered list, and saves, **Then** a new beat plan is created and appears in the directory.
3. **Given** the new-plan form is open, **When** the admin enters a plan code that already exists for their company, **Then** the save is rejected with a clear duplicate-code message and no new plan is created.
4. **Given** the new-plan form is open, **When** the admin saves without assigning an executive, **Then** the plan still saves successfully and appears under the "Unassigned" filter in the directory.
5. **Given** the new-plan form is open, **When** the admin taps "Add existing shops," **Then** they can pick from the company's shop directory and the picked shops are appended to the ordered list in the order picked.
6. **Given** the new-plan form is open, **When** the admin taps "Create a new shop in this beat," **Then** they can create a brand-new shop and it is added to this plan's ordered list once saved.
7. **Given** the new-plan form is open with shops already in the list, **When** the admin reorders them, **Then** the saved plan reflects the new sequence.

---

### User Story 3 - Edit an existing beat plan (Priority: P1)

A Company Admin taps a beat plan row in the directory and reaches the same form used for creation, pre-filled with that plan's current name, code, executive, working days, and ordered shop list, makes changes, and saves them back to the same record.

**Why this priority**: Routes change constantly (executive reassignment, working-day changes, shop additions/removals/reordering); without edit, beat plans go stale and corrections are impossible.

**Independent Test**: Can be fully tested by opening an existing plan from the directory, changing a field or the shop order, saving, and confirming the directory and the plan's record reflect the change with no duplicate plan created.

**Acceptance Scenarios**:

1. **Given** the beat plan directory is open, **When** the admin taps any plan row, **Then** the beat plan form opens pre-filled with that plan's current name, code, executive, working days, and ordered shop list — visually the same screen as the new-plan form but titled for editing.
2. **Given** the edit form is open, **When** the admin changes one or more fields (including reassigning the executive or reordering shops) and saves, **Then** the existing beat plan record is updated in place and the directory reflects the new values.
3. **Given** the edit form is open, **When** the admin changes the plan code to one already used by another plan in the same company, **Then** the save is rejected with a duplicate-code message and the original record is left unchanged.
4. **Given** the edit form is open, **When** the admin removes a shop from the ordered list and saves, **Then** that shop no longer appears in the plan, and the remaining shops keep a valid, gap-free sequence.
5. **Given** the edit form is open, **When** the admin switches the plan to inactive and saves, **Then** the plan is marked inactive and now appears under the "Inactive" filter in the directory.

---

### Edge Cases

- Searching or filtering the directory to zero results shows an empty state rather than an error.
- A beat plan already referenced by history (e.g. it has produced a daily route for an executive) can be deactivated but cannot be permanently deleted; its history remains intact and readable.
- Reactivating a previously deactivated plan restores it to the "All" filter and search.
- The same shop can appear on more than one beat plan at the same time (an existing, open product decision) — adding a shop already used elsewhere is not blocked by this feature.
- Adding the same shop to the same plan's list a second time does not create a duplicate entry.
- Removing every shop from a plan's ordered list and saving leaves a valid plan with an empty route, not an error.
- A plan can be saved with zero working days selected (e.g. temporarily paused) without being treated as invalid.
- Very long beat plan or executive names must still render within the design's card/field layout without breaking it, never a layout overflow.
- Two admins editing the same plan at nearly the same time: the later save wins; no special concurrent-edit locking is expected, consistent with how shop edits already behave.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a "Beat plans" entry point both as a tile on the Admin home screen and as an item ("Beats") on the Admin's four-item bottom navigation bar; both MUST open the same beat plan directory (list) screen.
- **FR-002**: The beat plan directory list MUST show, per plan, its name, code, assigned executive (or an indication that none is assigned), shop count, working days, and status — matching UI design reference section 4.6 exactly.
- **FR-003**: The beat plan directory MUST support searching by beat plan name or assigned executive's name.
- **FR-004**: The beat plan directory MUST support filtering by assignment and active status, including quick filters for "All," "Unassigned," and "Inactive."
- **FR-005**: The beat plan directory MUST provide a "New beat plan" action that opens the beat plan form in creation mode, matching UI design reference section 4.7, with all fields empty and no shops in the ordered list.
- **FR-006**: Tapping any beat plan row in the directory MUST open the same beat plan form screen in edit mode, pre-filled with that plan's current saved data.
- **FR-007**: The beat plan form (create and edit) MUST present: beat plan name, code, an assigned-executive selector (optional — a plan may have no executive), a working-day toggle for each day of the week, and an ordered list of the plan's shops showing each shop's sequence number, name, and pin status.
- **FR-008**: The beat plan form MUST let the admin add shops to the ordered list either by picking from the company's existing shop directory or by creating a brand-new shop, which is then added to the list.
- **FR-009**: The beat plan form MUST let the admin reorder the shops in the list and remove a shop from the list.
- **FR-010**: System MUST require the beat plan code to be unique within the company; an attempt to save a duplicate code (on create or edit) MUST be rejected with a clear, specific error and MUST NOT overwrite the existing plan.
- **FR-011**: System MUST allow a beat plan to be saved with no assigned executive and with no shops in its ordered list; neither is required to save.
- **FR-012**: Saving changes from the edit form MUST update the existing beat plan record; it MUST NOT create a second, duplicate plan.
- **FR-013**: A beat plan already referenced by history MUST be deactivatable (status set to inactive) but MUST NOT be permanently deletable; a deactivated plan's history MUST remain intact and viewable.
- **FR-014**: Only the Company Admin role MUST be able to view, create, edit, or deactivate beat plans through this feature; the Beat plans entry points and screens MUST NOT be exposed to other roles' navigation.
- **FR-015**: Every screen and state covered by this feature — the directory in its "All," "Unassigned," and "Inactive" states, and the beat plan form in its "new" and "edit" states — MUST visually match its corresponding board in `docs/ui-design/Field_Sales_Beat_App.html` exactly: colors, spacing, typography, icon shapes, border radii, and layout, with no approximated placeholders.
- **FR-016**: The beat plan form MUST state that changes take effect from the next daily route and never rewrite a route already generated for a past or in-progress day, matching the design's own copy.

### Key Entities

- **Beat Plan**: a company-scoped master record for one executive's fixed route. Holds a company-unique code, a name, an optional assigned executive, which days of the week it runs, an ordered list of shops, and an active/inactive status. Already-referenced plans are deactivated, never deleted.
- **Beat Plan Shop** *(the ordered list itself)*: a shop's position (sequence) within one beat plan. The same shop may appear on more than one beat plan. Removing a shop from the list removes only that plan's entry, never the shop itself.
- **Shop** *(referenced, not owned by this feature)*: an existing company-scoped outlet (see the shop-directory feature). This feature can add an existing shop to a plan's list or create a brand-new one inline, but shop fields themselves (address, photos, location, etc.) are managed there, not here.
- **Executive** *(referenced, not owned by this feature)*: an existing company user who runs the beat. This feature only assigns/reassigns one to a plan; user creation and management live in the users feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Company Admin can locate any single beat plan in a directory of 50+ plans, by name or assigned executive, in under 10 seconds.
- **SC-002**: A Company Admin can create a complete, valid new beat plan — including an ordered shop list of 10+ stops — in under 3 minutes from tapping "New beat plan" to a confirmed save.
- **SC-003**: Every screen state delivered by this feature is visually indistinguishable — colors, spacing, type, icon shapes, border radii, layout — from its corresponding board in the UI design reference, verified by side-by-side comparison.
- **SC-004**: 100% of edits made through the edit form update the original beat plan record; zero duplicate plans are produced by the edit flow.
- **SC-005**: 100% of deactivation attempts on a plan with existing history succeed as a status change and preserve that history; none result in the record or its history disappearing.
- **SC-006**: Reordering a 10-stop shop list and saving preserves the exact new order on reload, with no gaps or duplicate sequence numbers.

## Assumptions

- The "assigned executive" selector offers only this company's active Marketing Executive users — the one role that actually runs a beat (BRD's role definitions) — not every user in the company.
- "Delete" in this CRUD feature means deactivation (status set to Inactive); there is no permanent-delete action anywhere in this feature, consistent with the same rule already applied to shops and users in this product.
- A shop already assigned to one or more other beat plans can still be added to this one — the product explicitly allows a shop to belong to several plans; preventing a *same-day* double-assignment to one executive is a concern for the (not-yet-built) daily-route feature, not for saving a beat plan here.
- "Changes apply from the next daily route, never rewriting a past or in-progress one" is a forward-looking statement this form displays to the admin; the actual daily-route snapshot mechanism that statement refers to is a separate, not-yet-built feature — this feature only needs to save the plan itself correctly, not generate or protect snapshots that don't exist yet.
- The shop directory's "Beat plan" field and filter (currently shown disabled, pending this feature) are explicitly out of scope here — wiring them to real beat-plan data is a follow-up to this feature, not included in it.
- Working-day selection has no minimum — a plan can be saved with every day off (e.g. temporarily paused) without being treated as invalid.
