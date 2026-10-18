# Quickstart: Shops CRUD (Company Admin)

Manual validation guide — no automated tests exist for this app yet (CLAUDE.md standing policy). Run through this after implementation to confirm the feature works end-to-end.

## Prerequisites

- API and Postgres running with the new migration applied (`pnpm --filter api prisma migrate dev`), seeded with at least one `COMPANY_ADMIN` user (existing seed from `001-company-user-auth` is enough).
- A real value in `apps/mobile/.env.dev`'s `GOOGLE_MAPS_API_KEY` (currently empty — see `research.md` §2). Without it, the app still runs and shops still save, but the Location section's map tiles won't render — note this explicitly if you proceed without a key.
- Mobile app rebuilt natively after adding `react-native-maps` (`pnpm --filter mobile android`), not just a JS reload — it's a new native dependency.

## Scenario 1 — Navigate in from both entry points

1. Sign in as a Company Admin.
2. From Admin home, tap the **Shops** tile → the shop directory opens (board 4.8), empty-state if no shops yet.
3. Go back to Home, tap **Shops** on the bottom nav → same directory opens.
4. **Expected**: both entry points land on the identical screen; the bottom nav's Shops tab is now highlighted instead of showing the "coming soon" alert.

## Scenario 2 — Create a shop

1. From the directory, tap **New shop** → the shop form opens empty, titled for creation (board 4.9).
2. Fill in shop code, name, owner, phone, address fields.
3. In the Location section, search an address or drag the pin; confirm the coordinate source shown matches what you just did (map search vs. drag).
4. Add 1–3 photos from the gallery; confirm the count updates and a photo can be removed before saving.
5. Save.
6. **Expected**: returns to the directory; the new shop appears with the entered name/code/address and a pin-present chip.

## Scenario 3 — Duplicate shop code is rejected

1. Repeat Scenario 2's create flow using a shop code that already exists.
2. **Expected**: save is rejected with a clear duplicate-code message; no second shop is created (confirm the directory's count is unchanged).

## Scenario 4 — Save without a location

1. Create another shop, leaving the Location section untouched (don't search or drag).
2. **Expected**: save succeeds; the new shop shows a "No pin" chip in the directory and appears when the "No pin" quick filter is selected.

## Scenario 5 — Edit an existing shop

1. From the directory, tap any shop row → the form opens pre-filled with that shop's data, titled for editing, visually identical to the create form (board 4.9, "edit" state).
2. Change the phone number and save.
3. **Expected**: directory reflects the new phone on that same row; no duplicate row was created (confirm the directory's total count is unchanged).

## Scenario 6 — Correcting an already-approved pin is audited

1. Open a shop that already has an approved pin (one created in Scenario 2).
2. Drag the pin to a new spot and save.
3. **Expected**: the save succeeds and the shop's coordinates update. (There's no UI for viewing `ShopPinChange` rows in this feature — confirm via `psql`/Prisma Studio that a new `ShopPinChange` row exists with the old and new coordinates, `status = DECIDED`, and `requestedBy = decidedBy`.)

## Scenario 7 — Deactivate, not delete

1. Open an existing shop, set status to inactive, save.
2. Back in the directory, confirm the shop no longer appears under "All" by default but does appear under the "Inactive" quick filter.
3. **Expected**: no delete action exists anywhere in this flow; the shop's record (and any photos/pin-change history) is still present, just flagged inactive.

## Scenario 8 — Beat plan field/filter are visibly disabled

1. On the shop form, confirm the "Beat plan" field renders per the design but cannot be interacted with, and shows the "available once beat plans are set up" note.
2. On the directory, confirm the beat-plan filter is present but disabled the same way.
3. **Expected**: this is intentional for this feature (research.md §1) — it is not a bug to fix here.

## Scenario 9 — UI fidelity spot-check

1. Open `docs/ui-design/Field_Sales_Beat_App.html`'s decoded boards for 4.8 and 4.9 side by side with the running app (same device width).
2. Compare: background/card colors, filter-chip styling, FAB placement and icon, field label/input styling, bottom-nav icon set.
3. **Expected**: no visible difference (spec SC-003). Any mismatch is a bug against FR-013, not a "close enough."
