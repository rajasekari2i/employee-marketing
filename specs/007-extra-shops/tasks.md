---

description: "Task list for Add Extra Shop — Executive"
---

# Tasks: Add Extra Shop — Executive

**Input**: Design documents from `/specs/007-extra-shops/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/extra-shops.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md`'s 15 manual scenarios are the verification path (Polish, T261).

**Organization**: Grouped by user story (spec.md: US1–US2 are P1, US3–US4 are P2). Task IDs continue the repo-wide sequence — 001 (T001–T074), 002 (T075–T107), 003 (T108–T135), 004 (T136–T172), 005 (T173–T203), 006 (T204–T234) — so this feature starts at **T235**.

**No migration, no new dependency, no native rebuild.** Every field this feature writes already exists in `schema.prisma` (data-model.md, *There is no migration*), and every mobile module it touches is already linked (plan.md, *Primary Dependencies*). If you find yourself writing a migration or adding a package, stop — something has been misread.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/assignments/`, `apps/api/src/modules/visits/`
- Shared: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/executive/`, `apps/mobile/src/lib/`, `apps/mobile/src/navigation/`

## Board uuids (for the CLAUDE.md decode recipe)

| Board | uuid |
|---|---|
| 1.3 Today's beat · start / running / end | `20463df0-5cdd-44a1-bce2-f24ff89bf4c6` |
| **1.4 Add extra shop (executive)** | `eccc1168-1e66-4039-92fc-0d14dd936744` |
| 4.9 New shop (the form board 1.4's create-new action links to) | `2351e584-c956-48ec-b48f-57b41a441d18` |

---

## Phase 1: Setup

- [X] T235 [P] Add one error code to `packages/shared/src/errors.ts` in the established three places (`ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`), with a comment naming this slice: `SHOP_ALREADY_IN_BEAT` → `409` → `"Shop already in today's beat"`. Name and status follow the existing state-machine refusals `STOP_ALREADY_COMPLETED`, `PIN_ALREADY_SET` and `BEAT_DAY_ENDED` (research.md §5). Reuse `BEAT_NOT_STARTED`, `BEAT_DAY_ENDED`, `NOT_FOUND`, `VALIDATION_FAILED`, `FORBIDDEN_ROLE`, `DUPLICATE_SHOP_CODE` and `IDEMPOTENCY_KEY_REUSED` unchanged. The file is additive-only.
- [X] T236 [P] Widen the location-permission rationale in `apps/mobile/src/lib/location.ts` so it states all three uses: starting and ending the beat, recording a visit, **and finding shops near you** (FR-020). This is load-bearing, not cosmetic — slice 006 deliberately silenced the confirm sheet about location (006 FR-018), making this string the app's only disclosure, and this slice adds a third use to it (research.md §8). Do not change `getCurrentPosition()`'s two-attempt / coarse-fallback / `inFlight` behaviour or the `'android'` provider — those are slice-006 crash fixes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [X] T237 [P] Create `packages/shared/src/extra-shops.schema.ts` with the two schemas exactly as `contracts/extra-shops.md` specifies. `nearbyShopsQuerySchema`: `excludeAssignment: z.string().min(1)`, `lat: z.coerce.number().min(-90).max(90).optional()`, `lng: z.coerce.number().min(-180).max(180).optional()`, `search: z.string().min(1).max(200).optional()`, `limit: z.coerce.number().int().min(1).max(200).default(50)` — `.strict()` plus a `.refine` asserting `(lat === undefined) === (lng === undefined)` with the message `'lat and lng must be supplied together'`. `addExtraStopSchema`: `shopId: z.string().min(1).optional()`, `newShop: newShopSchema.optional()`, `fromOfflineQueue: z.boolean().optional()` — `.strict()` plus a `.refine` asserting exactly one of `shopId`/`newShop` (`'Supply exactly one of shopId or newShop'`). `newShopSchema` (`.strict()`): `name` min 1 max 200; `ownerName`, `phone` (max 32), `addressLine1` (max 200), `city` (max 100) all optional min-1; `latitude` −90…90; `longitude` −180…180; `accuracyMeters` int ≥ 0; `capturedAt: z.string().datetime()`. **`shopCode` is deliberately absent** — the server generates it (research.md §6). Header comment must list what is deliberately absent so a client sending it gets a `400` rather than a silent strip (CLAUDE.md rule 1): `sequence`, `source`, `status`, `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude`, `addedByUserId`, `addedAt`, `locationStatus`, `distanceMeters`. This is the exact hole slice 006 found live; `.strict()` is what closes it.
- [X] T238 Add an explicit re-export block for `extra-shops.schema.ts` to `packages/shared/src/index.ts` — value exports then `export type`, no `export *`, matching the `visits.schema` block at `index.ts:114-115`. Depends on T237.
- [X] T239 [P] Add `'STOP'` to the `HeldKind` union in `apps/mobile/src/lib/outbox.ts:25` (`'VISIT' | 'PIN' | 'STOP'`) and make sure `sync()`'s dispatch, `isPermanentRejection` and the restart-survival path handle it the same way as the existing two kinds. **Add nothing else** — `enqueue`, FIFO `sync` ordering by `recordedAt`, the key minted at record time and permanent-rejection handling were all paid for in slice 006 (research.md §9). Do not add a connectivity library.
- [X] T240 [P] Make a day with no beat plan startable, in `apps/api/src/modules/assignments/assignments.service.ts`'s `ensureTodayRoute` (currently `assignments.service.ts:226-335`). Today the two early returns at `:260` and `:264` return `{ assignment: null, noBeatReason: 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY' }` and create **no row**, so `start()` — which takes an `assignmentId` — has nothing to act on and the day can never be started. Instead create a `DailyAssignment` with `beatPlanId: null`, `beatPlanName: null` and **no stops**, and **keep returning the same `noBeatReason`** so the no-beat card's existing copy still explains *why* the day is empty (contracts/extra-shops.md, *Changed behaviour*). The response shape of `GET /assignments/today` is unchanged — `assignment` is simply no longer `null` in that case. Reuse the existing `P2002` re-read-the-winner handling at `:317-339` verbatim. This is the one place this slice reaches back into slice 005's state machine (research.md §7, PRD FR-ASSIGN-10) — review it as a change to an existing state machine, not as new code.
- [X] T241 [P] Widen the `pinStatus` type on the stop shape in `apps/mobile/src/features/executive/TodaysBeatScreen.tsx:117` from `'NONE' | 'APPROVED'` to `'NONE' | 'PENDING_VERIFICATION' | 'APPROVED'`, matching `ShopVisitScreen.tsx:90`. The server can already return `PENDING_VERIFICATION` (slice 006 added it) and the mobile type still omits it; an executive-created shop awaiting approval makes it reachable for the first time. The `pinStatus === 'APPROVED'` routing at `:596` already does the right thing for the new value (anything but `APPROVED` goes to capture) — confirm it, do not restructure it.

**Checkpoint**: the contract, the error code, the outbox kind and the plan-less day are in place.

---

## Phase 3: User Story 1 - Add a nearby shop to today's list (Priority: P1) 🎯 MVP

**Goal**: An executive on a running beat opens board 1.4, sees the shops around them that are not already on today's list with the closest first, picks one, and it becomes a stop on today's route — with the beat plan untouched.

**Independent Test**: Start a beat, open the screen, pick the nearest listed shop, add it, confirm it appears on today's list tagged `EX`/**Extra**, then confirm the beat plan is byte-identical to before (quickstart Scenarios 1, 3, 5, 6).

- [X] T242 [US1] Create `apps/api/src/modules/visits/nearby-shops.service.ts` implementing the picker read (research.md §2). Follow `assignments.service.ts`'s class structure exactly — module-level fallback client, narrowed `Tx` type, `tx()`, and `scopeToCaller()` setting both `app.company_id` and CLS at the top of every public method. Stage 1 (SQL): the caller's company shops with `isActive = true`, excluding **every `shopId` already on `excludeAssignment`**; `excludeAssignment` must belong to the caller (`executiveId = caller`) or throw `404 NOT_FOUND`. When a position is supplied, additionally apply the architecture's bounding box — `lat ± (radiusKm / 111.32)`, `lng ± (radiusKm / (111.32 * cos(lat)))` (`03-ARCHITECTURE.md:776-787`) — **only to rows that have coordinates**, so a pin-less shop is never dropped by a geometry it lacks (research.md §2, departure 1). `LIMIT 200` as the architecture writes it. Stage 2 (Node): rank with the existing `haversineMetres` from `./haversine` — **do not write a second distance implementation**. Order: shops with approved coordinates nearest first, then shops without, by name. Return `{ items, positionUsed }` where `positionUsed` is `false` when no `lat`/`lng` was supplied (everything then sorts by name, no distances).
- [X] T243 [US1] Map the per-shop projection in `nearby-shops.service.ts` and return **exactly** these fields, which is why this shape exists instead of reusing `ShopListItem` (data-model.md, *Entity: the shop choice*): `id`, `name`, `addressLine` (`addressLine1` + `city` joined by the same helper the assignment view uses, `null` when both are empty), `pinStatus` (`'NONE' | 'PENDING_VERIFICATION' | 'APPROVED'` from `Shop.locationStatus`), `beatPlanName` (the shop's beat-plan membership, `null` → the board's "No beat" chip), `distanceMeters` (`number | null`), `distanceLabel` (`string | null`). Format `distanceLabel` **server-side**: metres below 1000 as `"90 m"`, kilometres at or above with one decimal as `"1.2 km"` — the only two forms board 1.4 shows (research.md §10). **Never select** `latitude`, `longitude`, `verificationRadiusMeters`, the company's `defaultRadiusMeters`, `geohash`, `locationCapturedBy`, `locationVerifiedBy`, `locationCapturedAt`, `locationVerifiedAt`, or anything from `Visit`. Put that list in a comment above the select — a field never selected cannot leak through a later refactor (plan.md, Constitution rule 6).
- [X] T244 [US1] Add `GET /shops/nearby` to `apps/api/src/modules/visits/visits.controller.ts` with `@Roles('MARKETING_EXECUTIVE')`, a `NearbyShopsQueryDto extends createZodDto(nearbyShopsQuerySchema)` declared locally in the controller (the established split), and the caller's executive id taken from the JWT (`request.user.sub`), never a parameter. It lives here, not in the admin-only `shops` module, for the same reason `visits.controller.ts:34-36` already records for `POST /shops/:id/pin` — it is the executive's field flow (research.md §1). No `Idempotency-Key`: this is a read. Register `NearbyShopsService` in `apps/api/src/modules/visits/visits.module.ts`.
- [X] T245 [US1] Create `apps/api/src/modules/assignments/extra-stop.service.ts` implementing `addExtraStop(companyId, executiveId, assignmentId, input)` as **one transaction**, in the order contracts/extra-shops.md, *Server-side sequence* specifies: (3) load the assignment tenant-scoped **and** `executiveId = caller`, not found → `404 NOT_FOUND` (never `403` — that would confirm the row exists); (4) reject unless `status === 'RUNNING'` → `409 BEAT_NOT_STARTED` when it has not been started, `409 BEAT_DAY_ENDED` when ended; (6) load the shop, reject when inactive or another company's → `404 NOT_FOUND`; (7) `effectiveRadiusMeters = shop.verificationRadiusMeters ?? settings.defaultRadiusMeters ?? 5` — **the same rule and the same `5` fallback** as `ensureTodayRoute` at `assignments.service.ts:269-292`; (8) freeze `shopLatitude`/`shopLongitude` **only when `shop.locationStatus === 'APPROVED'`**, else `null`, identically to `assignments.service.ts:293-307`; (9) `sequence = max(sequence on this assignment) + 1` — an append, not a position (research.md §4); (10) create the `AssignmentStop` with `source: 'EXEC_EXTRA'`, `status: 'PENDING'`, `addedByUserId` = the caller, `addedAt` = the server clock; (11) catch `P2002` on `(assignmentId, shopId)` → `409 SHOP_ALREADY_IN_BEAT`. **The duplicate guard is the database constraint `@@unique([assignmentId, shopId])` at `schema.prisma:737`, not an application pre-check** — that is what makes it survive two devices racing (research.md §5, SC-005). Return `{ stopId, shopId, shopName, pinStatus, totalStopsToday }`, where `totalStopsToday` is the day's stop **count after the add** (`counts.total + 1`) — **not** the `sequence` column; conflating the two shows a wrong number the moment any stop was added before (data-model.md, *Why the footer's "stop N" is not `sequence`*). No distance, no radius, no flags in the response — the same discipline as `POST /visits`. The `newShop` branch is T252; this task handles `shopId` only.
- [X] T246 [US1] Add `POST /assignments/:id/stops` to `apps/api/src/modules/assignments/assignments.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('extra-shop.create', 'AssignmentStop')`, an `AddExtraStopDto extends createZodDto(addExtraStopSchema)` declared locally, returning `201`. The class-level `@Roles('MARKETING_EXECUTIVE')` and the `requireCompanyId`/`requireExecutiveId` helpers already on this controller give the three-layer scoping with nothing new to invent (research.md §1). Register `ExtraStopService` in `apps/api/src/modules/assignments/assignments.module.ts`. Add a comment recording that the path is taken verbatim from `03-ARCHITECTURE.md:824` and that the manager's sibling (`POST /assignments/:id/stops/manager`, with its extra `reason`) is a later slice.
- [X] T247 [P] [US1] Add board 1.4's tokens to `apps/mobile/src/features/executive/executiveDesign.ts`, decoded from uuid `eccc1168-1e66-4039-92fc-0d14dd936744` (CLAUDE.md recipe — decode, do not grep the raw file): banner `#EFE9FB` on `#4C2690`; search box border `1.5px solid #CBD2DD`, height 48, radius 12; the radiogroup card `#FFFFFF` / `1px solid #DFE4EC` / radius 16 / padding 4; row selected `background #E3EBFC`, `border 2px solid #1D4ED8`, radio `#1D4ED8` filled, unselected `border 2px solid transparent`, radio ring `#AEB7C5`; pin chips — saved `#E3EBFC`/`#1E3A8A`, missing `#FCEFD9`/`#7A4105`; beat chip `#E9EDF3`/`#3A4353`; the dashed action `1.5px dashed #1D4ED8` on `#1D4ED8`, height 48, radius 14; footer `#FFFFFF` with `1px solid #DFE4EC` top border, padding `12px 20px 30px`; disabled primary `#CBD2DD` on `#5A6474`. Reuse existing tokens wherever one already matches — add only what is genuinely new.
- [X] T248 [US1] Create `apps/mobile/src/features/executive/AddExtraShopScreen.tsx` matching board 1.4 **exactly** (uuid `eccc1168-1e66-4039-92fc-0d14dd936744`) — this slice has **zero agreed divergences**, so any visible difference from the board is a defect (FR-025, quickstart Scenario 2). Header: back chevron in a 44 px white square, `Tue, 29 Sep · <beat plan name>` at 13 px `#5A6474`, title *"Add extra shop"* 24 px / 700. Violet banner with the info-circle icon and the exact sentence *"The shop is added to **today's list only**. Your beat plan stays as it is, and your manager sees it as an extra visit."* Search box with the magnifier icon and placeholder *"Search shop name or owner"* (behaviour is T250). Section head *"Nearby · not in today's list"* with *"Closest first"* right-aligned at 12 px `#5A6474`. Rows: 22 px radio, name 15/700 `#141A26`, address 12 px `#5A6474` single-line ellipsised, the two chips, distance right-aligned in the mono face 12/700 `#5A6474`. The dashed *"Shop not listed — create new"* action (wired in T253). Footer, two variants: unselected → *"Choose a shop to continue."* with the button disabled on `#CBD2DD`; selected → *"Adding **&lt;name&gt;** as stop N today."* with N = `totalStopsToday` i.e. today's stop count **+ 1**, and the button enabled. **Exactly one shop selectable at a time** (FR-008). Data comes from `GET /shops/nearby` via `apps/mobile/src/api/client.ts`, passing `excludeAssignment` and — when available — `lat`/`lng`. Request the position on mount through the existing `getCurrentPosition()` but **render immediately without waiting**; distances fill in when the fix arrives, and when `positionUsed` is `false` the distance column is simply absent rather than guessed (research.md §8, FR-004, quickstart Scenario 12). Adding calls `POST /assignments/:id/stops` with an `Idempotency-Key` minted on the device, then returns to today's list. Report `409 SHOP_ALREADY_IN_BEAT` in plain language (FR-011) — never as an unexplained failure.
- [X] T249 [US1] Render the dashed *"Add extra shop to today"* action on `apps/mobile/src/features/executive/TodaysBeatScreen.tsx` for the `RUNNING` state, in the **same slot** that holds the locked strip for `NOT_STARTED` and `ENDED` (`TodaysBeatScreen.tsx:569-575`) — board 1.3 draws it there under `<sc-if value="{{active}}">`, **not** beside "End beat" in the running strip (research.md §7). Styling is identical to board 1.4's own dashed action: 48 px tall, radius 14, `1.5px dashed #1D4ED8`, `700 15px` label in `#1D4ED8`, plus-icon (`M12 5v14M5 12h14`, `stroke-width 2.2`) on the left — share one dashed-button treatment with T248 rather than writing it twice. Add `AddExtraShop: { assignmentId: string; beatPlanName: string | null; totalStopsToday: number }` to `ExecutiveStackParamList` and register the screen in `apps/mobile/src/navigation/RootNavigator.tsx`. The action must be absent before the beat is started and after it is ended (FR-002) — the existing locked copy *"Start the beat to record visits and add extra shops."* must not regress.

