# Business Requirements Document — Field Sales & Beat Execution

| Field | Value |
|---|---|
| Product | Field Sales and Beat Execution Management |
| Pilot customer | Sri Ramana Traders |
| Version | 2.0 (implementation baseline) |
| Status | Approved for build |
| Date | 2026-10-01 |
| Supersedes | BRD 1.0 (Firebase/Firestore draft) |
| Primary roles | System Admin, Company Admin, Manager, Marketing Executive, Employee |

---

## 1. Why this exists

A distributor's field team visits shops every day on a fixed route (a **beat**). Today nobody can prove where the team went, what each shop said, or how the day ended. Attendance and monthly pay are kept on paper.

This product gives one reliable record of:

- who was supposed to visit which shops today;
- whether the visit happened **at the shop**, backed by a server-measured distance;
- whether a sample was shown, an order was taken, or why no order came;
- when each executive started and ended the working day;
- daily attendance with late flags, and monthly gross pay from approved half-days.

The central business concern is **visit authenticity**. The system compares the shop's approved coordinates with the executive's foreground device location at the moment of submission, stores the measured distance, and flags submissions outside the configured radius. It never deletes or overwrites that evidence.

> **Honest limitation, agreed with the business:** phone GPS is evidence, not proof. The product reports distance and accuracy and routes exceptions to a human. It does not accuse anyone of fraud automatically.

---

## 2. Business objectives

| ID | Objective | Measure of success |
|---|---|---|
| BO-01 | Digitise company, user, beat-plan, shop, visit, order, attendance and salary records | Paper registers retired for the pilot company |
| BO-02 | Create auditable evidence for every visit: time, assignment, location, accuracy, outcome, identity | 100% of submitted visits carry server-computed distance and flags |
| BO-03 | Give managers next-morning visibility of execution and location exceptions | Previous-day report available by 07:00 company time |
| BO-04 | Standardise no-order reasons so refusals are countable | Free text only via the "Other" reason |
| BO-05 | Produce reproducible monthly gross pay from half-day attendance | A closed month recomputes to the same total |
| BO-06 | Keep every company's data separate | No cross-company read or write possible, proven by tests |
| BO-07 | Record the working day end to end | Start and end time captured for every executive, every working day |

---

## 3. Roles and responsibilities

| Role | Scope | Responsibilities | App access |
|---|---|---|---|
| **System Admin** | Platform | Creates companies, creates each company's first Company Admin, suspends/reactivates companies, platform support | API / internal console only (no mobile screens in release 1) |
| **Company Admin** | One company | Users and roles, shops, beat plans, brand and reason masters, company settings, visit history, salary runs, all reports | Mobile app |
| **Manager** | One company | Records and amends attendance, adds an extra shop to an executive's day, reviews daily execution and location exceptions, marks orders delivered | Mobile app |
| **Marketing Executive** | Own assignments | Starts and ends the beat, captures a missing shop pin, records order / no-order outcomes, adds an extra shop visited | Mobile app |
| **Employee** | Own record | Attendance and salary subject only; **no login** | None |

Release 1 gives each user exactly one role inside one company.

---

## 4. Scope

### 4.1 In scope

**Company and access**
- Company onboarding with code, name, place, contact details, timezone, status.
- A separate mobile build (APK) per company, so the login screen asks only for username and password.
- Username + password login, JWT access and refresh tokens, forgot password by OTP, change password, profile photo upload.

**Masters**
- Users with role, status, photo, monthly salary and effective-dated half-day rate.
- Shops with code, name, owner, phone, address, optional coordinates, photos, optional per-shop visit radius.
- Brands (for order lines) and no-order reason messages, both ordered and activatable.
- Beat plans: name, code, assigned executive, working days, ordered shop list.

