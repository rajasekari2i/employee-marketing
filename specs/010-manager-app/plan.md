# Implementation Plan: The Manager App

**Branch**: `010-manager-app` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-manager-app/spec.md`

## Summary

The Manager's entire app — eight boards (3.1–3.8), six endpoints, one new Prisma model, and the first manager screen that has ever existed. Managers currently sign in and are told their screens are coming later.

**This is four to eight times the size of any previous slice**, and spans what `03-ARCHITECTURE.md`'s own plan splits across three (`010-extra-shops`, `011-attendance`, `012-manager-review`). The five user stories are independently deliverable so it can be built — and if wanted, split — along those lines. **US4 (attendance) is the natural cut**: it is the only story needing a migration of its own, and nothing before it depends on it.

Three things carry the design weight.

**This feature inverts the product's most load-bearing rule.** Five slices have worked to ensure an executive is never shown a measured distance, a range verdict or a quality flag. This one exists to show a manager precisely those — board 3.3's distance column, its "· out" marker and its Out-of-range tab have no other source. The inversion is safe only if both halves are structural: the manager's projection is a **separate service** from the executive's, not a widened one, and the quickstart re-asserts the executive's exact key set in the same run that proves the manager's includes the measurement.

**"Out of range" is a filter, not an outcome.** Decoding board 3.3 shows `out` as a boolean beside `kind`, and the detail route chosen by the *tab the manager came from* rather than by what the visit is. So the same out-of-range order shows board 3.6 from one tab and board 3.4 — with Mark as delivered — from another. The server cannot know which; `GET /visits/:id` returns what all three detail screens need and the client picks.

**Attendance is a new domain with an append-only history.** An amendment is an insert plus a flip, never an update, with `version` in the unique key so two managers cannot both win. Lateness and payable units are **derived by the server** from settings slice 001 added with no consumer — the same discipline that keeps `distanceMeters` out of a visit submission, applied to a new kind of judgement.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7, `react-native-maps` (mobile). **No new dependency and no native rebuild** — `react-native-maps` has been linked since slice 006.

**Storage**: PostgreSQL via Prisma. **One migration**: the `Attendance` model with append-only versioning, three new enums, RLS + `TENANT_MODELS`; `AssignmentStop.addReason`; `Order.deliveredAt` / `deliveredBy`. Each of the three columns was omitted by an earlier slice **on the record**, naming this one.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API.

**Performance Goals**: a full morning review in under 10 minutes (SC-001); a day's attendance in under 5 minutes (SC-002).

**Constraints**: pixel-exact match to boards 3.1–3.8; a manager sees the measurement and an executive still never does; attendance is never overwritten; lateness and payable units are never accepted from a client; the beat plan is never written.

**Scale/Scope**: 8 new mobile screens + a new stack and bottom bar; 6 new API endpoints across 1 new module and 3 existing; 1 new Prisma model, 3 enums, 3 columns, 1 new RLS surface; 3 new error codes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template. The operative gates are CLAUDE.md's "Non-negotiable architectural rules", which are the ten rules `03-ARCHITECTURE.md:1147-1175` tells us to paste there — the basis slices 002–009 used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | `latenessFlag`, `payableUnits`, `version`, `deliveredAt` and `deliveredBy` are all server-derived and all **absent from their `.strict()` request schemas**, so a client sending one gets a `400` rather than a silent strip. The manager reads the measurement; nothing here lets anyone write one. |
| 2. Tenant isolation, two layers | **PASS** | `Attendance` is the **one new tenant table** and gets both layers — `FORCE ROW LEVEL SECURITY` with its own policy, and registration in `TENANT_MODELS`. Everything else reads tables already covered. |
| 3. Commands are idempotent | **PASS** | Both new commands — `POST /attendance` and `POST /orders/:id/deliver` — require an `Idempotency-Key`. `POST /assignments/:id/stops/manager` inherits the executive route's. |
| 4. History is append-only | **PASS, and it is the feature** | An attendance amendment is an insert at `version + 1` plus a flip of the previous row's `isActive`, in one transaction — never an update. `@@unique([…, version])` makes a lost update unrepresentable. Delivery is one-way with no un-deliver route. No visit is ever modified. |
| 5. One contract | **PASS** | `manager-visits.schema.ts`, `attendance.schema.ts` and an extended `reports.schema.ts`, wrapped via `createZodDto` in their controllers. |
| 6. Role visibility is explicit and structural | **PASS — and this is the whole feature** | See the note below. The manager's projection is a separate service from the executive's; neither can acquire the other's fields by a refactor of one. |
| 7. The field app assumes a bad network | **PASS** | The six reads fall back to the last loaded payload with a visible note. The two commands are the manager's, made at a desk rather than in a shop — they are reported rather than queued, which is what FR-052 asks for. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | Business dates, "today", the future-date refusal and the session start times lateness is measured against all come from `CompanyClock` and `CompanySettings`. |
| 9. No secret/token/precise coordinate in logs | **PASS with a note** | `GET /visits/:id` returns coordinates in a **response body**, which is correct — the map needs them and `latitude`/`longitude` are already on the deep redaction list for logs. No coordinate is in any request. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS** | All three, and the largest instance of it so far. |

**No violations — Complexity Tracking is not needed.**

### Three things this check deliberately does not wave through

- **Rule 6, inverted.** Every prior slice applied this rule in one direction: keep the measurement away from the executive. This feature is the first to require the opposite, and the risk is that "the manager needs to see it" becomes a reason to relax the other half. FR-046 and FR-047 state both, and the design keeps them apart **structurally**: `manager-visits.service.ts` and `my-visits.service.ts` are separate files producing separate shapes, and slice 008's quickstart assertion on the executive's exact key set is re-run here (Scenario 10). A shared shape with a role-conditional projection would put the rule inside an `if`, in the one service where both roles meet.

- **Rule 1, and a judgement that looks like an observation.** `latenessFlag` is tempting to accept from the client — the device knows the arrival time, so why not the flag? Because lateness is not an observation, it is the company's settings applied to one: the same reason `distanceMeters` is computed server-side from a device-supplied position rather than accepted outright. `payableUnits` likewise. Both are absent from the schema and rejected by `.strict()`.

- **Rule 10, and the size.** This is one slice shipping what the architecture's plan splits across three. The user stories are the seams, and `quickstart.md` is grouped by story so each can be verified as it lands. **US4 is the clean cut** if this is split — it is the only story with a migration of its own and nothing before it depends on it.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/manager-app.md` confirm the above in detail. Five guarantees are concrete rather than asserted: `@@unique([companyId, userId, businessDate, session, version])` makes a lost attendance update a database impossibility; `.strict()` on three request schemas makes a client-supplied `latenessFlag`, `payableUnits` or `deliveredBy` a `400`; the manager's and executive's visit projections are enumerated separately with the forbidden fields listed on the executive's side; `409 ORDER_ALREADY_DELIVERED` makes a second marking a refusal rather than an overwrite; and the detail route returns one shape for three screens so the server never has to be told which is wanted. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/010-manager-app/
├── plan.md                        # This file
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output — grouped by user story
├── contracts/
│   └── manager-app.md             # Phase 1 output
├── checklists/
│   └── requirements.md            # /speckit-specify output
└── tasks.md                       # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                      # + Attendance, 3 enums, addReason, delivered*
│   └── migrations/<ts>_attendance_and_manager/
│       └── migration.sql                  # NEW — model, enums, columns, indexes
│   └── migrations/<later-ts>_rls_attendance/
│       └── migration.sql                  # NEW — the one new tenant table
└── src/
    ├── infra/prisma/tenant.extension.ts   # + 'Attendance' in TENANT_MODELS
    └── modules/
        ├── attendance/                    # NEW MODULE
        │   ├── attendance.module.ts
        │   ├── attendance.controller.ts   # GET /attendance, POST /attendance
        │   └── attendance.service.ts      # roster, derivation, versioned amendment
        ├── reports/
        │   ├── reports.controller.ts      # + GET /reports/previous-day
        │   └── previous-day.service.ts    # NEW
        ├── visits/
        │   ├── visits.controller.ts       # + GET /visits, GET /visits/:id, POST /orders/:id/deliver
        │   ├── manager-visits.service.ts  # NEW — deliberately NOT my-visits.service.ts
        │   └── order-delivery.service.ts  # NEW
        └── assignments/
            ├── assignments.controller.ts  # + POST /assignments/:id/stops/manager
            └── extra-stop.service.ts      # + the manager branch (reason, MANAGER_EXTRA)

