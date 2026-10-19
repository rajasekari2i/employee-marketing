# Phase 1 Data Model: My Totals — Executive

**Feature**: `009-my-totals` | **Date**: 2026-10-20

## There is no migration

This feature **reads** and writes nothing. No model, no column, no enum value, no index, no RLS change.

That is worth stating rather than assuming, because an aggregate screen is where a materialised summary table usually appears. Every figure here is recomputed on read instead — which is what makes a visit that synced late appear the next time the screen is opened, with no invalidation story to get wrong (spec, *Reasonable defaults*).

| What it reads | Why |
|---|---|
| `DailyAssignment` | the period's days, via `@@index([companyId, executiveId, businessDate])` |
| `AssignmentStop` | assigned and visited counts, via `@@index([companyId, assignmentId, status])` |
| `Visit` | outcome counts and the weekly series, via `visits_exec_history_idx` |
| `Order` | total quantity, via its `@unique` `visitId` |
| `OrderLine` | quantity by brand, via `@@unique([orderId, brandId])` |

**Slice 008 paid for most of this.** `Visit.businessDate` and `visits_exec_history_idx` — `(companyId, executiveId, businessDate, submittedAt, id)` — were added so My visits could order day-major. Every aggregate here that starts from a visit is a range scan on that index's third column with its first two already pinned. Without that column this slice would have had to join `DailyAssignment` on each aggregate, or add the column itself.

## Entity: the period *(resolved server-side, never sent by the client)*

| Field | Type | Source |
|---|---|---|
| `period` | `'TODAY' \| 'THIS_WEEK' \| 'THIS_MONTH'` | the request |
| `from` | `string` (`YYYY-MM-DD`) | `CompanyClock`, from the company's timezone |
| `to` | `string` (`YYYY-MM-DD`) | as above |
| `label` | `string` | composed server-side — see below |

| `period` | `from` | `to` | `label` |
|---|---|---|---|
| `TODAY` | today | today | `"Tue, 29 Sep"` |
| `THIS_WEEK` | the Monday of today's week | that Monday + 6 days (**Sunday**) | `"Mon 28 Sep – Sun 4 Oct"` |
| `THIS_MONTH` | the 1st of today's month | the last day of that month | `"September 2026"` |

**The client never sends a date.** Resolving "what is Monday of this week, in my company's timezone?" on the device would be a second conversion point, which Constitution rule 8 forbids, and a wrong device timezone would get it wrong silently — the executive's figures would then disagree with their manager's for the same person and period, with nothing on either screen to explain why (research.md §2).

**The week is Monday–Sunday, seven days** — decided with the user. Board 1.6 draws six (Mon–Sat); with six, a Sunday order is counted in every other figure on the screen while being invisible in the chart.

**`label` is composed on the server** because the three forms are three different sentences — a date, a span, a month — and which applies is period logic, not formatting. Same reasoning as slice 007's `distanceLabel` and slice 008's row `summary`. `from`/`to` travel alongside so the screen never has to parse prose.

## Entity: completion *(a read projection)*

| Field | Type | Source |
|---|---|---|
| `assignedStops` | `number` | count of `AssignmentStop` on the period's assignments, **any `source`** |
| `visitedStops` | `number` | of those, `status = 'COMPLETED'` |
| `completionRate` | `number \| null` | `round(visited / assigned × 100)`, or **`null`** when `assignedStops` is 0 |

**`source` is deliberately not filtered.** Counting only `PLAN` stops would let an executive who visited twelve planned shops plus two extras (slice 007) read **14 of 12**, with a progress bar at 117%. Counting every stop on the day in both halves makes `completionRate ≤ 100` true by construction (SC-007), and matches what board 1.3's header already counts.

**`completionRate` is `null`, not `0`.** A new executive, a holiday week, or a month before the beat plan existed all have zero assigned stops, and `0%` would read as "you did nothing" rather than "nothing was assigned". FR-010 requires the card to say which; the screen renders copy for `null`, never `NaN%` (data-model is explicit here because `0/0` is the kind of thing that ships).

## Entity: outcome totals *(a read projection)*

