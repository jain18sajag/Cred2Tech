-- AlterTable
ALTER TABLE "case_credit_obligations" ADD COLUMN "include_in_foir" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE IF NOT EXISTS "case_esr_financials" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "requested_loan_amount" DOUBLE PRECISION,
    "requested_tenure_months" INTEGER,
    "product_type" TEXT,
    "property_value" DOUBLE PRECISION,
    "property_type" TEXT,
    "occupancy_type" TEXT,
    "bureau_score" INTEGER,
    "applicant_age" INTEGER,
    "existing_obligations" DOUBLE PRECISION,
    "icici_exposure" DOUBLE PRECISION,
    "itr_pat" DOUBLE PRECISION,
    "itr_depreciation" DOUBLE PRECISION,
    "itr_finance_cost" DOUBLE PRECISION,
    "itr_gross_receipts" DOUBLE PRECISION,
    "gst_avg_monthly_sales" DOUBLE PRECISION,
    "gst_industry_type" TEXT,
    "gst_industry_margin" DOUBLE PRECISION,
    "bank_avg_balance" DOUBLE PRECISION,
    "bank_monthly_income" DOUBLE PRECISION,
    "net_profit_income" DOUBLE PRECISION,
    "gst_income" DOUBLE PRECISION,
    "banking_income" DOUBLE PRECISION,
    "selected_income_method" TEXT,
    "selected_monthly_income" DOUBLE PRECISION,
    "constitution_type" TEXT,
    "employment_type" TEXT,
    "business_vintage_months" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_esr_financials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "case_esr_financials_case_id_key" ON "case_esr_financials"("case_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_esr_financials_case_id_fkey') THEN
        ALTER TABLE "case_esr_financials" ADD CONSTRAINT "case_esr_financials_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END;
$$;
