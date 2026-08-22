# Product Requirements Document — Field Sales & Beat Execution

| Field | Value |
|---|---|
| Version | 2.0 (implementation baseline) |
| Date | 2026-10-01 |
| Companion documents | `01-BRD.md`, `03-ARCHITECTURE.md` |
| Design source | Claude Design canvas "Field Sales Beat App" — 37 mobile artboards |
| Platforms | React Native mobile app (Android first, iOS ready) |
| Backend | NestJS + Prisma + PostgreSQL, see `03-ARCHITECTURE.md` |

This document specifies behaviour, screen by screen, with the validation and derived values an implementer needs. Anything about *how* it is built lives in the architecture document.

## Technology 
Backend: Node.js, NestJS, Prisma ORM 
Database: PostgreSQL
Frontend: React Native  Mobile application, Tailwind CSS.
Mobile Notification: Firebase
Auth: Stateless JWT (access + refresh token)
Login: using username and password 
Roles: System Admin, Company Admin, Manager, Marketing Executive & Employee.

---

## 1. Product definition

A company-scoped mobile application for field sales teams. Executives work a daily beat of shops, record one outcome per shop, and the server records independent evidence of where each submission came from. Managers review execution and keep attendance. Company Admins own master data, reports and payroll inputs.

Each company gets its **own build**, so the company identity is baked into the app and the login screen asks only for username and password.

---

## 2. Personas

| Persona | Device | Daily reality | What they need most |
|---|---|---|---|
| **Marketing Executive** | Mid-range Android, patchy data, one hand, outdoors in bright sun | 12–15 shops a day on a two-wheeler | Today's list, two taps to record an outcome, nothing that blocks them in the field |
| **Manager** | Android phone, office and field | 4–6 executives, ~180 shops a day | Next-morning exceptions, attendance in under five minutes, delivery follow-up |
| **Company Admin** | Android phone or tablet | Owner or operations head | Masters that stay clean, reports that reconcile, pay that reproduces |
| **System Admin** | Laptop | Platform operator | Create a company, hand over the first admin, stay out of tenant data |
| **Employee** | None | Warehouse or support staff | Only exists for attendance and pay |

---

## 3. Role permission matrix

`C` create · `R` read · `U` update · `D` deactivate · `—` no access

| Capability | System Admin | Company Admin | Manager | Marketing Exec | Employee |
|---|---|---|---|---|---|
| Companies | C R U D | R (own) | — | — | — |
| Company settings | R | R U | R | — | — |
| Users and roles | C (first admin) | C R U D | R | — | — |
| Own profile photo / password | U | U | U | U | — |
| Brands, reasons | — | C R U D | R | R | — |
| Shops | — | C R U D | R | R (assigned) | — |
| Shop pin: first capture | — | C U | U | C (assigned, once) | — |
| Shop pin: correction | — | U | Approve | Request | — |
| Beat plans | — | C R U D | R | R (own) | — |
| Daily assignment | — | R | R, add extra shop | R (own), add extra shop | — |
| Start / end beat | — | R | R | C (own) | — |
| Visits | — | R | R | C (own) | — |
| Distance and range flags | — | R | R | **—** | — |
| Order delivery status | — | U | U | — | — |
| Attendance | — | R U | C R U | — | subject only |
| Salary runs | — | C R U, finalise | R | — | subject only |
| Reports and CSV export | — | R | R (own team) | own totals only | — |
| Audit log | R | R | — | — | — |

**Rule:** the Marketing Executive never sees `distanceMeters`, `isExceedRange` or quality flags, in any screen or API response.

---

## 4. Screen inventory

Numbering matches the design canvas.

