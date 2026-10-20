# API Contract: The Manager App

**Feature**: `010-manager-app` | **Date**: 2026-10-20

Six routes. Every path is taken verbatim from `03-ARCHITECTURE.md:828-836`. All routes are under `/api/v1`. Schemas live in `packages/shared/src/` and are wrapped with `createZodDto` in their controllers (Constitution rule 5).

All six are `@Roles('MANAGER')` in this slice. The architecture marks several "Manager, Admin"; the Company Admin's mirror screens (4.2–4.5) are a later feature and the role is added then.

---

## `GET /reports/previous-day`

Board 3.1. Joins the `reports` module slice 009 created.

**Idempotency**: not a command. **Audit**: none.

### Query

```ts
export const previousDayQuerySchema = z
  .object({
    /** Company-local business date. Absent = the PREVIOUS business day (FR-005). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    executiveId: z.string().min(1).optional(),
    beatPlanId: z.string().min(1).optional(),
  })
  .strict();
```

**`date` is accepted here, unlike slice 009's totals** — and the difference is deliberate. Board 3.1 has a date control and a manager genuinely needs to look back at an arbitrary day; board 1.6 had three fixed periods, so letting a device compute "this week" would have been a second conversion point. A single explicit date is not a period calculation: the server still resolves "the previous business day" when none is given, and still interprets the value in the company's timezone.

### Response `200`

```jsonc
{
  "period": { "businessDate": "2026-09-28", "label": "Mon, 28 Sep" },
  "counts": { "assigned": 186, "visited": 171, "pending": 15,
              "order": 112, "noOrder": 59, "outOfRange": 22 },
  "range":  { "within": 149, "exceeded": 22, "notVisited": 15, "withinPercent": 87 },
  "outOfRangeVisits": [
    { "visitId": "…", "shopName": "…", "executiveName": "…",
      "flag": "EXCEED_RANGE", "distanceMeters": 112 }
  ],
  "executives": [
    { "executiveId": "…", "name": "Priya S", "beatPlanName": "Anna Nagar North",
      "startedAt": "…", "endedAt": "…", "dayState": "ENDED" }
  ]
}
```

`within + exceeded + notVisited === counts.assigned`, by construction (SC-005).

`dayState` is `NOT_STARTED | RUNNING | ENDED | AUTO_CLOSED`. **`AUTO_CLOSED` has no writer yet** — the nightly job is unbuilt — so the field is correct and simply never carries that value today.

---

## `GET /visits`

Board 3.3. Manager's list — **a different route from `GET /visits/mine`, by design.**

### Query

```ts
export const managerVisitsQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Board 3.3's four tabs. `outcome` and `outOfRange` are ORTHOGONAL. */
    outcome: z.enum(['ORDER', 'NO_ORDER']).optional(),
    outOfRange: z.coerce.boolean().optional(),
    executiveId: z.string().min(1).optional(),
    beatPlanId: z.string().min(1).optional(),
  })
  .strict();
```

**`outOfRange` is a separate field from `outcome`, not a third value of it** (research.md §4). Board 3.3's own script filters `cur === 'out' ? v.out : v.kind === cur` — `out` is a boolean beside `kind`. The Out-of-range tab therefore contains both orders and no-orders, which is what makes FR-029 necessary.

### Response `200`

```jsonc
{
  "items": [
    { "id": "…", "businessDate": "2026-09-28", "outcome": "ORDER",
      "shopName": "Thangam Stores", "executiveName": "Vignesh P",
      "occurredAt": "…", "summary": "3 brands · 18 qty",
      "deliveryStatus": "TO_DELIVER",
      "distanceMeters": 11, "isExceedRange": false }
  ],
  "counts": { "all": 171, "order": 112, "noOrder": 59, "outOfRange": 22 },
  "nextCursor": "…"
}
```

**`distanceMeters` and `isExceedRange` are REQUIRED here** — board 3.3's distance column, its "· out" marker and its Out-of-range tab have no other source. Slice 008's `GET /visits/mine` lists both as forbidden by name. **The two shapes are produced by two different services and neither may be refactored into the other** (research.md §3).

