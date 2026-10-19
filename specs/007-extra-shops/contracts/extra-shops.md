# API Contract: Add Extra Shop — Executive

**Feature**: `007-extra-shops` | **Date**: 2026-10-19

Both paths are taken verbatim from `03-ARCHITECTURE.md:824-826`. All routes are under `/api/v1`. Schemas live in `packages/shared/src/extra-shops.schema.ts` and are wrapped with `createZodDto` in the controller (Constitution rule 5).

---

## `GET /shops/nearby`

The picker source for board 1.4. Executive only.

**Role**: `MARKETING_EXECUTIVE`. **Idempotency**: not a command; no key.

### Query

```ts
export const nearbyShopsQuerySchema = z
  .object({
    /** The assignment whose stops are excluded. Scoped to the caller's own day. */
    excludeAssignment: z.string().min(1),
    /** Omitted together when the device has no fix — the list then sorts by name. */
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    search: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be supplied together',
  });
```

`.strict()` matters here for the same reason it did in slice 006: a query carrying a field the server owns must be a `400`, not silently dropped.

### Response `200`

```jsonc
{
  "items": [
    {
      "id": "…",
      "name": "Vasanth Super Mart",
      "addressLine": "18, 3rd Avenue, Anna Nagar",
      "pinStatus": "APPROVED",          // NONE | PENDING_VERIFICATION | APPROVED
      "beatPlanName": "Anna Nagar South", // null → the board's "No beat" chip
      "distanceMeters": 90,              // null when the shop has no approved pin,
      "distanceLabel": "90 m"            //   or the device sent no position
    }
  ],
  "positionUsed": true   // false → the list is name-ordered; the screen hides distances
}
```

**Fields that must never appear in this response**: `latitude`, `longitude`, `verificationRadiusMeters`, `defaultRadiusMeters`, `geohash`, `locationCapturedBy`, `locationVerifiedBy`, and anything from `Visit`. See `data-model.md`, *What never appears in this shape*. This response is **not** `ShopListItem`, which returns raw coordinates and is documented Company-Admin-only.

### Ordering

1. Shops with approved coordinates, nearest first, by `haversineMetres`.
2. Shops without, by name.

With no `lat`/`lng`, everything falls to rule 2 and `positionUsed` is `false`.

### Filtering

- The caller's company (RLS + the Prisma extension), `isActive = true`.
- Every `shopId` already on `excludeAssignment` is excluded — FR-EXTRA-08, and what stops the picker being used to range-find a stop about to be visited.
- `excludeAssignment` must be the caller's own assignment: otherwise `404 NOT_FOUND`.
- **With no `search`**: a bounding box around `lat`/`lng`, applied only to rows that *have* coordinates, so pin-less shops are never dropped by a geometry they lack.
- **With `search`**: no bounding box — FR-006 must find a shop wherever it is. Matches `name`, `shopCode` and `ownerName`, case-insensitive, as `ShopsService.list` already does.

### Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | unknown query field, `lat` without `lng`, out-of-range values |
| 403 | `FORBIDDEN_ROLE` | not a Marketing Executive |
| 404 | `NOT_FOUND` | `excludeAssignment` is not the caller's own |

---

## `POST /assignments/:id/stops`

Adds one extra stop to the caller's own running day. Optionally creates the shop first.

**Role**: `MARKETING_EXECUTIVE`. **Idempotency**: `Idempotency-Key` **required** (`RequireIdempotencyKeyGuard`). **Audit**: `@Audited('extra-shop.create', 'AssignmentStop')`.

### Body

```ts
const newShopSchema = z
  .object({
    name: z.string().min(1).max(200),
    ownerName: z.string().min(1).max(200).optional(),
    phone: z.string().min(1).max(32).optional(),
    addressLine1: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(100).optional(),
    /** The executive's position, pre-filled by the form (FR-016). */
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyMeters: z.number().int().min(0),
    capturedAt: z.string().datetime(),
  })
  .strict();

export const addExtraStopSchema = z
  .object({
    shopId: z.string().min(1).optional(),
    newShop: newShopSchema.optional(),
    fromOfflineQueue: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.shopId === undefined) !== (v.newShop === undefined), {
    message: 'Supply exactly one of shopId or newShop',
  });
```

**`shopCode` is absent on purpose.** It is required and unique on `Shop`, but asking someone standing in front of a shop to invent a unique code is a bad field interaction and a collision waiting to happen. The server generates one and retries on collision; the Company Admin can rename it during review.