| Field | Type | Source |
|---|---|---|
| `orderCount` | `number` | `Visit` where `outcome = 'ORDER'` in the period |
| `noOrderCount` | `number` | `Visit` where `outcome = 'NO_ORDER'` in the period |
| `totalQuantity` | `number` | sum of `Order.totalQuantity` for the period's order visits |

`Order.totalQuantity` is already server-derived from the submitted lines (slice 006 stores it rather than counting on read, "because the manager's list and the reports sort and filter on them" — this is one of those reports). Summing it is therefore summing a value the server already owns, not re-deriving one.

## Entity: brand total *(a read projection)*

| Field | Type | Source |
|---|---|---|
| `brandId` | `string` | `OrderLine.brandId` — the grouping key |
| `label` | `string` | the **most recently recorded** `OrderLine.brandLabel` for that brand in the period |
| `quantity` | `number` | sum of `OrderLine.quantity` |

Ordered **largest quantity first** (FR-013).

**Grouped by `brandId`, labelled from a snapshot** (research.md §5). Grouping by `brandLabel` would satisfy FR-014 literally but would split one product into two rows with two names the moment an admin fixed a typo mid-period — and this screen exists to answer "which products are moving". The grouping key is the thing; the label is always a recorded value, never the current `Brand.label`, so a brand retired after the period still shows under the name it was sold as.

**Every brand is returned, none is capped** — decided with the user. The consequence is a guarantee worth testing: `Σ brandTotals.quantity === totalQuantity`, exactly, for every period (FR-015a, SC-005). A capped list could never promise that.

## Entity: day total *(a read projection)*

| Field | Type | Source |
|---|---|---|
| `businessDate` | `string` (`YYYY-MM-DD`) | one day of the **current week** |
| `label` | `string` | `"Mon"` … `"Sun"` |
| `orderCount` | `number` | `Visit` where `outcome = 'ORDER'` on that date |
| `isToday` | `boolean` | server-computed, from the company's business date |

**Always seven entries, always the current week, whatever `period` was asked for** (FR-016, FR-019). A day with no orders is present with `orderCount: 0` — omitting it would collapse the week's shape, which is the only thing the chart is for.

**`isToday` comes from the server** for the same reason slice 008 returns `todayBusinessDate`: a phone in the wrong timezone would otherwise highlight the wrong column, and rule 8 puts that conversion in one place.

## The response

| Field | Type |
|---|---|
| `period` | the period projection above |
| `completion` | the completion projection |
| `totals` | the outcome totals |
| `brands` | `BrandTotal[]`, largest first |
| `week` | `{ from, to, days: DayTotal[] }` — the **current** week, not the selected period |

### What never appears in this response

Listed by name so the boundary is visible rather than inferred (FR-021, FR-022, FR-023, SC-008):

- `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, any coordinate — the measurement and the verdict. This screen aggregates the same `Visit` rows the manager's reports will, and those carry all of it.
- **An out-of-range count.** The manager's previous-day report has one (`02-PRD.md` FR-MGR-02); this screen must not, in any period. It is the aggregate form of the same rule — "how many of my visits were flagged" tells the executive what an individual flag would.
- **Any monetary value.** `OD-07` and FR-022: release 1 is quantity only. `Order` has no price column, so nothing can leak today; the rule is written down so it cannot drift back in when one is added.
- **Anything about another executive** — no team total, no company average, no rank (FR-023).

**The one-line test a reviewer can apply**: if a number is not visible on board 1.6, it must not be in the response.

## Validation rules

| Rule | Where enforced | Failure |
|---|---|---|
| The caller is a Marketing Executive | `@Roles` on the controller | `403 FORBIDDEN_ROLE` |
| Only the caller's own figures are returned | service, `executiveId` from the JWT — never a parameter | — (no leak is possible; there is no parameter to abuse) |
| `period` is one of the three | Zod enum | `400 VALIDATION_FAILED` |
| No unknown query field | Zod `.strict()` | `400 VALIDATION_FAILED` |
| No date is accepted from the client | the schema has no `from`/`to` | `400` via `.strict()` |

## State transitions

**None.** This feature computes figures from terminal records and writes nothing. The only thing that changes over time is what the records say — including a visit that synced late, which is why nothing here is stored.
