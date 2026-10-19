-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'Visit', 'Order', 'OrderLine').
--
-- 006-visit-outcomes: three genuine tenant tables, closing both isolation
-- layers in the same slice that creates them and that has a real writer
-- (VisitsService) — same reasoning as 20261019170000_visits' siblings.
--
-- company_id is TEXT (Prisma's @default(uuid()) generates the value
-- client-side as a string; the column is plain TEXT, not Postgres' native
-- `uuid` type — as on every other tenant table here). Each policy fails
-- closed: when "app.company_id" is unset or empty, NULLIF(...) resolves to
-- SQL NULL and "company_id = NULL" is falsy for every row, rather than
-- matching an empty string or raising a type error.
--
-- No `app.is_system_context` OR-branch: none of these tables is ever written
-- by a SYSTEM_ADMIN, and company_id is never null on any of them.
--
-- NOTE — RLS is necessary but NOT sufficient for this feature. These
-- policies separate COMPANIES; they do not separate two executives inside
-- one company. That second scope is enforced in VisitsService, which narrows
-- every query to the caller's own JWT-verified executive id. Tenant
-- isolation alone must never be what keeps one executive out of another's
-- visits — the same note carried on 20261019140018_rls_assignments.
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;

CREATE POLICY visits_tenant_isolation ON "visits"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY orders_tenant_isolation ON "orders"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_lines" FORCE ROW LEVEL SECURITY;

CREATE POLICY order_lines_tenant_isolation ON "order_lines"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
