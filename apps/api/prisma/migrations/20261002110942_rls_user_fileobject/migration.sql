-- Tenant isolation, Layer 2: Postgres row-level security (Architecture §5;
-- CLAUDE.md Constitution rule 2 — "Tenant isolation, two independent
-- layers"). Layer 1 is the Prisma client extension in
-- apps/api/src/infra/prisma/tenant.extension.ts.
--
-- RLS is enabled + FORCED on exactly "users" and "file_objects" — the only
-- two tables in this slice that carry a company_id column and are listed
-- in TENANT_MODELS. "companies", "roles", "refresh_tokens",
-- "otp_challenges", "audit_events" and "idempotency_keys" are the
-- Architecture §5 / data-model.md documented exemptions and are NOT
-- touched by this migration — they stay guarded in application code.

-- ---------------------------------------------------------------------------
-- Dedicated non-superuser application role.
--
-- Postgres RLS policies are bypassed entirely for superusers, and
-- FORCE ROW LEVEL SECURITY only forces RLS for a table's OWNER role — it
-- does not help a superuser, and it is not needed for any other role that
-- merely has GRANTed privileges (RLS already applies to those regardless
-- of FORCE). The local dev setup previously had the API connect as the
-- "postgres" superuser, under which these policies would silently never
-- apply. "app_user" is a plain, unprivileged, non-owner role the API
-- connects as instead, so RLS is actually enforced end-to-end.
--
-- Guarded with a DO block because CREATE ROLE has no IF NOT EXISTS form,
-- and this migration must stay replayable (fresh CI databases, `prisma
-- migrate deploy` on an environment that already has the role, etc.).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'x0nvv8OgQyd0do4ngcXAk8uh9A5Svl';
  END IF;
END
$$;

-- Table/sequence-level privileges app_user needs to run the application
-- (not just the two RLS-covered tables — every tenant and non-tenant table
-- the API reads/writes). RLS policies below are the actual tenant boundary;
-- these GRANTs are ordinary CRUD privilege, not a tenant control.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Keep app_user's privileges current for tables/sequences created by later
-- migrations (which run as the "postgres" owner role) without having to
-- remember to re-GRANT by hand every time.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ---------------------------------------------------------------------------
-- "users" — company_id is TEXT here (Prisma's @default(uuid()) generates
-- the id/companyId value client-side as a string; the column is plain
-- TEXT, not Postgres' native `uuid` type — Architecture §5's illustrative
-- example casts to ::uuid, which assumes a native uuid column and does not
-- apply to this schema), and it is nullable (SYSTEM_ADMIN rows have
-- company_id NULL). The policy is written to fail closed rather than
-- error: when "app.company_id" is unset or empty, NULLIF(...) resolves to
-- SQL NULL, and "company_id = NULL" is NULL (falsy) for every row, instead
-- of matching on an empty string or raising a type error.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

-- The System Admin's own row has company_id IS NULL (they belong to no
-- company). In SQL, `NULL = anything` (including NULL itself) is never
-- TRUE, so without the second OR-branch below, that row would be
-- permanently unreadable and uninsertable under ANY app.company_id value —
-- silently blocking the future login/seed work this schema exists for.
-- `app.is_system_context` is a dedicated escape, set ONLY by code that is
-- genuinely acting as the platform itself (the future System-Admin login
-- lookup) — never by an ordinary tenant-scoped request. The one-time seed
-- script bootstraps this row through the separate superuser
-- (MIGRATE_DATABASE_URL) connection instead of this escape, so it never
-- needs app_user to see a NULL-company_id row at all.
CREATE POLICY users_tenant_isolation ON "users"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
    OR ("company_id" IS NULL AND current_setting('app.is_system_context', true) = 'true')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
    OR ("company_id" IS NULL AND current_setting('app.is_system_context', true) = 'true')
  );

-- ---------------------------------------------------------------------------
-- "file_objects" — company_id is also nullable in this schema (per
-- data-model.md, it "matches the owning user's company", so a FileObject
-- owned by the System Admin would also have company_id IS NULL). Same
-- fail-closed NULLIF guard AND the same app.is_system_context escape as
-- the "users" policy above — kept identical on purpose, not just similar,
-- so neither table silently drifts out of parity with the other again.
ALTER TABLE "file_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_objects" FORCE ROW LEVEL SECURITY;

CREATE POLICY file_objects_tenant_isolation ON "file_objects"
  USING (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
    OR ("company_id" IS NULL AND current_setting('app.is_system_context', true) = 'true')
  )
  WITH CHECK (
    "company_id" = NULLIF(current_setting('app.company_id', true), '')
    OR ("company_id" IS NULL AND current_setting('app.is_system_context', true) = 'true')
  );
