---

description: "Task list for Monthly Salary Run"
---

# Tasks: Monthly Salary Run

**Input**: Design documents from `/specs/012-monthly-salary-run/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/salary.md, quickstart.md (all present)

**Tests**: Not included — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md`'s 11 scenarios are the verification path (Polish, T414). Scenarios **5** (reproducibility) and **7 step 6** (a finalised run does not move) are the two that cannot be skipped: they are the only checks that catch the two mistakes this slice is most likely to make.

**Organization**: Grouped by user story (spec.md: US1 and US2 are P1, US3 is P2, US4 is P3).

**Task IDs continue the repo-wide sequence from T371**, which is the highest ID currently carried by a GitHub issue — not T355, the highest in `specs/` on `main`. Slice `011` was tracked as issues under a spec directory that never landed here, so numbering from the specs tree alone would collide with live issues.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4
- File paths are exact and relative to the repo root.

## Path Conventions

- API: `apps/api/src/modules/salary/` (**new**), `apps/api/prisma/`
- Shared: `packages/shared/src/`
- Mobile: `apps/mobile/src/features/admin/`, `apps/mobile/src/navigation/`

## Board uuid (for the CLAUDE.md decode recipe)

| Board | uuid |
|---|---|
| 4.13 Monthly salary run | `1f09a706-a34a-4b97-af17-7242955c3743` |

The employee detail screen (US3) has **no board** — FR-047 permits designing it, on the user's explicit instruction. It is the only screen in the product without a reference, so it reuses `adminDesign.ts` tokens and 4.13's own card, chip and row shapes rather than inventing a style.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the dependency, the contract and the error codes — everything the modules below import.

