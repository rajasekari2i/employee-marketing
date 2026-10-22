# Feature Specification: Monthly Salary Run

**Feature Branch**: `012-monthly-salary-run`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: "Company Admin login we have button called salary in the home page. When we click that button we need to redirect to the Monthly salary run page UI (section 4.13). In this page we need show list of employee. We need to show Finalize August (the previous month — if I want to finalise October on November 1st I need to show Finalize October). Clicking it calculates the salary. We reduce the salary if the employee took absent/leave, based on half day or full day. Holiday is a paid day. Half-day salary is in the user_salary_rates table. Clicking an employee shows that month's salary in a detail page (not in the design — follow the same UI) with absences, leave, lateness and hours, and a detailed salary calculation, with a PDF payslip export. Once we finalise, lock the previous month. Coming late is a warning only, not a deduction. The manager's attendance day sheet (3.7) is the source for the calculation. UI must look exactly like docs/ui-design/Field_Sales_Beat_App.html."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the salary run for last month (Priority: P1)

A Company Admin opens the app on the 1st of November and taps **Salary** on the home screen. Until now that tap said the screen was coming later. It now opens the salary run for **October** — the previous month, chosen for them — showing the gross total, the number of employees, the formula it used, and a line per employee with their payable half-days, their rate, and what they are owed. An employee whose rate changed mid-month shows two sub-lines, each with its own date range, units and rate.

**Why this priority**: It is the whole feature's entry point and the only screen in the design. Nothing else here is reachable without it, and it is the last "coming soon" tile on the admin's home screen. Even read-only, it answers the question the month-end routine exists to answer.

**Independent Test**: With a month of recorded attendance and at least one mid-month rate change, open Salary and confirm every employee's figure reconciles by hand to their attendance records and the rates effective on each date.

**Acceptance Scenarios**:

1. **Given** a Company Admin is signed in, **When** they tap Salary, **Then** the salary run opens for the **previous calendar month** in the company's own timezone — not the current month.
2. **Given** the run is open, **When** the header is read, **Then** it names the period, the status (Draft or Finalised) and the version.
3. **Given** the run is open, **When** the summary is read, **Then** it shows the gross total, the employee count, and the formula "salary = payable half-days × half-day rate".
4. **Given** the run is open, **When** an employee row is read, **Then** it shows their name, their total amount, and a breakdown line of units × rate.
5. **Given** an employee's rate changed mid-month, **When** their row is read, **Then** it shows one sub-line per date range, each with its own units, rate and amount, and the sub-lines sum to their total.
6. **Given** an employee had unpaid absences, **When** their row is read, **Then** the unpaid portion is stated rather than silently missing from the total.
7. **Given** no attendance was ever recorded for the month, **When** the run is opened, **Then** it says so plainly rather than showing a gross total of zero as though that were the answer.

---

### User Story 2 - Finalise the month and lock it (Priority: P1)

Having reviewed the figures, the admin taps **Finalize October**. They are told exactly what will be locked and must confirm. Afterwards the month is frozen: the figures cannot drift, the run records who finalised it and when, and the screen shows it as finalised. If attendance for that month is corrected later, the correction does not silently rewrite the finalised figures — a **new version** is produced and the finalised one stays readable.

**Why this priority**: Locking is the point of a salary run. Without it, the figure an admin paid against can change underneath them, which is the dispute BR-24 and risk register exist to prevent. P1 with US1 because a run that cannot be finalised is a report, not a payroll process.

**Independent Test**: Finalise a month, confirm the recorded figures, then amend an attendance record inside that month and confirm the finalised version's numbers are byte-identical to before and a new version is offered.

**Acceptance Scenarios**:

1. **Given** a draft run, **When** Finalize is tapped, **Then** a confirmation states what will be locked and the action does not proceed without it.
2. **Given** the confirmation is accepted, **When** the run finalises, **Then** it records who finalised it and when, and shows as Finalised.
3. **Given** a finalised run, **When** it is opened, **Then** its figures are exactly those recorded at finalisation, regardless of any later attendance change.
4. **Given** a finalised run, **When** finalising is attempted again, **Then** it is refused plainly rather than re-locking or overwriting.
5. **Given** a finalised month whose attendance has since been amended, **When** a new run is generated for that month, **Then** it is created as the **next version**, and the earlier version remains readable.
6. **Given** a **draft** run for a month, **When** it is regenerated, **Then** the draft is replaced rather than versioned — only finalising creates a version boundary.
7. **Given** the current month, **When** the admin tries to run it, **Then** it is refused: only a completed month can be finalised.

