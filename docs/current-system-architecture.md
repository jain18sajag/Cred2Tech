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
| **Case Detail** | `/customers/:id` | **Implemented** | Profile drill-down with data pull status. |
| **Eligibility Report** | `/cases/:id/esr` | **Implemented** | ESR generation and viewing. |
| **Lender Config** | `/admin/lenders` | **Implemented** | Platform-level lender matrix management. |
| **Wallet Management** | `/admin/wallets` | **Implemented** | Superadmin view of all DSA balances. |
| **Reports & MIS** | — | **Missing** | No dedicated reporting module in current code. |
| **Commission Tracking**| — | **Missing** | No logic or UI for commissions. |
| **Sub-DSA Payout** | — | **Missing** | No payout logic or UI. |
| **Sales Incentive** | — | **Missing** | No incentive logic or UI. |
| **Part Disbursement** | — | **Missing** | No disbursement management logic. |
| **PDD Management** | — | **Missing** | No Post-Disbursement Document logic. |

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
| **Disbursement Flow** | **UI Label Only** | Mentioned in documentation and some UI labels/enums, but no functional logic or tranche management exists. |
| **Financial Tracking** | **Limited** | Backend currently only tracks **API usage credits (Wallets)**. No tracking of actual loan amounts, interest, or payouts. |

---

## 5. Case Lifecycle (Code vs. Intent)

| Stage | Code Status | Reality |
| :--- | :--- | :--- |
| `DRAFT` | Implemented | Initial state in DB. |
| `LEAD_CREATED` | Implemented | Set after product/property selection. |
| `DATA_COLLECTION` | Implemented | Active during API pulls. |
| `INCOME_REVIEWED` | Implemented | Manual step in onboarding. |
| `ESR_GENERATED` | Implemented | Final stage of the technology pull. |
| `Sanctioned` | **Label Only** | Exists in enum/labels but lacks logic for sanction letter ingestion or validation. |
| `Partly Disbursed` | **Missing** | Not in the core backend logic. |
| `Closed` | **Label Only** | No logic for case closure or archiving. |

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

## 7. Configuration Systems

The following are the only functional configuration systems currently in the repository:
1. **Lender Matrix:** Schemes, products, and parameters.
2. **API Pricing:** Global and tenant-specific credit costs.
3. **Lender Contacts:** Per-DSA mapping of lender recipients.
4. **Vendors:** Platform-wide vendor slab management.

---

## 8. Architecture Summary (Honest View)

The current project is a **robust technology-pull and eligibility engine** for MSME loans, but it is **not yet a complete financial management or payout platform**.

- **System Structure:** Modular Express backend, Vite frontend.
- **Module Dependencies:** Centralized around the `Case` and `Tenant` entities.
- **Current Pipeline:** Strong focus on the "Pre-Sanction" phase (Data collection -> Eligibility).
- **User-Role Boundaries:** Technically enforced for DSA users, but "God-mode" exists for SUPER_ADMIN.
