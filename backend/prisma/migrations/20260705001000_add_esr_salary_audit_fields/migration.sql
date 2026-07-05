ALTER TABLE "case_esr_financials"
  ADD COLUMN IF NOT EXISTS "salaried_gross_monthly" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "salaried_net_monthly" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "salaried_deductions_monthly" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "salaried_months_available" INTEGER,
  ADD COLUMN IF NOT EXISTS "salaried_months_required" INTEGER,
  ADD COLUMN IF NOT EXISTS "salaried_period_from" TEXT,
  ADD COLUMN IF NOT EXISTS "salaried_period_to" TEXT,
  ADD COLUMN IF NOT EXISTS "salaried_data_complete" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "salaried_source" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_net_salary_monthly" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "bank_salary_months_available" INTEGER;
