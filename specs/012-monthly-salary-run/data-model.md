# Phase 1 Data Model: Monthly Salary Run

**Feature**: `012-monthly-salary-run` | **Date**: 2026-10-23

## The migration

Two migrations, in order. Every field comes from `03-ARCHITECTURE.md:690-717`; nothing here is invented.

`migrate dev` cannot run in this environment (the role lacks CREATEDB, P3014), so both are hand-written in Prisma's generated style — the precedent and its header are in `20261019140000_assignments/migration.sql`.

### Part 1 — `SalaryRunStatus`, a new enum

```prisma
enum SalaryRunStatus { DRAFT FINALISED }
```

Two values, both with a writer in this slice. No third value is added speculatively — the same discipline that kept `ReviewStatus` from growing in `010`.

### Part 2 — `SalaryRun`, a new model

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `companyId` | String | tenant column — both isolation layers |
| `periodYear` / `periodMonth` | Int / Int | **the month is addressed, not a date range.** No boundary ambiguity and no timezone in the key |
| `version` | Int, default 1 | |
| `status` | `SalaryRunStatus`, default `DRAFT` | |
| `grossTotal` | `Decimal(14,2)` | **stored, never recomputed on read** |
| `generatedBy` / `generatedAt` | String / DateTime | |
| `finalisedBy` / `finalisedAt` | String? / DateTime? | null until finalised; set together |
| `lines` | `SalaryRunLine[]` | |

```prisma
@@unique([companyId, periodYear, periodMonth, version])
@@index([companyId, periodYear, periodMonth])
```

**`version` inside the unique key is the versioning guarantee**, exactly as `Attendance`'s was in `010`: it makes a second writer unable to reuse a version, so two admins regenerating at once produce one winner and one `P2002` rather than a silent overwrite.

### Part 3 — `SalaryRunLine`, a new model

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `companyId` | String | tenant column |
| `salaryRunId` | String | `onDelete: Cascade` — a draft replaced takes its lines with it |
| `userId` | String | |
| `payableUnits` | `Decimal(6,2)` | the month's total for this person |
| `amount` | `Decimal(12,2)` | |
| `breakdown` | `Json` | `[{from, to, units, rate, amount}]` |

```prisma
@@unique([salaryRunId, userId])
@@index([companyId, userId])
```

### What is deliberately *not* in this migration

- **No `Attendance` change.** This feature reads it and writes none of it (FR-012, FR-032).
- **No `UserSalaryRate` change.** Its contiguous-range invariant is already maintained by `users.service.ts`.
- **No `PhotoKind` value for payslips.** The PDF is streamed, never stored (research.md §5), so no `FileObject` row exists for it.
- **No `CompanySettings` change.** The status→units mapping and session start times are read, never written.
- **No backfill.** Nothing that predates this slice has a salary run, and inventing one for a past month would fabricate a financial record. The absence of a backfill is a decision, not an oversight, and the migration header should say so.

---

## The invariant that matters most

> **A `SalaryRunLine` is written once and never updated.**

Every figure on it — units, amount, and each sub-line's `from`, `to`, `units`, `rate` and `amount` — is the value computed at generation time. It is never re-derived when the row is read.

This is the whole of FR-028, BR-24 and SC-007, and it is why `breakdown` is stored JSON rather than a query. A sub-line says *"1–10 Aug · 20 units × ₹400 = ₹8,000"*. If that were recomputed from `UserSalaryRate`, a rate corrected next March would rewrite a payslip paid last October, and nothing would record that it had moved.

The corollary, equally binding: **a correction never edits a line.** It produces a new `SalaryRun` at `version + 1` with its own lines. Earlier versions stay readable forever (FR-045).

---

## Entity: the salary run, as the screen reads it *(a read projection)*

Board 4.13 assembled from the stored run and its lines. Nothing in it is computed at read time.

