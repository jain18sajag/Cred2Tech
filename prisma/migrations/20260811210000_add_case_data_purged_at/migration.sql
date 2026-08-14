-- Marks a case as permanently purged (all bureau/GST/ITR/bank records
-- purged) — set once by purgeRecord() in dataRetentionPurge.service.js when
-- the last remaining record for a case is purged, whether via the nightly
-- retention job or a manual admin request. Gates further stage transitions
-- in case.service.js's updateStage() and triggers a one-time MSME
-- notification email — never unset once set.
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "data_purged_at" TIMESTAMP(3);
