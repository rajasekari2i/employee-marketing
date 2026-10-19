---

description: "Task list for Brands & Reasons CRUD (Company Admin)"
---

# Tasks: Brands & Reasons CRUD (Company Admin)

**Input**: Design documents from `/specs/004-brands-reasons-crud/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/masters.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies; `quickstart.md`'s manual scenarios are the verification path (Polish phase, T166).

**Organization**: Tasks are grouped by user story (spec.md: US1–US3 are P1, US4–US6 are P2). Task IDs continue the repo-wide sequence started by `001-company-user-auth` (T001–T074), `002-shops-crud` (T075–T107) and `003-beat-plans-crud` (T108–T135) — this feature starts at **T136**. T168–T171 were appended on 2026-10-19 when the user asked for an edit/update option after the first 32 tasks had shipped.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- File paths are exact and relative to the repo root.

## Path Conventions

Existing monorepo layout (`plan.md` Structure Decision) — no new structure introduced:
- API: `apps/api/src/modules/masters/`, `apps/api/prisma/`
- Shared contracts: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/admin/`, `apps/mobile/src/navigation/`

---

## Phase 1: Setup

- [X] T136 [P] Add three error codes to `packages/shared/src/errors.ts`, following the existing `DUPLICATE_BEAT_PLAN_CODE` entry's three-place pattern exactly (the `ERROR_CODES` array, `ERROR_STATUS`, `ERROR_TITLES`), with a comment naming this slice: `DUPLICATE_BRAND_LABEL` → 409, title `'Brand label already taken'`; `DUPLICATE_REASON_LABEL` → 409, title `'Reason label already taken'`; `SYSTEM_REASON_IMMUTABLE` → 409, title `'The "Other" reason cannot be changed'`. The file's header comment states it is additive-only — do not rename or remove any shipped code.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, both tenant-isolation layers, the shared contract, and the per-company "Other" bootstrap. Every user story below needs all of this first.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T137 Add the `Brand` and `ReasonMessage` models to `apps/api/prisma/schema.prisma` exactly as `data-model.md` specifies. `Brand`: `id String @id @default(uuid())`, `companyId String @map("company_id")`, `label String`, `displayOrder Int @map("display_order")`, `isActive Boolean @default(true) @map("is_active")`, `createdAt DateTime @default(now()) @map("created_at")`, `updatedAt DateTime @updatedAt @map("updated_at")`, `@@unique([companyId, label])`, `@@index([companyId, isActive, displayOrder])`. `ReasonMessage`: the same seven fields plus `requiresText Boolean @default(false) @map("requires_text")` and `isSystem Boolean @default(false) @map("is_system")`, with the same unique/index pair. **Omit** Architecture's `orderLines OrderLine[]` and `visits Visit[]` relations — neither model exists yet (`009-visits-and-orders`). Every multi-word column must carry `@map("snake_case")` — this is the rule `002-shops-crud` broke with `shopCode` and needed a rename migration to fix.
- [X] T138 Generate the DDL migration (`pnpm --filter api prisma migrate dev --name masters`) and then hand-edit the generated `migration.sql` to append, in this order: (a) the two functional unique indexes `CREATE UNIQUE INDEX brands_company_lower_label_key ON "brands" ("company_id", lower("label"));` and `CREATE UNIQUE INDEX reason_messages_company_lower_label_key ON "reason_messages" ("company_id", lower("label"));` (data-model.md "Case-insensitive uniqueness" — Prisma cannot express a functional index, so it must be hand-written); (b) the invariant guard `CREATE UNIQUE INDEX reason_messages_one_system_per_company ON "reason_messages" ("company_id") WHERE "is_system";`; (c) the backfill `INSERT` that gives every company already in `"companies"` its system row (`label = 'Other'`, `display_order = 0`, `is_active = true`, `requires_text = true`, `is_system = true`, a generated id), written with `WHERE NOT EXISTS` so it is a correct no-op on a fresh database. Follow `20261015175722_roles_application_wide/migration.sql`'s conventions: a rationale comment, explicit `-- Step N (data)` / `-- Step N (schema)` headings, and raw quoted snake_case table/column names. **The backfill must live in this migration, not the RLS one** (research.md §3) — RLS is not yet enabled here, so the insert is not blocked by a policy.
- [X] T139 Create the sibling RLS migration `apps/api/prisma/migrations/<later-timestamp>_rls_masters/migration.sql` by copying `20261018170833_rls_beat_plans/migration.sql`'s structure for both `"brands"` and `"reason_messages"`: `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a `<table>_tenant_isolation` policy whose `USING` and `WITH CHECK` are both `"company_id" = NULLIF(current_setting('app.company_id', true), '')`. Keep the fail-closed `NULLIF` rationale comment. Add **no** `app.is_system_context` OR-branch — `company_id` is never null on either table, and the one system-context writer (`CompaniesService.create`, T143) sets `app.company_id` to the new company's id before writing, so the plain policy already admits it (research.md §3). The timestamp must sort **after** T138's migration.
- [X] T140 Register both new models in `TENANT_MODELS` in `apps/api/src/infra/prisma/tenant.extension.ts` — add `'Brand'` and `'ReasonMessage'` (the Prisma **model** names, not the mapped table names) with a comment naming this slice and pointing at the sibling `_rls_masters` migration, matching the existing `002`/`003` comment blocks. This Set is the only Layer-1 guard (the DMMF-driven test is deferred under the no-tests policy), so a missed entry silently leaves the model unscoped.
- [X] T141 [P] Create `packages/shared/src/masters.schema.ts` with the five shapes from `contracts/masters.md`, plus a header comment explaining that `displayOrder`, `isSystem`, `requiresText` and `companyId` are deliberately absent so a client that sends one fails validation (CLAUDE.md rule 1). A shared `labelSchema = z.string().trim().min(2).max(60)` — **trimmed before validation and before storage; 2–60 characters after trimming** (data-model.md "Validation rules"). Export: `createBrandSchema = z.object({ label: labelSchema })`, `createReasonSchema` (identical), `updateBrandSchema = z.object({ isActive: z.boolean() })`, `updateReasonSchema` (identical), and `reorderSchema = z.object({ ids: z.array(z.string().min(1)) })`. Note in a comment that `label` is absent from both update schemas because rename is out of scope (spec Assumptions, confirmed with the user 2026-10-19).
- [X] T142 [P] Add an explicit re-export block for `masters.schema.ts` to `packages/shared/src/index.ts`, matching the file's established style exactly — value exports first, then `export type` exports, no `export *`: `createBrandSchema`, `createReasonSchema`, `updateBrandSchema`, `updateReasonSchema`, `reorderSchema`, then types `CreateBrandInput`, `CreateReasonInput`, `UpdateBrandInput`, `UpdateReasonInput`, `ReorderInput`.
- [X] T143 Bootstrap the system "Other" reason for **new** companies in `apps/api/src/modules/companies/companies.service.ts`: widen the `CompaniesTx` `Pick<PrismaClient, …>` type to include `'reasonMessage'`, then insert the row inside the existing transaction **after** the `set_config('app.company_id', …)` / `this.cls.set('companyId', …)` pivot (currently around line 140) and before the method returns — at that point both isolation layers are already switched to the brand-new company, so a plain `tx.reasonMessage.create(...)` works with no RLS escape hatch and is atomic with the company, its settings and its first admin. Values: `companyId: company.id`, `label: 'Other'`, `displayOrder: 0`, `isActive: true`, `requiresText: true`, `isSystem: true`. Add a comment pointing at research.md §3 and the partial unique index from T138.
- [X] T144 Create `apps/api/src/modules/masters/masters.module.ts` declaring both controllers and both providers (`BrandsController`, `BrandsService`, `ReasonsController`, `ReasonsService` — created in the story phases below), and register `MastersModule` in `apps/api/src/app.module.ts`'s `imports`. One module, two resources, per Architecture §3's `modules/masters/` folder and §7's separate `/brands` and `/reasons` route bases (research.md §6).

