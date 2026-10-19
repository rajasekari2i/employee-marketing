# Phase 1 Data Model: Add Extra Shop — Executive

**Feature**: `007-extra-shops` | **Date**: 2026-10-19

## There is no migration

Every field this feature writes already exists. Slice 005 declared them with no writer, and recorded why in its own data model: *"only `PENDING` and `PLAN` have writers today"*, and of `addedByUserId` / `addedAt`, *"Who added an extra stop (FR-009). Null for planned stops."* That writer is this feature.

| Element | Where it already is | What changes |
|---|---|---|
| `StopSource.EXEC_EXTRA` | `schema.prisma:97` | First writer. |
| `AssignmentStop.addedByUserId` | `schema.prisma` | First writer. |
| `AssignmentStop.addedAt` | `schema.prisma` | First writer. |
| `AssignmentStop.@@unique([assignmentId, shopId])` | `schema.prisma:737` | First load-bearing use — becomes the duplicate guard. |
| `DailyAssignment.beatPlanId` (nullable) | `schema.prisma` | First row that actually stores `null`. |
| `AssignmentStop.effectiveRadiusMeters` | `schema.prisma` | Written by a second code path, identically to the first. |
| `AssignmentStop.shopLatitude` / `shopLongitude` | `schema.prisma` (added in 006) | Written by a third code path, identically. |
| `Shop.locationStatus = PENDING_VERIFICATION` | `schema.prisma:56` (added in 006) | Second producer — an executive-created shop, not only a captured pin. |

`AssignmentStop.addReason` appears in `03-ARCHITECTURE.md:585` but **not** in the repository schema; slice 005 omitted it deliberately. It is for manager-added extras, which are out of scope, so it stays omitted.

## Entity: the extra stop

An extra stop is an `AssignmentStop`. It differs from a planned one in three fields and in nothing else — this is the point of FR-014.

| Field | Value for an extra stop | Value for a planned stop |
|---|---|---|
| `source` | `EXEC_EXTRA` | `PLAN` |
| `addedByUserId` | the acting executive | `null` |
| `addedAt` | server clock at creation | `null` |
| `sequence` | `max(sequence on this assignment) + 1` | the beat plan's own sequence |
| `status` | `PENDING` | `PENDING` |
| `effectiveRadiusMeters` | `shop.verificationRadiusMeters ?? settings.defaultRadiusMeters` | identical rule |
| `shopLatitude` / `shopLongitude` | the shop's coordinates **only when `locationStatus === 'APPROVED'`**, else `null` | identical rule |

The last two rows are the ones that must not drift. `ensureTodayRoute` (`assignments.service.ts:284-307`) is the reference implementation; the add path applies the same rule to one shop instead of a plan's worth, and the fallback when no company settings row exists is the same `5`.

**Why `sequence` is an append, not a position**: `orderStops` sorts by status group, then extras ahead of planned, then `sequence`. `StopRow` renders `'EX'` instead of the number for any non-`PLAN` stop, so the value is never shown. Appending preserves the order extras were added in, which is the only ordering the executive could expect.

**Why the footer's "stop N" is not `sequence`**: board 1.4 reads *"Adding **Vasanth Super Mart** as stop 13 today."* That 13 is the size of the day after the add — `counts.total + 1` — not the `sequence` column. Conflating them would show a wrong number the moment any stop had been added before.

## Entity: the shop choice (a read projection)

What the picker returns per shop. **This shape is new, and deliberately not `ShopListItem`.**

| Field | Type | Source |
|---|---|---|
| `id` | string | `Shop.id` |
| `name` | string | `Shop.name` |
| `addressLine` | string \| null | `addressLine1` + `city`, joined — the same `addressLine` helper the assignment view uses |
| `pinStatus` | `'NONE' \| 'PENDING_VERIFICATION' \| 'APPROVED'` | `Shop.locationStatus` |
| `beatPlanName` | string \| null | the shop's beat-plan membership; `null` renders as the board's "No beat" chip |
| `distanceMeters` | number \| null | server-computed; `null` when the shop has no approved coordinates or the device sent no position |
| `distanceLabel` | string \| null | `"90 m"` / `"1.2 km"`, formatted server-side |

