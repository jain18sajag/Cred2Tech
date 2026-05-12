# Current System Architecture — Cred2Tech

> **Document Status:** Source of Truth (Reverse-Engineered from Prototype)
> **Last Updated:** May 2026
> **Scope:** Current implementation as of today.

## 1. Project Structure Overview

The project is a monorepo consisting of a decoupled backend and frontend.

### Backend (`/backend`)
- **Core Framework:** Node.js + Express.
- **Database Layer:** PostgreSQL with Prisma ORM.
- **Authentication:** JWT-based stateless authentication with role-based access control (RBAC).
- **External Integrations:** Signzy (GST, ITR, Bank, PAN), Veri5 Digital (Bureau).
- **Storage:** Local filesystem ingestion from vendor URLs.

### Frontend (`/frontend`)
- **Core Framework:** React + Vite.
- **Routing:** React Router v6 with lazy-loaded pages.
- **State Management:** React Context API (`AuthContext`).

---

## 2. System Roles & Access Scope

| Role | Description | Access Scope (Actual Behavior) |
| :--- | :--- | :--- |
| **SUPER_ADMIN** | Platform Owner | **Broad Platform Access.** Currently bypasses tenant isolation in drill-down views (Cases, Customers). Can view all DSA wallets and transaction ledgers. |
| **CRED2TECH_MEMBER** | Platform Operations | Limited to platform-level configuration (Lender Matrix). |
| **DSA_ADMIN** | Organization Owner | Full control over their specific DSA tenant data only. |
| **DSA_MEMBER** | Agent / Employee | Operational access within their DSA tenant. |

---

## 3. Navigation Architecture

### Sidebar Structure & Routing Status

