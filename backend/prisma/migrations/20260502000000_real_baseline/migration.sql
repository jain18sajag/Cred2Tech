-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('CRED2TECH', 'DSA');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CustomerCategory" AS ENUM ('MSME', 'SALARIED');

-- CreateEnum
CREATE TYPE "CaseStage" AS ENUM ('DRAFT', 'LEAD_CREATED', 'DATA_COLLECTION', 'INCOME_REVIEWED', 'ESR_GENERATED', 'LEAD_SENT_TO_LENDER', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'PARTLY_DISBURSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicantType" AS ENUM ('PRIMARY', 'CO_APPLICANT');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('SALARIED', 'SELF_EMPLOYED', 'NA');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PRIMARY_APPLICANT', 'CO_APPLICANT');

-- CreateEnum
CREATE TYPE "OtpTargetType" AS ENUM ('CUSTOMER', 'APPLICANT');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionReferenceType" AS ENUM ('API_CALL', 'ADMIN_TOPUP', 'REFUND', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ApiUsageStatus" AS ENUM ('SUCCESS', 'FAILED', 'REFUNDED', 'BLOCKED_INSUFFICIENT_CREDITS', 'BLOCKED_INACTIVE_API');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('GST', 'ITR', 'PAN');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('DIRECT_LOGIN', 'LINK_SENT');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'PENDING', 'REVOKED');

-- CreateEnum
CREATE TYPE "GstrRequestMode" AS ENUM ('AUTH_LINK', 'IN_SYSTEM');

-- CreateEnum
CREATE TYPE "GstrAuthType" AS ENUM ('OTP', 'PASSWORD');

-- CreateEnum
CREATE TYPE "GstrAnalyticsStatus" AS ENUM ('INITIATED', 'AUTH_LINK_CREATED', 'OTP_PENDING', 'OTP_VERIFIED', 'PROCESSING', 'DATA_READY', 'REPORT_READY', 'CALLBACK_RECEIVED', 'COMPLETED', 'FAILED', 'EXPIRED');