**Checkpoint**: an executive can add a nearby shop to today's list, and the beat plan is provably untouched. US1 demonstrable — this is the MVP.

---

## Phase 4: User Story 2 - Find a shop that is not nearby (Priority: P1)

**Goal**: Typing part of a shop's name, code or owner's name narrows the list to matches, wherever those shops are.

**Independent Test**: Type a fragment of a shop's name, then of an owner's name; confirm each narrows the list, that a shop far outside the nearby window is still found, and that shops already on today's list stay excluded (quickstart Scenario 4).

- [X] T250 [US2] Add the search branch to `apps/api/src/modules/visits/nearby-shops.service.ts`: when `search` is present, **lift the bounding box entirely** — FR-006 must find a shop wherever it is, and a shop 30 km away is still addable (research.md §2, departure 2). Match `name`, `shopCode` and `ownerName`, case-insensitive, the same way `ShopsService.list` already does. The company scope, the `isActive = true` filter and the `excludeAssignment` exclusion **all still apply** — the exclusion must survive search (quickstart Scenario 4 step 3), because it is what stops the picker being used to range-find a stop about to be visited (research.md §3). Ranking and the `distanceLabel` formatting are unchanged: results still sort nearest-first when a position was supplied. Extends T242/T243 — same file, lands after them.
- [X] T251 [US2] Wire search into `apps/mobile/src/features/executive/AddExtraShopScreen.tsx`: debounce the input, re-query `GET /shops/nearby` with `search`, and clear it back to the nearest-first list (FR-006). Add the two explicit empty states (FR-007, quickstart Scenarios 4.5 and 15) — **never a blank panel**: when a search matches nothing, say so plainly and keep the create-new action offered; when there is no shop left to add at all, say that instead. Both states keep the dashed create-new action visible.

