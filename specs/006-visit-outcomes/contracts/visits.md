# Contract: Visits, Stop Detail and Pin Capture

All routes under `/api/v1`. Marketing Executive only in this slice, tenant-scoped **and** additionally scoped to the caller's own executive id from the verified token — never from a parameter. Commands require an `Idempotency-Key`.

Architecture §7 already names `GET /stops/:id`, `POST /visits` and `POST /shops/:id/pin`.

> **The contract-level guarantee of this feature**: no response below contains `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, or the shop's stored coordinates. Those fields are written on every visit and read by the manager feature; the executive's queries never select them (research.md §8). This absence is a guarantee to preserve, not an omission to fix.

## `GET /stops/:id` — Marketing Executive

Backs the visit screen (board 1.7).

**Response `200`**
```ts
{
  stop: {
    id: string;
    sequence: number;                      // display is sequence + 1
    positionLabel: string;                 // "Stop 3 of 12"
    status: "PENDING" | "COMPLETED" | "SKIPPED" | "REVISIT";
    canRecordOutcome: boolean;             // false when the beat is not running,
                                           //   the stop is done, or the pin is missing
    blockedReason:                         // why, when canRecordOutcome is false
      | "BEAT_NOT_RUNNING" | "ALREADY_COMPLETED" | "PIN_MISSING" | "PIN_PENDING_APPROVAL" | null;
    shop: {
      id: string; shopCode: string; name: string;
      addressLine: string | null; ownerName: string | null; phone: string | null;
      pinStatus: "NONE" | "PENDING_VERIFICATION" | "APPROVED";
    };
    lastFive: Array<{                      // the SHOP's last five, by anyone
      visitedOn: string;                   // "YYYY-MM-DD"
      outcome: "ORDER" | "NO_ORDER";
      summary: string;                     // "3 brands · 46 qty" | the reason label
      recordedBy: string;
    }>;
  };
}
```

`lastFive` is the **shop's** history, not the caller's — the design shows who recorded each one, and the point is what this shop has been doing (spec Assumptions). Ordered newest first, at most five, fewer when fewer exist.

**Deliberately absent**: the shop's visit radius (FR-019) and the shop's coordinates. Neither is shown on board 1.7 as this feature builds it.

**Errors**: `NOT_FOUND` (404) — unknown, another company's, or another executive's stop.

## `POST /visits` — Marketing Executive

Requires `Idempotency-Key`. **The one command this whole feature exists for.**

**Request**
```ts
{
  stopId: string;
  sampleShown: boolean;
  outcome: "ORDER" | "NO_ORDER";

  // ORDER only — at least one line, no duplicate brandId, at least one quantity > 0
  lines?: Array<{ brandId: string; quantity: number }>;

  // NO_ORDER only
  reasonId?: string;
  reasonText?: string;                     // required 3-280 chars iff the reason is the system "Other"

  // Always required — the executive's own position
  latitude: number;                        // -90..90
  longitude: number;                       // -180..180
  accuracyMeters: number;                  // integer >= 0, recorded, never blocking
  capturedAt: string;                      // ISO-8601, the device's claim
  submittedAt: string;                     // ISO-8601, the device's claim
  isMockLocation?: boolean;                // absent today — no producer (research.md §5)
  fromOfflineQueue?: boolean;              // true when replayed from the device queue
}
```

**Never accepted** (CLAUDE.md rule 1, FR-023): `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, the shop's coordinates, `brandLabel`, `reasonLabel`, `totalQuantity`, `brandCount`. None is a key in the request schema, so sending one fails validation rather than being ignored.

`capturedAt`/`submittedAt` are the **device's claims**, stored for quality checks. The authoritative time is the server's `receivedAt`.

**Response `201`**
```ts
{ visitId: string; stopId: string; status: "COMPLETED" }
```

That is the whole response. **No distance, no range verdict, no flags** — FR-012's "no distance or range result is shown to them" starts with not sending it (PRD FR-VISIT-12).

