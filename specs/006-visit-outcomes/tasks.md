---

description: "Task list for Visit Outcomes"
---

# Tasks: Visit Outcomes

**Input**: Design documents from `/specs/006-visit-outcomes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/visits.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies; `quickstart.md`'s 14 manual scenarios are the verification path (Polish, T233).

**Organization**: Grouped by user story (spec.md: US1–US3 are P1, US4–US5 are P2). Task IDs continue the repo-wide sequence — 001 (T001–T074), 002 (T075–T107), 003 (T108–T135), 004 (T136–T172), 005 (T173–T203) — so this feature starts at **T204**.

**⚠️ Native rebuild required** (`pnpm --filter mobile android`) from T205 onward — this slice adds a storage module.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/visits/`, `apps/api/src/modules/masters/`, `apps/api/prisma/`
- Shared: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/executive/`, `apps/mobile/src/lib/`

---

## Phase 1: Setup

- [X] T204 [P] Add four error codes to `packages/shared/src/errors.ts`, following the established three-place pattern (`ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`) with a comment naming this slice: `STOP_ALREADY_COMPLETED` → 409 `'Outcome already recorded'`; `SHOP_PIN_REQUIRED` → 409 `'Shop location required'`; `PIN_ACCURACY_TOO_LOW` → 409 `'Location accuracy too low'`; `PIN_ALREADY_SET` → 409 `'Shop location already set'`. Reuse the existing `BEAT_NOT_STARTED`/`BEAT_DAY_ENDED` unchanged. The file is additive-only.
- [X] T205 Add `@react-native-async-storage/async-storage` to `apps/mobile/package.json` for the held-submission queue (research.md §1). Do **not** add a connectivity library — sync is driven by request success, not a reported connection state (research.md §2). Verify autolinking picks it up and `pnpm --filter mobile android` builds.
- [X] T206 [P] Widen `GET /brands` and `GET /reasons` in `apps/api/src/modules/masters/brands.controller.ts` and `reasons.controller.ts` to also allow `MARKETING_EXECUTIVE`, and in the two services return **active entries only** for that role while leaving the Company Admin's response unchanged (research.md §6). Reasons keep the system "Other" last. Server-side filtering is the rule, not a convenience — the UI must not be able to offer a retired master (FR-008, FR-013). The `brands:read:own`/`reasons:read:own` permissions are already seeded for the executive.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [X] T207 Add to `apps/api/prisma/schema.prisma` exactly as `data-model.md` specifies. **Enum extensions**: `LocationSource` gains `GPS`; `LocationStatus` gains `PENDING_VERIFICATION` — both were deferred by `002-shops-crud` with a comment naming this flow. **New enums**: `VisitOutcome { ORDER NO_ORDER }`, `ReviewStatus { NOT_REQUIRED PENDING_REVIEW }`, `DeliveryStatus { TO_DELIVER DELIVERED }`, and `VisitFlag { LOW_ACCURACY STALE_LOCATION MOCK_LOCATION_SUSPECTED OFFLINE_SUBMISSION EXCEED_RANGE }` — `MOCK_LOCATION_SUSPECTED` is declared with **no producer** (research.md §5), comment it as such. **Models** `Visit`, `Order`, `OrderLine` with every field and `@map` from data-model.md; critically `@@unique([stopId])` on `Visit` (makes one-outcome-per-stop a database fact) and `@@unique([orderId, brandId])` on `OrderLine` (the backstop for FR-012). **Additive on `AssignmentStop`**: `shopLatitude`/`shopLongitude Decimal? @db.Decimal(9, 6) @map(...)`. Plus the five back-relations: `Shop.visits`/`Shop.orders`, `AssignmentStop.visit`, `ReasonMessage.visits`, `Brand.orderLines`, `User.visits` — the last two are the relations `004` deferred by name to this slice.
- [X] T208 Write the DDL migration `apps/api/prisma/migrations/<ts>_visits/migration.sql` by hand in Prisma's generated style (`migrate dev` cannot run here — the role lacks CREATEDB, P3014; see `20261019140000_assignments/migration.sql` for the precedent and its explanatory header). Include the two `ALTER TYPE … ADD VALUE` statements for the enum extensions, the four new enum types, the three tables, every index, and the two `ALTER TABLE "assignment_stops" ADD COLUMN` statements. **Note**: `ALTER TYPE … ADD VALUE` cannot run inside a transaction block in older Postgres — verify it applies cleanly on PG16 and split the migration if not. Apply with `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy`.
- [X] T209 Write the sibling RLS migration `apps/api/prisma/migrations/<later-ts>_rls_visits/migration.sql` covering `"visits"`, `"orders"` and `"order_lines"`, copying `20261019140018_rls_assignments/migration.sql`: `ENABLE`/`FORCE ROW LEVEL SECURITY` and a `<table>_tenant_isolation` policy with `USING` and `WITH CHECK` both `"company_id" = NULLIF(current_setting('app.company_id', true), '')`. Keep the fail-closed rationale comment, and repeat the note that RLS separates **companies**, not two executives inside one company — that second scope is enforced in the service. No `is_system_context` branch. Timestamp must sort after T208.
- [X] T210 Register `'Visit'`, `'Order'` and `'OrderLine'` in `TENANT_MODELS` in `apps/api/src/infra/prisma/tenant.extension.ts` with a comment naming this slice and its RLS migration, matching the existing blocks. This Set is the only Layer-1 guard.
- [X] T211 [P] Create `packages/shared/src/visits.schema.ts` with `submitVisitSchema` and `capturePinSchema` per contracts/visits.md. `submitVisitSchema`: `stopId`, `sampleShown: z.boolean()`, `outcome: z.enum(['ORDER','NO_ORDER'])`, optional `lines: z.array(z.object({ brandId: z.string().min(1), quantity: z.number().int().min(0) }))`, optional `reasonId`, optional `reasonText: z.string().trim().min(3).max(280)`, the position block (`latitude` −90…90, `longitude` −180…180, `accuracyMeters` int ≥ 0, `capturedAt`/`submittedAt` `z.string().datetime()`), optional `isMockLocation`, optional `fromOfflineQueue`. Add a `.superRefine` enforcing: ORDER requires ≥1 line, no duplicate `brandId`, ≥1 quantity > 0, and no `reasonId`/`reasonText`; NO_ORDER requires exactly one `reasonId` and no `lines`. Header comment must list what is deliberately absent so a client sending it fails validation (CLAUDE.md rule 1): `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, shop coordinates, `brandLabel`, `reasonLabel`, `totalQuantity`, `brandCount`.
- [X] T212 [P] Add an explicit re-export block for `visits.schema.ts` to `packages/shared/src/index.ts` — value exports then `export type`, no `export *`.
- [X] T213 Create `apps/api/src/modules/visits/visits.module.ts` (controllers + service + `CompanyClock`) and register `VisitsModule` in `apps/api/src/app.module.ts`.
- [X] T214 Freeze the shop coordinate onto stops in `apps/api/src/modules/assignments/assignments.service.ts`: when building a route, copy each shop's approved `latitude`/`longitude` onto its `AssignmentStop` alongside the radius already frozen there (research.md §4). This is what makes an offline visit synced days later measure against the location in force **when it was recorded**. A shop with no approved pin leaves them null — filled later by pin capture (T225).

