# Contract: Files (avatar upload/serving, this slice's subset)

Base path `/api/v1/files`. Implements Architecture §12's pipeline, scoped to `PhotoKind.USER_AVATAR`.

## `GET /files/:id?token=`

**Response**: the image bytes (`Content-Type` from `FileObject.mimeType`), or the 320 px thumbnail when `?thumb=1` is appended.
**Errors**: `FORBIDDEN` (401/403 — missing or expired signed token: a 10-minute HMAC of `fileId|userId|exp`), `NOT_FOUND` (404).

Avatars are uploaded only through `PATCH /me/photo` (self) or embedded as `photoFileId` on `POST /users` / `PATCH /users/:id` (Company Admin setting someone else's photo) — there is no standalone `POST /files` in this slice; a bare upload-then-attach two-step isn't needed yet because every avatar upload already has a known owner at upload time.

**Processing pipeline (applied identically everywhere a photo is accepted)**:
1. Multipart, ≤10 MB, declared type `image/jpeg|png|webp|heic`.
2. Magic-byte verification (not just the declared `Content-Type`).
3. `sharp`: auto-rotate from EXIF, strip all other metadata, resize to a 1600 px long edge, encode WebP quality 80; also write a 320 px thumbnail.
4. Compute `sha256`; an identical hash already stored for this company reuses the existing `FileObject` row instead of writing a duplicate.
5. Insert/reuse the `FileObject` row, return its id and a signed URL for immediate display.