- [ ] T372 Add `pdfkit` to `apps/api/package.json` dependencies and `@types/pdfkit` to devDependencies (`pnpm --filter api add pdfkit && pnpm --filter api add -D @types/pdfkit`). **Pure JS, no native code and no headless browser** — research.md §5 justifies it against both rejected alternatives (a device-side renderer costing an Android rebuild *and* a second source of truth for a financial document; Puppeteer costing ~300 MB of Chromium for one page). This is the first dependency added for a *document* rather than a platform capability, so record the reasoning in the commit, not just the lockfile.
- [ ] T373 [P] Add three error codes to `packages/shared/src/errors.ts` in the established three places (`ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`), with a comment naming this slice: `SALARY_PERIOD_NOT_COMPLETE` → `409` → `'Salary period is not complete'`; `SALARY_NO_ATTENDANCE` → `409` → `'No attendance recorded for this period'`; `SALARY_RUN_ALREADY_FINALISED` → `409` → `'Salary run already finalised'`. All 409, following the existing state-machine refusals (`ORDER_ALREADY_DELIVERED`, `BEAT_DAY_ENDED`, `SHOP_ALREADY_IN_BEAT`). Reuse `NOT_FOUND`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_REUSED` and `INVALID_CREDENTIALS` unchanged. The file is additive-only.
- [ ] T374 [P] Create `packages/shared/src/salary.schema.ts` with the three schemas exactly as `contracts/salary.md` specifies: `salaryRunQuerySchema` (`year` optional int 2000–2100, `month` optional int 1–12, `version` optional int ≥1, `.strict()`); `generateSalaryRunSchema` (`year` **required** int 2000–2100, `month` **required** int 1–12, `.strict()`); `finaliseSalaryRunSchema` = `z.object({}).strict()`. **The header comment must record what is absent and why**: `grossTotal`, `payableUnits`, `rate`, `amount`, `version` on generate, `finalisedBy` and `finalisedAt` are all server-computed and all missing from these schemas, so a client sending one gets a `400` rather than a silent strip (Constitution rule 1, FR-020). Note also that omitting `year`/`month` on the query means "the previous month, as the server reckons it" — the client never names the default.
- [ ] T375 Add an explicit re-export block for `salary.schema.ts` to `packages/shared/src/index.ts` — value exports then `export type`, no `export *`, matching the blocks already at the end of that file. Depends on T374.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story can begin until this phase is complete — every story reads or writes these tables.

- [ ] T376 Add to `apps/api/prisma/schema.prisma` exactly as `data-model.md` specifies, taking every field from `03-ARCHITECTURE.md:690-717`. **New enum** `SalaryRunStatus { DRAFT FINALISED }` — two values, both with a writer in this slice; add no third speculatively, the discipline that kept `ReviewStatus` from growing in `010`. **New model `SalaryRun`**: `id`, `companyId`, `periodYear Int`, `periodMonth Int`, `version Int @default(1)`, `status SalaryRunStatus @default(DRAFT)`, `grossTotal Decimal @db.Decimal(14,2)`, `generatedBy String`, `generatedAt DateTime @default(now())`, `finalisedBy String?`, `finalisedAt DateTime?`, `lines SalaryRunLine[]`, plus `@@unique([companyId, periodYear, periodMonth, version])` and `@@index([companyId, periodYear, periodMonth])`. **Including `version` in the unique key is the versioning guarantee** — it makes a second writer unable to reuse a version, so two admins regenerating at once produce one winner and one `P2002` rather than a silent overwrite, exactly as `Attendance`'s key did in `010`. **New model `SalaryRunLine`**: `id`, `companyId`, `salaryRunId` with `onDelete: Cascade`, `userId`, `payableUnits Decimal @db.Decimal(6,2)`, `amount Decimal @db.Decimal(12,2)`, `breakdown Json`, plus `@@unique([salaryRunId, userId])` and `@@index([companyId, userId])`. **The period is addressed as two ints, not a date range** — no boundary ambiguity and no timezone in the key. **Money is `Decimal`, not integer minor units**: `docs/coding_standard.md` says otherwise but is written against a different project, and this repo's own schema already uses `Decimal(12,2)` for `halfDayRate` (research.md §9).
- [ ] T377 Write the DDL migration `apps/api/prisma/migrations/<ts>_salary_runs/migration.sql` by hand in Prisma's generated style — `migrate dev` cannot run here (the role lacks CREATEDB, P3014); see `20261019140000_assignments/migration.sql` for the precedent and its header. Include `CREATE TYPE "SalaryRunStatus"`, both tables with every column and index, and the FK from `salary_run_lines.salary_run_id` with `ON DELETE CASCADE`. **State in the header that there is deliberately no backfill**: nothing predating this slice has a salary run, and inventing one for a past month would fabricate a financial record. Apply with `DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy`. Depends on T376.
- [ ] T378 Write the sibling RLS migration `apps/api/prisma/migrations/<later-ts>_rls_salary_runs/migration.sql`, copying `20261019170018_rls_visits/migration.sql`: `ENABLE` and `FORCE ROW LEVEL SECURITY` on both `"salary_runs"` and `"salary_run_lines"`, each with its own `*_tenant_isolation` policy whose `USING` and `WITH CHECK` are both `"company_id" = NULLIF(current_setting('app.company_id', true), '')`. Keep the fail-closed rationale comment. Timestamp must sort after T377. Depends on T377.
- [ ] T379 Register `'SalaryRun'` and `'SalaryRunLine'` in `TENANT_MODELS` in `apps/api/src/infra/prisma/tenant.extension.ts`, with a comment naming this slice and its RLS migration, matching the existing blocks. This Set is the only Layer-1 guard and **a new tenant table missing either layer must fail CI** (Constitution rule 2). Depends on T378.
- [ ] T380 [P] Create the module skeleton `apps/api/src/modules/salary/salary.module.ts` and `salary.controller.ts`, and register the module in `apps/api/src/app.module.ts`. The controller declares **`@UseGuards(RolesGuard)` with `@Roles('COMPANY_ADMIN')` on each method, never at class level** — the trap `011` documented on `shops.controller.ts`, where a class-level gate had to be split later. The four permissions (`salary-runs:create|read|update|finalise:company`) are **already seeded** on `COMPANY_ADMIN` (`roles.seed.ts:78-81`), so there is no permission work.
- [ ] T381 [P] Add the previous-month helper to `apps/api/src/infra/time/company-clock.service.ts` — the previous calendar month as `{year, month}`, composed from the existing `businessDate`, `startOfMonth` and `shiftDays`. **The arithmetic goes HERE and nowhere else** (Constitution rule 8): a salary service resolving its own month boundaries would be the second place that knows what a month is, which is what `startOfWeek`'s own comment already argues against. Also expose a "is this period complete" check for T387's refusal.

**Checkpoint**: tables exist with both isolation layers, the module is routable, and the clock can name the previous month. No behaviour is visible yet.

---

## Phase 3: User Story 1 - Open the salary run for last month (Priority: P1) 🎯 MVP

**Goal**: the Salary tile opens board 4.13 showing last month's figures, correct to the rupee.

**Independent Test**: with a month of attendance including a mid-month rate change, open Salary and confirm every employee's amount reconciles by hand to their attendance records and the rates effective on each date.

- [ ] T382 [US1] Create `apps/api/src/modules/salary/salary-run.service.ts` with the class scaffolding every service in this repo uses — module-level fallback client, narrowed `Tx` type, `tx()`, and `scopeToCaller()` setting both `app.company_id` and CLS (follow `attendance.service.ts`, which is the closest analogue). No business logic yet; this task exists so T383–T386 can be written against a settled shape.
- [ ] T383 [US1] Implement the month's attendance read in `salary-run.service.ts`: all `Attendance` rows for the company whose `businessDate` falls in the period, **filtered to `isActive: true`**. **The `isActive` filter is load-bearing, not hygiene**: attendance amendments are append-only — a new version plus a flip of the previous row's flag (`attendance.service.ts:196` onwards) — so omitting it double-counts every amended session. **This result set also defines the roster** (research.md §6): a person with no rows in the month is not on the run, which is how FR-023's mid-month joiners and leavers fall out without a membership rule the data model has no column for. If the set is empty, the caller raises `SALARY_NO_ATTENDANCE` (T387).
- [ ] T384 [US1] Implement unit aggregation in `salary-run.service.ts`: per user, **sum `Attendance.payableUnits`** over the month. **SUM THE STORED COLUMN — DO NOT RE-DERIVE UNITS FROM `status`.** Both give the same answer today and diverge the moment a company edits `payableUnitByStatus`, at which point re-deriving silently re-prices every past month. The stored column was computed and frozen when the manager saved the day sheet (`attendance.service.ts:268`), and it is the only thing that keeps a closed month reproducible. **This is the single easiest mistake in the slice**; quickstart Scenario 5 step 5 exists solely to catch it. Holiday and Weekly Off therefore pay (their stored units are 1) and Absent and Leave do not (theirs are 0) without this code naming a status at all — FR-014 through FR-016 are satisfied by arithmetic, not by a mapping re-implemented here.
- [ ] T385 [US1] Implement the rate-range split in `salary-run.service.ts`: load each user's `UserSalaryRate` rows and intersect the month with each row's `[effectiveFrom, effectiveTo ?? ∞]`. **No conflict rule is needed and none may be invented** — `users.service.ts:375-411` maintains the chain closed and non-overlapping (adding a rate sets the previous row's `effectiveTo = newEffectiveFrom − 1 day`), so every date falls in exactly one range or in none. Per range emit `{from, to, units, rate, amount}` with `amount = units × rate` in `Prisma.Decimal` — **never JavaScript floats**, which SC-004 and SC-005 cannot tolerate. Dates in **no** range emit a sub-line with `rate: null` and `amount: 0` **carrying their units**, so unrated work is visible rather than silently priced at zero (FR-021). A range covering zero attended dates emits nothing.
- [ ] T386 [US1] Implement `generate()` in `salary-run.service.ts`, in one transaction, in the order `contracts/salary.md` specifies: refuse an incomplete period (T381's check) → read attendance (T383) → aggregate units (T384) → split by rate (T385) → `amount` per line → `grossTotal` = Σ line amounts → resolve the target version (**no run** → `version: 1`; **a `DRAFT`** → replace it and its lines, version unchanged; **a `FINALISED`** → `version + 1` as a new `DRAFT`) → write the run and all its lines **together**, so a run whose lines are missing is unrepresentable. Catch `P2002` on `(companyId, periodYear, periodMonth, version)` → re-read and return the winner, the pattern `assignments.service.ts` established for a concurrent create. **Only finalisation creates a version boundary** — this is the distinction FR-030 turns on and the easiest to get wrong: versions mark *locked* states, not generation attempts.
- [ ] T387 [US1] Add `POST /salary-runs` to `salary.controller.ts` with a `GenerateSalaryRunDto extends createZodDto(generateSalaryRunSchema)` declared locally, `@Roles('COMPANY_ADMIN')`, `@UseGuards(RequireIdempotencyKeyGuard)` and `@Audited('salary-run.generated', 'SalaryRun')`. Map the two refusals: an incomplete or future period → `409 SALARY_PERIOD_NOT_COMPLETE` (FR-031); no attendance in the period → `409 SALARY_NO_ATTENDANCE`, **not a run with a zero total**, because a zero total reads as a computed answer (FR-007's edge case). Returns `201` with the same shape as the read below. Depends on T386.
- [ ] T388 [US1] Implement `getRun()` in `salary-run.service.ts` and add `GET /salary-runs` to the controller with a `SalaryRunQueryDto extends createZodDto(salaryRunQuerySchema)`. **Omitted `year`/`month` means the previous month**, resolved by `CompanyClock` (T381) — the only arrangement in which the server stays the single authority on what "last month" is. Return `run: null` when the month has never been generated: a **distinct state** from a generated run that totals zero, which the screen renders differently. **`grossTotal` comes from the stored header, never summed from the lines on read** — independent storage is what makes SC-004 a real check rather than a tautology. **Serialise every money value as a decimal string, not a number**: `19700.00` through `JSON.parse` becomes a float, and a float is exactly what SC-005 forbids.
- [ ] T389 [US1] Create `apps/mobile/src/features/admin/SalaryRunScreen.tsx` matching board 4.13 exactly (uuid `1f09a706-a34a-4b97-af17-7242955c3743` — decode it, do not grep). The decoded structure: a back link to AdminHome; a `#5A6474` 13px subtitle above a 22px/700 period title; a status chip on `#EFE9FB` with `#5B2FA6` text reading `Draft · v2`; a dark `#141A26` summary card, radius 18, padding 16, holding a `#C4CBD8` 13px label (`Gross attendance salary · N employees`), a 34px/700 total and a mono 12px `#C4CBD8` formula line reading `salary = payable half-days × half-day rate`; a `By employee` section as a white card with `1px solid #DFE4EC`, radius 16, rows separated by `1px solid #ECEFF4`, each row a baseline-aligned name (15px/700) and mono total (15px/700) with mono 12px `#3A4353` sub-lines beneath; an amber `#FCEFD9`/`#6B3904` notice, radius 14, carrying the lock sentence; and the two buttons. **No bottom bar** — it is a pushed screen. Render the amounts from the decimal strings and **compute nothing on the device**. Handle the three empty states distinctly: never generated, generated-but-no-attendance, and offline-with-stale-data.
- [ ] T390 [US1] Render board 4.13's **CSV** button exactly as designed and wire it to the established `comingSoon('CSV export')` alert. **This is the resolution of the one known fidelity tension** (research.md §8): the board shows the button, the spec puts CSV export out of scope with the export slice that carries its audit requirement, and omitting it would diverge from the board while wiring it would pull scope. The "coming in a later update" alert is this repository's own convention for a designed-but-unbuilt affordance — slices `002`, `003` and `011` each retired one — and it leaves a single call site for the export slice to replace. Add a comment saying exactly that, so it is not read as an oversight.
- [ ] T391 [US1] Make the screen reachable: add `SalaryRun: undefined` to `AdminStackParamList` and register it in `AdminNavigator` with `headerShown: false` in `apps/mobile/src/navigation/RootNavigator.tsx`, and change the Salary tile in `apps/mobile/src/features/admin/HomeScreen.tsx:436` from `comingSoon('Salary')` to a navigation call — the same one-line retirement `011` did for Visits. Update that file's header comment, which still lists salary among the tiles that are "not" built.

