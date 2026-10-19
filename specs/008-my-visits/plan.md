# Implementation Plan: My Visits — Executive

**Branch**: `008-my-visits` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-my-visits/spec.md`

## Summary

One new screen — board 1.5 — showing the executive their own visit history, grouped by business day, newest first, paged ten at a time, with three outcome tabs and a date-range control. Plus the bottom-bar item that opens it, which today raises a "coming in a later update" alert.

Three things carry the design weight, and all three come from the same place: **this is the first screen in the product that pages.**

**A day must not split across a page.** The board groups by business day and FR-011 requires one block per day however the ten-row boundary falls. That is only safe if the server returns rows day-major, and today the business day is not on the visit — it is one join away on `DailyAssignment`. Ordering by a device-supplied timestamp instead would let a wrong phone clock interleave two days and split a group. So this slice adds **one column**, `Visit.businessDate`, snapshotted at submission exactly as `reasonLabel` and `effectiveRadiusMeters` already are, with the backfill that `20261019230000_backfill_stop_coords` exists to remind us not to forget. It is the only schema change.

**The counts are not page counts.** The board shows `All · 64` beside five rows, and each day heading shows that day's orders and no-orders — computed, in the board's own script, from the day's **unfiltered** list, so on the Order tab a day still reads "3 orders · 2 no order". Neither number can be derived from what the page returns.

**This is also the first executive-facing *list* of visits**, reading the rows that will drive the manager's list (board 3.3) — a list that deliberately carries the distance, the flags and the review status. The executive's projection is authored separately and selects six fields; the forbidden ones are named in `data-model.md` so the boundary is visible rather than inferred.

## Technical Context

**Language/Version**: TypeScript 5.6, Node.js ≥22 (API), React Native 0.87.1 (mobile, Android) — unchanged.

**Primary Dependencies**: NestJS + `nestjs-zod` + Prisma (API); Zod contracts in `@field-sales/shared`; React Navigation 7 (mobile). **No new dependency, and no native rebuild** — `FlatList` is React Native core and four admin screens already use it.

**Storage**: PostgreSQL via Prisma. **One migration**: add `Visit.businessDate` (`@db.Date`), backfill from `daily_assignments`, add `@@index([companyId, executiveId, businessDate, submittedAt, id], map: "visits_exec_history_idx")`, set not-null. No new model, no new enum, no new tenant table. The explicit index name is load-bearing — the generated one would be 64 characters against Postgres' 63-byte limit (data-model.md).

**Testing**: None — CLAUDE.md's standing "no unit or integration tests for now" policy applies. `quickstart.md` is the verification path.

**Target Platform**: The same Android app and Node/NestJS API.

**Project Type**: Mobile app + API, monorepo — no new structure; the new screen joins `features/executive/`.

**Performance Goals**: first visits visible in under 3 s (SC-001); never more than 10 visits' worth of data for the first screenful (SC-002); an executive with 1,000 visits scrolls back a month without slowdown (SC-003).

**Constraints**: pixel-exact match to board 1.5 with **exactly one** agreed addition (the waiting strip, absent when the outbox is empty); no measurement, verdict, flag, review status, radius or coordinate in any response; a day never splits across a page; a visit never appears twice, including across an insertion between fetches.

**Scale/Scope**: 1 new mobile screen + 1 entry point; 1 new API endpoint; 1 Prisma column + 1 index + 1 backfill; 0 new error codes; 0 new outbox kinds; 1 line added to an existing slice's write path.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled Spec Kit template. The operative gates are CLAUDE.md's "Non-negotiable architectural rules", which are the ten rules `03-ARCHITECTURE.md:1147-1175` tells us to paste there — the basis slices 002–007 used.

| Rule | Status | How this feature satisfies it |
|---|---|---|
| 1. Server owns the truth | **PASS** | Every number on this screen is server-computed: the day counts, the tab counts, the order summary (`brandCount`/`totalQuantity`) and the grouping key. `businessDate` is written from the assignment record, never accepted from a client — it is absent from `submitVisitSchema`, which is `.strict()`, so sending it is a `400`. `myVisitsQuerySchema` is `.strict()` too. |
| 2. Tenant isolation, two layers | **PASS** | No new table, so no new RLS surface — `visits` is already `FORCE ROW LEVEL SECURITY` with `visits_tenant_isolation`, and `'Visit'` is already in `TENANT_MODELS`. Every query goes through `scopeToCaller` plus the third executive-id scope slices 005–007 established. |
| 3. Commands are idempotent | **N/A** | This feature adds no command. The one write it touches (`POST /visits`) keeps its `Idempotency-Key` unchanged. |
| 4. History is append-only | **PASS, and this is the feature** | Nothing here edits or deletes a visit; there is no route for it and the spec puts both permanently out of scope. The new column is derived-once and immutable — `DailyAssignment` is itself an immutable snapshot (BUS-05), so it can never drift. Recorded labels (`reasonLabel`, `brandLabel`) are what the rows display, so a later master rename never rewrites history (FR-006). |
| 5. One contract | **PASS** | `packages/shared/src/my-visits.schema.ts`, wrapped via `createZodDto` in the controller — the same split every prior slice used. |
| 6. Role visibility is explicit and structural | **PASS, and the one to watch** | The response is a purpose-built six-field shape that never selects `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, the shop coordinates **or the executive's own captured position**. It does **not** share a shape with the manager's future `GET /visits`, which carries all of those by design. See the note below. |
| 7. The field app assumes a bad network | **PASS** | Nothing is queued, because nothing here is a command — `03-ARCHITECTURE.md:1016` says reads are never queued and fall back to the last cached payload with a visible banner, which is exactly FR-024. The existing outbox is **read** for the waiting count and never written. |
| 8. Times are UTC in storage, company-local in meaning | **PASS** | `businessDate` comes from `DailyAssignment`, which `CompanyClock` derived from the company timezone. The date-range boundaries are company-local business dates from the same service. The row's clock time is converted for display only. |
| 9. No secret/token/precise coordinate in logs | **PASS** | No coordinate is in the request or the response, so none can reach a log line from this route. `reasonText` — already on the deep redaction list — is deliberately not selected. |
| 10. Every slice ships a migration, an API, and the screens that use it | **PASS** | All three, in one slice. |

