# Feature Specification: Shops CRUD (Company Admin)

**Feature Branch**: `002-shops-crud`

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description: "Add CRUD functionality of the shops, Company admin login we have "Shops" in the hashboard as well as bottom menu, when ever user click the button need to redirect to the shops list page as mentioned in the UI(section - 4.8 Shops · list), while clicking the "New shop" button. it should redirect to he new shop creation page as mentioned in the UI(section- 4.9 New shop). If we click the shop on the list it should redirect to the same edite page UI looks like the create page. Very important UI should looks exactly same like the docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a shop in the directory (Priority: P1)

A Company Admin opens the "Shops" tile from the Admin home screen, or the "Shops" item on the bottom navigation bar, and lands on the shop directory (list). From there they search or filter to find a specific shop among potentially hundreds, without having to scroll through the whole list.

**Why this priority**: Every other shop action (create, edit, deactivate) starts from this list. Without reliable find-and-browse, admins cannot manage their shop master data at all.

**Independent Test**: Can be fully tested by tapping "Shops" from both entry points and confirming the same list screen opens, then searching/filtering it and confirming the result set narrows correctly — delivers value even before create/edit exists.

**Acceptance Scenarios**:

1. **Given** the Company Admin is on the Admin home screen, **When** they tap the "Shops" tile, **Then** the shop directory list opens showing all shops for their company.
2. **Given** the Company Admin is on any admin screen, **When** they tap "Shops" on the bottom navigation bar, **Then** the same shop directory list opens.
3. **Given** the shop directory is open, **When** the admin types a shop name, code, owner, or phone number into search, **Then** only matching shops remain visible.
4. **Given** the shop directory is open, **When** the admin selects the "No pin" quick filter, **Then** only shops without an approved location pin are shown; selecting "Inactive" shows only deactivated shops; selecting "All" clears both filters.
5. **Given** the shop directory is open and beat plans do not exist yet in this company, **When** the admin looks at the beat-plan filter, **Then** it is shown per the design but disabled, with a note that it becomes available once beat plans are set up.

---

### User Story 2 - Create a new shop (Priority: P1)

A Company Admin taps "New shop" from the shop directory and fills in the new-shop form, then saves it so the shop becomes available to assign to a beat plan.

**Why this priority**: Onboarding new outlets is the core reason the directory exists; without creation, the feature has no entry point for new data.

**Independent Test**: Can be fully tested by tapping "New shop," completing the required fields, saving, and confirming the shop now appears in the directory — independently valuable even if editing isn't built yet.

**Acceptance Scenarios**:

1. **Given** the Company Admin is on the shop directory, **When** they tap "New shop," **Then** the shop form opens empty, titled for creation, with no pre-filled data.
2. **Given** the new-shop form is open, **When** the admin enters a shop code, name, and the other shop details and saves, **Then** a new shop record is created and appears in the directory list.
3. **Given** the new-shop form is open, **When** the admin enters a shop code that already exists for their company, **Then** the save is rejected with a clear duplicate-code message and no new record is created.
4. **Given** the new-shop form is open, **When** the admin saves without entering a location (no map pin dropped), **Then** the shop still saves successfully, marked as having no approved location yet.
5. **Given** the new-shop form is open, **When** the admin attaches shop photos, **Then** up to 3 photos can be added from camera or gallery, a running count is shown, and any photo can be removed before or after saving.

---

### User Story 3 - Edit an existing shop (Priority: P1)

A Company Admin taps a shop row in the directory and reaches the same form used for creation, pre-filled with that shop's current details, makes changes, and saves them back to the same record.

**Why this priority**: Shop details change constantly (ownership, phone, address, status); without edit, master data goes stale and corrections are impossible.

**Independent Test**: Can be fully tested by opening an existing shop from the list, changing a field, saving, and confirming the directory and the shop's record reflect the change with no duplicate created.

**Acceptance Scenarios**:

1. **Given** the shop directory is open, **When** the admin taps any shop row, **Then** the shop form opens pre-filled with that shop's current data, visually the same screen as the new-shop form but titled for editing.
2. **Given** the edit form is open, **When** the admin changes one or more fields and saves, **Then** the existing shop record is updated in place and the directory reflects the new values.
3. **Given** the edit form is open, **When** the admin changes the shop code to one already used by another shop in the same company, **Then** the save is rejected with a duplicate-code message and the original record is left unchanged.
4. **Given** the edit form is open, **When** the admin switches the status field to inactive and saves, **Then** the shop is marked inactive, stops being assignable to new beat plans, and now appears under the "Inactive" filter in the directory.

---

### Edge Cases

