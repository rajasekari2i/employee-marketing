-- `Role` becomes application-wide (one row per `key`, shared by every
-- company) instead of one duplicate copy per company. The per-company
-- duplication (roles.seed.ts's old seedCompanyRoles(), called from
-- companies.service.ts on every `POST /companies`) was deliberate —
-- anticipating a future per-company custom-role feature — but no release-1
-- code ever diverges one company's role definitions from another's, so it
-- was pure duplication with no actual benefit. See prisma/schema.prisma's
-- comment on the `Role` model and roles.seed.ts's `ensureGlobalRoles()`
-- (now called once, from prisma/seed.ts, alongside SYSTEM_ADMIN — not from
-- company creation).
--
-- Step 1 (data): every existing company has its own duplicate row per
-- non-SYSTEM_ADMIN key, with real `users.role_id` values pointing at them.
-- For each `key`, keep exactly one row (the lexicographically smallest
-- `id` — arbitrary but deterministic; every duplicate's label/permissions
-- are identical today, so which one survives doesn't matter), repoint any
-- `users` row that referenced a now-redundant duplicate, then delete the
-- duplicates. This also runs correctly (as a no-op) against a fresh
-- database with zero or non-duplicated roles.
WITH canonical AS (
  SELECT "key", MIN(id) AS keep_id
  FROM "roles"
  GROUP BY "key"
),
remap AS (
  SELECT r.id AS old_id, c.keep_id
  FROM "roles" r
  JOIN canonical c ON c."key" = r."key"
  WHERE r.id <> c.keep_id
)
UPDATE "users" u
SET "role_id" = remap.keep_id
FROM remap
WHERE u."role_id" = remap.old_id;

DELETE FROM "roles" r
WHERE EXISTS (
  SELECT 1 FROM "roles" r2
  WHERE r2."key" = r."key" AND r2.id < r.id
);

-- Step 2 (schema): drop the now-unused company_id column/FK/index, and
-- replace the old (company_id, key) compound uniqueness with a plain
-- uniqueness on key alone — safe now that step 1 guarantees exactly one
-- row per key.
ALTER TABLE "roles" DROP CONSTRAINT "roles_company_id_fkey";
DROP INDEX "roles_company_id_key_key";
ALTER TABLE "roles" DROP COLUMN "company_id";
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");
