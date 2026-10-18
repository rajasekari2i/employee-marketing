# Phase 1 Data Model: Shops CRUD (Company Admin)

New Prisma models and enums this feature adds to `apps/api/prisma/schema.prisma`, scoped to exactly what the shop directory/form need (full definitions already exist in Architecture §4 at lines 443–514 — this is that same shape, trimmed to what's buildable before `BeatPlan` exists).

## Enums

```prisma
enum LocationSource {
  MAP_SEARCH
  MANUAL_DRAG
}

enum LocationStatus {
  NONE
  APPROVED
}

enum PinChangeStatus {
  REQUESTED
  DECIDED
}
```

- `LocationSource`/`LocationStatus` are trimmed from the architecture's full enum set: `PENDING` (awaiting a separate approval step) and the executive-only `GPS` source aren't reachable from this feature — an Admin-set pin goes straight from `NONE` to `APPROVED` (research.md §3). The executive's own first-visit capture flow (screen 1.8, a later slice) is expected to need the fuller set and can add those variants additively when it's built.
- `PinChangeStatus` only needs `REQUESTED`→`DECIDED` for this feature's self-decided admin corrections; a `REJECTED` variant isn't reachable here and is left for whichever slice first needs a non-self-decided review.
- `PhotoKind` (existing enum) gets one new value: `SHOP_PHOTO`.

## Shop

Company-scoped master record for one outlet.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String` | Tenant column — Layer 1 (Prisma extension) + Layer 2 (RLS), per CLAUDE.md rule 2. |
| `shopCode` | `String` | **Unique with `companyId`** (`@@unique([companyId, shopCode])`) — FR-008. |
| `name` | `String` | Required. |
| `ownerName` | `String?` | |
| `phone` | `String?` | |
| `addressLine1` / `addressLine2` / `city` / `state` / `postalCode` | `String?` | |
| `latitude` / `longitude` | `Decimal? @db.Decimal(9, 6)` | Null until a pin is set — FR-009. Never accepted from the client as "approved" directly; see Validation Rules. |
| `locationSource` | `LocationSource?` | Set together with lat/lng. |
| `locationStatus` | `LocationStatus @default(NONE)` | Server-computed; client cannot set this field at all (schema omits it from input). |
| `locationCapturedAt` / `locationCapturedBy` | `DateTime?` / `String?` | Server-set to "now" / the caller's id on every coordinate write. |
| `locationVerifiedAt` / `locationVerifiedBy` | `DateTime?` / `String?` | Equal to captured-at/-by for an Admin-set pin (self-decided, research.md §3). |
| `geohash` | `String?` | Server-computed from lat/lng, for the future `nearby` query (architecture §4's bounding-box/geohash indexes); not user-facing in this feature. |
| `verificationRadiusMeters` | `Int?` | The per-shop radius override (FR-007); `null` = company default. |
| `isActive` | `Boolean @default(true)` | Deactivate-not-delete — FR-011. |
| `photos` | `ShopPhoto[]` | |
| `pinChanges` | `ShopPinChange[]` | |
| `createdAt` / `updatedAt` | `DateTime` | |

Indexes: `@@unique([companyId, shopCode])`, `@@index([companyId, isActive])`, `@@index([companyId, locationStatus])`.

*Deliberately omitted for this feature* (vs. the full architecture model): `beatPlanShops` relation (no `BeatPlan` yet — research.md §1), `stops`/`AssignmentStop` relation, `createdByRole`/`needsReview` (exec-created shops aren't a path this feature builds), `formattedAddress`/`placeId` (no Places Autocomplete result-caching in this pass — the search box issues a live Geocoding/Places call each time, per research.md §2).

## ShopPhoto

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String` | Tenant column. |
| `shopId` | `String` | `@relation(fields: [shopId], references: [id], onDelete: Cascade)` |
| `fileId` | `String` | `@relation(fields: [fileId], references: [id])` → existing `FileObject`, `kind: SHOP_PHOTO`. |
| `sortOrder` | `Int @default(0)` | Display order; also the basis for the "up to 3" cap (FR-007) — enforced in `shops.service.ts`, not the schema. |
| `createdAt` | `DateTime` | |

Index: `@@index([companyId, shopId, sortOrder])`.

## ShopPinChange

Append-only audit row for any coordinate change on an already-`APPROVED` shop (research.md §3; BUS-17).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String` | |
| `shopId` | `String` | `@relation(fields: [shopId], references: [id])` |
| `status` | `PinChangeStatus @default(REQUESTED)` | Set to `DECIDED` in the same write for this feature's self-decided flow. |
| `fromLatitude` / `fromLongitude` | `Decimal? @db.Decimal(9, 6)` | The shop's coordinates *before* this change; null only if somehow still `NONE` (shouldn't happen — a correction implies a prior `APPROVED` pin). |
| `toLatitude` / `toLongitude` | `Decimal @db.Decimal(9, 6)` | The new coordinates being applied. |
| `source` | `LocationSource` | How the new pin was captured. |
| `requestedBy` / `requestedAt` | `String` / `DateTime` | The admin making the edit. |
| `decidedBy` / `decidedAt` | `String?` / `DateTime?` | Same admin, same moment, for this feature's self-decided case. |

Index: `@@index([companyId, shopId, status])`.

## Validation rules (enforced in `shops.schema.ts` / `shops.service.ts`)

- `shopCode`: required, unique per company (case-sensitive match on the stored value — same collation behavior as `username` elsewhere unless the DB column says otherwise); a duplicate on create or edit is rejected with `AppError('DUPLICATE_SHOP_CODE', ...)`, never a silent overwrite (FR-008).
- `name`: required, non-empty.
- `latitude`/`longitude`/`locationSource`/`locationStatus`/`geohash`/`*CapturedAt`/`*CapturedBy`/`*VerifiedAt`/`*VerifiedBy`: **never accepted as input** — the create/update Zod schemas don't have these fields at all; the only client-facing location input is `{ latitude, longitude, source }` for *setting* a pin, which the service turns into the server-computed fields (CLAUDE.md rule 1 — a client-sent `locationStatus: 'APPROVED'` has nowhere to go, it's rejected by schema shape, not application logic).
- `verificationRadiusMeters`: optional positive integer; omitted/`null` means "use the company default."
- Photos: at most 3 per shop; adding a 4th is rejected before any upload happens.
- `beatPlanId`: accepted by the schema as `z.undefined()` only for forward-compatibility of the wire shape — the field exists in the UI but is disabled, so no value is ever actually sent (research.md §1).

## State transitions

**`Shop.isActive`**: `true ⇄ false` via `PATCH /shops/:id`. No delete path exists at any point (research.md §5).

**`Shop.locationStatus`**:
```
NONE --(admin sets lat/lng via map search or drag)--> APPROVED   [direct capture, no ShopPinChange row]
APPROVED --(admin edits lat/lng again)--> APPROVED                [ShopPinChange row written in the same transaction]
```
There is no `APPROVED → NONE` transition in this feature — clearing a pin entirely isn't a scenario in spec.md and isn't built.