**Checkpoint**: the screen is usable in a 500-shop company (SC-002). US1 + US2 is the shippable P1 increment.

---

## Phase 5: User Story 3 - Add a shop that is not in the directory yet (Priority: P2)

**Goal**: From the same screen, create a shop with the executive's current position pre-filled, and have it land in the company's directory *and* on today's list in one action.

**Independent Test**: From the picker, create a shop; confirm it exists in the company's shop directory, is identifiable as awaiting the admin's confirmation, and is on today's list as an extra stop — without typing a shop code (quickstart Scenario 10).

- [X] T252 [US3] Add the `newShop` branch to `apps/api/src/modules/assignments/extra-stop.service.ts`, **inside the same transaction** as the stop creation (contracts step 5; FR-017 — a shop created without its stop is an orphan the executive never sees again). Generate a `shopCode` server-side and retry on collision, surfacing `409 DUPLICATE_SHOP_CODE` only if generation exhausts its retries — the executive never types one (research.md §6). Create the `Shop` with `locationSource = 'GPS'`, `locationAccuracyMeters`, `locationCapturedAt` and `locationCapturedBy` = the caller, and `locationStatus` from the company's auto-approve setting — `PENDING_VERIFICATION` by default, `APPROVED` only when the company auto-approves, **the same setting and the same code path as executive pin capture in `shop-pin.service.ts`**. Do **not** reuse `ShopsService.create`, which sets `APPROVED` with `locationVerifiedBy` set to the caller and justifies that by the caller being a Company Admin — that reasoning does not transfer, and FR-018 requires the opposite (research.md §6, data-model.md, *The executive-created shop*). Steps 7–11 of T245 then run unchanged against the new shop, which means a shop created with `PENDING_VERIFICATION` gets `shopLatitude`/`shopLongitude` **null** on its stop. That dead-end — a shop the executive created but cannot yet record at — is correct behaviour for the setting and is recorded, not hidden; the pilot company should have auto-approval enabled.
- [X] T253 [US3] Create `apps/mobile/src/features/executive/CreateShopFromFieldScreen.tsx` matching board 4.9 *New shop* exactly (uuid `2351e584-c956-48ec-b48f-57b41a441d18`) — board 1.4's create-new action links to `../admin/ShopForm.dc.html`, which is that board. **Note this file is not in plan.md's source tree**, which lists only `AddExtraShopScreen.tsx`; it is needed because the existing `apps/mobile/src/features/admin/ShopFormScreen.tsx` is Company-Admin-only in role, design tokens and endpoint (`ShopsController` is class-level `@Roles('COMPANY_ADMIN')` — an executive gets `403`). Pre-fill the executive's current position as the shop's location from `getCurrentPosition()` (FR-016), and **render no shop-code field** — the server generates it (FR-016, quickstart Scenario 10 step 5). Saving submits `POST /assignments/:id/stops` with the `newShop` object and an `Idempotency-Key`, so the shop and the stop arrive together. Add the route to `ExecutiveStackParamList` and `RootNavigator.tsx`.
- [X] T254 [US3] Wire the dashed *"Shop not listed — create new"* action on `AddExtraShopScreen.tsx` to the T253 screen, carrying `assignmentId` and the current position, and on success return the executive **straight to today's list with the shop already on it** — they must not have to find it again (FR-017). Use the same shared dashed-button treatment as T249.

