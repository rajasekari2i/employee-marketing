# Feature Specification: Brands & Reasons CRUD (Company Admin)

**Feature Branch**: `004-brands-reasons-crud`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Brands & reasons CRUD functionality implimenation, Company admin login we have "Brands & reasons" in the Dashboard, when ever user click the button need to redirect to the Brands & reasons list page as mentioned in the UI(section - 4.12 Reasons & brands) & add new reasong using the add button. Very important UI should looks exactly same like the docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reach the masters screen from the dashboard (Priority: P1)

A Company Admin on the Admin home screen taps the "Brands & reasons" tile and lands on the masters screen, which opens on the **No-order reasons** tab showing that company's reasons in their display order, with a second tab for **Brands**. Each tab label carries its own live count, and the home tile's subtitle shows both counts. Today this tile is an inert "Coming soon" placeholder; this story makes it a real destination.

**Why this priority**: Every other action in this feature starts here. Until the tile navigates somewhere, no brand or reason can be viewed or managed at all, and the admin cannot complete the product's documented setup step of loading brands and reasons.

**Independent Test**: Can be fully tested by signing in as a Company Admin, tapping the "Brands & reasons" tile, and confirming the masters screen opens on the reasons tab with the company's current data and correct counts — delivers value (visibility of the masters) even before any add, reorder or activation exists.

**Acceptance Scenarios**:

1. **Given** the Company Admin is on the Admin home screen, **When** they tap the "Brands & reasons" tile, **Then** the masters screen opens on the "No-order reasons" tab, listing that company's reasons in display order.
2. **Given** the masters screen is open, **When** the admin reads the two tab labels, **Then** each shows its own live item count (for example "No-order reasons · 9" and "Brands · 22"), and the reasons count includes the pinned "Other" entry.
3. **Given** the masters screen is open on the reasons tab, **When** the admin taps the "Brands" tab, **Then** the list switches to that company's brands in display order and the tab's selected styling moves with it.
4. **Given** the masters screen is open, **When** the admin taps the back control in the header, **Then** they return to the Admin home screen.
5. **Given** the Company Admin is on the Admin home screen, **When** they read the "Brands & reasons" tile subtitle, **Then** it shows the live counts for their company (for example "22 brands · 9 reasons"), not a "Coming soon" placeholder.
6. **Given** a company that has never had a brand or reason added, **When** the admin opens the masters screen, **Then** the brands tab shows an empty list and the reasons tab shows only the pinned "Other" entry — neither is an error state.

---

### User Story 2 - Add a no-order reason (Priority: P1)

A Company Admin types a new reason label into the add field at the top of the reasons tab, taps **Add**, and the reason appears at the end of the list (above the pinned "Other" entry), active and ready for executives to pick when they record a no-order outcome.

**Why this priority**: This is the explicit request in the feature description and the reason the screen exists. Standardised no-order reasons are what make refusals countable rather than free text, which is a stated business objective.

**Independent Test**: Can be fully tested by opening the reasons tab, typing a label, tapping Add, and confirming the new reason appears in the list and survives leaving and re-entering the screen — independently valuable even if brands, reorder and activation are not yet built.

**Acceptance Scenarios**:

1. **Given** the reasons tab is open, **When** the admin types a new reason label and taps "Add", **Then** the reason is saved, appears at the end of the reason list but above the pinned "Other" entry, is active by default, the add field clears, and the tab count increases by one.
2. **Given** the reasons tab is open, **When** the admin taps "Add" with the field empty or containing only spaces, **Then** nothing is created and the admin is told a label is required.
3. **Given** the reasons tab is open, **When** the admin adds a label that already exists in that company's reason list (ignoring case and surrounding spaces), **Then** the save is rejected with a clear duplicate message and no second entry is created.
4. **Given** the reasons tab is open, **When** the admin tries to add a reason labelled "Other", **Then** it is rejected as a duplicate of the system entry that already exists.
5. **Given** the admin taps "Add" and the response is slow, **When** they tap "Add" a second time for the same entry, **Then** only one reason is created, not two.
6. **Given** a reason was just added, **When** the admin leaves the screen and returns, **Then** the reason is still present in the same position.

---

### User Story 3 - Add a brand (Priority: P1)

