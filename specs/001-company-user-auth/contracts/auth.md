# Contract: Auth

Base path `/api/v1/auth`. All shapes are Zod schemas in `packages/shared/src/auth.schema.ts`, consumed by both the NestJS DTOs (`nestjs-zod`) and the mobile `react-hook-form` resolvers. Every schema here round-trips (Constitution rule 5).

## `POST /auth/login` — public

**Request**
```ts
{
  companyCode?: string;   // omitted only for a SYSTEM_ADMIN login (see research.md #1)
  username: string;       // 1-64 chars
  password: string;       // 1-128 chars, raw — never logged
}
```

**Response `200`**
```ts
{
  accessToken: string;    // 15 min
  refreshToken: string;   // opaque, 60 days, rotating
  user: { id: string; name: string; role: RoleKey; companyId: string | null; permissions: string[] };
}
```

**Errors**: `INVALID_CREDENTIALS` (401, wrong username/password — identical message either way), `ACCOUNT_INACTIVE` (403, inactive user or suspended company — FR-007), `RATE_LIMITED` (429, lockout after 6 failures / 15 min for that username, FR-010; also per-IP throttling). The `EMPLOYEE` role can never reach a successful response because no `EMPLOYEE` row ever has a `username`/`passwordHash` (FR-008).

## `POST /auth/refresh` — public (presents a refresh token)

**Request**: `{ refreshToken: string }`
**Response `200`**: same shape as login's token pair (new access + new rotated refresh).
**Errors**: `TOKEN_EXPIRED`, `TOKEN_REUSED` (409 — revokes the whole family and forces a fresh login).

## `POST /auth/logout` — any authenticated role

**Request**: `{ refreshToken: string }`
**Response `204`**. Revokes the presented refresh token (FR-023).

## `POST /auth/forgot-password` — public

**Request**: `{ companyCode?: string; username: string }` — `companyCode` is optional, exactly like `POST /auth/login`'s own field (omitted only for a `SYSTEM_ADMIN`). **Correction, found during User Story 4's planning**: an earlier version of this contract omitted `companyCode` entirely, which is unworkable — `User.username` is only unique *within* a company (FR-006 explicitly allows the same username to repeat across different companies), so a bare username has no well-defined target to reset without it. The mobile client supplies the same build-time `COMPANY_CODE` constant `SignInScreen` already sends for login.
**Response `200`**: `{ maskedMobile: string }` — e.g. `"+91•••••••123"`. Always returns `200` with the same shape and timing whether or not the username exists, so usernames cannot be enumerated (Edge Cases, spec.md).
Sends a 6-digit OTP via the `SmsAdapter` (research.md #5) when the username does exist; silently no-ops otherwise.

## `POST /auth/verify-otp` — public

**Request**: `{ companyCode?: string; username: string; code: string }` (`code`: exactly 6 digits; `companyCode` same correction/semantics as `forgot-password` above)
**Response `200`**: `{ resetToken: string }` — short-lived (10 min), single-purpose token for the next call only.
**Errors**: `OTP_INCORRECT` (400, includes `attemptsRemaining`), `OTP_EXPIRED` (410), `OTP_ATTEMPTS_EXHAUSTED` (429 — must request a new code).

## `POST /auth/reset-password` — requires `resetToken` (bearer)

**Request**: `{ resetToken: string; newPassword: string; confirmPassword: string }`
**Response `204`**. Revokes every other active session for that user (FR-014).
**Errors**: `VALIDATION_FAILED` (400 — passwords don't match, or fail the policy in FR-013), `TOKEN_EXPIRED`.

## `POST /auth/change-password` — any authenticated role

**Request**: `{ currentPassword: string; newPassword: string; confirmPassword: string }`
**Response `204`**. Revokes every other active session for that user (FR-014).
**Errors**: `INVALID_CREDENTIALS` (401 — wrong current password; `packages/shared/src/errors.ts`'s `ERROR_STATUS` fixes one status per code globally, overriding this file's own earlier `400`), `VALIDATION_FAILED` (new password fails FR-013's policy or matches the current one).

All five mutating endpoints above (`reset-password`, `change-password`, and anything under Companies/Users below) require an `Idempotency-Key` header; see `data-model.md`'s `IdempotencyKey` note.