| # | Screen | Role | Interactive states |
|---|---|---|---|
| 0 | App logo sheet | — | — |
| 1.1 | Sign in | all | default, error, loading |
| 1.2 | Forgot password (OTP) | all | request, OTP sent, mismatch, success |
| 1.3 | Today's beat | Exec | **not started, running, ending (confirm), ended** |
| 1.4 | Add extra shop | Exec | none selected, selected, empty search |
| 1.5 | My visits | Exec | all / order / no-order tabs |
| 1.6 | My totals | Exec | today / week / month |
| 1.7 | Shop visit | Exec | pin verified, pin missing |
| 1.8 | Capture shop pin | Exec | good accuracy, low accuracy |
| 1.9 | Profile | Exec | default |
| 1.10 | Change password | all | default, mismatch, success |
| 2.1 | Outcome · order | Exec | valid, invalid quantity |
| 2.2 | Outcome · no order | Exec | reason chosen, "Other" without text |
| 2.3 | Confirm & submit | Exec | fresh location, stale/low accuracy, submitting |
| 3.1 | Previous-day report | Manager | default |
| 3.2 | Add shop to today | Manager | none selected, selected |
| 3.3 | Visits list | Manager | all / order / no-order / out-of-range |
| 3.4 | Order visit detail | Manager | to deliver, delivered |
| 3.5 | No-order visit detail | Manager | default |
| 3.6 | Out-of-range visit detail | Manager | order, no-order |
| 3.7 | Attendance day sheet | Manager | default |
| 3.8 | Attendance session edit | Manager | new, amendment |
| 3.9 | Profile | Manager | default |
| 4.1 | Admin home | Admin | menu closed, menu open |
| 4.2 | Visits list | Admin | four filter tabs |
| 4.3–4.5 | Visit details (order, no-order, out-of-range) | Admin | as 3.4–3.6 |
| 4.6 | Beat plans list | Admin | all / unassigned / inactive |
| 4.7 | Beat plan form | Admin | new, edit |
| 4.8 | Shops list | Admin | all / no pin / inactive |
| 4.9 | Shop form | Admin | new, edit |
| 4.10 | Users list | Admin | all / role filters |
| 4.11 | User form | Admin | new, edit |
| 4.12 | Brands & reasons | Admin | two tabs |
| 4.13 | Monthly salary run | Admin | draft, finalised |
| 4.14 | Profile | Admin | default |

The System Admin has no screens in release 1 (see OD-10 in the BRD).

---

## 5. Authentication and account

### FR-AUTH

| ID | Requirement |
|---|---|
| FR-AUTH-01 | The app signs in with **username and password only**. The company comes from the build configuration and is sent with the request. |
| FR-AUTH-02 | Usernames are unique within a company, case-insensitive. |
| FR-AUTH-03 | A successful login returns a short-lived access token and a long-lived refresh token, plus the user's role, company and permissions. |
| FR-AUTH-04 | The refresh token rotates on every use. A reused refresh token invalidates the whole token family and forces a fresh login. |
| FR-AUTH-05 | Users with `status != ACTIVE`, or whose company is suspended, cannot sign in. The message says the account is not active, without revealing which. |
| FR-AUTH-06 | The Employee role cannot sign in at all. |
| FR-AUTH-07 | Six failed attempts for one username within 15 minutes locks login for that username for 15 minutes. Rate limiting is also applied per IP. |
| FR-AUTH-08 | Forgot password: the user enters their username, the server sends a 6-digit OTP to the registered mobile number, valid 10 minutes, 5 attempts, resend allowed after 30 seconds. The screen shows the masked number. |
| FR-AUTH-09 | Password reset and change require the new password twice, minimum 8 characters with at least one letter and one digit, and must differ from the current one. |
| FR-AUTH-10 | Changing a password revokes every other session for that user. |
| FR-AUTH-11 | A user may change their own **photo and password only**. Name and email are read-only and shown with a lock icon. |
| FR-AUTH-12 | Logging out revokes the refresh token on the server and clears the local store and offline queue only after it is empty. If the queue is not empty, warn and keep the session. |

### Error messages (user-facing, distinct per NFR)

| Condition | Message |
|---|---|
| Wrong credentials | "Username or password is incorrect." |
| Inactive account | "This account is not active. Ask your administrator." |
| No connection | "No internet connection. Check your signal and try again." |
| OTP wrong | "That code is not correct. 3 attempts left." |
| OTP expired | "That code has expired. Tap Resend OTP." |
| Server error | "Something went wrong at our end. Try again in a moment." |

---

## 6. Beat day lifecycle — start and end

