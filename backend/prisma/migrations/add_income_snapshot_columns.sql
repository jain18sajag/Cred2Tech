-- Migration: Persistent Income Snapshot Columns
-- Safe: uses IF NOT EXISTS on all additions. No drops, no table recreation.
-- Apply date: 2026-04-25

-- gstr_analytics_requests
ALTER TABLE gstr_analytics_requests
  ADD COLUMN IF NOT EXISTS turnover_latest_year      NUMERIC,
  ADD COLUMN IF NOT EXISTS turnover_previous_year    NUMERIC,
  ADD COLUMN IF NOT EXISTS financial_year_latest     TEXT,
  ADD COLUMN IF NOT EXISTS financial_year_previous   TEXT;

-- itr_analytics_requests
ALTER TABLE itr_analytics_requests
  ADD COLUMN IF NOT EXISTS net_profit_latest_year       NUMERIC,
  ADD COLUMN IF NOT EXISTS net_profit_previous_year     NUMERIC,
  ADD COLUMN IF NOT EXISTS gross_receipts_latest_year   NUMERIC,
  ADD COLUMN IF NOT EXISTS gross_receipts_previous_year NUMERIC,
  ADD COLUMN IF NOT EXISTS financial_year_latest        TEXT,
  ADD COLUMN IF NOT EXISTS financial_year_previous      TEXT;

-- bank_statement_analysis_requests
ALTER TABLE bank_statement_analysis_requests
  ADD COLUMN IF NOT EXISTS avg_bank_balance_latest_year   NUMERIC,
  ADD COLUMN IF NOT EXISTS avg_bank_balance_previous_year NUMERIC,
  ADD COLUMN IF NOT EXISTS financial_year_latest          TEXT,
  ADD COLUMN IF NOT EXISTS financial_year_previous        TEXT;

-- bureau_verifications
ALTER TABLE bureau_verifications
  ADD COLUMN IF NOT EXISTS emi_obligations_total NUMERIC;
