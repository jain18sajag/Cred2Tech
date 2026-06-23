const fs = require('fs');
const content = fs.readFileSync('./prisma/migrations/full_schema.sql');
// If it's UTF-16 LE, it will have a BOM or null bytes. Let's just convert it.
const text = content.toString('utf16le');
if (text.includes('CREATE TABLE')) {
  fs.writeFileSync('./prisma/migrations/20260502000000_real_baseline/migration.sql', text, 'utf8');
} else {
  // Maybe it's already utf8
  const text8 = content.toString('utf8');
  fs.writeFileSync('./prisma/migrations/20260502000000_real_baseline/migration.sql', text8, 'utf8');
}
console.log('File written.');
