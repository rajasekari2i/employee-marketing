---

description: "Task list for Beat Plans CRUD (Company Admin)"
---

# Tasks: Beat Plans CRUD (Company Admin)

**Input**: Design documents from `/specs/003-beat-plans-crud/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/beat-plans.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies; `quickstart.md`'s manual scenarios are the verification path (Polish phase, T134).

**Organization**: Tasks are grouped by user story (spec.md: all three are P1) to enable independent implementation and testing of each. Task IDs continue the repo-wide sequence started by `001-company-user-auth` (T001–T074) and `002-shops-crud` (T075–T107) — this feature starts at **T108**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)
- File paths are exact and relative to the repo root.

## Path Conventions

Existing monorepo layout (`plan.md` Structure Decision) — no new structure introduced, same layout `002-shops-crud` established:
- API: `apps/api/src/modules/beat-plans/`, `apps/api/prisma/schema.prisma`
- Shared contracts: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/admin/`, `apps/mobile/src/components/`, `apps/mobile/src/navigation/`

---

## Phase 1: Setup

- [X] T108 [P] Add a `DUPLICATE_BEAT_PLAN_CODE` error to `packages/shared/src/errors.ts`: add it to the `ERROR_CODES` array, `ERROR_STATUS.DUPLICATE_BEAT_PLAN_CODE = 409`, and `ERROR_TITLES.DUPLICATE_BEAT_PLAN_CODE = 'Beat plan code already taken'` (contracts/beat-plans.md), following the existing `DUPLICATE_SHOP_CODE` entry's pattern exactly.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, tenant isolation, and the shared contract — every user story below needs all of this first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T109 Define the `BeatPlan` model in `apps/api/prisma/schema.prisma` per data-model.md's field table: `id String @id @default(uuid())`; `companyId String @map("company_id")`; `code String` (required, `@@unique([companyId, code])`); `name String` (required); `executiveId String? @map("executive_id")` (optional — a plan may have no assigned executive) with `executive User? @relation(fields: [executiveId], references: [id])`; `workingDays Int[] @map("working_days")` (1 = Mon … 7 = Sun, may be empty); `isActive Boolean @default(true) @map("is_active")`; relation `shops BeatPlanShop[]`; `createdAt DateTime @default(now()) @map("created_at")`; `updatedAt DateTime @updatedAt @map("updated_at")`; `@@index([companyId, isActive])`; `@@index([companyId, executiveId])`; `@@map("beat_plans")`. Deliberately omits `assignments DailyAssignment[]` — `DailyAssignment` doesn't exist yet (data-model.md).
- [X] T110 Define the `BeatPlanShop` model in `apps/api/prisma/schema.prisma`: `id String @id @default(uuid())`; `companyId String @map("company_id")`; `beatPlanId String @map("beat_plan_id")` with `beatPlan BeatPlan @relation(fields: [beatPlanId], references: [id], onDelete: Cascade)`; `shopId String @map("shop_id")` with `shop Shop @relation(fields: [shopId], references: [id])`; `sequence Int` (server-assigned from array position, never a client field — data-model.md; single word, no `@map` needed); `@@unique([beatPlanId, shopId])`; `@@index([companyId, beatPlanId, sequence])`; `@@map("beat_plan_shops")`.
- [X] T111 Add the two purely-additive reverse-relation fields data-model.md specifies: `beatPlanShops BeatPlanShop[]` on the existing `Shop` model, and `assignedBeatPlans BeatPlan[]` on the existing `User` model, in `apps/api/prisma/schema.prisma`. Neither changes any existing column, index, or constraint on those two models.
- [X] T112 Generate and apply the migration: `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate dev --name beat_plans_crud` (the superuser connection — see `002-shops-crud`'s T082 for why `DATABASE_URL`'s default `app_user` connection lacks the privilege to create tables), confirming T109–T111 apply cleanly against a local Postgres instance. **Before running**: spot-check that every multi-word column above actually has its `@map` — `002-shops-crud` shipped `shopCode` without one and had to fix it with a follow-up rename migration found live; do not repeat that gap here.
- [X] T113 Register `BeatPlan` and `BeatPlanShop` in the `TENANT_MODELS` set in `apps/api/src/infra/prisma/tenant.extension.ts` (CLAUDE.md Constitution rule 2, Layer 1 — mirrors how `Shop`/`ShopPhoto`/`ShopPinChange` were added there in `002-shops-crud`).
- [X] T114 Write the Postgres row-level-security migration `apps/api/prisma/migrations/<timestamp>_rls_beat_plans/migration.sql`: for each of `"beat_plans"` and `"beat_plan_shops"`, emit `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY; ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;` plus a `<table>_tenant_isolation` policy with `USING ("company_id" = NULLIF(current_setting('app.company_id', true), ''))` and the identical `WITH CHECK`, mirroring `apps/api/prisma/migrations/20261016173258_rls_shops/migration.sql` exactly (CLAUDE.md Constitution rule 2, Layer 2 — fail-closed when `app.company_id` is unset; no `is_system_context` branch needed, neither table is ever written by a `SYSTEM_ADMIN`). Apply with `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy`.
- [X] T115 [P] Create `packages/shared/src/beat-plans.schema.ts` per contracts/beat-plans.md and data-model.md's Validation rules: `createBeatPlanSchema` (`code`/`name` required; `isActive` optional boolean default `true`; `executiveId` optional string; `workingDays` optional array of distinct integers each `1`–`7`, default `[]`; `shopIds` optional array of strings, default `[]`); `updateBeatPlanSchema` (identical shape, every field optional — omitting `shopIds` entirely means "leave the list untouched," per data-model.md's state-transition note); `listBeatPlansQuerySchema` (`cursor`, `limit`, `search`, `assignment: z.enum(['ALL', 'UNASSIGNED'])` optional, `isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional()` — **not** `z.coerce.boolean()`, which `002-shops-crud` found live silently inverts `"false"` to `true`). Export the matching `CreateBeatPlanInput`/`UpdateBeatPlanInput`/`ListBeatPlansQuery` types, and add all three schemas + types to `packages/shared/src/index.ts`'s export list, following `shops.schema.ts`'s exact export shape.
- [X] T116 Create `apps/api/src/modules/beat-plans/beat-plans.module.ts` (no `imports` needed — unlike `ShopsModule`, this module doesn't need `FilesService`), an empty `BeatPlansController` in `apps/api/src/modules/beat-plans/beat-plans.controller.ts` (`@Controller('beat-plans')`, `@UseGuards(RolesGuard)`, `@Roles('COMPANY_ADMIN')`, no routes yet), and an empty `BeatPlansService` in `apps/api/src/modules/beat-plans/beat-plans.service.ts` (constructor takes only `ClsService<TransactionClsStore>`, no `FilesService`). Register `BeatPlansModule` in `apps/api/src/app.module.ts`'s `imports` array, alongside the existing module comments' style.

**Checkpoint**: Foundation ready — all three user stories below can now proceed.

---

## Phase 3: User Story 1 - Find a beat plan in the directory (Priority: P1) 🎯 MVP

**Goal**: A Company Admin can open the beat plan directory from either the Admin-home "Beat plans" tile or the bottom-nav "Beats" item, and search/filter it to find a specific plan.

**Independent Test**: Seed a few `BeatPlan` rows directly (Prisma Studio or SQL) and confirm both entry points open the same list, and that search/filter narrow it correctly — this works before Create/Edit exist.

- [X] T117 [US1] Implement `BeatPlansService.list()` in `apps/api/src/modules/beat-plans/beat-plans.service.ts`: tenant-scoped cursor pagination mirroring `ShopsService.list()`'s shape; `search` matches the plan's `name` or its assigned executive's `name` (FR-003); `assignment: 'UNASSIGNED'` filters to `executiveId: null`, `isActive` filters on that boolean (FR-004); each returned item is shaped per contracts/beat-plans.md's `GET /beat-plans` response — `executive: { id, name } | null` (joined from `User`), `shops: Array<{ id, name, pinStatus }>` in `sequence` order (joined from `BeatPlanShop` → `Shop`).
- [X] T118 [US1] Implement `GET /beat-plans` in `apps/api/src/modules/beat-plans/beat-plans.controller.ts`: a `ListBeatPlansQueryDto` via `createZodDto(listBeatPlansQuerySchema)`, calling `BeatPlansService.list()`, following `ShopsController.list()`'s exact structure (including its `requireCompanyId`/`requireCallerId` private helpers, duplicated here the same way `shops.controller.ts` duplicates them from `users.controller.ts`).
- [X] T119 [P] [US1] Create `apps/mobile/src/features/admin/BeatPlansListScreen.tsx` matching UI design reference board 4.6 exactly — decode it first via the Python snippet in the repo's `CLAUDE.md` ("UI must match ... exactly" section) for precise hex colors/spacing/radii/icon paths. Build: a search input ("Search beat or executive"); "All"/"Unassigned"/"Inactive" quick-filter chips, wired to `assignment`/`isActive`; one card per plan showing name, a status chip (Active: `#E3EBFC`/`#1E3A8A`; Unassigned: `#FCEFD9`/`#7A4105`; Inactive: reuse `UsersListScreen.tsx`'s inactive pair `#E9EDF3`/`#3A4353` — the design's sample data has no Inactive example, this is the established precedent for a third neutral status state in this codebase), `code · executive name (or "No executive")` on one line and `N shops · working-days summary` (e.g. "Mon–Sat") on the other; an empty state when the list is empty; a "New beat plan" FAB (`href="BeatPlan.dc.html"` in the design); and `AdminBottomNav` with `active="Beats"` and `onBeatsPress={() => {}}` (already on Beats, same no-op precedent `ShopsListScreen.tsx` uses for `onShopsPress` on itself).
- [X] T120 [US1] Add an `onBeatsPress: () => void` prop to `apps/mobile/src/components/AdminBottomNav.tsx`, replacing its hardcoded `onPress={() => comingSoon('Beat plans')}` on the Beats `NavItem` with `onPress={onBeatsPress}` (optional prop, same default-to-`comingSoon` pattern `onShopsPress` already established); update every caller that doesn't yet pass it — `apps/mobile/src/features/admin/HomeScreen.tsx`, `apps/mobile/src/features/admin/ProfileScreen.tsx`, `apps/mobile/src/features/admin/UsersListScreen.tsx`, `apps/mobile/src/features/admin/ShopsListScreen.tsx` — to pass `onBeatsPress={() => navigation.navigate('BeatPlansList')}`.
- [X] T121 [US1] Wire `HomeScreen.tsx`'s "Beat plans" tile — currently `onPress={() => comingSoon('Beat plans')}` / `subtitle="Coming soon"` — to `onPress={() => navigation.navigate('BeatPlansList')}` with a live `beatPlansSubtitle` following the exact pattern `shopsSubtitle`/`usersSubtitle` already established in this file: a best-effort `GET /beat-plans?limit=100` fetch counting `items.length` and `items.filter(p => p.executive === null).length`, rendered as `"{total} plans · {unassigned} unassigned"` (falling back to `'View all'` on failure), fetched in the same `useEffect` alongside the existing `userCounts`/`shopCounts` calls. Do **not** touch the separate "Today's assignments" banner above the tile grid — that's `DailyAssignment` data from a not-yet-built slice (`008-beat-day`) and stays its current static placeholder.
- [X] T122 [US1] Add a `BeatPlansList: undefined` entry to `AdminStackParamList` and an `<AdminStack.Screen name="BeatPlansList" component={BeatPlansListScreen} options={{ headerShown: false }} />` entry to `AdminNavigator`, both in `apps/mobile/src/navigation/RootNavigator.tsx`, importing `BeatPlansListScreen` from `../features/admin/BeatPlansListScreen`.

**Checkpoint**: User Story 1 is fully functional and independently testable — the directory opens from both entry points and search/filter work, even with no create/edit screens yet.

---

## Phase 4: User Story 2 - Create a new beat plan (Priority: P1)

**Goal**: A Company Admin taps "New beat plan," fills in the form (board 4.7) — name, code, optional executive, working days, an ordered shop list built from existing shops and/or a newly-created one — and saves a new plan that then appears in the directory.

**Independent Test**: From the directory (US1), tap "New beat plan," complete the form, save, and confirm the new plan appears in the list — independently valuable even before edit exists.

- [X] T123 [US2] Implement `BeatPlansService.create()` in `beat-plans.service.ts`: validate `code` uniqueness within `companyId`, throwing `AppError('DUPLICATE_BEAT_PLAN_CODE', 'Beat plan code already taken.')` on conflict rather than overwriting (FR-010); when `executiveId` is present, verify it resolves to a `User` in the caller's own `companyId` with `role.key === 'MARKETING_EXECUTIVE'` and `status === 'ACTIVE'`, rejecting with `AppError('VALIDATION_FAILED', ...)` if not (data-model.md); when `shopIds` is present, verify every id resolves to a `Shop` in the caller's own `companyId` (same `VALIDATION_FAILED` rejection for any that don't), de-duplicate repeats keeping first occurrence, then insert the `BeatPlan` row and one `BeatPlanShop` row per shop with `sequence` set to that shop's 0-based position in the (de-duplicated) array — all inside one transaction.
- [X] T124 [US2] Implement `POST /beat-plans` in `beat-plans.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('beat-plan.create', 'BeatPlan')`, a `CreateBeatPlanDto` via `createZodDto(createBeatPlanSchema)`, calling `BeatPlansService.create()`, returning `201` with the created plan in the `GET /beat-plans`-item shape.
- [X] T125 [P] [US2] Extend `apps/mobile/src/features/admin/ShopsListScreen.tsx` with two optional props, `selectionMode?: boolean` and `onSelect?: (shops: ShopSummaryForEdit[]) => void` (research.md §2): when `selectionMode` is true, tapping a row toggles a checkmark/selected state on that card instead of calling `navigation.navigate('ShopForm', ...)`, and the FAB is replaced with a "Done" action that calls `onSelect(selectedShops)` then `navigation.goBack()`. Also update `ShopsList`'s route-param type in `apps/mobile/src/navigation/RootNavigator.tsx`'s `AdminStackParamList` from `undefined` to `{ selectionMode?: boolean; onSelect?: (shops: ShopSummaryForEdit[]) => void } | undefined`. Existing behavior (no params passed) must be unchanged — every current call site (the Shops tab, `onShopsPress`/`onBeatsPress` navigation) continues to work exactly as before.
- [X] T126 [P] [US2] Extend `apps/mobile/src/features/admin/ShopFormScreen.tsx` with one optional prop/route-param, `onCreated?: (shop: ShopSummaryForEdit) => void` (research.md §3): when present and a *create* (not edit) save succeeds, call `onCreated(createdShop)` before `navigation.goBack()`, instead of only calling `navigation.goBack()`. Update `ShopForm`'s route-param type in `AdminStackParamList` from `{ shop?: ShopSummaryForEdit } | undefined` to `{ shop?: ShopSummaryForEdit; onCreated?: (shop: ShopSummaryForEdit) => void } | undefined`. Existing behavior (no `onCreated` passed) must be unchanged.
- [X] T127 [US2] Create `apps/mobile/src/features/admin/BeatPlanFormScreen.tsx` matching UI design reference board 4.7 exactly in create mode (decode the board first, same as T119): a close icon + "New beat plan" title; a 3-column grid with "Beat name" spanning 2 columns and "Code" (mono) in the third; an "Assigned executive" select-styled field that opens a picker calling `GET /users?role=MARKETING_EXECUTIVE&status=ACTIVE` (research.md §4) and shows "No executive" when unset; a 7-button working-day toggle row (Mon–Sun, each independently pressable, selected = `#1D4ED8` background/white text per the design, unselected = white background/`#CBD2DD` border); an ordered shop list section titled `Shops in visit order · {n}` with "+ Add existing shops" (navigates to `ShopsList` with `selectionMode: true` and an `onSelect` that appends the picked shops, de-duplicating against what's already in the list) and, as the list's last row, "Create a new shop in this beat" (navigates to `ShopForm` with `shop: undefined` and an `onCreated` that appends the new shop); each list row shows its sequence number, name, a pin-status chip (reusing the `#E3EBFC`/`#1E3A8A` "Pin"/`#FCEFD9`/`#7A4105` "No pin" pair), and up/down move controls plus a remove action (research.md §6 — no new drag-gesture dependency, plain state reordering); the design's own footer copy about changes applying from the next daily route (FR-016); and a footer with "Cancel" (`navigation.goBack()`) and "Create beat plan" buttons. On save: build `{ code, name, executiveId, workingDays, shopIds }` from local state (`shopIds` derived from the ordered list's current array order) and `POST /beat-plans`.
- [X] T128 [US2] Wire `BeatPlansListScreen`'s "New beat plan" FAB to `navigation.navigate('BeatPlanForm', { beatPlan: undefined })`.
- [X] T129 [US2] Add a new `BeatPlanSummaryForEdit` interface to `RootNavigator.tsx` (matching one `GET /beat-plans` list item per contracts/beat-plans.md: `id`, `name`, `code`, `executive: { id: string; name: string } | null`, `workingDays: number[]`, `isActive: boolean`, `shops: Array<{ id: string; name: string; pinStatus: 'NONE' | 'APPROVED' }>`) and a `BeatPlanForm: { beatPlan?: BeatPlanSummaryForEdit } | undefined` entry to `AdminStackParamList`, plus an `<AdminStack.Screen name="BeatPlanForm" component={BeatPlanFormScreen} options={{ headerShown: false }} />` entry to `AdminNavigator`, importing `BeatPlanFormScreen` from `../features/admin/BeatPlanFormScreen`.

**Checkpoint**: User Stories 1 and 2 together let an admin create a beat plan (with or without an executive/shops) and immediately see it in the directory.

---

## Phase 5: User Story 3 - Edit an existing beat plan (Priority: P1)

**Goal**: Tapping any beat plan row opens the same form pre-filled with that plan's data; saving updates the existing record in place — including reassigning the executive, changing working days, and reordering/adding/removing shops.

**Independent Test**: Open an existing plan from the directory, change a field or the shop order, save, and confirm the directory reflects the change with no new row created.

- [X] T130 [US3] Implement `BeatPlansService.update()` in `beat-plans.service.ts`: re-validate `code` uniqueness excluding the plan's own row, same `DUPLICATE_BEAT_PLAN_CODE` error as create; re-validate `executiveId`/`shopIds` the same way `create()` does when either is provided; when `shopIds` is provided (including an empty array), delete every existing `BeatPlanShop` row for that plan and recreate from the submitted array in the same transaction (data-model.md's full-replace state transition); when `shopIds` is omitted entirely, leave the existing shop list untouched; `isActive: false` only ever flips that flag — there is no delete method anywhere on this service (FR-013).
- [X] T131 [US3] Implement `PATCH /beat-plans/:id` in `beat-plans.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('beat-plan.update', 'BeatPlan')`, an `UpdateBeatPlanDto` via `createZodDto(updateBeatPlanSchema)`, calling `BeatPlansService.update()`, throwing `AppError('NOT_FOUND', ...)` for an id that doesn't resolve to a plan in the caller's company.
- [X] T132 [US3] Wire `BeatPlansListScreen`'s per-row tap to `navigation.navigate('BeatPlanForm', { beatPlan: <that row's data, shaped as BeatPlanSummaryForEdit> })`.
- [X] T133 [US3] Extend `BeatPlanFormScreen.tsx` to accept the `beatPlan` route param: when present, prefill every field (name, code, selected executive, working-day toggles, and the ordered shop list from `beatPlan.shops`), title the screen "Edit beat plan" instead of "New beat plan," change the footer's primary button label to "Save changes," and call `PATCH /beat-plans/:id` instead of `POST /beat-plans` on save, always sending the current `shopIds` array (so a reorder/add/remove is actually persisted) — the rendered layout and styling must stay pixel-identical to create mode (board 4.7's "new" and "edit" states are the same screen per the design, FR-015).

**Checkpoint**: All three P1 stories are independently functional — full list/create/edit CRUD per spec.md.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T134 [P] Run every scenario in `specs/003-beat-plans-crud/quickstart.md` end-to-end on a device/emulator; for Scenario 7, compare the running `BeatPlansListScreen`/`BeatPlanFormScreen` side by side against the decoded 4.6/4.7 boards and fix any visible gap (FR-015/SC-003) rather than filing it for later.
- [X] T135 [P] Regenerate `docs/openapi.json` to include the `beat-plans` module's routes (`nestjs-zod` + `@nestjs/swagger`, already wired for `auth`/`companies`/`users`/`me`/`files`/`shops`), mirroring how `002-shops-crud`'s T107 did this.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T108 can start immediately.
- **Foundational (Phase 2)**: T109→T110→T111 are strictly sequential (same file, each building on the last); T112 needs T109–T111 committed first; T113/T114 depend on T112 (the migration must exist before registering tenant isolation against real tables). T115/T116 depend on nothing in this phase but are logically "foundational" since every story needs them — **BLOCKS all user stories**.
- **User Stories (Phase 3–5)**: All depend on Foundational (Phase 2) completion.
  - **US1 (T117–T122)**: No dependency on US2/US3 — testable with seeded data alone.
  - **US2 (T123–T129)**: Depends on US1's `BeatPlansListScreen` existing (T119) to wire the "New beat plan" FAB (T128) — but its API tasks (T123–T124) and the two existing-screen extensions (T125, T126) have no such dependency and could be built first if staffed separately.
  - **US3 (T130–T133)**: Depends on US1's `BeatPlansListScreen` (T119, for the row-tap target) and US2's `BeatPlanFormScreen` (T127, the screen it extends into edit mode) — the same "edit reuses the create form" dependency `002-shops-crud`'s US3 had on its US1/US2.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Service method before controller route before screen wiring (T117→T118; T123→T124; T130→T131).
- Screen creation (T119, T127) before the navigation wiring that targets it (T122; T128/T129).

### Parallel Opportunities

- T108 (Setup) — standalone.
- T115 (Foundational) — different file from the rest of that phase's sequential schema work.
- T119 (US1 screen) can be built in parallel with T117/T118 (US1 API) — the screen can be scaffolded against contracts/beat-plans.md's documented shape before the real endpoint exists.
- T125 and T126 (US2's two existing-screen extensions) can be built in parallel with each other and with T123/T124 (US2 API) — all four are prerequisites T127 needs, not sequential among themselves.
- T134, T135 (Polish) — different concerns, different files.

---

## Parallel Example: User Story 2's prerequisites

```bash
Task: "Implement BeatPlansService.create() in apps/api/src/modules/beat-plans/beat-plans.service.ts"
Task: "Extend ShopsListScreen.tsx with selectionMode/onSelect props"
Task: "Extend ShopFormScreen.tsx with an onCreated callback prop"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (critical — blocks every story).
3. Complete Phase 3: User Story 1.
4. **Stop and validate**: seed a few beat plans directly, confirm both entry points and search/filter work.
5. As with `002-shops-crud`, spec.md frames all three stories as P1 — Create and Edit are not deferred scope, just the next two phases.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add US1 → validate independently (MVP checkpoint).
3. Add US2 → validate independently → the directory is now self-sustaining (create what you then find), and the shops feature's screens have picked up two small, reusable extensions along the way.
4. Add US3 → validate independently → full CRUD, including gap-free resequencing on every reorder/add/remove.
5. Polish (T134/T135) → quickstart sign-off + OpenAPI.