This is the backbone of the executive's day. Screen 1.3 carries all four states.

### FR-DAY

| ID | Requirement |
|---|---|
| FR-DAY-01 | Each executive has at most one **beat day** record per business day, created when they start the beat. |
| FR-DAY-02 | The "not started" state shows the beat plan name, the stop count (planned + extra), a "Not started" tag and a **Start beat** button. |
| FR-DAY-03 | Starting the beat captures current coordinates, accuracy and device time, and the server stores its own received-at timestamp. Location is required; accuracy is recorded but does not block the start. |
| FR-DAY-04 | Before the beat starts, shop rows are not openable and extra shops cannot be added. The list is still visible so the executive can plan the route. The locked strip reads "Start the beat to record visits and add extra shops." |
| FR-DAY-05 | The "running" state shows progress (completed / total), counts for Pending, Completed, Revisit and Extra, elapsed time, the start time, the shop nearest the start point, and an **End beat** button. |
| FR-DAY-06 | Tapping End beat opens an **inline confirmation in the same card** — never a separate screen. It states the end time, warns about any pending stops by name, and offers **Keep going** and **End beat**. |
| FR-DAY-07 | Ending the beat captures coordinates, accuracy and time the same way as starting, and sets the day to ended. |
| FR-DAY-08 | Once ended, no visit can be created or edited for that business day. The locked strip reads "Beat ended for today. Your list starts again tomorrow morning." |
| FR-DAY-09 | The "ended" state shows start → end times, duration, and the day summary: visited, orders, no-order, not visited. |
| FR-DAY-10 | A beat day can be started once and ended once. A second start or end returns the existing record, not an error. |
| FR-DAY-11 | If an executive never ends the beat, a scheduled job auto-closes the day at a configurable cut-off (default 23:00 company time) and flags it `AUTO_CLOSED`. The manager sees that flag. |
| FR-DAY-12 | Reminders: push at a configurable time if the beat has not started (default 10:30) and if it has not ended (default 20:00). |
| FR-DAY-13 | Start and end times, locations and the auto-close flag are visible to the Manager and Company Admin, and included in the previous-day report. |

**Derived values**

- `elapsed` = now − `startedAt`, shown as `Hh MMm`.
- `duration` = `endedAt` − `startedAt`.
- `notVisited` = stops with status `PENDING` or `SKIPPED` at the moment of ending.

---

## 7. Today's beat and assignments

### FR-ASSIGN

| ID | Requirement |
|---|---|
| FR-ASSIGN-01 | A scheduled job materialises tomorrow's daily assignment for every active executive whose beat plan includes that weekday, in company-local time. |
| FR-ASSIGN-02 | The assignment is a snapshot: shop identity, sequence and the effective radius are copied at creation. Later beat-plan edits never alter it. |
| FR-ASSIGN-03 | Each stop has a status: `PENDING`, `COMPLETED`, `SKIPPED`, `REVISIT`. |
| FR-ASSIGN-04 | Each stop records its source: `PLAN`, `EXEC_EXTRA` or `MANAGER_EXTRA`, plus who added it and when, for the extra sources. |
| FR-ASSIGN-05 | Screen 1.3 orders the list pending-first, then revisit, then completed, with extra shops shown first inside their group and tagged **Extra**. |
| FR-ASSIGN-06 | Each row shows sequence (or `EX` for extra), shop name, status tag, address, pin availability and the previous outcome summary. |
| FR-ASSIGN-07 | Filter tabs: To do, Done, All, each with a live count. |
| FR-ASSIGN-08 | A shop with no approved pin shows "No pin yet — capture first" and opens the capture screen instead of the visit screen. |
| FR-ASSIGN-09 | Pull-to-refresh and a refresh button re-fetch the assignment. |
| FR-ASSIGN-10 | If no assignment exists for today (non-working day, or no beat plan), the screen explains which and offers Add extra shop once the beat is started. |

### FR-EXTRA — extra shops

