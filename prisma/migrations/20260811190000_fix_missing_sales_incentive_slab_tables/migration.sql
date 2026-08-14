-- Retroactive fix, found while auditing the migration history for
-- "does a fresh `prisma migrate deploy` from an empty database actually
-- work" (prompted by the data-retention/purge deployment work in
-- 20260811180000). "sales_incentive_case_slabs" and
-- "sales_incentive_volume_slabs" were created out-of-band via `prisma db
-- push` and — unlike gstr_analytics_requests (fixed in
-- 20260619000000_init_gst_summary_refactor) — are never referenced by any
-- later migration either, so a fresh deploy doesn't error on them, it just
-- silently never creates them. Every environment that already has them
-- (from that db push) is unaffected — IF NOT EXISTS makes this a no-op there.
CREATE TABLE IF NOT EXISTS "sales_incentive_volume_slabs" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "from_amount" DOUBLE PRECISION NOT NULL,
    "to_amount" DOUBLE PRECISION,
    "percent_rate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "sales_incentive_volume_slabs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_incentive_case_slabs" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "from_cases" INTEGER NOT NULL,
    "to_cases" INTEGER,
    "payout_per_case" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "sales_incentive_case_slabs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sales_incentive_volume_slabs_rule_id_idx" ON "sales_incentive_volume_slabs"("rule_id");
CREATE INDEX IF NOT EXISTS "sales_incentive_case_slabs_rule_id_idx" ON "sales_incentive_case_slabs"("rule_id");

DO $$ BEGIN
  ALTER TABLE "sales_incentive_volume_slabs" ADD CONSTRAINT "sales_incentive_volume_slabs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sales_incentive_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "sales_incentive_case_slabs" ADD CONSTRAINT "sales_incentive_case_slabs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "sales_incentive_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