**Checkpoint**: a shop that has never been entered into the system can be recorded from the field.

---

## Phase 6: User Story 4 - Visit the extra shop like any other (Priority: P2)

**Goal**: An extra stop is not a second-class stop — tapping it opens the visit screen (or the pin-capture screen) exactly as a planned stop does, and the server measures and routes the outcome identically.

**Independent Test**: Add an extra shop, record an outcome at it, and confirm the visit carries the same `distance_meters`, `is_exceed_range`, `review_status` and `flags` treatment as a planned stop while the stop row still reads `source = 'EXEC_EXTRA'` — and that no executive screen showed a distance, verdict or flag (quickstart Scenario 9).

- [X] T255 [US4] Confirm and, where needed, fix that `apps/api/src/modules/visits/visits.service.ts` treats an `EXEC_EXTRA` stop identically to a `PLAN` one: `getStopDetail` loads it, `submitVisit` accepts it, and neither branches on `source`. Check `positionLabel` at `visits.service.ts:159` (`Stop ${stop.sequence + 1} of ${stop.assignment._count.stops}`) is right for an extra stop — with `sequence = max + 1` and the count including the new stop it should read *"Stop 13 of 13"*; if the arithmetic is off for a day whose planned sequences do not start at zero, fix it here rather than in the screen. Do **not** add an extra-stop-specific code path — FR-014 expressed as code is that there isn't one. If no change is needed, record that in the commit message rather than editing to look busy.
- [X] T256 [US4] Make the newly added stop immediately usable on `apps/mobile/src/features/executive/TodaysBeatScreen.tsx`: refresh today's list on return from `AddExtraShop` so the stop is present, badged `EX` and chipped **Extra** in violet (both already rendered by `StopRow` and `orderStops` — do not reimplement them), the header counts read one more extra (`… planned + N extra`), and the row is tappable straight away. Routing uses the T241-widened `pinStatus`: `APPROVED` → `ShopVisit`, anything else (including `PENDING_VERIFICATION` from an executive-created shop) → `CaptureShopPin`.

