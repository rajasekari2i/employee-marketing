-- CreateTable
CREATE TABLE "beat_plans" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "executive_id" TEXT,
    "working_days" INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beat_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beat_plan_shops" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "beat_plan_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "beat_plan_shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "beat_plans_company_id_is_active_idx" ON "beat_plans"("company_id", "is_active");

-- CreateIndex
CREATE INDEX "beat_plans_company_id_executive_id_idx" ON "beat_plans"("company_id", "executive_id");

-- CreateIndex
CREATE UNIQUE INDEX "beat_plans_company_id_code_key" ON "beat_plans"("company_id", "code");

-- CreateIndex
CREATE INDEX "beat_plan_shops_company_id_beat_plan_id_sequence_idx" ON "beat_plan_shops"("company_id", "beat_plan_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "beat_plan_shops_beat_plan_id_shop_id_key" ON "beat_plan_shops"("beat_plan_id", "shop_id");

-- AddForeignKey
ALTER TABLE "beat_plans" ADD CONSTRAINT "beat_plans_executive_id_fkey" FOREIGN KEY ("executive_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beat_plan_shops" ADD CONSTRAINT "beat_plan_shops_beat_plan_id_fkey" FOREIGN KEY ("beat_plan_id") REFERENCES "beat_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beat_plan_shops" ADD CONSTRAINT "beat_plan_shops_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "shops_company_id_shopCode_key" RENAME TO "shops_company_id_shop_code_key";
