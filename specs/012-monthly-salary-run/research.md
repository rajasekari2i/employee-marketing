# Phase 0 Research: Monthly Salary Run

**Feature**: `012-monthly-salary-run` | **Date**: 2026-10-23

Every decision below was checked against the repository rather than assumed. Where a claim is about existing behaviour, the file is named.

---

## §1 — The records this feature creates are already designed

`03-ARCHITECTURE.md:690-717` specifies `SalaryRun` and `SalaryRunLine` in full, and **neither exists in `schema.prisma`**. Confirmed: the schema's model list runs `Company … Order, OrderLine, Attendance` and stops. `SalaryRunStatus { DRAFT FINALISED }` is likewise specified (`:272`) and absent.

So this is the **first slice since `010` to need a migration**, and the design work is mostly reading rather than inventing:

| Field | Architecture says | Why it matters here |
|---|---|---|
| `periodYear` / `periodMonth` | two ints | the month is addressed, not a date range — no ambiguity about boundaries |
| `version` | int, default 1 | `@@unique([companyId, periodYear, periodMonth, version])` is what makes "v2 alongside v1" representable |
| `status` | `DRAFT` / `FINALISED` | the lock |
| `grossTotal` | `Decimal(14,2)` | stored, not recomputed on read — that *is* the freeze |
| `SalaryRunLine.breakdown` | `Json`, `[{from,to,units,rate,amount}]` | the per-date-range sub-lines board 4.13 renders |

**`breakdown` as stored JSON is the freeze mechanism, and it is worth saying why** rather than treating it as a denormalisation smell. The sub-lines name a rate that was effective on a date. If they were recomputed from `UserSalaryRate` at read time, a back-dated rate correction would silently rewrite a finalised payslip — exactly what FR-028 and BR-24 forbid. Storing the computed breakdown makes the finalised figure a record rather than a query.

**Two new tenant tables** means both isolation layers (Constitution rule 2) and a `TENANT_MODELS` entry each. `tenant.extension.ts:28` is the Layer-1 registry; every prior slice added its tables there alongside a sibling `_rls_*` migration, and the comments there record the house rule: register **the moment a real writer exists**.

## §2 — Payable units are already computed; this feature only sums them

`Attendance.payableUnits` is a `Decimal(4,2)` **derived and stored by the server at the moment attendance is recorded** (`attendance.service.ts:268`, `derivePayableUnits(input.status, settings)`), from `CompanySettings.payableUnitByStatus`.

That settles more of this feature than it first appears:

- **FR-014 needs no new mapping.** The status→units mapping was applied when the manager saved the day sheet. The salary run sums a number that already exists.
- **FR-015/FR-016 are already true in the data.** The seeded mapping is `{PRESENT:1, HOLIDAY:1, WEEKLY_OFF:1, LEAVE:0, ABSENT:0}` — holiday paid, absent and leave not.
- **FR-013's half-day/full-day distinction needs no new concept.** Attendance is one row per *session*, so a full-day absence is two rows at 0 and a half day is one.

**The consequence to be deliberate about:** because units are frozen at record time, changing `payableUnitByStatus` tomorrow does **not** retroactively change what a past day was worth. A salary run therefore reproduces (SC-005) even across a settings change. That is the correct behaviour and it is a property of slice `010`'s design, not something this slice adds — but it means the run must **sum `payableUnits`**, never re-derive units from `status`. Re-deriving would reintroduce the drift the stored column exists to prevent.

**Only `isActive: true` rows count.** Attendance amendments are append-only — a new version plus a flip of the previous row's `isActive` (`attendance.service.ts:196` onwards). Summing without that filter would double-count every amended session.

## §3 — Rate ranges are already contiguous, which is why the breakdown is cheap

`UserSalaryRate` carries `effectiveFrom` and a nullable `effectiveTo`, and `users.service.ts:375-411` maintains them as a **closed, non-overlapping chain**: adding a rate sets the previous row's `effectiveTo = newEffectiveFrom − 1 day` and inserts the new row with `effectiveTo: null`.

So the month splits cleanly: intersect the month with each rate row's `[effectiveFrom, effectiveTo ?? ∞]` and every date in the month falls in exactly one range, or in none. No gap-filling, no overlap resolution, no "which rate wins" rule to invent — the invariant is maintained by the writer.

The two cases that remain are real and must be handled rather than assumed away:

- **A date in no range at all** — the employee's first rate starts mid-month, or they have none. FR-021 says report it, don't value it at zero. The breakdown therefore needs a way to express *unrated units*, which the architecture's `[{from,to,units,rate,amount}]` shape does not have. **Decision: add `rate: null` entries** rather than dropping those dates, so the units still appear and the sub-line is visibly unpriced. The alternative — omitting them — would make the units column silently disagree with the attendance record.
- **A range covering zero attended dates** contributes nothing and must not appear as an empty sub-line.

