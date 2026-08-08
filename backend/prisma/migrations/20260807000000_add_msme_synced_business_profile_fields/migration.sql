-- Expands the cross-app profile cache shared with scheme.cred2tech.com (see
-- 20260731000000_add_msme_synced_profile_fields) beyond identity (dob/PAN) to
-- also cover business name, email and pincode. Additive/nullable only — see
-- the User model comment in schema.prisma.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_business_name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_pincode" TEXT;
