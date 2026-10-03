# Contract: Files (avatar upload/serving, this slice's subset)

Base path `/api/v1/files`. Implements Architecture §12's pipeline, scoped to `PhotoKind.USER_AVATAR`.

## `GET /files/:id?token=`

**Response**: the image bytes (`Content-Type` from `FileObject.mimeType`), or the 320 px thumbnail when `?thumb=1` is appended.
**Errors**: `FORBIDDEN` (401/403 — missing or expired signed token: a 10-minute HMAC of `fileId|userId|exp`), `NOT_FOUND` (404).

Avatars are uploaded only through `PATCH /me/photo` (self) or embedded as `photoFileId` on `POST /users` / `PATCH /users/:id` (Company Admin setting someone else's photo) — there is no standalone *read-side* `POST /files` in this slice, since a bare upload-then-attach two-step isn't needed for those two: both already have a known owner at upload time.

**Exception**: `POST /users` creates a brand-new user who doesn't exist yet at the moment their photo is picked on the User form (User Story 3) — there is no owner to attach the upload to until after that same request creates one. `POST /files/avatars` below is the one upload-then-attach step this slice actually needs, narrowly for that case.

## `POST /files/avatars` — Company Admin

Ordinary authenticated + tenant-scoped (not `@Public()`, not `@SkipTenant()`) — unlike `GET /files/:id` below, this route has a normal JWT and needs one, since it's an explicit `fetch()` call from the app, not an `<Image>` tag that can't attach an `Authorization` header.

**Request**: multipart, one file field (`photo`), ≤10 MB, `image/jpeg|png|webp|heic` — same limits as the pipeline below.

**Response `201`**: `{ id: string; url: string }` — `id` is the new `FileObject.id` (reusable as `photoFileId` on `POST /users`/`PATCH /users/:id`); `url` is a signed `GET /files/:id` URL for immediate preview on the form, scoped to the uploading admin as viewer.

**Errors**: `VALIDATION_FAILED` (400) — no file in the request, wrong size/type, or a magic-byte mismatch (step 2 below).

Requires `Idempotency-Key` (Constitution rule 3 — every state-changing POST does, with no stated exception for a route that also happens to have its own content-based dedupe). `FilesService.uploadAvatar()`'s existing `sha256` dedupe (step 4 below) is a separate, complementary safety net for the same key being mistakenly reused across two genuinely different uploads.

**Processing pipeline (applied identically everywhere a photo is accepted)**:
1. Multipart, ≤10 MB, declared type `image/jpeg|png|webp|heic`.
2. Magic-byte verification (not just the declared `Content-Type`).
3. `sharp`: auto-rotate from EXIF, strip all other metadata, resize to a 1600 px long edge, encode WebP quality 80; also write a 320 px thumbnail.
4. Compute `sha256`; an identical hash already stored for this company reuses the existing `FileObject` row instead of writing a duplicate.
5. Insert/reuse the `FileObject` row, return its id and a signed URL for immediate display.