### What never appears in this shape

Listed by name so a later contributor can see the boundary rather than infer it:

- `latitude`, `longitude` — the device must never hold a shop coordinate. `ShopListItem` returns these and is documented *"Returned to the Company Admin only"*; that is the precise reason this projection exists instead of reusing it.
- `verificationRadiusMeters`, and the company's `defaultRadiusMeters` — with a coordinate and a radius the device could compute its own range verdict, which is the inference `assignments.service.ts:461-467` drops both fields to prevent.
- `geohash`, `locationCapturedBy`, `locationVerifiedBy`, `locationCapturedAt`, `locationVerifiedAt` — not needed by the board, and the last four name people and times the executive has no business seeing in a picker.
- Anything from `Visit` — no measured distance, no range verdict, no flag, no review status. FR-021.

## Validation rules

From the requirements, stated as the server enforces them.

| Rule | Where enforced | Failure |
|---|---|---|
| The assignment is the caller's own, for today | service, inside the transaction | `404 NOT_FOUND` — never "forbidden", which would confirm the row exists |
| The beat is `RUNNING` | service | `409 BEAT_NOT_STARTED` when `null`, `409 BEAT_DAY_ENDED` when `ENDED` |
| The shop belongs to the company and is active | service + RLS | `404 NOT_FOUND` |
| The shop is not already on today's list | **database** — `@@unique([assignmentId, shopId])` | `409 SHOP_ALREADY_IN_BEAT` (new code) |
| Exactly one of `shopId` / `newShop` is supplied | Zod, `.strict()` + refinement | `400 VALIDATION_FAILED` |
| No server-owned field in the body | Zod `.strict()` | `400 VALIDATION_FAILED` |
| A new shop's code is unique in the company | service, server-generated with retry | `409 DUPLICATE_SHOP_CODE` only if generation exhausts |

## State transitions

### The stop

```
(does not exist) ──add──> PENDING ──visit──> COMPLETED
```

Identical to a planned stop from `PENDING` onward — there is no extra-stop-specific transition, which is FR-014 expressed as a state machine. There is no transition out of `PENDING` back to non-existence: no remove route exists, by decision (spec, *Scope boundaries*).

### The day, with the plan-less change

```
                        ┌─ beat plan covers today ─> assignment WITH beatPlanId  ─┐
(no row) ─ GET today ──>┤                                                          ├─> NOT_STARTED ─start─> RUNNING ─end─> ENDED
                        └─ no plan / not a working day ─> assignment, beatPlanId NULL ─┘
                                                          ▲ NEW in this feature
```

Today the lower branch produces **no row at all** and a `noBeatReason`, so `start` — which takes an `assignmentId` — has nothing to act on and the day can never be started. This feature creates the row so it can be. `GET /assignments/today` keeps returning `noBeatReason` so the no-beat card's existing copy still explains *why* the day is empty; what changes is that the day is now startable and can hold extra stops.

### The executive-created shop

```
(does not exist) ──create──> locationStatus = PENDING_VERIFICATION ──admin approves──> APPROVED
                                              └─ or APPROVED directly when the company auto-approves
```

**Not** `ShopsService.create`'s transition, which goes straight to `APPROVED` with `locationVerifiedBy` set to the caller — justified there by the caller being a Company Admin. An executive is not, and FR-018 requires the shop be identifiable as awaiting confirmation. The company's auto-approve setting decides, exactly as it does for pin capture.

**The consequence is a dead-end and is recorded, not hidden**: with auto-approval off, the executive creates a shop, the stop is added with `shopLatitude`/`shopLongitude` left `null`, and no outcome can be recorded there until an admin approves. Same dead-end slice 006 flagged for pin capture, reached by a second route. The pilot company should have auto-approval enabled.
