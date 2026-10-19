---

description: "Task list for Executive Dashboard — Today's Beat"
---

# Tasks: Executive Dashboard — Today's Beat

**Input**: Design documents from `/specs/005-executive-dashboard/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/assignments.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies; `quickstart.md`'s 14 manual scenarios are the verification path (Polish phase, T202).

**Organization**: Tasks are grouped by user story (spec.md: US1–US3 are P1, US4–US5 are P2, US6 is P3). Task IDs continue the repo-wide sequence — `001-company-user-auth` (T001–T074), `002-shops-crud` (T075–T107), `003-beat-plans-crud` (T108–T135), `004-brands-reasons-crud` (T136–T172) — so this feature starts at **T173**.

**⚠️ This slice requires a native rebuild** (`pnpm --filter mobile android`), unlike every prior slice: it adds a native geolocation module and two Android manifest permissions. A Metro reload is not enough from T174 onward.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- File paths are exact and relative to the repo root.

## Path Conventions

Existing monorepo layout (`plan.md` Structure Decision):
- API: `apps/api/src/modules/assignments/`, `apps/api/src/infra/`, `apps/api/prisma/`
- Shared contracts: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/executive/`, `apps/mobile/src/components/`, `apps/mobile/src/lib/`, `apps/mobile/src/navigation/`

---

## Phase 1: Setup