| ID | Requirement |
|---|---|
| FR-EXTRA-01 | An executive can add a shop to today's list from screen 1.4, only while the beat is running. |
| FR-EXTRA-02 | The screen lists company shops **not already in today's list**, nearest first, with distance, pin status and the beat each belongs to (or "No beat"). |
| FR-EXTRA-03 | Search matches shop name, code and owner name. |
| FR-EXTRA-04 | "Shop not listed — create new" opens the shop form, pre-filled with the current location, and the created shop is added to today as an extra stop. Executive-created shops are marked for Company Admin review. |
| FR-EXTRA-05 | A manager can add an extra shop to a named executive's day from screen 3.2, choosing the executive, searching the shop, and entering a **reason** that is written to the audit log. |
| FR-EXTRA-06 | Adding an extra shop **never** modifies the beat plan, and never affects any other day. |
| FR-EXTRA-07 | An extra stop behaves like any other stop for outcomes, distance checks and reporting, and carries its source tag through every report. |
| FR-EXTRA-08 | A shop already in today's list cannot be added twice; it is filtered out of the picker. |
| FR-EXTRA-09 | The manager's addition triggers a push notification to that executive. |

---

## 8. Shop location capture

### FR-PIN

| ID | Requirement |
|---|---|
| FR-PIN-01 | A shop may exist without coordinates. The first outcome at that shop requires a saved pin. |
| FR-PIN-02 | Screen 1.8 shows an amber banner: this shop has no saved location, stand at the entrance and save the pin before recording an outcome. |
| FR-PIN-03 | The map shows the device position, a draggable pin and an accuracy ring, with address search available. |
| FR-PIN-04 | Accuracy is shown numerically with a verdict chip: "Good enough to save" at or below the company maximum (default 20 m), otherwise "Too low — retry". |
| FR-PIN-05 | **Save shop pin** is disabled while accuracy is worse than the maximum. A Retry GPS button re-reads the position. |
| FR-PIN-06 | Saving records point, accuracy, source (`GPS`, `MAP_SEARCH`, `MANUAL_DRAG`), captured time, captured by, and sets location status to `PENDING_VERIFICATION` or `APPROVED` per company setting. |
| FR-PIN-07 | After saving, the executive continues straight to the visit screen for that shop. |
| FR-PIN-08 | An executive cannot change a saved pin. They may raise a correction request; a Manager or Company Admin approves it, and every change keeps full history with before and after values. |
| FR-PIN-09 | The Company Admin can set a pin from the shop form by map search or drag, which is immediately `APPROVED`. |

---

## 9. Visit and outcome capture

### FR-VISIT

| ID | Requirement |
|---|---|
| FR-VISIT-01 | A visit can be created only for a stop in today's assignment, only while the beat is running, and only when the shop has an approved pin. |
| FR-VISIT-02 | Screen 1.7 shows shop identity, address, pin status, effective radius, owner and phone with a call action. |
| FR-VISIT-03 | The screen shows the **last five completed interactions** at that shop: date, outcome, order summary or reason, who recorded it. Range information is excluded for executives. |
| FR-VISIT-04 | "Sample shown?" is a required Yes / No choice before an outcome. |
| FR-VISIT-05 | The executive records exactly one primary outcome: **Order** or **No order**. |
| FR-VISIT-06 | Order entry (2.1): one or more lines of brand + quantity. Brand comes from the active brand master, ordered by display order. Quantity is a non-negative integer with stepper and keypad entry. At least one line must exceed zero. Duplicate brands in one order are rejected. |
| FR-VISIT-07 | Order entry shows the brand count and total quantity live, and the last five visits as a compact strip. |
| FR-VISIT-08 | No order (2.2): a single active reason from the master, with **Other** always last. Choosing Other makes a free-text field required, 3–280 characters. |
| FR-VISIT-09 | Confirm & submit (2.3) is a bottom sheet showing outcome summary, sample shown, location freshness and accuracy, and the capture time. It warns that a submitted visit cannot be edited. |
| FR-VISIT-10 | At submission the client sends latitude, longitude, accuracy, capture timestamp, device submission timestamp, the mock-location signal if the OS provides it, and an idempotency key. |
| FR-VISIT-11 | The client never sends, and cannot influence, distance or any flag. |
| FR-VISIT-12 | After submission the executive returns straight to **today's list** with the stop marked completed. No distance or range result is shown to them. |
| FR-VISIT-13 | A visit submitted while offline is queued, shown as "Waiting to sync", and flagged `OFFLINE_SUBMISSION` when it reaches the server. The queue syncs automatically on reconnect. |
| FR-VISIT-14 | A stop already completed cannot accept a second outcome unless a manager grants a revisit, which creates a new stop with status `REVISIT`. |

