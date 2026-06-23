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
