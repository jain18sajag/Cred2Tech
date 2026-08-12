-- CreateTable
CREATE TABLE "case_hard_delete_logs" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "child_case_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "tenant_id" INTEGER,
    "customer_id" INTEGER,
    "customer_name" TEXT,
    "case_stage" TEXT,
    "triggered_by_user_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "row_counts" JSONB NOT NULL,
    "documents_deleted" INTEGER NOT NULL DEFAULT 0,
    "files_deleted" INTEGER NOT NULL DEFAULT 0,
    "files_failed" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_hard_delete_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_hard_delete_logs_case_id_idx" ON "case_hard_delete_logs"("case_id");

-- CreateIndex
CREATE INDEX "case_hard_delete_logs_deleted_at_idx" ON "case_hard_delete_logs"("deleted_at");
