# Contract: Companies

Base path `/api/v1/companies`. System Admin only (`@Roles('SYSTEM_ADMIN')`), bypasses the tenant interceptor via `@SkipTenant()` (Architecture §5).

## `POST /companies` — System Admin

Creates the company **and** its first Company Admin atomically (research.md #3). Requires `Idempotency-Key`.

**Request**
```ts
{
  code: string;            // unique platform-wide, immutable
  name: string;
  place?: string;
  contactEmail?: string;
  contactPhone?: string;
  timezone?: string;       // default "Asia/Kolkata"
  admin: {
    name: string;
    email?: string;
    username: string;      // unique within this new company
    temporaryPassword: string;  // same policy as FR-013
    mobile?: string;       // for their own future OTP resets
  };
}
```

**Response `201`**
```ts
{
  company: { id: string; code: string; name: string; status: "ACTIVE"; timezone: string };
  admin: { id: string; username: string; role: "COMPANY_ADMIN" };
}
```

**Errors**: `VALIDATION_FAILED` (400), `COMPANY_CODE_TAKEN` (409 — FR-003), `IDEMPOTENCY_KEY_REUSED` (409, different body replayed under the same key).

**Side effects**: inserts `CompanySettings` with architecture defaults, seeds the four tenant-scoped `Role` rows for this company (`COMPANY_ADMIN`, `MANAGER`, `MARKETING_EXECUTIVE`, `EMPLOYEE` — the platform-wide `SYSTEM_ADMIN` role is seeded once, separately, not per company), inserts the admin `User` with an open-ended `UserSalaryRate` row only if a rate was supplied (optional at bootstrap), writes one `AuditEvent`.

## `GET /companies` — System Admin

Paginated (`?cursor=&limit=`) list of every company — `{ id, code, name, status, timezone, createdAt }[]`. No filters needed yet; this slice has one pilot company.

## `PATCH /companies/:id` — System Admin

**Request** (all optional): `{ name?: string; place?: string; contactEmail?: string; contactPhone?: string; status?: "ACTIVE" | "SUSPENDED" }`
**Response `200`**: the updated company. Setting `status: "SUSPENDED"` takes effect on each affected user's **next** sign-in attempt (FR-007) — it does not need to revoke already-issued access tokens immediately, since those expire within 15 minutes regardless.
