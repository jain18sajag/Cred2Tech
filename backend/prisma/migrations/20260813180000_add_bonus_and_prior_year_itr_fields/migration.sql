-- Every lender's requirement sheet lists "Annual Bonus" as considerable
-- salaried income, and HDFC/India Shelters/Piramal/Tata Capital's Net Profit
-- Method policies require a 2-year PAT growth test before deciding whether to
-- average or use latest-year income. Neither had a column to persist to, so
-- both rules were permanently dead code (always treated as absent/zero).
ALTER TABLE "case_esr_financials"
  ADD COLUMN IF NOT EXISTS "salaried_annual_bonus" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "itr_pat_previous_year" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "itr_gross_receipts_previous_year" DOUBLE PRECISION;
