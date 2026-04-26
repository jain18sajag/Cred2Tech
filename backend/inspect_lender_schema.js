const p = require('./config/db');
async function main() {
    const gst = await p.$queryRawUnsafe(`SELECT DISTINCT status FROM gstr_analytics_requests LIMIT 10`);
    console.log('GST statuses:', gst.map(r => r.status));
    const itr = await p.$queryRawUnsafe(`SELECT DISTINCT status FROM itr_analytics_requests LIMIT 10`);
    console.log('ITR statuses:', itr.map(r => r.status));
    const bank = await p.$queryRawUnsafe(`SELECT DISTINCT status FROM bank_statement_analysis_requests LIMIT 10`);
    console.log('Bank statuses:', bank.map(r => r.status));
    process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