### Location classification — server side, in this order

1. Reject invalid coordinates, an unauthenticated caller, a stop that is not theirs, a beat that is not running, or a duplicate idempotency key.
2. If `accuracyMeters > company.maxAccuracyMeters` → add flag `LOW_ACCURACY`.
3. If `now − capturedAt > company.maxLocationAgeSeconds` → add flag `STALE_LOCATION`.
4. If the platform reported a mock location → add flag `MOCK_LOCATION_SUSPECTED`.
5. If the submission arrived from the offline queue → add flag `OFFLINE_SUBMISSION`.
6. Compute the Haversine distance from the **approved shop coordinates** to the captured point and store `distanceMeters`.
7. `effectiveRadius` = shop override, else company default.
8. `isExceedRange = distanceMeters > effectiveRadius` → when true, add flag `EXCEED_RANGE` and set review status `PENDING_REVIEW`.
9. Persist every fact and flag. Never overwrite them if the shop's coordinates change later.

Pilot calibration: the initial radius is 5 m; test 5, 25, 50 and 100 m before go-live, per company and per shop.

---

## 10. Executive's own history

### FR-MYVISITS / FR-MYTOTALS

| ID | Requirement |
|---|---|
| FR-MY-01 | My visits (1.5) lists the executive's own visits grouped by business day, newest first, with a per-day summary of orders and no-orders. |
| FR-MY-02 | Tabs filter All / Order / No order, with counts. A date-range control defaults to the last 7 days. |
| FR-MY-03 | Each row shows shop, outcome summary and time. **No distance, no flags.** |
| FR-MY-04 | My totals (1.6) switches between Today, This week and This month, and recalculates everything shown. |
| FR-MY-05 | It shows beat completion as a percentage with "visited of assigned", counts for orders, no-order and total quantity, quantity by brand as bars, and orders per day for the current week. |
| FR-MY-06 | Order value is not shown in release 1 (OD-07). |

---

## 11. Manager

### FR-MGR — previous-day report (3.1)

| ID | Requirement |
|---|---|
| FR-MGR-01 | Defaults to the previous business day, all beats, and the manager's own team. |
| FR-MGR-02 | KPI tiles: assigned, visited, pending, order, no-order, out-of-range. Each drills into a filtered visit list. |
| FR-MGR-03 | A within-range bar shows within / exceeded / not visited as proportions, with a legend. |
| FR-MGR-04 | An "Out of range" section lists the flagged visits with shop, executive, outcome, time, flag and distance, and opens the detail screen. |
| FR-MGR-05 | Filters: date, executive, beat, location status. |
| FR-MGR-06 | A violet action bar opens "Add extra shop to today", labelled "One executive, today only · beat plan unchanged". |
| FR-MGR-07 | The report includes beat start and end times per executive and marks days that were auto-closed or never started. |
| FR-MGR-08 | CSV export of the current filtered view. |

### FR-MGR — visits list and details (3.3–3.6)

| ID | Requirement |
|---|---|
| FR-MGR-10 | The visits list filters by **All / Order / No order / Out of range**, with counts, plus date, executive and beat filters. |
| FR-MGR-11 | Each row shows an ORD or NO badge, shop, executive and time, the outcome summary, a delivery or no-order chip, and the distance — marked "· out" when out of range. |
| FR-MGR-12 | Order detail (3.4) shows the delivery status card, order lines with quantities and the total, and visit facts: executive, beat, sample shown, location verdict. |
| FR-MGR-13 | Order detail offers **Mark as delivered**, which records who marked it and when, and then shows "Delivered". Previous and next arrows move through orders one at a time. |
| FR-MGR-14 | No-order detail (3.5) shows this visit's reason and chips for sample shown and location verdict, plus the **last five no-order reasons** at that shop and a note when one reason repeats. |
| FR-MGR-15 | Out-of-range detail (3.6) is read-only: a map with the shop pin, its radius ring and the submitted point, the measured distance against the allowed radius, and the order lines or no-order reason, with accuracy and submission time. |
| FR-MGR-16 | Opening a visit from the Out-of-range tab always shows 3.6; from the Order or No-order tabs it shows 3.4 or 3.5, so an out-of-range order can still be marked delivered. |