| Field | Source |
|---|---|
| `periodLabel` | `periodYear`/`periodMonth` |
| `status`, `version` | stored |
| `grossTotal` | **stored**, not a sum performed on read |
| `employeeCount` | `lines.length` |
| `lines[]` | `employeeName`, `payableUnits`, `amount`, `breakdown[]` |
| `unmarkedSessionCount` | **computed at read time** — see below |
| `canFinalise` | `status === 'DRAFT'` and the period is complete |

**`grossTotal` is read from the header, not summed from the lines.** Summing on read would make the headline figure a function of the lines' *current* state, and the two would silently agree right up until they didn't. SC-004 verifies they match — which is only a meaningful check if they are stored independently.

**`unmarkedSessionCount` is the one figure computed per request**, and deliberately not stored: it describes attendance *now*, so an admin who fills a gap and reopens the screen must see the count fall. Storing it would freeze a warning about a problem that had been fixed. Its definition — and the case it cannot catch — is in research.md §7.

## Entity: the employee detail *(a read projection)*

No board (FR-047). Assembled from one stored line plus the month's attendance rows for that person.

| Group | Source | Frozen? |
|---|---|---|
| Identity, period, total, `breakdown[]` | the stored `SalaryRunLine` | **yes** — moves only with a new version |
| Unpaid sessions (date, session, status) | `Attendance`, `isActive: true` | no — reflects attendance now |
| Paid non-working days (holiday, weekly off) | same | no |
| Late arrivals (date, session, lateness) | same, `latenessFlag` | no |
| Unmarked sessions | derived (research.md §7) | no |

**The two halves are allowed to disagree, and the screen must not hide it.** After a finalised month is amended, the frozen total no longer reflects the attendance listed beneath it — that is exactly the situation FR-030 exists for. The detail screen shows the run's version and status alongside the figures so the reader can see *which* run they are looking at; it does not silently reconcile them.

## Validation rules

| Rule | Where enforced |
|---|---|
| Only a Company Admin may read or act on a run | per-method `@Roles('COMPANY_ADMIN')` |
| A run is visible only within its own company | tenant extension + Postgres RLS (both layers) |
| The period must be a **completed** month | `CompanyClock`; current or future → `409` |
| Units are **summed from `payableUnits`**, never re-derived from `status` | `salary-run.service.ts` — the drift guard (plan.md) |
| Only `isActive: true` attendance rows count | the query — amendments would otherwise double-count |
| Every date falls in exactly one rate range, or none | guaranteed upstream by `users.service.ts`'s contiguous chain |
| Unrated units appear with `rate: null` | never priced at zero (FR-021) |
| `grossTotal` equals the sum of its lines | asserted at generation, verified by SC-004 |
| A finalised run is never updated | no update path exists; `409` on re-finalise |
| Lateness never changes any figure | `latenessFlag` is read for display only and enters no arithmetic |
| No figure is accepted from a client | `.strict()` request schemas carry a period and nothing else |

## State transitions

### A salary run

```text
(no row) ──generate──▶ DRAFT v1 ──finalise──▶ FINALISED v1 ──▶ (terminal)
             ▲   │                                   │
             └───┘                                   │ generate again
         regenerate replaces                         ▼
          the draft in place                   DRAFT v2 ──finalise──▶ FINALISED v2 …
```

- **Regenerating a draft replaces it** (FR-030, FR-SAL-01) — delete its lines and rewrite, or replace the row; either way no version is consumed. A draft is working material.
- **Finalising is one-way.** There is no un-finalise route, by decision — the same posture as order delivery in `010`.
- **A second finalise is a `409`**, never a silent success. That refusal is also what arbitrates two admins racing (FR-029).
- **Only finalisation creates a version boundary.** This is the distinction the spec's FR-030 turns on and the easiest to get wrong: versions mark *locked* states, not generation attempts.

### Attendance

**No transitions.** This feature reads attendance and writes none of it. Finalising a run does not lock, flag or otherwise alter a single attendance row (FR-032).
