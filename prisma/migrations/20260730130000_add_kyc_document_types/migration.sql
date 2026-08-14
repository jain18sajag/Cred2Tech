-- New KYC document sub-types for the Proposal page's document-category picker
-- (Incorporation / ID Proof / Address Proof / Income / Property documents).
-- Each ADD VALUE runs as its own statement — Postgres doesn't allow using a
-- brand-new enum value in the same transaction it was added in.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'DRIVING_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'VOTER_ID';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PASSPORT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CERTIFICATE_OF_INCORPORATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'MOA';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'AOA';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PARTNERSHIP_DEED';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'UTILITY_BILL';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'RENT_AGREEMENT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'TRADE_LICENSE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'ENCUMBRANCE_CERTIFICATE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'KHATA';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'GST_RETURNS';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'FORM_16';
