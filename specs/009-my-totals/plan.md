# Implementation Plan: My Totals — Executive

**Branch**: `009-my-totals` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-my-totals/spec.md`

## Summary

One new screen — board 1.6 — showing an executive their own figures for Today, This week or This month: beat completion as a percentage, counts of orders, no-orders and total quantity, quantity by brand, and orders per day across the current week with today picked out. Plus the bottom-bar item that opens it, which today raises a "coming in a later update" alert.

**There is no migration, and no new dependency.** Every figure is an aggregate over tables that already exist, driven by indexes that already exist — `visits_exec_history_idx` from slice 008 doing most of the work, because `Visit.businessDate` was added there so a period filter is a range scan rather than a join. The bars are plain views; a charting library would add a native rebuild to draw three rectangles whose exact geometry the board already dictates.

Three things carry the design weight.

**The period is the server's to decide.** The client sends a name — `TODAY` / `THIS_WEEK` / `THIS_MONTH` — never a date. Resolving "what is Monday of this week, in my company's timezone?" on the device would be a second conversion point, which rule 8 puts in exactly one place, and a wrong device timezone would get it wrong *silently*: the executive's figures would disagree with their manager's for the same person and period with nothing on either screen to explain why. `CompanyClock` grows three period helpers, which is the growth path its own header already describes.

**This is the first aggregate read in the product**, and aggregates are where a privacy rule quietly widens. The manager's report of the same records carries an **out-of-range count** (FR-MGR-02); this one must not, in any period, because "how many of my visits were flagged" tells the executive what an individual flag would. `data-model.md` names the forbidden fields and the response's top-level key set is asserted in `quickstart.md`.

**Two agreed divergences from the board, both correctness-driven.** The weekly chart has seven columns rather than six, so a Sunday order cannot be counted in every other figure while being invisible in the chart; and the brand section lists every brand rather than what fits, which earns the guarantee that the brand quantities sum exactly to the Total quantity tile. Every colour, radius, font and spacing value stays the board's.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **No new dependency, and no native rebuild.**

**Storage**: PostgreSQL via Prisma. **No migration** — no model, no column, no enum, no index, no RLS change. Five existing tables are read through four indexes that already exist.

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API.

**Performance Goals**: current figures visible in under 3 s (SC-001); a period switch updates everything in under 2 s (SC-002).

**Constraints**: pixel-exact match to board 1.6 with **exactly two** agreed divergences; no measurement, verdict, flag, review status, radius, coordinate, out-of-range count or monetary value in any response; period boundaries resolved only by `CompanyClock`; completion never above 100% and never a percentage when nothing was assigned.

**Scale/Scope**: 1 new mobile screen + 1 entry point; 1 new API endpoint in 1 new module; 3 new `CompanyClock` helpers; 0 Prisma changes; 0 new error codes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template. The operative gates are CLAUDE.md's "Non-negotiable architectural rules", which are the ten rules `03-ARCHITECTURE.md:1147-1175` tells us to paste there — the basis slices 002–008 used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS, emphatically** | Every number on this screen is server-computed: the period boundaries, the completion ratio, all three tiles, the brand totals and the weekly series. The query carries a period *name* and nothing else, and `executiveTotalsQuerySchema` is `.strict()`, so a client-supplied `from`/`to` or `executiveId` is a **400**, not a silent strip. |
| 2. Tenant isolation, two layers | **PASS** | No new table, so no new RLS surface — every table read is already `FORCE ROW LEVEL SECURITY` and already in `TENANT_MODELS`. Every query goes through `scopeToCaller` plus the third executive-id scope slices 005–008 established. |
| 3. Commands are idempotent | **N/A** | This feature adds no command and writes nothing. |
| 4. History is append-only | **PASS** | Nothing is written, and **nothing is stored**: the figures are recomputed on read, which is what makes a visit that synced late appear the next time the screen is opened. Recorded snapshots (`OrderLine.brandLabel`, `Order.totalQuantity`) are what the figures are built from, so a later master rename never rewrites a past total (FR-014). |
| 5. One contract | **PASS** | `packages/shared/src/reports.schema.ts`, wrapped via `createZodDto` in the controller — the same split every prior slice used. |
| 6. Role visibility is explicit and structural | **PASS, and the one to watch** | The response carries counts and quantities only. No measurement, no verdict, no flag, no review status, **no out-of-range count** and no monetary value. The route is `@Roles('MARKETING_EXECUTIVE')` in this slice; see the note below on what happens when Manager is added. |
| 7. The field app assumes a bad network | **PASS** | Nothing is queued, because nothing here is a command — reads are never queued and fall back to the last loaded payload with a visible note, which is FR-024. The existing outbox is **read** for the waiting indication and never written. |
| 8. Times are UTC in storage, company-local in meaning | **PASS, and it is the central decision** | The period boundaries, the weekly series' span and `isToday` are all resolved by `CompanyClock` from the company's timezone. The client sends no date and computes no date. The three new helpers live **inside** `CompanyClock`, which is what rule 8's "only a single service converts" requires. |
| 9. No secret/token/precise coordinate in logs | **PASS** | No coordinate is in the request or the response, so none can reach a log line from this route. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS with a note** | API and screen ship together. There is **no migration, and that is correct** — the rule forbids "backend done, UI later", it does not require a migration that has no work to do. Slice 007 made the same call for the same reason. |

**No violations — Complexity Tracking is not needed.**

### Three things this check deliberately does not wave through

- **Rule 6, and the route this shares with the manager.** `03-ARCHITECTURE.md:837` marks `/reports/executive-totals` **"all, scoped"** — one route every role may call. This slice implements the executive's half. When Manager and Admin are added in slice 014, their report carries an out-of-range count, and widening *this* response by role would put the product's most load-bearing privacy rule inside an `if` — exactly what slice 008 split `GET /visits/mine` from `GET /visits` to avoid. The recommendation is a sibling route or a second projection, and it is recorded in `contracts/executive-totals.md` because at the time it will look like a one-line addition.

- **Rule 1, and the numbers that are *not* on the board.** An aggregate screen invites "while we're here" additions — an average, a rank, a best day, a comparison against last week. Every one of them would be a number the design does not ask for, and two of them (rank, comparison) would breach FR-023 by describing other people. The data model states the test: *if a number is not visible on board 1.6, it must not be in the response.*

- **Rule 10 and the absent migration.** This is the second slice in a row with a schema change this small — 007 had none, 008 had one column. That is not a trend to correct; it is slice 008 having paid for this one. `Visit.businessDate` and its index were added so My visits could order day-major, and they are exactly what makes a period filter here a range scan instead of a join on every aggregate.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/executive-totals.md` confirm the above in detail. Four guarantees are concrete rather than asserted: the response's forbidden fields are enumerated by name and its top-level key set is asserted in the quickstart; `.strict()` makes a client-supplied date or executive id a `400`; `completionRate` is `null` rather than `0` when nothing was assigned, so a holiday week and a wasted week cannot read the same; and `Σ brands[].quantity === totals.totalQuantity` holds exactly, which is the guarantee listing every brand buys. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/009-my-totals/
├── plan.md                        # This file
├── research.md                    # Phase 0 output
├── data-model.md                  # Phase 1 output
├── quickstart.md                  # Phase 1 output
├── contracts/
│   └── executive-totals.md        # Phase 1 output
├── checklists/
│   └── requirements.md            # /speckit-specify output
└── tasks.md                       # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/src/
├── infra/time/
│   └── company-clock.service.ts        # + startOfWeek, startOfMonth, endOfMonth
├── modules/reports/                    # NEW MODULE — slice 014 joins it
│   ├── reports.module.ts               # NEW
│   ├── reports.controller.ts           # NEW — GET /reports/executive-totals
│   └── executive-totals.service.ts     # NEW — the four aggregates
└── app.module.ts                       # + ReportsModule
    (no prisma change — nothing to migrate)

packages/shared/src/
├── reports.schema.ts                   # NEW — executiveTotalsQuerySchema
└── index.ts                            # + explicit re-export block

apps/mobile/src/
├── components/ExecutiveBottomNav.tsx   # My totals navigates instead of alerting
├── navigation/RootNavigator.tsx        # + MyTotals route
└── features/executive/
    ├── MyTotalsScreen.tsx              # NEW — board 1.6
    └── executiveDesign.ts              # + board 1.6 tokens
```

**Structure Decision**: a **new `reports` module**, the first in the codebase. This read spans `DailyAssignment`, `AssignmentStop`, `Visit`, `Order` and `OrderLine` and belongs to none of them; putting it in `visits` would mean moving it, plus `previous-day`, `shop-history` and the CSV exports, out again in slice 014. `CompanyClock` is already exported by `AssignmentsModule`, which `VisitsModule` imports — `ReportsModule` does the same.

## Complexity Tracking

*Not needed — no Constitution violations to justify.*

Worth stating anyway, since this slice adds a module where the last two added none: **the module boundary is cheaper now than later.** `03-ARCHITECTURE.md:836-839` lists four `/reports/*` routes; this slice builds one and creates the place the other three go.