---

### User Story 3 - See one employee's month in detail (Priority: P2)

The admin taps an employee's row and sees how that total was reached: the payable half-days, the sessions that were unpaid and why (absent or leave, morning or evening), the days marked holiday or weekly off and that they were paid, the rate or rates applied with their date ranges, and the arithmetic that produced the amount. Lateness is shown for information — which days, which session, and how late — stated clearly as **not** affecting pay.

**Why this priority**: It is what turns a number into something an admin can defend to the employee who disputes it. P2 because the run total is usable without it, and this screen has no board in the design, so it carries more design risk than US1 and US2.

**Independent Test**: Open an employee with a mixed month — some absences, a leave, a holiday, a late arrival and a mid-month rate change — and confirm every line reconciles to their attendance day sheet and that the stated total equals the row on the run.

**Acceptance Scenarios**:

1. **Given** an employee row is tapped, **When** the detail opens, **Then** it shows that employee, the period, and the same total as the row.
2. **Given** the detail is open, **When** the unpaid sessions are read, **Then** each shows its date, which session, and which status caused it (absent or leave).
3. **Given** the employee had a holiday or weekly off, **When** the detail is read, **Then** it shows those days as **paid**, so the admin can see why they did not reduce the total.
4. **Given** the employee arrived late, **When** the detail is read, **Then** each late session shows its date and how late it was, and the screen states that lateness does not reduce pay.
5. **Given** a mid-month rate change, **When** the calculation is read, **Then** each date range shows its units, rate and amount, and they sum to the total.
6. **Given** any session in the month was never marked, **When** the detail is read, **Then** those sessions are listed as unmarked and counted as unpaid, rather than being invisible.
7. **Given** the detail is open, **When** the back control is used, **Then** the admin returns to the run.

---

### User Story 4 - Export a payslip (Priority: P3)

From an employee's detail the admin exports a **payslip as a PDF** carrying exactly what the screen shows — the employee, the period, the payable units, the unpaid sessions, the rates applied and the final amount — which can then be shared with the employee, who has no login of their own.

**Why this priority**: It is the handoff to a person who cannot see the system at all, so it matters — but it is a rendering of information US3 already establishes, and the month can be paid without it.

**Independent Test**: Export a payslip for an employee with a mixed month and confirm every figure on it matches the detail screen and the run, and that nothing the executive-facing rules forbid appears on it.

**Acceptance Scenarios**:

1. **Given** an employee detail, **When** the export is used, **Then** a PDF payslip is produced for that employee and that period.
2. **Given** a payslip is produced, **When** it is read, **Then** every figure on it matches the detail screen exactly.
3. **Given** a payslip for a finalised run, **When** it is read, **Then** it states the period is finalised and which version it came from.
4. **Given** a payslip for a draft run, **When** it is read, **Then** it is marked as a draft, so it cannot be mistaken for a final statement of pay.

---

### Edge Cases

- **An employee with no half-day rate** effective in the month. Their amount cannot be computed; the run must say so against that employee rather than showing ₹0 as if it were earned.
- **An employee who joined mid-month or was deactivated mid-month.** Only the dates they were eligible contribute; deactivating someone never erases the part of the month they worked.
- **A month with no attendance recorded at all.** The run says so rather than presenting a zero total as a result.
- **Sessions never marked** by the manager. They contribute nothing to pay and must be surfaced as unmarked before finalising, because a forgotten day silently costs the employee money.
- **A rate change that lands exactly on the 1st or the last day** of the month. The day belongs to exactly one range; no day is counted twice or dropped.
- **A rate change back-dated after the month was finalised.** The finalised version does not move; a new version reflects it.
- **An attendance amendment inside a finalised month.** Same: the finalised figures stand, a new version carries the correction.
- **Two admins finalising the same run at once.** One succeeds; the other is told it is already finalised rather than silently re-locking it.
- **The System Admin.** Never appears on a salary run — they are not a member of any company's staff.
- **An employee with every day marked holiday or weekly off.** They are paid in full, because those statuses are paid.
- **A month in which the company's session start times were changed.** Lateness shown for a past day reflects the rule in force on that day, not today's setting.

## Requirements *(mandatory)*

### Functional Requirements

#### Reaching the salary run

