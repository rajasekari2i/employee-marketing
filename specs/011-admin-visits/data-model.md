# Phase 1 Data Model: The Company Admin's Visits

**Feature**: `011-admin-visits` | **Date**: 2026-10-22

## The migration

**There isn't one.** This is the first slice to ship no schema change at all: no model, no column, no enum, no index, no RLS policy, no `TENANT_MODELS` entry.

That is not an omission to be fixed later. The feature shows a second role the records `010-manager-app` already created and reads them through the same queries. Everything below is therefore either a **read projection** — a shape assembled per request and stored nowhere — or an existing column that an existing command already wrote.

The consequence for Constitution rule 2 is spelled out in [plan.md](./plan.md): a slice with no new tenant table still has to answer *"does the new caller reach rows the old one could not?"*, and the answer is recorded there rather than skipped.

---

## Entity: the visits list row *(a read projection)*

One row of board 4.2. Identical to board 3.3's row — the same projection, from the same service, for the second role.

| Field | Type | Notes |
|---|---|---|
| `id` | string | the visit |
| `businessDate` | `YYYY-MM-DD` | the company's day, never the device's |
| `outcome` | `ORDER` \| `NO_ORDER` | the badge |
| `shopName` | string | |
| `executiveName` | string | who recorded it |
| `occurredAt` | ISO instant | rendered as the row's clock time |
| `summary` | string | e.g. `3 brands · 18 qty`, or the no-order reason |
| `deliveryStatus` | `TO_DELIVER` \| `DELIVERED` \| `null` | `null` for a no-order |
| `distanceMeters` | number | **visible to the admin** |
| `isExceedRange` | boolean | **visible to the admin** — drives the "· out" marker |

Alongside the items, the first page carries `counts` — `{ all, order, noOrder, outOfRange }` for the current filters **minus the tab** — and `nextCursor`.

**`distanceMeters` and `isExceedRange` are required here and forbidden on the executive's own history.** The two shapes are produced by two different services, and the rule is that neither may be refactored into the other. The admin joining the manager on this one does not change that: the executive is the role the rule is about, and they are not on this list.

## Entity: the visit detail *(a read projection)*

One shape serving boards 4.3, 4.4 and 4.5 — and their Manager twins 3.4, 3.5, 3.6. **The client picks the screen; the server is never told which** (spec FR-017).

| Group | Fields |
|---|---|
| Visit facts | `id`, `outcome`, `shopName`, `executiveName`, `beatPlanName`, `businessDate`, `occurredAt`, `sampleShown` |
| `order` *(or null)* | `orderId`, `lines[] { brandLabel, quantity }`, `totalQuantity`, `deliveryStatus`, `deliveredAt`, `deliveredByName` |
| `noOrder` *(or null)* | `reasonLabel`, `lastFiveReasons[]` — that shop's last five no-order reasons by anyone, newest first |
| `measurement` | `distanceMeters`, `isExceedRange`, `effectiveRadiusMeters`, `accuracyMeters`, `flags[]`, `submittedAt` |
| `location` | `shopLatitude`, `shopLongitude`, `capturedLatitude`, `capturedLongitude` |

**Every value in `measurement` and `location` is the one frozen onto the visit when it was recorded**, never the shop's current state (spec FR-018). Slice `006` snapshotted `shopLatitude`, `shopLongitude` and `effectiveRadiusMeters` onto the visit for exactly this, so a pin corrected afterwards never rewrites what a past visit was judged against.

`deliveredByName` is the only field in this shape whose *meaning* widens in this slice: it may now name a Company Admin as well as a Manager. Its type, source and storage are unchanged.

## The one column this feature writes

`Order.deliveryStatus`, `Order.deliveredAt`, `Order.deliveredBy` — all three added by `010` and all three written by the same command.

| Column | Written from | Changed by this slice |
|---|---|---|
| `deliveryStatus` | the service, to `DELIVERED` | no |
| `deliveredAt` | **the server's clock** | no |
| `deliveredBy` | **the verified JWT's user id** | no — only the *parameter's name* (`managerId` → `actorId`), because the value may now be either role |

Neither `deliveredAt` nor `deliveredBy` is accepted from a request body: the body is `z.object({}).strict()` and empty, so a client sending either gets a `400` rather than a silent strip (Constitution rule 1).

## Validation rules

| Rule | Where it is enforced |
|---|---|
| A Company Admin may read any visit **in their own company and no other** | the tenant Prisma extension's `companyId` scope + Postgres RLS — unchanged, and the same path the manager's requests take |
| A Company Admin may mark an order delivered | `@Roles('MANAGER', 'COMPANY_ADMIN')` on the route; the product's capability matrix grants `U` on "Order delivery status" |
| An executive may never receive `distanceMeters`, `isExceedRange` or a flag | a **separate route and separate service** (`GET /visits/mine`), untouched by this slice |
| An order may be marked delivered **once** | `409 ORDER_ALREADY_DELIVERED`, checked before the write |
| The delivery marker may never be overwritten | the same `409` — the refusal *is* the mechanism |
| Nothing about a visit may be changed | there is no route that writes one; this feature adds none |

## State transitions

### An order's delivery

```text
TO_DELIVER ──mark (Manager or Company Admin)──▶ DELIVERED ──▶ (terminal)
     │                                               │
     └──────────── second mark: 409 ─────────────────┘
```

Unchanged from `010` except for who may traverse the arrow. There is no un-deliver route, by decision.

**What the widening actually introduced** is the possibility of two roles racing the same order. It needed no new mechanism: a second marking was already a refusal rather than a silent success, chosen in `010` to protect the attribution, and that refusal is what arbitrates the race. The first marker wins and is never overwritten; the second is told plainly.

### A visit

No transitions. This feature reads visits and writes none of them.