**Checkpoint**: Schema, both isolation layers, the shared contract and the bootstrap invariant are in place — user story work can begin.

---

## Phase 3: User Story 1 - Reach the masters screen from the dashboard (Priority: P1) 🎯 MVP

**Goal**: The Admin home "Brands & reasons" tile stops being a "Coming soon" alert and opens the real masters screen (board 4.12) on the No-order reasons tab, with live counts on both tabs and on the tile.

**Independent Test**: Sign in as a Company Admin, tap the tile, confirm the masters screen opens on the reasons tab with that company's data and correct counts, and that the back control returns to Admin home. Delivers visibility of both masters before any add/reorder/toggle exists.

### Implementation for User Story 1

- [X] T145 [P] [US1] Create `apps/api/src/modules/masters/brands.service.ts` with a `list(companyId)` method, mirroring `beat-plans.service.ts`'s class structure exactly: a module-level unextended `const prisma = new PrismaClient()` fallback, a narrowed `BrandsTx = Pick<PrismaClient, 'brand' | '$executeRaw'>`, a `private tx()` reading `store.tx` from `ClsService<TransactionClsStore>`, and a `private async scopeToCaller(companyId)` that runs `` tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)` `` **and** `this.cls.set('companyId', companyId)` — called at the top of every public method. `list()` returns `{ items }` (no `nextCursor` — this endpoint is deliberately unpaginated, research.md §2) selecting `id`, `label`, `displayOrder`, `isActive`, ordered `orderBy: { displayOrder: 'asc' }`.
- [X] T146 [P] [US1] Create `apps/api/src/modules/masters/reasons.service.ts` with the same structure as T145 (`ReasonsTx = Pick<PrismaClient, 'reasonMessage' | '$executeRaw'>`). Its `list(companyId)` additionally selects `requiresText` and `isSystem`, and orders `orderBy: [{ isSystem: 'asc' }, { displayOrder: 'asc' }]` — `isSystem` sorts `false` before `true`, so the "Other" row lands last **by construction** rather than by holding a large `displayOrder` a later insert could overtake (data-model.md "Ordering").
- [X] T147 [P] [US1] Create `apps/api/src/modules/masters/brands.controller.ts` with `@ApiTags('brands') @Controller('brands') @UseGuards(RolesGuard) @Roles('COMPANY_ADMIN')` at class level and a `GET /` handler calling `brandsService.list(...)`. Copy `beat-plans.controller.ts`'s `private requireCompanyId(request: AuthenticatedRequest)` helper verbatim (it throws `AppError('FORBIDDEN_ROLE', …)` defensively).
- [X] T148 [P] [US1] Create `apps/api/src/modules/masters/reasons.controller.ts` as T147's mirror, `@ApiTags('reasons') @Controller('reasons')`, with a `GET /` handler calling `reasonsService.list(...)`.
- [X] T149 [US1] Create `apps/mobile/src/features/admin/BrandsReasonsListScreen.tsx` matching board 4.12 exactly — **decode the board first** using the recipe in CLAUDE.md (its uuid is `18525f8e-f9af-47bd-91bc-f9bbcc437cd2`, titled "Reasons and brands") and carry its values verbatim. This task covers the read-only shell: the 390-wide `#F3F5F9` frame; a header at `padding: 52px 20px 12px` with `gap: 14` holding a 44×44 back control (`borderRadius: 12`, `borderWidth: 1`, `borderColor: #DFE4EC`, `backgroundColor: #FFFFFF`, chevron path `M15 18l-6-6 6-6` at size 20, strokeWidth 2 — the existing `ICON_BACK`/`OutlineIcon` pair) beside a 24px/700 title "Brands & reasons"; the tab group (`backgroundColor: #E6EAF1`, `borderRadius: 12`, `padding: 4`, `gap: 4`, each tab `flex: 1`, `height: 38`, `borderRadius: 10`, font 600/14 — selected `backgroundColor: #FFFFFF` with `color: #141A26`, unselected transparent with `color: #5A6474`) labelled `` `No-order reasons · ${n}` `` and `` `Brands · ${n}` ``, **reasons tab selected by default**; a column header row (12px, `#5A6474`, weight 600, `padding: 0 4`) reading "Display order · label" and "Active"; and the list card (`backgroundColor: #FFFFFF`, `borderWidth: 1`, `borderColor: #DFE4EC`, `borderRadius: 16`, `overflow: hidden`) whose rows are `minHeight: 54`, `padding: 0 14px 0 4px`, `gap: 10`, `borderBottomWidth: 1`, `borderBottomColor: #ECEFF4`, each holding a 40×44 drag-handle button (icon 16×16, path `M5 9h14M5 15h14`, stroke `#5A6474`, strokeWidth 2), a monospace order number (12px, `#5A6474`, `width: 18`, rendered as **list index + 1** — never the stored `displayOrder`, data-model.md "Ordering"), the label (15px, weight 600, `#141A26` when active / `#5A6474` when inactive), and a 44×26 switch (`borderRadius: 999`, `#1D4ED8` on / `#AEB7C5` off, knob 20×20 white at `top: 3`, `left: 21` on / `3` off, shadow `0 1px 2px rgba(0,0,0,0.25)`). The handle and switch are rendered but inert in this task (wired in US4/US5). Fetch both lists via `apiRequest` on focus. **Two chrome details differ from boards 4.6/4.8 — do not copy those screens blindly**: this board has **no bottom navigation bar**, and the counts live in the **tab labels**, not in a line above the title. Follow the established posture for loading (spinner only when the list is empty, otherwise keep the stale list mounted) and empty state (a centred `ListEmptyComponent`); per research.md §8 there is deliberately **no** offline banner.
- [X] T150 [US1] Add `BrandsReasonsList: undefined` to `AdminStackParamList` and a matching `<AdminStack.Screen name="BrandsReasonsList" component={BrandsReasonsListScreen} options={{ headerShown: false }} />` to the admin stack in `apps/mobile/src/navigation/RootNavigator.tsx`, following the `BeatPlansList` entry's pattern.
- [X] T151 [US1] Wire the "Brands & reasons" tile in `apps/mobile/src/features/admin/HomeScreen.tsx` — currently `onPress={() => comingSoon('Brands & reasons')}` with `subtitle="Coming soon"` (around lines 436–441) — to `onPress={() => navigation.navigate('BrandsReasonsList')}` with a live subtitle. Add a fifth best-effort fetch in the same `useEffect` as the existing `userCounts`/`shopCounts`/`beatPlanCounts` calls, hitting `GET /brands` and `GET /reasons` and rendering `` `${brands} brands · ${reasons} reasons` ``, falling back to the existing neutral `'View all'` on failure. Simpler than its three siblings: these endpoints return the complete list, so the count is `items.length` with no `?limit=100` truncation caveat. `ICON_MASTERS` is already defined in this file — reuse it.

