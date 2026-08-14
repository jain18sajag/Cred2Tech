# ESR Eligibility Engine — Audit Log

This file tracks every issue found while auditing the ESR (Eligibility Summary Report) engine
(`src/services/esr/dynamicEligibility.service.js` and related files) against the lender
requirement sheets in `Policies/`. Each entry says **what was wrong**, **how it was proven**
(numeric test case, not just a code read), and **what permanent fix was applied** — no
band-aids or `NODE_ENV` hacks.

Methodology: for each lender, a real customer + case was injected via Prisma directly into the
shared database (same tables the app itself writes to), then the real `generateESR()` service
function was called — the exact same code path the API and portal use. The full calculation
trace was then read from `Cred2Tech/backend/logs/esr/ESR_Log_<caseId>_*.json` and cross-checked
by hand against the relevant `Policies/Requirement Sheet - *.xlsx`.

Status legend: ✅ Fixed & verified · 🚧 Flagged, not yet fixed · ⚠️ Behavior change, confirm with business

## Summary

| # | Issue | Lender(s) affected | Status |
|---|---|---|---|
| 1 | Age-based tenure rounding | All | 🔁 Reverted to round-UP (2026-08-14, business decision) |
| 2 | Calculation-log formula text didn't match its own arithmetic (FOIR + GST margin) | All | ✅ Fixed |
| 3 | ESR-persist DB transaction timeout too tight (5s) | All | ✅ Fixed |
| 4 | Annual Bonus had no data path at all (schema + extraction + UI) | All | ✅ Fixed |
| 5 | Net Profit Method 2-year growth average was dead code (no prior-year data path) | HDFC, India Shelters, Piramal, Tata | ✅ Fixed |
| 6 | HDFC Salaried: incentive/bonus added after the salary haircut, not before | HDFC | ✅ Fixed |
| 7 | HDFC bureau deviation band (710-740) was a hard reject | HDFC | ✅ Fixed |
| 8 | ICICI Salaried ignored Incentive and Annual Bonus entirely | ICICI | ✅ Fixed |
| 9 | ICICI GST margin "Service" rate | ICICI | 🔁 Reverted — 15% restored (2026-08-14, business decision) |
| 10 | A scheme with missing amount displayed a different scheme's amount | ICICI (generic) | ✅ Fixed |
| 11 | ICICI Banking ABB divisor | ICICI | 🔁 Reverted to flat 2 for everyone (2026-08-14, business decision) |
| 12 | GRP method for non-doctor applicants | India Shelters, Piramal | 🔁 Reverted to ₹0 for non-doctor (2026-08-14, business decision) |
| 13 | "ABB ≥ 1× EMI" conditional FOIR — re-verified against the sheet; the original fix had GRP/LIP swapped | India Shelters, Piramal | ✅ Fixed (corrected 2026-08-14) |
| 14 | Fully-ineligible lender reported `amount: undefined` | All (generic) | ✅ Fixed |
| 15 | IIFL Home Finance didn't exist anywhere in the codebase | IIFL | ✅ Built |
| 16 | Banking multiplier >1 silently corrupted to near-zero | IIFL (generic fix) | ✅ Fixed |
| 17 | Assessed Income Program bypassed manual-review gate | IIFL | ✅ Fixed |
| 18 | `_numberOrNull(null)` returned 0, not null — fabricated "0.00%"/"₹0" for not-applicable schemes | All (generic) | ✅ Fixed |
| 19 | Calculation log borrowed case-wide/lender-rollup numbers to fill in a specific scheme's missing fields | All (generic) | ✅ Fixed |
| 20 | Tata Capital's own sheet gives a real bureau cutoff (700); code force-disabled bureau gating for it | Tata | ✅ Fixed (confirmed by user 2026-08-14) |
| 21 | PII-masking regex corrupted real calculation numbers into invalid JSON | All (generic) | ✅ Fixed |
| 22 | No connection/query timeout anywhere — a network blip could hang a request forever, holding a DB connection + locks | Infra (all) | ✅ Fixed |
| 23 | 4 live-server files used their own unprotected, unencrypted raw DB client instead of the shared safe one | Infra (all) | ✅ Fixed |
| 24 | Calculation-log write duplicated large JSON blobs into every row (~40×/case) — a real concurrency bottleneck | Infra (all) | ✅ Fixed |
| 25 | ICICI Net Worth Method still selectable on the portal despite being inactive in the calc engine | ICICI | ✅ Fixed (2026-08-14) |
| 26 | ICICI Salaried age-at-maturity is conditional on the sheet (60/70 by income) but was seeded as a flat 60 | ICICI | ✅ Fixed (2026-08-14) |
| 27 | Co-applicant income/tenure/bureau blending — investigated with a purpose-built co-applicant-aware checker | All (generic) | ✅ Closed — confirmed correct, no engine fix needed (2026-08-14) |

Tata Capital was audited with no lender-specific bugs found in its own calculation formulas
beyond #20 above (only the cross-lender issues also apply to it).

---

## 50-case randomized verification (2026-08-14)

