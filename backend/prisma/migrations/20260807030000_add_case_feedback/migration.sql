-- Case journey feedback — see schema.prisma comment above `CaseFeedback`.
-- Hand-authored (not `prisma migrate dev`'s shadow-db diff) to avoid pulling
-- in unrelated pre-existing drift between migration history and the live DB.

-- CreateEnum
CREATE TYPE "CaseFeedbackDisbursementType" AS ENUM ('PARTIAL', 'FULL');

-- CreateTable
CREATE TABLE "case_feedback" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "type" "CaseFeedbackDisbursementType" NOT NULL,
    "submitted_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_feedback_tenant_id_idx" ON "case_feedback"("tenant_id");

-- CreateIndex
CREATE INDEX "case_feedback_case_id_idx" ON "case_feedback"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_feedback_case_id_type_key" ON "case_feedback"("case_id", "type");

-- AddForeignKey
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_feedback" ADD CONSTRAINT "case_feedback_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
