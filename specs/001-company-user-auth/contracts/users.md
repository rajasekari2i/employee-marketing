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
    halfDayRate: string | null;   // current (open-ended) rate, decimal as string
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

**Request** (all optional): `{ name?, email?, status?, photoFileId?, monthlySalary? }` plus the two rate-change fields below. Role is **not** patchable here in this slice (changing someone's role is a bigger decision than this form covers; no story requires it yet).

**Rate change**: `{ halfDayRate: string; rateEffectiveFrom: string }` — never edits the existing `UserSalaryRate` row; closes it and inserts a new open-ended one (FR-020, see `data-model.md`).

**Response `200`**: the updated user.

**Deactivation**: `PATCH /users/:id` with `{ status: "INACTIVE" }` — blocks sign-in immediately (bumps `tokenVersion` so outstanding access tokens stop working too), keeps every other field and all history (FR-019).

**Errors**: `NOT_FOUND` (404 — including a cross-tenant id, which the tenant extension makes indistinguishable from "doesn't exist"), `VALIDATION_FAILED`.

## `POST /users/:id/salary-rates` — Company Admin

Convenience alias for the rate-change half of `PATCH /users/:id` above, matching the API surface table in Architecture §9 exactly. Same request/response/validation.
