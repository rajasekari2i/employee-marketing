-- 010-manager-app (data-model.md). Three parts, each left for this slice by
-- an earlier one, on the record.
--
-- Written by hand in Prisma's generated style because `migrate dev` cannot
-- run against this database — the role lacks CREATEDB (P3014). Same reason,
-- and same shape, as 20261019140000_assignments.
--
-- ============================================================================
-- THERE IS DELIBERATELY NO BACKFILL HERE, and that is not the mistake
-- 20261019230000_backfill_stop_coords repaired.
--
-- That migration exists because 006-visit-outcomes added a column whose NULL
-- had a MEANING the data could supply — every pre-existing stop should have
-- carried its shop's approved coordinate, and leaving them null refused every
-- visit. Slice 008's business_date was the same: every pre-existing visit
-- belonged to a day, and leaving it null hid them all.
--
-- All three columns below are different. A stop added before this slice had
-- no manager and no reason; an order not yet delivered has no deliverer and
-- no delivery time. NULL is the correct and only honest value for every
-- existing row, so there is nothing to backfill.
-- ============================================================================

-- 1. The attendance enums, verbatim from 03-ARCHITECTURE.md:269-271.
CREATE TYPE "AttendanceSession" AS ENUM ('MORNING', 'EVENING');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF');
CREATE TYPE "LatenessFlag" AS ENUM ('ON_TIME', 'DELAY_1H', 'DELAY_2H');

-- 2. The attendance table.
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "session" "AttendanceSession" NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "actual_time" TIMESTAMP(3),
    "lateness_flag" "LatenessFlag",
    "payable_units" DECIMAL(4,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "superseded_by_id" TEXT,
    "change_reason" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- LOAD-BEARING: `version` in the unique key is what makes the history
-- append-only. A second writer cannot reuse a version, so two managers
-- amending the same session at once produce one winner and one P2002 —
-- never a lost update (FR-037, SC-009).
CREATE UNIQUE INDEX "attendance_company_id_user_id_business_date_session_version_key"
  ON "attendance" ("company_id", "user_id", "business_date", "session", "version");

CREATE INDEX "attendance_company_id_business_date_session_is_active_idx"
  ON "attendance" ("company_id", "business_date", "session", "is_active");

CREATE INDEX "attendance_company_id_user_id_business_date_idx"
  ON "attendance" ("company_id", "user_id", "business_date");

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. The reason a MANAGER gave for adding a stop. Declared absent by
--    007-extra-shops' data model — "it is for manager-added extras, which
--    are out of scope, so it stays omitted" — and arriving now with its
--    writer.
ALTER TABLE "assignment_stops" ADD COLUMN "add_reason" TEXT;

-- 4. Delivery attribution (FR-023). `delivery_status` already exists and
--    already defaults to TO_DELIVER, so this is two nullable columns rather
--    than a state machine.
ALTER TABLE "orders" ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "delivered_by" TEXT;