**Checkpoint**: The tile navigates, both lists render exactly as designed, counts are live. US1 is independently demonstrable.

---

## Phase 4: User Story 2 - Add a no-order reason (Priority: P1)

**Goal**: An admin types a label into the add field on the reasons tab, taps Add, and the reason is saved at the end of the list above the pinned "Other" row.

**Independent Test**: Open the reasons tab, add a label, confirm it appears in place and survives leaving and re-entering the screen; confirm blank, duplicate (case- and whitespace-insensitive) and out-of-range labels are each rejected with a clear message and create nothing.

### Implementation for User Story 2

- [X] T152 [US2] Add `create(companyId, input)` to `apps/api/src/modules/masters/reasons.service.ts`. Scope to caller first, then: reject a case-insensitive duplicate within the company (`label: { equals: trimmed, mode: 'insensitive' }`) with `AppError('DUPLICATE_REASON_LABEL', 'Reason label already taken.')` — a client-supplied `Other` lands here against the system row with no special-casing (spec US2 scenario 4); compute `displayOrder` as the current max non-system `displayOrder` + 1 (server-derived, never client-sent); create with `isActive: true`, `requiresText: false`, `isSystem: false`. Return the row in the same shape as one `list()` item.
- [X] T153 [US2] Add the `POST /` handler to `apps/api/src/modules/masters/reasons.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('reason.create', 'ReasonMessage')`, a `CreateReasonDto extends createZodDto(createReasonSchema)` declared locally in the controller file (deliberately not in `packages/shared` — the same split `beat-plans.controller.ts` uses), returning `201`.
- [X] T154 [US2] Add the add-row to `BrandsReasonsListScreen.tsx` per board 4.12: a `flexDirection: 'row'` with `gap: 8` holding a `TextInput` (`flexGrow: 1`, `height: 48`, `borderWidth: 1.5`, `borderColor: #CBD2DD`, `borderRadius: 12`, `paddingHorizontal: 12`, font 500/15, `backgroundColor: #FFFFFF`, placeholder "New reason label") and an "Add" `Pressable` (`height: 48`, `paddingHorizontal: 18`, `borderRadius: 12`, `backgroundColor: #1D4ED8`, `color: #FFFFFF`, font 700/15). On press, `POST /reasons` with a fresh `generateIdempotencyKey()`; on success clear the field, refresh the list and the tab count; on failure show the server's message and leave the typed text in place. Disable the button while a request is in flight so a double tap cannot fire twice (spec FR-018/SC-006 — the server's idempotency key is the real guarantee, this is the UI half). Keep the field's text **per tab**, so switching tabs never carries typed text into the other list (spec edge case).