A Company Admin switches to the **Brands** tab and adds a brand label the same way, so order lines can later be recorded against a known, ordered brand list rather than free text.

**Why this priority**: Brands and reasons are the two halves of one screen and one product capability; an admin setting up a company needs both. It sits alongside reasons rather than after them, but the reasons half is what the feature description called out first.

**Independent Test**: Can be fully tested by switching to the Brands tab, adding a brand, and confirming it appears in the list and persists — independently valuable and separable from the reasons half.

**Acceptance Scenarios**:

1. **Given** the brands tab is open, **When** the admin types a brand label and taps "Add", **Then** the brand is saved, appears at the end of the brand list, is active by default, the add field clears, and the tab count increases by one.
2. **Given** the brands tab is open, **When** the admin reads the add field, **Then** its placeholder names a brand rather than a reason, matching whichever tab is selected.
3. **Given** the brands tab is open, **When** the admin adds a label already used by another brand in that company (ignoring case and surrounding spaces), **Then** the save is rejected with a clear duplicate message.
4. **Given** a brand and a reason share the same label text, **When** both are saved, **Then** both are accepted — the two lists are independent and do not collide with each other.
5. **Given** the brands tab is open, **When** the admin looks for a pinned "Other" entry, **Then** there is none — the locked "Other" row belongs to the reasons list only.

---

### User Story 4 - Reorder a list (Priority: P2)

A Company Admin drags a row by its handle to a new position, and the list's display order is saved so that executives later see the entries in the admin's chosen sequence.

**Why this priority**: Display order shapes what the executive sees first in the field, so it matters — but the lists are usable and correct before reordering exists, which makes this valuable rather than blocking.

**Independent Test**: Can be fully tested by dragging a row to a new position, leaving the screen, returning, and confirming the new order persisted with gap-free numbering.

**Acceptance Scenarios**:

1. **Given** a list of several entries, **When** the admin drags a row to a new position, **Then** the displayed order numbers renumber immediately and the new order is saved.
2. **Given** a reorder has been saved, **When** the admin leaves the screen and returns, **Then** the entries appear in the new order with sequential, gap-free numbering starting at 1.
3. **Given** the reasons tab is open, **When** the admin attempts to drag the pinned "Other" entry or to drop another row below it, **Then** "Other" stays last and the attempt does not move it.
4. **Given** a list containing both active and inactive entries, **When** the admin reorders it, **Then** both kinds take part in the same single ordering — inactive entries are not segregated into a separate section.

---

### User Story 5 - Deactivate and reactivate an entry (Priority: P2)

A Company Admin flips the switch on a row to deactivate a brand or reason that should no longer be offered in the field, and flips it back to bring it into use again. Deactivation never removes the row or any history that references it.

**Why this priority**: Retiring an obsolete brand or reason without destroying the history that references it is the product's stated rule for master data. It is needed for long-term use but not for first setup, so it follows the add flows.

**Independent Test**: Can be fully tested by toggling a row off, confirming it renders in the muted inactive style and persists that way, then toggling it back on.

**Acceptance Scenarios**:

1. **Given** an active entry, **When** the admin flips its switch off, **Then** the entry is marked inactive, its row renders in the design's muted inactive styling, and the change persists across leaving and re-entering the screen.
2. **Given** an inactive entry, **When** the admin flips its switch on, **Then** the entry becomes active again and renders in the active styling.
3. **Given** an entry that is already referenced by recorded history, **When** the admin deactivates it, **Then** the deactivation succeeds and the existing history remains intact and readable — the entry is never removed.
4. **Given** the reasons tab is open, **When** the admin looks at the pinned "Other" entry, **Then** it has no active switch and cannot be deactivated.
5. **Given** the masters screen, **When** the admin looks for any delete or remove action on a row, **Then** there is none — deactivation is the only way to retire an entry.

---

### User Story 6 - Rename an entry (Priority: P2)

A Company Admin fixes a wrong or outdated label — a typo, a brand that rebranded — by tapping the label in the list, editing it in place, and confirming, without having to retire the entry and add a replacement.

**Why this priority**: Labels are typed by hand during setup, so typos are inevitable and the alternative (deactivate and re-add) both loses the entry's position and leaves a dead row behind. It follows the add flows because a list has to exist before anything in it can be corrected.