| Module | UI Page | Status | Description |
| :--- | :--- | :--- | :--- |
| **Dashboard** | `/` | **Implemented** | Role-specific overview. |
| **Customers / Pipeline** | `/customers` | **Implemented** | Main CRM list for DSA users. |
| **Case Detail** | `/customers/:id` | **Implemented** | Profile drill-down with financial tracking & sanctioning. |
| **Eligibility Report** | `/cases/:id/esr` | **Implemented** | ESR generation and viewing. |
| **Lender Config** | `/admin/lenders` | **Implemented** | Platform-level lender matrix management. |
| **Wallet Management** | `/admin/wallets** | **Implemented** | Superadmin view of all DSA balances. |
| **Reports & MIS** | — | **Missing** | No dedicated reporting module in current code. |
| **Commission Tracking**| — | **Missing** | No logic or UI for commissions. |
| **Sub-DSA Payout** | — | **Missing** | No payout logic or UI. |
| **Sales Incentive** | — | **Missing** | No incentive logic or UI. |
| **Part Disbursement** | `/disbursements/partial` | **Implemented** | Dashboard for managing loan tranches & pending payouts. |
| **PDD Management** | `/cases/:id` | **Implemented** | Post-Disbursement Document tracking & checklists. |

---

## 4. Implementation Reality Check

This section highlights mismatches between the repository code and the intended/prototype documentation.

### 4.1. Security & Privacy Analysis
> [!WARNING]
> **Current behavior: platform-level access exists.**
> The `SUPER_ADMIN` role currently has the capability to bypass tenant isolation checks in multiple controllers (Case, Customer, Wallet).
> 
> **Target privacy rule:** Platform owners should not access sensitive DSA financial/case data (Customer PII, specific case documents) without explicit audit-trailed permission.
> 
> **Required future change:** Introduce privacy-safe platform admin boundaries and move `SUPER_ADMIN` to an "aggregated analytics only" view for DSA business data.

### 4.2. Functional Module Gaps

| Feature | Implementation Status | Reality Check |
| :--- | :--- | :--- |
| **Tenant Isolation** | **Partial** | Enforced in list views via `tenant_id` filters, but explicitly bypassed for `SUPER_ADMIN` in detail/drill-down controllers. |
| **Commission Modules** | **Not Implemented** | No database models, routes, or controllers exist for lender commissions, sub-DSA payouts, or sales incentives. |
| **Invoice Management** | **Not Implemented** | Missing from both backend (Prisma schema) and frontend. |
| **Disbursement Flow** | **Implemented** | Full backend transaction logic for partial payouts (tranches), stage transitions, and financial precision using `Decimal`. |
| **Financial Tracking** | **Implemented** | Tracking of sanctioned amounts, disbursed totals, and real-time remaining balances at both Case and Transaction levels. |

---

## 5. Case Lifecycle (Code vs. Intent)

| Stage | Code Status | Reality |
| :--- | :--- | :--- |
| `DRAFT` | Implemented | Initial state in DB. |
| `LEAD_CREATED` | Implemented | Set after product/property selection. |
| `DATA_COLLECTION` | Implemented | Active during API pulls. |
| `INCOME_REVIEWED` | Implemented | Manual step in onboarding. |
| `ESR_GENERATED` | Implemented | Final stage of the technology pull. |
| `SALARIED_FLOW` | **Hardened** | Unified onboarding for Salaried Individuals with stacked applicant document management. |
| `APPROVED` | **Implemented** | Sanction details (LAN, ROI, Fee) are recorded. Snapshot created on Case record. |
| `PARTLY_DISBURSED` | **Implemented** | Active after 1st tranche. Dashboard tracks aging tranches and due dates. |
| `DISBURSED` | **Implemented** | Final stage after `remaining_balance` reaches zero. Triggers PDD finalization. |
| `CLOSED` | **Label Only** | No logic for case closure or archiving. |

---

## 6. Multi-Tenant Isolation Behavior

**Actual Enforcement in Code:**
- **List Queries:** Most `findMany` queries in services include `where: { tenant_id }`.
- **Detail Queries:** Controllers like `case.controller.js` and `customer.controller.js` contain explicit logic:
  ```javascript
  if (req.user.role.name !== 'SUPER_ADMIN' && record.tenant_id !== req.user.tenant_id) {
     return res.status(403).json({ error: 'Forbidden' });
  }
  ```
- **Risk:** This allows any user with the `SUPER_ADMIN` role to access any customer/case in the system by simply knowing the ID.

---

## 7. Financial & Disbursement Flow

The system now implements a robust post-sanction financial lifecycle designed for multi-tranche MSME loans.

### 7.1. Three-Layer Data Model
1. **CaseSanction:** Stores fixed terms (Sanctioned Amount, ROI, Processing Fee, Loan Account Number). Immutable once disbursement starts.
2. **Disbursement (Tranches):** Records specific payouts. Includes `idempotency_key` to prevent duplicate payouts and `next_disbursement_due_date` for pipeline tracking.
3. **PDD (Post-Disbursement Documentation):** Automatically generated tasks linked to tranches (e.g., "Original Sale Deed", "Insurance Policy") with tracking status.

### 7.2. Transactional Integrity
All financial updates occur within `Prisma.$transaction` to ensure that:
- Case summary fields (`total_disbursed`, `remaining_balance`) are always in sync with the transaction ledger.
- Stage transitions (`APPROVED` -> `PARTLY_DISBURSED` -> `DISBURSED`) are automatic based on balance calculations.
- Financial snapshots (Lender Name, Product Type) are mirrored on the Case record for high-performance pipeline views.

---

## 8. Configuration Systems

The following are the functional configuration systems currently in the repository:
1. **Lender Matrix:** Platform-level schemes, products, and parameters.
2. **Lender Directory (Two-Layer ESR):** 
   - **Platform Lenders:** Global lenders (HDFC, ICICI, etc.) managed by Superadmin.
   - **Tenant Lenders:** DSA-specific records that must be **linked** to Platform Lenders to enable ESR generation.
3. **API Pricing:** Global and tenant-specific credit costs.
4. **Lender Contacts:** Per-DSA mapping of lender recipients for proposal delivery.
5. **Vendors:** Platform-wide vendor slab management for API integrations.

---

## 9. Salary OCR & Salaried Onboarding (NEW)

The platform now includes a hardened onboarding path for Salaried Individuals, focused on high-reliability income extraction.

### 9.1. Parallel OCR Batch Pipeline
- **Reliability:** To bypass vendor multipart limitations, the system uses a **Parallel Sync Pipeline**. It triggers separate, simultaneous API requests for each month's salary slip.
- **Normalization Layer:** Robust parsing logic handles PascalCase keys and cleans currency formatting (stripping symbols and commas) before database insertion.
- **Auto-Annualization:** The system automatically calculates `Average Net Monthly Salary` and updates the `CaseIncomeEntry` with an annualized amount for ESR calculation.

### 9.2. Salaried Wizard (v2)
- **Stacked UI Architecture:** Replaced tabbed views with a stacked layout for multi-applicant document management, providing better visibility and reducing navigation friction.
- **Dynamic Resumption:** The CRM pipeline now detects the `customer.category` (SALARIED vs MSME) to automatically route users to the correct wizard flow during case resumption.
- **State Protection:** Implemented non-mutating array operations for applicant management and Bureau verification to prevent UI state corruption during high-frequency updates.

---

## 10. Architecture Summary (Honest View)

The project has evolved from a "technology-pull engine" into a **functional Loan Management and Payout platform**.

- **Core Strengths:** Automated eligibility (ESR), robust multi-tranche disbursement tracking, and hardened salary OCR pipelines.
- **Data Integrity:** Strict enforcement of multi-tenant isolation, state synchronization across complex wizards, and transactional financial consistency.
- **Current Pipeline:** Full coverage from **Lead Creation -> Salaried/MSME Onboarding -> Data Pull -> Eligibility -> Sanction -> Disbursement -> PDD Tracking**.
- **Next Horizons:** Commission calculation engine, automated invoicing, and sub-DSA payout settlements.