- [ ] T173 [P] Add two error codes to `packages/shared/src/errors.ts`, following the existing `DUPLICATE_BEAT_PLAN_CODE` entry's three-place pattern (the `ERROR_CODES` array, `ERROR_STATUS`, `ERROR_TITLES`), with a comment naming this slice: `BEAT_DAY_ENDED` → 409, title `'Beat day already ended'`; `BEAT_NOT_STARTED` → 409, title `'Beat day not started'`. The file header states it is additive-only — do not rename or remove a shipped code.
- [ ] T174 Add device positioning to the mobile app (research.md §3): install `@react-native-community/geolocation`; add `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />` and `<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />` to `apps/mobile/android/app/src/main/AndroidManifest.xml`. **Coarse is declared deliberately alongside fine**: Android 12+ lets the user grant approximate location only, and without it declared that choice fails outright instead of returning the low-accuracy fix FR-014 wants to accept and record. Do **not** add `react-native-permissions` — the runtime request uses React Native core's `PermissionsAndroid` (T192). Verify autolinking picks up the new native module and that `pnpm --filter mobile android` builds.
- [ ] T175 [P] Add `latitude` and `longitude` to the pino redaction list in the API logger config (alongside the existing `password`, `token`, `authorization`, `reasonText`, `otp` entries). This is the first feature in the product to handle real coordinates; FR-026 and CLAUDE.md rule 9 forbid one ever reaching a log line. Verified by quickstart Scenario 14.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, both isolation layers, the shared contract, the single time-conversion service, and the executive app shell. Every user story below needs all of this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T176 Add three enums and two models to `apps/api/prisma/schema.prisma` exactly as `data-model.md` specifies. Enums: `BeatDayStatus { RUNNING ENDED }` — **omit `AUTO_CLOSED`**, which has no writer without a scheduled job (research.md §9); `StopStatus { PENDING COMPLETED SKIPPED REVISIT }` and `StopSource { PLAN EXEC_EXTRA MANAGER_EXTRA }` — these **do** declare their full sets even though only `PENDING`/`PLAN` have writers, because this slice's ordering (FR-011) and counts (FR-017) read the others. `DailyAssignment`: `id`, `companyId @map("company_id")`, `businessDate DateTime @db.Date @map("business_date")`, `executiveId @map("executive_id")` + `executive User` relation, `beatPlanId String? @map("beat_plan_id")` + `beatPlan BeatPlan?` relation, `beatPlanName String? @map("beat_plan_name")`, `status BeatDayStatus?` (**null until started** — this is the three-state field), `startedAt`/`endedAt DateTime? @map(...)`, `startLatitude`/`startLongitude`/`endLatitude`/`endLongitude Decimal? @db.Decimal(9, 6) @map(...)`, `startAccuracyMeters`/`endAccuracyMeters Int? @map(...)`, `stops AssignmentStop[]`, `createdAt`. Indexes: `@@unique([companyId, businessDate, executiveId])`, `@@index([companyId, businessDate])`, `@@index([companyId, executiveId, businessDate])`, `@@map("daily_assignments")`. `AssignmentStop`: `id`, `companyId @map`, `assignmentId @map` + relation `onDelete: Cascade`, `shopId @map` + `shop Shop` relation, `sequence Int`, `source StopSource @default(PLAN)`, `status StopStatus @default(PENDING)`, `addedByUserId String? @map("added_by_user_id")`, `addedAt DateTime? @map("added_at")`, `effectiveRadiusMeters Int @map("effective_radius_meters")`; indexes `@@unique([assignmentId, shopId])`, `@@index([companyId, assignmentId, status])`, `@@index([companyId, shopId])`, `@@map("assignment_stops")`. **Omit** `autoClosed`, `endNote`, `addReason` and the `visits Visit[]` back-relation (no writers/readers yet). Add the three additive back-relations: `User.assignments`, `BeatPlan.assignments`, `Shop.assignmentStops`. Every multi-word column must carry `@map("snake_case")`.
- [ ] T177 Write the DDL migration `apps/api/prisma/migrations/<ts>_assignments/migration.sql` by hand in Prisma's generated style (`prisma migrate dev` cannot run here — the DB role lacks CREATEDB so the shadow database fails with P3014; see `20261019093000_masters/migration.sql` for the established precedent and its explanatory header). Create the three enum types, both tables, and every index from T176 — in particular `daily_assignments_company_id_business_date_executive_id_key`, which is **load-bearing**: it is the entire concurrency guarantee for create-on-first-open (research.md §1), not a tidiness constraint. Apply with `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy`.
- [ ] T178 Write the sibling RLS migration `apps/api/prisma/migrations/<later-ts>_rls_assignments/migration.sql`, copying `20261019093018_rls_masters/migration.sql`'s structure for both `"daily_assignments"` and `"assignment_stops"`: `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a `<table>_tenant_isolation` policy whose `USING` and `WITH CHECK` are both `"company_id" = NULLIF(current_setting('app.company_id', true), '')`. Keep the fail-closed `NULLIF` rationale comment. No `app.is_system_context` OR-branch — neither table is ever written by a `SYSTEM_ADMIN`. Timestamp must sort **after** T177.
- [ ] T179 Register `'DailyAssignment'` and `'AssignmentStop'` in `TENANT_MODELS` in `apps/api/src/infra/prisma/tenant.extension.ts`, with a comment naming this slice and pointing at the sibling `_rls_assignments` migration, matching the existing `002`/`003`/`004` blocks. This Set is the only Layer-1 guard, so a missed entry silently leaves the model unscoped.
- [ ] T180 Create `apps/api/src/infra/time/company-clock.service.ts` — **the single UTC↔company-local conversion point** required by CLAUDE.md rule 8. For this slice it needs one method: given an IANA timezone, return the company-local calendar date as `YYYY-MM-DD`, implemented with `new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })` — **no Luxon** (research.md §2; verified across `Asia/Kolkata`, `UTC`, `America/Los_Angeles` and `Pacific/Auckland`, the last correctly reporting the next calendar day). Document in the class comment that a later feature needing real time arithmetic adopts Luxon *inside this service* without touching a caller. Register it so the assignments module can inject it.
- [ ] T181 [P] Create `packages/shared/src/assignments.schema.ts` with the one body shape both commands share (contracts/assignments.md): `startBeatSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters: z.number().int().min(0), capturedAt: z.string().datetime() })`, and `endBeatSchema` identical. Add a header comment listing what is deliberately absent so a client sending one fails validation rather than having it dropped (CLAUDE.md rule 1): `businessDate`, `status`, `startedAt`/`endedAt`, and every `AssignmentStop` field including `sequence`, `source`, `status` and `effectiveRadiusMeters`. Note that `capturedAt` is the device's *claim* and that the authoritative time is always the server's clock.
- [ ] T182 [P] Add an explicit re-export block for `assignments.schema.ts` to `packages/shared/src/index.ts`, matching the file's style exactly — value exports first, then `export type`, no `export *`.
- [ ] T183 Create `apps/api/src/modules/assignments/assignments.module.ts` (controller + service + `CompanyClock` provider) and register `AssignmentsModule` in `apps/api/src/app.module.ts`'s `imports`, following the `MastersModule` precedent.
- [ ] T184 [P] Create `apps/mobile/src/features/executive/executiveDesign.ts` holding board 1.3's own tokens, decoded from the board first (CLAUDE.md's recipe; uuid `20463df0-5cdd-44a1-bce2-f24ff89bf4c6`, titled "Today's beat") — the card blues `#1D4ED8` / `#4169E1`, the amber accent `#F2C572`, the running strip `#E3EBFC` on `#C7D6FA`, the confirm strip `#FCEFD9` on `#F0D2A0` with text `#6B3904`, the ended card `#141A26` with chip `#3A4353` and muted `#C4CBD8`, the status chips (pending `#E9EDF3`/`#3A4353`, revisit & extra `#EFE9FB`/`#5B2FA6`), the pin chips (saved `#E3EBFC`/`#1E3A8A`, missing `#FCEFD9`/`#7A4105`), and the locked strip `#E9EDF3`/`#3A4353`. Re-export the shared tokens from `../admin/adminDesign` where they are identical rather than redefining them.
- [ ] T185 [P] Create `apps/mobile/src/components/ExecutiveBottomNav.tsx` — the design's **three**-item bar (Today · My visits · My totals), mirroring `AdminBottomNav.tsx`'s structure and its 84px height / `#FFFFFF` / `1px #DFE4EC` top border, with the board's own glyphs. Only Today navigates; the other two use the app's established "coming soon" affordance. All three must render so the bar's spacing matches board 1.3 exactly (research.md §7).
- [ ] T186 Add a third navigation stack in `apps/mobile/src/navigation/RootNavigator.tsx`: an `ExecutiveStackParamList` with `TodaysBeat: undefined`, an `ExecutiveNavigator` with `headerShown: false`, and a branch in `stackForRole` returning it for `MARKETING_EXECUTIVE` — leaving `MANAGER`/`SYSTEM_ADMIN` on the existing placeholder. Create `apps/mobile/src/features/executive/TodaysBeatScreen.tsx` as a minimal shell for now (filled in US1).