**Independent Test**: Can be fully tested by tapping a label, changing it, confirming, and checking the new label persists across leaving and re-entering the screen while the row stays in the same position.

**Acceptance Scenarios**:

1. **Given** the list is open, **When** the admin taps an entry's label, **Then** it becomes an editable field in place, pre-filled and selected, with the row keeping its height and position.
2. **Given** a label is being edited, **When** the admin changes it and confirms, **Then** the new label is saved, the field returns to a normal row, and the entry keeps its original position in the list.
3. **Given** a label is being edited, **When** the admin enters a label another entry in the same list already uses (ignoring case and surrounding spaces), **Then** the save is rejected with a clear duplicate message, the row stays in edit mode with the typed text intact, and the original label is unchanged.
4. **Given** a label is being edited, **When** the admin re-saves it unchanged, or changes only its capitalisation, **Then** the save succeeds — an entry never conflicts with itself.
5. **Given** a label is being edited, **When** the admin clears it or enters a label outside the allowed length, **Then** the save is rejected with a clear message and nothing is changed.
6. **Given** a label is being edited, **When** the admin leaves the field by any means — confirming, pressing the keyboard's done key, or tapping anywhere else — **Then** the change is saved. Leaving the field MUST NOT silently discard what was typed.
7. **Given** the reasons tab is open, **When** the admin taps the pinned "Other" label, **Then** nothing becomes editable — that entry cannot be renamed.
8. **Given** an entry is renamed, **When** the admin looks at any history that referenced its old label, **Then** that history still shows what was recorded at the time; a rename never rewrites the past.

---

### Edge Cases