### FR-ATT — attendance (3.7, 3.8)

| ID | Requirement |
|---|---|
| FR-ATT-01 | The day sheet lists eligible employees for one business day with a morning and an evening cell each. |
| FR-ATT-02 | Day navigation is previous / next with a "Today" marker. Future dates are not editable. |
| FR-ATT-03 | Summary counts: present, late, absent or leave, not marked. |
| FR-ATT-04 | Each session takes one status: Present, Absent, Leave, Holiday, Weekly Off. |
| FR-ATT-05 | Present requires an actual time, and the lateness flag is derived: On Time, One Hour Delay, Two Hour Delay, against the company's session start times. |
| FR-ATT-06 | Exactly one active record exists per employee, date and session. |
| FR-ATT-07 | Changing an existing record requires a **reason** and creates an audited amendment that preserves the previous value; the editor shows what was recorded before, by whom and when. |
| FR-ATT-08 | Late flags do not change payable units unless a company policy says so (OD-01); the editor states this. |
| FR-ATT-09 | Attendance cells are colour- and text-coded, never colour alone. |

---

## 12. Company Admin

### FR-ADM — home (4.1)

Tiles for Users & roles, Beat plans, Shops, Brands & reasons, Salary and Reports, each with a live count; a today's-assignment banner; a company settings summary (default radius, accuracy and age limits, session start times); and an account menu behind the avatar with a down arrow, offering Profile and Log out. The bottom bar is Home · Visits · Beats · Shops.

### FR-ADM — masters

| ID | Requirement |
|---|---|
| FR-ADM-01 | Users list (4.10): search by name, username or email; filter by role and status; shows initials, role, half-day rate and status. |
| FR-ADM-02 | User form (4.11): photo, status, full name, email, username, temporary password, role, monthly salary, half-day rate and **rate effective-from date**. Login fields are hidden for the Employee role. |
| FR-ADM-03 | Role and rate changes are audited. A rate change creates a new effective-dated row rather than editing the old one. |
| FR-ADM-04 | Shops list (4.8): search by name, code, owner or phone; filter by beat, pin status and active status. |
| FR-ADM-05 | Shop form (4.9): beat plan, shop code, status, name, owner, phone; address line 1 and 2, city, state, PIN code; **shop photos** (up to 3, camera or gallery, with a visible count and a remove action); location by map search or drag with the coordinate source shown, or a "skip — the executive captures it" option; and an optional per-shop radius override that defaults to the company value. |
| FR-ADM-06 | Beat plans list (4.6): name, code, assigned executive, shop count, working days, status; filters for unassigned and inactive. |
| FR-ADM-07 | Beat plan form (4.7): name, code, assigned executive, working-day toggles, and an ordered, reorderable shop list; shops can be added from existing shops or created inline. The form states that changes apply from the next daily assignment and never rewrite past snapshots. |
| FR-ADM-08 | Brands & reasons (4.12): two tabs, each a list with display order, drag-to-reorder, an active switch and an add field. The reason list always keeps **Other** last and non-removable, marked "requires free text". |
| FR-ADM-09 | A master row that is already referenced by history can be deactivated but not deleted. |

### FR-SAL — salary (4.13)