**Checkpoint**: Schema, both isolation layers, the contract, the clock and the executive shell are in place. An executive now lands on their own stack instead of the placeholder.

---

## Phase 3: User Story 1 - See today's route before starting (Priority: P1) 🎯 MVP

**Goal**: An executive signs in and sees today's beat plan, its stop count, a "Not started" tag and the full ordered shop list — created on first open, locked until the beat starts.

**Independent Test**: Sign in as an executive whose plan covers today, confirm the screen opens with the plan name, stop count, "Not started" tag, locked strip and every shop in sequence; confirm reopening does not create a second route.

### Implementation for User Story 1

- [ ] T187 [US1] Implement route creation in `apps/api/src/modules/assignments/assignments.service.ts`: a private `ensureTodayRoute(companyId, executiveId)` that resolves the company-local business date via `CompanyClock` (never the device clock, FR-005), looks for an existing `DailyAssignment` for `(companyId, businessDate, executiveId)`, and when absent builds one from the executive's **active** beat plan if `workingDays` includes today's weekday. Freeze the snapshot per FR-007: copy `beatPlanName`, and for each `BeatPlanShop` create an `AssignmentStop` with the plan's `sequence`, `source: PLAN`, `status: PENDING`, and `effectiveRadiusMeters` = `Shop.verificationRadiusMeters ?? CompanySettings.defaultRadiusMeters` resolved **at creation time**. **Wrap the create so a unique-constraint violation on `(companyId, businessDate, executiveId)` is caught and the winning row re-read and returned** — that is the whole concurrency guarantee for two devices, a double tap or a refresh storm (research.md §1), not a lock. Follow `beat-plans.service.ts`'s class structure exactly (module-level fallback client, narrowed `Tx` type, `tx()`, and `scopeToCaller()` running `set_config('app.company_id', …)` **and** `cls.set('companyId', …)` at the top of every public method).
- [ ] T188 [US1] Implement `getToday(companyId, executiveId)` in the same service, returning the shape in contracts/assignments.md. Derive `state` from the nullable `status` column: null → `NOT_STARTED`, else `RUNNING`/`ENDED`. Order stops per FR-011 — to-do first, then revisit, then completed, with extra-sourced stops first inside each group and planned stops by `sequence` — **on the server**, so the three tabs, any later screen and any report agree (research.md §6). Compute `counts` so they match the list exactly (SC-007): `total`, `pending`, `completed`, `revisit`, `extra`, `visited` (= completed), `notVisited` (= pending + skipped), and `orders`/`noOrder` as 0 until visit submission exists. Return `{ assignment: null, noBeatReason: 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY' }` when no route can be created, distinguishing the two per FR-008. **Never serialise `effectiveRadiusMeters`, nor any distance or flag field** — it is stored but must not leave the server, or the device could derive its own range verdict (CLAUDE.md rule 6, research.md §5). `previousOutcome` is `null` for every stop until visit history exists.
- [ ] T189 [US1] Create `apps/api/src/modules/assignments/assignments.controller.ts` with `@ApiTags('assignments') @Controller('assignments') @UseGuards(RolesGuard) @Roles('MARKETING_EXECUTIVE')` and a `GET today` handler calling `getToday`. Scope to the caller's **own** executive id from the JWT — never a query parameter — so tenant isolation alone is never what separates two executives. Copy `beat-plans.controller.ts`'s defensive `requireCompanyId(request)` helper. Add a comment recording that this read may write (research.md §1) and that it deliberately takes **no** `Idempotency-Key`, the unique index being the guarantee.
- [ ] T190 [US1] Build the not-started state of `apps/mobile/src/features/executive/TodaysBeatScreen.tsx` to match board 1.3 exactly — **decode the board first**. Header at `padding: 56px 20px 16px`, `gap: 14`: a date-and-greeting line (14px, `#5A6474`, weight 500), the 30px/700 title "Today's beat", a 44×44 refresh button (`borderRadius: 12`, `1px #DFE4EC`, white) and the avatar menu offering Profile and Log out. The not-started card: `#1D4ED8`, `borderRadius: 18`, `padding: 16`, `gap: 14`, holding a "Beat plan" label (13px `#D3DFFB`), the plan name (19px/700), the stop-count line (12px `#D3DFFB`), a "Not started" chip (`#4169E1`), a 54px white **Start beat** button (`borderRadius: 14`, blue text, play glyph) and the footnote "Your location and the time are saved when you start. Visits can be recorded only after the beat starts." Below, the locked strip (`#E9EDF3`, `#3A4353`, lock glyph) reading "Start the beat to record visits and add extra shops." Then the stop rows: a 34×34 sequence badge (`#F3F5F9`, 15px/700, showing `EX` for extra), shop name 16px/700, status chip, ellipsized address (13px `#5A6474`), and a chip pair for pin status and previous outcome. **Rows are not tappable while not started** (FR-016). Render the row's history chip as the design's own "First visit" wording whenever `previousOutcome` is null (research.md §8).
- [ ] T191 [US1] Render the two no-route states in the same screen from `noBeatReason`: `NOT_A_WORKING_DAY` and `NO_BEAT_PLAN` must say **which** applies (FR-008) — they call for different actions — rather than sharing one empty state. Keep the header and bottom bar intact in both.