- **FR-001**: The **Salary** tile on the Company Admin's home screen MUST open the monthly salary run. It MUST NOT raise the "coming in a later update" alert.
- **FR-002**: The run MUST open on the **previous calendar month**, resolved in the company's own timezone — never the device's clock. On 1 November it is October.
- **FR-003**: Only a Company Admin MUST be able to see or act on a salary run. No other role MUST reach it by any means.
- **FR-004**: An admin MUST see only their own company's salary data.

#### What the run shows (board 4.13)

- **FR-005**: The run MUST show the period, the status (**Draft** or **Finalised**) and the **version**, matching UI design reference section 4.13.
- **FR-006**: It MUST show the gross total, the number of employees in the run, and the formula **"salary = payable half-days × half-day rate"**.
- **FR-007**: It MUST show one line per employee with their name, their total amount, and a breakdown of units × rate.
- **FR-008**: When an employee's rate changed during the month, their line MUST show **one sub-line per date range**, each with its own date range, units, rate and amount, and those sub-lines MUST sum to their total.
- **FR-009**: Where an employee lost pay to unpaid sessions, the line MUST say so, rather than leaving the shortfall unexplained.
- **FR-010**: The run MUST state what finalising will lock, and that later corrections create a new version while the current one stays on record.

#### How the salary is calculated

- **FR-011**: An employee's amount MUST be **Σ (payable half-day units on each date × the half-day rate effective on that date)**. No other input MUST affect it.
- **FR-012**: Payable units MUST come from the attendance records the Manager entered on the day sheet (UI design reference section 3.7). This feature MUST NOT introduce a second source of attendance truth and MUST NOT alter any attendance record.
- **FR-013**: Each business day has **two independent sessions** (morning and evening), each carrying its own status and its own payable units. A full-day absence is therefore both sessions unpaid and a half-day absence is one.
- **FR-014**: The mapping from attendance status to payable units MUST be the **company's configured setting**, not a constant in this feature. Its established values are Present, Holiday and Weekly Off = 1 unit; Leave and Absent = 0.
- **FR-015**: **Holiday and Weekly Off MUST be paid.** They MUST NOT reduce the total.
- **FR-016**: **Absent and Leave MUST reduce pay**, by exactly the sessions they cover.
- **FR-017**: A session with **no attendance record** MUST contribute **zero** payable units, and MUST be counted and surfaced as unmarked (FR-025) rather than being indistinguishable from a recorded absence.
- **FR-018**: **Lateness MUST NOT reduce pay**, in any amount, and every screen that shows lateness MUST say so explicitly.
- **FR-019**: The half-day rate MUST be the rate **effective on each date**, from the employee's effective-dated rate records. A rate change splits the month at the change date; no date MUST be counted under two rates or under none.
- **FR-020**: Every figure — units, rates, amounts and the gross total — MUST be computed and stored by the server. A client-supplied figure MUST be rejected, never trusted.
- **FR-021**: An employee with **no rate effective** for part or all of the month MUST be reported as such against that employee. Their unrated portion MUST NOT silently contribute zero as though it were earned.
- **FR-022**: The run MUST cover every active member of the company's staff **except the System Admin** — the same roster the attendance day sheet uses — so that whoever accrues attendance also appears on the salary run.
- **FR-023**: Only the days an employee was **eligible** MUST contribute. Joining or being deactivated mid-month MUST reduce the eligible days, never erase the part already worked.
- **FR-024**: Recomputing a month from unchanged attendance and unchanged rates MUST produce **exactly the same figures**, every time.

#### Finalising and locking

- **FR-025**: Before finalising, the admin MUST be shown how many sessions in the month are **unmarked**, because finalising over a forgotten day costs the employee money silently.
- **FR-026**: Finalising MUST require explicit confirmation that states what is being locked.
- **FR-027**: Finalising MUST record **who** finalised it and **when**, and the run MUST then show as finalised.
- **FR-028**: A finalised run's figures MUST NOT change for any reason. Later attendance amendments, rate corrections or master-data edits MUST NOT rewrite them.
- **FR-029**: Finalising an already-finalised run MUST be refused plainly, including when two admins act at once. The first finaliser's record MUST NOT be overwritten.
- **FR-030**: Regenerating a run for a month whose current version is a **draft** MUST replace that draft. Regenerating after a finalisation MUST create the **next version**, leaving earlier versions readable.
- **FR-031**: Running the **current** (incomplete) month MUST be refused.
- **FR-032**: Finalising MUST NOT change, lock or otherwise alter any attendance record. Attendance remains amendable; what is locked is the salary figure.

