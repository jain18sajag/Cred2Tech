-- ============================================================
-- Phase 1 Migration — Cred2Tech MSME Platform
-- Run this ONCE against the production database.
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- BLOCK A: ENUM EXTENSIONS (additive, non-destructive)
-- ──────────────────────────────────────────────────────────────
ALTER TYPE "CaseStage" ADD VALUE IF NOT EXISTS 'INCOME_REVIEWED';
ALTER TYPE "CaseStage" ADD VALUE IF NOT EXISTS 'ESR_GENERATED';

ALTER TYPE "LenderProductType" ADD VALUE IF NOT EXISTS 'WC';
ALTER TYPE "LenderProductType" ADD VALUE IF NOT EXISTS 'TL';
ALTER TYPE "LenderProductType" ADD VALUE IF NOT EXISTS 'ML';
ALTER TYPE "LenderProductType" ADD VALUE IF NOT EXISTS 'BL';

-- ──────────────────────────────────────────────────────────────
-- BLOCK B: MISSING INDEXES ON EXISTING TABLES
-- ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_applicants_case_id
    ON applicants(case_id);

CREATE INDEX IF NOT EXISTS idx_bureau_verif_lookup
    ON bureau_verifications(case_id, applicant_id, status);

CREATE INDEX IF NOT EXISTS idx_bvl_case_id
    ON bureau_verification_logs(case_id);

-- ──────────────────────────────────────────────────────────────
-- BLOCK C: ADD name COLUMN TO applicants
-- ──────────────────────────────────────────────────────────────
ALTER TABLE applicants
    ADD COLUMN IF NOT EXISTS name VARCHAR(200);

-- ──────────────────────────────────────────────────────────────
-- BLOCK D: CASES TABLE — add esr_generated flag
-- ──────────────────────────────────────────────────────────────
ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS esr_generated BOOLEAN NOT NULL DEFAULT false;

-- ──────────────────────────────────────────────────────────────
-- BLOCK E: NEW TABLE — case_property_details
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_property_details (
    id                SERIAL        PRIMARY KEY,
    case_id           INTEGER       NOT NULL,
    property_type     VARCHAR(100),
    occupancy_status  VARCHAR(50),
    ownership_type    VARCHAR(50),
    market_value      NUMERIC(15,2),
    remarks           TEXT,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_property_case
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    CONSTRAINT uq_property_case
        UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_property_case_id
    ON case_property_details(case_id);

COMMENT ON TABLE case_property_details IS
    'Collateral property per case. UNIQUE per case (Phase 1). Phase 2 will relax to multi-property.';

-- ──────────────────────────────────────────────────────────────
-- BLOCK F: NEW TABLE — case_income_entries
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_income_entries (
    id                  SERIAL        PRIMARY KEY,
    case_id             INTEGER       NOT NULL,
    applicant_id        INTEGER,
    income_type         VARCHAR(100)  NOT NULL,
    applicant_label     VARCHAR(200),
    annual_amount       NUMERIC(15,2) NOT NULL CHECK (annual_amount >= 0),
    supporting_doc_type VARCHAR(100),
    remarks             TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_income_case
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_income_applicant
        FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_income_entries_case_id
    ON case_income_entries(case_id);

-- ──────────────────────────────────────────────────────────────
-- BLOCK G: NEW TABLE — case_credit_obligations
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_credit_obligations (
    id                  SERIAL        PRIMARY KEY,
    case_id             INTEGER       NOT NULL,
    applicant_id        INTEGER       NOT NULL,
    lender_name         VARCHAR(200),
    loan_type           VARCHAR(100),
    loan_amount         NUMERIC(15,2),
    outstanding_amount  NUMERIC(15,2),
    loan_start_date     DATE,
    emi_per_month       NUMERIC(12,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                            CHECK (status IN ('ACTIVE','CLOSED','NPA','VERIFY')),
    source              VARCHAR(20)   NOT NULL DEFAULT 'BUREAU'
                            CHECK (source IN ('BUREAU','MANUAL')),
    needs_verification  BOOLEAN       NOT NULL DEFAULT false,
    remarks             TEXT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_obligation_case
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_obligation_applicant
        FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_obligations_case_id
    ON case_credit_obligations(case_id);
CREATE INDEX IF NOT EXISTS idx_obligations_applicant_id
    ON case_credit_obligations(applicant_id);
CREATE INDEX IF NOT EXISTS idx_obligations_case_app
    ON case_credit_obligations(case_id, applicant_id);

-- ──────────────────────────────────────────────────────────────
-- BLOCK H: NEW TABLE — eligibility_reports
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eligibility_reports (
    id                    SERIAL        PRIMARY KEY,
    case_id               INTEGER       NOT NULL,
    generated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    generated_by_user_id  INTEGER,
    combined_income       NUMERIC(15,2),
    property_value        NUMERIC(15,2),
    primary_cibil_score   INTEGER,
    lowest_cibil_score    INTEGER,
    total_emi_per_month   NUMERIC(12,2),
    raw_payload           JSONB,
    status                VARCHAR(30)   NOT NULL DEFAULT 'GENERATED',
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_esr_case
        FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    CONSTRAINT fk_esr_user
        FOREIGN KEY (generated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_esr_case
        UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_esr_case_id
    ON eligibility_reports(case_id);

COMMENT ON TABLE eligibility_reports IS
    'ESR snapshot per case. Unique per case — upserted on regeneration. raw_payload holds per-lender JSON.';

-- ──────────────────────────────────────────────────────────────
-- BLOCK I: BUREAU VERIFICATION STATUS CHECK CONSTRAINT
-- ──────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_bureau_status' AND conrelid = 'bureau_verifications'::regclass
    ) THEN
        ALTER TABLE bureau_verifications
            ADD CONSTRAINT chk_bureau_status
            CHECK (status IN ('SUCCESS','FAILED','PENDING'));
    END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- VALIDATION QUERIES (run after migration to verify)
-- ──────────────────────────────────────────────────────────────
-- SELECT unnest(enum_range(NULL::"CaseStage"))::text;
-- SELECT unnest(enum_range(NULL::"LenderProductType"))::text;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'applicants' AND column_name = 'name';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'cases' AND column_name = 'esr_generated';
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('case_property_details','case_income_entries','case_credit_obligations','eligibility_reports');