**Checkpoint**: all four stories complete — an extra shop can be added, found, created and visited.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T257 Route the add through the outbox in `apps/mobile/src/features/executive/AddExtraShopScreen.tsx` and `CreateShopFromFieldScreen.tsx`: `enqueue('STOP', …)` **first**, then attempt an immediate send. A failed send is **not** an error — the add is shown as waiting to sync and survives a force-quit (FR-023, SC-011). The `Idempotency-Key` is minted when the item is recorded and reused for the life of the queued item, so a retry adds the shop exactly once (research.md §9). `03-ARCHITECTURE.md:1016` names extra-shop addition as queueable, which is why this is not optional. Depends on T239, T248, T253.
- [X] T258 Handle the no-connection cases the queue does **not** cover (FR-024, research.md §9, quickstart Scenario 11 step 9): the picker is a read and is never queued, so when `GET /shops/nearby` cannot be reached, `AddExtraShopScreen.tsx` must say plainly that there is no connection — **not** show an empty list. And on `TodaysBeatScreen.tsx`, a stop whose add is still waiting to sync must be shown as **waiting**, not as a stop that can be opened — the stop id a visit is recorded against is the server's, so it cannot be visited until it syncs. Reuse the existing waiting-to-sync strip rather than adding a second one. Depends on T257.
- [X] T259 [P] Confirm the request logger redacts `lat` and `lng` **query** parameters, not only body fields, and fix it if it does not. `GET /shops/nearby` is the first endpoint in the product to take a position in the query string — every prior position arrived in a body, so the deep redaction list has never been exercised this way (CLAUDE.md rule 9, plan.md Constitution rule 9, quickstart *Before calling the slice done*). This is called out as a task precisely because it would otherwise be assumed.
- [X] T260 [P] Regenerate `docs/openapi.json` to include `GET /shops/nearby` and `POST /assignments/{id}/stops`, mirroring how `006`'s T234 did it.
- [ ] T261 **(blocked — needs a physical device; the server half was verified live, see the note at the end of this file)** Run all 15 scenarios in `specs/007-extra-shops/quickstart.md` on a physical device. **Scenarios 6, 7 and 11 must not be skipped** — the beat-plan guarantee, the concurrency guarantee (eight concurrent adds → exactly one `201` and seven `409 SHOP_ALREADY_IN_BEAT`, one row) and the offline guarantee. Each is a promise the product makes that nothing else in the system double-checks. Scenario 2 is the fidelity check and, unlike slice 006, **there are no agreed divergences** — any visible difference from board 1.4 is a defect. Scenario 13 verifies the `.strict()` rejections (`effectiveRadiusMeters`, `shopLatitude`, `sequence`, `source` in a body → `400`, not a silent strip) and that another executive's `assignmentId` returns `404`, never `403`. Scenario 14 verifies the plan-less day from T240.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T235–T236)**: both independent, no dependencies.
- **Foundational (T237–T241)**: T237 → T238 sequential (same package, T238 re-exports T237). T239, T240, T241 are independent of each other and of T237.
- **User Stories (Phases 3–6)**: all depend on Foundational.
- **Polish (T257–T261)**: T257 → T258; T259–T261 depend on the stories you intend to ship.

