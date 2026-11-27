# Contract: Shops

Base path `/api/v1/shops`. Company Admin only, tenant-scoped (the Prisma extension injects `companyId` from the request's CLS context on every operation — a Company Admin can never pass another company's id).

## `GET /shops` — Company Admin

**Query**: `?cursor=&limit=&search=&pinStatus=&isActive=`
- `search` matches name, shop code, owner name or phone (FR-003).
- `pinStatus` ∈ `ALL | NO_PIN` — maps to the design's "All"/"No pin" quick filters (`NO_PIN` ⇒ `locationStatus = NONE`).
- `isActive` ∈ `true | false` — maps to the design's "All"/"Inactive" quick filters.
- `limit` defaults to 20 (the directory's page size), max 100.
- `cursor` is the previous page's `nextCursor` — the id of its last row.
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
    photos: Array<{
      id: string;          // that ShopPhoto row's own id, needed by DELETE below
      url: string;         // ?thumb=1 — the list card pill and the 64px strip
      fullUrl: string;     // full size — the photo sheet's pager and the full-screen viewer
      createdAt: string;   // ISO — the viewer's "Added <date>" caption
    }>;
  }>;
  nextCursor: string | null;   // null on the last page; see Pagination below
  total: number;               // shops matching THESE filters, server-counted
  noPinTotal: number;          // company-wide shops with no pin, filter-independent
}
```

### Pagination

Cursor-based, newest first: `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`.
`id` is the tiebreaker and is what makes the cursor deterministic — two shops
created in the same millisecond could otherwise swap places between pages,
duplicating one row and skipping another.

The server reads `limit + 1` rows and returns at most `limit`; the extra row
is what sets `nextCursor`. A `nextCursor` is therefore returned only when
another page genuinely exists — a list whose size is an exact multiple of
`limit` does not hand back a cursor that fetches nothing.

The Shops directory consumes this as infinite scroll: the first page loads
on focus, and reaching the end of the list fetches the next page with the
previous `nextCursor` and appends it, until `nextCursor` is `null`.

`total` and `noPinTotal` are server-side `count()` queries, both tenant-scoped
through the same two layers as the row query (the Prisma extension's `count`
op and Postgres RLS). They exist because both the directory header and the
Home screen's Shops tile previously counted a `?limit=100` fetch client-side,
and so reported exactly 100 for any company with more than 100 shops.
`total` respects the current filters; `noPinTotal` deliberately does not,
because it labels a filter the admin has not applied yet.

## `POST /shops` — Company Admin

Requires `Idempotency-Key`.

**Request**
```ts
{
  shopCode: string;
  name: string;
  isActive?: boolean;              // default true
  ownerName?: string;                 // letters, spaces, . ' - only
  phone?: string;                     // exactly 10 digits, first 6-9
  addressLine1?: string;
  addressLine2?: string;
  city?: string;                      // letters, spaces, . ' - & only
  state?: string;                     // letters, spaces, . ' - & only
  postalCode?: string;                // 6 digits, first 1-9; "600 001" accepted, stored "600001"
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
- `VALIDATION_FAILED` (400) — e.g. missing `name`/`shopCode`, malformed `location`, or any of the field formats below. The `errors[]` array carries one `{ path, message }` per bad field; the mobile form renders each `message` under its own input.
- `DUPLICATE_SHOP_CODE` (409) — `shopCode` already used by another shop in this company (FR-008).
- `IDEMPOTENCY_KEY_REUSED` (409).

### Field formats

Defined once in `packages/shared/src/field-formats.ts` and applied by both
`createShopSchema`/`updateShopSchema` here and `addExtraStopSchema`'s
`newShop` (`contracts/extra-shops.md`), so a shop created from the field
obeys the same rules as one typed by the Company Admin.

| Field | Rule | Message on failure |
| --- | --- | --- |
| `ownerName` | `^[A-Za-z][A-Za-z .'-]*$` — no digits, no other symbols. `.`/`'`/`-` allowed for initials and names like "K. Ramasamy", "D'Souza". | Numbers and special characters are not allowed. |
| `phone` | `^[6-9][0-9]{9}$` — exactly 10 digits, no `+91`, no leading 0, no spaces/brackets/letters. | Enter a 10-digit Indian phone number starting with 6, 7, 8 or 9. |
| `city`, `state` | `^[A-Za-z][A-Za-z .'&-]*$` — as `ownerName` plus `&`, for "Jammu & Kashmir". | Numbers and special characters are not allowed. |
| `postalCode` | `^[1-9][0-9]{2}\s?[0-9]{3}$` — 6 digits, leading 0 invalid, one optional space after the third digit. **Normalised**: the space is stripped, so "600 001" is stored as "600001". | Enter a valid 6-digit PIN code starting with 1-9. |
| `verificationRadiusMeters` | Positive integer. A non-numeric value is rejected rather than coerced. | Visit radius must be a whole number of metres. |

`addressLine1`/`addressLine2` are deliberately free text — a street address
legitimately contains digits, `/`, `,` and `-`.

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
