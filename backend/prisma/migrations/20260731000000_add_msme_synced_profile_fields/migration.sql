-- Cross-app profile cache for the MSME direct-customer identity shared with
-- scheme.cred2tech.com. Additive/nullable only — see the User model comment
-- in schema.prisma for why these exist and how they're used.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_dob" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "synced_pan_number" TEXT;
