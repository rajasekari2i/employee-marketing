# Implementation Plan: Monthly Salary Run

**Branch**: `012-monthly-salary-run` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-monthly-salary-run/spec.md`

## Summary

Board 4.13, one designed screen with no board, four endpoints, two new tables and the product's first PDF. It closes the last "coming soon" tile on the Company Admin's home screen and completes the month-end loop the whole attendance domain exists to feed.

Three things carry the design weight.

**The calculation is mostly addition, because slice `010` already did the judging.** `Attendance.payableUnits` is derived and stored when the manager saves the day sheet, so this feature sums a number rather than re-deriving one from status. That is not a shortcut — re-deriving would mean a later change to `payableUnitByStatus` silently re-pricing a past month, which is precisely the drift SC-005 forbids. The rate side is equally settled: `users.service.ts` maintains `UserSalaryRate` as a contiguous, non-overlapping chain, so splitting a month at a rate change needs no conflict rule.

**Finalising freezes bytes, not a query.** `SalaryRunLine.breakdown` stores the computed `[{from,to,units,rate,amount}]` sub-lines. If a finalised payslip were recomputed on read, a back-dated rate correction would rewrite history — which BR-24, FR-028 and the dispute risk all exist to prevent. The stored breakdown is what makes a finalised run a *record*.

**The PDF is the only new capability, and it costs one server dependency and no native rebuild.** Generated server-side with `pdfkit`, streamed rather than stored, opened on the device through the built-in `Linking` — the device never renders a figure, and the app needs no new native module.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **One new server dependency: `pdfkit`** (pure JS, no native code, no headless browser). **No new mobile dependency and no native rebuild** — the payslip opens via React Native's built-in `Linking`.

**Storage**: PostgreSQL via Prisma. **Two migrations**: `SalaryRun` + `SalaryRunLine` + the `SalaryRunStatus` enum; then the sibling RLS migration for both new tenant tables. Every field is taken from `03-ARCHITECTURE.md:690-717`.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path, and for this feature it is unusually load-bearing: SC-005's reproducibility is an arithmetic check a human performs twice.

**Target Platform**: The same Android app and Node/NestJS API.

**Performance Goals**: a full month-end — open, review, finalise — under 10 minutes for a 20-person company (SC-014); one tap from home to last month's gross (SC-001).

**Constraints**: pixel-exact match to board 4.13; figures server-computed and never client-supplied; a finalised run's numbers never change; lines sum to the gross exactly; a month reproduces identically on repeat; no attendance record is ever written.

**Project Type**: Mobile + API (existing monorepo).

**Scale/Scope**: 2 new mobile screens + 1 tile retirement; 4 new API endpoints in 1 new module; 2 new models, 1 enum, 2 new RLS surfaces; ~3 new error codes; 1 new shared schema file.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template. The operative gates are CLAUDE.md's "Non-negotiable architectural rules", which are the ten rules `03-ARCHITECTURE.md:1147-1175` tells us to paste there — the basis slices `002`–`011` used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS, and it is the feature** | Units, rates, amounts, the gross total and the version are all server-computed and all **absent from their `.strict()` request schemas**. `POST /salary-runs` takes a period, not a figure; a body carrying `grossTotal` is a `400`. The client renders money it is given and computes none. |
| 2. Tenant isolation, two layers | **PASS** | `SalaryRun` and `SalaryRunLine` are the two new tenant tables and get both layers — `FORCE ROW LEVEL SECURITY` with their own policies, and registration in `TENANT_MODELS`. A new tenant table missing either must fail CI. |
| 3. Commands are idempotent | **PASS** | Both commands require an `Idempotency-Key`. Note the deliberate interaction with FR-030: a *retry* replays the stored response, a *deliberate* regeneration carries a fresh key and replaces the draft. |
| 4. History is append-only | **PASS, and it is the other half of the feature** | A finalised run is never updated. A later correction produces `version + 1` with the earlier version intact, enforced by `@@unique([companyId, periodYear, periodMonth, version])`. No attendance row is written by anything here. |
| 5. One contract | **PASS** | One new `salary.schema.ts` in `packages/shared`, wrapped with `createZodDto` in the controller. |
| 6. Role visibility is explicit and structural | **PASS** | Company-Admin-only, per-method rather than class-level. The executive-visibility rule is not engaged: no salary screen shows a distance, a range verdict or a flag, and no executive route is touched. |
| 7. The field app assumes a bad network | **PASS** | Three of the four routes are reads and fall back to the last loaded payload with a visible note. Generate and finalise are month-end desk actions, reported rather than queued — the posture `010` established for the manager's commands. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | "Previous month", the month's boundaries and the refusal of an incomplete month all come from `CompanyClock`. No service here does its own date arithmetic. |
| 9. No secret/token/precise coordinate in logs | **PASS with a note** | No coordinates anywhere in this feature. The payslip URL carries a **signed token** in its query string — already on the redaction list, and the reason the URL must never be logged as a whole. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS** | All three, and the first migration since `010`. |

**No violations — Complexity Tracking is not needed.**

### Four things this check deliberately does not wave through

- **Rule 1, and the temptation to recompute on read.** The lazy design is to store only the run header and derive the lines whenever the screen opens. It would be less schema and it would be wrong: a back-dated rate edit would then rewrite a *finalised* payslip, and the admin would have no way to know the number they paid against had moved. `breakdown` is stored for exactly this, and `data-model.md` states it as an invariant rather than a field description.

- **Rule 1 again, applied to the units.** `payableUnits` must be **summed, not re-derived from `status`**. Both produce the same answer today; they diverge the moment a company edits `payableUnitByStatus`, and only the stored column keeps a past month reproducible. This is the single easiest mistake to make in the implementation and the one SC-005 exists to catch.

- **Rule 4, and what "lock" means.** The user asked to lock the month. It would be easy to read that as freezing *attendance* too. It does not: amendments stay possible — the whole append-only attendance design exists so corrections remain available — and the correction surfaces as a new run version. Locking the salary figure while leaving the source amendable is the only arrangement in which both BR-24 and the amendment history hold at once. FR-032 says so explicitly so nobody "completes" the lock later by freezing attendance.

- **Rule 10, and a new dependency.** `pdfkit` is the first dependency added for a document rather than a platform capability. It is justified in `research.md` §5 against both alternatives (a device renderer costing a native rebuild and a second source of truth; Puppeteer costing ~300 MB for one page). Flagged here because "add a library" is the step that should attract scrutiny, not pass silently.

**Post-Phase-1 re-check**: [data-model.md](./data-model.md) and [contracts/salary.md](./contracts/salary.md) confirm the above in detail. Five guarantees are concrete rather than asserted: `@@unique([companyId, periodYear, periodMonth, version])` makes two live versions of one month unrepresentable; `.strict()` on both request schemas makes a client-supplied figure a `400`; `breakdown` is written once and never updated, so a finalised line cannot move; `409 SALARY_RUN_ALREADY_FINALISED` makes a double-finalise a refusal rather than an overwrite; and the payslip route derives from the stored line, so two requests a month apart produce the same document. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/012-monthly-salary-run/
├── plan.md                        # This file
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output
├── contracts/
│   └── salary.md                  # Phase 1 output
├── checklists/
│   └── requirements.md            # /speckit-specify output
└── tasks.md                       # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── package.json                            # + pdfkit
├── prisma/
│   ├── schema.prisma                       # + SalaryRun, SalaryRunLine, SalaryRunStatus
│   └── migrations/<ts>_salary_runs/
│       └── migration.sql                   # NEW — enum, two tables, indexes
│   └── migrations/<later-ts>_rls_salary_runs/
│       └── migration.sql                   # NEW — both new tenant tables
└── src/
    ├── infra/prisma/tenant.extension.ts    # + 'SalaryRun', 'SalaryRunLine'
    └── modules/salary/                     # NEW MODULE
        ├── salary.module.ts
        ├── salary.controller.ts            # 4 routes, @Roles per method
        ├── salary-run.service.ts           # the calculation, generate + finalise
        └── payslip.service.ts              # pdfkit rendering, reads the stored line

packages/shared/src/
├── salary.schema.ts                        # NEW
├── errors.ts                               # + 3 codes
└── index.ts                                # + re-export block

apps/mobile/src/
├── features/admin/
│   ├── HomeScreen.tsx                      # Salary tile → navigate, not comingSoon
│   ├── SalaryRunScreen.tsx                 # NEW — board 4.13
│   └── SalaryEmployeeDetailScreen.tsx      # NEW — no board (FR-047)
└── navigation/RootNavigator.tsx            # + SalaryRun, SalaryEmployeeDetail
```

**Structure Decision**: a new `salary` module. Salary is its own aggregate with its own versioning and lock rules, exactly as `attendance` was in `010` — it is not a report over existing data, because it *writes* records that must outlive the data they were computed from. The two services split along the same seam: `salary-run.service.ts` owns the arithmetic and the state machine, `payslip.service.ts` owns rendering and holds the only `pdfkit` import, so the document format can change without touching the calculation.

The mobile screens join `features/admin/` rather than a new folder — they are admin screens, reached from the admin stack, styled from `adminDesign.ts`.

## Complexity Tracking

*Not needed — no Constitution violations to justify.*

Two things are worth stating anyway, because both look like complexity and are not.

**The stored `breakdown` is not denormalisation for speed.** It is the freeze. The sub-lines name a rate as it was on a date; recomputing them would make a finalised payslip a function of present-day master data. The duplication is the point.

**Two services rather than one** is not premature layering. `pdfkit` is a document concern that will change independently of the money, and keeping its only import behind `payslip.service.ts` means the calculation has no opinion about PDFs — which is also what lets the payslip be re-rendered from a frozen line years later without re-entering the calculation path at all.
