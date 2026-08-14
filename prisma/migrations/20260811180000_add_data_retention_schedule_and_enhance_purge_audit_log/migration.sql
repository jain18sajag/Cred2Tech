-- Data retention / purge redesign (CT-004-DPP compliance):
--  1. created_at indexes on the 4 purge-eligible tables — these were added
--     to schema.prisma in a prior edit this cycle but never got a migration.
--  2. purge_audit_logs existed only via manual `db push` drift on some
--     environments (added in commit 41496f9, never migrated anywhere) — this
--     is its first real migration. CREATE TABLE IF NOT EXISTS + ADD COLUMN IF
--     NOT EXISTS makes this safe whether or not a given environment already
--     has the drifted table.
--  3. data_retention_schedules is genuinely new everywhere — plain CREATE.

-- 1. created_at indexes
CREATE INDEX IF NOT EXISTS "bureau_verifications_created_at_idx" ON "bureau_verifications" ("created_at");
CREATE INDEX IF NOT EXISTS "gstr_analytics_requests_created_at_idx" ON "gstr_analytics_requests" ("created_at");
CREATE INDEX IF NOT EXISTS "itr_analytics_requests_created_at_idx" ON "itr_analytics_requests" ("created_at");
CREATE INDEX IF NOT EXISTS "bank_statement_analysis_requests_created_at_idx" ON "bank_statement_analysis_requests" ("created_at");

-- 2. purge_audit_logs — defensive create + reconcile columns
CREATE TABLE IF NOT EXISTS "purge_audit_logs" (
  "id" SERIAL PRIMARY KEY,
  "customer_id" INTEGER,
  "table_name" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  "purged_fields" JSONB NOT NULL,
  "purged_at" TIMESTAMP(3) NOT NULL DEFAULT now()
);

ALTER TABLE "purge_audit_logs" ALTER COLUMN "customer_id" DROP NOT NULL;

DO $$ BEGIN
  CREATE TYPE "PurgeAuditStatus" AS ENUM ('SUCCESS', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PurgeTriggerType" AS ENUM ('SCHEDULED', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "status" "PurgeAuditStatus" NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "trigger_type" "PurgeTriggerType" NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "triggered_by_user_id" INTEGER;
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "files_deleted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purge_audit_logs" ADD COLUMN IF NOT EXISTS "retention_schedule_id" INTEGER;

CREATE INDEX IF NOT EXISTS "purge_audit_logs_customer_id_idx" ON "purge_audit_logs" ("customer_id");
CREATE INDEX IF NOT EXISTS "purge_audit_logs_purged_at_idx" ON "purge_audit_logs" ("purged_at");
CREATE INDEX IF NOT EXISTS "purge_audit_logs_status_idx" ON "purge_audit_logs" ("status");
CREATE INDEX IF NOT EXISTS "purge_audit_logs_retention_schedule_id_idx" ON "purge_audit_logs" ("retention_schedule_id");

-- Drop + recreate the customer FK as NOT VALID-safe ON DELETE SET NULL
-- (original, if present from drift, was likely ON DELETE RESTRICT NOT NULL).
DO $$ BEGIN
  ALTER TABLE "purge_audit_logs" DROP CONSTRAINT IF EXISTS "purge_audit_logs_customer_id_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE "purge_audit_logs" ADD CONSTRAINT "purge_audit_logs_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. data_retention_schedules — new everywhere
DO $$ BEGIN
  CREATE TYPE "PurgeScheduleStatus" AS ENUM ('PENDING', 'QUEUED', 'PURGED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "data_retention_schedules" (
  "id"           SERIAL PRIMARY KEY,
  "source_table" TEXT NOT NULL,
  "record_id"    TEXT NOT NULL,
  "tenant_id"    INTEGER,
  "customer_id"  INTEGER,
  "case_id"      INTEGER,
  "applicant_id" INTEGER,
  "recorded_at"  TIMESTAMP(3) NOT NULL,
  "expiry_date"  TIMESTAMP(3) NOT NULL,
  "status"       "PurgeScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "purged_at"    TIMESTAMP(3),
  "last_error"   TEXT,
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_retention_schedules_source_table_record_id_key" ON "data_retention_schedules" ("source_table", "record_id");
CREATE INDEX IF NOT EXISTS "data_retention_schedules_status_expiry_date_idx" ON "data_retention_schedules" ("status", "expiry_date");
CREATE INDEX IF NOT EXISTS "data_retention_schedules_expiry_date_idx" ON "data_retention_schedules" ("expiry_date");

DO $$ BEGIN
  ALTER TABLE "purge_audit_logs" ADD CONSTRAINT "purge_audit_logs_retention_schedule_id_fkey"
    FOREIGN KEY ("retention_schedule_id") REFERENCES "data_retention_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
