-- 012-monthly-salary-run: the salary run and its per-employee lines
-- (data-model.md).
--
-- Hand-written rather than generated: `prisma migrate dev` cannot run in this
-- environment (the database role lacks CREATEDB, so Prisma cannot build its
-- shadow database — P3014). The DDL below mirrors exactly what the generator
-- would emit for the `SalaryRun` and `SalaryRunLine` models in schema.prisma,
-- and is applied with `prisma migrate deploy`, which needs no shadow database.
-- Same approach and reasoning as 20261019140000_assignments.
--
-- No foreign key on company_id: no tenant table in this schema declares one.
--
-- RLS for both tables lives in the sibling 20261023090018_rls_salary_runs
-- migration, which sorts AFTER this one.
--
-- NO BACKFILL, and that is a decision rather than an oversight. Every other
-- additive migration in this repo either carries a backfill or says why it
-- does not; here there is nothing to carry forward. A salary run is a
-- financial record of a month that someone generated and reviewed, and
-- manufacturing one for a month that was never run would fabricate exactly
-- the kind of record BR-24 exists to protect.

-- Step 1 (schema): enum type.
--
-- Two members, both with a writer in this slice. Nothing speculative: the
-- same discipline that kept "ReviewStatus" from growing in 010.
CREATE TYPE "SalaryRunStatus" AS ENUM ('DRAFT', 'FINALISED');

-- Step 2 (schema): the run header.
--
-- period_year / period_month rather than a date range: the month is
-- ADDRESSED, so there is no boundary ambiguity and no timezone baked into the
-- key. CompanyClock decides what month it is; this table records which one.
--
-- gross_total is stored, never recomputed on read. That IS the freeze — a
-- finalised figure must not become a function of present-day master data.
CREATE TABLE "salary_runs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SalaryRunStatus" NOT NULL DEFAULT 'DRAFT',
    "gross_total" DECIMAL(14,2) NOT NULL,
    "generated_by" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalised_by" TEXT,
    "finalised_at" TIMESTAMP(3),

    CONSTRAINT "salary_runs_pkey" PRIMARY KEY ("id")
);

-- Step 3 (schema): the per-employee lines.
--
-- breakdown is [{from,to,units,rate,amount}] — the per-date-range sub-lines
-- board 4.13 renders. Stored rather than derived because a sub-line names a
-- rate AS IT WAS on a date; recomputing it from user_salary_rates would let a
-- back-dated rate correction rewrite a finalised payslip.
--
-- ON DELETE CASCADE on salary_run_id: regenerating a DRAFT replaces it and
-- its lines together, and a run whose lines outlived it would be a half
-- record of a month.
CREATE TABLE "salary_run_lines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "salary_run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payable_units" DECIMAL(6,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "salary_run_lines_pkey" PRIMARY KEY ("id")
);

-- Step 4 (schema): indexes.
--
-- The unique key carries "version" on purpose. It is what makes two live
-- versions of one month unrepresentable, and what makes two admins
-- regenerating at once produce one winner and one P2002 rather than a lost
-- update — exactly what the attendance key does for amendments.
CREATE UNIQUE INDEX "salary_runs_company_id_period_year_period_month_version_key"
    ON "salary_runs"("company_id", "period_year", "period_month", "version");
CREATE INDEX "salary_runs_company_id_period_year_period_month_idx"
    ON "salary_runs"("company_id", "period_year", "period_month");

CREATE UNIQUE INDEX "salary_run_lines_salary_run_id_user_id_key"
    ON "salary_run_lines"("salary_run_id", "user_id");
CREATE INDEX "salary_run_lines_company_id_user_id_idx"
    ON "salary_run_lines"("company_id", "user_id");

-- Step 5 (schema): foreign keys.
ALTER TABLE "salary_run_lines" ADD CONSTRAINT "salary_run_lines_salary_run_id_fkey"
    FOREIGN KEY ("salary_run_id") REFERENCES "salary_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "salary_run_lines" ADD CONSTRAINT "salary_run_lines_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