#### The employee detail (no board — follows the same visual language)

- **FR-033**: Tapping an employee on the run MUST open a detail for that employee and that period, showing the same total as the row.
- **FR-034**: The detail MUST list the **unpaid sessions** with their date, session and causing status.
- **FR-035**: The detail MUST show the days paid as **Holiday or Weekly Off**, so a paid non-working day is visibly accounted for.
- **FR-036**: The detail MUST show **late arrivals** — date, session and how late — and MUST state that lateness does not reduce pay.
- **FR-037**: The detail MUST show the **rate ranges** applied, each with its units, rate and amount, summing to the total.
- **FR-038**: The detail MUST list **unmarked sessions** and show them as contributing nothing.
- **FR-039**: The detail MUST NOT offer any way to change attendance, rates or figures. It is a read-only explanation.

#### The payslip

- **FR-040**: The detail MUST offer an export producing a **PDF payslip** for that employee and period.
- **FR-041**: The payslip MUST carry exactly the information the detail screen shows, and MUST NOT introduce any figure not visible on screen.
- **FR-042**: The payslip MUST state the period, the run **version**, and whether the run is **Draft** or **Finalised** — a draft payslip MUST be unmistakably marked as such.
- **FR-043**: Producing a payslip MUST NOT alter the run, the figures, or any attendance record.

#### Record-keeping

- **FR-044**: Generating and finalising a run MUST each be recorded in the audit trail with the actor, the period and the version.
- **FR-045**: A finalised run MUST remain readable indefinitely, including every earlier version of the same month.

#### Fidelity

- **FR-046**: The salary run screen MUST visually match board **4.13** in `docs/ui-design/Field_Sales_Beat_App.html` exactly — colours, spacing, typography, icon shapes, border radii and layout — with no approximated placeholders.
- **FR-047**: The employee detail screen has **no board**. It MUST be built in the same visual language as the admin screens that do, and MUST NOT invent a new style. *(Explicitly permitted by the user; see Assumptions.)*
- **FR-048**: Loading, empty and offline states MUST be expressed within those layouts rather than replacing them with a different screen.

### Key Entities

- **Salary run** *(created)*: one company, one month, one version, a status of draft or finalised, a gross total, who generated it and when, and who finalised it and when.
- **Salary run line** *(created)*: one employee's place in a run — their payable units, their amount, and the per-date-range breakdown that explains it.
- **Attendance record** *(referenced only, never written)*: the per-person, per-day, per-session status and payable units the Manager recorded. This feature reads it and must not change it.
- **Half-day rate** *(referenced only)*: an employee's effective-dated rate. Rate history is what lets a past month reproduce exactly.
- **Payslip** *(produced, not stored as a new record)*: a per-employee rendering of one run line for sharing with an employee who has no login.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Company Admin can go from the home screen to last month's gross total in **one tap**.
- **SC-002**: Zero "coming in a later update" alerts remain on the Company Admin's home screen tiles covered by this feature.
- **SC-003**: For 100% of employees tested, the amount shown reconciles exactly, by hand, to their attendance records and the rates effective on each date.
- **SC-004**: The sum of the employee lines equals the gross total for 100% of runs, to the last unit of currency.
- **SC-005**: A month recomputed from unchanged attendance and rates produces **identical** figures on every repetition — zero drift.
- **SC-006**: A month containing a mid-month rate change reproduces the correct total on two consecutive runs.
- **SC-007**: Zero finalised runs change their figures after any later attendance amendment or rate correction.
- **SC-008**: Zero runs can be finalised twice, including by two admins at once, and the recorded finaliser is never overwritten.
- **SC-009**: 100% of unmarked sessions in a month are surfaced to the admin before finalisation is confirmed.
- **SC-010**: Zero lateness records reduce any employee's pay.
- **SC-011**: 100% of payslip figures match the employee detail screen they were produced from.
- **SC-012**: Board 4.13 is visually indistinguishable from the delivered screen, verified side by side, with zero undocumented divergences.
- **SC-013**: Zero salary screens expose another company's data, and zero non-admin roles can reach a salary run.
- **SC-014**: A full month-end — open, review, finalise — takes a Company Admin under **10 minutes** for a 20-person company.

## Assumptions

### Taken from the user's description

