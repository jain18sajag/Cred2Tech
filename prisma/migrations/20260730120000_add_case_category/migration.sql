-- Per-case classification (MSME vs SALARIED), separate from Customer.category.
-- The same PAN/customer can now have one salaried case and one MSME case at
-- the same time without either reclassifying the other.
ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "category" "CustomerCategory" NOT NULL DEFAULT 'MSME';

-- Backfill: until now category only ever existed on Customer (one value per
-- customer, shared by all their cases), so every case that exists as of this
-- migration was classified via its customer — carry that forward verbatim.
-- Only cases created after this migration can diverge from their customer.
UPDATE "cases"
SET "category" = "customers"."category"
FROM "customers"
WHERE "cases"."customer_id" = "customers"."id";