**Checkpoint**: An executive sees their real route for today, created on first open. US1 is independently demonstrable.

---

## Phase 4: User Story 2 - Start the beat (Priority: P1)

**Goal**: Tapping Start beat captures location and time, opens the day, and switches the card to the running state.

**Independent Test**: Tap Start beat, grant location, confirm the card switches to running with a start time, a ticking elapsed timer and the nearest-shop line; confirm a denied permission leaves the beat not started with a clear message.

### Implementation for User Story 2

- [ ] T192 [US2] Create `apps/mobile/src/lib/location.ts` wrapping `@react-native-community/geolocation` and React Native core's `PermissionsAndroid` (no extra package, research.md §3): one function that requests `ACCESS_FINE_LOCATION` with a rationale explaining why the app needs it (FR-015), then resolves a single position as `{ latitude, longitude, accuracyMeters, capturedAt }`. Distinguish the three failure modes the screen must report differently — permission denied, permission permanently denied, and no fix within a timeout — and never throw a raw platform error at the UI. Configure the module to prefer Play Services for accuracy.
- [ ] T193 [US2] Implement `start(companyId, executiveId, assignmentId, input)` in `assignments.service.ts`: scope to caller, load the day (404 for an unknown id, another company's, or **another executive's**), then apply the state machine from data-model.md — a day already `RUNNING` **returns unchanged with 200, never an error, even under a different `Idempotency-Key`** (FR-021, Architecture §10); a day already `ENDED` throws `AppError('BEAT_DAY_ENDED', …)`. Otherwise set `status: RUNNING`, `startedAt` from the **server's** clock (not the client's `capturedAt`, which is stored only as the device's claim), and the start coordinates and accuracy. **Accuracy is recorded and never blocks** (FR-014). Then compute `nearestShopName` by straight-line distance from the recorded start point over today's stops whose shop has an approved pin, excluding unpinned shops from that comparison only (research.md §6) — distance is computed server-side only, never on the device (CLAUDE.md rule 1).
- [ ] T194 [US2] Add `POST :id/start` to `assignments.controller.ts`: `@UseGuards(RequireIdempotencyKeyGuard)`, `@Audited('beat-day.start', 'DailyAssignment')`, a `StartBeatDto extends createZodDto(startBeatSchema)` declared locally in the controller (the same split `beat-plans.controller.ts` uses), returning **200, not 201** — a repeated start is an expected outcome, not a creation.
- [ ] T195 [US2] Wire the Start beat button in `TodaysBeatScreen.tsx`: request location via T192's helper, then `POST /assignments/:id/start` with a fresh `generateIdempotencyKey()`. On each distinct location failure show a specific message and leave the screen in the not-started state (FR-015) — never a partial or apparently-successful start. On success render the running card per board 1.3: plan name, the planned-plus-extra line in `#F2C572`, the big `5/13`-style counter (28px/700 with a 16px `#D3DFFB` denominator), the 8px progress bar (track `#4169E1`, fill `#F2C572`), and the four-column Pending / Completed / Revisit / Extra stats (17px/700 values over 12px `#D3DFFB` labels). Below it the running strip (`#E3EBFC` on `1px #C7D6FA`, `borderRadius: 14`): a 10px blue dot, "Beat running · {elapsed}" (13px/700 `#1E3A8A`) over "Started {time} at {nearestShopName}", and a 40px **End beat** button (`1.5px #141A26`). Drive the elapsed timer from `startedAt` so backgrounding and returning keeps it accurate (SC-009) rather than counting ticks.

