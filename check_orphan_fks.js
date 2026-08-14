// Find all FK constraints in the baseline that reference tables NOT defined in the baseline.
const fs = require('fs');

const file = './prisma/migrations/20260502000000_real_baseline/migration.sql';
const sql = fs.readFileSync(file, 'utf8');

// Find all tables created in the baseline
const createTableRegex = /CREATE TABLE "(\w+)"/g;
const tables = new Set();
let match;
while ((match = createTableRegex.exec(sql)) !== null) {
  tables.add(match[1]);
}

// Find all FK constraints that REFERENCES a table
const fkRegex = /ALTER TABLE "(\w+)" ADD CONSTRAINT\s+"([^"]+)".*?REFERENCES "(\w+)"/g;
const orphanFKs = [];
while ((match = fkRegex.exec(sql)) !== null) {
  const sourceTable = match[1];
  const constraintName = match[2];
  const targetTable = match[3];
  if (!tables.has(targetTable)) {
    orphanFKs.push({ sourceTable, constraintName, targetTable });
  }
  if (!tables.has(sourceTable)) {
    orphanFKs.push({ sourceTable, constraintName, targetTable, issue: 'SOURCE table missing' });
  }
}

console.log('=== Orphan FK Constraints (target table not in baseline) ===');
orphanFKs.forEach(fk => {
  const issue = fk.issue || 'TARGET table not in baseline';
  console.log(`  ${fk.sourceTable} -> ${fk.targetTable} (${fk.constraintName}): ${issue}`);
});
console.log(`\nTotal: ${orphanFKs.length}`);
console.log(`\nAll tables in baseline: ${[...tables].sort().join(', ')}`);
