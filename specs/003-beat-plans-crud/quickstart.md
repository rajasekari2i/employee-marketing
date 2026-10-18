# Quickstart: Beat Plans CRUD (Company Admin)

Manual validation guide — no automated tests exist for this app yet (CLAUDE.md standing policy). Run through this after implementation to confirm the feature works end-to-end. Assumes `002-shops-crud` is already in place (this feature reuses its screens/endpoints directly).

## Prerequisites

- API and Postgres running with the new migration applied (`pnpm --filter api prisma migrate dev`), seeded with a `COMPANY_ADMIN`.
- At least one `MARKETING_EXECUTIVE` user and a few shops already created for the test company (via the Users and Shops features) — this feature's own form needs them to exist to pick from.
- Mobile app running — no new native dependency this slice, so a JS-only reload is enough (no `pnpm --filter mobile android` rebuild needed, unlike the shops slice's map library).

## Scenario 1 — Navigate in from both entry points

1. Sign in as a Company Admin.
2. From Admin home, tap the **Beat plans** tile → the beat plan directory opens (board 4.6), empty-state if no plans yet.
3. Go back to Home, tap **Beats** on the bottom nav → same directory opens.
4. **Expected**: both entry points land on the identical screen; the bottom nav's Beats tab is now highlighted instead of showing the "coming soon" alert.

## Scenario 2 — Create a beat plan with an executive and shops

1. From the directory, tap **New beat plan** → the form opens empty, titled for creation (board 4.7).
2. Fill in name and code.
3. Tap the executive selector; confirm only active Marketing Executives are listed; pick one.
4. Toggle a few working days off (e.g. turn off Sunday).
5. Tap **+ Add existing shops** → the shop picker (the shops directory in selection mode) opens; search/filter works there too; pick 2–3 shops; confirm they're returned to the form in the order picked.
6. Tap **Create a new shop in this beat** → the full shop-creation form opens (the same one from `002-shops-crud`); create a shop; confirm it's appended to this plan's list on return, without a second, separate save step.
7. Drag/reorder the shop list; confirm the order updates.
8. Save.
9. **Expected**: returns to the directory; the new plan appears with the entered name/code, the assigned executive, the working days, and the correct shop count.

## Scenario 3 — Duplicate beat plan code is rejected

1. Repeat Scenario 2's create flow using a code that already exists.
2. **Expected**: save is rejected with a clear duplicate-code message; no second plan is created (confirm the directory's count is unchanged).

## Scenario 4 — Save with no executive and no shops

1. Create another plan, leaving the executive unassigned and the shop list empty.
2. **Expected**: save succeeds; the new plan shows "No executive"/"Unassigned" in the directory and appears when the "Unassigned" quick filter is selected; shop count shows 0.

## Scenario 5 — Edit an existing plan

1. From the directory, tap any plan row → the form opens pre-filled with that plan's current name, code, executive, working days, and shop list — visually identical to the create form (board 4.7, "edit" state).
2. Reassign the executive, remove one shop from the list, reorder the remaining ones, and save.
3. **Expected**: directory reflects the new executive and shop count on that same row; no duplicate plan was created (confirm the directory's total count is unchanged). Re-opening the plan shows the shop list in its new order with no gaps.

## Scenario 6 — Deactivate, not delete

1. Open an existing plan, switch status to inactive, save.
2. Back in the directory, confirm the plan no longer appears under "All" by default but does appear under the "Inactive" quick filter.
3. **Expected**: no delete action exists anywhere in this flow; the plan's record (and its shop list) is still present, just flagged inactive.

## Scenario 7 — UI fidelity spot-check

1. Open `docs/ui-design/Field_Sales_Beat_App.html`'s decoded boards for 4.6 and 4.7 side by side with the running app (same device width).
2. Compare: background/card colors, filter-chip styling, FAB placement and icon, working-day toggle styling, the ordered-shop-list card, footer Cancel/Create buttons.
3. **Expected**: no visible difference (spec SC-003). Any mismatch is a bug against FR-015, not "close enough."
