---

description: "Task list for Shops CRUD (Company Admin)"
---

# Tasks: Shops CRUD (Company Admin)

**Input**: Design documents from `/specs/002-shops-crud/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/shops.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies; `quickstart.md`'s manual scenarios are the verification path (Polish phase, T106).

**Organization**: Tasks are grouped by user story (spec.md: all three are P1) to enable independent implementation and testing of each.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1/US2/US3)
- File paths are exact and relative to the repo root.

## Path Conventions

Existing monorepo layout (`plan.md` Structure Decision) — no new structure introduced:
- API: `apps/api/src/modules/shops/`, `apps/api/prisma/schema.prisma`
- Shared contracts: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/admin/`, `apps/mobile/src/components/`, `apps/mobile/src/navigation/`

---

## Phase 1: Setup

**Purpose**: Bring in the one new dependency this feature needs and the one new shared error code, ahead of any schema or screen work.

- [X] T075 [P] Add `react-native-maps` to `apps/mobile/package.json` and run `pnpm install` (plan.md Primary Dependencies; research.md §2 — Google Maps provider, reusing the existing `GOOGLE_MAPS_API_KEY` config slot). This is a new native dependency: a native rebuild (`pnpm --filter mobile android`), not just a JS reload, is required before it will run.
- [X] T076 [P] Add the Google Maps Android API key meta-data entry inside `<application>` in `apps/mobile/android/app/src/main/AndroidManifest.xml`: `<meta-data android:name="com.google.android.geo.API_KEY" android:value="@string/GOOGLE_MAPS_API_KEY" />` — `react-native-config`'s `dotenv.gradle` (already wired, `apps/mobile/android/app/build.gradle`) auto-generates the `@string/GOOGLE_MAPS_API_KEY` resource from the `.env.<flavor>` file's existing `GOOGLE_MAPS_API_KEY` key, the same way `@string/APP_NAME` already backs `android:label` (research.md §2).
- [X] T077 [P] Add a `DUPLICATE_SHOP_CODE` error to `packages/shared/src/errors.ts`: add it to the `ERROR_CODES` array, `ERROR_STATUS.DUPLICATE_SHOP_CODE = 409`, and `ERROR_TITLES.DUPLICATE_SHOP_CODE = 'Shop code already taken'` (contracts/shops.md), following the existing `USERNAME_TAKEN` entry's pattern exactly.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, tenant isolation, and the shared contract — every user story below needs all of this first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T078 Add `PhotoKind.SHOP_PHOTO` to the existing `PhotoKind` enum, and add three new enums, to `apps/api/prisma/schema.prisma`: `enum LocationSource { MAP_SEARCH MANUAL_DRAG }`, `enum LocationStatus { NONE APPROVED }`, `enum PinChangeStatus { REQUESTED DECIDED }` (data-model.md Enums — deliberately missing the `PENDING`/`GPS`/`REJECTED` variants the full architecture model has; none are reachable from this feature, per data-model.md's note).
- [X] T079 Define the `Shop` model in `apps/api/prisma/schema.prisma` per data-model.md's field table: `id String @id @default(uuid())`; `companyId String @map("company_id")`; `shopCode String` (required, `@@unique([companyId, shopCode])`); `name String` (required); `ownerName String? @map("owner_name")`; `phone String?`; `addressLine1 String? @map("address_line1")`; `addressLine2 String? @map("address_line2")`; `city String?`; `state String?`; `postalCode String? @map("postal_code")`; `latitude Decimal? @db.Decimal(9, 6)`; `longitude Decimal? @db.Decimal(9, 6)`; `locationSource LocationSource? @map("location_source")`; `locationStatus LocationStatus @default(NONE) @map("location_status")`; `locationCapturedAt DateTime? @map("location_captured_at")`; `locationCapturedBy String? @map("location_captured_by")`; `locationVerifiedAt DateTime? @map("location_verified_at")`; `locationVerifiedBy String? @map("location_verified_by")`; `geohash String?`; `verificationRadiusMeters Int? @map("verification_radius_meters")`; `isActive Boolean @default(true) @map("is_active")`; relations `photos ShopPhoto[]` and `pinChanges ShopPinChange[]`; `createdAt DateTime @default(now()) @map("created_at")`; `updatedAt DateTime @updatedAt @map("updated_at")`; `@@index([companyId, isActive])`; `@@index([companyId, locationStatus])`; `@@map("shops")`.
- [X] T080 Define the `ShopPhoto` model in `apps/api/prisma/schema.prisma`: `id String @id @default(uuid())`; `companyId String @map("company_id")`; `shopId String @map("shop_id")` with `shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)`; `fileId String @map("file_id")` with `file FileObject @relation(fields: [fileId], references: [id])`; `sortOrder Int @default(0) @map("sort_order")`; `createdAt DateTime @default(now()) @map("created_at")`; `@@index([companyId, shopId, sortOrder])`; `@@map("shop_photos")`. Also add the reverse relation `shopPhotos ShopPhoto[]` to the existing `FileObject` model.
- [X] T081 Define the `ShopPinChange` model in `apps/api/prisma/schema.prisma` per data-model.md: `id String @id @default(uuid())`; `companyId String @map("company_id")`; `shopId String @map("shop_id")` with `shop Shop @relation(fields: [shopId], references: [id])`; `status PinChangeStatus @default(REQUESTED)`; `fromLatitude Decimal? @db.Decimal(9, 6) @map("from_latitude")`; `fromLongitude Decimal? @db.Decimal(9, 6) @map("from_longitude")`; `toLatitude Decimal @db.Decimal(9, 6) @map("to_latitude")`; `toLongitude Decimal @db.Decimal(9, 6) @map("to_longitude")`; `source LocationSource`; `requestedBy String @map("requested_by")`; `requestedAt DateTime @default(now()) @map("requested_at")`; `decidedBy String? @map("decided_by")`; `decidedAt DateTime? @map("decided_at")`; `@@index([companyId, shopId, status])`; `@@map("shop_pin_changes")`.
- [X] T082 Generate and apply the migration: `pnpm --filter api exec prisma migrate dev --name shops_crud`, confirming T078–T081's models apply cleanly against a local Postgres instance.
- [X] T083 Register `Shop`, `ShopPhoto`, and `ShopPinChange` in the `TENANT_MODELS` set in `apps/api/src/infra/prisma/tenant.extension.ts` (CLAUDE.md Constitution rule 2, Layer 1 — mirrors how `UserSalaryRate` was added there).
- [X] T084 Write the Postgres row-level-security migration `apps/api/prisma/migrations/<timestamp>_rls_shops/migration.sql`: for each of `"shops"`, `"shop_photos"`, `"shop_pin_changes"`, emit `ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY; ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;` plus a `<table>_tenant_isolation` policy with `USING ("company_id" = NULLIF(current_setting('app.company_id', true), ''))` and the identical `WITH CHECK`, mirroring `apps/api/prisma/migrations/20261003162753_rls_user_salary_rate/migration.sql` exactly (CLAUDE.md Constitution rule 2, Layer 2 — fail-closed when `app.company_id` is unset, no `is_system_context` branch needed since none of these three tables are ever written by a `SYSTEM_ADMIN`).
- [X] T085 [P] Add `locationSourceSchema` (`z.enum(['MAP_SEARCH', 'MANUAL_DRAG'])`) and `locationStatusSchema` (`z.enum(['NONE', 'APPROVED'])`) to `packages/shared/src/enums.ts`, following the file's existing `roleKeySchema`/`userStatusSchema` pattern, and export the matching `LocationSource`/`LocationStatus` const objects + types the same way `RoleKey`/`UserStatus` are exported there.
- [X] T086 [P] Create `packages/shared/src/shops.schema.ts` per contracts/shops.md: `createShopSchema` (`shopCode`/`name` required; `isActive`, `ownerName`, `phone`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode` optional; `verificationRadiusMeters` optional positive int; `location` optional object `{ latitude: z.number(), longitude: z.number(), source: locationSourceSchema }`); `updateShopSchema` (identical shape, every field optional); `listShopsQuerySchema` (`cursor`, `limit`, `search`, `pinStatus: z.enum(['ALL', 'NO_PIN'])` optional, `isActive` optional boolean). None of `locationStatus`, `geohash`, `locationCapturedAt/By`, `locationVerifiedAt/By` appear anywhere in these schemas — they are server-only (data-model.md Validation rules, CLAUDE.md rule 1).
- [X] T087 Create `apps/api/src/modules/shops/shops.module.ts` (imports `FilesModule`, mirrors `apps/api/src/modules/users/users.module.ts`'s shape exactly so `ShopsService` can call `FilesService` directly), an empty `ShopsController` in `apps/api/src/modules/shops/shops.controller.ts` (`@Controller('shops')`, `@UseGuards(RolesGuard)`, `@Roles('COMPANY_ADMIN')`, no routes yet), and an empty `ShopsService` in `apps/api/src/modules/shops/shops.service.ts`. Register `ShopsModule` in `apps/api/src/app.module.ts`'s `imports` array, alongside the existing module comments' style.

**Checkpoint**: Foundation ready — all three user stories below can now proceed.

---

## Phase 3: User Story 1 - Find a shop in the directory (Priority: P1) 🎯 MVP

**Goal**: A Company Admin can open the shop directory from either the Admin-home "Shops" tile or the bottom-nav "Shops" item, and search/filter it to find a specific shop.

**Independent Test**: Seed a few `Shop` rows directly (Prisma Studio or SQL) and confirm both entry points open the same list, and that search/filter narrow it correctly — this works before Create/Edit exist.

- [X] T088 [US1] Implement `ShopsService.list()` in `apps/api/src/modules/shops/shops.service.ts`: tenant-scoped cursor pagination mirroring `UsersService.list()`'s shape; `search` matches `name`, `shopCode`, `ownerName`, or `phone` (FR-003); `pinStatus: 'NO_PIN'` filters to `locationStatus = 'NONE'`, `isActive` filters on that boolean (FR-004); each returned item is shaped per contracts/shops.md's `GET /shops` response, with `photoUrls` built via `FilesService.signFileUrl` for each `ShopPhoto` and `beatPlanName` always `null` (research.md §1).
- [X] T089 [US1] Implement `GET /shops` in `apps/api/src/modules/shops/shops.controller.ts`: a `ListShopsQueryDto` via `createZodDto(listShopsQuerySchema)`, calling `ShopsService.list()` with the caller's `companyId`, following `UsersController.list()`'s exact structure (including its `requireCompanyId`/`requireCallerId` private helpers, duplicated here the same way `users.controller.ts` duplicates them from `companies.controller.ts`).
- [X] T090 [P] [US1] Create `apps/mobile/src/features/admin/ShopsListScreen.tsx` matching UI design reference board 4.8 exactly — decode it first via the Python snippet in the repo's `CLAUDE.md` ("UI must match ... exactly" section) for precise hex colors/spacing/radii/icon paths. Build: a search input; "All"/"No pin"/"Inactive" quick-filter chips, wired to `pinStatus`/`isActive`; a beat-plan filter chip rendered per the design but disabled, with an "Available once beat plans are set up" note (FR-004); one card per shop showing name, a pin-status chip, address, and `shopCode · beatPlanName · ownerName` with `beatPlanName` always rendered as "Unassigned" (FR-002); an empty state when the list is empty; and `AdminBottomNav` with `active="Shops"`.
- [X] T091 [US1] Add an `onShopsPress: () => void` prop to `apps/mobile/src/components/AdminBottomNav.tsx`, replacing its hardcoded `onPress={() => comingSoon('Shops')}` on the Shops `NavItem` with `onPress={onShopsPress}`; update every caller — `apps/mobile/src/features/admin/HomeScreen.tsx`, `apps/mobile/src/features/admin/UsersListScreen.tsx`, `apps/mobile/src/features/admin/UserFormScreen.tsx`, `apps/mobile/src/features/admin/ProfileScreen.tsx` — to pass `onShopsPress={() => navigation.navigate('ShopsList')}`.
- [X] T092 [US1] Wire `HomeScreen.tsx`'s "Shops" tile — currently `onPress={() => comingSoon('Shops')}` on the tile at line ~372–376 — to `onPress={() => navigation.navigate('ShopsList')}`.
- [X] T093 [US1] Add a `ShopsList: undefined` entry to `AdminStackParamList` and an `<AdminStack.Screen name="ShopsList" component={ShopsListScreen} options={{ headerShown: false }} />` entry to `AdminNavigator`, both in `apps/mobile/src/navigation/RootNavigator.tsx`, importing `ShopsListScreen` from `../features/admin/ShopsListScreen`.

**Checkpoint**: User Story 1 is fully functional and independently testable — the directory opens from both entry points and search/filter work, even with no create/edit screens yet.

---

## Phase 4: User Story 2 - Create a new shop (Priority: P1)

**Goal**: A Company Admin taps "New shop," fills in the form (board 4.9), and saves a new shop that then appears in the directory.

**Independent Test**: From the directory (US1), tap "New shop," complete the form, save, and confirm the new shop appears in the list — independently valuable even before edit exists.

- [X] T094 [US2] Implement `ShopsService.create()` in `shops.service.ts`: validate `shopCode` uniqueness within `companyId`, throwing `AppError('DUPLICATE_SHOP_CODE', 'Shop code already taken.')` on conflict rather than overwriting (FR-008); insert the `Shop` row; when the request's `location` is present, this is a direct capture — set `locationStatus = 'APPROVED'` and both `locationCapturedAt/By` and `locationVerifiedAt/By` to this request's timestamp/caller id (data-model.md state transitions: `NONE → APPROVED`, no `ShopPinChange` row on create); when `location` is omitted, leave `locationStatus` at its `NONE` default (FR-009).
- [X] T095 [US2] Implement `POST /shops` in `shops.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('shop.create', 'Shop')`, a `CreateShopDto` via `createZodDto(createShopSchema)`, calling `ShopsService.create()`, returning `201` with the created shop in the `GET /shops`-item shape.
- [X] T096 [US2] In `apps/api/src/modules/files/files.service.ts`, refactor `uploadAvatar`'s image-processing pipeline (validation, sharp resize/webp-encode, hash/dedupe, `FileObject` insert) into a shared private method parameterized by `kind: PhotoKind`, leaving `uploadAvatar(companyId, uploadedBy, buffer, declaredMimeType)`'s existing signature and `'USER_AVATAR'` behavior unchanged; add a new public `uploadShopPhoto(companyId: string, uploadedBy: string, buffer: Buffer, declaredMimeType: string): Promise<FileObject>` that calls the shared method with `kind: 'SHOP_PHOTO'`.
- [X] T097 [US2] Implement `POST /shops/:id/photos` in `shops.controller.ts`/`shops.service.ts`: multipart upload via `@UseInterceptors(FileInterceptor('photo', { limits: { fileSize: AVATAR_UPLOAD_MAX_BYTES } }))` mirroring `files.controller.ts`'s `uploadAvatar` route exactly (including `RequireIdempotencyKeyGuard`), calling `FilesService.uploadShopPhoto()` then inserting one `ShopPhoto` row (`sortOrder` = the shop's current photo count); reject with `AppError('VALIDATION_FAILED', 'A shop can have at most 3 photos.')` *before* calling the upload pipeline if the shop already has 3 `ShopPhoto` rows (FR-007). Also implement `DELETE /shops/:id/photos/:photoId` returning `204` after deleting that `ShopPhoto` row (the underlying `FileObject` is left in place, same as every other photo-removal in this codebase).
- [X] T098 [P] [US2] Build the Location picker inside `apps/mobile/src/features/admin/ShopFormScreen.tsx` (or a co-located helper component in the same directory): a `react-native-maps` `MapView` with a draggable `Marker` (`onDragEnd` sets `{ latitude, longitude, source: 'MANUAL_DRAG' }`), a search bar overlay that calls the Google Geocoding API with `GOOGLE_MAPS_API_KEY` from `apps/mobile/src/config.ts` and on a result recenters the map and sets `{ latitude, longitude, source: 'MAP_SEARCH' }`, and a default untouched state meaning "skip — the executive captures it" (no `location` sent on save) per FR-007/FR-009.
- [X] T099 [US2] Create `apps/mobile/src/features/admin/ShopFormScreen.tsx` matching UI design reference board 4.9 exactly in create mode (decode the board first, same as T090): a disabled "Beat plan" field with the "Available once beat plans are set up" note; `shopCode`, status, `name`, `ownerName`, `phone`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode` inputs; up to 3 photos addable via `launchImageLibrary` and `launchCamera` (`react-native-image-picker`; `android.permission.CAMERA` is already declared in `AndroidManifest.xml`) with a visible running count and a per-photo remove action, disabling further addition at 3 (FR-007); T098's Location section; an optional `verificationRadiusMeters` override input; and a Save action that calls `POST /shops`, then `POST /shops/:id/photos` once per newly added photo.
- [X] T100 [US2] Wire `ShopsListScreen`'s "New shop" FAB to `navigation.navigate('ShopForm', { shop: undefined })`.
- [X] T101 [US2] Add a new `ShopSummaryForEdit` interface to `RootNavigator.tsx` (mirroring `UserSummaryForEdit`'s shape, matching one `GET /shops` list item per contracts/shops.md) and a `ShopForm: { shop?: ShopSummaryForEdit } | undefined` entry to `AdminStackParamList`, plus an `<AdminStack.Screen name="ShopForm" component={ShopFormScreen} options={{ headerShown: false }} />` entry to `AdminNavigator`, importing `ShopFormScreen` from `../features/admin/ShopFormScreen`.

**Checkpoint**: User Stories 1 and 2 together let an admin create a shop (with or without photos/location) and immediately see it in the directory.

---

## Phase 5: User Story 3 - Edit an existing shop (Priority: P1)

**Goal**: Tapping any shop row opens the same form pre-filled with that shop's data; saving updates the existing record in place, with coordinate changes to an already-approved pin audited per BUS-17.

**Independent Test**: Open an existing shop from the directory, change a field, save, and confirm the directory reflects the change with no new row created.

- [X] T102 [US3] Implement `ShopsService.update()` in `shops.service.ts`: re-validate `shopCode` uniqueness excluding the shop's own row, same `DUPLICATE_SHOP_CODE` error as create; when `location` is provided and the shop's current `locationStatus` is `'APPROVED'` and the new coordinates differ from the currently stored ones, write one `ShopPinChange` row in the same transaction (`fromLatitude/Longitude` = the shop's current stored values, `toLatitude/Longitude` = the new ones, `source`, `requestedBy = decidedBy` = the caller's id, `status: 'DECIDED'`, `requestedAt = decidedAt` = now) *before* updating `Shop.latitude/longitude` (BUS-17; research.md §3; data-model.md state transitions: `APPROVED → APPROVED` with an audit row); when `locationStatus` is still `'NONE'`, treat the provided `location` as a direct capture exactly like `create()` (no `ShopPinChange` row); `isActive: false` only ever flips the flag — there is no delete method anywhere on this service (FR-011).
- [X] T103 [US3] Implement `PATCH /shops/:id` in `shops.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('shop.update', 'Shop')`, an `UpdateShopDto` via `createZodDto(updateShopSchema)`, calling `ShopsService.update()`, throwing `AppError('NOT_FOUND', ...)` for an id that doesn't resolve to a shop in the caller's company.
- [X] T104 [US3] Wire `ShopsListScreen`'s per-row `Pressable`/`TouchableOpacity` to `navigation.navigate('ShopForm', { shop: <that row's data, shaped as ShopSummaryForEdit> })`.
- [X] T105 [US3] Extend `ShopFormScreen.tsx` to accept the `shop` route param: when present, prefill every field (including existing `photoUrls` and the current map pin/marker position from `latitude`/`longitude` if `pinStatus === 'APPROVED'`), title the screen "Edit shop" instead of "New shop," and call `PATCH /shops/:id` instead of `POST /shops` on save — the rendered layout and styling must stay pixel-identical to create mode (board 4.9's "new" and "edit" states are the same screen per the design, FR-013).

**Checkpoint**: All three P1 stories are independently functional — full list/create/edit CRUD per spec.md, with the coordinate-correction audit trail in place.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T106 [P] Run every scenario in `specs/002-shops-crud/quickstart.md` end-to-end on a device/emulator (with a real `GOOGLE_MAPS_API_KEY` in `apps/mobile/.env.dev` for Scenarios 1–6's map interactions); for Scenario 9, compare the running `ShopsListScreen`/`ShopFormScreen` side by side against the decoded 4.8/4.9 boards and fix any visible gap (FR-013/SC-003) rather than filing it for later.
- [X] T107 [P] Regenerate `docs/openapi.json` to include the `shops` module's routes (`nestjs-zod` + `@nestjs/swagger`, already wired for `auth`/`companies`/`users`/`me`/`files`), mirroring how the prior slice's equivalent task did this for those five modules.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T075/T076/T077 can all start immediately and run in parallel (different files).
- **Foundational (Phase 2)**: Depends on Setup only for T076 reading the same `.env`/manifest area as T077's unrelated file — in practice all of Phase 2 can start immediately; T078→T079→T080→T081→T082 are strictly sequential (same file, each building on the last; T082 needs T078–T081 committed first). T083 and T084 depend on T082 (the migration must exist before registering tenant isolation against real tables). T085/T086/T087 depend on nothing in this phase but are logically "foundational" since every story needs them — **BLOCKS all user stories**.
- **User Stories (Phase 3–5)**: All depend on Foundational (Phase 2) completion.
  - **US1 (T088–T093)**: No dependency on US2/US3 — testable with seeded data alone.
  - **US2 (T094–T101)**: Depends on US1's `ShopsListScreen` existing (T090) to wire the "New shop" FAB (T100) and to have somewhere to land after save — but its API tasks (T094–T097) have no such dependency and could be built first if staffed separately.
  - **US3 (T102–T105)**: Depends on US1's `ShopsListScreen` (T090, for the row-tap target) and US2's `ShopFormScreen` (T099, the screen it extends into edit mode) — this is the one story that is not fully independent of the others, by nature of "edit reuses the create form" (spec.md's own framing).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Service method before controller route before screen wiring (T088→T089; T094→T095; T102→T103).
- Screen creation (T090, T099) before the navigation wiring that targets it (T093; T100/T101).

### Parallel Opportunities

- T075, T076, T077 (Setup) — different files.
- T085, T086 (Foundational) — different files, no dependency on each other.
- T090 (US1 screen) can be built in parallel with T088/T089 (US1 API) — the screen can be scaffolded against contracts/shops.md's documented shape before the real endpoint exists.
- T098 (US2's map picker) can be built in parallel with T094–T097 (US2 API) for the same reason.
- T106, T107 (Polish) — different concerns, different files.

---

## Parallel Example: Setup

```bash
Task: "Add react-native-maps to apps/mobile/package.json and run pnpm install"
Task: "Add the Google Maps Android API key meta-data entry to AndroidManifest.xml"
Task: "Add DUPLICATE_SHOP_CODE to packages/shared/src/errors.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Implement ShopsService.list() in apps/api/src/modules/shops/shops.service.ts"
Task: "Create apps/mobile/src/features/admin/ShopsListScreen.tsx matching board 4.8"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (critical — blocks every story).
3. Complete Phase 3: User Story 1.
4. **Stop and validate**: seed a few shops directly, confirm both entry points and search/filter work.
5. This alone is a demonstrable increment, but note spec.md frames all three stories as P1 — Create and Edit are not deferred scope, just the next two phases.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add US1 → validate independently (MVP checkpoint).
3. Add US2 → validate independently → the directory is now self-sustaining (create what you then find).
4. Add US3 → validate independently → full CRUD, including the BUS-17 audit trail on pin corrections.
5. Polish (T106/T107) → quickstart sign-off + OpenAPI.