## §4 — "The previous month" is the company's, and `CompanyClock` already knows how

`company-clock.service.ts` exposes `businessDate(timezone)`, `startOfMonth`, `endOfMonth`, `shiftDays` and `toDateColumn`. The previous month is `startOfMonth(shiftDays(startOfMonth(today), -1))` — composed from existing primitives, inside the one service Constitution rule 8 allows to know what a date is.

**No new time arithmetic, and deliberately so.** A service resolving its own month boundaries would be the second place that knows what a month is, which is the rule `startOfWeek`'s own comment already argues against.

FR-002's "previous calendar month in the company's timezone" and FR-031's "refuse the current month" both reduce to comparing against this one value.

## §5 — PDF: generate on the server, serve by signed URL, open with the OS

This is the only genuinely new capability in the slice, and the only place a dependency decision arises. Three options were considered:

| Option | Cost | Verdict |
|---|---|---|
| **Render on the device** (`react-native-html-to-pdf`) | new **native** dependency → full Android rebuild; a second renderer that can disagree with the server | **No.** A payslip is a financial document; two renderers is two sources of truth, and the native rebuild is a real cost. |
| **Headless browser on the server** (Puppeteer) | ~300 MB of Chromium on Railway for one document | **No.** Wildly disproportionate. |
| **Pure-JS PDF writer on the server** (`pdfkit`) | one small server dependency, no native code anywhere | **Yes.** |

The serving path **already exists and needs no extension**: `files.controller.ts:78` serves `GET /files/:id` as `@Public()` authenticated by its own signed `?token=` HMAC, backed by `StorageAdapter` (`put`/`get`/`delete`/`exists`). The same shape works for a payslip.

**Decision: the payslip is streamed, not stored.** No `FileObject` row, no `PhotoKind` value added, no storage lifecycle to manage. A payslip is fully reproducible from its run line — storing the bytes would add a retention question and a stale-copy risk in exchange for nothing. The route generates on demand from the stored `breakdown`, which is itself frozen, so two requests a month apart produce identical documents.

**On the device, no new dependency either.** The app opens the payslip's signed URL with React Native's built-in `Linking`, and Android's own download/viewer handles it. `react-native-fs` and `react-native-share` are both avoidable, and both would mean another native rebuild.

**The one thing to verify in the quickstart rather than assume:** in the dev build the API is reached through `adb reverse tcp:3000`, so a URL handed to the *system browser* resolves on the device — which is exactly where the reverse tunnel terminates. It works, but it is the kind of thing that fails silently if the tunnel is down, so Scenario 8 checks it explicitly.

## §6 — The roster, and why it is a join rather than a list

FR-022 says the run covers every active member of staff except the System Admin — the same roster `attendance.service.ts:118` builds for the day sheet. Reusing *the rule* (not copying the query) keeps the two consistent: whoever accrues attendance appears on the run.

**Eligibility (FR-023)** is where this gets subtle. The day sheet asks "who is on staff today"; a salary run asks "who was on staff during this month, and for which days". A user deactivated on the 20th has 19 days of real attendance that must still be paid.

**Decision: drive the run from the attendance records themselves**, not from a current-staff list. Every `Attendance` row in the month belongs to someone who was eligible on that date — that is what it means for the row to exist. This makes FR-023 fall out rather than needing a date-range membership rule the data model has no column for (`User` has `status`, not a joined/left date).

The consequence, stated so it is not discovered later: **an employee with no attendance rows at all in the month does not appear on the run.** That is correct — there is nothing to pay — but it means the run's employee count is "people with attendance", which is what board 4.13's "· 4 employees" shows.

## §7 — Unmarked sessions: the number that has to be computed, not stored

FR-025 requires the admin to be told how many sessions in the month were never marked, before they lock it. Nothing stores that. It is:

> (eligible people × business days in the month × 2 sessions) − (active attendance rows in the month)

The first term needs a definition of "business day" that the product does not have — there is no company calendar, and weekly-off is recorded *per person per day* as an attendance status rather than as a company-wide rule. So the clean version is unavailable.

**Decision: count unmarked sessions per person against the days that person has *any* attendance row for.** If someone has a morning row on the 5th and no evening row, that evening is unmarked. A day with neither row is not counted as two unmarked sessions, because nothing in the data distinguishes "the manager forgot" from "this person was not on staff that day".

**This under-counts, and the spec's wording must not over-promise.** It catches the realistic failure — a half-filled day sheet — and cannot catch a day sheet never opened at all. Recorded here rather than silently narrowing FR-025; the alternative is inventing a company working-calendar, which is a feature in its own right and not this one.