- Adding an entry whose label differs from an existing one only by case or surrounding spaces is treated as a duplicate and rejected, not saved as a near-twin.
- A label longer than the allowed maximum is rejected with a clear message rather than silently truncated; a label at the maximum still renders inside the row without breaking the design's layout.
- Very long labels in the list ellipsize or wrap within the row as the design allows, never overflowing the card.
- The pinned "Other" entry cannot be deactivated, reordered, relabelled or removed, and is always rendered last in the reasons list regardless of any other entry's display order.
- Every company has exactly one "Other" reason — companies created before this feature existed get theirs provisioned, and a company can never end up with two or with none.
- Deactivating every entry in a list is allowed; the list is not required to keep at least one active entry (the consequences surface in the not-yet-built visit screens, not here).
- Two admins reordering or toggling the same list at nearly the same time: the later save wins, with no special concurrent-edit locking — consistent with how shop and beat-plan edits already behave.
- Losing connectivity while the masters screen is open shows the saved data with a "showing saved data" indication rather than an error, and an add, reorder or toggle attempted with no connection reports that it could not be saved rather than appearing to succeed.
- Switching tabs with text still typed in the add field does not carry that text into the other tab's add field or add it to the wrong list.
- An entry's label is a snapshot at the time history is recorded, so renaming or retiring a master later never rewrites what a past visit or order recorded.
- Renaming an entry to a label that only differs from another entry's by case or surrounding spaces is rejected as a duplicate, exactly as adding one would be — but an entry never conflicts with itself, so re-saving its own label or merely re-capitalising it succeeds.
- A rename that fails validation leaves the row in edit mode with the typed text intact, so the admin can correct it rather than retyping from scratch.
- Starting a drag on a row that is mid-edit saves the edit first, then performs the drag — leaving the field never discards typed text, whatever caused it.
- Confirming, pressing done, and tapping away can all fire for one save; the entry is renamed once, not two or three times.
- Renaming never changes an entry's position, and reordering never changes its label; the two operations are independent.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The "Brands & reasons" tile on the Company Admin home screen MUST navigate to the brands and reasons masters screen, replacing the current inert "Coming soon" placeholder behaviour.
- **FR-002**: The "Brands & reasons" home tile subtitle MUST show that company's live counts of brands and reasons, in the design's format (for example "22 brands · 9 reasons").
- **FR-003**: The masters screen MUST present two tabs — "No-order reasons" and "Brands" — each labelled with its own live item count, opening by default on the "No-order reasons" tab, matching UI design reference section 4.12.
- **FR-004**: Each tab MUST show its entries as a single ordered list, each row carrying a drag handle, its display-order number, its label, and an active/inactive switch, in the design's row layout.
- **FR-005**: Each tab MUST provide an add field and an "Add" action above the list, with the placeholder naming the selected tab's item type, that appends a new entry to that tab's list.
- **FR-006**: A newly added brand or reason MUST be created active, placed last in its list (for reasons, immediately above the pinned "Other" entry), and MUST appear in the list without the admin having to reload the screen.
- **FR-007**: System MUST reject an add with an empty or whitespace-only label, and MUST reject a label that duplicates an existing entry in the same list for the same company, compared ignoring case and surrounding whitespace; the rejection MUST state which problem occurred and MUST NOT create an entry.
- **FR-008**: Brand labels and reason labels MUST be independent of each other — the same text may exist once as a brand and once as a reason.
- **FR-009**: System MUST enforce a minimum and maximum label length and report a violation clearly, without silently truncating the admin's input.
- **FR-010**: The reasons list MUST always end with a single system "Other" entry, rendered in the design's locked style with the caption that it is always last and requires free text, and carrying no drag handle, no active switch and no delete action.
- **FR-011**: The system "Other" reason MUST be non-removable, non-deactivatable, non-reorderable and non-relabelable, and MUST exist exactly once for every company — including companies that already existed before this feature.
- **FR-012**: An admin MUST be able to reorder the entries within either list by dragging a row, and the resulting order MUST persist; the stored display order MUST be server-derived from the resulting positions as sequential, gap-free numbers, never accepted as a client-supplied number.
- **FR-013**: Reordering MUST NOT be able to move the "Other" reason from last position or place any entry after it.
- **FR-014**: An admin MUST be able to deactivate and reactivate any brand or any non-system reason via its row switch, and the row MUST render in the design's active or inactive styling accordingly.
- **FR-014a**: An admin MUST be able to rename any brand or any non-system reason in place. A rename MUST be validated exactly as an add is — trimmed, length-bounded, and rejected when it duplicates another entry in the same list (ignoring case and surrounding whitespace) — except that an entry never conflicts with itself, so re-saving its own label, or changing only its capitalisation, MUST succeed. A rename MUST NOT change the entry's position in the list, and MUST NOT alter any history that already recorded the old label.
- **FR-014b**: The system "Other" reason MUST NOT be renamable, enforced server-side and not merely by hiding the control.
- **FR-015**: System MUST NOT offer any permanent delete of a brand or reason anywhere in this feature; deactivation is the only retirement mechanism, and a deactivated entry's referencing history MUST remain intact and readable.
- **FR-016**: Only the Company Admin role MUST be able to view or change brands and reasons through this feature; the masters screen and its entry point MUST NOT be exposed in any other role's navigation.
- **FR-017**: System MUST expose each company's brands and reasons as company-scoped data only — one company's masters MUST never be visible or changeable from another company.
- **FR-018**: A repeated submission of the same add, reorder or activation change — such as a double tap or a retry after a timeout — MUST NOT produce a duplicate entry or a duplicated change.
- **FR-019**: The masters screen MUST remain readable without a connection by showing previously loaded data with a clear "showing saved data" indication, and MUST clearly report when a change could not be saved rather than showing it as saved.
- **FR-020**: Every state delivered by this feature — the masters screen on each of its two tabs, with active and inactive rows, the pinned "Other" row, and the empty-list case — MUST visually match its corresponding board in `docs/ui-design/Field_Sales_Beat_App.html` (section 4.12) exactly: colors, spacing, typography, icon shapes, border radii, and layout, with no approximated placeholders.
- **FR-021**: The active entries of each list, in their saved display order, MUST be the set that later features present in the field — the ordered brand list for order lines and the ordered reason list (with "Other" last, requiring free text) for no-order outcomes.
- **FR-022**: Every create, reorder and activation change MUST be recorded in the company's audit trail with the acting user, consistent with how other Company Admin master changes are recorded.

### Key Entities

