// run_migration_financial_snapshots.js
// Production-grade financial snapshot migration
// Safe: ALTER TABLE IF NOT EXISTS + CREATE TABLE IF NOT EXISTS only. No DROP. No data loss.

const p = require('./config/db');

async function migrate() {
    console.log('\n========================================================');
    console.log('Financial Snapshot Architecture Migration');
    console.log('========================================================\n');

    // ── 1. gstr_analytics_requests — additional structured columns ──────────────
    console.log('1/5 → gstr_analytics_requests: adding avg_monthly_turnover, months_filed_12m, nil_return_months...');
    await p.$executeRawUnsafe(`
        ALTER TABLE gstr_analytics_requests
          ADD COLUMN IF NOT EXISTS avg_monthly_turnover  NUMERIC,
          ADD COLUMN IF NOT EXISTS months_filed_12m      INTEGER,
          ADD COLUMN IF NOT EXISTS nil_return_months     INTEGER
    `);
    console.log('   ✅ gstr_analytics_requests updated (3 columns)');

    // ── 2. itr_analytics_requests — filing status columns ───────────────────────
    console.log('2/5 → itr_analytics_requests: adding filing_status_latest, filing_status_previous...');
    await p.$executeRawUnsafe(`
        ALTER TABLE itr_analytics_requests
          ADD COLUMN IF NOT EXISTS filing_status_latest   VARCHAR(50),
          ADD COLUMN IF NOT EXISTS filing_status_previous VARCHAR(50)
    `);
    console.log('   ✅ itr_analytics_requests updated (2 columns)');

    // ── 3. bank_statement_analysis_requests — detailed bank metrics ──────────────
    console.log('3/5 → bank_statement_analysis_requests: adding credit/debit/balance/bounces/name/account...');
    await p.$executeRawUnsafe(`
        ALTER TABLE bank_statement_analysis_requests
          ADD COLUMN IF NOT EXISTS avg_monthly_credit      NUMERIC,
          ADD COLUMN IF NOT EXISTS avg_monthly_debit       NUMERIC,
          ADD COLUMN IF NOT EXISTS avg_closing_balance     NUMERIC,
          ADD COLUMN IF NOT EXISTS cheque_bounces_12m      INTEGER,
          ADD COLUMN IF NOT EXISTS statement_period        VARCHAR(100),
          ADD COLUMN IF NOT EXISTS bank_name               VARCHAR(200),
          ADD COLUMN IF NOT EXISTS account_number_masked   VARCHAR(50)
    `);
    console.log('   ✅ bank_statement_analysis_requests updated (7 columns)');

    // ── 4. bureau_verifications — additional structured fields ───────────────────
    console.log('4/5 → bureau_verifications: adding bureau_name, active_loan_count, overdue_amount, dpd_status...');
    await p.$executeRawUnsafe(`
        ALTER TABLE bureau_verifications
          ADD COLUMN IF NOT EXISTS bureau_name       VARCHAR(100),
          ADD COLUMN IF NOT EXISTS active_loan_count INTEGER,
          ADD COLUMN IF NOT EXISTS overdue_amount    NUMERIC,
          ADD COLUMN IF NOT EXISTS dpd_status        VARCHAR(50)
    `);
    console.log('   ✅ bureau_verifications updated (4 columns)');

    // ── 5. proposal_financial_snapshots — NEW frozen proposal snapshot table ──────
    console.log('5/5 → Creating proposal_financial_snapshots table...');
    await p.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS proposal_financial_snapshots (
            id                          SERIAL PRIMARY KEY,

            -- Core linkage
            proposal_id                 INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
            case_id                     INTEGER NOT NULL,
            tenant_id                   INTEGER NOT NULL,
            lender_id                   TEXT,
            scheme_id                   TEXT,
            case_esr_financial_id       INTEGER,
            product_type                TEXT,

            -- Versioning (allows future revision history)
            version_number              INTEGER NOT NULL DEFAULT 1,
            is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
            snapshot_status             TEXT    NOT NULL DEFAULT 'draft',

            -- GST structured values
            gst_turnover_latest_year    NUMERIC,
            gst_turnover_previous_year  NUMERIC,
            gst_avg_monthly_turnover    NUMERIC,
            gst_financial_year_latest   TEXT,
            gst_financial_year_previous TEXT,
            gst_months_filed_12m        INTEGER,
            gst_nil_return_months       INTEGER,

            -- ITR structured values
            itr_net_profit_latest_year      NUMERIC,
            itr_net_profit_previous_year    NUMERIC,
            itr_gross_receipts_latest_year  NUMERIC,
            itr_gross_receipts_previous_year NUMERIC,
            itr_financial_year_latest       TEXT,
            itr_financial_year_previous     TEXT,
            itr_filing_status_latest        TEXT,
            itr_filing_status_previous      TEXT,

            -- Banking structured values
            bank_avg_balance_latest_year    NUMERIC,
            bank_avg_balance_previous_year  NUMERIC,
            bank_avg_monthly_credit         NUMERIC,
            bank_avg_monthly_debit          NUMERIC,
            bank_avg_closing_balance        NUMERIC,
            bank_cheque_bounces_12m         INTEGER,
            bank_statement_period           TEXT,
            bank_name                       TEXT,
            bank_account_number_masked      TEXT,

            -- Bureau structured values
            bureau_score                    INTEGER,
            bureau_name                     TEXT,
            emi_obligations_total           NUMERIC,
            active_loan_count               INTEGER,
            overdue_amount                  NUMERIC,
            dpd_status                      TEXT,

            -- Eligibility snapshot (from ESR raw_payload for this lender)
            selected_income_method          TEXT,
            selected_monthly_income         NUMERIC,
            eligible_amount                 NUMERIC,
            requested_amount                NUMERIC,
            roi_min                         NUMERIC,
            roi_max                         NUMERIC,
            ltv_percent                     NUMERIC,
            tenure_months                   INTEGER,
            foir_allowed_percent            NUMERIC,
            foir_actual_percent             NUMERIC,
            max_eligible_emi                NUMERIC,

            -- Audit fields
            created_by_user_id              INTEGER,
            updated_by_user_id              INTEGER,
            created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    console.log('   ✅ proposal_financial_snapshots created');

    // Indexes
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pfs_proposal_id         ON proposal_financial_snapshots(proposal_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pfs_case_id             ON proposal_financial_snapshots(case_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pfs_lender_id           ON proposal_financial_snapshots(lender_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pfs_case_esr_financial  ON proposal_financial_snapshots(case_esr_financial_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_pfs_is_active           ON proposal_financial_snapshots(proposal_id, is_active)`);
    console.log('   ✅ Indexes created');

    console.log('\n🎉 All migrations complete. No data lost.\n');
    process.exit(0);
}

migrate().catch(e => {
    console.error('\n❌ Migration FAILED:\n', e.message);
    process.exit(1);
});
