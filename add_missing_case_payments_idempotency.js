const fs = require('fs');

const file = './prisma/migrations/20260502000000_real_baseline/migration.sql';
let sql = fs.readFileSync(file, 'utf8');

// Add to case_payments
sql = sql.replace(
  /"status" TEXT NOT NULL DEFAULT 'INITIATED',\r?\n/g,
  `"status" TEXT NOT NULL DEFAULT 'INITIATED',\n    "idempotency_key" TEXT NOT NULL,\n`
);

fs.writeFileSync(file, sql);
console.log('Added missing idempotency_key column to case_payments.');
