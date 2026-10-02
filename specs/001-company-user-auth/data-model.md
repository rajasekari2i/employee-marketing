# Phase 1 Data Model: Company Provisioning, User Management & Sign-In

Scope: only the entities this slice reads or writes. Full field lists and every other model live in Architecture §7 (`docs/product/03-ARCHITECTURE.md`) — this is the subset, with the validation rules this feature's requirements add on top of the schema.

## Company

Represents one distributor business (e.g. "Sri Ramana Traders"). Created only via `POST /companies` (System Admin).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `code` | string, unique platform-wide | Baked into the mobile build; immutable after creation (FR-001, FR-003) |
| `name` | string | |
| `place` | string? | |
| `contactEmail` / `contactPhone` | string? | |
| `timezone` | string | Default `Asia/Kolkata` |
| `status` | `ACTIVE` \| `SUSPENDED` | Suspension blocks sign-in for every user in the company (FR-007), even the Company Admin |

**Relationships**: one `CompanySettings` (1:1, created with sensible defaults at the same time, even though this slice does not expose settings editing); many `User`.

**Validation**: `code` uniqueness is enforced at the database and rechecked in the handler so a duplicate request fails clearly (FR-003) rather than as a raw constraint error.

## CompanySettings

Created automatically alongside `Company` with architecture's documented defaults (`defaultRadiusMeters=5`, `maxAccuracyMeters=20`, …, see Architecture §7). This slice does not add an endpoint to edit it — that belongs to the masters/settings work in later slices — but the row must exist, because `CompanySettings.companyId` is the primary key and later slices assume every company already has one.

## Role

Seeded, not user-editable in this slice.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `key` | `SYSTEM_ADMIN` \| `COMPANY_ADMIN` \| `MANAGER` \| `MARKETING_EXECUTIVE` \| `EMPLOYEE` | |
| `companyId` | uuid? | `null` = platform-wide seeded role, used by every company until a company-custom role exists (none in release 1) |
| `permissions` | string[] | `resource:action:scope` strings, seeded from the matrix in PRD §3 |

**Validation**: exactly one `Role` row per `(companyId, key)` pair (`@@unique`). A company's five roles are seeded the moment the company is created, so `POST /companies` also inserts them.

## User

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `companyId` | uuid? | `null` only for `SYSTEM_ADMIN` (FR-004) |
| `roleId` | uuid (FK Role) | Exactly one role (BUS-02) |
| `name` | string | Read-only to the user themself after creation (FR-021) |
| `email` | string? | Read-only to the user themself after creation (FR-021) |
| `username` | string | Unique within `(companyId)`, case-insensitive (FR-006); **absent** for `EMPLOYEE` |
| `passwordHash` | string | argon2id; **absent** for `EMPLOYEE` |
| `mobile` | string? | Registered number for OTP delivery (FR-011) |
| `photoId` | uuid? (FK FileObject) | `PhotoKind.USER_AVATAR` |
| `status` | `ACTIVE` \| `INACTIVE` | Deactivation blocks sign-in immediately, keeps the row (FR-019) |
| `monthlySalary` | decimal? | Captured at creation for every role except `EMPLOYEE`'s login-less record where it still applies for payroll purposes |
| `tokenVersion` | int, default 0 | Bumped on password change or deactivation; invalidates outstanding access tokens without a DB lookup per request |
| `lastLoginAt` | timestamptz? | |

