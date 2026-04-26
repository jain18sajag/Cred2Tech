// run_proposals_migration.js
// Safe migration — only CREATEs, never drops or overwrites
const p = require('./config/db');

async function migrate() {
    console.log('Running Proposals migration...');

    // 1. Add LEAD_SENT_TO_LENDER to CaseStage enum (Postgres ALTER TYPE)
    await p.$executeRawUnsafe(`
        DO $$ BEGIN
            ALTER TYPE "CaseStage" ADD VALUE IF NOT EXISTS 'LEAD_SENT_TO_LENDER';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    `);
    console.log('✅ CaseStage enum updated');

    // 2. Create proposals table (lender_id is TEXT to match lenders.id)
    await p.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS proposals (
            id                       SERIAL PRIMARY KEY,
            tenant_id                INTEGER NOT NULL,
            case_id                  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
            lender_id                TEXT NOT NULL,
            scheme_id                INTEGER,
            case_esr_financial_id    INTEGER REFERENCES case_esr_financials(id),
            proposal_source_id       INTEGER REFERENCES proposals(id),
            proposal_number          VARCHAR(50),
            proposal_status          VARCHAR(50) NOT NULL DEFAULT 'draft',
            lender_submission_status VARCHAR(50) DEFAULT 'draft',
            requested_amount         NUMERIC(18,2),
            eligible_amount          NUMERIC(18,2),
            roi_min                  NUMERIC(8,4),
            roi_max                  NUMERIC(8,4),
            tenure_months            INTEGER,
            loan_purpose             TEXT,
            remarks                  TEXT,
            additional_notes         TEXT,
            preferred_banking_program VARCHAR(100),
            created_by_user_id       INTEGER NOT NULL,
            updated_by_user_id       INTEGER,
            submitted_at             TIMESTAMP,
            created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
            updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
    console.log('✅ proposals table created');

    // 3. Create proposal_documents link table
    await p.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS proposal_documents (
            id              SERIAL PRIMARY KEY,
            proposal_id     INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
            document_id     INTEGER NOT NULL REFERENCES documents(id),
            document_type   VARCHAR(100),
            attached_at     TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE(proposal_id, document_id)
        )
    `);
    console.log('✅ proposal_documents table created');

    // 4. Indexes
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_proposals_case_id ON proposals(case_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_proposals_lender_id ON proposals(lender_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_proposals_tenant_id ON proposals(tenant_id)`);
    await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_proposal_docs_proposal_id ON proposal_documents(proposal_id)`);
    console.log('✅ Indexes created');

    console.log('\n🎉 Proposals migration complete.');
    process.exit(0);
}

migrate().catch(e => { console.error('Migration FAILED:', e); process.exit(1); });
