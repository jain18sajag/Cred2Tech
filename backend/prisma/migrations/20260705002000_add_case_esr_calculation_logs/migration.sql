CREATE TABLE IF NOT EXISTS "case_esr_calculation_logs" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "esr_id" INTEGER,
    "calculation_run_id" TEXT NOT NULL,
    "lender_code" TEXT,
    "lender_name" TEXT,
    "scheme_code" TEXT,
    "scheme_name" TEXT,
    "selected_method" TEXT,
    "calculation_status" TEXT NOT NULL DEFAULT 'GENERATED',
    "calculation_version" TEXT,
    "policy_version" TEXT,
    "source_snapshot_id" INTEGER,
    "requested_loan_amount" DOUBLE PRECISION,
    "requested_tenure_months" INTEGER,
    "final_tenure_months" INTEGER,
    "roi_annual" DOUBLE PRECISION,
    "emi_per_lakh" DOUBLE PRECISION,
    "eligible_monthly_income" DOUBLE PRECISION,
    "eligible_emi_capacity" DOUBLE PRECISION,
    "income_based_eligibility" DOUBLE PRECISION,
    "ltv_based_eligibility" DOUBLE PRECISION,
    "product_cap" DOUBLE PRECISION,
    "exposure_deduction" DOUBLE PRECISION,
    "pos_deduction" DOUBLE PRECISION,
    "final_eligible_amount" DOUBLE PRECISION,
    "manual_review_required" BOOLEAN NOT NULL DEFAULT false,
    "configuration_error" BOOLEAN NOT NULL DEFAULT false,
    "warnings_json" JSONB,
    "errors_json" JSONB,
    "input_snapshot_json" JSONB,
    "source_paths_json" JSONB,
    "calculation_steps_json" JSONB,
    "excluded_records_json" JSONB,
    "json_file_name" TEXT,
    "json_file_path" TEXT,
    "json_file_url" TEXT,
    "json_checksum_sha256" TEXT,
    "xlsx_file_name" TEXT,
    "xlsx_file_path" TEXT,
    "xlsx_file_url" TEXT,
    "xlsx_checksum_sha256" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,

    CONSTRAINT "case_esr_calculation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "case_esr_calculation_logs_case_id_calculation_run_id_idx"
    ON "case_esr_calculation_logs"("case_id", "calculation_run_id");

CREATE INDEX IF NOT EXISTS "case_esr_calculation_logs_tenant_id_case_id_created_at_idx"
    ON "case_esr_calculation_logs"("tenant_id", "case_id", "created_at");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'case_esr_calculation_logs_case_id_fkey'
    ) THEN
        ALTER TABLE "case_esr_calculation_logs"
            ADD CONSTRAINT "case_esr_calculation_logs_case_id_fkey"
            FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'case_esr_calculation_logs_tenant_id_fkey'
    ) THEN
        ALTER TABLE "case_esr_calculation_logs"
            ADD CONSTRAINT "case_esr_calculation_logs_tenant_id_fkey"
            FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'case_esr_calculation_logs_esr_id_fkey'
    ) THEN
        ALTER TABLE "case_esr_calculation_logs"
            ADD CONSTRAINT "case_esr_calculation_logs_esr_id_fkey"
            FOREIGN KEY ("esr_id") REFERENCES "eligibility_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