**Checkpoint**: US1 is independently usable — the run opens, the figures are right, and nothing can be locked yet.

---

## Phase 4: User Story 2 - Finalise the month and lock it (Priority: P1)

**Goal**: the month can be locked, and a later correction produces a new version rather than moving the locked figures.

**Independent Test**: finalise a month, note the figures, amend an attendance record inside it, and confirm the finalised figures are byte-identical and a new version is offered.

- [ ] T392 [US2] Implement the unmarked-session count in `salary-run.service.ts` and include it in `GET /salary-runs` as `unmarkedSessionCount`. Definition (research.md §7): **per person, count sessions missing against the days that person already has any attendance row for** — a morning row on the 5th with no evening row is one unmarked session. **Computed per request and deliberately not stored**, because it describes attendance *now*: an admin who fills a gap and reopens the screen must see it fall, and a stored warning would outlive the problem. **Record in a comment what this cannot catch**: a day sheet never opened at all, because nothing in the data distinguishes "the manager forgot" from "this person was not on staff that day". Catching that needs a company working-calendar, which the product does not have and this slice does not add.
- [ ] T393 [US2] Implement `finalise()` in `salary-run.service.ts`: load the run tenant-scoped (unknown → `404`); already `FINALISED` → `409 SALARY_RUN_ALREADY_FINALISED`; otherwise set `status: 'FINALISED'`, `finalisedAt` to the **server's** clock and `finalisedBy` to the **verified JWT's** user. **Touch no `SalaryRunLine` and no `Attendance` row** — the lines were already final when written, so finalising changes only the header's status (data-model.md's invariant). **Locking the salary must not lock attendance** (FR-032): amendments stay possible, which is the whole point of the append-only attendance design, and a correction surfaces as a new version instead.
- [ ] T394 [US2] Add `POST /salary-runs/:id/finalise` to `salary.controller.ts` with a `FinaliseSalaryRunDto extends createZodDto(finaliseSalaryRunSchema)`, `@Roles('COMPANY_ADMIN')`, `@UseGuards(RequireIdempotencyKeyGuard)` and `@Audited('salary-run.finalised', 'SalaryRun')`. The body is `z.object({}).strict()` — **empty on purpose**, because who finalised it is the JWT's and when is the server's clock, so a body carrying `finalisedBy` or `finalisedAt` must be a `400` rather than a silent strip. The `409` is a **refusal, not defensiveness**: reporting success would tell this admin they locked something another admin actually locked, and would overwrite the attribution FR-027 exists to record. It is also what arbitrates two admins racing (FR-029). Depends on T393.
- [ ] T395 [US2] Wire board 4.13's **Finalize {Month}…** button in `SalaryRunScreen.tsx`. The ellipsis in the board's own label is the confirmation FR-026 requires: a confirm step that **states what will be locked** and changes nothing if cancelled. Mint the `Idempotency-Key` on the device, as every other command in this app does. On `409 SALARY_RUN_ALREADY_FINALISED`, report it in plain language rather than as an unexplained failure.
- [ ] T396 [US2] Show the **unmarked-session count in the confirmation** before the admin can confirm (FR-025). This is the warning's entire purpose: finalising over a forgotten day costs the employee money silently, and the confirm step is the last moment anyone would notice. Word it so it does not read as a blocker — it is information, and finalising with unmarked sessions is allowed.
- [ ] T397 [US2] Render the finalised state on `SalaryRunScreen.tsx`: the chip reads `Finalised · vN`, finalising is unavailable, and the amber notice's wording reflects that the month is already locked. Board 4.13's notice text (`Finalizing locks August. Later attendance corrections create a new version (v3); v2 stays on record.`) is written for the **draft** state; the finalised wording is new copy in the same register, and the board carries no finalised variant to match against.
- [ ] T398 [US2] Add regeneration to the screen: when a finalised run exists, offer generating the next version, and make the version boundary visible in the UI (`Draft · v2` following `Finalised · v1`). **Regenerating a draft replaces it and consumes no version**; only finalisation creates a boundary (FR-030). The two actions look alike to a user and must not be conflated in the copy.