## §8 — The CSV button on board 4.13 — the one open fidelity tension

Board 4.13 decodes with two actions: `btn2` reading **CSV** and `btn` reading **Finalize August…**. The spec puts CSV out of scope (FR-SAL-07 belongs with the export slice, which carries the audit-trail requirement for exports).

That leaves a direct conflict with FR-046 (match the board exactly). Three options:

1. **Omit the button** — diverges from the board visually.
2. **Render it and wire it** — pulls export scope, and its audit requirement, into this slice.
3. **Render it exactly as designed, and have it raise the established "coming in a later update" alert** — the pattern already used across this app for designed-but-unbuilt affordances (`AdminBottomNav`'s `comingSoon`, which slices `002`, `003` and `011` each retired one at a time).

**Decision: (3).** It preserves the board pixel-for-pixel, it is the repository's own existing convention for this exact situation rather than a new one, and it leaves a single call site for the export slice to replace. Recorded in the spec's Scope boundaries as the known tension; this is the resolution.

## §9 — Money is `Decimal`, not integer-minor-units

`docs/coding_standard.md` says money-as-integer. **This repository's schema does not do that**: `UserSalaryRate.halfDayRate` is `Decimal(12,2)`, and the architecture specifies `grossTotal Decimal(14,2)` and `amount Decimal(12,2)`.

Follow the schema. `CLAUDE.md` already records that `coding_standard.md` is written against a different project, and this is one of the places it diverges. Prisma `Decimal` arithmetic is exact, which is what SC-004 (lines sum to the gross, to the last unit) and SC-005 (identical on repeat) actually require — floating point would put both at risk.

## §10 — Idempotency and the two commands

Both state-changing routes take an `Idempotency-Key` (Constitution rule 3), using the existing `RequireIdempotencyKeyGuard`:

- `POST /salary-runs` — generate. Note its interaction with FR-030: a retry with the same key replays the stored response, while a *deliberate* regeneration with a fresh key replaces the draft. Those are different operations and the key is what distinguishes them.
- `POST /salary-runs/:id/finalise` — lock. The second finalise is a `409`, which is also what arbitrates two admins racing (FR-029) — the same shape `ORDER_ALREADY_DELIVERED` established in `010`.

Both are `@Audited` (FR-044). `salary-runs:create:company`, `:read:`, `:update:` and `:finalise:company` are **already seeded** on the `COMPANY_ADMIN` role (`roles.seed.ts:78-81`), so no permission work is needed — only the `@Roles` gates.

## §11 — Screens: one board, one designed screen, one tile

- **Board 4.13** (uuid `1f09a706-a34a-4b97-af17-7242955c3743`) decodes to: a back link to AdminHome, a `#5A6474` subtitle over a 22px title, a violet `#EFE9FB`/`#5B2FA6` status chip, a dark `#141A26` summary card with a 34px total and a mono formula line, a white `#FFFFFF`/`#DFE4EC` card of employee rows separated by `#ECEFF4` (name + mono total on a baseline row, mono `#3A4353` sub-lines beneath), an amber `#FCEFD9`/`#6B3904` lock notice, and the two buttons. **No bottom bar** — it is a pushed screen.
- **The employee detail has no board.** FR-047 permits designing it; it reuses `adminDesign.ts` tokens and 4.13's own card and chip shapes, so it reads as the same app rather than a new style.
- **The Salary tile** on admin home currently calls `comingSoon('Salary')` (`HomeScreen.tsx:436`) — the same one-line retirement `011` did for Visits.

## §12 — What this slice does not build

- **CSV export** — rendered, not wired (§8).
- **Attendance entry or amendment** — read-only here; the manager's screens remain the only writer.
- **Rate editing** — the user form owns it.
- **A scheduled `salary-draft` job** (Architecture §14) — generation is admin-initiated. The job can call the same service later without changing it.
- **Net pay, deductions, advances, tax** — gross attendance pay is the whole of what the product defines.
- **Any Employee-facing view** — the role has no login in release 1.

## Summary of new surface

| Kind | Count | What |
|---|---|---|
| Migration | **2** | `SalaryRun` + `SalaryRunLine` + `SalaryRunStatus`; sibling RLS migration |
| New tenant tables | **2** | both layers + `TENANT_MODELS` entries |
| New API routes | **4** | list/get run, generate, finalise, payslip PDF |
| New shared schema file | **1** | `salary.schema.ts` |
| New error codes | **~3** | already-finalised, period-not-complete, no-attendance |
| New server dependency | **1** | `pdfkit` (pure JS) |
| New native dependency | **0** | payslip opens via `Linking` |
| New mobile screens | **2** | board 4.13, plus the designed employee detail |
