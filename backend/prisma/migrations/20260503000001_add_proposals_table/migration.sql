-- CreateTable
CREATE TABLE "proposals" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "case_id" INTEGER NOT NULL,
    "lender_id" INTEGER,
    "scheme_id" INTEGER,
    "case_esr_financial_id" INTEGER,
    "proposal_source_id" INTEGER,
    "proposal_number" TEXT NOT NULL,
    "proposal_status" TEXT NOT NULL DEFAULT 'draft',
    "lender_submission_status" TEXT DEFAULT 'draft',
    "requested_amount" DOUBLE PRECISION,
    "eligible_amount" DOUBLE PRECISION,
    "roi_min" DOUBLE PRECISION,
    "roi_max" DOUBLE PRECISION,
    "tenure_months" INTEGER,
    "loan_purpose" TEXT,
    "remarks" TEXT,
    "additional_notes" TEXT,
    "preferred_banking_program" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "updated_by_user_id" INTEGER NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_documents" (
    "id" SERIAL NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "document_id" INTEGER NOT NULL,
    "document_type" TEXT,

    CONSTRAINT "proposal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposals_proposal_number_key" ON "proposals"("proposal_number");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_documents_proposal_id_document_id_key" ON "proposal_documents"("proposal_id", "document_id");

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

