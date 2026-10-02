# Feature Specification: Company Provisioning, User Management & Sign-In

**Feature Branch**: `001-company-user-auth`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "We are build Mobile application, Frontend React Native & Tailwind CSS. Backend Node.js, NestJS, Prisma ORM. Database PostgresSQL, Mobile Notification using Firebase, authentication Stateless JWT (access + refresh token), Login using user name and paswrod. Base setup of the frontend Mobile application & backend api with user module, company module. Company module creates companies (e.g. Ramana Traders); phase 1 has no mobile UI for it — API only, used to create a company and its first Company Admin. User module holds user basic details (design screen 4.11). Login with username and password, role-based screens starting with Company Admin, beginning with User Creation. Forgot password (OTP) screen. App logo. Profile page for Company Admin. Home screen with avatar, dropdown, profile and logout."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provision a company and its first administrator (Priority: P1)

A platform operator (System Admin) sets up a new distributor company (e.g. "Sri Ramana Traders") and creates its first Company Admin account, so that company has an identity in the system and someone who can sign in to start configuring it.

**Why this priority**: Nothing else in this feature — sign-in, user management, profiles — is reachable without a company and at least one user existing first. This is the seed of every other story.

**Independent Test**: Can be fully tested by calling the provisioning capability with a company's details and an administrator's details, and confirming the company exists, is isolated from any other company, and its administrator can be looked up by username within that company.

**Acceptance Scenarios**:

1. **Given** no company named "Sri Ramana Traders" exists, **When** a System Admin provisions it with company code, name, place, contact details and timezone, **Then** the company is created with an active status and no other company's data is affected.
2. **Given** a newly created company, **When** the System Admin provisions its first Company Admin with name, email, username and a temporary password, **Then** that admin belongs only to that company and can be found by username within it.
3. **Given** a company code that is already in use, **When** a System Admin tries to provision another company with the same code, **Then** the request is rejected and no duplicate company is created.
4. **Given** two companies each with an admin sharing the same username, **When** either admin signs in on their own company's app, **Then** each reaches only their own company's data.

---

### User Story 2 - Sign in and reach the right home screen (Priority: P2)

Any eligible user (Company Admin, Manager or Marketing Executive) opens the company's mobile app and signs in with just a username and password — the company itself is implicit because each company has its own app build — and lands on a screen appropriate to their role. A Company Admin reaches a home screen showing their name with a profile/logout menu.

**Why this priority**: Sign-in is the gateway to every other capability in the product. It must work before user management or profile screens have any meaning.

**Independent Test**: Can be fully tested by signing in with a known active user's username and password and confirming a session is issued and the correct landing screen appears; and by attempting sign-in with a wrong password, an inactive account, or an Employee account and confirming each is refused with an appropriate message.

**Acceptance Scenarios**:

1. **Given** an active Company Admin with a known username and password, **When** they sign in, **Then** they receive a valid session and land on the Company Admin home screen showing their name and an avatar menu with Profile and Log out.
2. **Given** a correct username with a wrong password, **When** the user attempts to sign in, **Then** sign-in is refused with a generic "username or password is incorrect" message and no session is issued.
3. **Given** a deactivated user, **When** they attempt to sign in with correct credentials, **Then** sign-in is refused with a message that the account is not active, without stating whether the username or password was the problem.
4. **Given** the Employee role has no login credentials, **When** anyone attempts to sign in as an Employee, **Then** sign-in always fails.
5. **Given** six wrong-password attempts for one username within 15 minutes, **When** a seventh attempt is made, **Then** sign-in for that username is temporarily blocked even with the correct password.
6. **Given** a signed-in user taps Log out, **When** the action completes, **Then** their session is ended and they are returned to the sign-in screen.

---

### User Story 3 - Company Admin manages users, starting with creating one (Priority: P3)

A Company Admin opens Users from their home screen, sees the existing users in their company, and creates a new user — a Manager or Marketing Executive, typically — by entering their basic details, role, status and pay-related fields, so the new person can be given credentials and start working.

**Why this priority**: The user explicitly wants user creation built right after login/home, as the first Company-Admin capability. A company is useless without the ability to add the people who will work in it.

**Independent Test**: Can be fully tested by signing in as a Company Admin, opening the users list, creating a new user with a role and basic details, and confirming the new user appears in the list and can themselves sign in (if their role allows login).

**Acceptance Scenarios**:

1. **Given** a signed-in Company Admin, **When** they open Users, **Then** they see every user in their own company only, with name, role, status and half-day rate, searchable by name, username or email and filterable by role and status.
2. **Given** the Company Admin is creating a new user, **When** they select a role other than Employee, **Then** the form requires a username and a temporary password in addition to name, email, status, photo, monthly salary, half-day rate and the rate's effective-from date.
3. **Given** the Company Admin is creating a new user, **When** they select the Employee role, **Then** the username and password fields are hidden, since Employees never sign in.
4. **Given** a username already used by another user in the same company, **When** the Company Admin tries to save a new user with that username, **Then** the save is rejected and the existing user is unaffected.
5. **Given** a user created successfully, **When** the Company Admin returns to the users list, **Then** the new user appears without a page reload being required to find them.
6. **Given** an existing user who no longer works at the company, **When** the Company Admin deactivates them, **Then** that user can no longer sign in, but their history and record remain visible to the Company Admin.

---

### User Story 4 - View and update own profile, recover a forgotten password (Priority: P4)

Any signed-in user can view their own profile — including fields that are locked, like name and email — and change their own photo and password. Someone who has forgotten their password can recover access from the sign-in screen using a one-time code sent to their registered mobile number.

**Why this priority**: These are supporting, self-service capabilities. They matter for day-to-day usability but nothing else in this feature depends on them.

**Independent Test**: Can be fully tested by opening the profile screen as any signed-in role and changing the password, and separately by running the forgot-password flow for a user who does not know their current password.

**Acceptance Scenarios**:

1. **Given** a signed-in Company Admin, **When** they open Profile, **Then** they see their name, email, role, status and photo, with name and email shown as read-only.
2. **Given** a signed-in user on the Profile or Change password screen, **When** they submit a new password twice correctly (minimum 8 characters, at least one letter and one digit, different from the current password), **Then** the password is updated and every other active session for that user is ended.
3. **Given** a user who cannot remember their password, **When** they enter their username on the sign-in screen's "Forgot password" link, **Then** a 6-digit code is sent to their registered mobile number and the screen shows the number masked.
4. **Given** a one-time code has been sent, **When** the user enters it correctly within 10 minutes, **Then** they can set a new password and sign in with it.
5. **Given** a one-time code has been sent, **When** the user enters an incorrect code, **Then** they are told the code is wrong and shown how many attempts remain, up to 5 attempts.
6. **Given** a one-time code has expired, **When** the user tries to use it, **Then** they are told it has expired and offered a way to resend a new one, available 30 seconds after the previous send.

---

### Edge Cases

- What happens when a Company Admin tries to create a user with a role the company does not otherwise use (e.g. a second Company Admin)? The system allows it — release 1 has no limit on how many Company Admins a company may have.
- What happens when the company itself is suspended? Every user in that company — including the Company Admin — is refused sign-in, even with correct credentials.
- What happens if someone requests a password-reset code for a username that does not exist? The screen behaves the same as if it existed (same message, same timing), so usernames cannot be discovered this way.
- What happens if a user's role is changed after they already have an active session? Their existing access session keeps working until it naturally expires or a password/role change explicitly revokes it; the change takes effect on their next sign-in at the latest.
- What happens when two administrators try to create a user with the same username in the same company at the same moment? Exactly one save succeeds; the other is rejected as a duplicate.
- What happens if someone edits a user's monthly salary or half-day rate? The change is recorded as a new, dated entry rather than silently overwriting the previous value, so past history stays intact.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a System Admin to provision a new company with a unique company code, name, place, contact email/phone and timezone.
- **FR-002**: System MUST allow a System Admin to create the first Company Admin for a newly provisioned company, supplying name, email, username and a temporary password.
- **FR-003**: System MUST reject provisioning of a company whose code is already in use by another company.
- **FR-004**: System MUST keep every company's users, settings and data completely isolated from every other company; no action in one company may read or change another company's records.
- **FR-005**: System MUST allow sign-in using only a username and password; the company identity is supplied implicitly by the company's own app build, never typed by the user.
- **FR-006**: Usernames MUST be unique within a company (case-insensitive) but may repeat across different companies.
- **FR-007**: System MUST refuse sign-in for a user whose status is not active, or whose company is suspended, using a message that does not reveal which of those is the cause.
- **FR-008**: System MUST NOT allow the Employee role to sign in under any circumstance.
- **FR-009**: A successful sign-in MUST issue the user a session consisting of a short-lived access credential and a longer-lived, rotating refresh credential, tied to their role and company.
- **FR-010**: System MUST lock sign-in for a given username for 15 minutes after 6 consecutive failed attempts within that window.
- **FR-011**: System MUST let a user request a password reset by username; it sends a 6-digit one-time code to that user's registered mobile number and displays the number masked.
- **FR-012**: The one-time code MUST expire 10 minutes after it is sent, allow at most 5 verification attempts, and allow a resend no sooner than 30 seconds after the previous send.
- **FR-013**: System MUST require a new password to be entered twice and MUST reject it unless it is at least 8 characters with at least one letter and one digit, and differs from the user's current password — both when resetting via a one-time code and when changing a known password.
- **FR-014**: Completing a password reset or change MUST end every other active session the user currently holds.
- **FR-015**: System MUST let a Company Admin view a list of every user in their own company, searchable by name, username or email, and filterable by role and status.
- **FR-016**: System MUST let a Company Admin create a new user, capturing photo, full name, email, status, role, monthly salary, half-day rate and that rate's effective-from date.
- **FR-017**: System MUST additionally require username and a temporary password when creating a user whose role can sign in (every role except Employee), and MUST hide those fields when the role is Employee.
- **FR-018**: System MUST reject creating a user with a username already used by another active or inactive user in the same company.
- **FR-019**: System MUST let a Company Admin deactivate a user; deactivation MUST immediately block that user's sign-in while preserving their existing record and history unchanged.
- **FR-020**: System MUST record every change to a user's role or half-day rate as a new, dated entry rather than overwriting the prior value, so past history and past calculations remain reproducible.
- **FR-021**: System MUST let any signed-in user view their own profile, showing name, email, role and status, with name and email presented as read-only.
- **FR-022**: System MUST let any signed-in user change only their own photo and password from their profile; no user may change their own name, email or role.
- **FR-023**: System MUST let any signed-in user sign out, ending their current session.
- **FR-024**: The Company Admin home screen MUST display the signed-in user's name together with a menu (reachable from their avatar) offering Profile and Log out.
- **FR-025**: System MUST compute and assign every role, company association, session validity and audit record itself; it MUST NOT accept or trust any such value if supplied by the client making the request.
- **FR-026**: System MUST display the product's logo on the sign-in screen.