**Checkpoint**: Reasons can be added. US1 + US2 both work.

---

## Phase 5: User Story 3 - Add a brand (Priority: P1)

**Goal**: The same add flow on the Brands tab, against the independent brand list.

**Independent Test**: Switch to the Brands tab, add a brand, confirm it appears and persists; confirm the placeholder names a brand; confirm the same text can exist once as a brand and once as a reason.

### Implementation for User Story 3

- [X] T155 [P] [US3] Add `create(companyId, input)` to `apps/api/src/modules/masters/brands.service.ts`, mirroring T152 exactly but against `brand`, throwing `AppError('DUPLICATE_BRAND_LABEL', 'Brand label already taken.')`. No `isSystem`/`requiresText` exist on this model. Because brands and reasons are separate tables, the same text may exist once in each with no special handling (spec FR-008).
- [X] T156 [P] [US3] Add the `POST /` handler to `apps/api/src/modules/masters/brands.controller.ts`, mirroring T153 with `@Audited('brand.create', 'Brand')` and `CreateBrandDto`.
- [X] T157 [US3] Extend the add-row in `BrandsReasonsListScreen.tsx` to act on the selected tab: the placeholder switches to "New brand label" and the submit targets `POST /brands` when the Brands tab is active. The brands tab renders **no** pinned "Other" row — that locked row belongs to the reasons list only (spec US3 scenario 5).