**Checkpoint**: US1 and US2 together are the whole month-end loop — open, review, lock, and correct by versioning.

---

## Phase 5: User Story 3 - See one employee's month in detail (Priority: P2)

**Goal**: an admin can explain any figure to the employee who disputes it.

**Independent Test**: open an employee with absences, a leave, a holiday, a late arrival and a mid-month rate change, and confirm every line reconciles to their attendance day sheet and the stated total equals the run's row.

- [ ] T399 [US3] Implement `getLine()` in `salary-run.service.ts` returning the shape `contracts/salary.md`'s `GET /salary-runs/:id/lines/:userId` specifies. **Two halves with different freshness, and the response must not reconcile them**: the **frozen** half (`payableUnits`, `amount`, `breakdown`) comes straight from the stored `SalaryRunLine`; the **live** half (`unpaidSessions`, `paidNonWorking`, `lateSessions`, `unmarkedSessions`) is read from `Attendance` now. After a finalised month is amended the two legitimately disagree — that is the state FR-030 exists for — so return `run.status` and `run.version` alongside, and let the screen say *which* run is being read. 404 when the user has no line in this run.
- [ ] T400 [US3] Add `GET /salary-runs/:id/lines/:userId` to `salary.controller.ts`, `@Roles('COMPANY_ADMIN')`. A read: no `Idempotency-Key`, no `@Audited`. Depends on T399.
- [ ] T401 [US3] Create `apps/mobile/src/features/admin/SalaryEmployeeDetailScreen.tsx`. **This screen has no board** (FR-047) — the user explicitly permitted designing it, and it is the only screen in the product without a reference. Build it from `adminDesign.ts` tokens and board 4.13's own shapes — the same dark summary card for the total, the same white card with `#ECEFF4` separators for each section, the same mono treatment for figures — so it reads as the same app. **Do not invent a new visual language**, and do not approximate 4.13's values from memory: decode the board and reuse its exact hexes, radii and weights.
- [ ] T402 [US3] Render the explanation sections on the detail screen: **unpaid sessions** with date, session and causing status (FR-034); **paid non-working days** shown explicitly as paid, so a holiday is visibly accounted for rather than looking like a gap (FR-035); the **rate ranges** with units, rate and amount, summing to the total (FR-037); and **unmarked sessions** listed as contributing nothing, never invisible (FR-038). Show the run's status and version so a frozen total sitting beside amended attendance is legible rather than confusing.
- [ ] T403 [US3] Render **late arrivals** with date, session and how late, **and an explicit statement that lateness does not reduce pay** (FR-036, FR-018). The statement is not decoration: `BUS-18` and `OD-01` both say lateness is a warning, the whole feature was described to the user that way, and this is the one screen where an admin might otherwise infer a deduction from seeing the flag at all. Cross-check against `CompanySettings.morningSessionStart`/`eveningSessionStart` — **and note in the task's verification that the pilot's configured 09:00/14:00 do not match the 10:00/15:30 the feature was described with**, so the flags will look wrong until that setting is corrected. No salary figure depends on it.
- [ ] T404 [US3] Make the detail reachable: add `SalaryEmployeeDetail: { runId: string; userId: string }` to `AdminStackParamList`, register it in `AdminNavigator` with `headerShown: false`, and make each employee row on `SalaryRunScreen.tsx` navigate to it. The detail only ever calls `goBack()`. **Offer no control that edits anything** (FR-039) — it is a read-only explanation, and the absence of an edit affordance is the requirement.

