# SYSTEM ONBOARDING ARCHITECTURE
## Cred2Tech — MSME Loan Eligibility & DSA CRM Platform

> **Purpose:** This document is the single source of truth for this codebase. Any new developer, AI agent, or team member must read this document before making any changes. It describes the complete system architecture, data model, onboarding flow, and extension strategy.
>
> **Last Updated:** April 2026
> **Stack:** PERN (PostgreSQL · Express · React · Node.js) + Prisma ORM

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Customer Onboarding Flow](#2-customer-onboarding-flow-end-to-end)
3. [Database Architecture Overview](#3-database-architecture-overview)
4. [Case Lifecycle Stage Model](#4-case-lifecycle-stage-model)
5. [Product Selection Logic](#5-product-selection-logic)
6. [Property Details Model](#6-property-details-model)
7. [Income Summary Logic](#7-income-summary-logic)
8. [Bureau Integration Model](#8-bureau-integration-model)
9. [Eligibility Engine (ESR) Architecture](#9-eligibility-engine-esr-architecture)
10. [Lender Configuration Matrix](#10-lender-configuration-matrix)
11. [Document Storage Strategy](#11-document-storage-strategy)
12. [Multi-Tenant Isolation Strategy](#12-multi-tenant-isolation-strategy)
13. [API Flow Mapping](#13-api-flow-mapping)
14. [Migration Safety Strategy](#14-migration-safety-strategy)
15. [Phase 1 vs Phase 2 Roadmap](#15-phase-1-vs-phase-2-roadmap)
16. [Future Extension Guidelines](#16-future-extension-guidelines)

---

## 1. System Overview

### What This Platform Does

Cred2Tech is a B2B SaaS platform that enables DSAs (Direct Selling Agents) and financial intermediaries to onboard MSME loan applicants, collect financial data via regulated APIs (GST, ITR, Bureau, Bank Statement), and determine loan eligibility across multiple lenders — all from a single CRM interface.

The platform is **not a lender**. It acts as a technology facilitator that:
- Collects customer consent and PAN/GST/ITR/Bank data through integrated APIs
- Runs bureau checks per applicant
- Aggregates income from multiple sources (GST turnover, ITR net profit, bank balance, manual additions)
- Evaluates the case against each lender's configured scheme parameters
- Generates an Eligibility Summary Report (ESR) and routes the case to the chosen lender

### Who Uses It

| Role | Description | Access Level |
|------|-------------|--------------|
| **DSA Admin** | Owner of a DSA firm registered on the platform. Manages team, wallet, lender config | Full DSA access |
| **DSA Member** | Field agent added by DSA Admin. Creates customers and cases, cannot manage wallet or team | Operational access |
| **Cred2Tech Member** | Internal Cred2Tech staff. Manages tenants, wallets, platform-level config | Super access |
| **SUPER_ADMIN** | Root admin. No tenant restrictions | Unrestricted |

### Multi-Tenant Architecture

Every DSA firm is a **Tenant**. All data in the system is scoped by `tenant_id`. A tenant has:
- Its own **Users** (team members)
- Its own **Customers** and **Cases**
- Its own **Wallet** with a credit balance
- Its own **API usage logs** and **pricing overrides**

Tenants are isolated at the application layer via JWT middleware that injects `req.user.tenant_id` on every authenticated request. All service functions validate that the requested resource belongs to the authenticated tenant before proceeding.

### How Tenants Relate to Core Entities

```
Tenant
├── Users (role: DSA_ADMIN | DSA_MEMBER | CRED2TECH_MEMBER | SUPER_ADMIN)
├── Wallet (single per tenant, credit balance for API usage)
├── Customers (MSME businesses onboarded by this tenant)
│   └── Cases (one customer can have multiple cases / loan applications)
│       ├── Applicants (PRIMARY + CO_APPLICANTs per case)
│       ├── CaseDataPullStatus (tracks GST/ITR/Bank/Bureau/PAN pull status)
│       ├── BureauVerification (per applicant)
│       ├── GstrAnalyticsRequest (GST pull jobs)
│       ├── ItrAnalyticsRequest (ITR pull jobs)
│       ├── BankStatementAnalysisRequest (bank statement jobs)
│       ├── CasePropertyDetails (property/collateral per case)
│       ├── CaseIncomeEntry (manual income additions per case)
│       ├── CaseCreditObligation (EMI obligations per applicant)
│       └── EligibilityReport (ESR snapshot per case)
└── Documents (files ingested from vendors or uploaded directly)
```

### Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Database** | PostgreSQL (v14+) | Hosted on dedicated server |
| **ORM** | Prisma (v5+) | Schema in `backend/prisma/schema.prisma` |
| **Backend** | Node.js + Express | `backend/src/` directory |
| **Auth** | JWT (jsonwebtoken) | Issued on login, validated via middleware |
| **Frontend** | React + React Router | `frontend/src/` directory |
| **External APIs** | Signzy (GST/ITR/Bank), Veri5 Digital (Bureau) | Wrapped in `backend/src/services/externalApis/` |
| **File Storage** | Local filesystem (Phase 1), Cloudflare R2 ready (Phase 2) | `backend/uploads/` |

---

## 2. Customer Onboarding Flow (End-to-End)

### Wizard Steps (UI)

The onboarding wizard has 3 steps plus 3 post-wizard pages:

```
Wizard Step 1: PAN & Contacts
Wizard Step 2: GST / ITR / Bank Statement
Wizard Step 3: Product & Property
─────────────────────────────────────
Standalone Page 4: Income Summary
Standalone Page 5: Bureau & Obligations
Standalone Page 6: Eligibility Summary Report (ESR)
─────────────────────────────────────
Post-ESR:       Lender Selection → Login → Sanction → Disbursement
```

---

### Step 1 — PAN & Contacts

**What the user does:** Enters PAN number, mobile, email for the primary borrower. Optionally adds co-applicants (PAN + mobile + email each). An OTP is sent to each applicant's mobile for bureau consent.

**What gets saved:**
- `Customer` record created (`business_pan`, `business_mobile`, `business_email`, `tenant_id`)
- `Case` record created (`stage: DRAFT`, linked to Customer)
- `Applicant` record created automatically for `type: PRIMARY` (auto-populated from Customer)
- Co-applicant `Applicant` records created (`type: CO_APPLICANT`) for each added co-applicant
- PAN profile fetch triggered → `CustomerPanProfile` created via Signzy
- `OtpVerification` records created per applicant for bureau consent

**Which service updates it:**
- `case.service.createCase()` — creates Case + PRIMARY Applicant atomically
- `external.pan.controller.verify()` → `CustomerPanProfile`
- `otp.controller.sendOtp()` → `OtpVerification`

**Stage after this step:** `DRAFT`

---

### Step 2 — GST / ITR / Bank Statement

**What the user does:** Generates GST report (via direct login or send-link mode), generates ITR report, uploads bank statements for each applicant.

**What gets saved:**
- `GstrAnalyticsRequest` — GST pull job tracking (status: INITIATED → COMPLETED)
- `CustomerGSTProfile` — parsed GST summary (turnover, filing status, last period)
- `ItrAnalyticsRequest` — ITR pull job tracking (status: INITIATED → COMPLETED)
- `BankStatementAnalysisRequest` — one per applicant (status: INITIATED → ANALYZING → COMPLETED)
- `Documents` — Excel/JSON files ingested from Signzy vendor URLs into local/R2 storage
- `CaseDataPullStatus` — status flags updated (`gst_status`, `itr_status`, `bank_status`)

**Bureau is also visible in this step** via the bureau verification card. Bureau pulls can be triggered manually per applicant on this page.

**Stage after this step:** `DATA_COLLECTION` (conceptually; stage may stay at DRAFT in current implementation until product is selected)

---

### Step 3 — Product & Property

**What the user does:** Selects loan product from dropdown. If product is LAP or HL, fills in property details (type, occupancy, ownership, market value).

**What gets saved:**
- `Case.product_type` updated (LAP | HL | WC | TL | ML | BL | Other)
- `CasePropertyDetails` upserted (one per case, UNIQUE constraint in Phase 1)
- `Case.stage` → `LEAD_CREATED`

**Validation rules:**
- `property_type`, `occupancy_status`, `market_value` are required when product is LAP or HL
- Product type must match a valid enum value or accepted string

**Stage after this step:** `LEAD_CREATED`

---

### Step 4 — Income Summary

**What the user does:** Reviews auto-computed income (from GST, ITR, Bank APIs). Optionally adds manual income entries (Director salary, rental income, etc.).

**What gets computed (dynamically, not stored):**
- `gst_turnover` — from `GstrAnalyticsRequest.raw_gst_data`
- `net_profit` — from `ItrAnalyticsRequest.analytics_payload`
- `avg_bank_balance` — from latest `BankStatementAnalysisRequest` for PRIMARY applicant

**What gets stored:**
- `CaseIncomeEntry` — each manual income row (income_type, applicant_label, annual_amount, supporting_doc_type, remarks)

**Combined income for ESR** = `net_profit + SUM(CaseIncomeEntry.annual_amount)`

**Stage after this step:** `INCOME_REVIEWED` (on confirm)

---

### Step 5 — Bureau & Obligations

**What the user does:** Reviews all bureau-pulled credit obligations per applicant. Edits EMI values if bureau data is wrong. Adds loans not showing in bureau. Confirms the total obligation summary.

**What gets stored:**
- `CaseCreditObligation` records — one per loan per applicant
  - `source: BUREAU` — auto-populated from `BureauVerification.raw_response`
  - `source: MANUAL` — added by DSA via "+ Add Loan Not in Bureau"
  - `needs_verification: true` when bureau EMI = 0 (shown as "⚠ Verify" in UI)
- Each obligation row is individually editable (EMI field)

**Stage after this step:** (no mandatory stage change; ESR generation moves to `ESR_GENERATED`)

---

### Step 6 — Eligibility Summary Report (ESR)

**What the user does:** Clicks "Generate Eligibility Summary Report". Views eligible vs ineligible lenders. Selects a lender.

**What gets computed and stored:**
- `EligibilityReport` record created with:
  - `combined_income`, `property_value`, `primary_cibil_score`, `lowest_cibil_score`, `total_emi_per_month`
  - `raw_payload` (JSON blob of per-lender eligibility result)
- `Case.stage` → `ESR_GENERATED`
- `Case.esr_generated` → true

**Post-ESR lender selection:**
- Currently: `Case.lender_name` updated (free string, Phase 1 behavior)
- Phase 2: `CaseLenderSelection` table with FK to `Lender`

---

### Post-ESR Lifecycle (Manual CRM Updates)

After ESR, the case progresses through post-loan stages that are manually updated by the DSA or admin:

| Stage | Meaning | Trigger |
|-------|---------|---------|
| `LENDER_SELECTED` | DSA chose a lender from ESR | DSA clicks "Select this Lender" |
| `IN_REVIEW` | Case submitted to lender for review | Manual stage update |
| `APPROVED` | Lender sanctions the loan | Manual stage update |
| `REJECTED` | Lender rejects the case | Manual stage update |

---

## 3. Database Architecture Overview

### Entity Relationship (Text Format)

```
Tenant
├── users[]                        (all team members)
├── wallet                         (TenantWallet — single credit balance)
├── api_pricing_overrides[]        (custom API prices for this tenant)
├── customers[]
│   ├── pan_profiles[]             (CustomerPanProfile — PAN verification result)
│   ├── gst_profiles[]             (CustomerGSTProfile — parsed GST summary)
│   ├── gst_requests[]             (GstrAnalyticsRequest — raw GST pull jobs)
│   ├── itr_analytics[]            (ItrAnalyticsRequest — ITR pull jobs)
│   ├── bank_statements[]          (BankStatementAnalysisRequest — bank pull jobs)
│   ├── documents[]                (Document — all files linked to this customer)
│   ├── consents[]                 (CustomerConsent)
│   └── cases[]
│       ├── applicants[]           (Applicant — PRIMARY + CO_APPLICANTs)
│       │   ├── bank_statements[]  (per-applicant bank statements)
│       │   ├── itr_analytics[]    (per-applicant ITR)
│       │   ├── bureau_checks[]    (BureauVerification)
│       │   ├── income_entries[]   (CaseIncomeEntry — manual income rows)
│       │   ├── obligations[]      (CaseCreditObligation — EMI rows)
│       │   └── documents[]        (per-applicant documents)
│       ├── data_pull_status       (CaseDataPullStatus — status flags for all pulls)
│       ├── property               (CasePropertyDetails — collateral info)
│       ├── esr                    (EligibilityReport — ESR snapshot)
│       ├── gst_requests[]
│       ├── itr_analytics[]
│       ├── bank_statements[]
│       ├── bureau_checks[]
│       ├── documents[]
│       └── activity_logs[]

Lender
└── products[]                     (LenderProduct — one per product type: HL/LAP/WC/etc.)
    └── schemes[]                  (Scheme — rate schemes for this product)
        └── parameter_values[]     (SchemeParameterValue — actual rule values)
                                   (linked to ParameterMaster for label/type metadata)

ParameterMaster                    (global list of all configurable parameter keys)
ApiPricing                         (default credit costs per API code)
TenantApiPricingOverride           (per-tenant overrides)
WalletTransaction                  (debit/credit ledger)
ApiUsageLog                        (immutable record of every API call)
OtpVerification                    (OTP records for applicant consent)
ActivityLog                        (human-readable audit log per case/customer)
```

---

### Key Relationships to Know

**`Case` is the central anchor for a loan application.** Every data pull, every document, every verification, every eligibility result is linked to a Case.

**`Applicant` is the financial identity within a Case.** A Customer (business entity) can have a case with multiple Applicants. Bureau is run per Applicant, not per Customer.

**`BureauVerification` links to both Case and Applicant.** This allows per-applicant score tracking and per-case aggregation.

**`Document` links to Tenant + Customer + Case + Applicant (all optional except Tenant).** This flexible linking model allows documents to be associated at any level of the hierarchy.

**`EligibilityReport` is 1-to-1 with Case (unique constraint).** Regenerating ESR overwrites the single record via upsert.

---

## 4. Case Lifecycle Stage Model

### Enum: `CaseStage` (PostgreSQL)

All stage transitions happen via `prisma.case.update({ where: { id }, data: { stage: 'NEW_STAGE' } })`.

| Stage | When Set | Service | UI Step |
|-------|----------|---------|---------|
| `DRAFT` | Case created | `case.service.createCase()` | Start of wizard |
| `DATA_COLLECTION` | First data pull triggered (GST/ITR/Bank) | External API controllers | Wizard Step 2 |
| `LEAD_CREATED` | Product type saved + Property added (Step 3 complete) | `case.service.updateProductProperty()` | Wizard Step 3 Complete |
| `INCOME_REVIEWED` | Income Summary confirmed | `income.service.confirmIncomeSummary()` | Step 4 Confirm |
| `ESR_GENERATED` | ESR successfully generated | `esr.service.generateESR()` | Step 6 |
| `IN_REVIEW` | Manual update by DSA | `case.controller.updateStage()` | Pipeline page |
| `APPROVED` | Manual update | `case.controller.updateStage()` | Pipeline page |
| `REJECTED` | Manual update | `case.controller.updateStage()` | Pipeline page |

### Stages NOT Yet in Enum (Prototype Shows — Phase 2)

The prototype pipeline filter tabs show additional stages that are **not yet in the PostgreSQL enum**. These are displayed as label text only in Phase 1:

- `Lead Sent` (after lender selected, before login)
- `Login Done` (case formally logged at lender)
- `Sanctioned`
- `Partly Disbursed`
- `Closed`

> ⚠️ **Rule:** PostgreSQL enum values can only be ADDED, never renamed. Any addition requires `ALTER TYPE "CaseStage" ADD VALUE` and a `prisma generate`. Never rename, reorder without a full migration script.

---

## 5. Product Selection Logic

### How Product Type Is Stored

`Case.product_type` is currently a **free `String?` field** on the Case model. This was an intentional design choice to avoid premature constraint. The allowed values are:

```
LAP   — Loan Against Property
HL    — Home Loan
WC    — Working Capital / Cash Credit / OD
TL    — Term Loan (MSME / Business Loan)
ML    — Machinery / Equipment Finance
BL    — Business Loan (Unsecured)
Other — Specify manually
```

### How It Maps to Lender Products

The `Lender` model has `LenderProduct` records with a `product_type` enum (`LenderProductType`). When ESR is generated, the eligibility engine filters lender products where `lender_product.product_type` matches or is compatible with `case.product_type`.

**Important:** `Case.product_type` is a string; `LenderProduct.product_type` uses the `LenderProductType` enum. The mapping is done at the service layer:

```javascript
// esr.service.js — concept
const matchingProducts = await prisma.lenderProduct.findMany({
  where: { product_type: case.product_type, status: 'ACTIVE' }
});
```

This means `case.product_type` values must exactly match enum member names (case-sensitive). The frontend dropdown `value` attributes must match exactly.

### Frontend Dropdown — Value Must Match Backend Enum

```html
<option value="LAP">LAP — Loan Against Property</option>
<option value="HL">HL — Home Loan</option>
<option value="WC">Working Capital (CC / OD)</option>
<option value="TL">Term Loan (MSME / BL)</option>
<option value="ML">Machinery / Equipment Finance</option>
<option value="BL">Business Loan (Unsecured)</option>
<option value="Other">Other — Specify</option>
```

The `value` attribute is what gets saved to the DB. Labels are display-only.

---

## 6. Property Details Model

### Why Property Is Separated From the Case Table

The `Case` table originally had flat columns: `property_type`, `property_value`, `location`, `occupancy`, `ltv_ratio`. These were moved to `CasePropertyDetails` for these reasons:

1. **Normalization:** Property has logical coherence as its own entity (type, occupancy, ownership, valuation, location, remarks)
2. **Future-proofing:** Some cases may involve multiple collateral properties (joint property, multiple ownership). A separate table supports this with a schema change only (remove UNIQUE constraint)
3. **Clean aggregation:** ESR needs to query `property_value` directly without scanning all Case columns
4. **Audit readiness:** Separate timestamps per property record for independent audit trail

### Current Design (Phase 1)

- **One property per case** enforced via `UNIQUE(case_id)` on `case_property_details`
- Property is created/updated via `UPSERT` on `case_id`
- All fields are nullable except `case_id` (property section is optional for non-LAP/HL products)

### Phase 2 Design

- Remove `UNIQUE(case_id)` constraint
- Add `is_primary BOOLEAN DEFAULT true` column
- Change ESR to use the primary property's `market_value`

### LAP vs HL vs Other

| Product | Property Required? | Validation |
|---------|--------------------|------------|
| LAP — Loan Against Property | **Yes** | `property_type`, `market_value` required |
| HL — Home Loan | **Yes** | `property_type`, `market_value` required |
| WC / TL / ML / BL | **No** | Property section hidden in UI, not validated |

### Deprecated Case Columns

The following columns on the `Case` table are **deprecated** — they exist for backward compatibility and must NOT be written to by new code:

```
cases.property_type   → use case_property_details.property_type
cases.property_value  → use case_property_details.market_value
cases.location        → use case_property_details.location (Phase 2)
cases.occupancy       → use case_property_details.occupancy_status
cases.ltv_ratio       → computed during ESR, not stored
cases.lender_name     → use case_lender_selections (Phase 2)
```

---

## 7. Income Summary Logic

### Data Sources

The income summary page aggregates income from four sources:

| Source | Table | Field | Notes |
|--------|-------|-------|-------|
| **GST Turnover** | `GstrAnalyticsRequest` | `raw_gst_data.annual_turnover` | Latest completed request for case |
| **Net Profit** | `ItrAnalyticsRequest` | `analytics_payload.net_profit` | Latest completed request for case |
| **Avg Monthly Bank Balance** | `BankStatementAnalysisRequest` | Parsed from JSON report | PRIMARY applicant's statement |
| **Manual Entries** | `CaseIncomeEntry` | `annual_amount` (SUM) | Added by DSA for director salary, rental, etc. |

### Income Computation Logic

```
combined_annual_income = net_profit_from_itr + SUM(case_income_entries.annual_amount)
monthly_income         = combined_annual_income / 12
total_emi_per_month    = SUM(case_credit_obligations.emi_per_month WHERE status = 'ACTIVE')
FOIR                   = total_emi_per_month / monthly_income
eligible_monthly_emi   = monthly_income × (1 - FOIR_threshold)
eligible_loan_amount   = eligible_monthly_emi × loan_tenure_factor
```

> **FOIR (Fixed Obligation to Income Ratio)** is a key lender parameter. Each lender's scheme has a max FOIR configured in `SchemeParameterValue`. The ESR engine compares computed FOIR against each lender's configured limit.

### What Is Stored vs Dynamically Computed

| Data | Stored | Computed |
|------|--------|----------|
| GST turnover figure | In `GstrAnalyticsRequest.raw_gst_data` | Extracted at read time |
| ITR net profit | In `ItrAnalyticsRequest.analytics_payload` | Extracted at read time |
| Bank avg balance | In `BankStatementAnalysisRequest` (JSON report) | Extracted at read time |
| Manual income rows | `CaseIncomeEntry` (persisted) | — |
| Combined income total | `EligibilityReport.combined_income` (snapshot at ESR time) | Recomputed on income page load |
| FOIR | Not stored | Computed during ESR generation |
| Eligible loan amount | Not stored (Phase 1) | Computed during ESR generation |

---

## 8. Bureau Integration Model

### Provider

**Veri5 Digital** — credit score check via `POST /verification-service/verifyID`

### How Bureau Works

1. DSA clicks "Run Bureau" for an applicant (Primary or Co-Applicant)
2. `bureau.controller.runBureauVerification()` receives `{ applicantId }` in request body
3. `walletService.executePaidApi()` is called with:
   - `apiCode: 'BUREAU_PULL'`
   - `idempotencyKey: bureau_case_{caseId}_app_{applicantId}`
4. If idempotency key exists with `status: SUCCESS` → returns cached result (no API call, no charge)
5. If idempotency key exists with `status: FAILED/BLOCKED` → deletes old log, allows retry
6. `bureauService.runBureauCheck()` is called:
   - Checks `BureauVerification` for existing `SUCCESS` record (service-level cache)
   - If cached → returns score without API call
   - Else → calls Veri5 API
7. API response is saved to `BureauVerification` and `BureauVerificationLog`
8. On success: `Applicant.bureau_fetched = true`, `Applicant.cibil_score = score`
9. `CaseDataPullStatus.bureau_status` = `COMPLETE` if at least one applicant succeeded

### Obligation Extraction (Auto-Sync)

When the user enters the Bureau & Obligations page:
1. Backend fetches all `BureauVerification` records with `status: SUCCESS` for the case
2. Parses `raw_response` JSON to extract loan entries
3. Upserts into `CaseCreditObligation` (`source: BUREAU`)
4. Sets `needs_verification: true` for any entry where `emi_per_month = 0`

### How Manual Overrides Work

DSA can:
- **Edit any EMI field** → `PUT /api/cases/:id/bureau-obligations/:id` with updated `emi_per_month`
- **Add missing loans** → `POST` with `source: MANUAL`
- **Neither action deletes the original `BureauVerification` record** — the obligation table is the working copy, bureau table is the audit record

### Repeat Bureau Pulls

- If bureau is already fetched for an applicant (`bureau_fetched: true`), the UI button is disabled
- If the user force-retries:
  - Service-level check (`BureauVerification.status = SUCCESS`) will return cached result
  - No new Veri5 API call → no credit deduction
  - Idempotency key cleanup ensures no "duplicate blocked" error on retry after failure

### Mock Mode (Development)

Set `BUREAU_MOCK=true` in `.env` to bypass Veri5 and generate a random CIBIL score (650–850). Disable before production deployment.

---

## 9. Eligibility Engine (ESR) Architecture

### What ESR Does

The ESR engine evaluates a case against every active lender in the system and determines eligibility based on the lender's configured parameters. It produces a per-lender eligible/ineligible result with reasons.

### How It Computes Eligibility

```
Input (assembled from DB at generation time):
  - combined_income     ← from income summary (computed)
  - property_value      ← from CasePropertyDetails.market_value
  - primary_cibil_score ← from Applicant.cibil_score WHERE type=PRIMARY
  - lowest_cibil_score  ← MIN(Applicant.cibil_score) across all applicants
  - total_emi_per_month ← SUM(CaseCreditObligation.emi_per_month WHERE status=ACTIVE)
  - business_vintage    ← Customer.business_vintage
  - product_type        ← Case.product_type
  - loan_amount         ← Case.loan_amount (if provided)

For each active Lender:
  For each LenderProduct matching case.product_type:
    For each Scheme under that product:
      Check each SchemeParameterValue against input:
        - MIN_CIBIL:        lowest_cibil_score >= param.value
        - MAX_FOIR:         (total_emi/monthly_income) <= param.value
        - MIN_VINTAGE:      business_vintage >= param.value
        - MIN_INCOME:       combined_income >= param.value
        - MAX_LTV:          loan_amount/property_value <= param.value
      If all pass → eligible=true, compute: loan_amount, ROI, max_tenure
      Else → eligible=false, first_failing_reason stored as ineligibility_reason
```

### Output Storage

**Phase 1:** The full result is stored as a JSON blob in `EligibilityReport.raw_payload`:

```json
{
  "lenders": [
    {
      "lender_id": "uuid",
      "lender_name": "HDFC Bank",
      "is_eligible": true,
      "loan_amount": 6800000,
      "roi": 10.5,
      "ltv_percent": 80,
      "max_tenure_months": 180,
      "product_name": "MSME LAP",
      "scheme_name": "Standard Scheme"
    },
    {
      "lender_id": "uuid",
      "lender_name": "Axis Bank",
      "is_eligible": false,
      "ineligibility_reason": "CIBIL score 704 below minimum required 720"
    }
  ]
}
```

**Phase 2:** Each lender result gets its own `EligibilityReportLender` row (normalized table).

### ESR is a Snapshot

The ESR captures the **state of the case at the moment of generation**. If income, property, or obligations are updated after ESR → the old ESR is stale. The DSA must regenerate ESR to get fresh results. The previous ESR record is overwritten via UPSERT on `case_id`.

---

## 10. Lender Configuration Matrix

### Data Model

```
Lender (id: UUID, name, code, status)
└── LenderProduct[] (lender_id FK, product_type enum, status)
    └── Scheme[] (product_id FK, scheme_name, status)
        └── SchemeParameterValue[] (scheme_id FK, parameter_id FK, value: JSON)
            └── ParameterMaster (parameter_key, parameter_label, category, data_type)
```

### ParameterMaster

Defines the list of all possible eligibility parameters with metadata. Examples:

| parameter_key | parameter_label | category | data_type |
|---|---|---|---|
| `MIN_CIBIL` | Minimum CIBIL Score | CREDIT | INTEGER |
| `MAX_FOIR` | Maximum FOIR (%) | INCOME | FLOAT |
| `MIN_BUSINESS_VINTAGE_YEARS` | Minimum Business Vintage | ELIGIBILITY | INTEGER |
| `MAX_LTV_PERCENT` | Maximum LTV Ratio (%) | COLLATERAL | FLOAT |
| `MIN_ANNUAL_INCOME` | Minimum Annual Income (₹) | INCOME | FLOAT |
| `MAX_LOAN_AMOUNT` | Maximum Loan Amount (₹) | LOAN | FLOAT |
| `MIN_LOAN_AMOUNT` | Minimum Loan Amount (₹) | LOAN | FLOAT |

### SchemeParameterValue

Stores the actual value for each parameter under each scheme:

```json
{ "scheme_id": 1, "parameter_id": 5, "value": { "amount": 700 } }    // MIN_CIBIL = 700
{ "scheme_id": 1, "parameter_id": 8, "value": { "percent": 60 } }    // MAX_FOIR = 60%
{ "scheme_id": 1, "parameter_id": 10, "value": { "percent": 75 } }   // MAX_LTV = 75%
```

The `value` column is `JSON` to support flexible data structures per parameter type.

### How the ESR Engine Reads This

```javascript
const lenders = await prisma.lender.findMany({
  where: { status: 'ACTIVE' },
  include: {
    products: {
      where: { status: 'ACTIVE', product_type: case.product_type },
      include: {
        schemes: {
          where: { status: 'ACTIVE' },
          include: { parameter_values: { include: { parameter: true } } }
        }
      }
    }
  }
});
```

---

## 11. Document Storage Strategy

### Document Model

Every file ingested into the system (from vendor URLs or direct uploads) is stored as a `Document` record:

```
Document {
  tenant_id, customer_id?, case_id?, applicant_id?
  document_type: GST_REPORT_PDF | GST_REPORT_EXCEL | ITR_EXCEL | BANK_EXCEL | BANK_JSON | ESR_PDF | OTHER
  source_type: VENDOR_DOWNLOAD | DIRECT_UPLOAD | SYSTEM_GENERATED
  source_url: String?    // Original vendor URL — AUDIT ONLY, never exposed to frontend
  storage_path: String   // Relative path in local/R2 storage
  storage_provider: LOCAL | CLOUDFLARE_R2 | S3
  file_name, mime_type, extension, file_size_bytes, checksum_md5
  status: ACTIVE | FAILED | DELETED
}
```

### Why Vendor URLs Are Never Exposed

External vendor URLs (Signzy, etc.) are:
1. **Short-lived** — they expire in hours, causing broken downloads later
2. **Not authenticated** — anyone with the URL can download
3. **Not auditable** — no control over who accessed what

All vendor files are **ingested** into the platform's own storage via `documentService.ingestFromUrl()`. Only the internal document `id` is returned to the frontend. The frontend fetches files via `/api/documents/:id`, which is authenticated and access-controlled.

### Storage Provider Strategy

- **Phase 1:** `STORAGE_PROVIDER=LOCAL` in `.env`. Files stored in `backend/uploads/`
- **Phase 2:** Switch to `STORAGE_PROVIDER=CLOUDFLARE_R2` by updating `.env` and the storage adapter at `backend/src/services/storage/`. No code changes needed — the provider is abstracted behind `storageService.store()` / `storageService.retrieve()`

### Multi-Entity Linking

Documents can be linked at multiple levels:
- `customer_id` only → e.g., PAN verification document
- `case_id` + `customer_id` → e.g., GST report for a specific case
- `applicant_id` + `case_id` → e.g., bank statement for a specific co-applicant

---

## 12. Multi-Tenant Isolation Strategy

### The Rule

**Every data-modifying service function must validate tenant ownership before writing.**

```javascript
// Standard pattern in every service:
const caseRecord = await prisma.case.findFirst({
  where: { id: caseId, tenant_id: tenantId }
});
if (!caseRecord) throw new Error('Case not found or unauthorized');
```

Never use `findUnique({ where: { id } })` alone in service functions — always add `tenant_id` to the where clause.

### Tenant Isolation Table

| Entity | Tenant Scope Mechanism |
|--------|----------------------|
| `User` | `tenant_id` FK directly on record |
| `Customer` | `tenant_id` FK directly on record |
| `Case` | `tenant_id` FK directly on record |
| `Applicant` | Via `case.tenant_id` (no direct tenant_id column) |
| `Document` | `tenant_id` FK directly on record |
| `BureauVerification` | Via `case.tenant_id` |
| `GstrAnalyticsRequest` | `tenant_id` FK directly on record |
| `BankStatementAnalysisRequest` | `tenant_id` FK directly on record |
| `TenantWallet` | `tenant_id` FK (one wallet per tenant) |
| `ApiUsageLog` | `tenant_id` FK directly on record |
| `CasePropertyDetails` | Via `case.tenant_id` |
| `CaseIncomeEntry` | Via `case.tenant_id` |
| `CaseCreditObligation` | Via `case.tenant_id` |
| `EligibilityReport` | Via `case.tenant_id` |

### SUPER_ADMIN Exception

Routes protected by `requireRole('SUPER_ADMIN')` bypass tenant_id filtering. This is intentional for platform-level administration. All such routes are in the `admin.*` route files.

### Wallet Isolation

- Each tenant has exactly one `TenantWallet` record
- All `deductCredits()` calls happen inside a `Serializable` transaction
- The `idempotency_key` on `ApiUsageLog` is `UNIQUE(tenant_id, api_code, idempotency_key)` — this means the same idempotency key can exist across tenants without conflict

---

## 13. API Flow Mapping

### Route File → Controller → Service

| Route File | Mount Path | Purpose |
|------------|-----------|---------|
| `auth.routes.js` | `/api/auth` | Login, JWT |
| `customer.routes.js` | `/api/customers` | Customer CRUD, profile |
| `case.routes.js` | `/api/cases` | Case CRUD, stage updates |
| `bureau.routes.js` | `/api/verification/bureau` | Bureau pull per case |
| `externalApi.routes.js` | `/api/external` | GST, ITR, Bank, PAN pull |
| `document.routes.js` | `/api/documents` | Secure file serving |
| `otp.routes.js` | `/api/otp` | OTP send/verify |
| `admin.lender.routes.js` | `/api/admin/lenders` | Lender/Scheme/Parameter management |
| `admin.wallet.routes.js` | `/api/admin/wallet` | Wallet topup, transaction history |
| `admin.tenant.routes.js` | `/api/admin/tenants` | Tenant management |
| `dsa.wallet.routes.js` | `/api/wallet` | DSA wallet balance |

### Planned New Routes (Phase 1 Extension)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/cases/:id/product-property` | `PUT` | Save product type + property details |
| `/api/cases/:id/income-summary` | `GET` | Computed + manual income |
| `/api/cases/:id/income-entries` | `POST` | Add manual income entry |
| `/api/cases/:id/income-entries/:entryId` | `DELETE` | Remove manual entry |
| `/api/cases/:id/income-summary/confirm` | `PUT` | Mark income reviewed |
| `/api/cases/:id/bureau-obligations` | `GET` | All obligations grouped by applicant |
| `/api/cases/:id/bureau-obligations/sync` | `POST` | Auto-populate from bureau raw response |
| `/api/cases/:id/bureau-obligations` | `POST` | Add manual obligation |
| `/api/cases/:id/bureau-obligations/:id` | `PUT` | Edit obligation (EMI etc.) |
| `/api/cases/:id/esr/generate` | `POST` | Generate + persist ESR |
| `/api/cases/:id/esr` | `GET` | Fetch latest ESR |

### Request/Response Convention

- All authenticated routes require `Authorization: Bearer <jwt>` header
- All responses use `{ success: true, data: {} }` or `{ error: "message" }` format
- Error status codes: 400 (bad request), 401 (unauthorized), 402 (insufficient credits), 403 (forbidden), 404 (not found), 409 (idempotency conflict), 500 (server error)
- 502 is used for upstream provider auth failures (prevents frontend JWT interceptor from logging out)

---

## 14. Migration Safety Strategy

### Why SQL-First (Not Prisma-Only)

Prisma's `migrate deploy` command can generate `DROP TABLE` or `DROP COLUMN` operations when schema models are removed or renamed. In a production database with real customer data, this is destructive and irreversible.

**The rule for this project:** Every schema change follows this sequence:

```
1. Write the SQL manually (ALTER TABLE / CREATE TABLE)
2. Test on staging database
3. Apply to production database manually
4. Update Prisma schema to match
5. Run `prisma generate` ONLY (never `prisma migrate deploy` on production)
6. Run `prisma db pull` to verify schema alignment
```

### Safe Change Patterns

| Change Type | Safety | Method |
|------------|--------|--------|
| Add new table | ✅ Safe | `CREATE TABLE IF NOT EXISTS` |
| Add new column (nullable) | ✅ Safe | `ALTER TABLE ADD COLUMN IF NOT EXISTS` |
| Add new column (NOT NULL with DEFAULT) | ✅ Safe | `ALTER TABLE ADD COLUMN IF NOT EXISTS ... DEFAULT` |
| Add new index | ✅ Safe | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` |
| Add enum value | ✅ Safe (irreversible) | `ALTER TYPE ... ADD VALUE IF NOT EXISTS` |
| Remove column | ⚠️ Risky | Only after all code references are removed, data migrated |
| Remove table | ⚠️ Risky | Only after full data migration |
| Rename enum value | ❌ Dangerous | Requires temp column + data migration + column swap |
| Change column type | ❌ Dangerous | Requires temp column + data conversion + column swap |

### Backward Compatibility

- Deprecated columns (`Case.property_type`, `Case.lender_name`, etc.) are left in place until all code and data is migrated to replacement structures
- New code must write to new tables; reading from old columns is acceptable as fallback
- Mark deprecated columns with a `-- DEPRECATED: use X instead` comment in Prisma schema

### Historical Data Preservation

- `BureauVerificationLog` — immutable audit log of all requests/responses
- `ApiUsageLog` — immutable log of all API calls with status and cost
- `WalletTransaction` — immutable ledger
- No records in these tables should ever be deleted (soft delete only via status fields)

---

## 15. Phase 1 vs Phase 2 Roadmap

### Phase 1 — Current Implementation Target

Schema additions:
- `case_property_details` (single property per case, UNIQUE on case_id)
- `case_income_entries` (manual income rows)
- `case_credit_obligations` (bureau EMI obligations, editable)
- `eligibility_reports` (ESR snapshot with raw_payload JSON)
- `cases.esr_generated` (boolean flag)
- `applicants.name` (display name, missing from current schema)
- New CaseStage values: `INCOME_REVIEWED`, `ESR_GENERATED`
- New LenderProductType values: `WC`, `TL`, `ML`, `BL`

Functionality:
- Wizard Step 3 (Product & Property form)
- Standalone Income Summary page with manual entry
- Bureau & Obligations page with editable EMI rows
- ESR generation and lender display page
- Bureau obligations auto-sync from raw_response
- Mock mode for bureau (BUREAU_MOCK=true) for dev testing

Bugs to fix before Phase 1 goes live:
- `getCaseById` should not write (applicant creation should be a one-time migration)
- `BureauVerification.status` needs a DB-level CHECK constraint
- `CustomerGSTProfile.annual_turnover` should be nullable

### Phase 2 — Future Extensions

Schema additions:
- `eligibility_report_lenders` (normalized per-lender rows instead of raw_payload JSON)
- `case_lender_selections` (formal lender selection with FK to Lender)
- `case_property_details` → remove UNIQUE for multi-property support + add `is_primary`
- Additional CaseStage values for post-sanction pipeline

Functionality:
- Automated FOIR threshold calibration per lender
- ESR caching (avoid regeneration for unchanged cases)
- Eligibility history (multiple ESR versions per case)
- PDD (Pre-Disbursement Document) tracking per case
- Commission tracking per lender disbursement
- Sub-DSA payout calculation
- Advanced audit trail and MIS reports

---

## 16. Future Extension Guidelines

### Adding a New Lender

1. Create a `Lender` record via admin API
2. Create `LenderProduct` records for each supported product type
3. Create `Scheme` records under each product
4. Populate `SchemeParameterValue` for each parameter:
   - Use existing `ParameterMaster` keys where possible
   - Add to `ParameterMaster` first if the parameter is new
5. The ESR engine will automatically include the new lender on the next generation — no code changes needed

### Adding a New API Integration

1. Create a service file in `backend/src/services/externalApis/`
2. Add controller in `backend/src/controllers/external.{name}.controller.js`
3. Add routes in `backend/src/routes/externalApi.routes.js` or a new file
4. Add `ApiPricing` record for the new `api_code`
5. Wrap the call in `walletService.executePaidApi()` for automatic credit deduction, logging, and idempotency

### Adding a New Applicant Type

Currently `ApplicantType` enum has `PRIMARY` and `CO_APPLICANT`. To add a new type (e.g., `GUARANTOR`):

1. `ALTER TYPE "ApplicantType" ADD VALUE 'GUARANTOR'`
2. Update Prisma schema enum
3. Update UI forms to show the new type
4. Update bureau controller to handle the new type
5. Update ESR to decide how to treat guarantor CIBIL in eligibility computation

### Adding New Income Types

`CaseIncomeEntry.income_type` is a free `VARCHAR` — no enum constraint. New income types can be added by:
1. Adding the new option to the frontend dropdown
2. No backend or schema changes required
3. Optionally add a CHECK constraint at DB level if validation is needed

### Adding Multi-Property Support (Phase 2)

1. Remove UNIQUE constraint: `ALTER TABLE case_property_details DROP CONSTRAINT uq_property_case`
2. Add `is_primary BOOLEAN NOT NULL DEFAULT true`
3. Add `CREATE UNIQUE INDEX ON case_property_details(case_id) WHERE is_primary = true` (partial unique index — enforces at most one primary)
4. Update ESR service to `WHERE is_primary = true` when fetching property value
5. Update frontend to show a multi-property list with "Set as Primary" toggle

### Schema Extension Safety Rules

1. **Never drop a column that has non-null data without a migration script**
2. **Never rename a column in production with Prisma migrate** — use SQL column alias then swap
3. **Never change a column from nullable to NOT NULL** without a backfill of all existing nulls
4. **Always add tenant_id validation** to any new service function that touches customer/case data
5. **Always test with `prisma db pull`** after manual SQL changes to confirm Prisma sees the schema correctly

---

*End of Architecture Document*

---

> **Maintenance Note:** This document should be updated whenever:
> - A new table is added to the schema
> - A new API integration is added
> - A new onboarding step is implemented
> - A stage enum value is added
> - A major service refactor occurs
>
> Keep this file committed to the repository root. It is safe to share with any developer or AI assistant as it contains no secrets or credentials.