**Daily execution**
- A daily assignment snapshot generated per executive per working day from the beat plan.
- **Start beat / End beat** once per executive per day, each with time and location.
- Visit outcomes: sample shown, then either an order (brand + quantity lines) or a no-order reason, with "Other" requiring free text.
- First-visit capture of a missing shop pin, with accuracy gate and audit of who captured it.
- Server-side distance calculation and exception flags on every submission.
- **Extra shops**: an executive can add a shop to today's list, and a manager can add one to an executive's day. Neither changes the saved beat plan.
- Order delivery status, marked by a manager or Company Admin after the order is fulfilled.

**Workforce**
- Two attendance sessions (morning, evening) per employee per local business day, with Present / Absent / Leave / Holiday / Weekly Off, actual time for Present, and derived On Time / One Hour Delay / Two Hour Delay.
- Amendments to attendance create an audited change, never a silent overwrite.
- Monthly gross salary from payable half-day units × the half-day rate in force on each date.

**Reporting**
- Previous-day beat execution report with assigned, visited, pending, order, no-order and out-of-range counts.
- Company-wide and manager-level visit history, filterable by date, executive, beat and outcome type.
- Per-executive totals for a chosen period, and customer (shop) history.
- Previous-month salary report.
- CSV export for authorised roles.

**Platform**
- Audit log for sensitive and master-data changes.
- Push notifications for assignment ready, extra shop added, exception flagged, order delivered, and beat not started / not ended reminders.

### 4.2 Out of scope for release 1

- Continuous or background location tracking.
- Payroll statutory deductions, payslips, bank payments, accounting integration.
- Inventory, invoicing, dispatch, collections, returns, credit control.
- Route optimisation and territory planning.
- Biometric attendance.
- A customer-facing or shop-owner app.
- A web admin console (the Company Admin works from the mobile app; the System Admin uses the API).

---

## 5. Business requirements

| ID | Requirement | Priority |
|---|---|---|
| BR-01 | The platform shall support many companies with strict data isolation | Must |
| BR-02 | A System Admin shall create a company and its first Company Admin | Must |
| BR-03 | Each company shall receive its own mobile build, so no company code is typed at login | Must |
| BR-04 | A Company Admin shall manage users, roles, status and half-day rates | Must |
| BR-05 | A Company Admin shall manage shops, including photos and an optional per-shop visit radius | Must |
| BR-06 | A Company Admin shall manage brand and no-order reason masters | Must |
| BR-07 | A Company Admin shall create beat plans with an assigned executive, working days and an ordered shop list | Must |
| BR-08 | The system shall materialise a daily assignment snapshot per executive per working day | Must |
| BR-09 | An executive shall start the beat before recording any visit, and end the beat at the close of the day | Must |
| BR-10 | A shop may be saved without coordinates; coordinates must exist before the first outcome is recorded there | Must |
| BR-11 | An executive shall record exactly one primary outcome per assigned shop per day: order or no order | Must |
| BR-12 | A no-order outcome shall require an active reason; "Other" shall require free text | Must |
| BR-13 | An order shall capture brand and quantity per line, as non-negative integers, with at least one line above zero | Must |
| BR-14 | Submission shall capture current coordinates, accuracy, capture time and submission time | Must |
| BR-15 | The server shall calculate the straight-line distance between shop and captured coordinates and store it | Must |
| BR-16 | The server shall set an out-of-range flag when distance exceeds the effective shop or company radius | Must |
| BR-17 | Executives shall not see distance or out-of-range results; managers and Company Admins shall | Must |
| BR-18 | The visit screen shall show the last five completed interactions for that shop | Should |
| BR-19 | An executive shall add an extra shop to today's list without changing the beat plan | Must |
| BR-20 | A manager shall add an extra shop to an executive's day without changing the beat plan | Must |
| BR-21 | A manager shall record and amend two attendance sessions per employee per business day | Must |
| BR-22 | Attendance shall derive configurable one-hour and two-hour late flags | Must |
| BR-23 | The system shall calculate previous-month gross salary from payable half-days and the applicable rate | Must |
| BR-24 | A finalised salary period shall not change silently; corrections create a new version | Must |
| BR-25 | A manager or Company Admin shall mark an order delivered | Must |
| BR-26 | Managers shall see daily outcomes and location exceptions | Must |
| BR-27 | The system shall provide previous-day, visit-history, executive-total, customer-history and previous-month salary reports | Must |
| BR-28 | Authorised users shall export reports as CSV | Should |
| BR-29 | Sensitive business events and master-data changes shall be auditable | Must |
| BR-30 | Users shall change their own password and photo; name and email stay with the Company Admin | Must |
| BR-31 | Deactivating a user shall stop new activity without deleting history | Must |