**Checkpoint**: every figure on the run can now be explained from inside the app.

---

## Phase 6: User Story 4 - Export a payslip (Priority: P3)

**Goal**: the admin can hand an employee — who has no login — a PDF of their month.

**Independent Test**: export a payslip for an employee with a mixed month, confirm every figure matches the detail screen, and confirm a second export produces an identical document.

- [ ] T405 [US4] Create `apps/api/src/modules/salary/payslip.service.ts` holding **the only `pdfkit` import in the codebase**. Render from the **stored `SalaryRunLine`**, never from live attendance or rates — so the same request a month later yields the same document, which is what makes a payslip a record rather than a snapshot of today. Keeping the import behind this one service is deliberate: the document format will change independently of the money, and the calculation must have no opinion about PDFs.
- [ ] T406 [US4] Implement the payslip document in `payslip.service.ts` carrying **exactly what the detail screen shows and no figure that is not visible there** (FR-041): employee, period, payable units, the rate ranges with their amounts, the unpaid sessions, and the total. State the **version** and whether the run is **Draft** or **Finalised**, and mark a draft payslip unmistakably — a draft handed to an employee must not read as a final statement of pay (FR-042).
- [ ] T407 [US4] Add `GET /salary-runs/:id/payslip/:userId.pdf?token=` to `salary.controller.ts`, modelled on `files.controller.ts:78`: `@Public()` on the method, authenticated by its **own signed HMAC `?token=`** rather than a bearer header, streaming `Content-Type: application/pdf`. **The signed URL is what keeps the mobile app free of a native rebuild** — the device hands the URL to Android's own browser via `Linking`, and a browser carries no `Authorization` header (research.md §5). **Never log the URL whole**: the token is in the query string and tokens are on the redaction list (Constitution rule 9). The token is minted by T399's authenticated detail call, is short-lived, and is scoped to one run and one user. Producing a payslip must alter nothing (FR-043).
- [ ] T408 [US4] Add the export action to `SalaryEmployeeDetailScreen.tsx`, opening `payslipUrl` with React Native's **built-in `Linking`**. **Add no dependency**: `react-native-fs` and `react-native-share` are both avoidable here and both would mean another Android rebuild. Handle the failure plainly rather than silently.
- [ ] T409 [US4] Verify the payslip end to end on a physical device, as quickstart Scenario 8 step 5 describes. **In the dev build the browser reaches the API through `adb reverse tcp:3000`** — the same tunnel the app uses, and the thing to check first if the PDF does not open, before suspecting the code. Confirm a second export of the same employee produces an identical document.

