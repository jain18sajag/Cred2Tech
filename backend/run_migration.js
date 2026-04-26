const p = require('./config/db');

async function migrate() {
    console.log('Running income snapshot column migration...');
    await p.$executeRawUnsafe(`
        ALTER TABLE gstr_analytics_requests
          ADD COLUMN IF NOT EXISTS turnover_latest_year      NUMERIC,
          ADD COLUMN IF NOT EXISTS turnover_previous_year    NUMERIC,
          ADD COLUMN IF NOT EXISTS financial_year_latest     TEXT,
          ADD COLUMN IF NOT EXISTS financial_year_previous   TEXT
    `);
    console.log('✅ gstr_analytics_requests updated');

    await p.$executeRawUnsafe(`
        ALTER TABLE itr_analytics_requests
          ADD COLUMN IF NOT EXISTS net_profit_latest_year       NUMERIC,
          ADD COLUMN IF NOT EXISTS net_profit_previous_year     NUMERIC,
          ADD COLUMN IF NOT EXISTS gross_receipts_latest_year   NUMERIC,
          ADD COLUMN IF NOT EXISTS gross_receipts_previous_year NUMERIC,
          ADD COLUMN IF NOT EXISTS financial_year_latest        TEXT,
          ADD COLUMN IF NOT EXISTS financial_year_previous      TEXT
    `);
    console.log('✅ itr_analytics_requests updated');

    await p.$executeRawUnsafe(`
        ALTER TABLE bank_statement_analysis_requests
          ADD COLUMN IF NOT EXISTS avg_bank_balance_latest_year   NUMERIC,
          ADD COLUMN IF NOT EXISTS avg_bank_balance_previous_year NUMERIC,
          ADD COLUMN IF NOT EXISTS financial_year_latest          TEXT,
          ADD COLUMN IF NOT EXISTS financial_year_previous        TEXT
    `);
    console.log('✅ bank_statement_analysis_requests updated');

    await p.$executeRawUnsafe(`
        ALTER TABLE bureau_verifications
          ADD COLUMN IF NOT EXISTS emi_obligations_total NUMERIC
    `);
    console.log('✅ bureau_verifications updated');

    console.log('\n🎉 All migrations complete. No data lost.');
    process.exit(0);
}

migrate().catch(e => { console.error('Migration FAILED:', e); process.exit(1); });
