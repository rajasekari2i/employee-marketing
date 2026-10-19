# Contract: Today's Assignment & Beat Day

Base path `/api/v1/assignments`. Marketing Executive only in this slice, tenant-scoped (the Prisma extension injects `companyId` from the request's CLS context), and additionally scoped to the **caller's own** executive id — an executive can never read or act on another executive's day, even within their company.

Architecture §7's API surface already names all three routes (`GET /assignments/today`, `POST /assignments/:id/start`, `POST /assignments/:id/end`). The manager/admin variant `GET /assignments?date=&executiveId=` is **not** part of this slice.

Both commands require an `Idempotency-Key` header.

## `GET /assignments/today` — Marketing Executive

**Query**: none. The day is always the caller's company-local business date, derived by `CompanyClock` from the company's timezone — never from a client-supplied date or the device clock (FR-005).

> **This read may write.** When no route exists for today and the caller's active beat plan covers today's weekday, this endpoint creates the route and returns it (research.md §1, the user's decision of 2026-10-19). The write is idempotent by construction: `@@unique([companyId, businessDate, executiveId])` means a race loses the insert and the service re-reads the winner. It takes no `Idempotency-Key` and is the only read in this codebase permitted to write.

**Response `200` — a route exists (or was just created)**
```ts
{
  assignment: {
    id: string;
    businessDate: string;              // "YYYY-MM-DD", company-local
    beatPlanName: string | null;       // snapshot at creation
    state: "NOT_STARTED" | "RUNNING" | "ENDED";
    startedAt: string | null;          // ISO-8601, server clock
    endedAt: string | null;
    nearestShopName: string | null;    // running/ended only; null if no pinned stop
    counts: {
      total: number;
      pending: number;
      completed: number;
      revisit: number;
      extra: number;
      visited: number;                 // completed
      orders: number;                  // 0 until visit submission exists
      noOrder: number;                 // 0 until visit submission exists
      notVisited: number;              // pending + skipped
    };
    stops: Array<{
      id: string;
      sequence: number;
      source: "PLAN" | "EXEC_EXTRA" | "MANAGER_EXTRA";
      status: "PENDING" | "COMPLETED" | "SKIPPED" | "REVISIT";
      shop: {
        id: string;
        name: string;
        addressLine: string | null;    // one pre-joined line for the row
        pinStatus: "NONE" | "APPROVED";
      };
      previousOutcome: string | null;  // null until visit history exists → renders "First visit"
    }>;
  };
  noBeatReason: null;
}
```

**Response `200` — no route, and none can be created**
```ts
{ assignment: null, noBeatReason: "NO_BEAT_PLAN" | "NOT_A_WORKING_DAY" }
```

`NO_BEAT_PLAN` means the executive has no active beat plan assigned; `NOT_A_WORKING_DAY` means they have one but its working days exclude today. The two are distinguished because FR-008 requires the screen to say which — they call for different actions (ask an admin for a plan, versus enjoy the day off).

**Ordering**: `stops` arrives already ordered per FR-011 — to-do first, then revisit, then completed, with extra-sourced stops first inside each group and planned stops by `sequence`. The client renders the array as given; it does not re-sort (research.md §6).

**Deliberately absent**: `effectiveRadiusMeters`, and any distance, range-verdict or quality-flag field. Per Constitution rule 6 and research.md §5, the executive's payload must not let the device derive whether it is inside a shop's radius. This absence is a contract guarantee, not an oversight, and must survive later slices.

**Errors**:
- `FORBIDDEN_ROLE` (403) — the caller is not a Marketing Executive.

## `POST /assignments/:id/start` — Marketing Executive

Requires `Idempotency-Key`.

**Request**
```ts
{
  latitude: number;        // -90..90
  longitude: number;       // -180..180
  accuracyMeters: number;  // >= 0, integer — recorded, never blocking
  capturedAt: string;      // ISO-8601, the device's reading time
}
```

A location is **required** (FR-014). `accuracyMeters` is stored for the manager's later review and never rejects the request. `startedAt` is the **server's** clock, not `capturedAt`, so a wrong device clock cannot move a beat in time; `capturedAt` is kept as the device's claim for later quality checks.

**Response `200`**: the full assignment, same shape as `GET /assignments/today`'s `assignment`, now `state: "RUNNING"`.

Note `200`, not `201`: a repeated start is a legitimate, expected outcome rather than a creation.

**Behaviour**:
- Starting a day that is already `RUNNING` returns it unchanged with `200` — never an error, so a double tap or a timeout-retry is harmless (FR-021, Architecture §10). This holds **even with a different `Idempotency-Key`**, which the key alone would not guarantee.
- Starting a day that has already ended is a real error — the state machine has no such arrow.

**Errors**:
- `VALIDATION_FAILED` (400) — missing or out-of-range coordinates, negative accuracy, unparseable `capturedAt`.
- `NOT_FOUND` (404) — unknown id, another company's, or another executive's day.
- `BEAT_DAY_ENDED` (409) — the day is already ended and cannot be restarted.
- `IDEMPOTENCY_KEY_REUSED` (409).

## `POST /assignments/:id/end` — Marketing Executive

Requires `Idempotency-Key`. Same request body as start — coordinates, accuracy and capture time are recorded the same way (FR-019).

**Response `200`**: the full assignment, now `state: "ENDED"`, with `endedAt` set and the day's counts final.

**Behaviour**:
- Ending an already-`ENDED` day returns it unchanged with `200`.
- Ending a day that never started is a real error.
- Ending does **not** rewrite pending stops to skipped; "not visited" is counted at read time from stops still pending or skipped (data-model.md), so the record keeps what was actually true.
- Once ended, nothing further may change that day.

**Errors**: as start, plus
- `BEAT_NOT_STARTED` (409) — the day has not been started, so it cannot be ended.

## No other routes

This slice adds no route for recording a visit, adding an extra shop, capturing a shop pin, or a manager reading someone else's day. Each belongs to its own feature (spec.md, Scope boundaries).

## New error codes

Two additions to `packages/shared/src/errors.ts`, following the additive-only convention and the three-place pattern (`ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`):

| Code | HTTP | Meaning |
|---|---|---|
| `BEAT_DAY_ENDED` | 409 | An action was attempted on a day that is already closed. |
| `BEAT_NOT_STARTED` | 409 | The day must be started before it can be ended. |