`counts` is returned on the first page only, and describes the current filters minus the tab — the same rule slice 008 established.

### Paging

Keyset on `(businessDate, submittedAt, id)`, `cursor` + `skip: 1`, exactly as `my-visits.service.ts` and `shops.service.ts` do. Not `OFFSET`: a visit recorded between two fetches would otherwise shift every later row and re-serve one (FR-018).

---

## `GET /visits/:id`

Boards 3.4, 3.5 and 3.6 — **one route for all three.**

**The client picks the screen; the server does not.** A manager opening an out-of-range order from the Order tab sees 3.4, and the same visit from the Out-of-range tab sees 3.6 (FR-029). The server cannot know which, so it returns what all three need and the client chooses. One round trip, and no mode parameter to get wrong.

### Response `200`

```jsonc
{
  "id": "…", "outcome": "ORDER",
  "shopName": "Thangam Stores", "executiveName": "Vignesh P",
  "beatPlanName": "Kilpauk East",
  "businessDate": "2026-09-28", "occurredAt": "…", "sampleShown": true,

  "order": { "orderId": "…",
             "lines": [ { "brandLabel": "…", "quantity": 6 } ],
             "totalQuantity": 18, "deliveryStatus": "TO_DELIVER",
             "deliveredAt": null, "deliveredByName": null },
  "noOrder": null,

  "measurement": { "distanceMeters": 11, "isExceedRange": false,
                   "effectiveRadiusMeters": 25, "accuracyMeters": 8,
                   "flags": [], "submittedAt": "…" },
  "location": { "shopLatitude": 13.0851, "shopLongitude": 80.2102,
                "capturedLatitude": 13.0852, "capturedLongitude": 80.2103 }
}
```

`order.orderId` is returned because `POST /orders/:id/deliver` is addressed by the **order** while this route is addressed by the **visit** — and an order is reachable only through its visit (`Order.visitId` is unique), so the client cannot derive one from the other. *(Added during implementation.)*

For a no-order, `order` is null and `noOrder` carries `reasonLabel` plus `lastFiveReasons[]` — that shop's last five no-order reasons by anyone, newest first (FR-026).

**Every value in `measurement` and `location` is the one frozen on the visit**, never the shop's current state (FR-030). Slice 006 snapshotted `shopLatitude`, `shopLongitude` and `effectiveRadiusMeters` onto the visit for exactly this.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | not a Manager |
| 404 | `NOT_FOUND` | unknown visit, or another company's |

---

## `POST /orders/:id/deliver`

Board 3.4's action.

**Idempotency**: `Idempotency-Key` **required**. **Audit**: `@Audited('order.delivered', 'Order')` — `order_marked_delivered` is in the PRD's own analytics list.

### Body

```ts
export const markDeliveredSchema = z.object({}).strict();
```

**Empty, and `.strict()`.** Who marked it is the JWT's; when is the server's clock. A body carrying `deliveredBy` or `deliveredAt` is a `400`, not a silent strip — the same discipline as every prior command.

### Response `200`

```jsonc
{ "orderId": "…", "deliveryStatus": "DELIVERED",
  "deliveredAt": "…", "deliveredByName": "Lavanya K" }
```

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | not a Manager |
| 404 | `NOT_FOUND` | unknown order, or another company's |
| 409 | `ORDER_ALREADY_DELIVERED` | **new code** — already delivered, possibly by someone else a moment ago |

`409` rather than a silent success: reporting success would tell this manager they marked something another manager actually marked, and overwrite the attribution FR-023 exists to record (FR-024, SC-008).

---

## `GET /attendance`

Board 3.7.

### Query

```ts
export const attendanceDayQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();
```

### Response `200`

```jsonc
{
  "businessDate": "2026-09-29", "isToday": true, "isFuture": false,
  "counts": { "present": 38, "late": 6, "absentOrLeave": 3, "notMarked": 7 },
  "people": [
    { "userId": "…", "name": "Karthik R", "roleLabel": "Marketing Executive",
      "morning": { "status": "PRESENT", "actualTime": "…",
                   "latenessFlag": "DELAY_1H", "recordedByName": "Lavanya K",
                   "recordedAt": "…", "version": 2 },
      "evening": null }
  ]
}
```

