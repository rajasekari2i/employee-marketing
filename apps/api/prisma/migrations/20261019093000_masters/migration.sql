-- 004-brands-reasons-crud: the two master tables (data-model.md).
--
-- Hand-written rather than generated: `prisma migrate dev` cannot run in this
-- environment (the database role lacks CREATEDB, so Prisma can't build its
-- shadow database — P3014). The DDL below mirrors exactly what the generator
-- would emit for the `Brand` and `ReasonMessage` models in schema.prisma, and
-- is applied with `prisma migrate deploy`, which needs no shadow database.
--
-- Beyond that generated DDL, this migration adds three things Prisma's schema
-- language cannot express, plus a data backfill:
--   * two functional unique indexes on (company_id, lower(label)) — the
--     constraint that actually enforces FR-007's case-insensitive rule. The
--     plain @@unique([companyId, label]) is case-SENSITIVE and would happily
--     store "Parle" and "parle" side by side.
--   * a partial unique index guaranteeing at most one system reason per
--     company, so the FR-011 invariant cannot be broken by a future code path.
--   * the "Other" backfill for companies that already existed before this
--     slice (Step 4). New companies get theirs in companies.service.ts.
--
-- No foreign key on company_id: no tenant table in this schema declares one
-- (see beat_plans/shops), so this follows the established shape.
--
-- RLS for both tables lives in the sibling 20261019093018_rls_masters
-- migration, which sorts AFTER this one. That ordering is load-bearing:
-- Step 4's INSERT must run BEFORE FORCE ROW LEVEL SECURITY is enabled, or it
-- would be rejected (the migration role is not BYPASSRLS and no
-- app.company_id is set during a migration). Do not merge the two files.

-- Step 1 (schema): the brands table.
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- Step 2 (schema): the reason_messages table.
CREATE TABLE "reason_messages" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "requires_text" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reason_messages_pkey" PRIMARY KEY ("id")
);

-- Step 3 (schema): indexes.

-- CreateIndex
CREATE INDEX "brands_company_id_is_active_display_order_idx" ON "brands"("company_id", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "brands_company_id_label_key" ON "brands"("company_id", "label");

-- CreateIndex
CREATE INDEX "reason_messages_company_id_is_active_display_order_idx" ON "reason_messages"("company_id", "is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "reason_messages_company_id_label_key" ON "reason_messages"("company_id", "label");

-- Hand-written (not expressible in schema.prisma): case-insensitive label
-- uniqueness per company. This is the constraint FR-007 actually needs; the
-- two exact-match unique indexes above are Prisma's and are kept so the
-- schema and the database stay in agreement. The service pre-checks
-- case-insensitively so the admin gets DUPLICATE_BRAND_LABEL /
-- DUPLICATE_REASON_LABEL (409) rather than a raw constraint violation —
-- these indexes are the race backstop behind that check.
CREATE UNIQUE INDEX "brands_company_lower_label_key" ON "brands"("company_id", lower("label"));
CREATE UNIQUE INDEX "reason_messages_company_lower_label_key" ON "reason_messages"("company_id", lower("label"));

-- Hand-written: at most one system ("Other") reason per company. Makes the
-- FR-011 / SC-005 invariant structural rather than a convention any future
-- writer could violate.
CREATE UNIQUE INDEX "reason_messages_one_system_per_company" ON "reason_messages"("company_id") WHERE "is_system";

-- Step 4 (data): give every company that already exists its system "Other"
-- reason. New companies get theirs inside the same transaction that creates
-- the company (companies.service.ts, research.md §3), so this backfill only
-- ever covers rows created before this slice.
--
-- WHERE NOT EXISTS makes this a correct no-op on a fresh database (zero
-- companies) and idempotent if ever re-run — the same guarantee the
-- 20261015175722_roles_application_wide backfill documents.
--
-- display_order 0 is unused for sorting: reason lists order by
-- (is_system ASC, display_order ASC), so this row lands last by construction
-- regardless of its value (data-model.md "Ordering").
INSERT INTO "reason_messages" (
    "id", "company_id", "label", "display_order",
    "is_active", "requires_text", "is_system",
    "created_at", "updated_at"
)
SELECT
    gen_random_uuid()::text,
    c."id",
    'Other',
    0,
    true,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "companies" c
WHERE NOT EXISTS (
    SELECT 1 FROM "reason_messages" r
    WHERE r."company_id" = c."id" AND r."is_system"
);
