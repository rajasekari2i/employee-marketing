-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'Attendance').
--
-- 010-manager-app: "attendance" is the ONE new tenant table in this slice,
-- so this is the only place Layer 2 needs extending. Closing both layers in
-- the same slice that creates the table and gives it a real writer —
-- AttendanceService — is the same reasoning 20261019170018_rls_visits used.
--
-- company_id is TEXT (Prisma's @default(uuid()) generates the value
-- client-side as a string; the column is plain TEXT, not Postgres' native
-- `uuid` type — as on every other tenant table here). The policy fails
-- closed: when "app.company_id" is unset or empty, NULLIF(...) resolves to
-- SQL NULL and "company_id = NULL" is falsy for every row, rather than
-- matching an empty string or raising a type error.
--
-- No `is_system_context` OR-branch: attendance is never written by a
-- SYSTEM_ADMIN and company_id is never null on it.
--
-- NOTE — and this one differs from its siblings. The visits and assignments
-- policies carry a warning that RLS separates COMPANIES, not two people
-- inside one, and that the second scope is enforced in the service by
-- narrowing to the caller's own executive id. **Attendance has no such
-- second scope, and that is correct rather than missing**: a manager records
-- attendance for every member of staff in the company (FR-050, decided with
-- the user), so company scope IS the whole of it here. Do not "fix" this by
-- adding a per-user narrowing.
ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance" FORCE ROW LEVEL SECURITY;

CREATE POLICY attendance_tenant_isolation ON "attendance"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