---

## 6. Business rules

| ID | Rule |
|---|---|
| BUS-01 | Every business record carries `companyId`; access is constrained to the authenticated user's company. System Admin records sit outside any company. |
| BUS-02 | A user has exactly one role within one company in release 1. |
| BUS-03 | Usernames are unique **within a company**, not globally. The mobile build supplies the company, so login needs no company code. |
| BUS-04 | All business dates are evaluated in the company timezone (default `Asia/Kolkata`). Timestamps are stored in UTC. |
| BUS-05 | A daily assignment is an immutable snapshot. Later beat-plan edits never rewrite past or in-progress days. |
| BUS-06 | An executive must start the beat before any visit can be recorded, and no visit can be recorded after the beat is ended. |
| BUS-07 | A beat can be started once and ended once per executive per business day. |
| BUS-08 | An assigned shop accepts at most one completed primary outcome per executive per day, unless a manager authorises a revisit. |
| BUS-09 | A shop with no approved coordinates cannot accept an outcome until its location is captured and saved. |
| BUS-10 | The requested default visit radius is 5 m, configurable at company level; a shop-level override wins. |
| BUS-11 | Distance, out-of-range and all quality flags are server-generated. The client can never supply or edit them. |
| BUS-12 | Low accuracy, stale capture, offline upload or a mocked-location signal each raise their own flag, even when the distance is within range. |
| BUS-13 | Out-of-range submissions are accepted with a warning and routed to manager review. They are never blocked. |
| BUS-14 | A no-order result requires an active reason code; "Other" requires non-empty text. |
| BUS-15 | Order quantities are non-negative integers; at least one line must exceed zero. |
| BUS-16 | Extra shops are recorded against the day only, tagged with who added them, and never written back to the beat plan. |
| BUS-17 | Shop coordinates, once approved, change only through an authorised correction with full history. |
| BUS-18 | Salary = sum of payable half-day units × the half-day rate effective on each date. Late flags do not reduce pay unless a policy is configured. |
| BUS-19 | Half-day rate changes are effective-dated so any historical month reproduces exactly. |
| BUS-20 | Managers record attendance without Company Admin involvement; visibility stays role-controlled and audited. |
| BUS-21 | Deactivation blocks new activity and keeps all history. |
| BUS-22 | Every command API is idempotent: a retry with the same idempotency key must not create a second record. |

---

## 7. Target operating model

1. **Platform** — System Admin creates the company and its first Company Admin, and a company-specific build is issued.
2. **Setup** — Company Admin configures timezone, session start times, visit radius and accuracy limits, then loads brands, reasons, users, shops and beat plans.
3. **Overnight** — the system materialises tomorrow's daily assignments for each executive whose beat plan works that day.
4. **Morning** — the manager records morning attendance; each executive opens the app and **starts the beat**.
5. **During the day** — the executive visits each shop in order, captures a missing pin where needed, records order or no-order, and may add an extra shop. The server measures distance and stores the flags.
6. **Evening** — the executive **ends the beat**; the manager records evening attendance.
7. **Next morning** — the manager reviews the previous-day report and the out-of-range exceptions, and marks delivered orders.
8. **Month end** — the Company Admin runs the previous month's salary, reviews it and finalises it, which freezes the period.

