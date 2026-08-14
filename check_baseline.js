// Systematically check the baseline migration for missing columns
// by comparing FK constraints and indexes against table definitions.
const fs = require('fs');

const file = './prisma/migrations/20260502000000_real_baseline/migration.sql';
const sql = fs.readFileSync(file, 'utf8');

// Find all CREATE TABLE definitions
const tableRegex = /CREATE TABLE "(\w+)" \(\s*([\s\S]*?)(?:\n\s*CONSTRAINT[\s\S]*?\n\))/g;
const tables = {};
let match;
while ((match = tableRegex.exec(sql)) !== null) {
  const tableName = match[1];
  const body = match[0];
  // Extract column names  
  const colRegex = /"(\w+)"\s+(?:SERIAL|BIGSERIAL|INTEGER|TEXT|BOOLEAN|DECIMAL|DOUBLE|TIMESTAMP|JSONB|VARCHAR|BIGINT|TIMESTAMPTZ|REAL|SMALLINT|UUID|")/gm;
  const cols = new Set();
  let cm;
  while ((cm = colRegex.exec(body)) !== null) {
    cols.add(cm[1]);
  }
  tables[tableName] = cols;
}

// Find all FOREIGN KEY references
const fkRegex = /ALTER TABLE "(\w+)" ADD CONSTRAINT.*?FOREIGN KEY \("(\w+)"\)/g;
const fkIssues = [];
while ((match = fkRegex.exec(sql)) !== null) {
  const table = match[1];
  const col = match[2];
  if (tables[table] && !tables[table].has(col)) {
    fkIssues.push({ table, column: col, issue: 'FK references missing column' });
  }
}

// Find all INDEX references
const idxRegex = /CREATE (?:UNIQUE )?INDEX\s+"[^"]+"\s+ON\s+"(\w+)"\(([^)]+)\)/g;
const idxIssues = [];
while ((match = idxRegex.exec(sql)) !== null) {
  const table = match[1];
  const cols = match[2].split(',').map(c => c.trim().replace(/"/g, ''));
  for (const col of cols) {
    if (tables[table] && !tables[table].has(col)) {
      idxIssues.push({ table, column: col, issue: 'INDEX references missing column' });
    }
  }
}

console.log('=== FK Issues ===');
fkIssues.forEach(i => console.log(`  ${i.table}.${i.column}: ${i.issue}`));
console.log(`\n=== INDEX Issues ===`);
idxIssues.forEach(i => console.log(`  ${i.table}.${i.column}: ${i.issue}`));
console.log(`\nTotal FK issues: ${fkIssues.length}, INDEX issues: ${idxIssues.length}`);
