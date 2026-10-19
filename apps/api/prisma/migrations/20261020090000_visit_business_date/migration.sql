-- 008-my-visits (research.md §2, data-model.md): visits.business_date.
--
-- The business day a visit belongs to, snapshotted from its DailyAssignment.
-- It exists so the executive's history can be ordered DAY-MAJOR, which is
-- what makes "one block per day, even when the day straddles a page
-- boundary" (FR-011) a property of the ORDER BY rather than a hope.
--
-- Written by hand in Prisma's generated style because `migrate dev` cannot
-- run against this database — the role lacks CREATEDB (P3014). Same reason,
-- and same shape, as 20261019140000_assignments.
--
-- ============================================================================
-- STEP 2 BELOW IS THE BACKFILL, AND IT IS NOT OPTIONAL.
--
-- 20261019230000_backfill_stop_coords exists in this repository because
-- 006-visit-outcomes added assignment_stops.shop_latitude/longitude to a
-- POPULATED table and skipped exactly this step. Every visit submission was
-- then refused in production with SHOP_PIN_REQUIRED, at shops with perfectly
-- good pins, until it was repaired. The failure mode here is quieter and
-- therefore worse: a null business_date would simply make every pre-existing
-- visit vanish from the My visits screen, with no error anywhere.
--
-- Run quickstart.md Scenario 0's two SELECTs after applying this. Both must
-- return 0.
-- ============================================================================

-- 1. Nullable first, so it applies to a table that already has rows.
ALTER TABLE "visits" ADD COLUMN "business_date" DATE;

-- 2. The backfill. A correct no-op on a fresh database, and idempotent if
--    re-run (the IS NULL guard). daily_assignments.business_date is already
--    the company-local calendar date, derived by CompanyClock at route
--    creation — so this copies a value that was always authoritative, it
--    does not derive a new one from a timestamp.
UPDATE "visits" v
SET "business_date" = a."business_date"
FROM "daily_assignments" a
WHERE a."id" = v."assignment_id"
  AND v."business_date" IS NULL;

-- 3. The index every My visits query uses.
--
--    Named explicitly: Prisma's default
--    `visits_company_id_executive_id_business_date_submitted_at_id_idx` is 64
--    characters against Postgres' 63-byte identifier limit and would be
--    silently truncated, after which this file and a later `migrate diff`
--    would disagree about the name. The schema carries the same literal via
--    `map:`.
--
--    DESC on all three sort keys matches the query's ORDER BY exactly, so the
--    planner can walk the index rather than sort.
CREATE INDEX "visits_exec_history_idx"
  ON "visits" ("company_id", "executive_id", "business_date" DESC, "submitted_at" DESC, "id" DESC);

-- 4. Only now, once every existing row has a value.
ALTER TABLE "visits" ALTER COLUMN "business_date" SET NOT NULL;