**Checkpoint**: all four stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T410 [P] Regenerate `docs/openapi.json` (`pnpm --filter api generate:openapi`) so the five new routes and three new error codes are in the committed contract, as slice `010`'s and `011`'s polish phases each did.
- [ ] T411 [P] Run `pnpm lint` and `pnpm build` across the workspace. The new shared schema and its re-export touch import paths in files no task names, and the build is what finds them.
- [ ] T412 Verify the three isolation checks together, since they are cheap and a miss is silent: `'SalaryRun'` and `'SalaryRunLine'` are both in `TENANT_MODELS`; RLS is **enabled and forced** on both tables (`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('salary_runs','salary_run_lines')`); and a Manager's and an Executive's token each get `403` on every salary route.
- [ ] T413 Confirm `git diff` touches **no** file under `apps/api/src/modules/attendance/`, no rate logic in `users.service.ts`, and no executive-facing file. This slice reads attendance and writes none of it (FR-012, FR-032); if the diff says otherwise, the lock has grown into something its plan does not describe.
- [ ] T414 Run `quickstart.md` end to end on a physical device. **Scenarios 5 and 7 step 6 are the point of this phase** and must not be skipped: Scenario 5 changes `payableUnitByStatus` and regenerates, and the figures must not move (catching a re-derivation of units from `status`); Scenario 7 step 6 amends attendance inside a finalised month, and the figures must not move (catching lines recomputed on read). Everything else in the feature can be verified by looking at a screen once; these two cannot.