packages/shared/src/
├── manager-visits.schema.ts               # NEW
├── attendance.schema.ts                   # NEW
├── reports.schema.ts                      # + previousDayQuerySchema
├── errors.ts                              # + 3 codes
└── index.ts                               # + re-export blocks

apps/mobile/src/
├── components/ManagerBottomNav.tsx        # NEW — Reports · Visits · Attendance
├── navigation/RootNavigator.tsx           # + ManagerStack, MANAGER no longer ComingSoon
├── features/profile/ProfileScreen.tsx     # + the manager branch in the bar picker
└── features/manager/                      # NEW
    ├── managerDesign.ts
    ├── PreviousDayReportScreen.tsx        # 3.1
    ├── AddShopToTodayScreen.tsx           # 3.2
    ├── ManagerVisitsScreen.tsx            # 3.3
    ├── OrderVisitScreen.tsx               # 3.4
    ├── NoOrderVisitScreen.tsx             # 3.5
    ├── OutOfRangeVisitScreen.tsx          # 3.6
    ├── AttendanceDayScreen.tsx            # 3.7
    └── AttendanceSessionScreen.tsx        # 3.8
```

**Structure Decision**: a new `attendance` module — its own aggregate, its own model, its own versioning rules — and a new `features/manager/` directory, the third role folder beside `admin/` and `executive/`. The other three routes join modules that already own their aggregates: `visits` has the visit, `reports` was created one route wide by slice 009 **for this**, and `assignments` already has the executive's extra-shop route on the line above the manager's in the architecture's own table.

## Complexity Tracking

*Not needed — no Constitution violations to justify.*

Worth stating anyway, since this slice is far larger than its predecessors: **the size is the feature's, not the design's.** Eight boards is what a role's whole app costs, and nothing here is built twice — the extra-shop transaction is reused rather than reimplemented, the account menu and profile screen are already shared, and the one new module exists because attendance is genuinely a new aggregate. The seams for splitting it are the user stories, and `quickstart.md` is grouped to match.