**Behaviour** — all inside one transaction, in this order (research.md §7, data-model.md):
1. Replay check on the idempotency key — a repeat returns the stored response rather than recording twice.
2. Load the stop, its day and the shop, tenant- and executive-scoped.
3. Reject: beat not `RUNNING`, stop not the caller's, stop already completed, shop with no approved pin.
4. Validate brands/reasons are **active and in this company**.
5. Compute flags, measure distance from the stop's frozen shop coordinate, resolve the frozen radius, set the range flag and review status.
6. Create the visit and — for an order — its order and lines **together**.
7. Mark the stop `COMPLETED`.
8. Write the audit record. Commit.

**Errors**:
- `VALIDATION_FAILED` (400) — bad position; no lines or all zero; duplicate brand; missing or inactive brand/reason; "Other" without text of 3–280 chars; text supplied for a reason that is not "Other".
- `NOT_FOUND` (404) — unknown, another company's, or another executive's stop.
- `BEAT_NOT_STARTED` (409) — the day has not been started.
- `BEAT_DAY_ENDED` (409) — the day is closed; no visit can be added.
- `STOP_ALREADY_COMPLETED` (409) — an outcome is already recorded. A manager-granted revisit arrives as its own stop.
- `SHOP_PIN_REQUIRED` (409) — the shop has no approved location yet.
- `IDEMPOTENCY_KEY_REUSED` (409) — same key, different body.

## `POST /shops/:id/pin` — Marketing Executive

Requires `Idempotency-Key`. Backs board 1.8. First capture only.

**Request**
```ts
{
  latitude: number; longitude: number;
  accuracyMeters: number;                  // integer >= 0
  source: "GPS" | "MAP_SEARCH" | "MANUAL_DRAG";
  capturedAt: string;
}
```

**Response `201`**
```ts
{ shopId: string; pinStatus: "APPROVED" | "PENDING_VERIFICATION"; canRecordOutcome: boolean }
```

**Behaviour**:
- Rejected when `accuracyMeters > company.maxAccuracyMeters` — this is the one place accuracy **does** block, because a bad pin poisons every future visit measured against it (FR-031). Everywhere else accuracy is recorded, never blocking.
- Records the point, accuracy, source, capture time and capturing user.
- Sets `locationStatus` to `APPROVED` or `PENDING_VERIFICATION` per the company's `autoApproveExecPins` setting (FR-033). `canRecordOutcome` tells the app whether to continue to the visit screen or explain that approval is needed.
- Also writes the coordinate onto today's stop for this shop as its frozen measurement snapshot (research.md §4).
- **Refused outright when the shop already has an `APPROVED` pin** — an executive cannot move a saved pin (FR-034); they raise a correction request instead.

**Errors**: `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `PIN_ACCURACY_TOO_LOW` (409), `PIN_ALREADY_SET` (409), `IDEMPOTENCY_KEY_REUSED` (409).

## `GET /brands` and `GET /reasons` — widened to the Marketing Executive

Both already exist for the Company Admin. This slice adds the executive, who receives **active entries only**, in display order; reasons keep the system "Other" last. The admin's response is unchanged and still includes inactive entries.

Filtering server-side is the rule, not a convenience: the UI must not be able to offer a retired brand or reason (FR-008, FR-013), and submission rejects them regardless.

## New error codes

Added to `packages/shared/src/errors.ts` following the additive-only convention:

| Code | HTTP | Meaning |
|---|---|---|
| `STOP_ALREADY_COMPLETED` | 409 | An outcome is already recorded for this stop. |
| `SHOP_PIN_REQUIRED` | 409 | The shop has no approved location yet. |
| `PIN_ACCURACY_TOO_LOW` | 409 | The reading is worse than the company's maximum. |
| `PIN_ALREADY_SET` | 409 | The shop already has an approved pin; raise a correction instead. |

`BEAT_NOT_STARTED` and `BEAT_DAY_ENDED` already exist from the previous slice and are reused unchanged.