**Checkpoint**: The day can be opened. US1 + US2 deliver a usable morning.

---

## Phase 5: User Story 3 - Filter by To do, Done and All (Priority: P1)

**Goal**: Three tabs with live counts let the executive work the list.

**Independent Test**: Switch between the three tabs and confirm each shows the right subset with counts that add up (To do + Done = All).

### Implementation for User Story 3

- [ ] T196 [US3] Add the filter tabs to `TodaysBeatScreen.tsx` per board 1.3 — the same pill group the admin masters screen uses (`#E6EAF1` track, `padding: 4`, `gap: 4`, `borderRadius: 12`; each tab `flex: 1`, `height: 38`, `borderRadius: 10`, 600/14; selected white on `#141A26`, unselected transparent on `#5A6474`) — labelled `To do · {n}`, `Done · {n}`, `All · {n}` from the server's `counts`, defaulting to **To do**. Filter the already-ordered array from the server without re-sorting it (research.md §6): To do = pending + revisit, Done = completed, All = everything. An empty tab shows an empty state, not an error. The tabs render in every beat state, exactly as the board draws them.

**Checkpoint**: All three P1 stories work — this is the usable MVP.

---

## Phase 6: User Story 4 - End the beat (Priority: P2)

**Goal**: An inline confirmation in the same card closes the day.

