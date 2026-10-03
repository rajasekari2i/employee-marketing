# Phase 0 Research: Company Provisioning, User Management & Sign-In

The Technical Context in `plan.md` carries no `NEEDS CLARIFICATION` markers — Architecture §1/§6/§7/§9 already pin the language, framework, ORM, database, auth scheme and API style. What follows are the decisions this slice still has to make on its own, because the BRD/PRD/Architecture either leave them explicitly open (OD-10) or simply don't reach this level of detail yet.

## 1. How does the System Admin authenticate at all?

**Decision**: Reuse the single `/auth/login` contract. `companyCode` becomes optional in the request body; when it is omitted, the server looks for a match only among users whose `companyId` is `null` (i.e. `SYSTEM_ADMIN`). When `companyCode` is present, lookup is scoped to that company as today. One Zod union schema in `packages/shared` expresses both shapes so the contract stays singular.

**Rationale**: BRD OD-10 explicitly leaves "where does the System Admin work" open, recommending "API and seed scripts in release 1." Giving System Admin a second auth stack (API key, separate endpoint) would duplicate token issuance, refresh-rotation and lockout logic for a role that — per BRD §3 — has no mobile screens at all and is expected to be rare. Reusing one endpoint keeps Constitution rule 5 ("one contract") intact.

**Alternatives considered**:
- *Static API key / bearer secret*: simpler to call from a script, but bypasses lockout, audit and rotation entirely, and would need its own secret-rotation story for no real benefit at pilot scale.
- *Separate `/admin/auth/login` route*: keeps the two concerns visually separate, but duplicates the throttling/lockout/JWT-issuance code path this feature already has to build once.

## 2. Who creates the very first System Admin?

**Decision**: A one-time, idempotent `prisma/seed.ts` script reads `SEED_SYSTEM_ADMIN_USERNAME` / `SEED_SYSTEM_ADMIN_PASSWORD` from the environment and upserts exactly one `SYSTEM_ADMIN` user (`companyId = null`) if none exists yet. The script is safe to re-run (upsert, not insert) so container restarts never duplicate it.

**Rationale**: Nothing in the system can create the first System Admin through an API, because every API path that creates a user requires an already-authenticated caller. A seed script is the standard, already-implied answer ("seed scripts" in OD-10) and matches the `prisma/seed.ts` file Architecture §3 already reserves for this purpose.

**Alternatives considered**: A CLI command inside the Nest app — rejected as unnecessary ceremony for a single upsert that Prisma's own seed hook already covers.

## 3. How does a System Admin create a company's first Company Admin, given `/users` is Company-Admin-only?

**Decision**: `POST /companies` performs both inserts in one transaction: the `Company` (+ a default `CompanySettings` row) and its first `User` with role `COMPANY_ADMIN`, atomically. The request body nests the admin's `name`, `email`, `username` and a temporary `password` inside the company payload. No separate "add admin to an existing adminless company" endpoint exists in this slice, because BRD BR-02 frames company creation and first-admin creation as one business action, and every company created this way already has an admin — there is no intermediate adminless state to recover from.

**Rationale**: The published API table in Architecture §9 lists `/users` as Company-Admin-scoped, which is correct for every admin *after* the first — but doesn't yet describe how the first one is born. Nesting it in company creation avoids inventing a second, System-Admin-only shape of the same `/users` endpoint, and avoids a window where a company exists but nobody can sign in to it.

**Alternatives considered**: `POST /companies/:id/admin`, a dedicated System-Admin-only bootstrap endpoint usable only while the company has zero `COMPANY_ADMIN` users — workable, but adds a second place that creates a `User` row and a guard ("zero admins so far") that the atomic version never needs.

## 4. How far does avatar/photo upload go in this slice?

**Decision**: Implement the real pipeline from Architecture §12 (`StorageAdapter.put`, magic-byte check, `sharp` resize/strip/WebP-encode + thumbnail, `FileObject` row, signed `GET /files/:id?token=`), scoped to `PhotoKind.USER_AVATAR` only. Shop photos (`PhotoKind.SHOP`, up to 3 per shop) stay out of scope — they belong to the `006-shops` slice.

**Rationale**: FR-016 and FR-022 require a photo field on user creation and on self-service profile editing; there is no smaller "stub" version that still satisfies those requirements, and §12's pipeline is already the one-and-only way files work in this project — building a second, simpler path now would just be thrown away when shops need the same adapter later.

**Alternatives considered**: Store a bare URL string with no processing — rejected; it would violate the "metadata stripped, re-encoded before storage" security rule in Architecture §20 and would have to be redone anyway.

## 5. Where does the forgot-password OTP actually go before an SMS gateway is contracted?

**Decision**: Define an `SmsAdapter` interface (`send(toE164: string, message: string): Promise<void>`) mirroring `StorageAdapter`. A `LogSmsAdapter` (writes the OTP to the server log at `debug` level, **never** `info`/above, and never through the redacted request-logging pipeline) backs it in development/staging; the real provider from BRD §9 plugs in behind the same interface before go-live, with no business-code change.

**Rationale**: BRD §9 lists the SMS gateway as a dependency still to be contracted, not yet available. Architecture already uses exactly this adapter-swap pattern for photo storage (D-11) and the same shape fits here. This keeps FR-011/FR-012 (OTP delivery, expiry, attempts, resend) fully testable via the quickstart walkthrough without a real SMS bill.

**Alternatives considered**: Block this slice until a provider is contracted — rejected, it would stall the entire auth stack on a procurement dependency unrelated to the code.

## 6. Session storage and rotation on the mobile client

**Decision**: Access and refresh tokens are kept in `react-native-keychain` (updated 2026-10-02 — Architecture §20 originally named `expo-secure-store`, superseded when the project moved to the bare React Native CLI; D-08); refresh happens transparently via a TanStack Query/Axios interceptor that retries the original request once after a successful `/auth/refresh`, and on `TOKEN_REUSED` clears the store and forces the sign-in screen.

**Rationale**: Recorded here only so the mobile `features/auth` implementation has one place that states the refresh-retry behaviour explicitly; everything else is already decided elsewhere in Architecture §6/§20.

**Alternatives considered**: None — this is a restatement, not an open question.
