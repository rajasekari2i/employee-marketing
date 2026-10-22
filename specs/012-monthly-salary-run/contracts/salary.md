# API Contract: Monthly Salary Run

**Feature**: `012-monthly-salary-run` | **Date**: 2026-10-23

Five routes. Three paths are taken verbatim from `03-ARCHITECTURE.md:835` (`GET /salary-runs · POST /salary-runs · POST /salary-runs/:id/finalise`); the employee-detail and payslip routes are new and follow the signed-token shape `files.controller.ts` established.

All routes are under `/api/v1`. Schemas live in `packages/shared/src/salary.schema.ts` and are wrapped with `createZodDto` in the controller (Constitution rule 5).

**Every route is `@Roles('COMPANY_ADMIN')`, applied per method, never class-level** — the trap `011` documented on `shops.controller.ts`, where a class-level gate had to be split so a manager could read without gaining the right to write. The four permissions (`salary-runs:create|read|update|finalise:company`) are **already seeded** on the role (`roles.seed.ts:78-81`); no permission work is required.

---

## `GET /salary-runs?year=&month=`

Board 4.13. Returns the **current version** of that month's run, or nothing if none has been generated.

### Query

```ts
export const salaryRunQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    /** A specific earlier version; omitted means the latest. */
    version: z.coerce.number().int().min(1).optional(),
  })
  .strict();
```

**Both `year` and `month` are optional, and omitting them means "the previous month"** — resolved by `CompanyClock` from the company's timezone, never by the device (FR-002). The client therefore opens the screen with no parameters at all, which is the only way the server stays the single authority on what "last month" is.

### Response `200`

```jsonc
{
  "period": { "year": 2026, "month": 8, "label": "August 2026" },
  "run": {
    "id": "…", "status": "DRAFT", "version": 2,
    "grossTotal": "81700.00", "employeeCount": 4,
    "generatedAt": "…", "generatedByName": "Mathivanan",
    "finalisedAt": null, "finalisedByName": null,
    "lines": [
      { "userId": "…", "employeeName": "Karthik R",
        "payableUnits": "46.00", "amount": "19700.00",
        "breakdown": [
          { "from": "2026-08-01", "to": "2026-08-10", "units": "20.00", "rate": "400.00", "amount": "8000.00" },
          { "from": "2026-08-11", "to": "2026-08-31", "units": "26.00", "rate": "450.00", "amount": "11700.00" }
        ] }
    ]
  },
  "unmarkedSessionCount": 3,
  "canFinalise": true
}
```

