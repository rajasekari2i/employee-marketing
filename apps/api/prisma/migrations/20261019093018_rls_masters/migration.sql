-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2 — "Tenant isolation, two independent
-- layers"). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'Brand', 'ReasonMessage').
--
-- 004-brands-reasons-crud: two genuine tenant tables (each its own,
-- always-non-null company_id column, schema.prisma), closing both isolation
-- layers in the same slice that creates them, which has real writers
-- (BrandsService, ReasonsService) — same reasoning as the
-- 20261018170833_rls_beat_plans migration.
--
-- company_id is TEXT here (Prisma's @default(uuid()) generates the id/
-- companyId value client-side as a string; the column is plain TEXT, not
-- Postgres' native `uuid` type — same as every other tenant table in this
-- schema). Each policy fails closed rather than erroring: when
-- "app.company_id" is unset or empty, NULLIF(...) resolves to SQL NULL, and
-- "company_id = NULL" is NULL (falsy) for every row, instead of matching an
-- empty string or raising a type error.
--
-- No `app.is_system_context` OR-branch on either, despite one writer being a
-- SYSTEM_ADMIN path: CompaniesService.create() seeds the new company's
-- "Other" reason only AFTER it has already set app.company_id to that brand-
-- new company's id (an existing pivot it needs for the User insert anyway),
-- so the plain policy below admits that write. The OR-branch pattern in
-- 20261002110942_rls_user_fileobject exists for rows whose company_id is
-- NULL, which can never be the case here.
--
-- Ordering note: the sibling 20261019093000_masters migration runs first and
-- performs the "Other" backfill INSERT for pre-existing companies. That must
-- stay ahead of the FORCE ROW LEVEL SECURITY below — the migration role is
-- not BYPASSRLS and sets no app.company_id, so the same INSERT run after
-- this file would insert nothing.
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;

CREATE POLICY brands_tenant_isolation ON "brands"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "reason_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reason_messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY reason_messages_tenant_isolation ON "reason_messages"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