**Checkpoint**: schema, both isolation layers, the contract and the module are in place.

---

## Phase 3: User Story 1 - Open a shop and see its history (Priority: P1) 🎯 MVP

**Goal**: Tapping a shop opens its visit screen with the shop's last five interactions and the sample-shown gate.

**Independent Test**: Tap a shop with prior visits; confirm identity, address, owner, call action, stop position and exactly five history rows newest first — and that no radius, distance or flag appears anywhere.

- [X] T215 [US1] Implement `getStopDetail(companyId, executiveId, stopId)` in `apps/api/src/modules/visits/visits.service.ts`, returning the shape in contracts/visits.md. Follow `assignments.service.ts`'s class structure exactly (module-level fallback client, narrowed `Tx` type, `tx()`, and `scopeToCaller()` setting both `app.company_id` and CLS at the top of every public method), **plus** the executive narrowing — the stop must belong to the caller. Compute `canRecordOutcome` and `blockedReason` from: beat not `RUNNING` → `BEAT_NOT_RUNNING`; stop already `COMPLETED` → `ALREADY_COMPLETED`; shop `locationStatus NONE` → `PIN_MISSING`; `PENDING_VERIFICATION` → `PIN_PENDING_APPROVAL`. `lastFive` is the **shop's** five most recent visits by **anyone**, newest first, each with date, outcome, a summary (`"{brandCount} brands · {totalQuantity} qty"` for an order, the reason label for a no-order) and the recorder's name. **Never select** `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters` or the shop/stop coordinates — a field never loaded cannot leak (research.md §8).
- [X] T216 [US1] Create `apps/api/src/modules/visits/visits.controller.ts` with `@ApiTags('visits') @UseGuards(RolesGuard) @Roles('MARKETING_EXECUTIVE')` and a `GET /stops/:id` handler. Scope to the caller's own executive id from the JWT (`request.user.sub`), never a parameter. Copy the defensive `requireCompanyId`/`requireExecutiveId` helpers from `assignments.controller.ts`.
- [X] T217 [US1] Create `apps/mobile/src/features/executive/ShopVisitScreen.tsx` matching board 1.7 exactly — **decode the board first** (CLAUDE.md recipe; uuid `88f67d75-52bd-4ff1-ad03-e774bf6cc96c`). Header with "Stop N of M", shop code, name, address, a "Pin verified" chip, owner line and a working call action; a "Last 5 visits · Newest first" section rendering each history row's date, kind chip, detail and recorder; a required "Sample shown?" Yes/No control; and the two outcome actions. **Do NOT render the "Visit radius" line the board shows** — FR-019, one of this feature's two agreed divergences. Disable the outcome actions and explain why when `canRecordOutcome` is false. Reuse `executiveDesign.ts` tokens; add board-1.7-only hexes there.
- [X] T218 [US1] Make the stop rows on `apps/mobile/src/features/executive/TodaysBeatScreen.tsx` tappable while the beat is running: navigate to `ShopVisit` when the shop's pin is approved, and to `CaptureShopPin` when `pinStatus` is `NONE` (FR-001). Add both routes to `ExecutiveStackParamList` and the navigator in `apps/mobile/src/navigation/RootNavigator.tsx`. Rows stay inert when the beat is not running — the existing locked behaviour must not regress.

