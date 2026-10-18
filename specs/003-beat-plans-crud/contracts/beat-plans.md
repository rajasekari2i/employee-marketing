# Contract: Beat Plans

Base path `/api/v1/beat-plans`. Company Admin only, tenant-scoped (the Prisma extension injects `companyId` from the request's CLS context on every operation — a Company Admin can never pass another company's id).

## `GET /beat-plans` — Company Admin

**Query**: `?cursor=&limit=&search=&assignment=&isActive=`
- `search` matches beat plan name or the assigned executive's name (FR-003).
- `assignment` ∈ `ALL | UNASSIGNED` — maps to the design's "All"/"Unassigned" quick filters (`UNASSIGNED` ⇒ `executiveId IS NULL`).
- `isActive` ∈ `true | false` — maps to the design's "All"/"Inactive" quick filters. Same `'true'|'false'` string-enum shape as `listShopsQuerySchema.isActive` (contracts/shops.md) — not `z.coerce.boolean()`, which was found live to silently invert `"false"` to `true`.

**Response `200`**
```ts
{
  items: Array<{
    id: string;
    name: string;
    code: string;
    executive: { id: string; name: string } | null;
    workingDays: number[];          // 1 = Mon … 7 = Sun, e.g. [1,2,3,4,5,6]
    isActive: boolean;
    shops: Array<{                  // in sequence order
      id: string;                   // the Shop's own id
      name: string;
      pinStatus: "NONE" | "APPROVED";
    }>;
  }>;
  nextCursor: string | null;
}
```

`shops.length` is the directory card's "N shops" count (FR-002) — no separate count field.

## `POST /beat-plans` — Company Admin

Requires `Idempotency-Key`.

**Request**
```ts
{
  code: string;
  name: string;
  isActive?: boolean;        // default true
  executiveId?: string;      // must resolve to an ACTIVE MARKETING_EXECUTIVE in this company
  workingDays?: number[];    // distinct ints 1-7; default []
  shopIds?: string[];        // ordered; each must resolve to a Shop in this company; default []
}
```

Server-side (never accepted from the client, per data-model.md's Validation rules): `id`, `companyId`, every `BeatPlanShop.sequence` (derived from `shopIds`' array position), `createdAt`, `updatedAt`.

**Response `201`**: the created beat plan, same shape as one `GET /beat-plans` item.

**Errors**:
- `VALIDATION_FAILED` (400) — e.g. missing `name`/`code`, an `executiveId` that doesn't resolve to an active Marketing Executive in this company, a `shopIds` entry that doesn't resolve to a shop in this company, a `workingDays` value outside `1`-`7`.
- `DUPLICATE_BEAT_PLAN_CODE` (409) — `code` already used by another plan in this company (FR-010).
- `IDEMPOTENCY_KEY_REUSED` (409).

## `PATCH /beat-plans/:id` — Company Admin

Requires `Idempotency-Key`. Same body shape as `POST /beat-plans`, all fields optional; only provided fields change. Omitting `shopIds` entirely leaves the plan's current shop list untouched; providing it (including an empty array) fully replaces the list (data-model.md's state-transition note).

**Behavior**:
- Changing `code` is re-validated for uniqueness the same way as create (FR-010).
- Setting `isActive: false` deactivates the plan; it is never deleted (FR-013). There is no `DELETE /beat-plans/:id`.

**Response `200`**: the updated beat plan, same shape as one `GET /beat-plans` item.

**Errors**: same as `POST /beat-plans`, plus `NOT_FOUND` (404) for an unknown or another-company's `id`.
