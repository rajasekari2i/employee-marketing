# Quickstart: Brands & Reasons CRUD (Company Admin)

Manual validation guide — no automated tests exist for this app yet (CLAUDE.md standing policy). Run through this after implementation to confirm the feature works end to end.

## Prerequisites

- API and Postgres running with both new migrations applied (`pnpm --filter api prisma migrate dev`) — the DDL/backfill one and the sibling RLS one.
- A `COMPANY_ADMIN` able to sign in on a company build, plus **at least one company that existed before this slice** so the backfill is actually exercised.
- Mobile app running. **No native rebuild needed** — this slice adds no package (research.md §5), so a Metro reload is enough, unlike the shops slice's map library.

## Scenario 1 — The tile becomes a real destination

1. Sign in as a Company Admin.
2. On Admin home, read the **Brands & reasons** tile subtitle.
3. Tap it.
4. **Expected**: the subtitle shows live counts (`"N brands · M reasons"`), not "Coming soon", and no alert fires. The masters screen opens on the **No-order reasons** tab. Each tab label carries its own count, and the reasons count includes the pinned "Other" row.

## Scenario 2 — The "Other" row exists everywhere, and is locked

1. On the reasons tab of a company that existed *before* this slice, scroll to the bottom of the list.
2. Try to drag it, and look for a switch or a delete control on it.
3. Create a brand-new company (System Admin), sign in as its admin, and open the same screen.
4. **Expected**: both companies show exactly one **Other** row, pinned last, captioned "Always last · requires free text", with no drag handle, no active switch and no delete action. The new company's reasons list contains that row and nothing else; its brands list is empty — neither is an error state.

## Scenario 3 — Add a reason, then a brand

1. On the reasons tab, type a label into the add field and tap **Add**.
2. On the brands tab, do the same.
3. Leave the screen and come back.
4. **Expected**: each new entry appears at the end of its own list (the reason **above** the "Other" row), active, with the add field cleared and the tab count incremented. Both survive the round trip. The add field's placeholder names the selected tab's item type.

## Scenario 4 — Validation and duplicates

1. Tap **Add** with the field empty, then with only spaces.
2. Add a label that already exists in that list, differing only by case (e.g. `parle` when `Parle` exists), then again with trailing spaces.
3. On the reasons tab, try to add a reason labelled `Other`.
4. Add the same text as a brand *and* as a reason.
5. Try a 1-character label and a 61-character label.
6. **Expected**: 1–3 are each rejected with a clear, specific message and create nothing. 4 succeeds both times — the two lists are independent. 5 is rejected at both ends without silently truncating.

## Scenario 5 — Reorder by dragging

1. On a list with several entries, drag a row by its handle to a new position.
2. Leave the screen and return.
3. On the reasons tab, try to drag the **Other** row, and try to drop another row below it.
4. Deactivate one row (Scenario 6), then reorder the list.
5. **Expected**: the drag is a real gesture on the handle shown in the design — not up/down buttons. Row numbers renumber immediately, the new order survives the round trip with gap-free numbering from 1, "Other" stays last and cannot be moved, and active and inactive rows take part in one single ordering rather than being segregated.

## Scenario 6 — Deactivate and reactivate

1. Flip a row's switch off, leave the screen, return.
2. Flip it back on.
3. Look for any delete or remove control anywhere on the screen.
4. **Expected**: the row renders in the design's muted inactive styling and persists that way; reactivating restores the active styling. There is no delete action anywhere — deactivation is the only retirement path.

## Scenario 6b — Rename in place

1. Tap an entry's label. It should become an editable field **in the same row**, pre-filled and selected, with no change in row height and no other row moving.
2. Change it and confirm (keyboard "done", or the confirm control that occupies the switch's slot while editing). Leave the screen and come back.
3. Rename an entry to a label another entry already uses, differing only by case or trailing spaces.
4. Re-save an entry's own label unchanged, then save it again with different capitalisation.
5. Clear the label and confirm; then try a 61-character label.
6. Edit a label and then **tap somewhere else** instead of confirming — another row, the Add field, the background. Repeat using the keyboard's done key.
7. Start editing, then drag that same row by its handle.
8. On the reasons tab, tap the pinned **Other** label.
9. **Expected**: 2 saves and persists, with the row keeping its original position. 3 is rejected with a duplicate message and the row stays in edit mode with the typed text intact. 4 succeeds both times — an entry never conflicts with itself. 5 is rejected both ways with nothing changed. **6 saves both ways** — leaving the field never silently discards what was typed, and the rename is applied exactly once even though several handlers fire. 7 saves the edit and then performs the drag. 8 does nothing — "Other" cannot be renamed, and the server rejects it even if the request is forged.

> This was the bug found on device on 2026-10-19: blurring the field used to discard the edit with no message, so renaming appeared to do nothing unless the small confirm control was tapped. Step 6 is the regression check.

## Scenario 7 — Tenant isolation

1. With two companies set up, add a brand named distinctly in company A.
2. Sign in as company B's admin and open the screen.
3. **Expected**: company B never sees company A's brand or reasons, and its own "Other" row is a different record. (Both isolation layers are in play — the Prisma extension and the RLS policy.)

## Scenario 8 — Idempotency and failure honesty

1. Tap **Add** twice quickly for the same label.
2. Stop the API, then try to add an entry, toggle a switch, and drag a row.
3. Restart the API and reload the screen.
4. **Expected**: only one entry is created by the double tap, never two. With the API down, each failed change reports clearly that it could not be saved — none of them appear to have succeeded. Per research.md §8, the already-loaded list stays visible rather than showing an error screen, and there is deliberately **no** "showing saved data" banner in this slice.

## Scenario 9 — UI fidelity spot-check

1. Decode board 4.12 from `docs/ui-design/Field_Sales_Beat_App.html` (the recipe is in CLAUDE.md) and put it side by side with the running app at the same device width.
2. Compare: the 390px frame background, header padding and back button, the tab pill group and its selected/unselected styling, the add field and Add button, the "Display order · label / Active" column header, the row height and separators, the monospace order number, the switch geometry in both states, the active vs inactive label color, and the pinned "Other" row's background, lock icon and caption.
3. Confirm the two chrome details that differ from the sibling admin boards: there is **no bottom navigation bar** on this screen, and the counts live in the **tab labels** rather than in a line above the title.
4. **Expected**: no visible difference (spec SC-003). Any mismatch is a bug against FR-020, not "close enough".
