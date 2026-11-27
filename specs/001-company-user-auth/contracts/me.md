# Contract: Me (profile, session)

Base path `/api/v1/me`. Any authenticated role.

## `GET /me`

**Response `200`**
```ts
{
  id: string; name: string; email: string | null; username: string | null;
  role: RoleKey; companyId: string | null; status: UserStatus;
  photoUrl: string | null;        // full size — the profile screen's 86px avatar
  photoThumbUrl: string | null;   // same photo, `?thumb=1` — every home screen's 44px AccountMenu avatar
  permissions: string[];
  company: { code: string; name: string; timezone: string } | null;   // null only for SYSTEM_ADMIN
}
```

Both photo fields are signed, short-lived `/files/:id?token=` URLs and are
`null` for a user who has not uploaded a photo — in which case the avatar
falls back to the person's initials. Two fields rather than one: the profile
screen renders the same photo four times larger than the account menu does
and would visibly blur on a thumbnail. `GET /files/:id?thumb=1` falls back to
the full-size object when a row has no `thumbKey`, so the thumb URL is always
safe to request.

`name` and `email` are returned but are **read-only** from every mutation endpoint available to the user themself (FR-021) — only a Company Admin can change them, via `PATCH /users/:id`.

## `PATCH /me/photo`

Multipart upload, one field `photo` (image, ≤10 MB). Runs the same pipeline as `files.md` (`PhotoKind.USER_AVATAR`), then updates the caller's own `photoId`. No other field on `User` is reachable through this endpoint (FR-022). Requires `Idempotency-Key` (Architecture D-15 — every command, not only the routes a given contract file happens to call out explicitly; User Story 4's planning found and corrected an inconsistency where this was initially exempted).

**Response `200`**: `{ photoUrl: string }`
**Errors**: `VALIDATION_FAILED` (400 — wrong mime/too large/bad magic bytes).

`POST /me/devices` (FCM token registration) is out of scope for this slice — it belongs to `015-notifications` — and is not built here.