**Checkpoint**: the visit screen is reachable and informative. US1 demonstrable.

---

## Phase 4: User Story 2 - Record an order (Priority: P1)

**Goal**: Build an order line by line and submit it.

**Independent Test**: Add three brand/quantity lines, confirm live totals, submit, and confirm the stop is completed with the order and lines recorded.

- [X] T219 [US2] Implement `submitVisit(companyId, executiveId, input)` in `visits.service.ts` — **the critical path**. One transaction, in Architecture §10's order (research.md §7, data-model.md "Server-computed classification"): load the stop/assignment/shop tenant- and executive-scoped → reject `BEAT_NOT_STARTED`, `BEAT_DAY_ENDED`, `NOT_FOUND`, `STOP_ALREADY_COMPLETED`, `SHOP_PIN_REQUIRED` → validate every `brandId` is **active and in this company** → compute flags in order (`LOW_ACCURACY` when `accuracyMeters > company.maxAccuracyMeters`; `STALE_LOCATION` when `receivedAt − capturedAt > company.maxLocationAgeSeconds`; `MOCK_LOCATION_SUSPECTED` when signalled; `OFFLINE_SUBMISSION` when `fromOfflineQueue`) → Haversine from the **stop's frozen shop coordinate** → `effectiveRadiusMeters` from the stop → `EXCEED_RANGE` + `reviewStatus = PENDING_REVIEW` when exceeded → create the `Visit` **and** its `Order` + `OrderLine`s together, snapshotting `brandLabel` per line and deriving `totalQuantity`/`brandCount` server-side → mark the stop `COMPLETED` → audit → commit. Reuse the existing `haversineMetres` from `assignments.service.ts` rather than writing a second distance implementation (CLAUDE.md rule 1 — one implementation). Return only `{ visitId, stopId, status }`.
- [X] T220 [US2] Add `POST /visits` to `visits.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('visit.create', 'Visit')`, a `SubmitVisitDto extends createZodDto(submitVisitSchema)` declared locally in the controller (the established split), returning `201` with the three-field response. Add a comment recording that the response deliberately carries **no distance, verdict or flags** (PRD FR-VISIT-12).
- [X] T221 [US2] Create `apps/mobile/src/features/executive/RecordOrderScreen.tsx` matching board 2.1 exactly (uuid `58127a13-a46f-474a-80fc-fa6c72b5eb26`): the stop/sample-shown header, the compact last-5 strip, the "Order lines · Brand · quantity" list with a brand picker per line, a stepper **and** keypad entry for quantity, an "Add brand" action, and the live "N brands / Total quantity" summary. Brands come from `GET /brands` (active-only, display order). Block continuing when there are no lines, when every quantity is zero, or when a brand repeats — surface each as its own message rather than one generic error.
- [X] T222 [US2] Create `apps/mobile/src/features/executive/ConfirmSubmitSheet.tsx` matching board 2.3 (uuid `d512ac43-eb80-4af2-8d49-65f5293dadc2`) as a bottom sheet: shop and stop, the outcome summary, the sample-shown answer, a warning that a submitted visit cannot be edited, and "Submit visit" / "Go back and edit". **Do NOT render the board's "Your location / ±Nm · fresh / Captured hh:mm:ss" block** — FR-018, the second agreed divergence. The position is still captured silently via `getCurrentPosition()` and sent with the submission; the executive is simply not told at this moment. On success return to Today with the stop completed.

