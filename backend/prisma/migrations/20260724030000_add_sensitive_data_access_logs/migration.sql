-- Append-only audit trail for reads of sensitive customer data (VAPT H-7).
-- No FK relations by design: must outlive the referenced rows.
CREATE TABLE IF NOT EXISTS "sensitive_data_access_logs" (
  "id" SERIAL PRIMARY KEY,
  "tenant_id" INTEGER NOT NULL,
  "user_id" INTEGER,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "action" TEXT NOT NULL,
  "ip_address" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sensitive_data_access_logs_tenant_id_created_at_idx" ON "sensitive_data_access_logs" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "sensitive_data_access_logs_resource_type_resource_id_idx" ON "sensitive_data_access_logs" ("resource_type", "resource_id");
