-- Integrity fixes for Sales Incentive and Sub-DSA payout source records.

ALTER TABLE "sub_dsa_lender_overrides"
  ADD COLUMN IF NOT EXISTS "effective_to" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sub_dsa_lender_overrides_tenant_lender_id_fkey'
  ) THEN
    ALTER TABLE "sub_dsa_lender_overrides"
      ADD CONSTRAINT "sub_dsa_lender_overrides_tenant_lender_id_fkey"
      FOREIGN KEY ("tenant_lender_id") REFERENCES "tenant_lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sub_dsa_payout_ledgers_commission_ledger_id_fkey'
  ) THEN
    ALTER TABLE "sub_dsa_payout_ledgers"
      ADD CONSTRAINT "sub_dsa_payout_ledgers_commission_ledger_id_fkey"
      FOREIGN KEY ("commission_ledger_id") REFERENCES "commission_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_incentive_ledgers_commission_ledger_id_fkey'
  ) THEN
    ALTER TABLE "sales_incentive_ledgers"
      ADD CONSTRAINT "sales_incentive_ledgers_commission_ledger_id_fkey"
      FOREIGN KEY ("commission_ledger_id") REFERENCES "commission_ledgers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "commission_ledgers_tenant_id_case_id_disbursement_id_idx"
  ON "commission_ledgers"("tenant_id", "case_id", "disbursement_id");

CREATE INDEX IF NOT EXISTS "sub_dsa_lender_overrides_tenant_lender_id_idx"
  ON "sub_dsa_lender_overrides"("tenant_lender_id");

CREATE INDEX IF NOT EXISTS "sub_dsa_payout_ledgers_tenant_id_case_id_idx"
  ON "sub_dsa_payout_ledgers"("tenant_id", "case_id");

CREATE INDEX IF NOT EXISTS "sales_incentive_ledgers_tenant_id_user_id_status_idx"
  ON "sales_incentive_ledgers"("tenant_id", "user_id", "status");

CREATE INDEX IF NOT EXISTS "sales_incentive_ledgers_tenant_id_case_id_idx"
  ON "sales_incentive_ledgers"("tenant_id", "case_id");

CREATE INDEX IF NOT EXISTS "sales_incentive_ledgers_commission_ledger_id_idx"
  ON "sales_incentive_ledgers"("commission_ledger_id");

CREATE INDEX IF NOT EXISTS "sales_incentive_ledgers_disbursement_id_idx"
  ON "sales_incentive_ledgers"("disbursement_id");