- Searching or filtering the directory to zero results shows an empty state rather than an error.
- A shop already referenced by a beat plan, visit, or other history can be deactivated but cannot be permanently deleted; its history remains intact and readable.
- Reactivating a previously deactivated shop restores it to the "All" and relevant beat-plan filters.
- Very long shop names, addresses, or owner names must still render within the design's card/field layout without breaking it (truncation/wrapping as the design specifies), never a layout overflow.
- Saving a shop with the maximum 3 photos already attached disables further photo addition until one is removed.
- Two admins editing the same shop at nearly the same time: the later save wins; no silent data loss beyond the fields each admin actually changed is expected to be handled by standard last-write-wins, since no concurrent-edit locking is described for this entity.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a "Shops" entry point both as a tile on the Admin home screen and as an item on the Admin's four-item bottom navigation bar (Home · Visits · Beats · Shops); both MUST open the same shop directory (list) screen.
- **FR-002**: The shop directory list MUST show, per shop, its name, pin-capture status, address, shop code, assigned beat plan (or an "Unassigned" placeholder until beat plans exist), and owner — matching UI design reference section 4.8 exactly.
- **FR-003**: The shop directory MUST support searching by shop name, shop code, owner name, or phone number.
- **FR-004**: The shop directory MUST support filtering by pin status and active status, including quick filters for "All," "No pin," and "Inactive." The beat-plan filter control is shown per the design but disabled until beat plans exist as a feature (see Assumptions).
- **FR-005**: The shop directory MUST provide a "New shop" action that opens the shop form in creation mode, matching UI design reference section 4.9, with all fields empty.
- **FR-006**: Tapping any shop row in the directory MUST open the same shop form screen in edit mode, pre-filled with that shop's current saved data.
- **FR-007**: The shop form (create and edit) MUST present: an assigned-beat-plan field (shown per the design, disabled until beat plans exist as a feature), shop code, status, shop name, owner name, phone, address line 1, address line 2, city, state, PIN code, up to 3 shop photos (camera or gallery) with a visible count and a remove action, a location input (map search, drag-to-pin, or "skip — the executive captures it") that shows the coordinate's source, and an optional per-shop visit-radius override that defaults to the company-wide value.
- **FR-008**: System MUST require the shop code to be unique within the company; an attempt to save a duplicate code (on create or edit) MUST be rejected with a clear, specific error and MUST NOT overwrite the existing shop.
- **FR-009**: System MUST allow a shop to be saved without coordinates; the absence of an approved pin MUST NOT block saving the shop from this feature.
- **FR-010**: Saving changes from the edit form MUST update the existing shop record; it MUST NOT create a second, duplicate shop.
- **FR-011**: A shop already referenced by a beat plan, visit, or other history MUST be deactivatable (status set to inactive) but MUST NOT be permanently deletable; a deactivated shop's history MUST remain intact and viewable.
- **FR-012**: Only the Company Admin role MUST be able to view, create, edit, or deactivate shops through this feature; the Shops entry points and screens MUST NOT be exposed to other roles' navigation.
- **FR-013**: Every screen and state covered by this feature — the directory in its "All," "No pin," and "Inactive" states, and the shop form in its "new" and "edit" states — MUST visually match its corresponding board in `docs/ui-design/Field_Sales_Beat_App.html` exactly: colors, spacing, typography, icon shapes, border radii, and layout, with no approximated placeholders.

### Key Entities

- **Shop**: a company-scoped master record for one outlet on a beat. Holds a company-unique shop code, name, owner name, phone, address (two lines, city, state, PIN code), up to 3 photos, an approved location (optional until the first recorded visit, with its capture source), an optional per-shop visit-radius override, an assigned beat plan, and an active/inactive status. Already-referenced shops are deactivated, never deleted.
- **Shop Photo**: 0 to 3 images attached to a Shop, addable from camera or gallery and individually removable.
- **Beat Plan** *(referenced, not owned by this feature)*: the route a shop can be assigned to; shown as a field on the shop form and a filter on the directory, per the design. The `Shop` entity does not own this relationship — a shop's membership in a beat plan is recorded when the beat plan itself is created or edited, a separate feature not yet built. Until it exists, this feature's beat-plan field and filter are visible but disabled.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Company Admin can locate any single shop in a directory of 500+ shops, by name, code, owner, or phone, in under 10 seconds.
- **SC-002**: A Company Admin can create a complete, valid new shop record in under 2 minutes from tapping "New shop" to a confirmed save.
- **SC-003**: Every screen state delivered by this feature is visually indistinguishable — colors, spacing, type, icon shapes, border radii, layout — from its corresponding board in the UI design reference, verified by side-by-side comparison.
- **SC-004**: 100% of edits made through the edit form update the original shop record; zero duplicate shop records are produced by the edit flow.
- **SC-005**: 100% of deactivation attempts on a shop with existing history (beat plan, visit, etc.) succeed as a status change and preserve that history; none result in the record or its history disappearing.

## Assumptions

- Only the Company Admin manages shop master data in this feature. The Marketing Executive's first-visit pin-capture flow (screen 1.8) and the manager/admin pin-change approval workflow are existing, separate capabilities this feature does not re-implement — the shop form here only offers map search, drag-to-pin, or "skip" at creation/edit time.
- "Delete" in this CRUD feature means deactivation (status set to Inactive); there is no permanent-delete action anywhere in this feature, consistent with the rule that a master row already referenced by history can be deactivated but not deleted. A never-referenced shop is also only deactivated, not deleted, to keep the behavior uniform and predictable.
- The shop form's location picker (map search / drag-to-pin) reuses whichever mapping capability the rest of the product already relies on; this spec does not select or evaluate a map provider.
- A shop is assigned to one beat plan from this form at a time; a shop appearing on multiple beat plans (allowed elsewhere per the product's open decisions) is managed through beat-plan editing, not through this feature.
- Beat plans do not exist as a feature yet (they are a separate, later slice). This feature ships the beat-plan field on the shop form and the beat-plan filter on the directory exactly as the design shows them, but both stay disabled with an explanatory note until that feature lands and can supply real data — nothing in this feature invents a placeholder beat-plan data model.
- Company Admin screens assume a normal network connection; unlike the executive's offline-tolerant visit flow, shop create/edit in this feature is not required to queue or sync while offline.
