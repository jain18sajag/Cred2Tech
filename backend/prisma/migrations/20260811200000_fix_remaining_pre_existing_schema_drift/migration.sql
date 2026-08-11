-- Retroactive fix, found while auditing "does a fresh `prisma migrate
-- deploy` from an empty database actually produce a schema matching
-- schema.prisma" (prompted by the data-retention/purge deployment work in
-- 20260811180000/20260619000000/20260620000000/20260811190000). This is the
-- remaining gap after those fixes: ~18 tables have columns/indexes/
-- constraints that were only ever added via `prisma db push` and never
-- captured in any committed migration. Unlike the earlier fixes, none of
-- these block `migrate deploy` from completing on a fresh database — they
-- just leave the resulting schema silently incomplete, which breaks plain
-- CRUD at runtime (e.g. Prisma's implicit RETURNING clause on a
-- `case.create()` fails if any schema-declared column physically doesn't
-- exist). Generated via `prisma migrate diff --from-url <fully-migrated
-- fresh db> --to-schema-datamodel prisma/schema.prisma --script` (not hand-
-- transcribed) and converted to defensive/idempotent form so it's a no-op
-- on every environment that already has these from db push.

ALTER TABLE "api_pricing" DROP COLUMN IF EXISTS "idempotency_key";

ALTER TABLE "api_usage_logs" ALTER COLUMN "idempotency_key" DROP NOT NULL;

ALTER TABLE "applicants" ADD COLUMN IF NOT EXISTS "pincode" TEXT;

ALTER TABLE "bank_statement_analysis_requests" ALTER COLUMN "webhook_claimed_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "case_payments" ALTER COLUMN "idempotency_key" DROP NOT NULL;

ALTER TABLE "case_sanctions" ALTER COLUMN "loan_account_number" DROP NOT NULL;

ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "platform_lender_id" INTEGER;

ALTER TABLE "disbursements" ADD COLUMN IF NOT EXISTS "subvention_amount" DECIMAL(18,2);

ALTER TABLE "itr_analytics_requests" ADD COLUMN IF NOT EXISTS "auth_mode" TEXT NOT NULL DEFAULT 'PASSWORD';

ALTER TABLE "lender_commission_rules" DROP COLUMN IF EXISTS "is_active";
ALTER TABLE "lender_commission_rules" ADD COLUMN IF NOT EXISTS "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "lender_commission_rules" ADD COLUMN IF NOT EXISTS "effective_to" TIMESTAMP(3);
ALTER TABLE "lender_commission_rules" ADD COLUMN IF NOT EXISTS "max_cap_amount" DOUBLE PRECISION;
ALTER TABLE "lender_commission_rules" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "pdd_tasks" ADD COLUMN IF NOT EXISTS "collected_by" TEXT;
ALTER TABLE "pdd_tasks" ADD COLUMN IF NOT EXISTS "collection_date" TIMESTAMP(3);
ALTER TABLE "pdd_tasks" ADD COLUMN IF NOT EXISTS "waiver_reason" TEXT;

ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "child_case_id" INTEGER;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "processing_fee" DOUBLE PRECISION;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "submitted_by_user_id" INTEGER;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "submitted_payload_snapshot" JSONB;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "tenant_lender_id" INTEGER;
ALTER TABLE "proposals" ALTER COLUMN "lender_id" SET DATA TYPE TEXT;

ALTER TABLE "sensitive_data_access_logs" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

ALTER TABLE "sub_dsa_lender_overrides" ADD COLUMN IF NOT EXISTS "calculation_base" TEXT NOT NULL DEFAULT 'DISBURSED_AMOUNT';

ALTER TABLE "sub_dsa_payout_rules" ADD COLUMN IF NOT EXISTS "calculation_base" TEXT NOT NULL DEFAULT 'DISBURSED_AMOUNT';
ALTER TABLE "sub_dsa_payout_rules" ADD COLUMN IF NOT EXISTS "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sub_dsa_payout_rules" ADD COLUMN IF NOT EXISTS "effective_to" TIMESTAMP(3);
ALTER TABLE "sub_dsa_payout_rules" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "tenant_api_pricing_overrides" DROP COLUMN IF EXISTS "idempotency_key";

ALTER TABLE "tenant_lenders" ADD COLUMN IF NOT EXISTS "max_cap_amount" DOUBLE PRECISION;

DROP INDEX IF EXISTS "lender_commission_rules_tenant_id_tenant_lender_id_product__key";
DROP INDEX IF EXISTS "sub_dsa_payout_rules_sub_dsa_user_id_key";

CREATE INDEX IF NOT EXISTS "lender_commission_rules_tenant_id_tenant_lender_id_product__idx" ON "lender_commission_rules"("tenant_id", "tenant_lender_id", "product_type");
CREATE INDEX IF NOT EXISTS "proposals_tenant_lender_id_idx" ON "proposals"("tenant_lender_id");
CREATE INDEX IF NOT EXISTS "sub_dsa_payout_rules_sub_dsa_user_id_idx" ON "sub_dsa_payout_rules"("sub_dsa_user_id");
-- Missed in 20260811180000: schema.prisma declares @@index([trigger_type])
-- on PurgeAuditLog but the migration never created it.
CREATE INDEX IF NOT EXISTS "purge_audit_logs_trigger_type_idx" ON "purge_audit_logs"("trigger_type");

DO $$ BEGIN
  ALTER TABLE "proposals" ADD CONSTRAINT "proposals_lender_id_fkey" FOREIGN KEY ("lender_id") REFERENCES "lenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_lender_id_fkey" FOREIGN KEY ("tenant_lender_id") REFERENCES "tenant_lenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "commission_ledgers" ADD CONSTRAINT "commission_ledgers_disbursement_id_fkey" FOREIGN KEY ("disbursement_id") REFERENCES "disbursements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sales_incentive_ledgers" ADD CONSTRAINT "sales_incentive_ledgers_disbursement_id_fkey" FOREIGN KEY ("disbursement_id") REFERENCES "disbursements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