**Absent, and rejected if sent** (`.strict()` → `400`): `sequence`, `source`, `status`, `effectiveRadiusMeters`, `shopLatitude`, `shopLongitude`, `addedByUserId`, `addedAt`, `locationStatus`, `distanceMeters`. All server-owned (Constitution rule 1). Slice 006 found this exact hole live — `.strict()` is what closes it.

### Response `201`

```jsonc
{
  "stopId": "…",
  "shopId": "…",
  "shopName": "Vasanth Super Mart",
  "pinStatus": "APPROVED",     // drives where the executive goes next
  "totalStopsToday": 13        // the board's "as stop 13 today", AFTER the add
}
```

No distance, no radius, no flags — the same discipline as `POST /visits`, whose response is deliberately three fields.

`pinStatus` is returned because the screen must route onward: `APPROVED` → the visit screen, anything else → capture the pin first. That is the rule board 1.3's stop list already applies.

### Server-side sequence (one transaction)

Mirrors Architecture §10's shape, in this order:

1. `IdempotencyInterceptor` — key seen? replay the stored response and stop.
2. Validate the body (Zod, `.strict()`).
3. Load the assignment, tenant-scoped **and** `executiveId = caller`. Not found → `404`.
4. Reject unless `status === 'RUNNING'` → `409 BEAT_NOT_STARTED` / `409 BEAT_DAY_ENDED`.
5. **When `newShop`**: generate a `shopCode`, create the `Shop` with `locationStatus` per the company's auto-approve setting (`PENDING_VERIFICATION` by default), recording `locationSource = 'GPS'`, `locationAccuracyMeters`, `locationCapturedAt`, `locationCapturedBy`.
6. Load the shop; reject if inactive or another company's → `404`.
7. Resolve `effectiveRadiusMeters = shop.verificationRadiusMeters ?? settings.defaultRadiusMeters ?? 5`.
8. Freeze `shopLatitude` / `shopLongitude` — **only** when `locationStatus === 'APPROVED'`, else `null`.
9. `sequence = max(sequence on this assignment) + 1`.
10. Create the `AssignmentStop` with `source: 'EXEC_EXTRA'`, `status: 'PENDING'`, `addedByUserId`, `addedAt`.
11. `P2002` on `(assignmentId, shopId)` → `409 SHOP_ALREADY_IN_BEAT`.
12. Write the `AuditEvent`, store the idempotent response, commit.

Steps 5 and 10 are in the **same transaction** — FR-017. A shop created without its stop would be an orphan the executive never sees again.

### Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | unknown field, neither or both of `shopId`/`newShop`, bad coordinate |
| 403 | `FORBIDDEN_ROLE` | not a Marketing Executive |
| 404 | `NOT_FOUND` | assignment not the caller's own; shop missing, inactive, or another company's |
| 409 | `BEAT_NOT_STARTED` | the day exists but has not been started |
| 409 | `BEAT_DAY_ENDED` | the day is already ended |
| 409 | `SHOP_ALREADY_IN_BEAT` | **new code** — the shop is already on today's list |
| 409 | `DUPLICATE_SHOP_CODE` | only if server-side code generation exhausts its retries |
| 409 | `IDEMPOTENCY_KEY_REUSED` | same key, different body |

### New error code

Added in the three places `packages/shared/src/errors.ts` requires — `ERROR_CODES`, `ERROR_STATUS`, `ERROR_TITLES`:

```ts
SHOP_ALREADY_IN_BEAT: 'SHOP_ALREADY_IN_BEAT',   // 409, "Shop already in today's beat"
```

Named after the existing state-machine refusals (`STOP_ALREADY_COMPLETED`, `PIN_ALREADY_SET`, `BEAT_DAY_ENDED`), all 409.

---

## Changed behaviour: `GET /assignments/today`

Not a contract change — a behavioural one, called out because it alters what slice 005 shipped.

When no beat plan covers today, the endpoint currently returns `{ assignment: null, noBeatReason: 'NO_BEAT_PLAN' | 'NOT_A_WORKING_DAY' }` and creates no row, so the day can never be started and can hold no extra stops — while PRD FR-ASSIGN-10 promises the opposite.

It will now create a `DailyAssignment` with `beatPlanId: null`, `beatPlanName: null` and no stops, and **keep returning `noBeatReason`** so the no-beat card's existing copy still explains why the day is empty. The response shape is unchanged; `assignment` is simply no longer `null` in that case. The same `@@unique([companyId, businessDate, executiveId])` / `P2002` race handling applies.
