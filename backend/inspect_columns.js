const p = require('./config/db');

async function main() {
    const tables = ['gstr_analytics_requests', 'itr_analytics_requests', 'bank_statement_analysis_requests', 'bureau_verifications', 'case_esr_financials'];
    for (const t of tables) {
        const cols = await p.$queryRawUnsafe(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`);
        console.log(`\n=== ${t} ===`);
        cols.forEach(c => console.log(`  ${c.column_name} (${c.data_type})`));
    }
    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
