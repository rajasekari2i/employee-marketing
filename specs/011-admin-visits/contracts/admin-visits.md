# API Contract: The Company Admin's Visits

**Feature**: `011-admin-visits` | **Date**: 2026-10-22

**Three routes, none of them new.** Each was built by `010-manager-app`, each is marked **"Manager, Admin"** in `03-ARCHITECTURE.md:829-833`, and each was gated `@Roles('MANAGER')` in that slice with a note naming this one as where the second role arrives. This contract is the delivery of that note.

Request and response shapes are unchanged and are **not restated here** — they are in [`../../010-manager-app/contracts/manager-app.md`](../../010-manager-app/contracts/manager-app.md), and restating them would create a second copy to drift. What follows is only what this slice changes, and why each change is safe.

All routes are under `/api/v1`. Schemas live in `packages/shared/src/` and are wrapped with `createZodDto` in their controllers (Constitution rule 5). **No schema is added or altered.**

---

## The change, in full

```diff
- @Roles('MANAGER')
+ @Roles('MANAGER', 'COMPANY_ADMIN')
  @Get('visits')

- @Roles('MANAGER')
+ @Roles('MANAGER', 'COMPANY_ADMIN')
  @Get('visits/:id')

- @Roles('MANAGER')
+ @Roles('MANAGER', 'COMPANY_ADMIN')
  @Post('orders/:id/deliver')
```

```diff
- async markDelivered(companyId: string, managerId: string, orderId: string)
+ async markDelivered(companyId: string, actorId: string, orderId: string)
```

That is the entire server diff. The sections below are why it is three lines and not three hundred.

---

## `GET /visits`

Board 4.2, and board 3.3 — **one route, two roles, by design.**

`ManagerVisitsService.list` scopes by `companyId` and nothing else. There has never been a manager-level predicate in it: the manager's scope was decided in `010` to be the whole company, on the record, because no manager-to-executive relationship exists anywhere in the data model. So a Company Admin and a Manager are asking the **identical question of the identical rows**, and the two boards differ only in a subtitle and a bottom bar.

A second admin-only route would therefore have been the same query written twice, and two places for the company scope to be got wrong.

**Query, response, `counts` semantics and keyset paging: unchanged.** `outOfRange` remains a separate field from `outcome` rather than a third value of it, which is what lets the Out-of-range tab contain both orders and no-orders — and what makes the client-side routing rule below necessary.

**`distanceMeters` and `isExceedRange` remain required in this response**, and remain forbidden by name in `GET /visits/mine`'s. Adding `COMPANY_ADMIN` here does not weaken that separation: it is the *executive* the rule is about, and they are not on this route.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | neither a Manager nor a Company Admin |

---

## `GET /visits/:id`

Boards 4.3, 4.4 and 4.5 — and their Manager twins 3.4, 3.5, 3.6. **One route for six boards.**

**The client picks the screen; the server cannot know which.** An admin opening an out-of-range order from the Order tab sees board 4.3, and the same visit from the Out of range tab sees 4.5 (spec FR-017). The route returns what all three screens need and the client chooses — one round trip, and no mode parameter to get wrong.

**Response: unchanged.** `measurement` and `location` are still the values frozen onto the visit when it was recorded, never the shop's current state.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | neither a Manager nor a Company Admin |
| 404 | `NOT_FOUND` | unknown visit, **or another company's** |

### Route-order note, inherited and still load-bearing

`GET /visits/:id` must stay declared **after** `GET /visits/mine` in the controller. Nest matches routes in declaration order within a controller, so declared earlier this one swallows the executive's own history: `mine` resolves to this handler, fails its role gate, and returns `403`. That happened once, in `010`, and quickstart Scenario 10 caught it.

**This slice makes the symptom slightly less obvious, which is why it is repeated here.** The gate is now `MANAGER, COMPANY_ADMIN` rather than `MANAGER`, so the failure mode is unchanged for an executive but the comment that explains it names two roles. Scenario 7 of this feature's quickstart re-runs the check.

---

## `POST /orders/:id/deliver`

Board 4.3's action, and board 3.4's.

The admin board is titled "Order visit · **mark delivered**" and carries the button in both its states, and `02-PRD.md`'s capability matrix grants the Company Admin `U` on "Order delivery status" independently of the Manager. The admin therefore gets the action, not a read-only copy of the screen.

**Idempotency**: `Idempotency-Key` still required. **Audit**: `@Audited('order.delivered', 'Order')`, unchanged.

**Body: unchanged — `z.object({}).strict()`.** Empty, and strict. Who marked it is the JWT's and when is the server's clock, so a body carrying `deliveredBy` or `deliveredAt` is a `400`, not a silent strip. The role widening changes **who may call it**, never **what it will believe**.

### The parameter rename, and why it is in a contract document

`markDelivered`'s second parameter is renamed `managerId` → `actorId`. It is not cosmetic: the value is written to `Order.deliveredBy` and read back as the attribution rendered on boards 3.4 and 4.3, so with a second role calling it the old name was about to describe something false — an admin's delivery flowing through a parameter called `managerId`. The value's source is unchanged and is the point: the verified JWT, never the body.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | neither a Manager nor a Company Admin |
| 404 | `NOT_FOUND` | unknown order, or another company's |
| 409 | `ORDER_ALREADY_DELIVERED` | already delivered — **by either role** |

**The `409` is what makes the widening safe.** `010` chose a refusal over a silent success to protect the attribution: reporting success would tell this caller they marked something someone else actually marked. Two roles can now reach the same order, so that refusal is also what arbitrates an admin and a manager racing. The first marker wins and is never overwritten; the second is told plainly. **No new code was needed, and no new error code.**

---

## New error codes

**None.** `ORDER_ALREADY_DELIVERED` already exists, added by `010`.

---

## Not in this contract

- **`POST /visits/:id/review`** — adjudicating an exception. Marked **Manager** in the architecture's table and stays that way; the admin's range detail is read-only (spec FR-028).
- **`GET /reports/previous-day`** — marked "Manager, Admin", but no admin board shows it and no admin screen reaches it. A later feature.
- **`GET /attendance` · `POST /attendance`** — also marked "Manager, Admin". Out of scope here.
- **The date / executive / beat query parameters.** `GET /visits` accepts all three and board 4.2 shows chips for them; the screen implements none. An inherited gap in the **client**, recorded in the spec as a divergence — the contract is unchanged and already supports them.
- **Any un-deliver route.** Delivery remains one-way by decision.