### User Story Dependencies

- **US1 (P1)**: Foundational only. The MVP.
- **US2 (P1)**: T250 **extends T242/T243's file** — it lands after them, not alongside. T251 edits T248's screen.
- **US3 (P2)**: T252 **extends T245's file** — after it. T253/T254 need T248's screen and route.
- **US4 (P2)**: T255 is independent of all mobile work. T256 needs T241 and T249.

### Within Each User Story

- Service before controller; API before the screen that calls it; design tokens (T247) before the screen (T248).

### Parallel Opportunities

- T235 and T236 (different packages).
- T239, T240, T241 (different files, different apps).
- T247 alongside T242–T246 (mobile tokens vs. API).
- T255 (API) alongside T253 (mobile).
- T259 and T260.
- **Serialization points to respect**: `nearby-shops.service.ts` is edited by T242, T243 then T250 in that order. `extra-stop.service.ts` by T245 then T252. `AddExtraShopScreen.tsx` by T248, T251, T254 then T257/T258. `TodaysBeatScreen.tsx` by T241, T249, T256 then T258.

---

## Implementation Strategy

### MVP (US1)

1. Setup (T235–T236)
2. Foundational (T237–T241) — **blocks everything**
3. US1 (T242–T249) → validate: quickstart Scenarios 1, 2, 3, 5, 6, 7
4. **Stop and demo** — an executive can add a nearby shop and the beat plan is provably untouched

