# Contract: Shops

Base path `/api/v1/shops`. Company Admin only, tenant-scoped (the Prisma extension injects `companyId` from the request's CLS context on every operation — a Company Admin can never pass another company's id).

## `GET /shops` — Company Admin

**Query**: `?cursor=&limit=&search=&pinStatus=&isActive=`
- `search` matches name, shop code, owner name or phone (FR-003).
- `pinStatus` ∈ `ALL | NO_PIN` — maps to the design's "All"/"No pin" quick filters (`NO_PIN` ⇒ `locationStatus = NONE`).
- `isActive` ∈ `true | false` — maps to the design's "All"/"Inactive" quick filters.
- No `beatPlanId` param yet — the beat-plan filter is disabled client-side until `007-beat-plans` exists (research.md §1); the schema doesn't accept it so there's nothing to silently ignore.

**Response `200`**
```ts
{
  items: Array<{
    id: string;
    name: string;
    shopCode: string;
    ownerName: string | null;
    phone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    pinStatus: "NONE" | "APPROVED";
    latitude: number | null;           // null unless pinStatus is APPROVED — lets the edit form redraw the pin
    longitude: number | null;
    locationSource: "MAP_SEARCH" | "MANUAL_DRAG" | null;
    verificationRadiusMeters: number | null;   // null = using the company default
    isActive: boolean;
    beatPlanName: null;          // always null in this feature — see research.md §1
    photos: Array<{ id: string; url: string }>; // id = that ShopPhoto row's own id, needed by DELETE below
  }>;
  nextCursor: string | null;
}
```

## `POST /shops` — Company Admin

Requires `Idempotency-Key`.

**Request**
```ts
{
  shopCode: string;
  name: string;
  isActive?: boolean;              // default true
  ownerName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  verificationRadiusMeters?: number;  // positive int; omitted = company default
  location?: {                        // omitted entirely = "skip — the executive captures it" (FR-009)
    latitude: number;
    longitude: number;
    source: "MAP_SEARCH" | "MANUAL_DRAG";
  };
}
```

Server-side (never accepted from the client, per FR-008/FR-009 and CLAUDE.md rule 1): `id`, `companyId`, `locationStatus`, `locationCapturedAt/By`, `locationVerifiedAt/By`, `geohash`, `createdAt`, `updatedAt`.

**Response `201`**: the created shop, same shape as one `GET /shops` item.

**Errors**:
- `VALIDATION_FAILED` (400) — e.g. missing `name`/`shopCode`, malformed `location`.
- `DUPLICATE_SHOP_CODE` (409) — `shopCode` already used by another shop in this company (FR-008).
- `IDEMPOTENCY_KEY_REUSED` (409).

## `PATCH /shops/:id` — Company Admin

Requires `Idempotency-Key`. Same body shape as `POST /shops`, all fields optional; only provided fields change.

**Behavior**:
- Changing `shopCode` is re-validated for uniqueness the same way as create (FR-008).
- Setting `location` when the shop's current `locationStatus` is `NONE` is a direct capture (`locationStatus` becomes `APPROVED`, `*CapturedAt/By` and `*VerifiedAt/By` set to this request).
- Setting `location` when the shop's current `locationStatus` is already `APPROVED` **and** the new coordinates differ from the stored ones additionally writes one `ShopPinChange` row (`REQUESTED` and `DECIDED` in the same transaction, `requestedBy = decidedBy` = the caller) before applying the new coordinates (research.md §3, data-model.md state transitions).
- Setting `isActive: false` deactivates the shop; it is never deleted (FR-011). There is no `DELETE /shops/:id`.

**Response `200`**: the updated shop, same shape as one `GET /shops` item.

**Errors**: same as `POST /shops`, plus `NOT_FOUND` (404) for an unknown or another-company's `id`.

## `POST /shops/:id/photos` — Company Admin

Requires `Idempotency-Key`. `multipart/form-data`, same upload constraints as `POST /files/avatars` (magic-byte validation, size cap, metadata stripped). Rejected with `VALIDATION_FAILED` (400) if the shop already has 3 photos.

**Response `201`**: `{ id: string; url: string; sortOrder: number }` — one new `ShopPhoto`.

## `DELETE /shops/:id/photos/:photoId` — Company Admin

Removes one photo. **Response `204`**.
