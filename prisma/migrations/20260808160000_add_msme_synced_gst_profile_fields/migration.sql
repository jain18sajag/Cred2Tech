-- Expands the cross-app profile cache shared with scheme.cred2tech.com (see
-- 20260807000000_add_msme_synced_business_profile_fields) to also carry the
-- real GST-verified PAN intelligence, not just identity/prefill hints. This
-- is what lets /external/pan/verify and /external/pan/fetch skip re-billing
-- Signzy for a PAN the sibling app already verified. Additive/nullable only
-- (synced_pan_verified defaults false) — see the User model comment in
-- schema.prisma.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_pan_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_gstin" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_constitution_of_business" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_legal_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_trade_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_principal_state" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_principal_city" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_principal_address" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_director_names" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_annual_turnover_range" TEXT;