**Checkpoint**: Both lists can be added to. All three P1 stories work.

---

## Phase 6: User Story 4 - Reorder a list (Priority: P2)

**Goal**: Dragging a row by its handle saves a new display order, with "Other" immovably last.

**Independent Test**: Drag a row to a new position, leave and return, confirm the order persisted with gap-free numbering from 1; confirm "Other" cannot be dragged or displaced.

### Implementation for User Story 4

- [X] T158 [P] [US4] Add `reorder(companyId, ids)` to `apps/api/src/modules/masters/brands.service.ts`: load every brand for the company, reject unless `ids` is **exactly** that set — every row once, nothing missing, nothing extra, no duplicates, no unknown or foreign id — with `AppError('VALIDATION_FAILED', …)` rather than partially applying (contracts/masters.md). Then write each row's `displayOrder` to its 0-based position in `ids`, all inside the request transaction. Return the full list in its new order, same shape as `list()`.
- [X] T159 [P] [US4] Add `reorder(companyId, ids)` to `apps/api/src/modules/masters/reasons.service.ts`, mirroring T158 with the system row excluded throughout: the reorderable set is every **non-system** reason, so `ids` must contain all of them and must **not** contain the system row's id — if it does, throw `AppError('SYSTEM_REASON_IMMUTABLE', …)` (spec FR-013). An empty `ids` for a company whose only reason is "Other" is valid and is a no-op.
- [X] T160 [US4] Add the `PATCH /order` handler to both `brands.controller.ts` and `reasons.controller.ts` (`@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('brand.reorder', 'Brand')` / `@Audited('reason.reorder', 'ReasonMessage')`, a `ReorderDto extends createZodDto(reorderSchema)`). **Declare `PATCH /order` BEFORE `PATCH /:id` in each controller** — NestJS matches routes in declaration order, so a `:id` route declared first swallows `/order` and treats `"order"` as an id (contracts/masters.md implementation note). T164 adds the `:id` route below it.
- [X] T161 [US4] Implement drag-to-reorder in `BrandsReasonsListScreen.tsx` using React Native's built-in `PanResponder` + `Animated` — **no new package** (research.md §5). Attach the responder to the drag handle rendered in T149; rows are a fixed `54` height per board 4.12, so the drop index is `round(gestureDy / 54)` clamped to the list bounds rather than a measurement problem. Reorder optimistically in local state during the drag, then `PATCH /brands/order` or `PATCH /reasons/order` with the full ordered id array and a fresh `generateIdempotencyKey()`, rendering the authoritative list the server returns. On failure, revert to the pre-drag order and show the message — a stale-list rejection (another admin added a row meanwhile) is expected and retryable after a refresh. The "Other" row has no handle and must be excluded from both the drag targets and the submitted `ids`.