- **The run is the previous calendar month, chosen by the system.** The user's "finalise October on November 1st" settles that the admin does not pick a period; the screen opens on the month that just ended.
- **Holiday is paid, absent and leave are not, and lateness never deducts.** Stated directly by the user, and matching the product's existing rules (BUS-18 and the configured status mapping), so no conflict arises.
- **Half-day versus full-day absence needs no new concept.** Attendance is already recorded per session, so "half day" is one session and "full day" is both. This feature counts sessions; it does not introduce a separate half/full-day field.
- **The employee detail screen may be designed.** The user explicitly said it "is not in the design but follow the same UI". This is recorded as FR-047 because it is a deliberate exception to the standing rule that every screen matches a board — the rule is not being relaxed anywhere else.
- **The day sheet is the only source of attendance.** The user was explicit that the manager's entries drive the calculation, so this feature reads them and introduces no second path.

### Decisions taken on the user's behalf

- **Sessions with no attendance record count as zero, but are never silent.** The user did not say what happens to a day the manager forgot to mark. Paying for an unmarked session would invent attendance; dropping it silently would cost the employee money without anyone noticing. FR-017 and FR-025 take the middle course: it is worth nothing, and the admin is told how many there are before they lock the month.
- **An employee with no rate is reported, not valued at zero.** A missing rate is a master-data gap, not a salary of nothing, and showing ₹0 would look like a computed answer.
- **The roster is the attendance roster.** Slice `010` established that the day sheet covers every active member of staff except the System Admin. A salary run over a different population than the attendance it reads would be inconsistent, so FR-022 reuses it.
- **Finalising locks the salary figure, not the attendance.** The user asked to "lock the previous month salary". Attendance remains amendable — the product's amendment history exists precisely so corrections stay possible — and a correction surfaces as a new version (FR-030, FR-032).

### Conflicts found in the product documentation, and how they are resolved

- **The session start times the user described are not the ones configured.** The user describes the morning session starting at **10:00** and the evening at **15:30**. The company's configured start times are **09:00** and **14:00**. These times decide only the **lateness flag**, which FR-018 keeps out of pay entirely, so no salary figure depends on the discrepancy. **But the lateness shown on the detail screen will be wrong until the settings are corrected.** This is a settings change for the Company Admin, not a code change, and is called out so it is not discovered as a defect.
- **Session *end* times do not exist anywhere in the product**, and the user's "10AM–2PM" and "3:30–8:30" ranges imply them. The user also said that for an employee arriving on time "we no need to worry about the end time", and the data model records only an arrival time. This feature therefore uses **start times only** and does not introduce end times or hours-worked.
- **"Show list of employee" versus the Employee role.** The product's `Employee` role means a staff member with no login. The salary run covers executives, managers and admins too — all of whom accrue attendance. The screen's "By employee" wording means *people*, not that role.
- **The board shows a CSV button; the user asked for a PDF payslip.** They are different exports at different levels: CSV of the whole run (FR-SAL-07) and a per-employee PDF payslip. The PDF is in scope here. The CSV is **not** — see Scope boundaries.
- **The architecture already designs the salary records** — run, version, status, gross total, per-employee lines with a stored breakdown of date ranges, units and rates. None of it is built yet. This feature creates it, which makes it the first slice since `010` to need a migration.

### Scope boundaries

- **CSV export of a run is out of scope** (FR-SAL-07), and belongs with the export slice that carries the audit requirements for exports. Board 4.13 shows the button; whether it is rendered disabled or omitted is a planning decision, and is the one known tension with FR-046.
- **Editing attendance is out of scope.** This feature reads the day sheet; the Manager's screens remain the only place attendance is entered or amended.
- **Editing half-day rates is out of scope.** Rates are set on the user form by the Company Admin.
- **Changing the company's session start times or the status-to-units mapping is out of scope.** This feature reads both.
- **Any automatic or scheduled generation is out of scope.** The run is produced when the admin asks for it.
- **Deductions, advances, bonuses, overtime, tax and net pay are out of scope.** This is **gross** attendance pay, which is the whole of what the product defines.
- **Anything an Employee sees themselves is out of scope** — the Employee role has no login in this release; the payslip is shared by the admin.
- **Previous-month salary *reporting* beyond this screen is out of scope** and belongs with the reports slice.

### Reasonable defaults

- The run lists employees in a stable, repeatable order so two readings of the same run never disagree.
- Amounts are shown in the currency and format board 4.13 uses.
- A month is the company's calendar month in the company's timezone, consistent with every other date in the product.
- Generating a draft repeatedly is harmless and replaces the previous draft, matching the product's existing rule.
