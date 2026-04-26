const p = require('./config/db');
async function main() {
    const tables = ['bureau_verifications', 'case_esr_financials', 'proposals', 'bureau_verification'];
    for (const t of tables) {
        try {
            const cols = await p.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='${t}' ORDER BY ordinal_position`);
            if (cols.length) console.log(`${t}: ${cols.map(c => c.column_name).join(', ')}`);
            else console.log(`${t}: (no columns found - table may not exist)`);
        } catch (e) {
            console.log(`${t}: ERROR - ${e.message}`);
        }
    }
    // Also get bureau-related tables
    const bureauTables = await p.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%bureau%' AND table_schema='public'`);
    console.log('Bureau-related tables:', bureauTables.map(t => t.table_name).join(', '));
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
