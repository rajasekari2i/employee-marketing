-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2 — "Tenant isolation, two independent
-- layers"). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts (TENANT_MODELS now also
-- lists 'Shop', 'ShopPhoto', 'ShopPinChange').
--
-- 002-shops-crud: three genuine tenant tables (each its own, always-non-null
-- company_id column, schema.prisma), closing both isolation layers in the
-- same migration that creates them has a real writer (ShopsService) — same
-- reasoning as the 20261003162753_rls_user_salary_rate migration.
--
-- company_id is TEXT here (Prisma's @default(uuid()) generates the id/
-- shopId/companyId value client-side as a string; the column is plain TEXT,
-- not Postgres' native `uuid` type — same as every other tenant table in
-- this schema). Each policy fails closed rather than erroring: when
-- "app.company_id" is unset or empty, NULLIF(...) resolves to SQL NULL, and
-- "company_id = NULL" is NULL (falsy) for every row, instead of matching an
-- empty string or raising a type error.
--
-- No `app.is_system_context` OR-branch on any of the three — none of
-- "shops"/"shop_photos"/"shop_pin_changes" is ever written by a
-- SYSTEM_ADMIN (no company-less shop exists by construction).
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shops" FORCE ROW LEVEL SECURITY;

CREATE POLICY shops_tenant_isolation ON "shops"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "shop_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shop_photos" FORCE ROW LEVEL SECURITY;

CREATE POLICY shop_photos_tenant_isolation ON "shop_photos"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );

ALTER TABLE "shop_pin_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shop_pin_changes" FORCE ROW LEVEL SECURITY;

CREATE POLICY shop_pin_changes_tenant_isolation ON "shop_pin_changes"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
  );
