-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'SalaryRun' and 'SalaryRunLine').
--
-- 012-monthly-salary-run: both new tables are tenant tables, so both need a
-- policy. Closing both layers in the same slice that creates the tables and
-- gives them a real writer — SalaryRunService — is the same reasoning
-- 20261020120018_rls_attendance used.
--
-- company_id is TEXT (Prisma's @default(uuid()) generates the value
-- client-side as a string; the column is plain TEXT, not Postgres' native
-- `uuid` type — as on every other tenant table here). Both policies fail
-- closed: when "app.company_id" is unset or empty, NULLIF(...) resolves to
-- SQL NULL and "company_id = NULL" is falsy for every row, rather than
-- matching an empty string or raising a type error.
--
-- No `is_system_context` OR-branch: a salary run is never written by a
-- SYSTEM_ADMIN and company_id is never null on either table.
--
-- NOTE on salary_run_lines. It carries its own company_id and its own policy
-- rather than relying on the cascade from its parent run. That is deliberate:
-- RLS is not transitive, so a policy on the parent would leave the child
-- readable by a direct query. Every tenant table in this schema is isolated
-- on its own terms, and a child table is not an exception.
--
-- Like attendance, and unlike visits and assignments, there is NO second
-- per-user narrowing here, and that is correct rather than missing: a salary
-- run spans every member of staff in the company, so company scope is the
-- whole of it. Do not "fix" this by adding a per-user predicate.
ALTER TABLE "salary_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary_runs" FORCE ROW LEVEL SECURITY;

CREATE POLICY salary_runs_tenant_isolation ON "salary_runs"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "salary_run_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "salary_run_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY salary_run_lines_tenant_isolation ON "salary_run_lines"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