`isFuture` drives FR-032's edit lock on the client; the server refuses the write regardless.

A session with no record is `null` and renders as "not marked" — never omitted, because the sheet is a grid.

The roster is **every active member of staff except the System Admin** (FR-040), so a manager appears on their own sheet (FR-040a).

---

## `POST /attendance`

Board 3.8. An upsert to the caller; **an insert to the database.**

**Idempotency**: `Idempotency-Key` required. **Audit**: `@Audited('attendance.record', 'Attendance')` — the PRD's list has both `attendance_submitted` and `attendance_amended`.

### Body

```ts
export const recordAttendanceSchema = z
  .object({
    userId: z.string().min(1),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    session: z.enum(['MORNING', 'EVENING']),
    status: z.enum(['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF']),
    /** Required when PRESENT, forbidden otherwise. */
    actualTime: z.string().datetime().optional(),
    /** Required when amending; the SERVER decides which case this is. */
    changeReason: z.string().trim().min(3).max(280).optional(),
  })
  .strict()
  .refine((v) => (v.status === 'PRESENT') === (v.actualTime !== undefined), {
    message: 'actualTime is required for PRESENT and not allowed otherwise',
  });
```

**Absent, and rejected if sent** (`.strict()` → `400`): `latenessFlag`, `payableUnits`, `version`, `isActive`, `recordedBy`, `recordedAt`, `supersededById`.

**`latenessFlag` and `payableUnits` are the ones that matter.** Lateness is a judgement the company's settings make, not a fact a device observes — the same reasoning that keeps `distanceMeters` out of `POST /visits`. The server derives it from `actualTime` against `morningSessionStart` / `eveningSessionStart` with `delay1hMinutes` / `delay2hMinutes`, all of which already exist on `CompanySettings` (FR-035, SC-010).

**`changeReason` is required only on an amendment.** The client does not declare which case it is; the server knows from whether an active row exists. Requiring a reason to record a plain Present would be noise (research.md §7).

### Server-side sequence (one transaction)

1. Idempotency check — key seen? replay and stop.
2. Validate (Zod, `.strict()` + the refinement).
3. Reject a **future** business date → `409 ATTENDANCE_DATE_IN_FUTURE`.
4. Load the active row for `(userId, businessDate, session)`, tenant-scoped.
5. If one exists and `changeReason` is absent → `400`.
6. Derive `latenessFlag` from the company's settings; derive `payableUnits` from `payableUnitByStatus`.
7. Insert the new row at `version = (existing?.version ?? 0) + 1`.
8. If a row existed, set its `isActive = false` and its `supersededById`.
9. `P2002` on the version key → `409 ATTENDANCE_VERSION_CONFLICT`.
10. Audit, store the idempotent response, commit.

Steps 7 and 8 are **one transaction**: two active rows for one session, or none, would both be corrupt.

### Response `201`

```jsonc
{ "userId": "…", "businessDate": "2026-09-29", "session": "MORNING",
  "status": "PRESENT", "actualTime": "…", "latenessFlag": "DELAY_1H",
  "version": 2, "supersededVersion": 1 }
```

### Errors

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | unknown field, `PRESENT` without a time, an amendment without a reason |
| 403 | `FORBIDDEN_ROLE` | not a Manager |
| 404 | `NOT_FOUND` | the person is not in this company, or is not on the roster |
| 409 | `ATTENDANCE_DATE_IN_FUTURE` | **new code** |
| 409 | `ATTENDANCE_VERSION_CONFLICT` | **new code** — another manager amended the same session first |
| 409 | `IDEMPOTENCY_KEY_REUSED` | same key, different body |

---

## `GET /assignments?date=&executiveId=`

Board 3.2, and the route that makes it addressable. Path from
`03-ARCHITECTURE.md:821` (| Manager, Admin |), so this slice fills in a row
the architecture already allocated rather than inventing one.

**Why it exists**: the manager picks a PERSON, while the add below is
addressed by that person's DAY. Something has to turn one into the other,
and it must not be the client guessing. It also carries the board's
"5 of 12 done" progress line and the picker's exclusion list.

