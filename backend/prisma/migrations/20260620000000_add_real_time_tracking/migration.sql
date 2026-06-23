-- CreateEnum
CREATE TYPE "DataPullJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'AWAITING_CUSTOMER_ACTION');

-- CreateEnum
CREATE TYPE "PullNotificationStatus" AS ENUM ('COMPLETED', 'FAILED', 'EXPIRED', 'ACTION_REQUIRED');

-- CreateEnum
CREATE TYPE "NotificationAudienceType" AS ENUM ('USER', 'CASE_OWNER', 'CASE_ASSIGNEE', 'TENANT_PERMISSION', 'TENANT_ROLE');

-- CreateTable
CREATE TABLE "DataPullBackgroundJob" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER,
    "pull_type" "DataPullType" NOT NULL,
    "module_request_id" INTEGER NOT NULL,
    "provider_request_id" TEXT,
    "flow_type" "DataPullFlowType",
    "status" "DataPullJobStatus" NOT NULL DEFAULT 'PENDING',
    "next_run_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "maximum_attempts" INTEGER,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "lock_expires_at" TIMESTAMP(3),
    "lock_token" UUID,
    "processing_deadline_at" TIMESTAMP(3),
    "last_error" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataPullBackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemNotification" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "applicant_id" INTEGER,
    "pull_type" "DataPullType" NOT NULL,
    "status" "PullNotificationStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "audience_type" "NotificationAudienceType" NOT NULL,
    "recipient_user_id" INTEGER,
    "deduplication_key" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "action_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorApiAuditLog" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER,
    "applicant_id" INTEGER,
    "pull_type" TEXT,
    "provider" TEXT,
    "provider_request_id" TEXT,
    "attempt_number" INTEGER NOT NULL,
    "provider_operation" TEXT NOT NULL,
    "trigger_source" TEXT NOT NULL,
    "chargeable" BOOLEAN NOT NULL,
    "tenant_wallet_deducted" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "result_status" TEXT,
    "http_status" INTEGER,
    "error_category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorApiAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataPullBackgroundJob_status_next_run_at_idx" ON "DataPullBackgroundJob"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "DataPullBackgroundJob_status_lock_expires_at_idx" ON "DataPullBackgroundJob"("status", "lock_expires_at");

-- CreateIndex
CREATE INDEX "DataPullBackgroundJob_tenant_id_case_id_idx" ON "DataPullBackgroundJob"("tenant_id", "case_id");

-- CreateIndex
CREATE INDEX "DataPullBackgroundJob_pull_type_status_idx" ON "DataPullBackgroundJob"("pull_type", "status");

-- CreateIndex
CREATE INDEX "DataPullBackgroundJob_provider_request_id_idx" ON "DataPullBackgroundJob"("provider_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "DataPullBackgroundJob_tenant_id_case_id_pull_type_module_re_key" ON "DataPullBackgroundJob"("tenant_id", "case_id", "pull_type", "module_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "SystemNotification_deduplication_key_key" ON "SystemNotification"("deduplication_key");

-- AddForeignKey
ALTER TABLE "DataPullBackgroundJob" ADD CONSTRAINT "DataPullBackgroundJob_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataPullBackgroundJob" ADD CONSTRAINT "DataPullBackgroundJob_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "applicants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataPullBackgroundJob" ADD CONSTRAINT "DataPullBackgroundJob_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemNotification" ADD CONSTRAINT "SystemNotification_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemNotification" ADD CONSTRAINT "SystemNotification_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemNotification" ADD CONSTRAINT "SystemNotification_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

