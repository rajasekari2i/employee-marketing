-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2 — "Tenant isolation, two independent
-- layers"). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'BeatPlan', 'BeatPlanShop').
--
-- 003-beat-plans-crud: two genuine tenant tables (each its own,
-- always-non-null company_id column, schema.prisma), closing both isolation
-- layers in the same migration that creates them has a real writer
-- (BeatPlansService) — same reasoning as the 20261016173258_rls_shops
-- migration.
--
-- company_id is TEXT here (Prisma's @default(uuid()) generates the id/
-- companyId value client-side as a string; the column is plain TEXT, not
-- Postgres' native `uuid` type — same as every other tenant table in this
-- schema). Each policy fails closed rather than erroring: when
-- "app.company_id" is unset or empty, NULLIF(...) resolves to SQL NULL, and
-- "company_id = NULL" is NULL (falsy) for every row, instead of matching an
-- empty string or raising a type error.
--
-- No `app.is_system_context` OR-branch on either — neither "beat_plans" nor
-- "beat_plan_shops" is ever written by a SYSTEM_ADMIN (no company-less beat
-- plan exists by construction).
ALTER TABLE "beat_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beat_plans" FORCE ROW LEVEL SECURITY;

CREATE POLICY beat_plans_tenant_isolation ON "beat_plans"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "beat_plan_shops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beat_plan_shops" FORCE ROW LEVEL SECURITY;

CREATE POLICY beat_plan_shops_tenant_isolation ON "beat_plan_shops"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
