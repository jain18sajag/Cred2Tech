-- Atomic-claim marker for the bank-statement webhook dedup fix (D-2): a plain
-- read-then-branch status check is a TOCTOU race under Signzy's liberal
-- webhook retries. Set via a conditional UPDATE that only one concurrent
-- request can win.
ALTER TABLE "bank_statement_analysis_requests" ADD COLUMN IF NOT EXISTS "webhook_claimed_at" TIMESTAMP;
