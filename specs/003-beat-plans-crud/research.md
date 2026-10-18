# Phase 0 Research: Beat Plans CRUD (Company Admin)

## 1. Ordered shop list: full-replace vs. incremental add/remove/reorder endpoints

**Decision**: `POST /beat-plans` and `PATCH /beat-plans/:id` both accept the complete ordered shop list as a plain ordered array of ids — `shopIds: string[]` — in the body, never an explicit `sequence` number from the client. The server assigns each `BeatPlanShop.sequence` from the array's own position (0-based) when writing the rows. On save, the server deletes every existing `BeatPlanShop` row for that plan and recreates the submitted list in that order, inside the same transaction. There are no separate `POST/DELETE /beat-plans/:id/shops` endpoints.

**Rationale**: Architecture's own API surface table already specifies this shape for this exact entity — "`GET/POST/PATCH | /beat-plans, /beat-plans/:id | Company Admin | shops and order in the body`" — so this isn't a new design choice, it's confirming the documented one. It also matches the form's natural UX: the admin builds up the list locally (adding, removing, dragging to reorder) and taps one Save, the same shape `createShopSchema`'s `location` object or `createUserSchema`'s rate pair already established for "a few related fields submitted together." A full replace is simple and safe here specifically because `BeatPlanShop` is current-state data, not history (research informed by Constitution rule 4 — see data-model.md's note on why this entity doesn't need append-only treatment).

**Alternatives considered**: Incremental endpoints (`POST .../shops`, `DELETE .../shops/:shopId`, `PATCH .../shops/:shopId/sequence`) — rejected: three new endpoints and client-side orchestration logic for what the architecture doc already describes as a single-body operation, with no benefit since there's no partial-save use case in the spec. A client-sent `{ shopId, sequence }[]` pair list (rather than a plain ordered array) — rejected: trusting a client-sent integer sequence reopens exactly the gap/duplicate/collision bugs FR-009's edge case ("remaining shops keep a valid, gap-free sequence") warns against; deriving `sequence` from array position server-side makes an invalid sequence structurally impossible instead of something to validate.

## 2. "Add existing shops" picker

**Decision**: Extend `ShopsListScreen` with two optional props — `selectionMode?: boolean` and `onSelect?: (shops: ShopSummaryForEdit[]) => void`. When `selectionMode` is on, tapping a row toggles a checkmark instead of navigating to `ShopForm`, and a "Done" action (replacing the FAB) calls `onSelect` with the chosen shops and navigates back. `BeatPlanFormScreen`'s "+ Add existing shops" link navigates to `ShopsList` with these props set.

**Rationale**: `ShopsListScreen` already has the exact search/filter/list UI a shop picker needs (board 4.8's own layout, reused for this purpose rather than redrawn). Duplicating that screen as a new `ShopPickerScreen` would mean maintaining two copies of the same search/debounce/FlatList logic for no visual difference the spec asks for. The two new props are optional and default to the screen's current (non-picker) behavior, so every existing call site (`ShopsListScreen`'s own route, the Shops tab) is unaffected.

**Alternatives considered**: A dedicated `ShopPickerScreen` — rejected for the duplication reason above. A modal/bottom-sheet picker inline in `BeatPlanFormScreen` — rejected: the design shows "+ Add existing shops" as a full navigation (a plain link, not a sheet-trigger icon), and a full screen gives room for the same search/filter the shop directory already has, which a cramped modal wouldn't.

## 3. "Create a new shop in this beat"

**Decision**: Extend `ShopFormScreen` with one optional prop, `onCreated?: (shop: ShopSummaryForEdit) => void`, passed through the navigation route params. When present and a *create* (not edit) save succeeds, `ShopFormScreen` calls it with the newly created shop before navigating back, instead of only calling `navigation.goBack()`. `BeatPlanFormScreen`'s "Create a new shop in this beat" link navigates to `ShopForm` with `shop: undefined` and this callback, which appends the new shop to the plan's local (not-yet-saved) ordered list.

**Rationale**: `ShopFormScreen` already is the exact create-shop experience (board 4.9, photos, location, everything) — re-implementing even a trimmed version of it inside the beat-plan form would duplicate a large screen for a smaller, worse experience. React Navigation route params can carry a plain function reference (it lives in memory for the duration of the navigation stack, never serialized), the same mechanism this codebase could use anywhere a child screen needs to hand a result back to its caller — there's no existing precedent for it yet, but it's the standard, documented React Navigation pattern for exactly this "create from within another flow" case.

**Alternatives considered**: A trimmed-down "quick add shop" form inline in the beat-plan screen (just name + code) — rejected: the spec's own acceptance scenario (US2 #6) says "they can create a brand-new shop," not a lesser version of one; a shop created this way should be just as complete as one created from the Shops tab, including its photos and location if the admin wants to add them immediately.

## 4. Executive assignment picker

**Decision**: `BeatPlanFormScreen`'s "Assigned executive" selector calls the existing `GET /users?role=MARKETING_EXECUTIVE&status=ACTIVE` directly — no new endpoint.

**Rationale**: `listUsersQuerySchema` already supports both filters (`role`, `status`); `UsersService.list()` already tenant-scopes and returns exactly this. Building a second "list assignable executives" endpoint would duplicate `GET /users` for a strict subset of what it already does.

**Alternatives considered**: A dedicated `GET /beat-plans/executives` convenience endpoint — rejected as unnecessary indirection over an existing, already-correct endpoint.

## 5. New Prisma relations are additive-only

**Decision**: `Shop.beatPlanShops: BeatPlanShop[]` and `User.assignedBeatPlans: BeatPlan[]` are added as new relation fields on the two existing models. Neither changes an existing column, index, or constraint.

**Rationale**: Prisma requires both sides of a relation to be declared. Adding the reverse-relation fields is schema-only (no `ALTER COLUMN`, no data migration) — the generated migration only creates the two new tables and their foreign keys, confirmed in data-model.md.

## 6. No new native dependency

**Decision**: This slice adds no package to `apps/mobile/package.json`. Drag-to-reorder for the shop list uses plain `Pressable`/state reordering (tap up/down, or a simple long-press-free move-up/move-down control) rather than a gesture-based drag library.

**Rationale**: The design shows a drag handle icon per row, but spec FR-009 only requires that the admin *can* reorder and remove shops — it doesn't mandate the exact interaction mechanism, and a true physics-based drag gesture needs a new dependency (e.g. `react-native-draggable-flatlist`, which itself needs `react-native-gesture-handler` + `react-native-reanimated`, neither installed) for a feature usable with simple up/down controls on a typically-short list (spec's own example is a 10-stop plan). Matches CLAUDE.md's UI-fidelity rule's own carve-out: visual fidelity (the drag-handle icon, rendered) is not the same obligation as replicating the exact gesture mechanics behind it when a simpler mechanism serves the same user-facing requirement.

**Alternatives considered**: `react-native-draggable-flatlist` — rejected for this pass: two new native dependencies for a reorder interaction the spec doesn't require to be gesture-based; can be added later as a pure UX upgrade without changing the API contract (sequence is just an integer either way).