**`run` is `null` when the month has never been generated** — a distinct state from a run with a zero total, and the screen says so differently (FR-007's empty case).

**`grossTotal` comes from the stored header, not from summing `lines`.** Independent storage is what makes SC-004 a real check rather than a tautology.

**Money is serialised as a decimal string, not a number.** `19700.00` through `JSON.parse` is a float, and a float is exactly what SC-004 and SC-005 cannot tolerate. The client formats the string for display and performs no arithmetic on it.

**`unmarkedSessionCount` is computed per request** and describes attendance *now* — so a gap filled between two reads makes it fall (data-model.md).

---

## `POST /salary-runs`

Generate. The arithmetic is in `salary-run.service.ts`.

**Idempotency**: `Idempotency-Key` **required**. **Audit**: `@Audited('salary-run.generated', 'SalaryRun')`.

### Body

```ts
export const generateSalaryRunSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  })
  .strict();
```

**A period, and nothing else.** No `grossTotal`, no `lines`, no `payableUnits`, no `rate`. `.strict()` makes a body carrying any of them a `400` rather than a silent strip — the client cannot propose a figure, only a month (Constitution rule 1, FR-020).

### Server-side sequence (one transaction)

1. Resolve the company's today from `CompanyClock`; **refuse a period that is not a completed month** → `409 SALARY_PERIOD_NOT_COMPLETE` (FR-031).
2. Load the month's attendance: `isActive: true` only, within the month's dates. **This set defines the roster** — a person with no rows is not on the run (research.md §6).
3. If the set is empty → `409 SALARY_NO_ATTENDANCE` rather than a run with a zero total (FR-007's edge case).
4. Per person, group dates by the `UserSalaryRate` range they fall in, **summing `payableUnits`** — never re-deriving units from `status` (plan.md's drift guard).
5. Per range, `amount = units × rate`. Dates in **no** range become a sub-line with `rate: null` and `amount: 0`, carrying their units (FR-021).
6. `grossTotal` = Σ line amounts.
7. Find the month's current run. **No run** → create `version: 1`. **A `DRAFT`** → replace it and its lines, version unchanged. **A `FINALISED`** → create `version + 1` as a new `DRAFT`.
8. Write the run and all its lines together — a run whose lines are missing is unrepresentable.

`P2002` on `(companyId, periodYear, periodMonth, version)` means another admin generated the same version concurrently → re-read and return the winner, the pattern `assignments.service.ts` established.

### Response `201`

The same shape as `GET /salary-runs`.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | not a Company Admin |
| 409 | `SALARY_PERIOD_NOT_COMPLETE` | **new** — current or future month |
| 409 | `SALARY_NO_ATTENDANCE` | **new** — no attendance recorded in the period |

---

## `POST /salary-runs/:id/finalise`

The lock. Board 4.13's `Finalize August…` — the ellipsis is the confirmation FR-026 requires, which lives in the client.

**Idempotency**: `Idempotency-Key` **required**. **Audit**: `@Audited('salary-run.finalised', 'SalaryRun')`.

### Body

```ts
export const finaliseSalaryRunSchema = z.object({}).strict();
```

**Empty, and `.strict()`.** Who finalised it is the JWT's and when is the server's clock, so a body carrying `finalisedBy` or `finalisedAt` is a `400`.

### Server-side sequence

1. Load the run, tenant-scoped. Unknown → `404`.
2. Already `FINALISED` → `409 SALARY_RUN_ALREADY_FINALISED`.
3. Set `status: 'FINALISED'`, `finalisedAt` (**server clock**), `finalisedBy` (**verified JWT**).
4. **Touch no line and no attendance row.** The lines were already final when written; finalising changes only the header's status (data-model.md's invariant, FR-032).

### Response `200`

The run, now finalised.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | not a Company Admin |
| 404 | `NOT_FOUND` | unknown run, or another company's |
| 409 | `SALARY_RUN_ALREADY_FINALISED` | **new** — already locked, possibly a moment ago by another admin |

**`409` rather than a silent success**, for the same reason `010` chose it for delivery: reporting success would tell this admin they locked something another admin actually locked, and would overwrite the attribution FR-027 exists to record. It is also what arbitrates the race in FR-029.

---

## `GET /salary-runs/:id/lines/:userId`

The employee detail (FR-033 — US3). **Added during task generation**: the four routes above carry the stored line but *not* the attendance narrative the detail screen must show — unpaid sessions with their dates, late arrivals, paid non-working days, unmarked sessions. Folding that into `GET /salary-runs` would have meant loading every employee's whole month to render a list, so it is its own route.

### Response `200`

```jsonc
{
  "employeeName": "Karthik R",
  "period": { "year": 2026, "month": 8, "label": "August 2026" },
  "run": { "status": "DRAFT", "version": 2 },

  // FROZEN — straight from the stored SalaryRunLine
  "payableUnits": "46.00", "amount": "19700.00",
  "breakdown": [ { "from": "…", "to": "…", "units": "…", "rate": "…", "amount": "…" } ],

  // LIVE — read from Attendance now, and allowed to disagree with the above
  "unpaidSessions":  [ { "businessDate": "2026-08-07", "session": "MORNING", "status": "ABSENT" } ],
  "paidNonWorking":  [ { "businessDate": "2026-08-15", "session": "MORNING", "status": "HOLIDAY" } ],
  "lateSessions":    [ { "businessDate": "2026-08-03", "session": "MORNING", "latenessFlag": "DELAY_1H" } ],
  "unmarkedSessions":[ { "businessDate": "2026-08-09", "session": "EVENING" } ],

  "payslipUrl": "/api/v1/salary-runs/…/payslip/….pdf?token=…"
}
```

**The two halves are allowed to disagree and the response must not reconcile them.** After a finalised month is amended, the frozen figures no longer match the attendance listed beside them — which is exactly the state FR-030 exists for. `run.status` and `run.version` are returned so the screen can say *which* run the reader is looking at (data-model.md).

**`payslipUrl` is where the payslip token is minted.** This authenticated call is what mints the short-lived signed token the next route verifies, so the device never needs to construct one.

### Errors

| Status | Code | When |
|---|---|---|
| 403 | `FORBIDDEN_ROLE` | not a Company Admin |
| 404 | `NOT_FOUND` | unknown run or user, another company's, or that user has no line in this run |

---

## `GET /salary-runs/:id/payslip/:userId.pdf?token=`

The payslip (FR-040). **New route, existing shape** — modelled on `GET /files/:id?token=`, which is `@Public()` and authenticated by its own signed HMAC rather than a bearer header.

**Why a signed URL rather than an authenticated fetch:** the device opens it with React Native's built-in `Linking`, handing the URL to Android's own browser/downloader — which carries no `Authorization` header. This is what keeps the mobile side free of `react-native-fs`, `react-native-share` and a native rebuild (research.md §5).

The token is minted by an authenticated call and is short-lived, single-run, single-user. **Never log the URL whole** — the token is in the query string, and Constitution rule 9 puts tokens on the redaction list.

### Response `200`

`Content-Type: application/pdf`, streamed. **Generated on demand from the stored `SalaryRunLine`, never from live attendance or rates** — so the same request a month later yields the same document.

The document carries exactly what the detail screen shows (FR-041) and states the period, the version, and whether the run is **Draft** or **Finalised** — a draft payslip is unmistakably watermarked as such (FR-042).

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `INVALID_CREDENTIALS` | missing, malformed or expired token |
| 404 | `NOT_FOUND` | unknown run or user, or another company's |

---

## New error codes

Three, added in the three places `packages/shared/src/errors.ts` requires:

```ts
SALARY_PERIOD_NOT_COMPLETE:    'SALARY_PERIOD_NOT_COMPLETE',    // 409
SALARY_NO_ATTENDANCE:          'SALARY_NO_ATTENDANCE',          // 409
SALARY_RUN_ALREADY_FINALISED:  'SALARY_RUN_ALREADY_FINALISED',  // 409
```

All 409, following the existing state-machine refusals (`ORDER_ALREADY_DELIVERED`, `BEAT_DAY_ENDED`, `SHOP_ALREADY_IN_BEAT`).

---

## Not in this contract

- **CSV export of a run** (FR-SAL-07). Board 4.13's CSV button is rendered exactly as designed and raises the established "coming in a later update" alert — the repository's own convention for a designed-but-unbuilt affordance, and one call site for the export slice to replace (research.md §8).
- **Any route that writes attendance.** Read-only here.
- **Any route that edits a rate.** The user form owns rates.
- **Any un-finalise route.** Finalisation is one-way by decision.
- **A scheduled `salary-draft` job** (Architecture §14). Generation is admin-initiated; the job can call the same service later without changing it.
- **Employee-facing access.** The role has no login in release 1.