| ID | Requirement |
|---|---|
| FR-SAL-01 | The Company Admin generates the previous month's salary run. Generating twice for an open month replaces the draft. |
| FR-SAL-02 | `salaryAmount` = Σ over the month of (payable half-day units for each session × the half-day rate effective on that date). |
| FR-SAL-03 | The status-to-payable-unit mapping is a company setting (OD-02). Default: Present = 1 unit, Holiday and Weekly Off = 1 unit, Leave and Absent = 0. |
| FR-SAL-04 | The run shows the gross total, the formula, and a line per employee; a mid-month rate change shows as two sub-lines with their own date ranges, units and rates. |
| FR-SAL-05 | Finalising a run locks the month. Later attendance corrections create a **new version** (v2, v3…) and the earlier version stays readable. |
| FR-SAL-06 | A finalise action requires explicit confirmation and states what will be locked. |
| FR-SAL-07 | CSV export per run version. |

---

## 13. Reporting

| ID | Requirement |
|---|---|
| FR-RPT-01 | Previous-day report: assigned, visited, order, no-order, pending, within-range, exceeded-range, plus beat start and end coverage. |
| FR-RPT-02 | Totals drill through to the matching visit list and then to visit detail. |
| FR-RPT-03 | Executive totals for a period: order count, total quantity, completion rate, exception rate, extra-shop count. |
| FR-RPT-04 | Customer (shop) history: every visit at one shop with outcome, reason or order lines, and who recorded it. |
| FR-RPT-05 | Previous-month salary report: payable sessions, rate application per date range, gross amount, run version. |
| FR-RPT-06 | Filters available subject to role: company (System Admin only), date or range, manager, executive, beat, shop, outcome, location status, stop source. |
| FR-RPT-07 | CSV export for Company Admin and Manager. Exports are logged in the audit trail with the filter used. |
| FR-RPT-08 | Every list is paginated by cursor and remains usable at 10,000 shops and 1,000 executives per company. |

---

## 14. Notifications

Push via Firebase Cloud Messaging. Each type can be turned off per company.

| Event | Recipient | Trigger |
|---|---|---|
| `ASSIGNMENT_READY` | Executive | Daily assignment materialised |
| `BEAT_NOT_STARTED` | Executive, then Manager | Configurable time passed with no start (default 10:30) |
| `BEAT_NOT_ENDED` | Executive | Configurable time passed with no end (default 20:00) |
| `EXTRA_SHOP_ADDED` | Executive | Manager added a shop to their day |
| `VISIT_FLAGGED` | Manager | A visit was flagged out of range or mock-location suspected |
| `ORDER_DELIVERED` | Company Admin | Manager marked an order delivered |
| `PIN_CORRECTION_REQUESTED` | Manager | Executive raised a pin correction |
| `SALARY_RUN_READY` | Company Admin | Monthly draft generated |

Notification payloads carry ids and short text only — never coordinates, free-text reasons or personal data.

---

## 15. Analytics events

`day_beat_started`, `day_beat_ended`, `daily_assignment_opened`, `shop_visit_started`, `shop_location_captured`, `location_capture_failed`, `extra_shop_added_by_exec`, `extra_shop_added_by_manager`, `visit_completed_order`, `visit_completed_no_order`, `visit_flagged_distance`, `visit_flagged_accuracy`, `order_marked_delivered`, `attendance_submitted`, `attendance_amended`, `salary_run_completed`, `report_exported`.

Payloads must not contain raw coordinates, free text or credentials.

---

## 16. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | Tenant isolation tests must prove no cross-company read or write, at both the ORM and the database policy layer. |
| NFR-02 | 95th percentile API response under 3 s, excluding poor client networks and third-party map calls. Visit submission under 1.5 s at the 95th percentile. |
| NFR-03 | Daily operational screens stay usable with 10,000 shops and 1,000 executives per company, using indexed, paginated queries. |
| NFR-04 | All command APIs are idempotent and safe for mobile retries. |
| NFR-05 | Timestamps are stored in UTC; business dates are derived in the company timezone. |
| NFR-06 | Production has scheduled backups with a tested restore, and a documented recovery objective. |
| NFR-07 | Personal and location data is encrypted in transit and at rest using platform controls. |
| NFR-08 | User-facing errors distinguish permission, connectivity, invalid input, low accuracy, beat-not-started and duplicate submission. |
| NFR-09 | Accessibility: screen-reader labels, scalable text, 4.5:1 contrast for body text, touch targets at least 44 px, never colour alone to convey state. |
| NFR-10 | Logs must not contain precise coordinates, tokens, passwords or free-text reasons. |
| NFR-11 | Development, staging and production are separate Railway environments with separate databases and Firebase projects. |
| NFR-12 | Automated tests cover authorisation, tenant isolation, distance and flag classification, salary calculation, idempotent retries, timezone boundaries and the beat-day state machine. |
| NFR-13 | The app works on Android 9 and above, and iOS 14 and above. |
| NFR-14 | A cold start to a usable Today screen takes under 3 s on a mid-range Android device with a warm cache. |