---

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A 5 m radius produces false exceptions | High | Store accuracy with every visit; pilot 5 / 25 / 50 / 100 m; per-shop override; manager review instead of blocking |
| Location spoofing | High | Mock-location signal from the OS, server-side calculation only, anomaly reporting, optional device integrity check |
| Poor connectivity in the field | Medium | Offline queue on the device with an explicit offline flag and a maximum sync window |
| Wrong shop pin captured on first visit | High | Accuracy gate before saving, record source and capturer, corrections only through an audited workflow |
| Salary disputes | High | Effective-dated rates, preserved amendments, published formula, versioned salary runs |
| Beat-plan edits appear to rewrite history | Medium | Immutable daily snapshots; extra shops recorded on the day only |
| Executives forget to start or end the beat | Medium | Push reminders; the manager can see who has not started or ended; missing start blocks visit recording so the gap is visible |
| Photo storage outgrows a single Railway volume | Medium | Storage is behind an adapter interface so the switch to S3-compatible object storage needs no business-code change |
| Client writes tamper with calculated fields | High | Derived fields are server-only; tenant isolation enforced in the ORM layer and again by Postgres row-level security |

---

## 9. Dependencies

- **Railway** project with PostgreSQL, a persistent volume for photos, and environment-specific services (dev, staging, production).
- **Firebase** project for Cloud Messaging only — not for authentication or the database.
- **Google Maps Platform** keys (Maps SDK for Android/iOS, Places, Geocoding) with usage restrictions and billing.
- **SMS gateway** for forgot-password OTP delivery.
- Android and iOS store accounts, plus per-company build and signing configuration.
- Approved company policies for attendance, leave, holidays, salary, exceptions and data retention.
- Privacy notice and location-permission wording for both platforms.

---

## 10. Open business decisions

| ID | Decision needed | Recommended default | Status |
|---|---|---|---|
| OD-01 | Does a late flag reduce pay? | No; report separately until a policy is approved | Open |
| OD-02 | Are leave, holiday and weekly off paid? | Configurable status-to-payable-unit mapping per company | Open |
| OD-03 | Can one shop belong to several beat plans? | Yes, but block a duplicate same-day assignment to one executive | Open |
| OD-04 | Can executives edit a saved shop pin? | No; raise a correction for manager approval | Open |
| OD-05 | What happens outside the radius? | Accept with a warning and flag for review | **Decided** |
| OD-06 | Is offline completion allowed? | Yes, with an explicit offline flag and a maximum sync window | Open |
| OD-07 | Are prices captured in release 1? | No order value; quantity only. Keep a product price snapshot field for later | Open |
| OD-08 | Does the executive's extra shop need manager approval first? | No; added immediately and shown to the manager as an extra visit | **Needs client confirmation** |
| OD-09 | Do beat start and end times feed attendance automatically? | No in release 1; the manager still records attendance | **Needs client confirmation** |
| OD-10 | Where does the System Admin work? | API and seed scripts in release 1; a small web console later | Open |

---

## 11. Business acceptance

The release is business-ready when, in a pilot with real users, representatives of all four interactive roles complete this end-to-end run on a single company build:

1. System Admin creates the company and its first Company Admin; no other company's data is visible.
2. Company Admin configures settings and masters, then creates users, shops and a beat plan.
3. Daily assignments appear for the right executives on the right day.
4. The manager records morning attendance; late flags derive correctly and an amendment is audited.
5. An executive starts the beat, visits a shop with a missing pin, captures it, and records an order within the radius.
6. A no-order outside the radius is saved with reason, distance and a review flag; "Other" cannot be saved without text.
7. The executive adds an extra shop; the manager also adds one; neither appears in the beat plan afterwards.
8. A network retry with the same idempotency key creates exactly one visit and one order.
9. The executive ends the beat; start and end times and the day summary are visible to the manager.
10. The manager reviews out-of-range visits and marks an order delivered.
11. The previous-day, visit-history, executive-total and salary reports reconcile to source records.
12. Salary for a month containing a mid-month rate change reproduces the correct total twice in a row.