### Query

```ts
export const managerAssignmentsQuerySchema = z
  .object({
    /** Company-local calendar date. Defaults to today in company time. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    executiveId: z.string().min(1).optional(),
  })
  .strict();
```

### Response

An array, one entry per executive who has a day:

```ts
{
  assignmentId: string;
  executiveId: string;
  executiveName: string;
  beatPlanName: string | null;
  businessDate: string;
  state: 'NOT_STARTED' | 'RUNNING' | 'ENDED' | 'AUTO_CLOSED';
  visited: number;
  total: number;
  /** Planned stops and extras alike — the picker excludes these. */
  shopIds: string[];
}
```

**Two properties worth stating**, because both differ from every executive
route on the same service:

1. **No executive narrowing.** Scoped to the company and nothing else — the
   manager reads every executive's day (FR-050). On the other methods of
   `AssignmentsService` the absence of that narrowing would be a bug.
2. **It never creates a row.** `GET /assignments/today` brings the
   executive's own day into being; a manager reading a day must not bring
   one into being for someone else, so this one only reads.

`shopIds` is what lets board 3.2 refuse before the server has to: a shop
already on that day would come back `409 SHOP_ALREADY_IN_BEAT`, so it is
not offered.

### Errors

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | unknown query key, malformed `date` |
| 403 | `FORBIDDEN_ROLE` | not a Manager |

---

## `POST /assignments/:id/stops/manager`

Board 3.2. **A sibling of the executive's `POST /assignments/:id/stops`**, which slice 007 built at the path on the line above it in the same table — and whose research recorded that building it there "leaves the manager's as a sibling rather than a refactor".

**Idempotency**: `Idempotency-Key` required. **Audit**: `@Audited('extra-shop.manager-create', 'AssignmentStop')`.

### Body

```ts
export const managerAddStopSchema = z
  .object({
    shopId: z.string().min(1),
    /** REQUIRED, and written to the audit trail (FR-043). */
    reason: z.string().trim().min(3).max(280),
  })
  .strict();
```

**No `newShop` branch.** The executive's route creates a shop from the field because they are standing in front of one; a manager at a desk picks from the directory. Board 3.2 offers search and no create.

### Differences from the executive's route — and only these three

1. `source: 'MANAGER_EXTRA'` rather than `EXEC_EXTRA`.
2. `reason` is required and written to `AssignmentStop.addReason` (new, §2 of the data model).
3. **The assignment is not the caller's own.** Every prior executive route narrows to `executiveId = caller`; this one narrows to the company and takes the assignment as given. **This is the first route where that is correct rather than a bug**, so it is called out here and in the service's own comment.

Everything else — the `RUNNING` check, the frozen radius and coordinates, the appended sequence, the `@@unique([assignmentId, shopId])` duplicate guard, the audit write — is `ExtraStopService` unchanged.

### Errors

As the executive's route, plus `400 VALIDATION_FAILED` for a missing reason. `409 SHOP_ALREADY_IN_BEAT` and the two beat-state refusals already exist.

---

## New error codes

Three, added in the three places `packages/shared/src/errors.ts` requires:

```ts
ORDER_ALREADY_DELIVERED:      'ORDER_ALREADY_DELIVERED',      // 409
ATTENDANCE_DATE_IN_FUTURE:    'ATTENDANCE_DATE_IN_FUTURE',    // 409
ATTENDANCE_VERSION_CONFLICT:  'ATTENDANCE_VERSION_CONFLICT',  // 409
```

All 409, following the existing state-machine refusals (`SHOP_ALREADY_IN_BEAT`, `STOP_ALREADY_COMPLETED`, `BEAT_DAY_ENDED`).

---

## Not in this contract

- **`POST /visits/:id/review`** — adjudicating an exception, and `ReviewStatus`'s other two values. Out of scope.
- **`/reports/*/export.csv`** — its own slice, and marked "streamed, audited".
- **The push notification** on a manager's extra shop — its own slice.
- **The Company Admin role** on these routes — the mirror screens (4.2–4.5) are a later feature.
- **Any un-deliver route.** Delivery is one-way by decision.
