-- Adds a per-request HMAC token column so Signzy webhook callbacks (which carry
-- no signature scheme of their own) can be authenticated on receipt.
ALTER TABLE "gstr_analytics_requests" ADD COLUMN IF NOT EXISTS "webhook_token" TEXT;
ALTER TABLE "bank_statement_analysis_requests" ADD COLUMN IF NOT EXISTS "webhook_token" TEXT;