---

## Dependencies & Execution Order

```text
Phase 1 Setup (T372–T375)
  └─▶ Phase 2 Foundational (T376–T381)   ← BLOCKS every story; tables + isolation + clock
        ├─▶ Phase 3 US1 (T382–T391)      🎯 MVP — the run, the figures, the board
        │     └─▶ Phase 4 US2 (T392–T398)  finalise builds on the run it locks
        │           └─▶ Phase 5 US3 (T399–T404)  the detail explains a line US1 created
        │                 └─▶ Phase 6 US4 (T405–T409)  the payslip renders the line US3 shows
        └─────────────────────▶ Phase 7 Polish (T410–T414)
```

### Within Phase 2

T376 → T377 → T378 → T379 are strictly sequential (schema, DDL, RLS, registry). **T380 and T381 are `[P]`** — different files, no dependency on the migration chain.

### Story dependencies, and why they are not independent here

The template's ideal is stories that can be built in any order. **These cannot, and pretending otherwise would mislead whoever picks them up**: US2 locks a run that US1 must first be able to produce; US3 explains a line US1 writes; US4 renders what US3 displays. The chain is real.

What *is* true is that each story is an independently **shippable and verifiable** increment: US1 alone is a usable month-end read, US1+US2 is the whole payroll loop, and US3 and US4 add explanation and handoff without changing a figure.

### Parallel opportunities

- **T373 and T374** (errors, schema) — different files in `packages/shared`.
- **T380 and T381** (module skeleton, clock helper) — different files, neither blocked by the migration chain.
- **T410 and T411** (openapi, lint/build) — independent polish.
- Within US1, **T389's screen work can proceed against the contract** while T383–T386's service work lands, since the response shape is settled in `contracts/salary.md`.

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 → Phase 2 → Phase 3.
2. **Stop and validate**: run quickstart Scenarios 1–6. Scenario 5 is the one that matters — regenerate across a `payableUnitByStatus` change and confirm nothing moves.
3. At this point the admin can see last month's pay, correct to the rupee. Nothing can be locked, which is a safe place to pause.

### Incremental delivery

| Increment | Adds |
|---|---|
| US1 | the run and its figures (MVP) |
| + US2 | the lock, versioning and the unmarked-session warning — **the complete month-end loop** |
| + US3 | per-employee explanation |
| + US4 | the PDF handoff to someone with no login |

---

## Notes

- `[P]` = different files, no dependencies.
- Commit after each task or logical group.
- **The two mistakes this slice is most likely to make**, both silent, both caught only by quickstart: re-deriving units from `status` instead of summing the stored `payableUnits` (T384), and recomputing `breakdown` on read instead of storing it (T386). Each looks correct until the day a setting or a rate changes.
- No tests, per CLAUDE.md's standing policy. `quickstart.md` is the verification path.
