-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2 — "Tenant isolation, two independent
-- layers"). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'DailyAssignment', 'AssignmentStop').
--
-- 005-executive-dashboard: two genuine tenant tables (each with its own,
-- always-non-null company_id column), closing both isolation layers in the
-- same slice that creates them and that has real writers
-- (AssignmentsService) — same reasoning as 20261019093018_rls_masters.
--
-- company_id is TEXT here (Prisma's @default(uuid()) generates the id/
-- companyId value client-side as a string; the column is plain TEXT, not
-- Postgres' native `uuid` type — same as every other tenant table in this
-- schema). Each policy fails closed rather than erroring: when
-- "app.company_id" is unset or empty, NULLIF(...) resolves to SQL NULL, and
-- "company_id = NULL" is NULL (falsy) for every row, instead of matching an
-- empty string or raising a type error.
--
-- No `app.is_system_context` OR-branch on either: neither table is ever
-- written by a SYSTEM_ADMIN (no company-less daily assignment exists by
-- construction), and the OR-branch pattern in 20261002110942_rls_user_fileobject
-- exists for rows whose company_id is NULL, which cannot happen here.
--
-- NOTE — RLS is necessary but NOT sufficient for this feature. These policies
-- separate COMPANIES; they do not separate two executives inside one company.
-- That second scope is enforced in the service and controller, which narrow
-- every query to the caller's own JWT-verified executive id. Tenant isolation
-- alone must never be what keeps one executive out of another's day.
ALTER TABLE "daily_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_assignments" FORCE ROW LEVEL SECURITY;

CREATE POLICY daily_assignments_tenant_isolation ON "daily_assignments"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "assignment_stops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_stops" FORCE ROW LEVEL SECURITY;

CREATE POLICY assignment_stops_tenant_isolation ON "assignment_stops"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