**Checkpoint**: an order can be recorded end to end.

---

## Phase 5: User Story 3 - Record a no-order (Priority: P1)

**Goal**: Pick a reason — with free text when it is "Other" — and submit.

**Independent Test**: Select a reason and submit; separately confirm "Other" cannot be submitted without 3–280 characters.

- [X] T223 [US3] Extend `submitVisit` in `visits.service.ts` with the no-order branch: validate `reasonId` is **active and in this company**; snapshot `reasonLabel`; require `reasonText` of 3–280 characters **iff** that reason is the system one (`isSystem`), and reject text supplied for any other reason. No `Order` row is created. Everything else — the flag computation, the distance, the stop completion, the audit — is shared with the order path and must not be duplicated.
- [X] T224 [US3] Create `apps/mobile/src/features/executive/RecordNoOrderScreen.tsx` matching board 2.2 exactly (uuid `8012c6be-4783-4ba8-b953-9d99e371535e`): the stop/sample-shown header, the "Last 5 visits · N orders, M no order" summary, the single-select "Reason (required)" list from `GET /reasons` (active-only, display order, **"Other" last**), and the "Describe the reason (required for Other)" field that appears and becomes required only when the system reason is selected. Reuse `ConfirmSubmitSheet` from T222.

**Checkpoint**: both outcomes work. All three P1 stories complete — the usable MVP.

---

## Phase 6: User Story 4 - Capture a missing shop location (Priority: P2)

**Goal**: A shop with no saved location can have one captured, then be visited.

**Independent Test**: Open a shop with no pin, confirm the outcome path is blocked and capture is offered, save at acceptable accuracy, and confirm you can then record an outcome.

