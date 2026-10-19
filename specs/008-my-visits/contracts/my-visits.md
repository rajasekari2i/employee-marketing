# API Contract: My Visits — Executive

**Feature**: `008-my-visits` | **Date**: 2026-10-20

One route. The path is taken verbatim from `03-ARCHITECTURE.md:830`. All routes are under `/api/v1`. The schema lives in `packages/shared/src/my-visits.schema.ts` and is wrapped with `createZodDto` in the controller (Constitution rule 5).

---

## `GET /visits/mine`

The executive's own visit history, day-major and cursor-paged. Board 1.5.

**Role**: `MARKETING_EXECUTIVE`. **Idempotency**: not a command; no key. **Audit**: none — reads are not audited.

**There is no `executiveId` parameter, and that is deliberate.** The caller's own id comes from the verified JWT (`request.user.sub`). A route that accepted one would make SC-008 ("zero cross-executive leakage") a guard to be got right rather than a thing that cannot be expressed.

### Query

```ts
export const myVisitsQuerySchema = z
  .object({
    /** Visit id to continue after. Absent = the first page. */
    cursor: z.string().min(1).optional(),
    /** The user asked for 10; the house bound stays 1–100. */
    limit: z.coerce.number().int().min(1).max(100).default(10),
    /** The board's three tabs. Absent = All. */
    outcome: z.enum(['ORDER', 'NO_ORDER']).optional(),
    /**
     * The board's date-range control. `ALL` is the default (FR-020) — a
     * recorded departure from PRD FR-MY-02's "last 7 days", decided with the
     * user. Boundaries are company-local business dates from CompanyClock,
     * never the device clock.
     */
    range: z.enum(['ALL', 'LAST_7_DAYS', 'LAST_30_DAYS']).default('ALL'),
  })
  .strict();
```

`.strict()` matters for the same reason it did in slices 006 and 007: a query carrying a field the server owns must be a `400`, not silently dropped.

### Response `200`

```jsonc
{
  "items": [
    {
      "id": "…",
      "businessDate": "2026-09-29",
      "shopName": "Annapoorna Stores",
      "outcome": "ORDER",
      "summary": "2 brands · 32 qty",
      "occurredAt": "2026-09-29T04:50:00.000Z"
    },
    {
      "id": "…",
      "businessDate": "2026-09-29",
      "shopName": "Balaji Provisions",
      "outcome": "NO_ORDER",
      "summary": "Stock sufficient",
      "occurredAt": "2026-09-29T06:35:00.000Z"
    }
  ],
  "days": [
    { "businessDate": "2026-09-29", "orderCount": 3, "noOrderCount": 2 }
  ],
  "counts": { "all": 64, "order": 41, "noOrder": 23 },
  "todayBusinessDate": "2026-09-29",
  "nextCursor": "…"
}
```

**Fields that must never appear in this response**: `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude`, `capturedLatitude`, `capturedLongitude`, `accuracyMeters`, `reasonText`. See `data-model.md`, *What never appears in this shape*. This response is **not** a filtered view of whatever the manager's `GET /visits` returns — that one carries the measurement and the flags by design, and the two must not share a shape.

### Field notes

| Field | Note |
|---|---|
| `items` | Already ordered `businessDate DESC, submittedAt DESC, id DESC`. The client groups **consecutive** rows by `businessDate` — safe because the ordering is day-major. |
| `days` | One entry per business date present in `items`. `orderCount`/`noOrderCount` are **the whole day's**, independent of the `outcome` filter — board 1.5 computes its summary from the day's unfiltered list (research.md §5). A client cannot derive these from `items`. |
| `counts` | **First page only** (returned when `cursor` is absent). Totals for the whole `range`, not the page — the board's `All · 64` while five rows are on screen. `all` = `order` + `noOrder`. |
| `nextCursor` | The last row's `id` when `items.length === limit`, otherwise `null`. `null` means there is nothing older; the client must stop asking. |
| `todayBusinessDate` | The company's current business date. **Added during implementation**, because board 1.5 labels one group `"Today · Tue 29 Sep"` and the rest `"Tue 29 Sep"`, so the screen must know which day is today — and it must not ask the device, whose timezone can be wrong (Constitution rule 8 puts that conversion in one place). The server already resolves this date for the range filter, so returning it costs nothing. |
| `occurredAt` | `Visit.submittedAt` — when the executive pressed submit, not when the server received it. Rendered as `10:20` in company-local time (research.md §7). |
| `summary` | Composed server-side from recorded snapshots: `"{brandCount} brands · {totalQuantity} qty"` for an order, `reasonLabel` for a no-order. The device never composes it, so the two shapes cannot drift between API and screen. |

### Paging

Keyset, not offset (research.md §3): Prisma `cursor: { id }` + `skip: 1`, exactly as `ShopsService.list` and `UsersService.list` already do.

This is what makes FR-012 hold. A visit recorded between two fetches is inserted **ahead** of the cursor, so later pages are unaffected. With `OFFSET` the same insertion would shift every row down by one and page 2 would re-serve page 1's last row — a duplicate the client could not detect.

An unknown or stale `cursor` returns an empty page, not an error.

### Filtering

- The caller's company (RLS + the Prisma extension) **and** the caller's own `executiveId` — the third scope slices 005–007 established. Tenant isolation alone is never what keeps two executives apart.
- `outcome`, when present, filters `Visit.outcome`. Applied **in SQL**, so a page of ten is ten *matching* visits rather than ten of which some are hidden (FR-017).
- `range`, when not `ALL`, filters `businessDate >= <today − N + 1>`, where "today" is the company-local business date from `CompanyClock`.

### Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | unknown query field, bad `limit`, unknown `outcome` or `range` |
| 403 | `FORBIDDEN_ROLE` | not a Marketing Executive |

**No `404`.** There is no identifier in this route to get wrong — an unknown cursor yields an empty page, and there is no other executive's history to fail to find.

**No new error code.** Unlike slice 007, this feature adds nothing to `packages/shared/src/errors.ts`.

---

## Changed behaviour: `POST /visits`

Not a contract change — the request and response shapes are untouched. One field is now written server-side.

`VisitsService.submitVisit` already loads the stop with `assignment: { select: { status: true } }`. That select gains `businessDate: true`, and the `visit.create` gains `businessDate: stop.assignment.businessDate`.

`businessDate` is **not** added to `submitVisitSchema`, which is `.strict()` — a client sending it gets a `400`. The day a visit belongs to is the server's to decide, from the assignment record, never from the device (Constitution rule 1 and rule 8).

---

## Not in this contract

- **A visit detail route for the executive.** The design gives them no detail screen; boards 3.4–3.6 are the manager's. Rows on board 1.5 are a record, not a door.
- **`GET /visits` (manager/admin)**, `GET /visits/:id` and `POST /visits/:id/review` — later slices, and the reason this route exists separately rather than as a role-filtered variant.
- **Edit or delete.** A submitted visit cannot be edited, which the confirm step already warns about.
- **Any aggregate beyond the two counts above.** My totals (board 1.6) is its own screen.