**Checkpoint**: Both lists reorder and persist. US1–US4 work.

---

## Phase 7: User Story 5 - Deactivate and reactivate an entry (Priority: P2)

**Goal**: The row switch retires a brand or reason without removing it or any history that references it.

**Independent Test**: Toggle a row off, confirm it renders muted and persists that way, toggle it back on; confirm the "Other" row has no switch and that no delete control exists anywhere.

### Implementation for User Story 5

- [X] T162 [P] [US5] Add `update(companyId, id, input)` to `apps/api/src/modules/masters/brands.service.ts`: `isActive` is the **only** mutable field (rename is out of scope — spec Assumptions). Throw `AppError('NOT_FOUND', …)` for an unknown id or one belonging to another company. Return the updated row in `list()` shape.
- [X] T163 [P] [US5] Add `update(companyId, id, input)` to `apps/api/src/modules/masters/reasons.service.ts`, mirroring T162 plus the guard: if the target row has `isSystem: true`, throw `AppError('SYSTEM_REASON_IMMUTABLE', …)` — the "Other" reason can never be deactivated (spec FR-011). This is a server-side rejection, not merely a switch the UI hides.
- [X] T164 [US5] Add the `PATCH /:id` handler to both controllers (`@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('brand.update', 'Brand')` / `@Audited('reason.update', 'ReasonMessage')`, an `UpdateBrandDto`/`UpdateReasonDto`), declared **after** the `PATCH /order` route from T160. Add **no** `DELETE` route to either controller at any path — retirement is `isActive: false` and nothing else (spec FR-015, PRD FR-ADM-09), matching `/shops`, `/users` and `/beat-plans`, none of which expose a delete.
- [X] T165 [US5] Wire the switch rendered in T149: on press, `PATCH /brands/:id` or `PATCH /reasons/:id` with `{ isActive: !current }` and a fresh `generateIdempotencyKey()`, updating the row's styling to the design's active/inactive values (`#1D4ED8`/`#AEB7C5` track, knob `left: 21`/`3`, label `#141A26`/`#5A6474`). Revert the toggle and show the message on failure. The pinned "Other" row renders no switch at all.

