-- 006-visit-outcomes: visits, orders and order lines (data-model.md).
--
-- Hand-written rather than generated: `prisma migrate dev` cannot run in this
-- environment (the database role lacks CREATEDB, so Prisma cannot build its
-- shadow database — P3014). Same approach and reasoning as
-- 20261019093000_masters and 20261019140000_assignments.
--
-- RLS for all three tables lives in the sibling 20261019170018_rls_visits
-- migration, which sorts AFTER this one.

-- Step 1 (schema): extend two existing enum types.
--
-- 002-shops-crud declared only the LocationSource/LocationStatus values it
-- could reach and named the executive's first-visit pin-capture flow as the
-- one that would add these. This is that flow.
--
-- NOTE on ALTER TYPE ... ADD VALUE: before Postgres 12 this could not run
-- inside a transaction block, which would have forced these into their own
-- migration. This project targets PG16 (verified 16.15), where it is
-- transaction-safe as long as the new value is not USED in the same
-- transaction — nothing below references GPS or PENDING_VERIFICATION, so
-- this is safe here. Do not add a backfill that uses them to this file.
ALTER TYPE "LocationSource" ADD VALUE 'GPS';
ALTER TYPE "LocationStatus" ADD VALUE 'PENDING_VERIFICATION';

-- Step 2 (schema): new enum types.
--
-- "VisitFlag" carries MOCK_LOCATION_SUSPECTED even though nothing writes it:
-- the installed geolocation library does not expose Android's mock-location
-- signal (research.md §5). Declared because the flag-evaluation code reads
-- the whole set and the manager review slice renders it.
CREATE TYPE "VisitOutcome" AS ENUM ('ORDER', 'NO_ORDER');
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_REVIEW');
CREATE TYPE "DeliveryStatus" AS ENUM ('TO_DELIVER', 'DELIVERED');
CREATE TYPE "VisitFlag" AS ENUM ('LOW_ACCURACY', 'STALE_LOCATION', 'MOCK_LOCATION_SUSPECTED', 'OFFLINE_SUBMISSION', 'EXCEED_RANGE');

-- Step 3 (schema): the frozen shop coordinate on each stop.
--
-- This is what makes an offline visit synced days later measure against the
-- location in force when it was RECORDED rather than when it was received
-- (research.md §4). The radius was already frozen on this table; the
-- coordinate was not.
ALTER TABLE "assignment_stops" ADD COLUMN "shop_latitude" DECIMAL(9,6);
ALTER TABLE "assignment_stops" ADD COLUMN "shop_longitude" DECIMAL(9,6);

-- Step 4 (schema): the visits table.
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "executive_id" TEXT NOT NULL,
    "outcome" "VisitOutcome" NOT NULL,
    "sample_shown" BOOLEAN NOT NULL,
    "reason_id" TEXT,
    "reason_label" TEXT,
    "reason_text" TEXT,
    "captured_latitude" DECIMAL(9,6) NOT NULL,
    "captured_longitude" DECIMAL(9,6) NOT NULL,
    "accuracy_meters" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shop_latitude" DECIMAL(9,6),
    "shop_longitude" DECIMAL(9,6),
    "effective_radius_meters" INTEGER NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "is_exceed_range" BOOLEAN NOT NULL,
    "flags" "VisitFlag"[],
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- Step 5 (schema): orders and their lines.
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "brand_count" INTEGER NOT NULL,
    "delivery_status" "DeliveryStatus" NOT NULL DEFAULT 'TO_DELIVER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "brand_label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- Step 6 (schema): indexes.

-- LOAD-BEARING: this is what makes "exactly one outcome per stop" (FR-006,
-- SC-005) a database fact rather than a check that two concurrent
-- submissions could both pass. A manager-granted revisit produces a NEW
-- stop, so it gets its own visit without contending for this constraint.
CREATE UNIQUE INDEX "visits_stop_id_key" ON "visits"("stop_id");

CREATE INDEX "visits_company_id_shop_id_received_at_idx" ON "visits"("company_id", "shop_id", "received_at");
CREATE INDEX "visits_company_id_assignment_id_idx" ON "visits"("company_id", "assignment_id");
CREATE INDEX "visits_company_id_review_status_idx" ON "visits"("company_id", "review_status");

CREATE UNIQUE INDEX "orders_visit_id_key" ON "orders"("visit_id");
CREATE INDEX "orders_company_id_shop_id_idx" ON "orders"("company_id", "shop_id");
CREATE INDEX "orders_company_id_delivery_status_idx" ON "orders"("company_id", "delivery_status");

-- The database-level backstop for FR-012: the same brand cannot appear twice
-- on one order even under a retry.
CREATE UNIQUE INDEX "order_lines_order_id_brand_id_key" ON "order_lines"("order_id", "brand_id");
CREATE INDEX "order_lines_company_id_brand_id_idx" ON "order_lines"("company_id", "brand_id");

-- Step 7 (schema): foreign keys.
ALTER TABLE "visits" ADD CONSTRAINT "visits_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "assignment_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_executive_id_fkey" FOREIGN KEY ("executive_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "reason_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