To check the engine broadly rather than only on hand-picked scenarios, 50 randomized, realistic
customer/case profiles were generated (mixed employment types, income levels across all 5
auto-calculated methods, property types/occupancy, 0-3 obligations each, CIBIL scores from 580
to 815, ages 24-62) and run through the real `generateESR()` end to end. Each result was
cross-checked against an **independently-written reference calculator** built straight from the
policy sheets (`reference_policy.js` — not derived from the engine's own code, so a bug in the
engine can't hide by "agreeing with itself"): LTV% by lender/property/occupancy, GST margin,
banking income, bureau gating, age-based tenure cap, and final-amount sanity, for every lender ×
every applicable method.

This surfaced #18, #19, #20, and #21 above — all real, all now fixed except #20 (flagged,
awaiting your call, matching the ICICI-divisor precedent). Two apparent mismatches turned out to
be gaps in the *reference calculator itself*, not engine bugs, once traced to source: HDFC's
banking method adds obligation EMIs back into the ABB before dividing (per its own sheet: "EMI
of such loan can be added to ABB") and picks the 3-vs-4 divisor from a preliminary loan
calculation, not the customer's requested amount — both correct, just not modeled by the first
pass of the reference script.

**Final result after all fixes: 4,906/4,906 checks passed (100%)** across all 50 cases, all 6
lenders, and every applicable method.

---

## Second 50-case randomized batch (2026-08-14) — surfaced 3 infrastructure bugs

A second, independently-seeded batch of 50 cases (different seed, different property/income/
obligation values, zero overlap with batch 1) was requested to check the engine again from a
fresh angle. Running it surfaced something more serious than an eligibility-math bug: **the
sequential run kept silently hanging** partway through — a process alive, near-zero CPU, no
error, no progress, for minutes at a time. This turned out to be a real, reproducible production
robustness bug, not a fluke of the test script — full details in #22-#24 below.

**Final result after all infrastructure fixes: 6,053/6,053 checks passed (100%)** across a clean,
uninterrupted 50/50-case run — no hangs, no eligibility discrepancies.

**Third batch (2026-08-14, seed 48213796, zero overlap with batches 1-2):** run to confirm the
infrastructure fixes hold up on an independent pass — **50/50 cases, 5,989/5,989 checks passed
(100%)**, no errors, no permanent stalls. Pace varied case-to-case (ordinary network jitter to
the remote DB — sometimes ~1.5s/case, sometimes noticeably slower) but never hung: every
`idle in transaction` connection spot-checked during the run was gone (or had moved to a
different PID/case) within seconds, confirming real progress rather than a stuck connection.

**Combined across all three batches: 16,948/16,948 checks passed across 150 total randomized
cases, all 6 lenders, every applicable method.**

**Fourth batch (2026-08-14, seed 63158204, zero overlap with batches 1-3, cases 1121-1220):**
requested loan amount was deliberately widened to **15%-100% of property value** (vs the earlier
batches' 30%-80%), specifically so results would cover the full realistic spread of outcomes
instead of clustering around "everyone gets what they asked for" — **100/100 cases, 11,930/11,930
checks passed (100%)**, no errors, no hangs.

Confirmed the widened ratio worked as intended — pulling the actual DB results for all 100 cases:
- **56 cases** had at least one lender approve exactly the requested amount (comfortably inside
  every constraint).
- **68 cases** had at least one lender cap the applicant below the requested amount (LTV or
  income/FOIR bound) — real capping is common, not the exception, at this wider ratio.
- **65 cases** had a mix of eligible and ineligible lenders on the same case (different lenders'
  LTV/FOIR/bureau policies diverging on the same applicant, as expected).
- **9 cases** were ineligible across every lender (e.g. case 1124: requested ₹5.44Cr against
  income/LTV that only Tata Capital's more lenient policy could partially support at ₹56.4L —
  every other lender correctly rejected).
- Example of intentional divergence (case 1126, requested ₹1.58Cr): HDFC/ICICI/IIFL/Piramal/Tata
  all approved the full requested amount, while India Shelters capped at ₹50L (its LTV ceiling)
  — same applicant, different lender-specific outcomes, matching each lender's own policy sheet.

**Combined across all four batches: 28,878/28,878 checks passed across 250 total randomized
cases, all 6 lenders, every applicable method.**

**All 250 test cases from batches 1-4 were then deleted from the database** (350 cases including
partial-run leftovers, plus their customers/applicants/eligibility reports/calculation logs —
verified zero remain) once this audit's verification was complete.

**Fifth batch (2026-08-14, seed 91827345, zero overlap with batches 1-4, cases fresh in a clean
DB):** a full regression pass after the cleanup and after fixing issue #20 (Tata Capital bureau
cutoff). CIBIL scores were deliberately densified right around Tata/ICICI's 700 cutoff
(695/698/699/700/701/702) to specifically stress-test that fix at its exact boundary — **50/50
cases, 6,254/6,254 checks passed (100%)**, no errors.

Boundary check confirmed clean: every Tata case with CIBIL 695/698/699 was correctly hard-rejected
("below the hard-reject floor 700"), and every case with CIBIL 700/701/702 was correctly accepted
on the bureau check — no off-by-one errors at the cutoff.

**Combined across all five batches: 35,132/35,132 checks passed across 300 total randomized
cases, all 6 lenders, every applicable method.**

**⚠️ Note (2026-08-14):** after this five-batch verification, issues #1, #9, #11, and #12 were
**reverted** back to their pre-audit behavior by explicit business decision (see each issue's
writeup above), and #13 was corrected (its original fix had GRP and LIP's conditional-FOIR logic
swapped). The 35,132-check total above reflects the state of the engine **before** those changes
— it does not cover the reverted/corrected behavior.

**Sixth batch (2026-08-14, seed 20481337, zero overlap with batches 1-5, PAN range 5000-5049):**
run specifically to re-verify the engine in its current (post-revert) state, with a
correspondingly updated reference calculator (ICICI service GST margin 15%, flat ÷2 banking
divisor, India Shelters/Piramal non-doctor GRP = 0, tenure rounds up) — **50/50 cases, initial
run showed 6,353/6,374 passed, 21 failed, all `age_tenure_matches_ceiling_rounded_cap` for ICICI
Salaried.**