### Incremental Delivery

5. US2 (T250–T251) → Scenarios 4, 15 — the screen works in a real directory. **US1 + US2 is the P1 release.**
6. US3 (T252–T254) → Scenario 10 — new shops can be recorded from the field
7. US4 (T255–T256) → Scenario 9 — an extra stop is an ordinary stop
8. Polish (T257–T261) → Scenarios 11, 12, 13, 14 + the full quickstart

### Notes

- `[P]` = different files, no dependencies.
- **Do not add**: a Prisma migration, a new dependency, a client-side distance calculation, a second `haversineMetres`, `latitude`/`longitude`/`verificationRadiusMeters`/`defaultRadiusMeters` in any executive response, a remove-stop or reorder route, the manager's extra-shop flow (board 3.2, PRD FR-EXTRA-05) or its push notification (FR-EXTRA-09), a dedicated Company-Admin review queue for executive-created shops, or offline caching of the shop directory. Each is a reasoned exclusion (plan.md, research.md §§2/3/6/9, spec.md *Scope boundaries*), not an oversight.
- **Zero agreed divergences from the design.** Slice 006 had two; this one has none. Any difference from board 1.4 is a defect.
- The picker's distance and a visit's measured distance are **different quantities** and must not converge (research.md §3, FR-021). No executive screen in this slice shows `distanceMeters` from a `Visit`, `isExceedRange`, or any flag.
- `AssignmentStop.addReason` exists in `03-ARCHITECTURE.md:585` but **not** in the repository schema — slice 005 omitted it deliberately because it is for manager-added extras, which are out of scope. Keep it omitted.
- Commit after each task or logical group; stop at any checkpoint to validate.


