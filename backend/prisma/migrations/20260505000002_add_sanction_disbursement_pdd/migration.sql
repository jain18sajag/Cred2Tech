-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('RECORDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PDDTaskStatus" AS ENUM ('PENDING', 'RECEIVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "PDDTaskSource" AS ENUM ('DISBURSEMENT', 'MANUAL');

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "first_disbursement_date" TIMESTAMP(3),
ADD COLUMN     "last_disbursement_date" TIMESTAMP(3),
ADD COLUMN     "remaining_disbursement_amount" DECIMAL(18,2) DEFAULT 0,
ADD COLUMN     "sanctioned_amount" DECIMAL(18,2),
ADD COLUMN     "total_disbursed_amount" DECIMAL(18,2) DEFAULT 0;

-- CreateTable
CREATE TABLE "case_sanctions" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "tenant_lender_id" INTEGER,
    "lender_name" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "loan_account_number" TEXT NOT NULL,
    "sanction_date" TIMESTAMP(3) NOT NULL,
    "sanctioned_amount" DECIMAL(18,2) NOT NULL,
    "confirmed_roi" DECIMAL(18,4) NOT NULL,
    "processing_fee" DECIMAL(18,2) NOT NULL,
    "remarks" TEXT,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursements" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "case_sanction_id" INTEGER NOT NULL,
    "tenant_lender_id" INTEGER,
    "lender_name" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "tranche_number" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "disbursement_date" TIMESTAMP(3) NOT NULL,
    "next_disbursement_due_date" TIMESTAMP(3),
    "status" "DisbursementStatus" NOT NULL DEFAULT 'RECORDED',
    "remarks" TEXT,
    "idempotency_key" TEXT,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdd_tasks" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "disbursement_id" INTEGER,
    "document_name" TEXT NOT NULL,
    "due_date" TIMESTAMP(3),
    "status" "PDDTaskStatus" NOT NULL DEFAULT 'PENDING',
    "source_type" "PDDTaskSource" NOT NULL DEFAULT 'MANUAL',
    "remarks" TEXT,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pdd_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_sanctions_case_id_key" ON "case_sanctions"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "disbursements_tenant_id_case_id_idempotency_key_key" ON "disbursements"("tenant_id", "case_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "case_sanctions" ADD CONSTRAINT "case_sanctions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_sanctions" ADD CONSTRAINT "case_sanctions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_case_sanction_id_fkey" FOREIGN KEY ("case_sanction_id") REFERENCES "case_sanctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdd_tasks" ADD CONSTRAINT "pdd_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdd_tasks" ADD CONSTRAINT "pdd_tasks_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdd_tasks" ADD CONSTRAINT "pdd_tasks_disbursement_id_fkey" FOREIGN KEY ("disbursement_id") REFERENCES "disbursements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
