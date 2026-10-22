# Quickstart: Monthly Salary Run

**Feature**: `012-monthly-salary-run` | **Date**: 2026-10-23

The verification path for this feature. There are no automated tests (CLAUDE.md's standing policy), so this document **is** the test suite.

It is grouped by user story so each can be verified as it lands.

Contracts are in [`contracts/salary.md`](./contracts/salary.md); field-level rules are in [`data-model.md`](./data-model.md). Neither is repeated here.

> **This feature's quickstart is unusually load-bearing.** SC-005 (a month reproduces identically) and SC-007 (a finalised run never moves) are the requirements BR-24 and the dispute risk hang on, and neither can be checked by looking at a screen once. **Scenarios 5 and 6 are arithmetic performed twice, deliberately.** Do not skip them.

## Prerequisites

```bash
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter api exec prisma migrate deploy
pnpm --filter api add pdfkit && pnpm --filter api add -D @types/pdfkit
pnpm dev
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:8081 tcp:8081 && adb reverse --list
```

> `adb reverse` is not optional here and is not only about the app. **Scenario 8 opens the payslip in the device's own browser**, which resolves `localhost:3000` through that same tunnel. The tunnel is lost on every unplug and nothing re-creates the `3000` one automatically.

Data needed, and **the shape matters far more than the volume — every figure below is an arithmetic check, so know the right answer before you look at the screen**:

- **A Company Admin account.**
- **A completed previous month with attendance recorded** by a Manager through the day sheet. Attendance entered any other way does not exercise FR-012.
- **At least four people with attendance**, between them covering:
  - a **full-day absence** (both sessions `ABSENT`) and a **half-day** (one session only);
  - a **`LEAVE`** session;
  - a **`HOLIDAY`** and a **`WEEKLY_OFF`** (these must *not* reduce pay);
  - a **late arrival** (`DELAY_1H` or `DELAY_2H`) — which must not reduce pay either;
  - a day with **one session marked and the other not**, for the unmarked count.
- **One employee whose half-day rate changed mid-month** — Scenario 6 is meaningless without it.
- **One employee with no rate at all**, or whose rate starts mid-month, for the unrated case.
- **A second Company Admin**, for the finalise race in Scenario 7.

> **Known environment gap, not a defect.** The pilot company's configured session start times are **09:00 / 14:00**, which do not match the 10:00 / 15:30 the feature was described with. No salary figure depends on them — lateness never deducts — but **the lateness shown in Scenario 9 will be computed against the configured times**. Correct the company setting before judging that screen, or expect the flags to differ.

---

## Scenario 0 — The migration

Run first; everything depends on it.

```sql
SELECT count(*) FROM salary_runs;                 -- table exists
SELECT count(*) FROM salary_run_lines;            -- table exists
SELECT relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname IN ('salary_runs','salary_run_lines');
```

**Expect** both tables to exist and RLS to be **enabled and forced** on each. Confirm `'SalaryRun'` and `'SalaryRunLine'` are both in `TENANT_MODELS` — a new tenant table missing either layer must fail CI.

*Covers data-model.md, Constitution rule 2.*

---

## US1 — Opening the run

### Scenario 1 — The tile finally goes somewhere

1. Sign in as the **Company Admin**.
2. Tap **Salary** on the home screen.
3. **Expect** the salary run — **not** the "coming in a later update" alert.
4. **Expect the previous month**, named in the header. On 23 October that is **September**, not October.
5. **Expect** the status chip to read `Draft · v1` (or the current version).

*Covers FR-001, FR-002, FR-005; SC-001, SC-002.*

### Scenario 2 — The board, side by side

Compare against board **4.13**: the back link, the `#5A6474` subtitle above the 22px period title, the violet `#EFE9FB`/`#5B2FA6` status chip, the dark `#141A26` summary card with its 34px total and mono formula line, the white employee card with `#ECEFF4` row separators and mono sub-lines, the amber `#FCEFD9`/`#6B3904` lock notice, and the two buttons.

**Expect** no visible difference. **The CSV button must be present and must look exactly as designed** — tapping it raises the "coming in a later update" alert (research.md §8).

*Covers FR-046.*

### Scenario 3 — The figures reconcile

Before looking at the screen, compute by hand from the day sheet: for each person, the payable units per session summed over the month, times the rate effective on each date.

1. **Expect** each employee's amount to equal your figure, exactly.
2. **Expect** the employee lines to sum to the gross total, to the last rupee.
3. **Expect** the employee count to equal the number of lines.
4. **Expect** the formula line to read `salary = payable half-days × half-day rate`.

*Covers FR-006, FR-007, FR-011; SC-003, SC-004.*

### Scenario 4 — What does and does not reduce pay *(do not skip)*

1. Find the person with a **full-day absence**. **Expect** two units missing, not one.
2. Find the **half-day absence**. **Expect** exactly one unit missing.
3. Find the **`LEAVE`** session. **Expect** it unpaid.
4. Find the **`HOLIDAY`** and **`WEEKLY_OFF`** days. **Expect them PAID** — present in the units, not deducted.
5. Find the **late arrival**. **Expect their pay to be completely unaffected.** Compute their total as if they had been on time; it must match.

*Covers FR-013, FR-015, FR-016, FR-018; SC-010.*

### Scenario 5 — It reproduces *(do not skip — this is SC-005)*

1. Note the gross total and two employees' amounts.
2. Regenerate the run **without changing any attendance or rate**.
3. **Expect every figure to be identical.** Not close — identical.
4. **Expect the version NOT to have advanced** — regenerating a draft replaces it (FR-030).
5. Now change `payableUnitByStatus` in company settings and regenerate again.
6. **Expect the figures still to be identical**, because units were frozen onto the attendance rows when the manager saved them. *If they moved, the service is re-deriving units from `status` instead of summing `payableUnits` — the single mistake this slice is most likely to make.*

*Covers FR-024, FR-030; SC-005.*

### Scenario 6 — A mid-month rate change *(do not skip — this is SC-006)*

1. Open the employee whose rate changed.
2. **Expect two sub-lines**, each with its own date range, units, rate and amount.
3. **Expect the two amounts to sum to their total**, and the date ranges to be contiguous with **no day counted twice and no day missing**.
4. Regenerate and **expect the same two sub-lines**.
5. Find the employee with **no rate** for part of the month. **Expect their unrated units to be shown and visibly unpriced — not silently valued at ₹0.**

*Covers FR-008, FR-019, FR-021; SC-006.*

---

## US2 — Finalising

### Scenario 7 — The lock, and the race

1. **Expect the unmarked-session count** to be shown before you can confirm. Verify it against a day you deliberately left half-marked.
2. Tap **Finalize**. **Expect a confirmation that states what will be locked**; cancelling must change nothing.
3. Confirm. **Expect** the status to become Finalised, recording who and when.
4. Reopen. **Expect** finalising to be unavailable.
5. **The race**: with two admins, finalise the same run at once. **Expect one to succeed and the other to be refused plainly**, with the first finaliser's name and time standing.
6. **Now amend an attendance record inside the finalised month.**
   - **Expect the finalised run's figures to be byte-identical to step 3.** *This is SC-007. If any number moved, the lines are being recomputed on read instead of stored.*
   - **Expect the attendance amendment itself to have succeeded** — locking the salary must not lock attendance (FR-032).
7. Regenerate the month. **Expect a new `Draft · v2`**, with the finalised v1 still readable.
8. Try to run the **current** month. **Expect a refusal.**

*Covers FR-025 through FR-032; SC-007, SC-008, SC-009.*

---

## US3 / US4 — The employee detail and the payslip

### Scenario 8 — The detail, and the payslip *(the detail has no board)*

1. Tap an employee row. **Expect** a detail screen in the same visual language as the admin screens — not a new style (FR-047).
2. **Expect the total to equal the row** you tapped.
3. **Expect** the unpaid sessions listed with date, session and causing status; the holiday/weekly-off days shown as **paid**; the rate ranges with their units and amounts; and the unmarked sessions listed as contributing nothing.
4. **Expect no control that edits anything.**
5. Export the payslip. **Expect a PDF to open** in the device's viewer.
6. **Expect every figure on it to match the screen**, and the period, version and Draft/Finalised state to be stated. A draft payslip must be unmistakably marked as a draft.
7. Export again for the same employee. **Expect an identical document.**

> If the PDF does not open, check `adb reverse --list` before suspecting the code — the browser reaches the API through the same tunnel.

*Covers FR-033 through FR-043; SC-011.*

### Scenario 9 — Lateness is information only

1. Open the employee with a late arrival.
2. **Expect** the date, session and how late, and **an explicit statement that lateness does not reduce pay**.
3. Cross-check against the company's configured session start times — **not** against the times in the feature description, unless the setting has been corrected (see Prerequisites).

*Covers FR-036; SC-010.*

---

## Cross-cutting

### Scenario 10 — Roles and isolation *(do not skip)*

1. Call `GET /salary-runs` with a **Manager's** token. **Expect `403`.**
2. Same with a **Marketing Executive's** token. **Expect `403`.**
3. As the admin of company A, request a run belonging to company B. **Expect `404`**, never the data.
4. Attempt `POST /salary-runs` with `grossTotal` in the body. **Expect `400`** — a rejection, not a silent strip.

*Covers FR-003, FR-004, FR-020; SC-013.*

### Scenario 11 — Empty and offline

1. Open a month with **no attendance at all**. **Expect it to say so** — not a gross total of ₹0 presented as an answer.
2. Open a month **never generated**. **Expect the empty state**, distinct from the above.
3. With the run loaded, turn off the network and pull to refresh. **Expect** the figures already on screen to stay with a visible not-fresh note — never zeroes.
4. Tap Finalize offline. **Expect to be told plainly**, and confirm on reconnect that **nothing was finalised twice**.

*Covers FR-048, and Constitution rule 7.*

---

## Before calling the slice done

- [ ] Board 4.13 compared side by side with the design file; the only divergence is the CSV button's behaviour, which is documented.
- [ ] Scenario 5 run twice, including across a `payableUnitByStatus` change — figures identical.
- [ ] Scenario 7 step 6 verified: a finalised run did not move after an attendance amendment.
- [ ] The employee lines sum to the stored `grossTotal` for every month tested.
- [ ] `tsc --noEmit` clean in `apps/api` and `apps/mobile`.
- [ ] No "coming in a later update" alert left on the admin home screen's Salary tile.
- [ ] `git diff` shows **no** change under `attendance/`, `users.service.ts`'s rate logic, or any executive-facing file.