---

## T261 — what was verified without a device, and what still needs one

The slice was built and then exercised against a **live API and a real
Postgres** using a throwaway company (`SMK7`), which was removed afterwards —
the database is back exactly as it was found. What that run proved:

| Quickstart scenario | Verified | Evidence |
|---|---|---|
| 3 — nearest first, right chips | server half | `90 m` / `410 m` / `30.0 km` labels; pin-less shop listed with `distanceMeters: null` and sorted after; `beatPlanName` null → "No beat" |
| 4 — search | **yes** | name, owner name and shop code all match; a 30 km shop is absent without `search` and found with it; an already-listed shop stays excluded; no-match returns an empty list for the screen's empty state |
| 5 — selecting and adding | server half | `201` with `totalStopsToday` = count **after** the add |
| 6 — the beat plan is untouched | **yes** | `beat_plan_shops` still 1 row after five extra stops |
| 7 — a shop cannot be added twice | **yes** | eight concurrent adds, different keys → exactly one `201` and seven `409 SHOP_ALREADY_IN_BEAT`; zero duplicate `(assignment_id, shop_id)` rows |
| 8 — exactly once under retry | **yes** | same key twice → the identical stored response replayed (same `stopId`), one row; same key, different body → `409 IDEMPOTENCY_KEY_REUSED` |
| 10 — creating a shop from the field | server half | shop + stop in one call; server-generated code (`FIELDC-WP71S`); `location_source = GPS`; `location_captured_by` = the executive; `location_verified_by` null. With `autoApproveExecPins` **off** the shop is `PENDING_VERIFICATION` and the stop's coordinates are left null — the dead-end the spec records, behaving as specified |
| 13 — the state machine refuses the rest | **yes** | `409 BEAT_NOT_STARTED` before start; `404` for another executive's assignment (never `403`) on both routes; `403 FORBIDDEN_ROLE` for a Company Admin; `400` for `effectiveRadiusMeters`/`sequence`/`source`/`shopLatitude` in the body — rejected by name, not stripped; `400` for neither/both of `shopId`/`newShop`, an unknown query field, and `lat` without `lng` |
| 14 — the plan-less day | **yes** | the row is created with `beat_plan_id` null, is startable, accepts an extra stop, and `GET /assignments/today` keeps returning `NO_BEAT_PLAN` after the row exists |
| 15 — nothing left to add | server half | the picker returns an empty list once every eligible shop is on the day |
| FR-013 — frozen facts | **yes** | every extra stop carries `effective_radius_meters = 50` (the company default) and coordinates frozen **only** for `APPROVED` shops |
| SC-010 — audit | **yes** | five `extra-shop.create` / `AssignmentStop` events, each with an actor |
| FR-021 / rule 6 — no leakage | **yes** | neither `GET /shops/nearby` nor `GET /assignments/today` returns `latitude`, `longitude`, `verificationRadiusMeters`, `effectiveRadiusMeters`, a measured distance, a verdict or a flag |

**Still needs a physical device** — none of this can be judged from a server:

- **Scenario 2**, the side-by-side fidelity check against board 1.4. This is the one that decides FR-025, and this slice has **zero agreed divergences**, so any difference is a defect.
- **Scenario 1**'s UI half — the dashed action appearing only while `RUNNING`.
- **Scenario 9**, recording an outcome at an extra stop end to end.
- **Scenario 11**, offline: aeroplane mode, force-quit, restore, exactly one row.
- **Scenario 12**, degradation with location permission revoked.
- The UI halves of Scenarios 3, 5, 10 and 15.
