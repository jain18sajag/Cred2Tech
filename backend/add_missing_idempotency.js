const fs = require('fs');

const file = './prisma/migrations/20260502000000_real_baseline/migration.sql';
let sql = fs.readFileSync(file, 'utf8');

// Add to case_payments
sql = sql.replace(
  /"payment_status" TEXT NOT NULL DEFAULT 'INITIATED',\r?\n/g,
  `"payment_status" TEXT NOT NULL DEFAULT 'INITIATED',\n    "idempotency_key" TEXT NOT NULL,\n`
);

// Add to api_usage_logs
sql = sql.replace(
  /"api_code" TEXT NOT NULL,\r?\n/g,
  `"api_code" TEXT NOT NULL,\n    "idempotency_key" TEXT NOT NULL,\n`
);

fs.writeFileSync(file, sql);
console.log('Added missing idempotency_key columns to case_payments and api_usage_logs.');