- [X] T225 [US4] Implement `capturePin(companyId, executiveId, shopId, input)` in a new `apps/api/src/modules/visits/shop-pin.service.ts` (or on `visits.service.ts`): reject `PIN_ALREADY_SET` when the shop's `locationStatus` is already `APPROVED` — an executive can never move a saved pin (FR-034); reject `PIN_ACCURACY_TOO_LOW` when `accuracyMeters > company.maxAccuracyMeters` — **this is the one place accuracy blocks**, because a bad pin poisons every future visit measured against it; otherwise write the point, accuracy, `source`, captured time and capturing user, set `locationStatus` to `APPROVED` or `PENDING_VERIFICATION` per the company's `autoApproveExecPins`, **and copy the coordinate onto today's `AssignmentStop` for that shop** (research.md §4) so the stop has its frozen measurement snapshot. Return `{ shopId, pinStatus, canRecordOutcome }`.
- [X] T226 [US4] Add `POST /shops/:id/pin` in `apps/api/src/modules/visits/shop-pin.controller.ts`: `@Roles('MARKETING_EXECUTIVE')`, `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('shop-pin.capture', 'Shop')`, a `CapturePinDto extends createZodDto(capturePinSchema)`, returning `201`. It lives in the `visits` module, not `shops`, because it is the executive's field flow and shares this module's executive scoping and stop snapshot — the admin's own pin setting stays where it is.
- [X] T227 [US4] Create `apps/mobile/src/features/executive/CaptureShopPinScreen.tsx` matching board 1.8 exactly (uuid `0af91c90-f23c-47b5-b344-72a43a604743`): the amber "This shop has no saved location. Stand at the shop entrance and save its pin before recording the first order or no-order." banner; a `react-native-maps` view with a draggable marker and an accuracy ring; address search; the "GPS accuracy ±N m" readout with its verdict chip; the coordinate/source/captured line; the "Accuracy must be N m or better to save a pin. Step outside, away from tall walls, and retry." guidance; a **Retry GPS** action; and **Save shop pin disabled** while accuracy is worse than the company maximum. Track `source` as `GPS`, `MAP_SEARCH` or `MANUAL_DRAG` by how the point was last set. On success continue to `ShopVisit` when `canRecordOutcome`, else explain approval is needed. **Known limitation**: the dev `GOOGLE_MAPS_API_KEY` is empty so tiles render blank (research.md §9) — everything else must still work.

**Checkpoint**: a brand-new shop can be pinned and visited.

---

## Phase 7: User Story 5 - Submit with no signal (Priority: P2)

**Goal**: Outcomes recorded without a connection are held, survive a restart, and sync exactly once.

**Independent Test**: Airplane mode → submit → "waiting to sync" → force-close and reopen → still queued → reconnect → syncs once, stop completed, flagged as offline.

- [X] T228 [US5] Create `apps/mobile/src/lib/outbox.ts` — the held-submission queue (research.md §1): one ordered JSON list in `AsyncStorage` under a single key, every mutation funnelled through **one promise chain** so a read-modify-write from two callers cannot drop an item (this serialisation is load-bearing, not a nicety). Item shape per data-model.md: `id`, `kind: 'VISIT' | 'PIN'`, `idempotencyKey`, `path`, `body`, `recordedAt`, `attempts`, `lastError`. **The idempotency key is minted when the item is enqueued and reused on every send attempt for the life of the item** (research.md §3) — minting at send time would make a retried visit a duplicate, which is the single most important invariant in this slice. Expose: `enqueue`, `list`, `count`, `remove`, `markFailed`.
- [X] T229 [US5] Add the sync driver to `outbox.ts`: send items **FIFO by `recordedAt`**, stopping on the first failure so order is preserved; drive it from four triggers — immediately after `enqueue`, on app foreground (`AppState` 'active'), after any other successful `apiRequest`, and when Today loads. **No connectivity library** (research.md §2). Treat a `4xx` that cannot resolve by retrying as permanent: stop retrying, record `lastError`, and surface it (FR-040). Treat network failures and `5xx` as retryable.
- [X] T230 [US5] Route visit submission and pin capture through the outbox in `ConfirmSubmitSheet.tsx` and `CaptureShopPinScreen.tsx`: enqueue first, then attempt an immediate send. A failed send is **not** an error to the executive — the submission is accepted and shown as waiting to sync (FR-035), and they return to Today with the stop shown as completed locally. A pin capture must queue **ahead of** any visit that depends on it (FR-042), which FIFO ordering gives for free as long as the pin is enqueued first.
- [X] T231 [US5] Surface the queue in `TodaysBeatScreen.tsx`: show how many submissions are waiting (FR-039), show a permanently-rejected item with its reason rather than letting it fail silently (FR-040), and **warn on logout while the queue is non-empty, keeping the session rather than discarding it** (FR-041) — update the account menu's logout handler.