- **Brand**: a company-scoped master used later as the subject of an order line. Holds a label unique within the company, a display order position, and an active/inactive status. Deactivated, never deleted.
- **No-order Reason**: a company-scoped master used later as the single-select reason for a no-order outcome. Holds a label unique within the company, a display order position, an active/inactive status, a marker for whether choosing it requires free text from the executive, and a marker for whether it is the system entry. Deactivated, never deleted.
- **"Other" reason** *(a specific No-order Reason, not a separate entity)*: the one system reason every company has. Always last, always active, requires free text, and is not editable or removable by the admin.
- **Company** *(referenced, not owned by this feature)*: the tenant that owns both lists. Each company has its own independent brands and reasons, including its own "Other" entry.
- **Visit / Order line** *(referenced by later features, not owned here)*: the future records that will point at a reason or a brand and keep a snapshot of its label, so retiring a master never rewrites recorded history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Company Admin can go from the Admin home screen to a saved new no-order reason in under 20 seconds and no more than three taps plus typing the label.
- **SC-002**: A Company Admin setting up a new company can load a complete starter set of 20+ brands and 8+ reasons in a single sitting without leaving the masters screen.
- **SC-003**: Every screen state delivered by this feature is visually indistinguishable — colors, spacing, type, icon shapes, border radii, layout — from its corresponding board in the UI design reference, verified by side-by-side comparison.
- **SC-004**: 100% of reorder operations survive a reload with the exact order the admin set, numbered sequentially from 1 with no gaps and no duplicates.
- **SC-005**: 100% of companies, existing and newly created, have exactly one "Other" reason, and zero attempts to deactivate, reorder, relabel or remove it succeed.
- **SC-006**: Zero duplicate entries are produced by repeated or retried submissions of the same add.
- **SC-007**: 100% of deactivations of an entry referenced by history succeed as a status change and leave that history intact; none result in the entry or its history disappearing.
- **SC-008**: Zero cross-company leakage: an admin of one company never sees or changes another company's brands or reasons under any filter, order or retry.

## Assumptions

- "CRUD" here means create, read, rename, reorder and deactivate/reactivate. The permission matrix's "D" for this capability is defined in the product requirements as *deactivate*, not permanent delete, so no hard-delete action exists in this feature, consistent with the same rule already applied to shops, users and beat plans.
- **Rename is in scope — reversed on 2026-10-19 at the user's request.** It was originally scoped out (board 4.12 exposes no rename control, and PRD FR-ADM-08 enumerates the row's affordances as display order, drag-to-reorder and an active switch only); the user then asked for an edit/update option, which supersedes that. Because the board draws no such control, the agreed interaction is **editing the label in place in the row**: tapping a label turns it into a field of the same type and size, and the switch's slot is occupied by a confirm control only while that row is being edited. A row at rest is therefore still pixel-identical to the board — no new icon, no layout shift, no dialog — which keeps the standing exact-fidelity rule intact. A pencil button on every row and a tap-to-open edit dialog were both considered and rejected: the first permanently changes how every row looks against the board, the second collides with the drag gesture, which starts from the same touch.
- Duplicate detection compares labels ignoring case and surrounding whitespace, matching how usernames are already treated as case-insensitively unique within a company. A label is stored with the capitalisation the admin typed.
- Label length is bounded at a sensible master-data range (roughly 2–60 characters) so a label renders inside the design's row; this is a display-fit bound chosen here, distinct from the 3–280 character bound the product requirements already set for an executive's free-text "Other" note, which is a different field in a different feature.
- The system "Other" reason is provisioned automatically — created with each new company and back-filled for companies that already exist — rather than being something an admin has to add. No other starter brands or reasons are pre-loaded; the sample entries shown on the design board are illustrative, and a real company's lists start empty apart from "Other".
- This feature exposes these masters to the Company Admin only. The product's permission matrix also grants Manager and Marketing Executive read access, but no screen in either role consumes brands or reasons until the visit and order features are built, and the architecture's own API surface scopes these routes to Company Admin — so role-scoped read access for those two roles is deferred to the feature that needs it.
- Both lists are small enough (tens of entries, not thousands) to load and reorder as a single list without pagination or search, which is why the design board offers neither.
- The design board renders only the "No-order reasons" tab. The Brands tab reuses that exact row, list, add-field and tab styling, differing only in its placeholder text, its count, and the absence of the pinned "Other" row — no separate brands board exists to match against.
- The underlying brand and reason data does not exist yet in this product; this feature introduces it. Nothing currently reads these lists, so there is no existing consumer to migrate or keep compatible.
- The design board's visible sample counts and entries ("22 brands · 9 reasons", "Stock sufficient", "Price too high", and so on) are illustrative sample data, not a required starter set to ship.