**State transitions**: `ACTIVE → INACTIVE` (deactivate, FR-019) and back (`INACTIVE → ACTIVE`, reactivation — not explicitly required by this feature's stories but the field supports it for later admin convenience). No other status exists in this slice.

**Validation**:
- `username` + `passwordHash` required when `role.key != EMPLOYEE`; both must be absent/null when `role.key == EMPLOYEE` (FR-017).
- Duplicate `(companyId, lower(username))` rejected on create (FR-006, FR-018).
- Password policy (create, change, reset — same rule everywhere, FR-013): minimum 8 characters, at least one letter and one digit, must differ from the current password where one already exists.

## UserSalaryRate

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid (FK User) | |
| `halfDayRate` | decimal | |
| `effectiveFrom` | date | |
| `effectiveTo` | date? | `null` = open-ended (current rate) |
| `createdByUserId` | uuid | Always the acting Company Admin |

**Validation**: creating a user with an initial half-day rate inserts one open-ended row; **changing** a user's rate later never edits that row — it closes it (`effectiveTo = new row's effectiveFrom − 1 day`) and inserts a new open-ended one (FR-020, BUS-19). This slice's user form only needs to support the create case; the architecture's effective-dating shape is still followed from day one so historical reproducibility is never retrofitted.

## RefreshToken

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid (FK User) | |
| `familyId` | uuid | Shared by every token descended from one login |
| `tokenHash` | string, unique | argon2id hash of the opaque refresh value; the raw value is never stored |
| `usedAt` / `revokedAt` / `expiresAt` | timestamptz | |

**State transitions**: `issued → used` (consumed by `/auth/refresh`, which issues a new row in the same family) → either `active` (new row) or, if a *used* token is presented again, every row in that `familyId` is `revokedAt`-stamped (`TOKEN_REUSED`, FR-009's reuse-detection rule).

## OtpChallenge

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid (FK User) | |
| `codeHash` | string | Hash of the 6-digit code; raw code is never stored |
| `purpose` | string | `PASSWORD_RESET` for this slice |
| `attempts` | int, default 0 | Capped at 5 (FR-012) |
| `consumedAt` | timestamptz? | Set once a correct code is accepted |
| `expiresAt` | timestamptz | `createdAt + 10 minutes` (FR-012) |

**State transitions**: `requested → (consumed | expired | attempts-exhausted)`. A resend before 30 seconds have passed since the previous `createdAt` is rejected rather than creating a second live challenge (FR-012).

## FileObject (avatar only, in this slice)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `companyId` | uuid? | Matches the owning user's company |
| `kind` | `USER_AVATAR` (this slice never writes `SHOP`) | |
| `storageKey` | string, unique | `photos/<companyId>/<yyyy>/<mm>/<uuid>.webp` |
| `sha256` | string | An identical photo re-uploaded by the same company reuses the existing row rather than duplicating storage |
| `uploadedBy` | uuid | |

## IdempotencyKey

Not a feature-specific model but every command in this slice (`POST /companies`, `POST /users`, `POST /auth/change-password`, `POST /auth/reset-password`) writes one row keyed by the client-supplied `Idempotency-Key`, per Architecture §11. A retry with the same key and the same request body replays the stored response; a retry with the same key and a **different** body is rejected (`IDEMPOTENCY_KEY_REUSED`).

## AuditEvent

Every `User` creation, role assignment, status change and salary-rate change writes one `AuditEvent` row (actor, action, entity, before/after, timestamp) in the same transaction as the change, per FR-020 and Architecture §18. No new shape beyond what Architecture §7 already defines — this slice is simply one of its writers.

## Entity relationship summary

```
Company 1───1 CompanySettings
Company 1───* Role (companyId null = platform-wide, shared by all companies)
Company 1───* User
Role    1───* User
User    1───* UserSalaryRate
User    1───* RefreshToken (grouped by familyId)
User    1───* OtpChallenge
User    0───1 FileObject (photoId, kind=USER_AVATAR)
User    1───* AuditEvent (as actor or as subject)
```

Tenant-isolation note (Constitution rule 2): `User` and the avatar `FileObject` carry `companyId` and are covered by both the Prisma extension and Postgres RLS. `Company`, `Role`, `RefreshToken`, `OtpChallenge`, `AuditEvent` and `IdempotencyKey` are the architecture's documented RLS exemptions (Architecture §5) — guarded by handler-level checks (e.g. a `RefreshToken` lookup always joins through its owning `userId`, never trusts a bare id from the client).
