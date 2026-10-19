-- 005-executive-dashboard: the daily route and the beat-day lifecycle
-- (data-model.md).
--
-- Hand-written rather than generated: `prisma migrate dev` cannot run in this
-- environment (the database role lacks CREATEDB, so Prisma cannot build its
-- shadow database — P3014). The DDL below mirrors exactly what the generator
-- would emit for the `DailyAssignment` and `AssignmentStop` models in
-- schema.prisma, and is applied with `prisma migrate deploy`, which needs no
-- shadow database. Same approach and reasoning as 20261019093000_masters.
--
-- No foreign key on company_id: no tenant table in this schema declares one.
--
-- RLS for both tables lives in the sibling 20261019140018_rls_assignments
-- migration, which sorts AFTER this one.

-- Step 1 (schema): enum types.
--
-- "BeatDayStatus" deliberately has no AUTO_CLOSED member: auto-closing a
-- forgotten beat needs a scheduled-job runtime that does not exist yet, so
-- nothing could set it and nothing reads it. The slice that implements
-- auto-close adds it with ALTER TYPE ... ADD VALUE.
--
-- "StopStatus" and "StopSource" DO carry their full sets even though only
-- PENDING and PLAN have writers today, because this slice's own ordering and
-- counting logic reads the others (FR-011, FR-017).
CREATE TYPE "BeatDayStatus" AS ENUM ('RUNNING', 'ENDED');
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED', 'REVISIT');
CREATE TYPE "StopSource" AS ENUM ('PLAN', 'EXEC_EXTRA', 'MANAGER_EXTRA');

-- Step 2 (schema): the daily_assignments table.
--
-- "business_date" is DATE, not TIMESTAMP, on purpose: it is a company-local
-- calendar date and must not carry a time component that a timezone
-- conversion could shift into the neighbouring day.
--
-- "status" is nullable, which is what encodes the three-state lifecycle:
-- NULL = not started, 'RUNNING', 'ENDED'.
CREATE TABLE "daily_assignments" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "executive_id" TEXT NOT NULL,
    "beat_plan_id" TEXT,
    "beat_plan_name" TEXT,
    "status" "BeatDayStatus",
    "started_at" TIMESTAMP(3),
    "start_latitude" DECIMAL(9,6),
    "start_longitude" DECIMAL(9,6),
    "start_accuracy_meters" INTEGER,
    "ended_at" TIMESTAMP(3),
    "end_latitude" DECIMAL(9,6),
    "end_longitude" DECIMAL(9,6),
    "end_accuracy_meters" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_assignments_pkey" PRIMARY KEY ("id")
);

-- Step 3 (schema): the assignment_stops table.
--
-- "effective_radius_meters" is frozen at creation from the shop's override or
-- the company default. It is stored here but NEVER serialised to an executive
-- (CLAUDE.md rule 6) — it is the threshold every range verdict is measured
-- against, so sending it would let the device derive its own verdict.
CREATE TABLE "assignment_stops" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "source" "StopSource" NOT NULL DEFAULT 'PLAN',
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',
    "added_by_user_id" TEXT,
    "added_at" TIMESTAMP(3),
    "effective_radius_meters" INTEGER NOT NULL,

    CONSTRAINT "assignment_stops_pkey" PRIMARY KEY ("id")
);

-- Step 4 (schema): indexes.

-- LOAD-BEARING, not tidiness. This is the entire concurrency guarantee behind
-- creating the route on first open (research.md §1): two devices, a double tap
-- and a refresh storm all converge on one row because Postgres refuses the
-- second insert, and the service treats that refusal as "re-read the winner".
-- Removing it would silently reintroduce duplicate days.
CREATE UNIQUE INDEX "daily_assignments_company_id_business_date_executive_id_key" ON "daily_assignments"("company_id", "business_date", "executive_id");

CREATE INDEX "daily_assignments_company_id_business_date_idx" ON "daily_assignments"("company_id", "business_date");
CREATE INDEX "daily_assignments_company_id_executive_id_business_date_idx" ON "daily_assignments"("company_id", "executive_id", "business_date");

-- Deliberately tighter than the architecture's three-column
-- (assignment_id, shop_id, sequence) form, which would let the same shop
-- appear twice on one day at two sequence numbers — contradicting BUS-08.
CREATE UNIQUE INDEX "assignment_stops_assignment_id_shop_id_key" ON "assignment_stops"("assignment_id", "shop_id");

CREATE INDEX "assignment_stops_company_id_assignment_id_status_idx" ON "assignment_stops"("company_id", "assignment_id", "status");
CREATE INDEX "assignment_stops_company_id_shop_id_idx" ON "assignment_stops"("company_id", "shop_id");

-- Step 5 (schema): foreign keys.
ALTER TABLE "daily_assignments" ADD CONSTRAINT "daily_assignments_executive_id_fkey" FOREIGN KEY ("executive_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_assignments" ADD CONSTRAINT "daily_assignments_beat_plan_id_fkey" FOREIGN KEY ("beat_plan_id") REFERENCES "beat_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "assignment_stops" ADD CONSTRAINT "assignment_stops_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "daily_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_stops" ADD CONSTRAINT "assignment_stops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