### Key Entities

- **Company**: A single distributor business using the product (e.g. "Sri Ramana Traders"). Holds a unique code (ties it to one mobile app build), name, place, contact details, timezone and an active/suspended status. Owns all of its users and settings; never shares data with another company.
- **User**: A person with access tied to exactly one company and exactly one role (System Admin, Company Admin, Manager, Marketing Executive or Employee). Holds name, email, username, status, optional photo, monthly salary, and a half-day pay rate that can change over time without losing earlier values. Only roles other than Employee hold sign-in credentials.
- **Role**: One of the five fixed access levels that determines what a user can see and do; every user has exactly one.
- **Password Reset Request**: A time-boxed, attempt-limited one-time code tied to one user and their registered mobile number, used to regain access without an existing password.
- **Session**: The result of a successful sign-in — a short-lived credential for ongoing access and a longer-lived one for silently extending it, both tied to one user, one company and one role, and both revocable (by logout, password change or deactivation).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A platform operator can provision a new company and its first administrator, end to end, in under 5 minutes.
- **SC-002**: An eligible user can sign in and reach their role's home screen in under 3 seconds on a stable connection.
- **SC-003**: 100% of sign-in attempts by inactive users, suspended-company users, or the Employee role are refused, with zero sessions ever issued to them.
- **SC-004**: A Company Admin can create a new user and find that user in the users list, within the same working session, with zero duplicate usernames ever accepted inside one company.
- **SC-005**: A user who forgets their password can regain access through the one-time-code flow in under 3 minutes without contacting an administrator.
- **SC-006**: Across testing, zero instances occur of one company's user, company-setting or profile data being visible or editable from another company.
- **SC-007**: 100% of password changes and resets immediately end every other session the affected user was holding.

## Assumptions

- Company provisioning and the first Company Admin are created through the platform's API only in this phase; no mobile screen is built for creating a company, consistent with the System Admin having no mobile screens in release 1.
- This feature builds the Company Admin's own screens first: sign-in, forgot password, home, profile and the users list/creation form. Manager and Marketing Executive accounts can be created and can sign in, but their own role-specific home screens are out of scope here and follow in later work.
- Employee user records exist for attendance/pay purposes but never receive login credentials and are never shown a sign-in path; they are created through the same user form with login fields hidden.
- The "create a new user" screen and the "edit an existing user" screen are the same form in two states (new vs. edit), so editing a user's basic details is included alongside creation; the Company Admin request specifically prioritizes creation as the first capability to be usable.
- Delivery of the password-reset one-time code depends on an SMS gateway; in non-production environments this may be stubbed, with the real provider wired in before go-live.
- The application logo is a static brand asset with no configurable behavior in this feature.
- "Monthly salary" and "half-day rate" are captured at user-creation time for every signing-in role, matching the design form, even though salary calculation itself is a separate, later capability.
