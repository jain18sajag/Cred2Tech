# Financial Data Re-triggering & Data Versioning Implementation

This document serves as a reference for the architectural and UI changes needed to support re-triggering of financial data pulls (Bureau, ITR, GST, Bank Statements) and how to manage the lifecycle of previous vs. new data so that the ESR engine always calculates using the freshest data.

## 1. Data Versioning & Archiving Strategy

When a DSA re-fetches data for an existing case, we must preserve the old API logs but ensure the ESR (Eligibility) engine only uses the fresh data. 

**Proposed Approach:**
Instead of hard-deleting old data (which destroys audit trails), we will introduce a soft-archive mechanism.
- **Credit Obligations (Bureau):** When a new Bureau pull succeeds, we will update all existing `CaseCreditObligation` records for that applicant where `source = 'BUREAU'` and set `include_in_foir = false` and `status = 'ARCHIVED'`. The new obligations will be inserted as `ACTIVE` and `include_in_foir = true`.
- **Income Entries (ITR/Bank/GST):** ITR and GST pulls automatically create new records. The ESR engine (`financial.extractor.js`) already correctly picks the latest snapshot for these sources. For bank statements, the `orderBy` should be `desc` to get the latest replaced document.

## 2. API Idempotency Bypass

Currently, the Wallet cache prevents double-charging by blocking duplicate requests. To allow deliberate re-fetching, we must allow the frontend to bypass this cache.

### Required Backend Changes
#### `backend/src/controllers/bureau.controller.js`
- Accept a `force_refresh` boolean in the request body.
- If `force_refresh` is true, append `_${Date.now()}` to the `idempotencyKey` when calling `executePaidApi`. This forces a fresh API call and charges the wallet, while preserving the old cache log for historical record.

#### `backend/src/services/externalApis/experian.service.js`
- Change the `deleteMany` logic for old `CaseCreditObligation`s to `updateMany`. Set `status = 'ARCHIVED'` and `include_in_foir = false`.

#### `backend/src/services/financial.extractor.js`
- Change `orderBy: { created_at: 'asc' }` to `orderBy: { created_at: 'desc' }` when fetching `BankStatementAnalysisRequest` to ensure the most recent bank statement is prioritized.

## 3. Frontend UI Updates

We will standardize the Financial Information page so that all sections look cohesive and offer clear "Re-fetch" mechanisms.

### Required Frontend Changes
#### `frontend/src/pages/AddCustomerWizardPage.jsx` (Bureau Section)
- Change the UI state: If `bureau_fetched` is true, show the "Verified" chip, but also render a **"Re-fetch Bureau"** secondary button next to it.
- Clicking "Re-fetch Bureau" should prompt a confirmation ("Are you sure? This will consume API credits and archive existing obligations.").
- If confirmed, call the `handleRunBureau` method passing `force_refresh: true`.

#### `frontend/src/components/ItrAnalyticsForm.jsx`
- Add a **"Re-fetch ITR"** button to the completed card state.
- Clicking it should set the local state `status` back to `'INITIATED'` and open the expander to let the user trigger a new pull (which natively bypasses idempotency since the backend uses a timestamp).

#### `frontend/src/components/BankStatementUpload.jsx`
- Rename the existing "Replace" button to **"Replace / Re-fetch"** to match the common terminology.

#### `frontend/src/components/GstAnalyticsForm.jsx`
- Wrap the "Initiate New GST Journey" form in a conditional block controlled by a `showNewForm` boolean state.
- Initially hide the form behind a **"+ Start New GST Pull"** button to declutter the UI.