-- CreateEnum
CREATE TYPE "ItrAnalyticsStatus" AS ENUM ('INITIATED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankStatementStatus" AS ENUM ('INITIATED', 'PRE_ANALYZING', 'ANALYZING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DataPullStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "LenderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LenderProductType" AS ENUM ('HL', 'LAP', 'WC', 'TL', 'ML', 'BL');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('GST_REPORT_PDF', 'GST_REPORT_EXCEL', 'GST_REPORT_JSON', 'ITR_EXCEL', 'BANK_EXCEL', 'BANK_JSON', 'PAN_CARD', 'AADHAAR', 'GST_PDF', 'ITR', 'BANK_STATEMENT', 'PROPERTY_DOCUMENT', 'SALE_DEED', 'SALARY_SLIP', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('VENDOR_DOWNLOAD', 'DIRECT_UPLOAD', 'SYSTEM_GENERATED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'CLOUDFLARE_R2', 'S3');

-- CreateEnum
CREATE TYPE "PayoutBasis" AS ENUM ('NET_DISBURSED', 'GROSS_SANCTIONED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED_PER_CASE', 'HYBRID');

-- CreateEnum
CREATE TYPE "CommissionSpecialSchemeBasis" AS ENUM ('VOLUME', 'CASE_COUNT');




-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommissionLedgerStatus" AS ENUM ('PENDING', 'INVOICED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionEntryType" AS ENUM ('BASE_COMMISSION', 'REVERSAL', 'MANUAL_ADJUSTMENT', 'VOLUME_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SubDsaPayoutStatus" AS ENUM ('DRAFT', 'INVOICE_RAISED', 'UNDER_REVIEW', 'RECONCILED', 'PDD_PENDING', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "IncentiveCommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "IncentiveCalculationBase" AS ENUM ('DISBURSED_AMOUNT', 'LENDER_COMMISSION', 'DSA_NET_COMMISSION', 'PROCESSING_FEE', 'FIXED_PER_CASE');

-- CreateEnum
CREATE TYPE "SalesIncentiveStatus" AS ENUM ('CALCULATED', 'APPROVED', 'PAID', 'REJECTED', 'ON_HOLD', 'RULE_NOT_CONFIGURED', 'OWNER_NOT_CONFIGURED');






-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "type" "TenantType" NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "pan_number" TEXT,
    "gst_number" TEXT,
    "company_type" TEXT,
    "state" TEXT,
    "city" TEXT,
    "pincode" TEXT,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "password_hash" TEXT NOT NULL,
    "role_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "hierarchy_level" TEXT,
    "manager_id" INTEGER,
    "hierarchy_path" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "designation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "last_login_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "category" "CustomerCategory" NOT NULL DEFAULT 'MSME',
    "business_pan" TEXT NOT NULL,
    "business_name" TEXT,
    "business_mobile" TEXT,
    "business_email" TEXT,
    "entity_type" TEXT,
    "dob" TEXT,
    "industry" TEXT,
    "business_vintage" TEXT,
    "is_professional" BOOLEAN NOT NULL DEFAULT false,
    "profession_type" TEXT,
    "mobile_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "legal_business_name" TEXT,
    "trade_name" TEXT,
    "proprietor_name" TEXT,
    "pan_holder_name" TEXT,
    "business_name_source" TEXT,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pan_profiles" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "pan" TEXT NOT NULL,
    "gstin" TEXT,
    "constitution_of_business" TEXT,
    "legal_name" TEXT,
    "trade_name" TEXT,
    "principal_state" TEXT,
    "principal_city" TEXT,
    "principal_pincode" TEXT,
    "principal_address" TEXT,
    "director_names" JSONB,
    "annual_turnover_range" TEXT,
    "turnover_min" DOUBLE PRECISION,
    "turnover_max" DOUBLE PRECISION,
    "gross_total_income" TEXT,
    "income_financial_year" TEXT,
    "raw_response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pan_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_pan_gstin_records" (
    "id" SERIAL NOT NULL,
    "pan_profile_id" INTEGER NOT NULL,
    "gstin" TEXT NOT NULL,
    "registration_name" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_pan_gstin_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "product_type" TEXT,
    "loan_amount" DOUBLE PRECISION,
    "lender_name" TEXT,
    "property_type" TEXT,
    "occupancy" TEXT,
    "property_value" DOUBLE PRECISION,
    "location" TEXT,
    "ltv_ratio" DOUBLE PRECISION,
    "dsa_notes" TEXT,
    "esr_generated" BOOLEAN NOT NULL DEFAULT false,
    "stage" "CaseStage" NOT NULL DEFAULT 'DRAFT',
    "lead_source" TEXT DEFAULT 'DSA',
    "msme_customer_user_id" INTEGER,
    "assigned_dsa_tenant_id" INTEGER,
    "assigned_dsa_user_id" INTEGER,
    "allocated_by_admin_id" INTEGER,
    "allocated_at" TIMESTAMP(3),
    "msme_submitted_at" TIMESTAMP(3),
    "msme_selected_lender_esr_id" INTEGER,
    "customer_name" TEXT,
    "entity_type" TEXT,
    "cibil_score" INTEGER,
    "alert_flag" TEXT,
    "lead_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "proposal_sent_at" TIMESTAMP(3),
    "proposal_sent_by_user_id" INTEGER,
    "created_by_user_id" INTEGER NOT NULL,
    "parent_case_id" INTEGER,
    "tenant_lender_id" INTEGER,
    "contact_id" INTEGER,
    "dsa_code" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_mobile" TEXT,
    "is_cloned_snapshot" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "type" "ApplicantType" NOT NULL,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'NA',
    "name" TEXT,
    "pan_number" TEXT,
    "dob" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "cibil_score" INTEGER,
    "emi" DOUBLE PRECISION,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "bureau_fetched" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source_applicant_id" INTEGER,
    "pan_verified" BOOLEAN NOT NULL DEFAULT false,
    "pan_verified_at" TIMESTAMP(3),
    "pan_verification_status" TEXT,
    "pan_verification_reference" TEXT,
    "pan_verified_name" TEXT,
    "pan_verified_dob" TEXT,
    "pan_verification_response" JSONB,
    "pan_verified_by_user_id" INTEGER,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER,
    "customer_id" INTEGER,
    "activity_type" TEXT NOT NULL,
    "description" TEXT,
    "performed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_stage_history" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "old_stage" "CaseStage" NOT NULL,
    "new_stage" "CaseStage" NOT NULL,
    "changed_by" INTEGER,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_verifications" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "mobile" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "target_type" "OtpTargetType" NOT NULL,
    "target_id" INTEGER NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_otps" (
    "id" SERIAL NOT NULL,
    "mobile" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'MSME_CUSTOMER_LOGIN',
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_payments" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "purpose" TEXT NOT NULL,
    "amount_inr" DECIMAL(12,2) NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "razorpay_signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "idempotency_key" TEXT NOT NULL,
    "failure_reason" TEXT,
    "gst_amount" DECIMAL(12,2),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_pricing" (
    "id" SERIAL NOT NULL,
    "api_code" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "api_name" TEXT,
    "description" TEXT,
    "vendor_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "default_credit_cost" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" INTEGER,

    CONSTRAINT "api_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volume_discounts" (
    "id" SERIAL NOT NULL,
    "min_topup_amount" DOUBLE PRECISION NOT NULL,
    "bonus_percentage" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "volume_discounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_api_pricing_overrides" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "api_code" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "custom_credit_cost" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_api_pricing_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_wallets" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_wallets_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "api_usage_logs" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "triggered_by_user_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "api_code" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "status" "ApiUsageStatus" NOT NULL,
    "request_payload" JSONB,
    "response_payload" JSONB,
    "response_status" TEXT,
    "error_message" TEXT,
    "reference_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_consents" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "consent_type" "ConsentType" NOT NULL,
    "consent_source" "ConsentSource" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "granted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_gst_profiles" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "gstin" TEXT NOT NULL,
    "filing_status" TEXT NOT NULL,
    "last_filed_period" TEXT NOT NULL,
    "annual_turnover" DOUBLE PRECISION NOT NULL,
    "raw_response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_gst_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itr_analytics_requests" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "applicant_id" INTEGER,
    "pan" TEXT NOT NULL,
    "reference_id" TEXT,
    "status" "ItrAnalyticsStatus" NOT NULL DEFAULT 'INITIATED',
    "excel_url" TEXT,
    "analytics_payload" JSONB,
    "provider_message" TEXT,
    "itr_document_id" INTEGER,
    "net_profit_latest_year" DECIMAL(18,2),
    "net_profit_previous_year" DECIMAL(18,2),
    "gross_receipts_latest_year" DECIMAL(18,2),
    "gross_receipts_previous_year" DECIMAL(18,2),
    "financial_year_latest" TEXT,
    "financial_year_previous" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "itr_analytics_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_analysis_requests" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "applicant_id" INTEGER,
    "auth_token" TEXT,
    "report_id" TEXT,
    "status" "BankStatementStatus" NOT NULL DEFAULT 'INITIATED',
    "provider_message" TEXT,
    "report_json_url" TEXT,
    "report_excel_url" TEXT,
    "files_payload" JSONB,
    "raw_analyze_response" JSONB,
    "raw_retrieve_response" JSONB,
    "raw_download_response" JSONB,
    "wallet_transaction_id" INTEGER,
    "bank_excel_document_id" INTEGER,
    "bank_json_document_id" INTEGER,
    "avg_bank_balance_latest_year" DECIMAL(18,2),
    "avg_bank_balance_previous_year" DECIMAL(18,2),
    "financial_year_latest" TEXT,
    "financial_year_previous" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "bank_statement_analysis_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_data_pull_statuses" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "pan_status" "DataPullStatus" NOT NULL DEFAULT 'PENDING',
    "bureau_status" "DataPullStatus" NOT NULL DEFAULT 'PENDING',
    "gst_status" "DataPullStatus" NOT NULL DEFAULT 'PENDING',
    "itr_status" "DataPullStatus" NOT NULL DEFAULT 'PENDING',
    "bank_status" "DataPullStatus" NOT NULL DEFAULT 'PENDING',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_data_pull_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bureau_verifications" (
    "id" TEXT NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER NOT NULL,
    "applicant_type" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "stan" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "score" TEXT,
    "raw_response" JSONB,
    "status" TEXT NOT NULL,
    "emi_obligations_total" DECIMAL(18,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bureau_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bureau_verification_logs" (
    "id" TEXT NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER NOT NULL,
    "request_payload" JSONB NOT NULL,
    "response_payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bureau_verification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lenders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "LenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "lenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_products" (
    "id" SERIAL NOT NULL,
    "lender_id" TEXT NOT NULL,
    "product_type" "LenderProductType" NOT NULL,
    "status" "LenderStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "lender_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schemes" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "scheme_name" TEXT NOT NULL,
    "status" "LenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parameter_master" (
    "id" SERIAL NOT NULL,
    "parameter_key" TEXT NOT NULL,
    "parameter_label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_editable_label" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "parameter_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_parameter_values" (
    "id" SERIAL NOT NULL,
    "scheme_id" INTEGER NOT NULL,
    "parameter_id" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "scheme_parameter_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "customer_id" INTEGER,
    "case_id" INTEGER,
    "applicant_id" INTEGER,
    "document_type" "DocumentType" NOT NULL,
    "source_type" "DocumentSource" NOT NULL,
    "source_url" TEXT,
    "storage_provider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storage_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_file_name" TEXT,
    "mime_type" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "file_size_bytes" INTEGER,
    "checksum_md5" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "uploaded_by_user_id" INTEGER,
    "metadata" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_property_details" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "property_type" TEXT,
    "occupancy_status" TEXT,
    "ownership_type" TEXT,
    "market_value" DOUBLE PRECISION,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_property_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_income_entries" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER,
    "income_type" TEXT NOT NULL,
    "applicant_label" TEXT,
    "annual_amount" DOUBLE PRECISION NOT NULL,
    "supporting_doc_type" TEXT,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_income_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_credit_obligations" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER NOT NULL,
    "lender_name" TEXT,
    "loan_type" TEXT,
    "loan_amount" DOUBLE PRECISION,
    "outstanding_amount" DOUBLE PRECISION,
    "loan_start_date" TIMESTAMP(3),
    "emi_per_month" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'BUREAU',
    "needs_verification" BOOLEAN NOT NULL DEFAULT false,
    "include_in_foir" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_credit_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_esr_financials" (
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
    "bank_total_credits" DOUBLE PRECISION,
    "bank_avg_monthly_credit" DOUBLE PRECISION,
    "bank_monthly_income" DOUBLE PRECISION,
    "net_profit_income" DOUBLE PRECISION,
    "gst_income" DOUBLE PRECISION,
    "banking_income" DOUBLE PRECISION,
    "salaried_income" DOUBLE PRECISION,
    "salaried_income_source" TEXT,
    "salaried_slip_count" INTEGER,
    "selected_income_method" TEXT,
    "selected_monthly_income" DOUBLE PRECISION,
    "constitution_type" TEXT,
    "employment_type" TEXT,
    "business_vintage_months" INTEGER,
    "extraction_status" TEXT NOT NULL DEFAULT 'PENDING',
    "extracted_at" TIMESTAMP(3),
    "itr_remuneration" DOUBLE PRECISION,
    "double_whammy_flag" BOOLEAN NOT NULL DEFAULT false,
    "net_worth" DOUBLE PRECISION,
    "salaried_incentive_income" DOUBLE PRECISION,
    "salaried_other_income" DOUBLE PRECISION,
    "manual_eligible_loan_amount" DOUBLE PRECISION,
    "manual_proposed_emi" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_esr_financials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_reports" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "version_number" INTEGER NOT NULL,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_by_user_id" INTEGER,
    "combined_income" DOUBLE PRECISION,
    "property_value" DOUBLE PRECISION,
    "primary_cibil_score" INTEGER,
    "lowest_cibil_score" INTEGER,
    "total_emi_per_month" DOUBLE PRECISION,
    "input_snapshot" JSONB NOT NULL,
    "raw_payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'GENERATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eligibility_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_report_lenders" (
    "id" SERIAL NOT NULL,
    "esr_id" INTEGER NOT NULL,
    "tenant_lender_id" INTEGER,
    "lender_id" TEXT,
    "lender_name" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "product_display_name" TEXT,
    "best_scheme_name" TEXT,
    "is_eligible" BOOLEAN NOT NULL,
    "eligible_amount" DOUBLE PRECISION,
    "roi" DOUBLE PRECISION,
    "tenure_months" INTEGER,
    "emi" DOUBLE PRECISION,
    "ltv" DOUBLE PRECISION,
    "foir" DOUBLE PRECISION,
    "remarks" TEXT,
    "rejection_reasons" JSONB,
    "scheme_evaluations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_report_lenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" SERIAL NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "api_type" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contract_start" TIMESTAMP(3) NOT NULL,
    "contract_end" TIMESTAMP(3) NOT NULL,
    "billing_model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_slabs" (
    "id" SERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "from_calls" INTEGER NOT NULL,
    "to_calls" INTEGER,
    "rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "vendor_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_commission_rules" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "tenant_lender_id" INTEGER NOT NULL,
    "product_type" "LenderProductType" NOT NULL,
    "payout_basis" "PayoutBasis" NOT NULL,
    "commission_type" "CommissionType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_volume_slabs" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "from_amount" DOUBLE PRECISION NOT NULL,
    "to_amount" DOUBLE PRECISION,
    "percent_rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "commission_volume_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_case_count_slabs" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "from_cases" INTEGER NOT NULL,
    "to_cases" INTEGER,
    "payout_per_case" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "commission_case_count_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_special_schemes" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "scheme_name" TEXT NOT NULL,
    "bonus_percent" DOUBLE PRECISION,
    "bonus_per_case" DOUBLE PRECISION,
    "basis" "CommissionSpecialSchemeBasis" NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "commission_special_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_lenders" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "lender_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_lenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_lender_contacts" (
    "id" SERIAL NOT NULL,
    "tenant_lender_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "product_type" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_mobile" TEXT,
    "dsa_code" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_lender_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_slip_ocr_results" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER NOT NULL,
    "document_id" INTEGER,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "ocr_status" "OcrStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'OCR',
    "gross_salary" DOUBLE PRECISION,
    "net_salary" DOUBLE PRECISION,
    "deductions" DOUBLE PRECISION,
    "employer_name" TEXT,
    "employee_name" TEXT,
    "vendor_name" TEXT,
    "vendor_job_id" TEXT,
    "raw_ocr_response" JSONB,
    "extracted_json" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_slip_ocr_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_ledgers" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "disbursement_id" INTEGER,
    "entry_type" "CommissionEntryType" NOT NULL DEFAULT 'BASE_COMMISSION',
    "reversal_of_id" INTEGER,
    "is_reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" INTEGER,
    "tenant_lender_id" INTEGER,
    "lender_name" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "payout_basis" TEXT NOT NULL,
    "commission_type" TEXT NOT NULL,
    "disbursed_amount" DECIMAL(18,2) NOT NULL,
    "calculated_commission" DECIMAL(18,2) NOT NULL,
    "slab_snapshot" JSONB NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,
    "status" "CommissionLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_payout_rules" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "sub_dsa_user_id" INTEGER NOT NULL,
    "default_payout_rate" DOUBLE PRECISION NOT NULL,
    "payout_trigger" TEXT NOT NULL,
    "tds_applicable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sub_dsa_payout_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_lender_overrides" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "tenant_lender_id" INTEGER NOT NULL,
    "products" TEXT NOT NULL,
    "override_rate" DOUBLE PRECISION NOT NULL,
    "effective_from" TIMESTAMP(3),

    CONSTRAINT "sub_dsa_lender_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_case_count_slabs" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "from_cases" INTEGER NOT NULL,
    "to_cases" INTEGER,
    "payout_per_case" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "sub_dsa_case_count_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_special_schemes" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "scheme_name" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "tenant_lender_id" INTEGER,
    "products" TEXT,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3) NOT NULL,
    "bonus_per_case" DOUBLE PRECISION,
    "bonus_percent" DOUBLE PRECISION,
    "min_case_count" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sub_dsa_special_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_payout_ledgers" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "sub_dsa_user_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "commission_ledger_id" INTEGER NOT NULL,
    "dsa_earned_amount" DECIMAL(18,2) NOT NULL,
    "sub_dsa_payout" DECIMAL(18,2) NOT NULL,
    "subvention_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "adjustment_reason" TEXT,
    "tds_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(18,2) NOT NULL,
    "status" "SubDsaPayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "invoice_id" INTEGER,
    "remarks" TEXT,
    "applied_scheme_snapshot" JSONB,
    "calculation_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sub_dsa_payout_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_invoices" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "sub_dsa_user_id" INTEGER NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "month_year" TEXT NOT NULL,
    "total_payout" DECIMAL(18,2) NOT NULL,
    "status" "SubDsaPayoutStatus" NOT NULL DEFAULT 'INVOICE_RAISED',
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_dsa_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_dsa_payout_history" (
    "id" SERIAL NOT NULL,
    "ledger_id" INTEGER NOT NULL,
    "old_status" "SubDsaPayoutStatus",
    "new_status" "SubDsaPayoutStatus" NOT NULL,
    "remarks" TEXT,
    "updated_by_id" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_dsa_payout_history_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "sales_incentive_rules" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "hierarchy_level" TEXT NOT NULL,
    "product_type" TEXT,
    "tenant_lender_id" INTEGER,
    "commission_type" "IncentiveCommissionType" NOT NULL,
    "commission_value" DECIMAL(10,2) NOT NULL,
    "calculation_base" "IncentiveCalculationBase" NOT NULL,
    "min_amount" DECIMAL(18,2),
    "max_cap_amount" DECIMAL(18,2),
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_incentive_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_incentive_ledgers" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "case_id" INTEGER NOT NULL,
    "disbursement_id" INTEGER,
    "commission_ledger_id" INTEGER,
    "hierarchy_level" TEXT,
    "rule_id" INTEGER,
    "base_amount" DECIMAL(18,2),
    "calculated_incentive" DECIMAL(18,2),
    "status" "SalesIncentiveStatus" NOT NULL DEFAULT 'CALCULATED',
    "remarks" TEXT,
    "calculation_metadata" JSONB,
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "paid_by" INTEGER,
    "paid_at" TIMESTAMP(3),
    "rejected_by" INTEGER,
    "rejected_at" TIMESTAMP(3),
    "payout_period" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_incentive_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" BIGINT,
    "admin_name" VARCHAR(120),
    "admin_email" VARCHAR(255),
    "action" VARCHAR(60) NOT NULL,
    "target_type" VARCHAR(40),
    "target_id" VARCHAR(80),
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" BIGSERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(15),
    "role" VARCHAR(50) DEFAULT 'ADMIN',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" VARCHAR(20) DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(6),
    "login_count" INTEGER DEFAULT 0,
    "tokens_valid_from" TIMESTAMPTZ(6),
    "must_change_password" BOOLEAN DEFAULT false,
    "admin_code" VARCHAR(20),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "region" VARCHAR(100),
    "expertise" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" VARCHAR(20) DEFAULT 'AVAILABLE',
    "certifications" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gender" VARCHAR(20),
    "status" VARCHAR(20) DEFAULT 'PENDING',
    "approval_status" VARCHAR(20) DEFAULT 'PENDING',
    "approved_by" BIGINT,
    "approved_at" TIMESTAMP(6),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(6),
    "login_count" INTEGER DEFAULT 0,
    "reset_token_hash" VARCHAR(255),
    "reset_token_expires_at" TIMESTAMPTZ(6),
    "tokens_valid_from" TIMESTAMPTZ(6),

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_activity_log" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "activity_type" VARCHAR(50) NOT NULL,
    "case_id" BIGINT,
    "details" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_availability_log" (
    "id" BIGSERIAL NOT NULL,
    "agent_id" BIGINT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_availability_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_log" (
    "id" BIGSERIAL NOT NULL,
    "session_id" VARCHAR(64),
    "msme_user_id" BIGINT,
    "business_id" BIGINT,
    "stage" VARCHAR(40) NOT NULL,
    "model" VARCHAR(60) NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "schemes_count" INTEGER NOT NULL DEFAULT 0,
    "system_fingerprint" VARCHAR(80),
    "elapsed_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_document_requests" (
    "id" BIGSERIAL NOT NULL,
    "case_id" BIGINT NOT NULL,
    "msme_user_id" BIGINT NOT NULL,
    "document_name" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "requested_by_agent_id" BIGINT,
    "requested_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(50) DEFAULT 'PENDING',
    "uploaded_document_id" BIGINT,
    "fulfilled_at" TIMESTAMPTZ(6),

    CONSTRAINT "case_document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_documents" (
    "id" BIGSERIAL NOT NULL,
    "case_id" BIGINT NOT NULL,
    "file_name" VARCHAR(500) NOT NULL,
    "file_type" VARCHAR(200),
    "file_size" BIGINT,
    "file_url" TEXT,
    "storage_path" TEXT,
    "document_tag" VARCHAR(255) DEFAULT '',
    "uploaded_by_agent_id" BIGINT,
    "uploaded_by_msme_user_id" BIGINT,
    "uploaded_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msme_businesses" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "is_primary" BOOLEAN DEFAULT false,
    "has_paid" BOOLEAN DEFAULT false,
    "payment_id" VARCHAR(100),
    "pan_number" VARCHAR(20),
    "pan_verified" BOOLEAN DEFAULT false,
    "gstin" VARCHAR(20),
    "gstin_verified" BOOLEAN DEFAULT false,
    "gstin_status" TEXT,
    "constitution_of_business" TEXT,
    "legal_name_of_business" TEXT,
    "trade_name_of_business" TEXT,
    "principal_address" TEXT,
    "principal_city" TEXT,
    "principal_state" TEXT,
    "principal_district" TEXT,
    "principal_pincode" VARCHAR(20),
    "director_names" TEXT,
    "annual_turnover_range" TEXT,
    "annual_turnover_lakhs" DECIMAL(15,2) DEFAULT 0,
    "taxpayer_type" TEXT,
    "registration_date" TEXT,
    "centre_jurisdiction" TEXT,
    "state_jurisdiction" TEXT,
    "nature_of_business_activities" TEXT,
    "einvoicing_status" TEXT,
    "nature_of_core_business" TEXT,
    "business_type" VARCHAR(50),
    "business_sector" VARCHAR(50),
    "enterprise_category" VARCHAR(50),
    "years_in_operation" INTEGER DEFAULT 0,
    "state" TEXT,
    "udyam_number" VARCHAR(50),
    "udyam_verified" BOOLEAN DEFAULT false,
    "udyam_registered" BOOLEAN,
    "investment_in_plant_machinery_lakhs" DECIMAL(15,2),
    "investment_in_equipment_lakhs" DECIMAL(15,2),
    "is_startup" BOOLEAN,
    "is_export_oriented" BOOLEAN DEFAULT false,
    "is_women_led" BOOLEAN DEFAULT false,
    "total_employees" INTEGER DEFAULT 0,
    "women_employees" INTEGER DEFAULT 0,
    "pwd_employees" INTEGER DEFAULT 0,
    "is_incorporated" BOOLEAN DEFAULT false,
    "is_first_generation_entrepreneur" BOOLEAN DEFAULT false,
    "has_patent" BOOLEAN DEFAULT false,
    "is_innovation_focused" BOOLEAN DEFAULT false,
    "has_rd_facility" BOOLEAN DEFAULT false,
    "business_stage" VARCHAR(50),
    "benefit_focus" VARCHAR(50),
    "registration_number" VARCHAR(50),
    "business_plan_ready" BOOLEAN DEFAULT false,
    "already_registered_schemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "years_domicile_in_state" DECIMAL(5,2),
    "is_in_notified_area" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "msme_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msme_otp_verifications" (
    "mobile" VARCHAR(15) NOT NULL,
    "otp" VARCHAR(10) NOT NULL,
    "expires_at" TIMESTAMP(6) NOT NULL,
    "verified" BOOLEAN DEFAULT false,
    "verified_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "msme_otp_verifications_pkey" PRIMARY KEY ("mobile")
);

-- CreateTable
CREATE TABLE "msme_payments" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "razorpay_order_id" VARCHAR(100),
    "razorpay_payment_id" VARCHAR(100),
    "razorpay_signature" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "payment_for" VARCHAR(50) NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "paid_at" TIMESTAMP(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "msme_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msme_pricing" (
    "id" BIGSERIAL NOT NULL,
    "service_type" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "msme_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msme_users" (
    "id" BIGSERIAL NOT NULL,
    "mobile_number" VARCHAR(15) NOT NULL,
    "otp_verified" BOOLEAN DEFAULT false,
    "otp_verified_at" TIMESTAMP(6),
    "status" VARCHAR(20) DEFAULT 'ACTIVE',
    "kyc_status" VARCHAR(20) DEFAULT 'PENDING',
    "has_paid" BOOLEAN DEFAULT false,
    "payment_id" VARCHAR(100),
    "pan_verified" BOOLEAN DEFAULT false,
    "last_data_refresh_at" TIMESTAMP(6),
    "data_refresh_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "differently_abled" BOOLEAN,
    "bpl" BOOLEAN,
    "minority" BOOLEAN,
    "pan_number" VARCHAR(10),
    "gstin" VARCHAR(15),
    "gstin_verified" BOOLEAN DEFAULT false,
    "constitution_of_business" TEXT,
    "legal_name_of_business" TEXT,
    "trade_name_of_business" TEXT,
    "principal_address" TEXT,
    "principal_city" TEXT,
    "principal_state" TEXT,
    "principal_pincode" TEXT,
    "business_type" VARCHAR(50),
    "sector" VARCHAR(100),
    "date_of_incorporation" DATE,
    "msme_type" VARCHAR(50),
    "annual_turnover_lakhs" DECIMAL(15,2),
    "total_employees" INTEGER,
    "nature_of_business" TEXT,
    "udyam_number" VARCHAR(20),
    "udyam_verified" BOOLEAN DEFAULT false,
    "principal_district" TEXT,
    "director_names" TEXT,
    "annual_turnover_range" TEXT,
    "taxpayer_type" TEXT,
    "gstin_status" TEXT,
    "registration_date" TEXT,
    "centre_jurisdiction" TEXT,
    "state_jurisdiction" TEXT,
    "nature_of_business_activities" TEXT,
    "einvoicing_status" TEXT,
    "nature_of_core_business" TEXT,
    "ekyc_authenticated" BOOLEAN DEFAULT false,
    "aadhar_authenticated" BOOLEAN DEFAULT false,
    "udyam_verified_at" TIMESTAMP(6),
    "rural_urban" VARCHAR(20),
    "is_ex_serviceman" BOOLEAN DEFAULT false,
    "investment_in_plant_machinery_lakhs" DECIMAL(15,2),
    "women_employees" INTEGER DEFAULT 0,
    "has_existing_loan" BOOLEAN DEFAULT false,
    "is_loan_defaulter" BOOLEAN DEFAULT false,
    "already_availed_subsidy" BOOLEAN DEFAULT false,
    "education_level" VARCHAR(50),
    "entity_type" VARCHAR(50),
    "is_first_generation_entrepreneur" BOOLEAN DEFAULT false,
    "is_incorporated" BOOLEAN DEFAULT false,
    "udyam_registered" BOOLEAN,
    "auth_step" VARCHAR(50) DEFAULT 'mobile_verified',
    "state" VARCHAR(100),
    "district" VARCHAR(100),
    "city" VARCHAR(100),
    "pincode" VARCHAR(20),
    "address" TEXT,
    "caste" VARCHAR(50),
    "religion" VARCHAR(50),
    "dob" DATE,
    "aadhar_number" VARCHAR(20),
    "aadhar_verified" BOOLEAN DEFAULT false,
    "business_sector" VARCHAR(100),
    "business_category" VARCHAR(100),
    "enterprise_category" VARCHAR(50),
    "years_in_operation" INTEGER,
    "refresh_token" TEXT,
    "refresh_token_expires_at" TIMESTAMP(6),
    "device_id" VARCHAR(255),
    "fcm_token" TEXT,
    "last_login_at" TIMESTAMP(6),
    "login_count" INTEGER DEFAULT 0,
    "ip_address" INET,
    "user_agent" TEXT,
    "location" TEXT,
    "referrer" VARCHAR(500),
    "utm_source" VARCHAR(100),
    "utm_medium" VARCHAR(100),
    "utm_campaign" VARCHAR(100),
    "utm_content" VARCHAR(100),
    "utm_term" VARCHAR(100),
    "landing_page" VARCHAR(500),
    "signup_source" VARCHAR(50),
    "verification_method" VARCHAR(50),
    "verification_metadata" JSONB,
    "name" VARCHAR(100),
    "email" VARCHAR(255),
    "age" INTEGER,
    "gender" VARCHAR(20),
    "social_category" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_women_led" BOOLEAN DEFAULT false,
    "is_startup" BOOLEAN,
    "is_export_oriented" BOOLEAN DEFAULT false,
    "years_domicile_in_state" INTEGER,
    "business_stage" VARCHAR(50),
    "benefit_focus" VARCHAR(50),
    "is_in_notified_area" BOOLEAN DEFAULT false,
    "investment_in_equipment_lakhs" DECIMAL(15,2),
    "pwd_employees" INTEGER DEFAULT 0,
    "business_plan_ready" BOOLEAN DEFAULT false,
    "already_registered_schemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_patent" BOOLEAN DEFAULT false,
    "is_innovation_focused" BOOLEAN DEFAULT false,
    "has_rd_facility" BOOLEAN DEFAULT false,
    "registration_number" VARCHAR(50),
    "gst_registered" BOOLEAN DEFAULT true,
    "annual_income_lakhs" DECIMAL(15,2),
    "active_business_id" BIGINT,
    "msm_code" VARCHAR(20),

    CONSTRAINT "msme_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_case_history" (
    "id" BIGSERIAL NOT NULL,
    "case_id" BIGINT NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "performed_by" BIGINT NOT NULL,
    "performed_by_type" VARCHAR(20) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheme_case_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheme_cases" (
    "id" BIGSERIAL NOT NULL,
    "case_number" VARCHAR(50) NOT NULL,
    "msme_user_id" BIGINT NOT NULL,
    "scheme_id" VARCHAR(100) NOT NULL,
    "scheme_name" VARCHAR(255),
    "status" VARCHAR(30) DEFAULT 'NEW',
    "priority" VARCHAR(20) DEFAULT 'MEDIUM',
    "assigned_agent_id" BIGINT,
    "assigned_by" BIGINT,
    "assigned_at" TIMESTAMP(6),
    "application_data" JSONB,
    "msme_notes" TEXT,
    "agent_notes" TEXT,
    "admin_notes" TEXT,
    "last_contact_at" TIMESTAMP(6),
    "contact_count" INTEGER DEFAULT 0,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "closed_at" TIMESTAMP(6),
    "closure_reason" VARCHAR(50),
    "closure_notes" TEXT,
    "closed_by" BIGINT,

    CONSTRAINT "scheme_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usd_inr_rates" (
    "rate_date" DATE NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "source" VARCHAR(40) NOT NULL DEFAULT 'open.er-api.com',
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usd_inr_rates_pkey" PRIMARY KEY ("rate_date")
);

-- CreateTable
CREATE TABLE "user_eligibility_snapshots" (
    "user_id" VARCHAR(64) NOT NULL,
    "session_id" VARCHAR(64),
    "status" VARCHAR(32),
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_id" VARCHAR(64) NOT NULL DEFAULT '0',

    CONSTRAINT "user_eligibility_snapshots_pkey" PRIMARY KEY ("user_id","business_id")
);

-- CreateTable
CREATE TABLE "user_eligible_schemes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "scheme_name" TEXT,
    "scheme_level" TEXT,
    "nodal_ministry_name" TEXT,
    "brief_description" TEXT,
    "tags" JSONB,
    "scheme_data" JSONB,
    "match_percentage" INTEGER DEFAULT 100,
    "is_active" BOOLEAN DEFAULT true,
    "is_bookmarked" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_eligible_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "session_token" TEXT NOT NULL,
    "device_info" TEXT,
    "browser_info" TEXT,
    "ip_address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_email_key" ON "tenants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_business_pan_key" ON "customers"("tenant_id", "business_pan");

-- CreateIndex
CREATE UNIQUE INDEX "customer_pan_profiles_pan_key" ON "customer_pan_profiles"("pan");

-- CreateIndex
CREATE INDEX "cases_tenant_id_stage_idx" ON "cases"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "cases_tenant_id_lender_name_idx" ON "cases"("tenant_id", "lender_name");

-- CreateIndex
CREATE INDEX "cases_tenant_id_lead_date_idx" ON "cases"("tenant_id", "lead_date");

-- CreateIndex
CREATE INDEX "activity_logs_case_id_idx" ON "activity_logs"("case_id");

-- CreateIndex
CREATE INDEX "activity_logs_customer_id_idx" ON "activity_logs"("customer_id");

-- CreateIndex
CREATE INDEX "case_stage_history_case_id_idx" ON "case_stage_history"("case_id");

-- CreateIndex
CREATE INDEX "case_stage_history_tenant_id_idx" ON "case_stage_history"("tenant_id");

-- CreateIndex
CREATE INDEX "otp_verifications_tenant_id_target_type_target_id_idx" ON "otp_verifications"("tenant_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "otp_verifications_mobile_idx" ON "otp_verifications"("mobile");

-- CreateIndex
CREATE INDEX "login_otps_mobile_idx" ON "login_otps"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "case_payments_case_id_key" ON "case_payments"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_payments_razorpay_order_id_key" ON "case_payments"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_payments_idempotency_key_key" ON "case_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "case_payments_user_id_idx" ON "case_payments"("user_id");

-- CreateIndex
CREATE INDEX "case_payments_case_id_idx" ON "case_payments"("case_id");

-- CreateIndex
CREATE INDEX "case_payments_razorpay_order_id_idx" ON "case_payments"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_pricing_api_code_key" ON "api_pricing"("api_code");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_api_pricing_overrides_tenant_id_api_code_key" ON "tenant_api_pricing_overrides"("tenant_id", "api_code");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_wallets_tenant_id_key" ON "tenant_wallets"("tenant_id");


-- CreateIndex
CREATE INDEX "api_usage_logs_tenant_id_api_code_idx" ON "api_usage_logs"("tenant_id", "api_code");

-- CreateIndex
CREATE INDEX "api_usage_logs_customer_id_idx" ON "api_usage_logs"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_usage_logs_tenant_id_api_code_idempotency_key_key" ON "api_usage_logs"("tenant_id", "api_code", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "itr_analytics_requests_reference_id_key" ON "itr_analytics_requests"("reference_id");

-- CreateIndex
CREATE INDEX "itr_analytics_requests_tenant_id_idx" ON "itr_analytics_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "itr_analytics_requests_reference_id_idx" ON "itr_analytics_requests"("reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_analysis_requests_report_id_key" ON "bank_statement_analysis_requests"("report_id");

-- CreateIndex
CREATE INDEX "bank_statement_analysis_requests_tenant_id_idx" ON "bank_statement_analysis_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "bank_statement_analysis_requests_report_id_idx" ON "bank_statement_analysis_requests"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_data_pull_statuses_case_id_key" ON "case_data_pull_statuses"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "bureau_verifications_request_id_key" ON "bureau_verifications"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "lenders_code_key" ON "lenders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lender_products_lender_id_product_type_key" ON "lender_products"("lender_id", "product_type");

-- CreateIndex
CREATE UNIQUE INDEX "parameter_master_parameter_key_key" ON "parameter_master"("parameter_key");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_parameter_values_scheme_id_parameter_id_key" ON "scheme_parameter_values"("scheme_id", "parameter_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- CreateIndex
CREATE INDEX "documents_customer_id_idx" ON "documents"("customer_id");

-- CreateIndex
CREATE INDEX "documents_case_id_idx" ON "documents"("case_id");

-- CreateIndex
CREATE INDEX "documents_tenant_id_document_type_idx" ON "documents"("tenant_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "case_property_details_case_id_key" ON "case_property_details"("case_id");

-- CreateIndex
CREATE INDEX "case_property_details_case_id_idx" ON "case_property_details"("case_id");

-- CreateIndex
CREATE INDEX "case_income_entries_case_id_idx" ON "case_income_entries"("case_id");

-- CreateIndex
CREATE INDEX "case_income_entries_applicant_id_idx" ON "case_income_entries"("applicant_id");

-- CreateIndex
CREATE INDEX "case_credit_obligations_case_id_idx" ON "case_credit_obligations"("case_id");

-- CreateIndex
CREATE INDEX "case_credit_obligations_applicant_id_idx" ON "case_credit_obligations"("applicant_id");

-- CreateIndex
CREATE INDEX "case_credit_obligations_case_id_applicant_id_idx" ON "case_credit_obligations"("case_id", "applicant_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_esr_financials_case_id_key" ON "case_esr_financials"("case_id");

-- CreateIndex
CREATE INDEX "eligibility_reports_case_id_tenant_id_is_latest_idx" ON "eligibility_reports"("case_id", "tenant_id", "is_latest");

-- CreateIndex
CREATE UNIQUE INDEX "eligibility_reports_case_id_tenant_id_version_number_key" ON "eligibility_reports"("case_id", "tenant_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_vendor_id_key" ON "vendors"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "lender_commission_rules_tenant_id_tenant_lender_id_product__key" ON "lender_commission_rules"("tenant_id", "tenant_lender_id", "product_type");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slip_ocr_results_document_id_key" ON "salary_slip_ocr_results"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slip_ocr_results_case_id_applicant_id_month_year_key" ON "salary_slip_ocr_results"("case_id", "applicant_id", "month", "year");

-- CreateIndex
CREATE INDEX "commission_ledgers_tenant_id_status_idx" ON "commission_ledgers"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "commission_ledgers_case_id_idx" ON "commission_ledgers"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "sub_dsa_payout_rules_sub_dsa_user_id_key" ON "sub_dsa_payout_rules"("sub_dsa_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sub_dsa_payout_ledgers_commission_ledger_id_key" ON "sub_dsa_payout_ledgers"("commission_ledger_id");

-- CreateIndex
CREATE INDEX "sub_dsa_payout_ledgers_tenant_id_sub_dsa_user_id_status_idx" ON "sub_dsa_payout_ledgers"("tenant_id", "sub_dsa_user_id", "status");

-- CreateIndex
CREATE INDEX "sub_dsa_payout_ledgers_invoice_id_idx" ON "sub_dsa_payout_ledgers"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "sub_dsa_invoices_invoice_number_key" ON "sub_dsa_invoices"("invoice_number");



-- CreateIndex
CREATE UNIQUE INDEX "sales_incentive_ledgers_idempotency_key_key" ON "sales_incentive_ledgers"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_audit_action" ON "admin_audit_log"("action");

-- CreateIndex
CREATE INDEX "idx_audit_admin" ON "admin_audit_log"("admin_id");

-- CreateIndex
CREATE INDEX "idx_audit_created" ON "admin_audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admins_admin_code_key" ON "admins"("admin_code");

-- CreateIndex
CREATE UNIQUE INDEX "agents_employee_id_key" ON "agents"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_key" ON "agents"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agents_phone_key" ON "agents"("phone");

-- CreateIndex
CREATE INDEX "idx_agents_approval_status" ON "agents"("approval_status");

-- CreateIndex
CREATE INDEX "idx_agents_employee_id" ON "agents"("employee_id");

-- CreateIndex
CREATE INDEX "idx_agents_status" ON "agents"("status");

-- CreateIndex
CREATE INDEX "idx_agent_activity_agent_id" ON "agent_activity_log"("agent_id");

-- CreateIndex
CREATE INDEX "idx_avail_log_agent_time" ON "agent_availability_log"("agent_id", "changed_at");

-- CreateIndex
CREATE INDEX "idx_ai_usage_created" ON "ai_usage_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_ai_usage_model" ON "ai_usage_log"("model");

-- CreateIndex
CREATE INDEX "idx_ai_usage_session" ON "ai_usage_log"("session_id");

-- CreateIndex
CREATE INDEX "idx_ai_usage_user" ON "ai_usage_log"("msme_user_id");

-- CreateIndex
CREATE INDEX "idx_msme_businesses_user_id" ON "msme_businesses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "msme_payments_razorpay_order_id_key" ON "msme_payments"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "msme_pricing_service_type_key" ON "msme_pricing"("service_type");

-- CreateIndex
CREATE UNIQUE INDEX "msme_users_mobile_number_key" ON "msme_users"("mobile_number");

-- CreateIndex
CREATE UNIQUE INDEX "msme_users_msm_code_key" ON "msme_users"("msm_code");

-- CreateIndex
CREATE INDEX "idx_scheme_case_history_case_id" ON "scheme_case_history"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "scheme_cases_case_number_key" ON "scheme_cases"("case_number");

-- CreateIndex
CREATE INDEX "idx_scheme_cases_assigned_agent_id" ON "scheme_cases"("assigned_agent_id");

-- CreateIndex
CREATE INDEX "idx_scheme_cases_created_at" ON "scheme_cases"("created_at");

-- CreateIndex
CREATE INDEX "idx_scheme_cases_msme_user_id" ON "scheme_cases"("msme_user_id");

-- CreateIndex
CREATE INDEX "idx_scheme_cases_status" ON "scheme_cases"("status");

-- CreateIndex
CREATE INDEX "idx_user_eligible_schemes_user_id" ON "user_eligible_schemes"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_eligible_schemes_user_id_slug" ON "user_eligible_schemes"("user_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "user_eligible_schemes_user_id_slug_key" ON "user_eligible_schemes"("user_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_session_token_key" ON "user_sessions"("session_token");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "login_attempts_email_idx" ON "login_attempts"("email");

-- CreateIndex
CREATE INDEX "login_attempts_ip_address_idx" ON "login_attempts"("ip_address");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pan_profiles" ADD CONSTRAINT "customer_pan_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_pan_gstin_records" ADD CONSTRAINT "customer_pan_gstin_records_pan_profile_id_fkey" FOREIGN KEY ("pan_profile_id") REFERENCES "customer_pan_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_msme_customer_user_id_fkey" FOREIGN KEY ("msme_customer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_dsa_user_id_fkey" FOREIGN KEY ("assigned_dsa_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_allocated_by_admin_id_fkey" FOREIGN KEY ("allocated_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_parent_case_id_fkey" FOREIGN KEY ("parent_case_id") REFERENCES "cases"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_history" ADD CONSTRAINT "case_stage_history_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_stage_history" ADD CONSTRAINT "case_stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_verifications" ADD CONSTRAINT "otp_verifications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_payments" ADD CONSTRAINT "case_payments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_api_pricing_overrides" ADD CONSTRAINT "tenant_api_pricing_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_wallets" ADD CONSTRAINT "tenant_wallets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_consents" ADD CONSTRAINT "customer_consents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_gst_profiles" ADD CONSTRAINT "customer_gst_profiles_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itr_analytics_requests" ADD CONSTRAINT "itr_analytics_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itr_analytics_requests" ADD CONSTRAINT "itr_analytics_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itr_analytics_requests" ADD CONSTRAINT "itr_analytics_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itr_analytics_requests" ADD CONSTRAINT "itr_analytics_requests_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_analysis_requests" ADD CONSTRAINT "bank_statement_analysis_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_analysis_requests" ADD CONSTRAINT "bank_statement_analysis_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_analysis_requests" ADD CONSTRAINT "bank_statement_analysis_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_analysis_requests" ADD CONSTRAINT "bank_statement_analysis_requests_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_data_pull_statuses" ADD CONSTRAINT "case_data_pull_statuses_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bureau_verifications" ADD CONSTRAINT "bureau_verifications_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bureau_verifications" ADD CONSTRAINT "bureau_verifications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_products" ADD CONSTRAINT "lender_products_lender_id_fkey" FOREIGN KEY ("lender_id") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes" ADD CONSTRAINT "schemes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "lender_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_parameter_values" ADD CONSTRAINT "scheme_parameter_values_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheme_parameter_values" ADD CONSTRAINT "scheme_parameter_values_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "parameter_master"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_property_details" ADD CONSTRAINT "case_property_details_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_income_entries" ADD CONSTRAINT "case_income_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_income_entries" ADD CONSTRAINT "case_income_entries_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_credit_obligations" ADD CONSTRAINT "case_credit_obligations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_credit_obligations" ADD CONSTRAINT "case_credit_obligations_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_esr_financials" ADD CONSTRAINT "case_esr_financials_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_reports" ADD CONSTRAINT "eligibility_reports_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_reports" ADD CONSTRAINT "eligibility_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eligibility_report_lenders" ADD CONSTRAINT "eligibility_report_lenders_esr_id_fkey" FOREIGN KEY ("esr_id") REFERENCES "eligibility_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_slabs" ADD CONSTRAINT "vendor_slabs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_commission_rules" ADD CONSTRAINT "lender_commission_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_commission_rules" ADD CONSTRAINT "lender_commission_rules_tenant_lender_id_fkey" FOREIGN KEY ("tenant_lender_id") REFERENCES "tenant_lenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_volume_slabs" ADD CONSTRAINT "commission_volume_slabs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "lender_commission_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_case_count_slabs" ADD CONSTRAINT "commission_case_count_slabs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "lender_commission_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_special_schemes" ADD CONSTRAINT "commission_special_schemes_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "lender_commission_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_lenders" ADD CONSTRAINT "tenant_lenders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- AddForeignKey
ALTER TABLE "tenant_lender_contacts" ADD CONSTRAINT "tenant_lender_contacts_tenant_lender_id_fkey" FOREIGN KEY ("tenant_lender_id") REFERENCES "tenant_lenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slip_ocr_results" ADD CONSTRAINT "salary_slip_ocr_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slip_ocr_results" ADD CONSTRAINT "salary_slip_ocr_results_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slip_ocr_results" ADD CONSTRAINT "salary_slip_ocr_results_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slip_ocr_results" ADD CONSTRAINT "salary_slip_ocr_results_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slip_ocr_results" ADD CONSTRAINT "salary_slip_ocr_results_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledgers" ADD CONSTRAINT "commission_ledgers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledgers" ADD CONSTRAINT "commission_ledgers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- AddForeignKey
ALTER TABLE "commission_ledgers" ADD CONSTRAINT "commission_ledgers_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "commission_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_rules" ADD CONSTRAINT "sub_dsa_payout_rules_sub_dsa_user_id_fkey" FOREIGN KEY ("sub_dsa_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_rules" ADD CONSTRAINT "sub_dsa_payout_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_lender_overrides" ADD CONSTRAINT "sub_dsa_lender_overrides_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sub_dsa_payout_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_case_count_slabs" ADD CONSTRAINT "sub_dsa_case_count_slabs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sub_dsa_payout_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_special_schemes" ADD CONSTRAINT "sub_dsa_special_schemes_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sub_dsa_payout_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_ledgers" ADD CONSTRAINT "sub_dsa_payout_ledgers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_ledgers" ADD CONSTRAINT "sub_dsa_payout_ledgers_sub_dsa_user_id_fkey" FOREIGN KEY ("sub_dsa_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_ledgers" ADD CONSTRAINT "sub_dsa_payout_ledgers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_ledgers" ADD CONSTRAINT "sub_dsa_payout_ledgers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sub_dsa_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_invoices" ADD CONSTRAINT "sub_dsa_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_invoices" ADD CONSTRAINT "sub_dsa_invoices_sub_dsa_user_id_fkey" FOREIGN KEY ("sub_dsa_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_history" ADD CONSTRAINT "sub_dsa_payout_history_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "sub_dsa_payout_ledgers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_dsa_payout_history" ADD CONSTRAINT "sub_dsa_payout_history_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- AddForeignKey
ALTER TABLE "sales_incentive_rules" ADD CONSTRAINT "sales_incentive_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_incentive_rules" ADD CONSTRAINT "sales_incentive_rules_tenant_lender_id_fkey" FOREIGN KEY ("tenant_lender_id") REFERENCES "tenant_lenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_incentive_ledgers" ADD CONSTRAINT "sales_incentive_ledgers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_incentive_ledgers" ADD CONSTRAINT "sales_incentive_ledgers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_incentive_ledgers" ADD CONSTRAINT "sales_incentive_ledgers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_incentive_ledgers" ADD CONSTRAINT "sales_incentive_ledgers_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sales_incentive_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- AddForeignKey
ALTER TABLE "agent_activity_log" ADD CONSTRAINT "agent_activity_log_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "agent_activity_log" ADD CONSTRAINT "agent_activity_log_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "scheme_cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "agent_availability_log" ADD CONSTRAINT "agent_availability_log_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_document_requests" ADD CONSTRAINT "case_document_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "scheme_cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_document_requests" ADD CONSTRAINT "case_document_requests_uploaded_document_id_fkey" FOREIGN KEY ("uploaded_document_id") REFERENCES "case_documents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "scheme_cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "msme_businesses" ADD CONSTRAINT "msme_businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "msme_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "msme_payments" ADD CONSTRAINT "msme_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "msme_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheme_case_history" ADD CONSTRAINT "scheme_case_history_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "scheme_cases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheme_cases" ADD CONSTRAINT "scheme_cases_msme_user_id_fkey" FOREIGN KEY ("msme_user_id") REFERENCES "msme_users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheme_cases" ADD CONSTRAINT "scheme_cases_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scheme_cases" ADD CONSTRAINT "scheme_cases_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "reference_type" "TransactionReferenceType" NOT NULL,
    "reference_id" INTEGER,
    "api_code" TEXT,
    "remarks" TEXT,
    "balance_after" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_transactions_tenant_id_idx" ON "wallet_transactions"("tenant_id");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