**Checkpoint**: All five user stories are independently functional.

---

## Phase 7b: User Story 6 - Rename an entry (Priority: P2)

**Goal**: An admin fixes a wrong label by editing it in place in the row, without retiring the entry and re-adding it.

**Added 2026-10-19**, after T136–T167 had shipped: the user asked for an edit/update option, reversing the original "no rename" scoping decision. Board 4.12 draws no rename control, so the agreed interaction (confirmed with the user) is editing the label in place — a row at rest stays pixel-identical to the board.

**Independent Test**: Tap a label, change it, confirm, and check it persists with the row in its original position; confirm a duplicate is rejected without losing the typed text, and that "Other" cannot be renamed.

### Implementation for User Story 6

- [X] T168 [US6] Make `label` updatable in `packages/shared/src/masters.schema.ts`: both `updateBrandSchema` and `updateReasonSchema` become `{ label?: labelSchema; isActive?: z.boolean() }` with a `.refine()` rejecting an empty body (`'Provide at least one field to update.'`). Reuse the existing `labelSchema` so a rename is trimmed and 2–60-bounded exactly like a create. Update the file header, which currently states that `label` is deliberately absent.
- [X] T169 [P] [US6] Extend `BrandsService.update()` in `apps/api/src/modules/masters/brands.service.ts` to apply `label` when present, re-checking for a case-insensitive duplicate **excluding the row's own id** (`id: { not: id }`) — without that exclusion, re-saving an unchanged label or changing only its capitalisation would collide with itself. Throw `DUPLICATE_BRAND_LABEL` on a real clash. Build the `data` object from only the provided fields, and leave `displayOrder` untouched — a rename never moves a row.
- [X] T170 [P] [US6] Extend `ReasonsService.update()` the same way, with the system-row guard checked **first** so renaming "Other" reports `SYSTEM_REASON_IMMUTABLE` rather than a confusing duplicate error. Renaming a non-system reason *to* `Other` still correctly returns `DUPLICATE_REASON_LABEL` through the ordinary duplicate path.
- [X] T171 [US6] Add inline rename to `apps/mobile/src/features/admin/BrandsReasonsListScreen.tsx`: tapping a row's label swaps it for a `TextInput` of the same font size/weight at the same position (autofocused, text selected), and the 44×26 switch slot is taken by a same-footprint confirm control **only while that row is editing**, so the row neither grows nor shifts. Save on keyboard submit or on the confirm control; cancel on blur — guarded by a ref set on the confirm control's `onPressIn`, which fires before blur, so tapping confirm is not swallowed by the cancel path. Starting a drag clears the edit. A failed save keeps the row in edit mode with the typed text intact. The pinned "Other" row renders no editable label.

- [X] T172 [US6] **Fix found on device (2026-10-19)**: a rename appeared to do nothing. `onBlur` was discarding the edit — with no message — so typing and then tapping away (the natural way to finish) silently threw the change away; only the small confirm control or the keyboard's done key actually saved. Make **every** exit path commit: `onBlur`, `onSubmitEditing` and the confirm control all call one `commitRename`, guarded by a `committingRef` so the three firing together still rename once. Read the working text and current row through refs rather than render closures. Close the editor immediately (the row already shows the optimistic label) and reopen it — with the typed text intact — only if the server rejects and the admin hasn't started editing another row. Drop the old `savingRef`/`onPressIn` coordination and the drag handler's force-cancel; blur now covers both.