---

## 17. UX rules

- The Today screen puts pending shops first and shows sequence, address, pin availability and the previous outcome.
- A missing pin explains plainly that the location must be captured before an outcome.
- Location capture shows accuracy and offers Retry when it is unacceptable.
- The executive is never shown distance, range results or flags.
- No-order reasons are a single-select list with Other last.
- Order entry allows fast numeric entry with a stepper and validates as you type.
- The last five interactions appear without leaving the visit screen.
- Start beat and End beat live in one card on the Today screen; ending asks for confirmation inline.
- Destructive or finalising actions (end beat, finalise salary, deactivate) require confirmation and say what cannot be undone.
- Every role's bottom bar has at most four items; Profile is reached from the avatar menu, not the bottom bar.
- Blue is the primary colour, amber marks warnings and out-of-range, red marks errors and absence, violet marks extra and revisit.

---

## 18. Release plan

| Phase | Contents | Exit criteria |
|---|---|---|
| **P1 — Foundation** | Monorepo, CI, Railway environments, Prisma schema, company and user CRUD, roles, auth with JWT and OTP reset, profile and photo upload, brand and reason masters, audit log skeleton | A Company Admin can sign in on a company build and manage users and masters |
| **P2 — Field operations** | Shops with photos and pins, beat plans, daily assignment job, beat start/end, visit capture with server distance and flags, orders, extra shops | An executive completes a full day end to end, offline included |
| **P3 — Oversight** | Attendance, previous-day report, visits list and the three detail screens, delivery marking, manager extra shop, notifications | A manager runs a full morning review in under 10 minutes |
| **P4 — Workforce and reporting** | Salary runs with versioning, executive totals, customer history, CSV exports, full audit coverage | A month closes and reproduces its total |
| **P5 — Hardening** | Offline policy limits, anomaly detection, radius calibration, load tests at target volumes, backup and restore drill, accessibility pass | NFR targets met and signed off |

---

## 19. Acceptance scenarios

1. A company build signs in with username and password only; the same username in another company is rejected.
2. An executive cannot open a visit before starting the beat; the lock message explains why.
3. Starting the beat records time and location, and the card switches to running.
4. Ending the beat warns about one pending shop by name, and the confirmation happens in the same card.
5. After ending, visit creation is refused by the API, not only hidden in the app.
6. A shop with no coordinates forces pin capture, and the save button stays disabled at 34 m accuracy.
7. An order within the radius is stored with the correct server distance, quantity total and no flags.
8. A no-order 212 m away is saved with its reason, the measured distance and `EXCEED_RANGE`, and appears in the manager's Out-of-range tab.
9. "Other" cannot be saved without text; the error names the field.
10. The executive's own screens never expose distance or flags, verified at the API response level.
11. A retry with the same idempotency key creates exactly one visit and one order.
12. An executive adds an extra shop; the beat plan is byte-identical afterwards, and tomorrow's assignment is unaffected.
13. A manager adds an extra shop with a reason; the executive receives a push and sees it tagged Extra.
14. A manager marks an out-of-range order delivered from the Order tab.
15. Two attendance sessions are recorded, late flags derive correctly, and an amendment keeps the old value with its reason.
16. Salary for a month with a mid-month rate change reproduces the same total twice, and finalising then correcting attendance creates v2 while v1 stays readable.
17. Previous-day, visit-history, executive-total and salary reports reconcile to source records.
18. A visit queued offline syncs on reconnect, carries `OFFLINE_SUBMISSION`, and does not duplicate.
