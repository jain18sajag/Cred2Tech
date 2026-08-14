-- Migration: add_tenant_lender_platform_link
-- Adds platform_lender_id and is_esr_enabled to tenant_lenders table.
-- platform_lender_id: FK to lenders.id (UUID). Null = manual/non-ESR lender.
-- is_esr_enabled: DSA_ADMIN-controlled flag. Only active when platform_lender_id is set.

ALTER TABLE "tenant_lenders"
  ADD COLUMN IF NOT EXISTS "platform_lender_id" TEXT,
  ADD COLUMN IF NOT EXISTS "is_esr_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Add FK constraint from tenant_lenders.platform_lender_id → lenders.id
-- ON DELETE SET NULL: if a platform lender is deleted, tenant lender becomes manual (null)
ALTER TABLE "tenant_lenders"
  ADD CONSTRAINT "tenant_lenders_platform_lender_id_fkey"
  FOREIGN KEY ("platform_lender_id")
  REFERENCES "lenders"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