**Independent Test**: With a pending stop, tap End beat, confirm the inline warning names that shop, choose Keep going and confirm nothing changed, then end for real.

### Implementation for User Story 4

- [ ] T197 [US4] Implement `end(companyId, executiveId, assignmentId, input)` in `assignments.service.ts`, mirroring T193's guards and ownership checks: a day already `ENDED` **returns unchanged with 200**; a day that never started throws `AppError('BEAT_NOT_STARTED', …)`. Otherwise set `status: ENDED`, `endedAt` from the server's clock, and the end coordinates and accuracy. **Do not rewrite pending stops to `SKIPPED`** — "not visited" is counted at read time from stops still pending or skipped, so the record keeps what was actually true rather than being retro-stamped (data-model.md, CLAUDE.md rule 4).
- [ ] T198 [US4] Add `POST :id/end` to `assignments.controller.ts`, mirroring T194 with `@Audited('beat-day.end', 'DailyAssignment')` and an `EndBeatDto`. Add no `DELETE` and no route that reopens a closed day — the state machine has no arrow back.
- [ ] T199 [US4] Add the inline end-confirmation to `TodaysBeatScreen.tsx` — **in the same card, never a separate screen** (FR-018). Per board 1.3: `#FCEFD9` on `1px #F0D2A0`, `borderRadius: 14`, a warning triangle in `#6B3904`, and copy stating the end time, how many stops are pending, naming them, and warning they will be recorded as not visited. Two buttons: "Keep going" (`1.5px #CBD2DD`, white, 600/15) and "End beat" (`#141A26`, white text, 700/15, stop glyph), both `height: 44`, `borderRadius: 11`, `flex: 1`. Keep going returns to running with nothing recorded. End beat captures location the same way starting did and calls `POST /assignments/:id/end` with a fresh idempotency key.

**Checkpoint**: A full day can be opened and closed.

---

## Phase 7: User Story 5 - See the day's summary once ended (Priority: P2)

**Goal**: The closed-day card shows when the beat ran and what it produced.

**Independent Test**: End a beat and confirm the dark card shows start → end, duration, a "Closed" tag and the four totals; confirm leaving and returning keeps it closed.

### Implementation for User Story 5

- [ ] T200 [US5] Render the ended state in `TodaysBeatScreen.tsx` per board 1.3: a `#141A26` card, `borderRadius: 18`, `padding: 16`, holding the plan name (13px `#C4CBD8`), "Beat ended" (20px/700), the monospace `09:04 → 18:12 · 9h 08m` line (12px `#C4CBD8`), a "Closed" chip (`#3A4353`), and the four-column Visited / Orders / No order / Not visited stats in the same type scale as the running card. Orders and No order read 0 until visit submission exists; Visited and Not visited come from the server's counts (research.md §8). Replace the running strip with the locked strip reading "Beat ended for today. Your list starts again tomorrow morning.", and make no row actionable (FR-020).

**Checkpoint**: All four board states are delivered.

---

## Phase 8: User Story 6 - Refresh the day (Priority: P3)

**Goal**: The header control and pull-to-refresh both re-fetch the day.

**Independent Test**: Change the day's data elsewhere, refresh, and confirm the screen updates without signing out.

### Implementation for User Story 6