**Checkpoint**: All six user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T166 [P] Run every scenario in `specs/004-brands-reasons-crud/quickstart.md` end to end on a device/emulator — including Scenario 2 on a company that existed **before** this slice (to actually exercise T138's backfill) and Scenario 7's two-company tenant-isolation check. For Scenario 9, compare the running screen side by side against the decoded 4.12 board and fix any visible gap (FR-020/SC-003) rather than filing it for later.
- [X] T167 [P] Regenerate `docs/openapi.json` to include the `masters` module's eight routes (`nestjs-zod` + `@nestjs/swagger`, already wired for the existing modules), mirroring how `003-beat-plans-crud`'s T135 did this.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — T136 can start immediately.
- **Foundational (Phase 2)**: T137 → T138 → T139 are strictly sequential (model before migration before RLS). T140, T141, T142 can run alongside them. T143 depends on T137 (the model must exist). T144 depends on nothing but is only meaningful once the story-phase controllers exist — register the module here and let the controllers fill in.
- **User Stories (Phases 3–7)**: all depend on Phase 2 being complete.
- **Polish (Phase 8)**: depends on every story phase you intend to ship.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. No dependency on any other story.
- **US2 (P1)**: depends on Foundational; its mobile task (T154) edits the screen US1 creates, so US1's T149 must land first.
- **US3 (P1)**: its API tasks (T155, T156) are independent of US2; its mobile task (T157) extends T154's add-row, so US2's T154 must land first.
- **US4 (P2)**: API tasks independent; T161 edits the screen from T149.
- **US5 (P2)**: API tasks independent; T165 wires the switch rendered in T149. T164 must come after T160 because of NestJS route-declaration order.

### Within Each User Story

Services before controllers; API before the screen that calls it.

### Parallel Opportunities

- T141 and T142 are both in `packages/shared` but different files — safe in parallel, though T142 re-exports T141's symbols so it must land second to typecheck.
- T145–T148 are four different new files and can all run in parallel.
- T155 and T156 are parallel with each other and with US2's API tasks.
- T158/T159 and T162/T163 are parallel pairs (different service files).
- T166 and T167 are parallel.
- **The one serialization point to respect**: every mobile task (T149, T154, T157, T161, T165) edits the same file, `BrandsReasonsListScreen.tsx`. They must run sequentially in that order regardless of which stories are otherwise parallel.

---

## Parallel Example: User Story 1

```bash
# Launch all four API files for User Story 1 together:
Task: "Create brands.service.ts with list() in apps/api/src/modules/masters/brands.service.ts"
Task: "Create reasons.service.ts with list() in apps/api/src/modules/masters/reasons.service.ts"
Task: "Create brands.controller.ts with GET / in apps/api/src/modules/masters/brands.controller.ts"
Task: "Create reasons.controller.ts with GET / in apps/api/src/modules/masters/reasons.controller.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup (T136)
2. Complete Phase 2: Foundational (T137–T144) — **blocks everything**
3. Complete Phase 3: User Story 1 (T145–T151)
4. **STOP and VALIDATE**: quickstart Scenarios 1 and 2 — the tile navigates, both lists render, every company has its "Other" row
5. Demo if ready

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → the screen exists and reads (MVP)
3. US2 → reasons can be added (the feature description's headline ask)
4. US3 → brands can be added
5. US4 → reordering
6. US5 → activation
7. Polish → full quickstart + OpenAPI regeneration

### Notes

- `[P]` tasks = different files, no dependencies.
- No native rebuild is needed at any point in this slice — no package is added (research.md §5), so a Metro reload suffices.
- Commit after each task or logical group; stop at any checkpoint to validate the story independently.
- Do not add a `DELETE` route, a rename affordance, or a client-settable `displayOrder` anywhere — all three are explicit out-of-scope decisions, not oversights.
