-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('MAP_SEARCH', 'MANUAL_DRAG');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('NONE', 'APPROVED');

-- CreateEnum
CREATE TYPE "PinChangeStatus" AS ENUM ('REQUESTED', 'DECIDED');

-- AlterEnum
ALTER TYPE "PhotoKind" ADD VALUE 'SHOP_PHOTO';

-- CreateTable
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "shopCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT,
    "phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "location_source" "LocationSource",
    "location_status" "LocationStatus" NOT NULL DEFAULT 'NONE',
    "location_captured_at" TIMESTAMP(3),
    "location_captured_by" TEXT,
    "location_verified_at" TIMESTAMP(3),
    "location_verified_by" TEXT,
    "geohash" TEXT,
    "verification_radius_meters" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_photos" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_pin_changes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "status" "PinChangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "from_latitude" DECIMAL(9,6),
    "from_longitude" DECIMAL(9,6),
    "to_latitude" DECIMAL(9,6) NOT NULL,
    "to_longitude" DECIMAL(9,6) NOT NULL,
    "source" "LocationSource" NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "shop_pin_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shops_company_id_is_active_idx" ON "shops"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "shops_company_id_location_status_idx" ON "shops"("company_id", "location_status");

-- CreateIndex
CREATE UNIQUE INDEX "shops_company_id_shopCode_key" ON "shops"("company_id", "shopCode");

-- CreateIndex
CREATE INDEX "shop_photos_company_id_shop_id_sort_order_idx" ON "shop_photos"("company_id", "shop_id", "sort_order");

-- CreateIndex
CREATE INDEX "shop_pin_changes_company_id_shop_id_status_idx" ON "shop_pin_changes"("company_id", "shop_id", "status");

-- AddForeignKey
ALTER TABLE "shop_photos" ADD CONSTRAINT "shop_photos_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_photos" ADD CONSTRAINT "shop_photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_pin_changes" ADD CONSTRAINT "shop_pin_changes_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
