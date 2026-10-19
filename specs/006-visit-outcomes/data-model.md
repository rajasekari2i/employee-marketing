# Phase 1 Data Model: Visit Outcomes

Three new models, three new enums, two enum extensions, and one additive field pair on an existing model. Taken from Architecture §4 and trimmed to what this slice can reach — the posture the previous four slices used.

**Every multi-word column gets `@map("snake_case")`.**

## Enum additions to existing types

```prisma
enum LocationSource { MAP_SEARCH MANUAL_DRAG GPS }        // + GPS
enum LocationStatus { NONE APPROVED PENDING_VERIFICATION } // + PENDING_VERIFICATION
```

Both were deliberately omitted by `002-shops-crud`, whose own comment says the executive's first-visit pin-capture flow "can add them additively when it needs them". This is that flow: `GPS` is how an executive-captured pin is obtained, and `PENDING_VERIFICATION` is the state a captured pin sits in when the company does not auto-approve (FR-033).

## New enums

```prisma
enum VisitOutcome { ORDER NO_ORDER }
enum ReviewStatus { NOT_REQUIRED PENDING_REVIEW }
enum VisitFlag    { LOW_ACCURACY STALE_LOCATION MOCK_LOCATION_SUSPECTED OFFLINE_SUBMISSION EXCEED_RANGE }
```

`VisitFlag` declares its full set even though **`MOCK_LOCATION_SUSPECTED` has no producer** — the installed positioning library does not expose Android's mock-location signal (research.md §5). It is declared rather than omitted because the server's flag-evaluation code reads the whole set and the manager review feature will render it; the gap is recorded there and in plan.md, not hidden.

`ReviewStatus` omits the architecture's decided states (accepted / revisit-requested) — nothing here writes or reads them; the manager review feature adds them.

## Visit

One completed interaction at one shop on one day. **Immutable once written.**

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column — both isolation layers. |
| `assignmentId` | `String @map("assignment_id")` | The day it belongs to. |
| `stopId` | `String @map("stop_id")` | `@relation(...)` — one completed visit per stop. |
| `shopId` | `String @map("shop_id")` | Denormalised from the stop so shop history is one index away. |
| `executiveId` | `String @map("executive_id")` | Who recorded it. |
| `outcome` | `VisitOutcome` | |
| `sampleShown` | `Boolean @map("sample_shown")` | Required before an outcome (FR-005). |
| `reasonId` | `String? @map("reason_id")` | No-order only. |
| `reasonLabel` | `String? @map("reason_label")` | **Snapshot** — renaming a reason never rewrites history. |
| `reasonText` | `String? @map("reason_text")` | Required 3–280 chars when the reason is the system "Other". Already on the log redaction list. |
| `capturedLatitude` | `Decimal @db.Decimal(9, 6) @map("captured_latitude")` | Where the executive was. |
| `capturedLongitude` | `Decimal @db.Decimal(9, 6) @map("captured_longitude")` | |
| `accuracyMeters` | `Int @map("accuracy_meters")` | Recorded, never blocking. |
| `capturedAt` | `DateTime @map("captured_at")` | The device's claim. |
| `submittedAt` | `DateTime @map("submitted_at")` | The device's claim. |
| `receivedAt` | `DateTime @default(now()) @map("received_at")` | The **server's** clock — the authoritative time. |
| `shopLatitude` | `Decimal? @db.Decimal(9, 6) @map("shop_latitude")` | **Snapshot** of what was measured against (research.md §4). |
| `shopLongitude` | `Decimal? @db.Decimal(9, 6) @map("shop_longitude")` | |
| `effectiveRadiusMeters` | `Int @map("effective_radius_meters")` | **Snapshot**, copied from the stop. |
| `distanceMeters` | `Int @map("distance_meters")` | **Server-computed.** Never accepted from a client. |
| `isExceedRange` | `Boolean @map("is_exceed_range")` | **Server-computed.** |
| `flags` | `VisitFlag[]` | **Server-computed.** |
| `reviewStatus` | `ReviewStatus @default(NOT_REQUIRED) @map("review_status")` | `PENDING_REVIEW` when the range was exceeded. |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | |

**Indexes**: `@@unique([stopId])`, `@@index([companyId, shopId, receivedAt])`, `@@index([companyId, assignmentId])`, `@@index([companyId, reviewStatus])`. Mapped to `visits`.

`@@unique([stopId])` is load-bearing: it makes "exactly one outcome per stop" a database fact rather than a check that two concurrent submissions could both pass (FR-006, SC-005). A manager-granted revisit produces a **new stop**, so it gets its own visit without contending for this constraint.

### The seven fields that never reach an executive

`shopLatitude`, `shopLongitude`, `effectiveRadiusMeters`, `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus` are stored on every visit and are **never selected** by an executive-facing query (research.md §8). They exist for the manager review feature and the reports. The guarantee is the absence of these names from the executive endpoints' select lists — not a filter applied afterwards.

## Order

The commercial result of an order outcome. Exists only as part of its visit.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column. |
| `visitId` | `String @unique @map("visit_id")` | `@relation(..., onDelete: Cascade)`. One order per visit. |
| `shopId` | `String @map("shop_id")` | |
| `totalQuantity` | `Int @map("total_quantity")` | Server-derived from the lines — never client-sent. |
| `brandCount` | `Int @map("brand_count")` | Server-derived. |
| `deliveryStatus` | `DeliveryStatus @default(TO_DELIVER) @map("delivery_status")` | Written here, changed by the manager feature. |
| `lines` | `OrderLine[]` | |
| `createdAt` | `DateTime @default(now()) @map("created_at")` | |

```prisma
enum DeliveryStatus { TO_DELIVER DELIVERED }
```

