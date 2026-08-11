-- Retroactive fix (added later, see 20260811180000): "gstr_analytics_requests"
-- was created out-of-band via `prisma db push` at some point before this
-- migration was ever committed — no migration anywhere in this repo's
-- history actually creates it. Every environment that already applied this
-- migration already has the table from that db push, so this
-- CREATE TABLE IF NOT EXISTS is a no-op there. A genuinely fresh database
-- (new server, `prisma migrate deploy` from empty) would otherwise fail
-- here with "relation does not exist" and never reach any migration after
-- this one — including every data-retention/purge migration. Column list
-- matches the table's shape as of just before this migration (i.e.
-- deliberately excludes the columns the ALTER TABLE below adds, and
-- excludes webhook_token, added later by 20260724010000_add_webhook_token_fields)
-- so the ALTER/ADD COLUMN statements below and in later migrations still
-- apply cleanly on top of it either way.
CREATE TABLE IF NOT EXISTS "gstr_analytics_requests" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "applicant_id" INTEGER,
    "mode" "GstrRequestMode" NOT NULL,
    "auth_type" "GstrAuthType",
    "gstin" TEXT NOT NULL,
    "username" TEXT,
    "from_date" TEXT NOT NULL,
    "to_date" TEXT NOT NULL,
    "entity_details" BOOLEAN NOT NULL DEFAULT false,
    "pdf_url_requested" BOOLEAN NOT NULL DEFAULT false,
    "emails" JSONB,
    "mobile_numbers" JSONB,
    "callback_url" TEXT,
    "provider_request_id" TEXT,
    "auth_link" TEXT,
    "status" "GstrAnalyticsStatus" NOT NULL DEFAULT 'INITIATED',
    "provider_message" TEXT,
    "raw_gst_data" JSONB,
    "report_json_url" TEXT,
    "report_excel_url" TEXT,
    "report_pdf_url" TEXT,
    "callback_payload" JSONB,
    "wallet_transaction_id" INTEGER,
    "otp_attempts" INTEGER NOT NULL DEFAULT 0,
    "gst_pdf_document_id" INTEGER,
    "gst_excel_document_id" INTEGER,
    "gst_json_document_id" INTEGER,
    "turnover_latest_year" DECIMAL(18,2),
    "turnover_previous_year" DECIMAL(18,2),
    "financial_year_latest" TEXT,
    "financial_year_previous" TEXT,
    "avg_monthly_turnover" DECIMAL(18,2),
    "months_filed_12m" INTEGER,
    "nil_return_months" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "gstr_analytics_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gstr_analytics_requests_provider_request_id_key" ON "gstr_analytics_requests"("provider_request_id");
CREATE INDEX IF NOT EXISTS "gstr_analytics_requests_tenant_id_idx" ON "gstr_analytics_requests"("tenant_id");
CREATE INDEX IF NOT EXISTS "gstr_analytics_requests_provider_request_id_idx" ON "gstr_analytics_requests"("provider_request_id");

-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS" for foreign keys, so these
-- are guarded the same way as the enum/FK guards used elsewhere in this
-- migration history — a no-op on environments that already have them
-- (from the same original db push), required for a genuinely fresh DB.
DO $$ BEGIN
  ALTER TABLE "gstr_analytics_requests" ADD CONSTRAINT "gstr_analytics_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "gstr_analytics_requests" ADD CONSTRAINT "gstr_analytics_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "gstr_analytics_requests" ADD CONSTRAINT "gstr_analytics_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "gstr_analytics_requests" ADD CONSTRAINT "gstr_analytics_requests_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
CREATE TYPE "GstTurnoverSource" AS ENUM ('GSTR1', 'GSTR3B', 'PROVIDER_REPORT', 'BULK_UPLOAD', 'MANUAL');

-- AlterTable
ALTER TABLE "gstr_analytics_requests" ADD COLUMN     "metrics_error" TEXT,
ADD COLUMN     "metrics_extracted_at" TIMESTAMP(3),
ADD COLUMN     "metrics_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "payload_version" TEXT,
ADD COLUMN     "processing_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "provider_api_version" TEXT,
ADD COLUMN     "provider_callback_payload" JSONB,
ADD COLUMN     "provider_name" TEXT,
ADD COLUMN     "raw_fetch_data" JSONB,
ADD COLUMN     "raw_report_data" JSONB,
ADD COLUMN     "report_status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "rolling_12_month_end_period" TEXT,
ADD COLUMN     "rolling_12_month_turnover" DECIMAL(18,2),
ADD COLUMN     "selected_turnover_latest_fy" DECIMAL(18,2),
ADD COLUMN     "selected_turnover_previous_fy" DECIMAL(18,2),
ADD COLUMN     "selected_turnover_source" TEXT;

-- CreateTable
CREATE TABLE "gst_financial_year_summaries" (
    "id" SERIAL NOT NULL,
    "gst_request_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "applicant_id" INTEGER,
    "gstin" TEXT NOT NULL,
    "financial_year" TEXT NOT NULL,
    "source" "GstTurnoverSource" NOT NULL,
    "turnover" DECIMAL(18,2),
    "months_available" INTEGER NOT NULL DEFAULT 0,
    "months_filed" INTEGER NOT NULL DEFAULT 0,
    "zero_filing_months" INTEGER NOT NULL DEFAULT 0,
    "unavailable_months" INTEGER NOT NULL DEFAULT 0,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "processing_version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gst_financial_year_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gst_financial_year_summaries_case_id_financial_year_source_idx" ON "gst_financial_year_summaries"("case_id", "financial_year", "source");

-- CreateIndex
CREATE INDEX "gst_financial_year_summaries_gstin_financial_year_idx" ON "gst_financial_year_summaries"("gstin", "financial_year");

-- CreateIndex
CREATE UNIQUE INDEX "gst_financial_year_summaries_gst_request_id_financial_year__key" ON "gst_financial_year_summaries"("gst_request_id", "financial_year", "source", "processing_version");

-- AddForeignKey
ALTER TABLE "gst_financial_year_summaries" ADD CONSTRAINT "gst_financial_year_summaries_gst_request_id_fkey" FOREIGN KEY ("gst_request_id") REFERENCES "gstr_analytics_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
