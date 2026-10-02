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

**Request**: `{ username: string }`
**Response `200`**: `{ maskedMobile: string }` — e.g. `"+91•••••••123"`. Always returns `200` with the same shape and timing whether or not the username exists, so usernames cannot be enumerated (Edge Cases, spec.md).
Sends a 6-digit OTP via the `SmsAdapter` (research.md #5) when the username does exist; silently no-ops otherwise.

## `POST /auth/verify-otp` — public

**Request**: `{ username: string; code: string }` (`code`: exactly 6 digits)
**Response `200`**: `{ resetToken: string }` — short-lived (10 min), single-purpose token for the next call only.
**Errors**: `OTP_INCORRECT` (400, includes `attemptsRemaining`), `OTP_EXPIRED` (410), `OTP_ATTEMPTS_EXHAUSTED` (429 — must request a new code).

## `POST /auth/reset-password` — requires `resetToken` (bearer)

**Request**: `{ resetToken: string; newPassword: string; confirmPassword: string }`
**Response `204`**. Revokes every other active session for that user (FR-014).
**Errors**: `VALIDATION_FAILED` (400 — passwords don't match, or fail the policy in FR-013), `TOKEN_EXPIRED`.

## `POST /auth/change-password` — any authenticated role

**Request**: `{ currentPassword: string; newPassword: string; confirmPassword: string }`
**Response `204`**. Revokes every other active session for that user (FR-014).
**Errors**: `INVALID_CREDENTIALS` (400 — wrong current password), `VALIDATION_FAILED` (new password fails FR-013's policy or matches the current one).

All five mutating endpoints above (`reset-password`, `change-password`, and anything under Companies/Users below) require an `Idempotency-Key` header; see `data-model.md`'s `IdempotencyKey` note.
