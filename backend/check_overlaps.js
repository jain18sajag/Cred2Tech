const fs = require('fs');
const path = require('path');

const migrationsDir = './prisma/migrations';
const baselineFile = path.join(migrationsDir, '20260502000000_real_baseline', 'migration.sql');
const baselineSql = fs.readFileSync(baselineFile, 'utf8');

const getMatches = (regex, str) => {
  const matches = new Set();
  let match;
  while ((match = regex.exec(str)) !== null) {
    matches.add(match[1]);
  }
  return matches;
};

const baselineEnums = getMatches(/CREATE TYPE "(\w+)"/g, baselineSql);
const baselineTables = getMatches(/CREATE TABLE "(\w+)"/g, baselineSql);

const casesTableMatch = /CREATE TABLE "cases" \(\s*([\s\S]*?)(?:\n\s*CONSTRAINT[\s\S]*?\n\))/g.exec(baselineSql);
const baselineCasesCols = casesTableMatch ? getMatches(/"(\w+)"\s+(?:SERIAL|INTEGER|TEXT|BOOLEAN|DECIMAL|TIMESTAMP|JSONB|VARCHAR)/gm, casesTableMatch[0]) : new Set();

const migrations = fs.readdirSync(migrationsDir).filter(f => f.startsWith('2026') && f !== '20260502000000_real_baseline' && fs.statSync(path.join(migrationsDir, f)).isDirectory());

for (const mig of migrations) {
  const sql = fs.readFileSync(path.join(migrationsDir, mig, 'migration.sql'), 'utf8');
  
  const migEnums = getMatches(/CREATE TYPE "(\w+)"/g, sql);
  for (const e of migEnums) {
    if (baselineEnums.has(e)) console.log(`Enum overlap in ${mig}: ${e}`);
  }
  
  const migTables = getMatches(/CREATE TABLE "(\w+)"/g, sql);
  for (const t of migTables) {
    if (baselineTables.has(t)) console.log(`Table overlap in ${mig}: ${t}`);
  }
  
  // Find ALTER TABLE "cases" ADD COLUMN
  const alterRegex = /ALTER TABLE "cases" ADD COLUMN\s+"(\w+)"/g;
  let am;
  while ((am = alterRegex.exec(sql)) !== null) {
    if (baselineCasesCols.has(am[1])) {
      console.log(`Cases column overlap in ${mig}: ${am[1]}`);
    }
  }
  
  // Check for ADD COLUMN generally
  const generalAlterRegex = /ALTER TABLE "(\w+)" ADD COLUMN(?: IF NOT EXISTS)?\s+"(\w+)"/g;
  while ((am = generalAlterRegex.exec(sql)) !== null) {
    const table = am[1];
    const col = am[2];
    // check if this table in baseline has this col
    const tableMatch = new RegExp(`CREATE TABLE "${table}" \\(\\s*([\\s\\S]*?)(?:\\n\\s*CONSTRAINT[\\s\\S]*?\\n\\))`, 'g').exec(baselineSql);
    if (tableMatch) {
      const cols = getMatches(/"(\w+)"\s+(?:SERIAL|INTEGER|TEXT|BOOLEAN|DECIMAL|TIMESTAMP|JSONB|VARCHAR)/gm, tableMatch[0]);
      if (cols.has(col)) {
        console.log(`Column overlap in ${mig}: ${table}.${col}`);
      }
    }
  }
}
