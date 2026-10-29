-- Role-agnostic default privileges -- repair migration for databases that
-- already ran 20261002110942_rls_user_fileobject.
--
-- That migration originally keyed app_user's default privileges to a
-- hard-coded role:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public ...
--
-- It has since been corrected to omit FOR ROLE, so the entry lands on
-- whichever role MIGRATE_DATABASE_URL connects as. But a database that has
-- already applied it never replays it -- production, staging and every
-- existing local dev database still carry the "postgres"-keyed entry alone.
-- This migration is how those databases pick the correction up.
--
-- Every statement here is idempotent: ALTER DEFAULT PRIVILEGES upserts its
-- pg_default_acl row, and re-GRANTing a privilege that is already held is a
-- no-op. Replaying this on a fresh database (where the corrected migration
-- already did the same work) changes nothing.

-- 1. Record the default privileges against the current role, so tables and
-- sequences created by FUTURE migrations are granted to app_user no matter
-- what the migrating role is named.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- 2. Catch up on objects that already exist. Default privileges are not
-- retroactive -- they only affect objects created after the entry exists --
-- so a table created by a migration that ran as a role other than "postgres"
-- would still be ungranted. On an environment that has only ever migrated as
-- "postgres" this set is empty and the GRANTs are no-ops; it is what makes
-- the two cases converge on the same end state either way.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 3. Re-point Prisma's stored checksum for the migration edited above.
--
-- Prisma stores a sha256 of each migration.sql in "_prisma_migrations".
-- "prisma migrate deploy" -- the only command this project's release step
-- (docker-entrypoint.sh) and scripts/prepare-dev-db.sh ever run -- does not
-- verify it, which is why editing an applied migration is safe here at all.
-- "prisma migrate dev" DOES verify it, and on an existing database would
-- refuse to continue with "The migration ... was modified after it was
-- applied. We need to reset the public schema" -- a destructive prompt, for
-- a hand-edit that was deliberate.
--
-- So: a one-time, precisely-scoped repair. The WHERE clause pins the exact
-- pre-edit checksum, so this updates nothing on a fresh database (already the
-- new value) and nothing on a database whose copy of that file differs for
-- some other reason, rather than asserting a hash that is not true there.
--
-- The to_regclass guard is not belt-and-braces, it is required:
-- "migrate dev" replays every migration into a throwaway SHADOW database,
-- and Prisma does not create "_prisma_migrations" there. Unguarded, this
-- statement aborts the shadow replay with P3006/P1014 and breaks
-- "migrate dev" outright -- a worse failure than the prompt it avoids.
--
-- Order matters for anyone with an existing dev database: run "pnpm dev" (or
-- "prisma migrate deploy") once to apply this, THEN "prisma migrate dev" is
-- clean again. Running "migrate dev" first still hits the reset prompt,
-- because it verifies checksums before applying anything pending.
DO $do$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $q$
    UPDATE "_prisma_migrations"
       SET checksum = '0eebcd57631716c01013f33889890ff9ea3cdf0c3803f4407be88c3b64e616b0'
     WHERE migration_name = '20261002110942_rls_user_fileobject'
       AND checksum = '74ab3e4174262a131843ece02ab7bccbc746dbfcbe9b071fd0fce657a36c144a'
  $q$;
END
$do$;