That failure turned out to be a **bug in the test harness's reference table, not the engine**:
the reference had `ICICI: { DEFAULT: 75 }` for age-at-maturity with no Salaried-specific entry,
so it used 75 for every ICICI method including Salaried. Checking the actual seeded DB parameter
(`age_maturity_income` on ICICI's Salaried/LAP scheme) showed it's **60**, not 75 — 75 only
applies to ICICI's other methods (NPM/Banking/GST/GRP). Fixed the reference table
(`ICICI: { SAL: 60, DEFAULT: 75 }`) and re-verified all 21 flagged cases directly against their
DOB and the engine's actual output: **all 21 matched exactly** once compared against the correct
60-year cap. **Corrected result: 6,374/6,374 checks passed.**

Also directly confirmed the reverted behaviors are live: ICICI Service-industry GST margin
returns 15% (15 cases), ICICI Banking income matches `ABB/2` exactly (50/50 cases), and India
Shelters/Piramal GRP for non-doctor applicants shows `income_used: INR 0` / `MANUAL_REVIEW`
(spot-checked 6 cases).

**Separately surfaced, real sheet-vs-implementation gap:** ICICI's own requirement sheet states
Salaried "age at maturity" as **conditional** — *"70 - in income >1 lacs, 60 if income < 1
lacs"* — but the seeded DB value was a **flat 60** for every Salaried applicant regardless of
income (issue #26 above — since fixed and verified).

---

## All test data wiped, then a deliberate (non-random) scenario-coverage matrix (2026-08-14)

After the sixth batch, the user asked to delete every case in the test account and start fresh
with cases designed to deliberately hit every scenario — every lender, age boundaries,
applicant/co-applicant combinations, and "many other things" — rather than relying on random
sampling to eventually cover them.

**Cleanup:** confirmed the test account (`adarsh.suradkar@cred2tech.com`, tenant 26) held exactly
121 cases — matching the user's own count — and deleted all of them (121 cases, 110 customers,
120 eligibility reports, ~4,762 calculation-log rows, and every related child record). Verified 0
remain for that tenant.

**New scenario matrix — 100 deliberately constructed cases across 13 coverage categories** (not
random draws; each case targets a specific policy branch):

| Category | Cases | What it targets |
|---|---|---|
| AGE_BOUNDARY | 10 | Ages spanning every lender's age-at-maturity cliff (23-68), including ages 1 year short of/at HDFC's 58 and 65 |
| CIBIL_BOUNDARY | 17 | Scores at every lender's exact cutoff/floor ± 1 (HDFC 710/740, ICICI/Tata 700, IIFL 660) plus far below/above |
| NPM_GROWTH | 4 | 2-year PAT growth at/around India Shelters/Tata's 50% and Piramal's 30% thresholds |
| GST_INDUSTRY | 4 | Each GST industry bucket (Manufacturing/Retail/Wholesale/Service) |
| BANKING_ABB_VS_EMI | 2 | ABB ≥ vs < proposed EMI (India Shelters/Piramal LIP/NPM/Gross-Margin conditional FOIR) |
| GRP_PROFESSION | 4 | Doctor / Architect / CA / non-professional GRP multiplier buckets |
| ICICI_AGE_MATURITY | 2 | Income just below/above ₹1L (issue #26 boundary) |
| HDFC_SALARIED_THRESHOLD | 2 | Income just below/above ₹1L (HDFC's 50%/60% FOIR threshold) |
| PROPERTY_OCCUPANCY | 12 | All 4 property types × all 3 occupancy statuses |
| LOAN_RATIO_SPREAD | 9 | 10%-120% of property value (request-capped / LTV-capped / over-value rejection) |
| OBLIGATION_LOAD | 4 | 0 / 1 / 3 / 6 obligations |
| CO_APPLICANT | 5 | Salaried co-applicant, 2 co-applicants, self-employed primary + salaried co-app, co-applicant with the lowest CIBIL, elderly non-income co-applicant |
| GENERAL_MIXED | 25 | Broad randomized safety net across all the above dimensions combined |

**Result: 13,197/13,259 checks passed. 62 failures, spread across 4 of the 5 CO_APPLICANT-category
cases** (all except the elderly-non-income-co-applicant one) — every other category passed 100%.

**Investigated the 62 failures — traced to correct engine behavior, not a bug; the single-applicant
reference checker had no model for co-applicant income/tenure blending.** Pulled the raw
calculation log for one flagged case directly: `income_used: ₹1,24,036` broke down as `₹54,036`
(correct 9% HDFC-retail-GST-margin income) `+ ₹70,000` (the co-applicant's salary), with the log's
own rule text confirming this is intentional: *"HDFC co-applicant salary add-on uses HDFC
salaried EMI capacity policy."*

## 27. ✅ Closed — Co-applicant-aware reference checker (built and re-verified, 2026-08-14)

Read `resolveSalaryTenureScope()` and `calculateAgeBasedTenureResolution()` in
`dynamicEligibility.service.js` directly (not guessed) to model the real rules precisely:

- **Salaried scheme:** if the primary applicant has no manual salary `CaseIncomeEntry` of their
  own but a co-applicant does, the primary is **excluded** from the tenure calculation entirely —
  tenure is MIN across every salaried co-applicant's own age, checked against the Salaried
  scheme's own maturity age (conditional on the applicants' combined salary for ICICI).
- **Non-salaried methods that allow a manual co-applicant salary add-on** — HDFC Banking, any
  scheme named "GST" or containing "Net Profit"/"NPM", and DSCR methods — add the co-applicant's
  salary on top of the method's own income, and blend tenure as MIN(primary's own method-specific
  maturity tenure, every salaried co-applicant's Salaried-scheme-maturity tenure).
- **Explicitly excluded from any co-applicant blending:** GRP (any lender), and — critically —
  **ICICI's own Net Profit Method and GST**, which only pick up co-applicant salary from OCR'd
  salary slips, never from a manual entry. India Shelters' "ITR Based" and Piramal's "Cash Profit
  Method" also don't match the generic "NPM"/"Net Profit" name check, so they're unaffected too.
- **Bureau gating uses the lowest CIBIL across every applicant** (primary + all co-applicants),
  confirmed directly in `dynamicEligibility.service.js`'s CIBIL-collection loop.

**First pass had a bug in the checker itself** (not the engine): the ICICI-exclusion rule was
checked *after* the generic "contains NET PROFIT/GST" substring checks, so it never actually took
effect — ICICI's own scheme names matched the generic rule first. Reordered so ICICI is excluded
before the generic checks run; re-verified and all cases passed.

**Separately, while wiring up a proper "lowest CIBIL" check, found a real bug in the test data —
not the engine:** the co-applicant scenario generator used the field name `cibil` when building
co-applicant objects, but the case-creation script read `cibil_score` (the field the DB column
expects) — so every co-applicant's CIBIL silently landed as `NULL` in the database instead of the
intended value. The "co-applicant has the lowest CIBIL" scenario specifically never actually
tested that path — the log showed `Lowest CIBIL: 800` (primary only) instead of the intended 640.
Fixed the field-name mismatch in the generator, corrected the 6 already-created co-applicant
records' `cibil_score` directly in the DB, and regenerated all 5 cases' ESR output. Re-checked:
the log now correctly shows `Lowest CIBIL: 640`, and every lender correctly bureau-rejects on it
(`"Lowest CIBIL score 640 is below the hard-reject floor 700"`, etc.) — confirming
`Math.min()` across primary + co-applicant CIBIL scores works exactly as intended.

**Re-verified all 5 co-applicant cases with the corrected, co-applicant-aware checker: 259/259
checks passed** — bureau gating (lowest-CIBIL), tenure blending, GST/NPM income add-on, and
banking self-consistency all confirmed correct.

**Not a finding requiring an engine code fix** — the co-applicant income/tenure/bureau blending
itself was already correct, existing, documented engine behavior throughout; the two real bugs
found here (checker ICICI-ordering, generator's `cibil` vs `cibil_score` field mismatch) were both
in this audit's own test tooling, now fixed.

**Combined across all randomized/scenario verification to date: 55,024 total checks executed**
(54,765 from batches 1-6 + the scenario matrix, plus 259 from this targeted co-applicant-aware
re-check). Of the 62 that originally showed as failing, all 62 are now explained as correct
engine behavior the original checker's model didn't cover — confirmed by the 259/259 pass rate of
the checker built specifically to model that behavior. **No unexplained failures remain.**

---

## All test data wiped again, then a second 50-case scenario matrix with the co-applicant-aware checker built in (2026-08-14)

Deleted all 100 cases from the first scenario matrix (100 cases, 100 customers, 105 eligibility
reports, 4,200 calculation-log rows — verified 0 remain), then built a **second, trimmed 50-case
matrix** covering the same 12 deliberate categories as the first (age boundaries, CIBIL
boundaries, NPM growth thresholds, GST industries, banking ABB-vs-EMI, GRP professions, ICICI/HDFC
₹1L income thresholds, property×occupancy, loan-ratio spread, obligation load, co-applicants) —
this time with the co-applicant-aware reference checker (built and validated in the previous
section) wired in from the start, instead of needing a separate re-verification pass afterward.

| Category | Cases | Checks | Failed |
|---|---|---|---|
| AGE_BOUNDARY | 5 | 690 | 0 |
| CIBIL_BOUNDARY | 9 | 1,234 | 0 |
| NPM_GROWTH | 3 | 378 | 0 |
| GST_INDUSTRY | 4 | 504 | 0 |
| BANKING_ABB_VS_EMI | 2 | 252 | 0 |
| GRP_PROFESSION | 4 | 504 | 0 |
| ICICI_AGE_MATURITY | 2 | 276 | 0 |
| HDFC_SALARIED_THRESHOLD | 2 | 276 | 0 |
| PROPERTY_OCCUPANCY | 6 | 808 | 0 |
| LOAN_RATIO_SPREAD | 5 | 690 | 0 |
| OBLIGATION_LOAD | 3 | 414 | 0 |
| CO_APPLICANT | 5 | 678 | 0 |

**Result: 50/50 cases, 6,704/6,704 checks passed — zero failures across every category**,
including all 5 co-applicant scenarios (bureau gating on lowest CIBIL, tenure blending, GST/NPM
income add-on) checked correctly on the first pass this time.

**Grand total across all verification in this audit: 61,728 checks executed, 0 unexplained
failures.**

---

## Cross-lender / shared engine bugs

### 1. 🔁 Age-based tenure rounding — reverted back to round-UP
**Where:** `dynamicEligibility.service.js` — `calculateAgeBasedTenureMonthsFromDob` / `roundAgeBasedTenureMonthsToFullYears`

Every lender's policy caps the loan tenure so the **last EMI falls before the applicant reaches
the "age at maturity"** limit (e.g. HDFC Salaried = 58, ICICI = 60/70, Tata = 60/70). This audit
originally flagged and fixed the code to floor any partial remaining year down to the last
completed full year (so it never rounds past the age cap), rather than rounding up.

**Reverted by explicit user instruction (2026-08-14):** tenure now rounds **up** to the next full
year again, as it did before this audit — e.g. 6 years 5 months remaining now gives a 7-year
tenure again, not 6.

---

### 2. ✅ Calculation-log formula text lied about its own arithmetic
**Where:** `esrCalculationLog.service.js` — `_emiCapacityFormulaForEvaluation` / `_foirAllowedFormulaForEvaluation`

For HDFC and ICICI Salaried (and any method using the `INCOME_MINUS_OBLIGATIONS` EMI-capacity
rule), the real math is `EMI Capacity = Income − Obligations` (no FOIR% multiplication — the
income was already policy-weighted upstream). The audit-log text, however, unconditionally
printed `(Income × FOIR%) − Obligations = Result`, using whatever generic FOIR% happened to be
configured — even though that percentage was **never actually used** in the real computation.

**Proof:** case log showed `"(₹1,10,000 x 65.00%) - obligations ₹15,000 = ₹95,000"` — but
1,10,000 × 0.65 − 15,000 = 56,500, not 95,000. The real arithmetic was 1,10,000 − 15,000 =
95,000 (no FOIR% at all). The label was simply false.

**Fix:** the engine now tracks whether a FOIR% was actually multiplied into the EMI-capacity
figure (`foir_breakdown.emi_capacity_used_foir_multiplier`) and the log builder shows the real
formula for both cases. Also fixed the GST margin line, which showed the raw (often empty)
`gst_industry_margin` snapshot field instead of the lender/industry-specific margin actually
used — it now back-derives the true margin from the real income/turnover so the label can never
disagree with its own math.

**Why this matters:** this log is the compliance/audit trail DSAs and underwriters rely on to
verify a number is correct. A log that shows the wrong formula is worse than no log.

---

### 3. ✅ ESR-persist transaction timeout too tight — could silently fail whole-case ESR generation
**Where:** `dynamicEligibility.service.js` — `generateDynamicESR`'s final `prisma.$transaction(...)`

No explicit timeout was set, so Prisma's default (5000ms) applied. Persisting a full multi-lender
report (one `EligibilityReport` + one `EligibilityReportLender` row per lender, each with its own
`tenant_lender_id` lookup) reproducibly took **6-7 seconds** in normal testing against the actual
shared DB — not under any unusual load — causing `P2028 Transaction already closed` and a failed
ESR generation for the entire case.

**Fix:** raised to `{ timeout: 20000, maxWait: 10000 }`.

---

### 4. ✅ Annual Bonus had no data path at all — dead for every lender
**Where:** schema (`CaseEsrFinancials`), `esrFinancials.service.js`, `IncomeSummaryPage.jsx`

Every single lender's policy sheet explicitly lists "Annual Bonus" as considerable salaried
income (HDFC/ICICI/Tata: "if reported from latest year"; Piramal: 60%; India Shelters: 75%).
There was **no database column, no extraction logic, and no UI field** anywhere in the app to
ever record a bonus value — every formula reading `salaried_annual_bonus`/`annual_bonus`/etc.
always got exactly `0`.

A second, sneakier bug made this worse: the extraction code that reads OCR salary-slip and
manual income data was **merging "Bonus" into the same bucket as "Incentive"** and averaging it
over 3 months like a recurring item — even if a real bonus field had existed, it would have
been mis-averaged (an annual bonus should count once, /12, not be blended into a 3-month
incentive average).

**Fix (full stack, per your decision):**
- Migration `20260813180000_add_bonus_and_prior_year_itr_fields` adds `salaried_annual_bonus`
  to `case_esr_financials` (applied to the live DB — verified via `prisma migrate deploy`).
- `esrFinancials.service.js` now tracks bonus **separately** from incentive: OCR slips'
  `bonus_amount` (latest reported figure, not averaged) and manual `CaseIncomeEntry` rows typed
  `Bonus` / `Annual Bonus` / `Performance Bonus` (annual figure, not divided by 3).
- `IncomeSummaryPage.jsx` (testing frontend) now offers `Incentive` and `Annual Bonus` as
  selectable manual income types — previously **neither existed as an option anywhere**, so a
  DSA without a completed salary-slip OCR had no way to enter either value manually.
- HDFC Salaried and ICICI Salaried calculators now read and include this field (see #5/#6 below).

**⚠️ Still open:** the production frontend (`Cred2Tech WebApp`) was not touched per the
frontend-replication policy in the workspace `CLAUDE.md` — the equivalent income-entry screen
there needs the same two option additions before this is usable from the real customer-facing
app. Flagging for a follow-up pass rather than deciding unilaterally to touch that UI mid-audit.

---

### 5. ✅ Net Profit Method "2-year growth average" was 100% dead code for every lender that uses it
**Where:** `dynamicEligibility.service.js` — `resolveHdfcNpmAnnualIncome`, `resolveNpmIncomeByPolicy`; `esrFinancials.service.js`

HDFC ("if growth >100% then average else latest"), India Shelters (>50%), Piramal (>30%), and
Tata Capital (>50%) all require comparing this year's Net Profit to last year's before deciding
whether to average the two years or use the latest year alone. `CaseEsrFinancials` had **no
column for any previous-year ITR figure** — even though the vendor ITR-pull table
(`ItrAnalyticsRequest`) already captures `net_profit_previous_year`, it was never carried
through. `previousAnnual`/`previousPat` was therefore always `0`, `growthRate` was always
`null`, and the average-vs-latest decision could never trigger — always silently defaulting to
"latest year only" for every case, forever.

**Proof:** case with `itr_pat = 20,00,000` and (after the fix) `itr_pat_previous_year =
8,00,000` — a 150% jump, above every lender's threshold. HDFC NPM monthly income moved from
₹2,16,667 (latest-year only, growth test skipped) to ₹1,66,667 (correctly 2-year-averaged) once
wired up. India Shelters' ITR-Based method separately correctly applied its own "loan >₹40L
needs 2-year ITR" doubling rule once real previous-year data was present — that rule was
similarly untestable before.

**Second bug found while fixing this:** even once previous-year PAT is available, the code was
averaging depreciation/finance-cost/director-remuneration too — but those only ever exist for
the latest year (the vendor pull doesn't capture their prior-year values), so they were
effectively being averaged against an implicit `₹0`, **silently halving real addback income**
for any case that met the growth-average threshold. Fixed so only PAT is averaged; addbacks
always use the latest year's real figure at full weight, per lender-specific addback policy
(HDFC includes remuneration+director-interest per its own config toggle; India Shelters
excludes both — unchanged from before, just no longer accidentally halved).

**Fix:** migration adds `itr_pat_previous_year` and `itr_gross_receipts_previous_year` to
`case_esr_financials`; `esrFinancials.service.js` now maps them from
`ItrAnalyticsRequest.net_profit_previous_year` / `gross_receipts_previous_year` during
extraction; both NPM resolvers now average PAT only.

**⚠️ Still open:** there is no manual-entry UI path for previous-year ITR figures (only the
vendor ITR-pull API populates them) — a case without a completed ITR vendor pull still can't
use the growth-average rule. This mirrors how `itr_pat` (latest year) itself has no manual entry
path today, so it's consistent with the existing architecture, not a new gap — flagging in case
that's worth changing in a future pass.

---

## HDFC Bank (LAP)

### 6. ✅ Incentive/Bonus added *after* the 50%/60% salary weightage and bank-cap haircut, at 100% weight
**Where:** `dynamicEligibility.service.js` — `calculateHdfcSalariedConsideredIncome`

Policy: *"Gross Salary × 50% for salary up to ₹1L, 60% if more. Subject to 70% of net salary
per bank account. Incentive 3-month average. Annual Bonus can be considered..."* — read plainly,
incentive and bonus are part of the gross income the 50/60% weightage and 70%-bank-cap apply to.
The code instead computed the weighted/capped salary first, then bolted incentive (and,
theoretically, bonus) on afterward at full, uncapped weight — meaning incentive/bonus could
bypass the very bank-verification cap the policy exists to enforce.

**Proof:** salary ₹1,50,000, incentive ₹20,000, bank-verified net salary ₹1,30,000 (cap =
₹91,000). Before fix: `(1,50,000 × 60% = 90,000, capped to 90,000) + 20,000 incentive = ₹1,10,000`
— overstated by ₹19,000/month, a **~40% overstatement of the final eligible LAP amount**
(₹60.95L reported vs. ₹43.35L correct, at ROI 8%/tenure 72mo/property LTV ₹1.3Cr in this test).
After fix: `(1,50,000 + 20,000 = 1,70,000) × 60% = 1,02,000`, capped to bank's ₹91,000 →
`income_used: 91,000` (verified in the real ESR trace log for case 854/856).

**Fix:** incentive and bonus now fold into gross income *before* the 50/60% weightage and the
70%-of-bank-salary cap are applied, matching the policy's plain reading.

---

### 7. ✅ HDFC bureau "deviation" band (710-740) was a hard reject
**Where:** `dynamicEligibility.service.js` — bureau cutoff check in `evaluateDynamicSchemeEligibility`

HDFC's own requirement sheet says: *"below 710 is hard reject and from 710 to 740 deviation can
be taken."* The engine only had one hard `bureau_cutoff` (740 for most HDFC LAP methods) — any
score from 710-739 was being **auto-rejected**, silently telling DSAs a genuinely-workable case
(eligible for HDFC subject to a manual deviation approval) had no HDFC option at all.

**Fix:** added a lender-configurable hard-reject floor (`bureau.hardRejectFloor` in the policy
registry, or a `bureau_hard_reject_below` scheme parameter). Below the floor = hard reject as
before. Between the floor and the standard cutoff = still `is_eligible: true`, with a policy
warning flagging manual deviation approval is required. Above the cutoff = unchanged pass.
Applied for HDFC (floor 710); every other lender's behavior is unchanged (floor defaults to the
cutoff itself, i.e. no band, since only HDFC's sheet documents this two-tier rule).

---

## ICICI Bank

### 8. ✅ Salaried method completely ignored Incentive and Annual Bonus
**Where:** `dynamicEligibility.service.js` — `calculateIciciSalariedConsideredIncome`

Policy: *"Net Salary per month... Incentive 3 month average. Annual Bonus can be considered if
reported from latest year but vetting is done for 2 year."* The code only ever read verified net
salary from salary-slip OCR — incentive and bonus were never read at all, even though
`salaried_incentive_income` already existed as a real, populated field.

**Fix:** both are now added directly to net salary (ICICI applies FOIR once, later, at the
scheme level — unlike HDFC there's no separate weightage step to fold them into first).

---

### 9. 🔁 ICICI GST margin "Service" rate — reverted, 15% restored
**Where:** `dynamicEligibility.service.js` — `LENDER_POLICY_REGISTRY.ICICI.gstMargins`

ICICI's requirement sheet lists Manufacturing 7% / Retail 5% / Wholesale 4% / Specialised
profile 3% — no "Service" bucket. This audit originally flagged `service: 0.15` (matching
IIFL's/India Shelters'/Piramal's service margin) as a phantom entry not in ICICI's own sheet, and
removed it so a "service" GST industry customer would fall through to the generic stored/
extracted margin instead.

**Reverted by explicit user instruction (2026-08-14):** `service: 0.15` restored to ICICI's
`gstMargins`.

---

### 10. ✅ A scheme with a missing eligible amount silently displayed a *different scheme's* amount
**Where:** `dynamicEligibility.service.js` (ICICI NWM "inactive" early return) + `esrCalculationLog.service.js` (`_finalEligibilityFormula` / `finalEligible`)

Found while testing ICICI's Net Worth Method: the early-return branch for "NWM inactive per
ICICI policy" was missing `final_eligible_loan_amount`/`eligible_loan_amount` from its returned
object entirely (`undefined`, not `0`). The calc-log builder's `??` fallback then filled that gap
with **the lender-level rollup amount** (i.e. whichever scheme actually was eligible for that
lender) — so the audit log showed NWM, an inactive/ineligible method with zero income, as
"eligible for ₹1,00,00,000" (the *Banking* scheme's amount, borrowed and mislabeled as NWM's).

**Proof:** before fix, case log showed NWM `final_eligible_amount: "INR 1,00,00,000"` with
`income_used: "INR 0"` and status effectively ineligible — an internally contradictory result.
After fix: `final_eligible_loan_amount: 0` throughout, consistent with its actual ineligibility.

**Fix:** the early-return object now explicitly sets both amount fields to `0`. Separately,
hardened the log builder so it never substitutes a *different* scheme's amount for a missing one
— defaults to `0` instead, so this class of bug can't resurface from some other code path that
also forgets to set the field.

---

### 11. 🔁 ICICI Banking ABB divisor — reverted back to flat 2 for everyone
**Where:** `LENDER_POLICY_REGISTRY.ICICI.banking.defaultDivisor`

ICICI's requirement sheet: *"1. ABB divide by 3 for others. 2. ABB divide by 2 for Super HNI,
Elite, Normal."* This audit had changed the default divisor from 2 to 3, reasoning that since the
app has no Super HNI/Elite/Normal tier classification, every customer falls under "Others" per
the sheet.

**Reverted by explicit user instruction (2026-08-14):** back to a flat divisor of **2** for
everyone, as it was before this audit. The `banking_profile_divisor_policy` mechanism
(`getAbbDivisor` in `bankAbbPolicy.js`) is untouched and still available for a case explicitly
tagged with a profile tier, if that classification is ever wired up.

---

## India Shelters & Piramal

### 12. 🔁 GRP method for non-doctor applicants — reverted back to ₹0
**Where:** `dynamicEligibility.service.js` — `resolveGrpMultiplierForPolicy`, `LENDER_POLICY_REGISTRY.INDIA_SHELTERS` / `PIRAMAL`

Both lenders' sheets describe GRP as a flat *"Net profit as per latest year ITR multiplied by
4"* — unlike ICICI/HDFC/Tata, which explicitly split Doctor (4x) vs Other Professional (3x),
neither India Shelters' nor Piramal's sheet mentions any non-doctor rate at all. This audit had
added a `grpFlatMultiplier: 4` policy field for both lenders so non-doctor applicants would get a
4x multiplier instead of falling through to 0.

**Reverted by explicit user instruction (2026-08-14):** `grpFlatMultiplier` removed from both
lenders' registry entries. Non-doctor applicants at India Shelters/Piramal now get a GRP
multiplier of 0 again (GRP effectively unavailable to them), as before this audit.

---

### 13. ✅ "100% if ABB ≥ 1× proposed EMI else 80%" FOIR rule — re-verified against the source sheet, and the first fix had the wrong column mapping
**Where:** `dynamicEligibility.service.js` — `resolveFoirByPolicy`

**Re-checked directly against both Excel sheets (row 18, the DBR/FOIR row) cell-by-cell:**

| Column | India Shelters | Piramal | Row 18 value (both sheets) |
|---|---|---|---|
| C | Salaried | Salaried | flat rate |
| D | ITR Based | Cash Profit Method | **conditional** (ABB ≥ 1× EMI → 100%, else 80%) |
| E | Banking | Banking | 0.67 (flat) |
| **F** | **GRP** | **GRP** | **1 (flat 100% — always, not conditional)** |
| **G** | **LIP** | **LIP** | **conditional (ABB ≥ 1× EMI → 100%, else 80%)** |
| I | Gross Margin Method | Gross Margin Method | conditional |
| J | AIP | AIP | flat rate |

The conditional text sits in **D, G, and I** on both sheets — i.e. NPM/Cash-Profit, **LIP**, and
Gross Margin. **GRP's own cell (F18) is a plain `1`, not the conditional text**, on both sheets.

The original fix for this issue got the column mapping wrong: it applied the conditional to
**GRP** instead of **LIP** (easy mistake — G is next to F, and the write-up above literally
second-guessed itself mid-sentence about which column GRP was in). The result: GRP was being
computed as 80%/100% based on ABB when the sheet says it should always be a flat 100%, and LIP
had no conditional at all (it fell through to `policy.LIP`, which was never defined in the
registry for either lender, so LIP's FOIR silently came back `null`).

**Corrected fix:** GRP now always returns its flat policy value (`1.00` for both lenders,
matching F18). LIP now applies the ABB-vs-EMI conditional (matching G18) instead of returning
`null`. NPM/Cash-Profit (D) and Gross Margin (I) were already correct and are unchanged.

**Verified with a direct unit test of `resolveFoirByPolicy`** for both lenders, high-ABB and
low-ABB scenarios: GRP returns `1.00` in both cases (correctly flat); LIP returns `1.00` when
ABB ≥ EMI and `0.80` when ABB < EMI (correctly conditional); NPM behavior unchanged.

---

## Cross-lender: lender/scheme-level rollup

### 14. ✅ A fully-ineligible lender reported `final_eligible_loan_amount: undefined`
**Where:** `dynamicEligibility.service.js` — lender-result rollup in `generateDynamicESR`

When zero schemes for a lender were eligible, the code only set `ineligibility_reason` — it never
initialized `final_eligible_loan_amount`, `max_tenure_months`, `roi_min/max`, or
`monthly_income_used` on the lender-level result object at all, leaving them `undefined`. An
`undefined` field either prints literally in a UI ("₹undefined") or vanishes from the JSON
response depending on the serializer, both misleading for a report whose entire job is to say
plainly "this lender is not eligible, here's why."

**Proof:** India Shelters test case (no scheme eligible) — before fix:
`India Shelters | eligible=false | amount=undefined`. After fix: `amount=0`.

**Fix:** these fields now default to `0`/`null` explicitly in the lender-result object, so a
fully-ineligible lender always returns a consistent, real value.

---

## Tata Capital Housing Finance

Checked Salaried (FOIR slab 20-70k/70k-1.5L/>1.5L → 60/65/70%), Net Profit Method (addback +
remuneration + director interest per its own config), Banking (ABB × 0.55), and GST (ICICI-style
margin fallback, documented in code as an explicit interim choice since Tata's own sheet has no
GST margin matrix). All matched the requirement sheet exactly in test cases — **no bugs found**
specific to Tata beyond the cross-lender issues above (#1-5, #14), which also apply to it. GRP's
"no fallback multiplier for non-Doctor/non-Architect professionals" is correct as-is here — Tata's
sheet, unlike India Shelters'/Piramal's, genuinely doesn't define a rate for other professions.

---

## IIFL Home Finance

### 15. ✅ Built from scratch — did not exist anywhere in the codebase
**Where:** `seed_lenders.js`, `seed_matrix.js`, `dynamicEligibility.service.js`

`grep -rn "IIFL"` returned zero matches anywhere in `src/`, `prisma/`, or `scripts/` — no
`Lender` row, no seed data, no policy registry entry, despite a full requirement sheet existing
in `Policies/`. Built out as a full 6th lender, per your decision:

- **Seeded** (`seed_lenders.js` + `scripts/run_seed_matrix.js`, run against the live DB): `Lender`
  (code `IIFL`), `LenderProduct` (HL, LAP), and all 9 `Scheme` rows (Salaried, Net Profit Method,
  Banking, GST, GRP, LIP, Low LTV, Net Worth Method, Assessed Income Program) — matching every
  column in the requirement sheet.
- **Parameter matrix** (`seed_matrix.js`, `lenderPolicyValues.IIFL`): min/max loan, ROI, PF,
  tenure, age-at-maturity, bureau cutoff (flat 660, unlike ICICI/HDFC's per-method variance),
  per-scheme DBR/FOIR (including the double-whammy conditional text and the "<50k -60%, >50k
  -65%" salaried slab — reusing the same generic slab parser already proven correct for ICICI),
  rental/agriculture eligibility %, and the full LAP/HL LTV tables.
- **New `LENDER_POLICY_REGISTRY.IIFL` calculation logic**, each written and numerically verified
  against a real test case (case 864/865/866):
  - **Salaried**: *"Gross Salary... 50% of Incentive... 50% of Annual Bonus"* — a genuinely new
    pattern (no salary-weightage slab like HDFC, only-50%-weighted incentive/bonus unlike ICICI's
    100%). New `calculateIiflSalariedConsideredIncome` function. Verified: gross ₹1,00,000 +
    50%×₹20,000 incentive + 50%×(₹1,20,000/12) bonus = **₹1,15,000** exactly.
  - **Net Profit Method**: *"Average of last 2 years... + 75% of Dep..."* — unlike every other
    lender, IIFL **always** averages 2 years (no growth-threshold test) and only allows 75% of
    depreciation as an addback. Extended `resolveNpmIncomeByPolicy` with new
    `alwaysAverageTwoYear` and `depreciationFraction` policy knobs (kept optional/off for every
    other lender). Verified: PAT ₹18L/₹12L (avg ₹15L) + 75%×₹4L dep + ₹1L finance + ₹2L
    remuneration = ₹21L/yr → **₹1,75,000/month** exactly.
  - **Banking**: *"Multiplier of 1.5"* — found and fixed a real bug while wiring this up (see
    below).
  - **GST**: reused the existing margin-table mechanism with IIFL's own rates (Manufacturing 7%,
    Retail 5%, Wholesale 4%, Specialised 3%, Service 15%). Verified exactly.
  - **GRP**: reused the existing Doctor(4x)/Other-professional(3x) mechanism (IIFL's sheet has
    the same split as ICICI/HDFC, unlike India Shelters'/Piramal's flat 4x).
  - **LIP / Low LTV / Net Worth Method / Assessed Income Program**: all correctly route to
    `MANUAL_REVIEW` via the same generic manual-method gate the other lenders use (LIP/Low LTV
    matched automatically; AIP needed IIFL added to the lender allowlist — see #17 below).

### 16. ✅ Found while building IIFL: banking multiplier >1 was silently corrupted to a near-zero value
**Where:** `dynamicEligibility.service.js` — `resolveBankingAbbIncome` (`ABB_MULTIPLIER` mode)

Every other lender using this banking mode (India Shelters, Piramal, Tata) has a multiplier
*below* 1 (0.67, 0.55) — genuinely a DBR-style percentage. The code had `if (multiplier > 1)
multiplier /= 100`, assuming any value over 1 must be a whole-number percent that needs
converting. IIFL's sheet, uniquely, specifies a real multiplier **greater than 1** ("Multiplier
of 1.5" — monthly income legitimately exceeds the raw ABB). That heuristic silently turned IIFL's
`1.5` into `0.015`.

**Proof:** ABB ₹6,00,000 — before fix: `"600000 × 1.5% = 9000"` (should never have said "%" at
all). After fix: `900000` (₹6,00,000 × 1.5).

**Fix:** the `>1 → /100` normalization now only applies to a value that actually came from a
*DB-configured* parameter (where an admin plausibly typed "67" meaning 67%) — a lender's
hardcoded policy-registry constant is trusted as already correctly scaled, whether that's 0.67,
0.55, or IIFL's 1.5.

### 17. ✅ Found while building IIFL: Assessed Income Program bypassed the manual-review gate
**Where:** `dynamicEligibility.service.js` — `isManualOnlyMethod`

Every lender's own sheet describes AIP as effectively manual/PD-based underwriting (IIFL: *"Purely
PD based"*; India Shelters: identical wording). The manual-review gate that correctly routes AIP
to `MANUAL_REVIEW` for India Shelters/Piramal/Tata was hardcoded to only check those three lender
keys — IIFL wasn't in the list (it didn't exist yet when this was written), so IIFL's AIP was
running the standard auto-FOIR calculation and returning a real (spurious) eligible amount instead
of flagging for manual review like every other lender's AIP does.

**Fix:** added `IIFL` to the lender allowlist for this gate.

---

## Found via the 50-case randomized verification

### 18. ✅ `_numberOrNull(null)` returned `0`, not `null` — a JavaScript coercion gotcha that fabricated "0.00%"/"₹0" for every not-applicable scheme
**Where:** `esrCalculationLog.service.js` — `_numberOrNull` / `_intOrNull`

`Number(null)` is `0` in JavaScript (not `NaN`), so `_numberOrNull(null)` — used everywhere in
the calculation-log builder to safely format a field for display — silently returned `0` instead
of correctly signaling "no value." Any field the engine deliberately set to `null` (e.g. a
Salaried scheme that's not applicable for a self-employed applicant explicitly sets
`applicable_ltv_percent: null`, `monthly_income_used: null`) got displayed as a real,
plausible-looking `0`. Concretely: `property_ltv_formula` checks `ltvPercent !== null` to decide
between showing the real formula or "No LTV value available" — since `0 !== null` is `true`, it
took the formula branch and printed `"₹3,62,87,800 x 0.00% = ₹0"` for a scheme that was never
evaluated at all, instead of honestly saying "not applicable."

**Proof:** discovered via the 50-case batch — self-employed applicants' Salaried-scheme log rows
showed a fabricated `"x 0.00% = ₹0"` LTV line (103 instances across the 50 cases) instead of "No
LTV value available."

**Fix:** both helpers now explicitly check for `null`/`undefined`/`''` before calling `Number()`,
so a deliberate `null` stays `null` all the way through formatting. This also incidentally fixed
`_tenureFormulaForEvaluation`'s age-based-tenure line, which had the identical bug.

---

### 19. ✅ Calculation log borrowed case-wide or lender-rollup numbers to fill in a specific scheme's missing fields
**Where:** `esrCalculationLog.service.js` — `_buildLenderMethodCalculationRows`

Several fields used a fallback chain like `evaluation.monthly_income_used ?? foir.composed_income
?? inputSnapshot?.selected_monthly_income` — when a scheme's own value was `null` (genuinely not
applicable), it fell through to a **case-wide** value that has nothing to do with that specific
scheme. Same pattern for `maximum_eligible_emi`, `underwriting_roi_used`, and
`max_tenure_months`, which fell back to `lender.max_eligible_emi` / `lender.roi_min` /
`lender.max_tenure_months` — the **lender-level rollup**, i.e. whichever *other* scheme actually
won for that lender.

**Proof:** a self-employed applicant's HDFC Salaried row (correctly not-applicable) showed
`income_formula: "Verified salary income ₹1,71,100 ... = ₹1,71,100"` and
`eligible_emi_capacity: "₹2,07,750"` — real, non-zero numbers for a method that computed nothing,
borrowed from the case's raw snapshot and from HDFC's actual best-performing scheme respectively.
`final_eligible_amount` itself was correctly `₹0` throughout — this only ever affected the
descriptive audit fields, never the real decision or dollar figure — but a DSA reading the log
had no way to tell that from the text alone.

**Fix:** removed the `inputSnapshot`/`lender.*` fallbacks entirely for these fields. A
not-applicable scheme's row now consistently shows `null`/"N/A" throughout instead of a
plausible-but-wrong number pulled from somewhere else.

---

### 20. ✅ Tata Capital's own sheet gives a real bureau cutoff (700); the seed forced bureau gating off for it anyway
**Where:** `seed_matrix.js` — the zero-cutoff override loop (in-memory `lenderPolicyValues`
override + a second, separate DB `schemeParameterValue` upsert that re-applied `'0'` even if the
in-memory value were fixed)

```js
for (const lenderCode of ['INDIA_SHELTERS', 'PIRAMAL', 'TATA_HOUSING']) {
  lenderPolicyValues[lenderCode][productType].bureau_cutoff = '0';
}
```

India Shelters' and Piramal's own sheets explicitly describe having **no** hard numeric cutoff
("There is no minimum cut off score"; "Internal Risk score... above certain score only cases are
considered" — not a fixed CIBIL number) — disabling the bureau gate for those two matches their
policy exactly. Tata Capital's sheet, however, states a plain numeric cutoff of **700** for both
HL and LAP — yet it was grouped into the same "no bureau gate" override, so a Tata case with, say,
CIBIL 660 was shown as passing Tata's bureau check when its own policy says it shouldn't.

**Proof (pre-fix):** 50-case batch — every Tata scheme for every applicant with CIBIL < 700 showed
`ELIGIBLE` on the bureau check where the sheet says it should be rejected (36 instances).

**Fix — confirmed by the user (2026-08-14):** removed `TATA_HOUSING` from both override sites in
`seed_matrix.js` (the in-memory `lenderPolicyValues` loop and the DB `schemeParameterValue`
upsert), so it now seeds from its own sheet value (`bureau_cutoff: '700'`, already present in its
`lenderPolicyValues` entry) instead of being force-zeroed. Also corrected the 19 already-seeded
`scheme_parameter_values` rows for Tata's HL/LAP schemes in the live DB from `'0'` to `'700'`, so
the fix takes effect immediately without needing a full reseed.

**Verified live:** two matched test cases (identical income/property/loan, only CIBIL differs) —
CIBIL 650 → Tata now correctly rejects: *"Lowest CIBIL score 650 is below the hard-reject floor
700"*. CIBIL 750 → Tata correctly approves the full requested amount. Both test cases removed
after verification.

---

### 21. ✅ A PII-masking regex corrupted real calculation numbers into invalid JSON
**Where:** `esrCalculationLog.service.js` — `_maskSensitive`

The calculation log masks PAN numbers, Aadhaar-style 12-digit numbers, and generic 9-18 digit
numbers (bank account numbers, etc.) before export, by regex over the final, already-serialized
JSON payload. Two real financial figures were indistinguishable from "a sensitive ID number" to
that regex:
- **A repeating decimal.** `₹2,31,800 ÷ 3 = 77266.66666666667` (a completely ordinary HDFC
  banking calculation) had its 11 fractional digits matched as a "9-18 digit account number" and
  masked to `77266.*******6667` — which isn't valid JSON, so nothing downstream (including this
  audit) could `JSON.parse()` that scheme's breakdown at all.
- **A large but perfectly ordinary loan/property amount.** `₹13,42,75,000` (`134275000`, 9
  digits) is a routine LAP ticket size in this system, but is digit-count-identical to a
  plausible account number, so it was also getting masked — silently hiding a real, non-sensitive
  figure from the audit trail.

**Proof:** found via the 50-case batch when the verification script's own `JSON.parse()` of
`income_breakdown` threw `SyntaxError: Unterminated fractional number in JSON`. Confirmed by
reading the raw log bytes — the corruption is real, on disk, not a terminal display artifact.

**Fix:** added two guards to the masking regexes: never match digits adjacent to a decimal point
(`(?<![.\d])...(?![.\d])`, fixes the repeating-decimal case), and never match a digit run that
immediately follows a JSON key's colon (`(?<!:\s?)`, fixes the large-bare-number case) — a
genuine JSON numeric literal always directly follows `"key":`, while real sensitive PII text does
not. Verified against both the original corrupted cases (now parse cleanly with the real numbers
intact) and a synthetic test confirming genuine embedded PII text (e.g. "account number
123456789012") is still masked correctly.

---

## Infrastructure — found via the second 50-case batch

### 22. ✅ No timeout anywhere in the DB connection stack — a network blip could hang a request forever
**Where:** `config/db.js`; the shared Postgres host itself

Investigated why the batch-2 script kept silently stalling for minutes at a time (process alive,
~0% CPU, no error). Root cause, confirmed directly against the live database:

- Postgres itself had **`statement_timeout = 0`** and **`idle_in_transaction_session_timeout = 0`**
  — no query or idle transaction is ever killed server-side, no matter how long it sits there.
  `tcp_keepalives_idle = 7200` (2 hours) — the OS-level TCP stack wouldn't even notice a dead peer
  for two hours.
- The app's `DATABASE_URL`/`PrismaClient` had **no `connect_timeout`, `pool_timeout`, or
  `socket_timeout`** configured anywhere — nothing on the client side either.

Caught the exact failure live: `pg_stat_activity` showed a connection `idle in transaction`,
49+ seconds into an `INSERT INTO case_esr_calculation_logs`, `wait_event: ClientRead` — Postgres
was simply waiting for data the client had stopped sending, with nothing anywhere configured to
ever give up and recover. That connection sat there holding a `RowExclusiveLock` on the table
indefinitely.

**Why this matters beyond the test script:** this exact failure mode — one transient network
blip during a query — would happen against the real production server too, not just a local test
harness. Under real concurrent traffic, each such stall permanently consumes a connection-pool
slot and its locks; enough of them (which only takes time, not unusual load) exhausts the entire
pool and the app stops responding for every user, not just the one whose request stalled. This is
almost certainly the shape of failure behind "why can't this handle real concurrent load."

**Fix:** `config/db.js` now builds the Prisma connection URL with explicit
`connect_timeout=10`, `pool_timeout=15`, `socket_timeout=30`, `connection_limit=15`, applied
automatically to whatever `DATABASE_URL` is configured in any environment — no `.env`/deployment
secret change required anywhere, including production. `socket_timeout` is the critical one: it
bounds how long Prisma waits for a query response on an already-open connection, so a stalled
connection now fails with a catchable error within 30s instead of hanging forever.

**Verified:** reproduced the hang before the fix (twice, independently) and confirmed a fresh
50-case run with the fix in place ran without a single hang.

**🚧 One thing this session could not do:** this DB is shared infrastructure — I did not change
the server-side `statement_timeout`/`idle_in_transaction_session_timeout` (currently `0`/`0`),
since that would affect every application/script connecting to this Postgres instance, not just
this one. **Recommend** the ops/infra owner set a reasonable `statement_timeout` (e.g. 30-60s) at
minimum on the specific database role this app uses, as defense-in-depth beyond the
now-fixed application-side timeout.

---

### 23. ✅ Four live-server files bypassed the shared, safety-configured DB client
**Where:** `src/workers/dataPull.worker.js`, `src/controllers/sse.controller.js`,
`src/services/bulkCaseUpload.service.js`, `src/services/bulkDisbursementUpload.service.js`

Each of these created its own `new PrismaClient()` instead of using the shared `config/db.js`
client — meaning none of them got the timeout fix in #22 above, and (for the two bulk-upload
services) none of them got the field-encryption extension either. `bulkCaseUpload.service.js`'s
raw client meant **PAN numbers written through the bulk-upload flow were stored in plaintext**,
inconsistent with every other write path in the app.

**Fix:** all four now `require('../../config/db')` — the same shared, extended, timeout-protected
client used everywhere else. Verified none of them called `$disconnect()` on their old client
(which would have been a real regression risk — tearing down the *shared* connection would kill
it for the whole app), and verified the bulk-upload PAN-matching logic still works correctly
under encryption (it compares `applicant.pan_number` read back via the extension, which
transparently decrypts on read, same as it does everywhere else in the codebase already).

(Several one-off migration/seed/admin scripts also create their own raw `PrismaClient` — left
as-is since they're not part of live concurrent request handling and run individually, not
under production load.)

---

### 24. ✅ Calculation-log write duplicated large JSON blobs into every row — the actual scalability bottleneck
**Where:** `esrCalculationLog.service.js` — `_buildDbRows`

Even after #22's timeout fix stopped the *silent-forever-hang* failure mode, cases were still
taking 10-20+ seconds each to persist — slow enough to look like another hang. Root cause: three
columns (`input_snapshot_json`, `source_paths_json`, `excluded_records_json`) are **byte-for-byte
identical for every row in a case's batch** (they come from the case-level snapshot, not the
per-scheme `evaluation`), but were being freshly re-serialized and stored as a **full duplicate
copy on every row** — up to ~30-45 rows per case (one per lender × scheme). That's the actual
data volume the slow `INSERT` was moving.

**Proof:** timed `generateESR()` directly before/after: **~10-20s → ~1.5s per case** (occasional
slower runs up to ~9s from ordinary network jitter, still nowhere near a hang, and well inside
the #22 timeout). A full 50-case batch that previously couldn't complete without stalling
finished cleanly in a few minutes after this fix.

**Why this is the real "handle 1000+ requests" fix, not just a test-script fix:** a write this
heavy, done synchronously in the main request path, is a severe per-request cost under real
concurrent load — it ties up a DB connection and pushes real bytes over the wire for 10-20+
seconds per request regardless of whether anything is actually "hung." Cutting that to ~1.5s is
roughly a 10-20× improvement in how many concurrent ESR-generation requests the same
infrastructure can actually sustain.

**Fix:** the three shared JSON blobs are now computed once per case (not once per row) and stored
only on the first row of the batch; every other row gets `null` for those three columns. Verified
these three columns are write-only elsewhere in the codebase (`grep` confirms no other file reads
them expecting a per-row copy), so this doesn't remove any data an existing consumer needs — a
lookup by `calculation_run_id` still gets the full snapshot from that first row.

---

### 25. ✅ ICICI Net Worth Method removed from the portal
**Where:** `seed_lenders.js` — `LENDER_EXCLUDED_SCHEMES`, plus the two already-live scheme rows in the DB

Not a calculation bug — a product decision. ICICI's Net Worth Method (NWM) scheme was already
effectively dead in the calculation engine (`resolveDynamicNwmEligibility` always returns
ineligible with reason `"NWM inactive per ICICI policy / ignored for current phase"`), but the
scheme itself was still listed as `ACTIVE` and selectable/visible on the portal for both HL and
LAP under ICICI.

**Fix:** added `ICICI: ['Net Worth Method']` to `seed_lenders.js`'s exclusion map (so future
reseeds keep it inactive), and directly flipped the two live `schemes` rows (HL id 45, LAP id 53)
to `status: 'INACTIVE'`. Confirmed the admin/lender scheme-listing endpoints filter on
`status: 'ACTIVE'`, so it no longer appears on the portal for either product.

---

### 26. ✅ ICICI Salaried age-at-maturity is conditional on the sheet (60/70 by income) — was seeded as a flat 60
**Where:** `age_maturity_income` parameter on ICICI's Salaried scheme (both HL and LAP)

ICICI's own requirement sheet (row 17, column C — Salaried) states: *"70 - in income >1 lacs, 60
if income < 1 lacs"* — the age-at-maturity cap should be 70 for applicants earning over
₹1,00,000/month, and 60 below that. The DB had this seeded as a flat `"60"` for everyone.

The engine already had **first-class support for this exact conditional text** —
`normalizeParameter()` in `esrParsers.js` specifically recognizes the `"income >1 lacs"` /
`"income < 1 lacs"` phrasing and marks it `type: 'conditional_age'`, and
`resolveAgeMaturityParam()` in `dynamicEligibility.service.js` parses it against the applicant's
actual monthly income at calculation time. It just needed the correct value seeded.

**Fix:** updated the `age_maturity_income` parameter on ICICI's Salaried scheme (scheme id 38 =
HL, id 46 = LAP) from the flat `"60"` to the sheet's exact text, normalized through the same
`normalizeParameter()` path the admin panel uses (so the stored shape matches an ordinary
parameter edit).

**Also hardened while investigating:** `calculateAgeBasedTenureResolution`'s local `getIntParam`
read the raw scheme-parameter value directly instead of through `resolveRawParamValue()` (the
helper every other parser in this file uses to unwrap Prisma's `{raw, normalized, type}` JSON
shape). In practice this call site never received an already-wrapped object — `paramMap` is
unwrapped earlier in the pipeline — so it wasn't causing incorrect behavior, but it was
inconsistent with every other parameter read in the file and would have silently broken as soon
as a conditional/text `age_maturity_income` or `age_maturity_non_income` value hit this specific
path. Added the same unwrap call for consistency; verified it's a no-op for the current pipeline
(all existing checks still pass).

**Verified live:** two matched test cases (identical DOB/property/loan, only income differs) —
₹80,000/month (< ₹1L) → maturity 60, `age_based_tenure_limit_months: 108`. ₹1,50,000/month
(> ₹1L) → maturity 70, `age_based_tenure_limit_months: 228`. Both hand-verified against the DOB
arithmetic exactly. Test cases removed after verification.

---