- [ ] T201 [US6] Wire the header refresh button and add pull-to-refresh to the stop list in `TodaysBeatScreen.tsx`, both re-fetching `GET /assignments/today` and updating the card, counts and list. On failure **keep the already-loaded day on screen and say the refresh failed** — stale data must never be presented as fresh (FR-025), the established posture on every list screen in this app.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T202 [P] Run all 14 scenarios in `specs/005-executive-dashboard/quickstart.md` on a device or emulator after a **native rebuild** (`pnpm --filter mobile android`). Scenario 13 is the fidelity check: switch the decoded board 1.3 through its four states side by side with the running app and fix any visible gap (FR-024/SC-003) rather than filing it. Scenario 14 greps the API logs for the coordinates used and must find zero matches (T175). Scenarios 8, 9, 11 and 12 cover the snapshot rule, cross-executive isolation, the two no-beat states and company-timezone business dates.
- [ ] T203 [P] Regenerate `docs/openapi.json` to include the `assignments` module's three routes, mirroring how `004-brands-reasons-crud`'s T167 did it.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T173 and T175 are independent. T174 gates every mobile task that reads a position (T192 onward) and forces the native rebuild.
- **Foundational (Phase 2)**: T176 → T177 → T178 are strictly sequential (model, then DDL, then RLS). T179–T183 follow T176. T184–T186 are mobile-only and can proceed alongside the API work.
- **User Stories (Phases 3–8)**: all depend on Phase 2.
- **Polish (Phase 9)**: depends on every story you intend to ship.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. The MVP.
- **US2 (P1)**: service/controller work is independent of US1's, but T195 edits the screen US1 creates, so T190 lands first.
- **US3 (P1)**: needs the server `counts` from T188; its screen work follows T190.
- **US4 (P2)**: T197/T198 are independent; T199 edits the screen.
- **US5 (P2)**: T200 edits the screen; needs US4 to be reachable in practice.
- **US6 (P3)**: T201 edits the screen.

### Parallel Opportunities

- T173 and T175 (different files, no dependency).
- T181 and T182 are both in `packages/shared` but different files — T182 re-exports T181's symbols, so it must land second to typecheck.
- T184 and T185 are independent new mobile files and can run alongside T176–T183.
- T193/T194 (US2 API) can run alongside T190/T191 (US1 screen).
- T197/T198 (US4 API) can run alongside US3's screen work.
- T202 and T203.
- **The serialization point to respect**: T190, T191, T195, T196, T199, T200 and T201 all edit `TodaysBeatScreen.tsx` and must run sequentially in that order, whatever else is parallel.

---

## Parallel Example: Foundational

```bash
# API schema chain and the mobile shell are independent — run together:
Task: "Add enums + models to apps/api/prisma/schema.prisma"          # T176
Task: "Create executiveDesign.ts in apps/mobile/src/features/executive/"  # T184
Task: "Create ExecutiveBottomNav.tsx in apps/mobile/src/components/"      # T185
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Phase 1 Setup (T173–T175) — note T174 forces the native rebuild
2. Phase 2 Foundational (T176–T186) — **blocks everything**
3. Phase 3 US1 (T187–T191) → **validate**: quickstart Scenarios 1, 2, 3, 11
4. Phase 4 US2 (T192–T195) → **validate**: Scenarios 4, 5
5. Phase 5 US3 (T196) → **validate**: Scenario 6
6. **Stop and demo** — an executive can see and work their day

### Incremental Delivery

7. US4 (T197–T199) → Scenario 7 — the day can be closed
8. US5 (T200) → the closed-day summary
9. US6 (T201) → refresh
10. Polish (T202–T203) → full quickstart + OpenAPI

### Notes

- `[P]` tasks = different files, no dependencies.
- **A native rebuild is required from T174 onward** — unlike every prior slice, a Metro reload is not enough.
- Do not add: a scheduled job, an `AUTO_CLOSED` state, an offline queue for start/end, a client-side distance calculation, or `effectiveRadiusMeters` in any response. All five are explicit, reasoned exclusions (research.md §5/§9, plan.md Complexity Tracking) rather than oversights.
- Commit after each task or logical group; stop at any checkpoint to validate independently.
