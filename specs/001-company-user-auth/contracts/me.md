# Contract: Me (profile, session)

Base path `/api/v1/me`. Any authenticated role.

## `GET /me`

**Response `200`**
```ts
{
  id: string; name: string; email: string | null; username: string | null;
  role: RoleKey; companyId: string | null; status: UserStatus;
  photoUrl: string | null;
  permissions: string[];
  company: { name: string; timezone: string } | null;   // null only for SYSTEM_ADMIN
}
```
`name` and `email` are returned but are **read-only** from every mutation endpoint available to the user themself (FR-021) — only a Company Admin can change them, via `PATCH /users/:id`.

## `PATCH /me/photo`

Multipart upload, one field `photo` (image, ≤10 MB). Runs the same pipeline as `files.md` (`PhotoKind.USER_AVATAR`), then updates the caller's own `photoId`. No other field on `User` is reachable through this endpoint (FR-022). Requires `Idempotency-Key` (Architecture D-15 — every command, not only the routes a given contract file happens to call out explicitly; User Story 4's planning found and corrected an inconsistency where this was initially exempted).

**Response `200`**: `{ photoUrl: string }`
**Errors**: `VALIDATION_FAILED` (400 — wrong mime/too large/bad magic bytes).

`POST /me/devices` (FCM token registration) is out of scope for this slice — it belongs to `015-notifications` — and is not built here.
