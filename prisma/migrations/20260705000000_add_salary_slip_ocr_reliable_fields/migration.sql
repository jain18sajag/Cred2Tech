ALTER TABLE "salary_slip_ocr_results"
  ADD COLUMN IF NOT EXISTS "ocr_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "pages_processed" INTEGER,
  ADD COLUMN IF NOT EXISTS "employee_pan" TEXT,
  ADD COLUMN IF NOT EXISTS "net_salary_words_match" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "extraction_checks" JSONB,
  ADD COLUMN IF NOT EXISTS "extraction_warnings" JSONB,
  ADD COLUMN IF NOT EXISTS "extraction_source" TEXT,
  ADD COLUMN IF NOT EXISTS "salary_period" TEXT,
  ADD COLUMN IF NOT EXISTS "deductions_is_derived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "name_match_status" TEXT,
  ADD COLUMN IF NOT EXISTS "pan_match_status" TEXT;