**No violations — Complexity Tracking is not needed.**

### Three things this check deliberately does not wave through

- **Rule 6 and the manager's list.** This screen reads the same `Visit` rows that board 3.3 will render *with* the distance, the flags and the "Out of range" tab. The two views are one table apart, and a shared shape with a role-conditional filter would put the product's most load-bearing privacy rule inside an `if`. `data-model.md` therefore enumerates the forbidden fields **by name** and `quickstart.md` Scenario 10 asserts the exact key set of a returned row, so a later refactor that widens the select fails a check rather than passing silently.

- **Rule 6 and the executive's own position.** `capturedLatitude`/`capturedLongitude`/`accuracyMeters` are the executive's *own* data, which makes them easy to wave through. They are excluded anyway (FR-023): this screen is a record of what was done, not of where the phone was, and putting a precise coordinate into a list payload for no purpose the board has is how rule 9 problems start.

- **Rule 1 and the time a row shows.** `occurredAt` is `submittedAt` — a **client-supplied** timestamp (research.md §7). That is a deliberate exception, taken because an offline visit synced four hours later would otherwise display a time the executive never experienced. The bound is explicit and is why `businessDate` exists: a wrong device clock can misplace a row *within* its day and nothing else — it cannot move a visit to another day, split a day group, or break pagination, because the sort is day-major on a server-owned column.

**Post-Phase-1 re-check**: `data-model.md` and `contracts/my-visits.md` confirm the above in detail. Four guarantees are concrete rather than asserted: the row projection's fields are enumerated by name with the forbidden ones listed alongside; `.strict()` makes an unknown query field (including a hand-crafted `executiveId`) a `400` rather than a silent strip; keyset pagination makes "no duplicates across an insertion" a property of the mechanism rather than a de-duplication pass; and the day-major ordering makes "one block per day" a property of the `ORDER BY`. No new violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/008-my-visits/
├── plan.md                    # This file
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── quickstart.md              # Phase 1 output
├── contracts/
│   └── my-visits.md           # Phase 1 output
├── checklists/
│   └── requirements.md        # /speckit-specify output
└── tasks.md                   # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── prisma/
│   ├── schema.prisma                     # + Visit.businessDate, + the composite index
│   └── migrations/<ts>_visit_business_date/
│       └── migration.sql                 # NEW — add, BACKFILL, index, set not-null
└── src/modules/visits/
    ├── visits.controller.ts              # + GET /visits/mine
    ├── visits.module.ts                  # + MyVisitsService
    ├── visits.service.ts                 # + businessDate on the stop select and the create
    └── my-visits.service.ts              # NEW — the paged, grouped, counted read

packages/shared/src/
├── my-visits.schema.ts                   # NEW — myVisitsQuerySchema
└── index.ts                              # + explicit re-export block

apps/mobile/src/
├── components/ExecutiveBottomNav.tsx     # My visits navigates instead of alerting
├── navigation/RootNavigator.tsx          # + MyVisits route
└── features/executive/
    ├── MyVisitsScreen.tsx                # NEW — board 1.5
    └── executiveDesign.ts                # + board 1.5 tokens
```

**Structure Decision**: no new structure. The read joins the `visits` module, which already owns `POST /visits`, `GET /stops/:id`, `POST /shops/:id/pin` and `GET /shops/nearby` — the executive's whole field-and-history surface, with the class-level role and the `requireCompanyId`/`requireExecutiveId` helpers already in place. The path `GET /visits/mine` is taken verbatim from `03-ARCHITECTURE.md:830` rather than invented; the manager's `GET /visits` is a sibling on the next line of the same table and a later slice.

## Complexity Tracking

*Not needed — no Constitution violations to justify.*

Worth stating anyway, since this slice adds a column where slice 007 added none: **the migration is not incidental complexity, it is the cheapest way to meet FR-011.** The alternatives — ordering by a relation field under a cursor, or ordering by a device-supplied timestamp — were considered and rejected in research.md §2 for correctness reasons, not for effort.