**Indexes**: `@@index([companyId, shopId])`, `@@index([companyId, deliveryStatus])`. Mapped to `orders`.

`totalQuantity` and `brandCount` are stored rather than counted on read because they are what the manager's list and the reports sort and filter on; both are derived server-side from the submitted lines, so a client cannot assert a total that disagrees with its own lines.

## OrderLine

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | |
| `companyId` | `String @map("company_id")` | Tenant column. |
| `orderId` | `String @map("order_id")` | `@relation(..., onDelete: Cascade)`. |
| `brandId` | `String @map("brand_id")` | |
| `brandLabel` | `String @map("brand_label")` | **Snapshot** — Architecture §9's "snapshots everywhere". A brand renamed or retired later never rewrites a recorded order. |
| `quantity` | `Int` | Whole, ≥ 0. At least one line per order must exceed 0. |

**Indexes**: `@@unique([orderId, brandId])` — the database-level backstop for FR-012, so the same brand cannot appear twice on one order even under a retry. `@@index([companyId, brandId])`. Mapped to `order_lines`.

## Additive fields on AssignmentStop

```prisma
model AssignmentStop {
  // …unchanged…
  shopLatitude  Decimal? @db.Decimal(9, 6) @map("shop_latitude")
  shopLongitude Decimal? @db.Decimal(9, 6) @map("shop_longitude")
}
```

The frozen coordinate a visit at this stop is measured against (research.md §4). Populated when the route is created, from the shop's approved pin; populated again when an executive captures a missing pin, which is the only way a stop that started without coordinates gets them. Null means the shop has no approved location and no outcome can be recorded there yet.

This is what makes an offline visit synced days later measure against the location in force **when it was recorded**, not when it was received.

## Additive back-relations

```prisma
model Shop           { /* …unchanged… */ visits Visit[]  orders Order[] }
model AssignmentStop { /* …unchanged… */ visit  Visit? }
model ReasonMessage  { /* …unchanged… */ visits Visit[] }
model Brand          { /* …unchanged… */ orderLines OrderLine[] }
model User           { /* …unchanged… */ visits Visit[] }
```

`Brand.orderLines` and `ReasonMessage.visits` are the relations `004-brands-reasons-crud` deliberately deferred; its schema comments name this slice as the one that adds them.

## Held submission *(on the device, not in the database)*

Not a Prisma model — the queue described in research.md §1.

| Field | Notes |
|---|---|
| `id` | Local id, for removing one item from the queue. |
| `kind` | `VISIT` or `PIN` — a pin capture queues ahead of the visit that depends on it (FR-042). |
| `idempotencyKey` | **Minted when the executive submits**, reused on every attempt for the life of the item (research.md §3). This is what makes a retry safe. |
| `path` / `body` | The request to replay. The body carries the position captured at record time, never re-read at send time. |
| `recordedAt` | Orders the queue; FIFO. |
| `attempts` / `lastError` | For surfacing a permanently rejected item (FR-040) rather than retrying forever. |

## Validation rules

- `sampleShown`: required.
- Order: at least one line; every `quantity` a whole number ≥ 0; at least one line > 0; no duplicate `brandId`; every brand must be **active and in the caller's company** at submission time.
- No order: exactly one `reasonId`, **active and in the caller's company**; `reasonText` required 3–280 characters when that reason is the system "Other", and rejected when it is not.
- Position: `latitude` −90…90, `longitude` −180…180, `accuracyMeters` a whole number ≥ 0, `capturedAt`/`submittedAt` valid instants.
- **Server-only, never accepted from a client**: `distanceMeters`, `isExceedRange`, `flags`, `reviewStatus`, `effectiveRadiusMeters`, `shopLatitude`/`shopLongitude`, `receivedAt`, `totalQuantity`, `brandCount`, `brandLabel`, `reasonLabel`. None appears in any request schema, so sending one fails validation rather than being ignored (CLAUDE.md rule 1, FR-023).

## State transitions

**Visit**: created once, never updated by this feature. There is no edit path and no delete path — FR-016's warning that a submitted visit cannot be edited is enforced by there being no route that could.

**AssignmentStop.status**: `PENDING → COMPLETED`, in the same transaction that creates the visit. This is the first feature that writes a stop status at all.

**Shop.locationStatus**: `NONE → PENDING_VERIFICATION` or `NONE → APPROVED` on executive capture, per the company's auto-approve setting (FR-033). An executive can never move an already-`APPROVED` pin — only raise a correction request (FR-034).

**Order.deliveryStatus**: created `TO_DELIVER`; moving it to `DELIVERED` belongs to the manager feature.

## Server-computed classification, in order

Exactly PRD §9's sequence, all inside the submission transaction:

1. Reject invalid input, a foreign or non-running day, a stop that is not the caller's, an already-completed stop, a shop with no approved pin, or a replayed idempotency key.
2. `accuracyMeters > company.maxAccuracyMeters` → `LOW_ACCURACY`.
3. `receivedAt − capturedAt > company.maxLocationAgeSeconds` → `STALE_LOCATION`.
4. Mock location reported → `MOCK_LOCATION_SUSPECTED`. *(No producer — research.md §5.)*
5. Arrived from the device queue → `OFFLINE_SUBMISSION`.
6. Haversine distance from the **stop's frozen shop coordinate** → `distanceMeters`.
7. `effectiveRadiusMeters` ← the stop's frozen value.
8. `distanceMeters > effectiveRadiusMeters` → `EXCEED_RANGE` + `reviewStatus = PENDING_REVIEW`.
9. Persist every fact and flag. **Never recomputed or overwritten afterwards** (FR-026, SC-010).
