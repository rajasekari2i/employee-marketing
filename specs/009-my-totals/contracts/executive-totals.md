# API Contract: My Totals — Executive

**Feature**: `009-my-totals` | **Date**: 2026-10-20

One route. The path is taken verbatim from `03-ARCHITECTURE.md:837`. All routes are under `/api/v1`. The schema lives in `packages/shared/src/reports.schema.ts` and is wrapped with `createZodDto` in the controller (Constitution rule 5).

---

## `GET /reports/executive-totals`

Board 1.6. Executive only in this slice.

**Role**: `MARKETING_EXECUTIVE`. **Idempotency**: not a command; no key. **Audit**: none — reads are not audited. (`/reports/*/export.csv` is audited; this is not an export.)

**There is no `executiveId` parameter, and no `from`/`to`.** The caller's own id comes from the verified JWT; the period boundaries come from `CompanyClock`. Both omissions are deliberate — see *Why no date range* below.

### Query

```ts
export const executiveTotalsQuerySchema = z
  .object({
    /** The board's three tabs. Boundaries are resolved server-side. */
    period: z.enum(['TODAY', 'THIS_WEEK', 'THIS_MONTH']).default('THIS_WEEK'),
  })
  .strict();
```

`.strict()` matters for the same reason it did in slices 006–008: a query carrying a field the server owns — a hand-crafted `executiveId`, or a `from`/`to` that would bypass the company clock — must be a `400` naming the key, not something the server has to remember to ignore.

The default is `THIS_WEEK`, which is board 1.6's own default state (FR-007).

### Response `200`

```jsonc
{
  "period": {
    "period": "THIS_WEEK",
    "from": "2026-09-28",
    "to": "2026-10-04",
    "label": "Mon 28 Sep – Sun 4 Oct"
  },
  "completion": {
    "assignedStops": 72,
    "visitedStops": 64,
    "completionRate": 89          // null when assignedStops is 0
  },
  "totals": {
    "orderCount": 41,
    "noOrderCount": 23,
    "totalQuantity": 1286
  },
  "brands": [
    { "brandId": "…", "label": "Sunrise Gold Tea 250 g", "quantity": 612 },
    { "brandId": "…", "label": "Sunrise Filter Coffee",  "quantity": 398 },
    { "brandId": "…", "label": "Sunrise Masala 100 g",   "quantity": 276 }
  ],
  "week": {
    "from": "2026-09-28",
    "to": "2026-10-04",
    "days": [
      { "businessDate": "2026-09-28", "label": "Mon", "orderCount": 7, "isToday": false },
      { "businessDate": "2026-09-29", "label": "Tue", "orderCount": 8, "isToday": true  },
      { "businessDate": "2026-09-30", "label": "Wed", "orderCount": 6, "isToday": false },
      { "businessDate": "2026-10-01", "label": "Thu", "orderCount": 9, "isToday": false },
      { "businessDate": "2026-10-02", "label": "Fri", "orderCount": 5, "isToday": false },
      { "businessDate": "2026-10-03", "label": "Sat", "orderCount": 6, "isToday": false },
      { "businessDate": "2026-10-04", "label": "Sun", "orderCount": 0, "isToday": false }
    ]
  }
}
```

**Fields that must never appear in this response**: `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, any coordinate, **any out-of-range count**, **any monetary value**, and anything describing another executive. See `data-model.md`, *What never appears in this response*.

### Field notes

| Field | Note |
|---|---|
| `period.label` | Composed server-side. Three different sentences — a date, a span, a month — and which applies is period logic, not formatting (research.md §9). `from`/`to` travel too, so the screen never parses prose. |
| `completion.assignedStops` | Every `AssignmentStop` on the period's days, **whatever its `source`**. Counting only planned stops would let an executive who visited 12 planned plus 2 extras read "14 of 12". |
| `completion.completionRate` | **`null`, not `0`, when nothing was assigned.** A holiday week and a wasted week are different facts and `0%` says the wrong one. The screen renders copy for `null` (FR-010). Otherwise an integer percentage, and `≤ 100` by construction. |
| `totals.totalQuantity` | Sum of `Order.totalQuantity`, which slice 006 already derives server-side from the submitted lines. |
| `brands` | **Every** brand, largest quantity first — none is capped (FR-015). Grouped by `brandId`; `label` is the most recently recorded `brandLabel` in the period, never the current `Brand.label` (research.md §5). |
| `week` | **Always the current week, on every response, whatever `period` was asked for** (FR-016). Its own `from`/`to` are the week's, not the selected period's. Returning it only for `THIS_WEEK` would make the screen fetch twice. |
| `week.days` | **Always seven entries, Monday to Sunday.** A day with no orders is present with `orderCount: 0` — omitting it would collapse the week's shape, which is the only thing the chart is for. |
| `week.days[].isToday` | Server-computed. A phone in the wrong timezone would otherwise highlight the wrong column (rule 8). |

### Guarantees the response makes

Two are worth asserting in a test rather than assuming:

- **`Σ brands[].quantity === totals.totalQuantity`**, exactly, for every period. This holds only because no brand is capped (FR-015a, SC-005).
- **`Σ week.days[].orderCount === totals.orderCount`** when `period` is `THIS_WEEK`. For the other two periods the week series describes a different span and the two legitimately differ (SC-006).

### Why no date range

The architecture's table writes this route as `?from=&to=`. This slice takes a `period` name instead:

- Resolving "what is Monday of this week, in my company's timezone?" on the device would be a second conversion point, which Constitution rule 8 puts in exactly one place — and a wrong device timezone would get it wrong **silently**, leaving the executive's figures disagreeing with their manager's for the same person and period.
- `from`/`to` is the manager's arbitrary-range shape and belongs with the rest of slice 014 (`reports-and-export`). Building it now would be speculative; building both would offer two ways to say the same thing and two ways for them to disagree.

### Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | unknown query field (including `executiveId`, `from`, `to`), unknown `period` |
| 403 | `FORBIDDEN_ROLE` | not a Marketing Executive |

**No `404`.** There is no identifier in this route to get wrong. An executive with no records gets a well-formed response of zeroes and `completionRate: null`, not an error.

**No new error code.** Like slice 008, this feature adds nothing to `packages/shared/src/errors.ts`.

---

## A trap recorded for slice 014

`03-ARCHITECTURE.md:837` marks this route **"all, scoped"** — one route every role may call. This slice implements the executive's half.

When Manager and Admin are added, their report carries an **out-of-range count** (`02-PRD.md` FR-MGR-02: "assigned, visited, pending, order, no-order, out-of-range"). Widening this response by role would put the product's most load-bearing privacy rule inside an `if` — which is exactly what slice 008 split `GET /visits/mine` from `GET /visits` to avoid.

The recommendation is a sibling route or a second projection, not a conditional field. It is written down here because at the time it will look like a one-line addition, and it is not.

---

## Not in this contract

- **`GET /reports/previous-day`**, `GET /reports/shop-history/:shopId` and `GET /reports/*/export.csv` — the rest of the `reports` module, and slice 014's work. This slice creates the module they will join.
- **Any drill-down.** The design gives this screen no way to tap a figure and see what it is made of; the numbers are a summary, not a door.
- **An arbitrary date range, a target, a quota, or a comparison with a previous period.** None is in the design or the requirements.