**Checkpoint**: the app works in a dead spot. All five stories complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T232 [P] Widen the location-permission rationale in `apps/mobile/src/lib/location.ts` to state that location is saved when **recording visits**, not only when starting and ending the beat (FR-021). This is load-bearing, not cosmetic: because the confirm sheet deliberately says nothing about location (FR-018), the permission prompt is now the only place the app discloses what it does with it.
- [ ] T233 [P] Run all 14 scenarios in `specs/006-visit-outcomes/quickstart.md` on a device after a native rebuild. Scenario 6 (offline) and Scenario 7 (exactly-once) are the ones that justify this slice's size — do not sign off without them. Scenario 8 verifies the server owns the measurement and that a client-supplied `distanceMeters` is rejected. Scenario 12 is the fidelity check: the **only** permitted differences from the boards are the two agreed removals.
- [X] T234 [P] Regenerate `docs/openapi.json` to include `GET /stops/{id}`, `POST /visits` and `POST /shops/{id}/pin`, mirroring how `005`'s T203 did it.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup**: T204 and T206 are independent; T205 gates every mobile task and forces the rebuild.
- **Foundational**: T207 → T208 → T209 sequential. T210–T213 follow T207. T214 edits a `005` file and is independent of the rest.
- **User Stories**: all depend on Phase 2.
- **Polish**: depends on the stories you intend to ship.

### User Story Dependencies

- **US1 (P1)**: Foundational only. The MVP.
- **US2 (P1)**: T219/T220 are independent of US1's API work; T221/T222 follow T217 (same screen family and nav routes).
- **US3 (P1)**: T223 **extends T219's method** — it must land after it, not alongside. T224 reuses T222's sheet.
- **US4 (P2)**: T225/T226 independent; T227 needs T218's route.
- **US5 (P2)**: T228/T229 are self-contained; T230 edits the screens from T222 and T227, so it lands after both; T231 edits `TodaysBeatScreen`.

### Parallel Opportunities

- T204 and T206 (different files).
- T211 and T212 both in `packages/shared` — T212 re-exports T211, so it lands second.
- T215/T216 (US1 API) alongside T221 (US2 screen), once T217 exists.
- T225/T226 (US4 API) alongside US3's screen work.
- T232, T233 and T234.
- **Serialization points to respect**: `visits.service.ts` is edited by T215, T219 and T223 in that order. `TodaysBeatScreen.tsx` is edited by T218 and T231. `ConfirmSubmitSheet.tsx` by T222 then T230.

---

## Implementation Strategy

### MVP (US1 + US2 + US3)

1. Setup (T204–T206) — note T205 forces the rebuild
2. Foundational (T207–T214) — **blocks everything**
3. US1 (T215–T218) → validate: quickstart Scenario 1
4. US2 (T219–T222) → validate: Scenarios 2, 5, 8
5. US3 (T223–T224) → validate: Scenario 3
6. **Stop and demo** — an executive can record real outcomes

### Incremental Delivery

7. US4 (T225–T227) → Scenario 4 — new shops can be pinned
8. US5 (T228–T231) → Scenarios 6, 7, 10 — the app works offline
9. Polish (T232–T234) → full quickstart + OpenAPI

### Notes

- `[P]` = different files, no dependencies.
- **Do not add**: a client-side distance calculation, a second `haversineMetres`, `effectiveRadiusMeters`/`distanceMeters`/`isExceedRange`/`flags`/`reviewStatus` in any executive response, a visit edit or delete route, or a connectivity library. Each is a reasoned exclusion (research.md §2/§7/§8, data-model.md), not an oversight.
- **Two agreed divergences from the design, and only two**: no location block on the confirm sheet (T222), no visit radius on the visit screen (T217).
- `MOCK_LOCATION_SUSPECTED` is declared with no producer (research.md §5) — do not fake a value to make it look complete.
- Commit after each task or logical group; stop at any checkpoint to validate.
