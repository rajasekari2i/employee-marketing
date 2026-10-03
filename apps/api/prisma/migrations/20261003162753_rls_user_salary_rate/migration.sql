-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2 — "Tenant isolation, two independent
-- layers"). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts
-- (TENANT_MODELS now also lists 'UserSalaryRate').
--
-- User Story 3 (specs/001-company-user-auth/orchestration-plan.md, gap #7):
-- "user_salary_rates" is a genuine tenant table (its own, always-non-null
-- company_id column, schema.prisma) that was missing from both isolation
-- layers — not a deliberate exemption like "companies"/"roles"/
-- "refresh_tokens"/"otp_challenges"/"audit_events"/"idempotency_keys"
-- (Architecture §5's documented list, none of which this migration touches),
-- just a table with no real writer before `POST /users` (User Story 3) gave
-- it one. Closing that gap now, the same way WU-03's own adversarial review
-- once found and fixed "file_objects" needing the identical treatment
-- "users" already had.
--
-- company_id is TEXT here (Prisma's @default(uuid()) generates the id/
-- userId/companyId value client-side as a string; the column is plain TEXT,
-- not Postgres' native `uuid` type — same reasoning the
-- 20261002110942_rls_user_fileobject migration's own comment already gives
-- for "users"/"file_objects", and it applies identically here). The policy
-- is written to fail closed rather than error: when "app.company_id" is
-- unset or empty, NULLIF(...) resolves to SQL NULL, and "company_id = NULL"
-- is NULL (falsy) for every row, instead of matching on an empty string or
-- raising a type error — deliberately NOT a `::uuid` cast, which would
-- raise a Postgres error (not fail closed) on an unset/empty session
-- variable.
--
-- Simpler than "users"/"file_objects" in exactly one respect: no
-- `app.is_system_context` OR-branch, since UserSalaryRate.company_id is
-- NEVER NULL (no SYSTEM_ADMIN-style exception exists for salary rows — a
-- System Admin has no company and is never paid a half-day rate).
ALTER TABLE "user_salary_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_salary_rates" FORCE ROW LEVEL SECURITY;

CREATE POLICY user_salary_rates_tenant_isolation ON "user_salary_rates"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
