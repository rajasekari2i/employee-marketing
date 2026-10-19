# Phase 0 Research: My Totals — Executive

**Feature**: `009-my-totals` | **Date**: 2026-10-20

Every decision below is grounded in code that already exists in this repository, in a board decoded from `docs/ui-design/Field_Sales_Beat_App.html`, or in the architecture's own API surface table. Where the design, the product requirements and the user's instruction disagree, the disagreement is named rather than smoothed over.

---

## §1 — The endpoint is already specified; use that path

**Decision**: `GET /reports/executive-totals`, taken verbatim from the architecture's API surface table.

`03-ARCHITECTURE.md:836-839`:

```
| GET | `/reports/previous-day?date=`        | Manager, Admin | |
| GET | `/reports/executive-totals?from=&to=`| all, scoped    | |
| GET | `/reports/shop-history/:shopId`      | Manager, Admin | |
| GET | `/reports/*/export.csv`              | Manager, Admin | streamed, audited |
```

**Rationale**: the document already decided the path, and unlike `GET /visits` / `GET /visits/mine` this one is marked **"all, scoped"** — a single route every role may call, returning what that role may see. This slice implements the executive's half of it: `@Roles('MARKETING_EXECUTIVE')`, scoped to the caller's own JWT id.

**A new `reports` module**, the first in the codebase. It does not belong in `visits`: this reads `DailyAssignment`, `AssignmentStop`, `Visit`, `Order` and `OrderLine` together and belongs to none of them, and slice 014 (`reports-and-export`) will add `previous-day`, `shop-history` and the CSV exports beside it. Putting it in `visits` now would mean moving three more routes out later.

**A trap recorded for slice 014, rather than pre-solved here.** When Manager and Admin are added to this route, their view of a previous-day report carries an **out-of-range count** (`02-PRD.md` FR-MGR-02: "assigned, visited, pending, order, no-order, out-of-range"). Widening this response by role would put the product's most load-bearing privacy rule inside an `if` — exactly what slice 008 split `GET /visits/mine` from `GET /visits` to avoid. The recommendation when that slice arrives is a sibling route or a second projection, not a conditional field. It is noted here because the decision will look like a one-line addition at the time, and it is not.

**Query shape**: the table writes `?from=&to=`. This slice takes **`period=TODAY|THIS_WEEK|THIS_MONTH`** instead, for a reason rule 8 makes non-negotiable — see §2. `from`/`to` is the manager's arbitrary-range shape and belongs to slice 014; building it now would be speculative, and building *both* would offer two ways to say the same thing.

---

## §2 — The period boundaries are the server's to decide

**Decision**: the client sends a period **name**, never a date range. The server resolves the boundaries from the company's timezone through `CompanyClock`.

**Rationale**: this is Constitution rule 8 applied literally — "Times are UTC in storage, company-local in meaning. Only a single `CompanyClock` service converts; `businessDate` is always derived from company timezone, not client clock." FR-006 states the user-visible consequence: an executive whose phone is set to another timezone must see the same week as their manager.

Accepting `from`/`to` from the device would mean the device computing "what is Monday of this week, in my company's timezone?" — a conversion rule 8 puts in exactly one place, and one a wrong device timezone would get wrong silently. The figures would then disagree with the manager's report for the same person and period, with nothing on either screen to explain why.

**`CompanyClock` grows three helpers**, rather than the arithmetic living in the new service:

| Helper | Returns |
|---|---|
| `startOfWeek(businessDate)` | the Monday of that date's week, as `YYYY-MM-DD` |
| `startOfMonth(businessDate)` | the 1st of that date's month |
| `endOfMonth(businessDate)` | the last day of that date's month |

This is the service's own documented growth path: its header says *"A later feature that needs real time arithmetic adopts Luxon **inside this service**, without touching a single caller — which is the whole point of funnelling the conversion through one class."* `startOfWeek` is one line on top of the existing `weekdayOf`, which already returns `1 = Monday … 7 = Sunday` — the convention `BeatPlan.workingDays` stores.

**Week runs Monday to Sunday** (FR-006, FR-020) — see §6 for why that is seven days and not the board's six.

---

## §3 — Four aggregates, and what each reads

**Decision**: the response is computed from four independent aggregate queries, each driven by an index that already exists.

| Figure | Source | Shape |
|---|---|---|
| Assigned / visited | `AssignmentStop`, for the period's `DailyAssignment`s | two counts |
| Orders / no-orders | `Visit`, by `outcome` | `groupBy` |
| Total quantity | `Order.totalQuantity`, for the period's order visits | one sum |
| Quantity by brand | `OrderLine.quantity`, grouped by brand | `groupBy` |
| Orders per day | `Visit` where `outcome = ORDER`, by `businessDate` | `groupBy` |

**Slice 008 did most of the work for this one.** `Visit.businessDate` and `visits_exec_history_idx` — `(companyId, executiveId, businessDate, submittedAt, id)` — were added so My visits could page day-major, and they serve every query above that starts from a visit: a period filter is a range scan on the third column of an index whose first two are already pinned. Without that column this slice would have had to join `DailyAssignment` on every aggregate, or add the column itself.

**Completion is two indexed reads, not a join through visits.** `DailyAssignment` has `@@index([companyId, executiveId, businessDate])` and `AssignmentStop` has `@@index([companyId, assignmentId, status])`, so: find the period's assignment ids, then `groupBy` status over their stops. Counting "visited" from `Visit` instead would be subtly wrong — it is the **stop** that is or is not covered, and `AssignmentStop.status === 'COMPLETED'` is what `submitVisit` already sets.

**Quantity by brand reaches through two relations** — `OrderLine → Order → Visit` — which is the only query here without a purpose-built index. The relation walk itself is along unique indexes (`Order.visitId` is `@unique`, `OrderLine` has `@@unique([orderId, brandId])`), and the driving filter is the visit index above. At the stated volumes — a month of one executive's orders is hundreds of lines, not millions — this is comfortably fast. **If it ever is not**, the fix recorded here is to fetch the period's visit ids once (they are already needed) and group `OrderLine` by `orderId IN (…)`, rather than to add an index speculatively.

**Nothing is stored.** Every figure is recomputed on read, which is what makes a late offline sync appear the next time the screen is opened (spec, *Reasonable defaults*). A materialised totals table is the wrong trade at this scale and would need its own invalidation story.

---

## §4 — What an executive may see in their own totals

**Decision**: a response shape authored for this screen. It carries counts and quantities and nothing else.

### What never appears in this shape

Listed by name so the boundary is visible rather than inferred:

- `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, any coordinate — the measurement and the verdict (FR-021). This screen aggregates the same `Visit` rows the manager's reports will, and those carry all of it.
- **An out-of-range count.** The manager's previous-day report has one (FR-MGR-02) and this screen must not, in any period. It is the aggregate form of the same rule: a count of "how many of my visits were flagged" tells the executive what an individual flag would.
- **Any monetary value** — price, order value, revenue. FR-022 and open decision `OD-07`: release 1 captures quantity only. `Order` has no price column, so there is nothing to leak today; the requirement exists so it cannot drift back in when one is added.
- **Anything about another executive** — no team total, no peer comparison, no company average, no rank (FR-023).

**The one-line test a reviewer can apply**: if a number is not visible on board 1.6, it must not be in the response.

---

## §5 — Which name a brand is reported under

**Decision**: group by `brandId`, and label each group with the **most recently recorded `brandLabel`** among that brand's lines in the period. One row per brand, and the name is always a recorded snapshot — never the current master value.

**Rationale, because this is a genuine interpretation call.** FR-014 requires the name shown to be "the one recorded with the order, so a later rename or retirement never rewrites what the totals say". `OrderLine.brandLabel` is exactly that snapshot — Architecture §9's "snapshots everywhere", and the reason the column exists.

Grouping by `brandLabel` would satisfy FR-014 literally, but a brand renamed mid-period would then appear as **two rows with two names and a split quantity**. For a history list (board 1.5) that is correct — each row reports what was recorded. For a *totals* screen it is not: the screen exists to answer "which products are moving", and splitting one product's total because an admin corrected a typo misreports exactly that.

So the grouping key is the thing (`brandId`) and the label is a snapshot of how it was last recorded in the period. A brand retired after the period still shows under the name it was sold as, which is what FR-014 is protecting.

**Alternatives considered**:
- Join the current `Brand.label`. Rejected: it is the master value FR-014 forbids, and a retired brand would vanish or render blank.
- Group by label. Rejected above.

---

## §6 — The two divergences from board 1.6, and why they are not aesthetic

Both were put to the user and answered on 2026-10-20. Both exist because the board is a static mock whose sample data quietly answers a question real data reopens.

### Seven columns, not six

The board draws exactly six bars — its script's `labels` array is `['Mon','Tue','Wed','Thu','Fri','Sat']` — and its sample week reads *"Mon 28 Sep – Sat 3 Oct"*.

With six columns, **an order recorded on a Sunday is counted in the completion card, the three tiles and the brand totals while being invisible in the chart.** That is a silent disagreement between two halves of one screen, not a design decision. Nothing in `01-BRD.md` or `02-PRD.md` fixes the week at six days, and `BeatPlan.workingDays` is a configurable array per plan, so a Sunday working day is representable today.

The seventh column makes each bar narrower by roughly a seventh. Every colour, radius, height rule and font in the chart is unchanged.

### The brand section lists every brand

The board draws three rows inside a card in a `main` that is `overflow: hidden` on a fixed 390 × 844 artboard. It fits exactly at three and has nowhere to grow.

**Implementation note, so the intent is not quietly changed:** the user's answer was "all brands, the section scrolls". The *intent* — nothing hidden — is better served by making the **page** scroll than by nesting a scrolling card inside a scrolling screen, which React Native handles poorly and which would trap the gesture. So the brand card grows to fit its rows and the screen scrolls when the content exceeds the viewport. Nothing is hidden, no gesture is trapped, and at three brands the screen is pixel-identical to the board because nothing overflows.

This also earns FR-015a: because no brand is dropped, the brand quantities **add up to the Total quantity tile exactly**, which a capped list could never promise.

---

## §7 — The chart does not follow the period tabs

**Decision**: "Orders per day · this week" always shows the current week, whichever tab is selected.

**Rationale**: this resolves a contradiction in the product requirements rather than an ambiguity. `02-PRD.md` FR-MY-04 says the period switcher "recalculates everything shown"; FR-MY-05 says the screen shows "orders per day **for the current week**". The design settles it twice over — the section's own heading reads *"Orders per day · this week"*, and decoding the board's component script shows `perDay` computed outside the period switch entirely:

```js
const P = { today: {...}, week: {...}, month: {...} }[cur];   // period-dependent
const perDay = [7, 8, 6, 9, 5, 6];                            // not
```

FR-016 implements the design, and FR-005 names the exception explicitly rather than leaving the contradiction standing for a reviewer to rediscover.

**Consequence for the contract**: the weekly series is returned on every response regardless of `period`, and its own `from`/`to` are the current week's — not the selected period's. Returning it only for `THIS_WEEK` would make the screen fetch twice.

---

## §8 — "Assigned" includes shops added during the day

**Decision**: assigned = every `AssignmentStop` on the period's days, whatever its `source`. Visited = those at `COMPLETED`.

**Rationale**: the board's line reads "{{visited}} of {{assigned}} assigned shops visited", which can be read as the beat plan's shops only. That reading breaks the ratio: an executive who visits all twelve planned shops plus two extras (slice 007) would be shown **14 of 12**, and a progress bar at 117%.

Counting every stop on the day in both halves keeps the percentage ≤ 100% by construction (SC-007) and matches what board 1.3's own header already counts — `counts.total` there includes extras, which is why it reads "N planned + N extra".

**Division by zero** is a real case, not a defensive flourish: a new executive, a holiday week, or a month before the beat plan existed all have zero assigned stops. FR-010 requires the card to say so rather than show a percentage, so the service returns `completionRate: null` and the screen renders copy, not `NaN%`.

---

## §9 — The period label is composed on the server

**Decision**: the response carries `label` — `"Tue, 29 Sep"` / `"Mon 28 Sep – Sun 4 Oct"` / `"September 2026"` — alongside the raw `from` and `to`.

**Rationale**: the three forms are not three formats of one value, they are three different sentences — a date, a span, a month. Which one applies is period logic, and the period is the server's (§2). Composing it where the boundaries are resolved keeps the label and the figures from ever disagreeing.

This follows the house pattern: slice 007 formats `distanceLabel` server-side and slice 008 composes a visit row's `summary` there, both recorded with the same reasoning — the device renders a string rather than re-deriving a rule. The raw `from`/`to` travel too, so the screen can do anything else it needs without parsing prose.

---

## §10 — No chart library

**Decision**: the bars are plain views sized by percentage and pixel height. No charting dependency, and **no native rebuild**.

**Rationale**: board 1.6 has exactly two bar forms and both are trivial. The brand bar is a 8 px track at radius 999 with a fill at `qty / max * 100%`. The weekly column is a view of height `round(n / max * 54) px` with `border-radius: 6px 6px 2px 2px`. The progress bar on the completion card is a third of the same shape. A charting library would add a dependency, a native rebuild and its own rendering model, to draw three rectangles whose exact geometry the board already dictates — and the standing fidelity rule means the library's defaults would have to be overridden everywhere anyway.

`react-native-svg` is already linked (slice 006 added it for the outline icons), so even a path-based chart would need nothing new. It is not needed either.

---

## §11 — The entry point

**Decision**: the **My totals** item in `ExecutiveBottomNav`, which currently calls `comingSoon('My totals')`.

Slice 008 already added `onMyVisitsPress` beside the existing `onTodayPress` and left this one alerting, so this slice adds the third handler and the bar is then fully live. The component has rendered all three items since slice 005, which recorded the reasoning: *"all three render even though only Today is built, because omitting two would visibly change the bar's spacing."*

Decoding board 1.6 confirms the bar is the same three-item bar, with My totals as the current item in `#1D4ED8`.

---

## Summary of new surface

| Layer | What is added |
|---|---|
| Prisma | **Nothing.** No model, no column, no index, no migration. Every figure is an aggregate over tables that exist, driven by indexes that exist — `visits_exec_history_idx` from slice 008 doing most of the work. |
| Shared | `reports.schema.ts` — `executiveTotalsQuerySchema` (`.strict()`); re-exports in `index.ts`. No new error code. |
| API | A new `reports` module with `GET /reports/executive-totals` at the path `03-ARCHITECTURE.md:837` already specifies, plus three period helpers on `CompanyClock`. |
| Mobile | `MyTotalsScreen` (board 1.6), one `ExecutiveStackParamList` entry, the bottom bar's third handler, and board-1.6 tokens in `executiveDesign.ts`. No new dependency and **no native rebuild**. |
