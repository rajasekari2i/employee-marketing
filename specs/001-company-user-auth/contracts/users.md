# Contract: Users

Base path `/api/v1/users`. Company Admin only, tenant-scoped (the Prisma extension injects `companyId` from the request's CLS context on every operation — a Company Admin can never pass another company's id).

## `GET /users` — Company Admin

**Query**: `?cursor=&limit=&search=&role=&status=`
- `search` matches name, username or email (FR-015).
- `role` ∈ `COMPANY_ADMIN | MANAGER | MARKETING_EXECUTIVE | EMPLOYEE` (System Admin is never listed — it isn't a member of any company).
- `status` ∈ `ACTIVE | INACTIVE`.

**Response `200`**
```ts
{
  items: Array<{
    id: string; name: string; role: RoleKey; status: UserStatus;
    username: string | null;      // null for EMPLOYEE
    email: string | null;
    monthlySalary: string | null; // decimal as string
    halfDayRate: string | null;   // current (open-ended) rate, decimal as string
    rateEffectiveFrom: string | null; // that rate's effective-from date, ISO "YYYY-MM-DD"; null iff halfDayRate is
    photoUrl: string | null;
  }>;
  nextCursor: string | null;
}
```

## `POST /users` — Company Admin

Requires `Idempotency-Key`.

**Request**
```ts
{
  name: string;
  email?: string;
  role: "COMPANY_ADMIN" | "MANAGER" | "MARKETING_EXECUTIVE" | "EMPLOYEE";
  status?: "ACTIVE" | "INACTIVE";       // default ACTIVE
  photoFileId?: string;                 // from a prior POST /me/photo-style upload, see files.md
  monthlySalary?: string;               // decimal as string
  halfDayRate?: string;                 // decimal as string
  rateEffectiveFrom?: string;           // ISO date, required if halfDayRate is present
  // required only when role != "EMPLOYEE" (FR-017):
  username?: string;
  temporaryPassword?: string;
  mobile?: string;                      // required when role != EMPLOYEE, for their own OTP resets
}
```

Server-side (never accepted from the client, per FR-025): `id`, `companyId`, `tokenVersion`, `passwordHash` (derived from `temporaryPassword`), `createdAt`.

**Response `201`**: the created user, same shape as one `GET /users` item.

**Errors**:
- `VALIDATION_FAILED` (400) — e.g. `username`/`temporaryPassword` missing for a non-Employee role, or present for an Employee role (FR-017); password fails the FR-013 policy.
- `USERNAME_TAKEN` (409) — duplicate within this company (FR-006, FR-018).
- `IDEMPOTENCY_KEY_REUSED` (409).

## `PATCH /users/:id` — Company Admin

**Request** (all optional): `{ name?, email?, role?, status?, username?, photoFileId?, monthlySalary? }` plus the two rate-change fields below.

**Username change**: re-runs the same case-insensitive per-company uniqueness check as `POST /users`, excluding the user's own row, and returns `USERNAME_TAKEN` (409) on a collision. The password is untouched.

**Role change**: `role` accepts the same four tenant-assignable keys as `POST /users` — `SYSTEM_ADMIN` is not among them, so a Company Admin cannot mint one here. Any transition between those four is allowed, including to and from `EMPLOYEE`, with two behaviours worth stating explicitly:

- **Credentials are kept, not cleared.** Demoting a user to `EMPLOYEE` leaves their `username`/`passwordHash` in place but dormant, so restoring their previous role later gives back the login they already had. This means FR-017's "an EMPLOYEE row has no credentials" holds for rows as *created*, but not for rows as *updated* — `auth.md`'s credential paths (`login`, `refresh`, `forgot-password`, `verify-otp`) therefore gate on the user's **role**, not on the presence of a stored hash. A demoted user is rejected at login through the same branch and the same `INVALID_CREDENTIALS` message as a wrong password, per FR-007.
- **`tokenVersion` is not bumped.** `role` and `permissions` are claims in the 15-minute access token, so a role change reaches the user on their next token refresh rather than immediately. The refresh itself is refused for a demoted user, so a demotion ends the session within one access-token lifetime rather than instantly.

**Giving a promoted user their first login** takes two calls, not one: `PATCH` sets the role and `username`, then `POST /users/:id/password` (below) sets the password. `PATCH` deliberately carries no password field of its own — see that route for why it is separate.

**Rate change**: `{ halfDayRate: string; rateEffectiveFrom: string }` — never edits the existing `UserSalaryRate` row; closes it and inserts a new open-ended one (FR-020, see `data-model.md`).

**Response `200`**: the updated user.

**Deactivation**: `PATCH /users/:id` with `{ status: "INACTIVE" }` — blocks sign-in immediately (bumps `tokenVersion` so outstanding access tokens stop working too), keeps every other field and all history (FR-019).

**Errors**: `NOT_FOUND` (404 — including a cross-tenant id, which the tenant extension makes indistinguishable from "doesn't exist"), `VALIDATION_FAILED`, `USERNAME_TAKEN` (409).

## `POST /users/:id/password` — Company Admin

Requires `Idempotency-Key`. Sets another user's password, for the two cases the app otherwise has no answer for: a user promoted out of `EMPLOYEE` who has never had one, and anyone locked out who cannot complete the SMS OTP reset themselves.

**Request**
```ts
{ newPassword: string }   // same passwordPolicySchema / FR-013 bar as a user-chosen password
```

**Response `200`**: `{ revokedSessions: number }` — same shape as `revoke-sessions` below, because this ends every session too.

- **Named `newPassword`, not `temporaryPassword`.** `newPassword` is already one of `deep-redact.ts`'s `SENSITIVE_KEYS`, so the value is censored from every request log line by the logger already wired up, with nothing further to remember (Constitution rule 9). It also matches `/auth/change-password`'s field name.
- **Every session ends** — `tokenVersion` bump plus a full refresh-token revoke, the same path as `revoke-sessions`. This is FR-014, which does not distinguish who performed the change, and it is what makes the route safe to use on a lost or shared device.
- **No `currentPassword`.** The admin is not the account holder and cannot know it; `@Roles('COMPANY_ADMIN')` plus the tenant-scoped lookup is the authorisation, and `@Audited('user.password.set')` records who did it. `AuditInterceptor` persists the handler's *result*, never the request body, so the plaintext never reaches the audit table.
- **Allowed against an `EMPLOYEE` too.** The stored credential is dormant and unusable while the role says so (`auth.service.ts`'s `roleCanSignIn`), and refusing it would force role and password to be set in one specific order when promoting someone.

**Not covered**: there is no "must change on next sign-in" flag on `User`, so an admin-set password stays valid until the user changes it themselves. Adding one would need a schema migration.

**Errors**: `VALIDATION_FAILED` (400 — fails the FR-013 policy), `NOT_FOUND` (404 — including a cross-tenant id), `IDEMPOTENCY_KEY_REUSED` (409).

## `POST /users/:id/revoke-sessions` — Company Admin

Requires `Idempotency-Key`. Signs the target user out of every device they are currently signed in on.

**Request**: no body.

**Response `200`**
```ts
{ revokedSessions: number }  // active RefreshToken rows revoked — a floor on the device count, not a census
```

Two things happen together, and neither is sufficient alone:

- `User.tokenVersion` is incremented, so every **access** token already issued to that user fails `ActiveAccountGuard` on its next request, rather than staying usable for the remainder of its 15 minutes.
- Every active `RefreshToken` row for that user is revoked (reusing `TokenService.revokeAllRefreshTokens`, the same call behind FR-014's password-reset rule). Without this, an un-revoked refresh token would simply mint a fresh access token carrying the new `tokenVersion` and the sign-out would last one round trip.

Replaying the call is harmless: it bumps `tokenVersion` again and finds no un-revoked rows left, returning `revokedSessions: 0`.

A Company Admin may aim this at their own id; the effect is simply that they are signed out too, on the device they are holding along with the rest. The mobile confirmation says so before proceeding.

**Errors**: `NOT_FOUND` (404 — including a cross-tenant id), `IDEMPOTENCY_KEY_REUSED` (409).

## `POST /users/:id/salary-rates` — Company Admin

Convenience alias for the rate-change half of `PATCH /users/:id` above, matching the API surface table in Architecture §9 exactly. Same request/response/validation.
