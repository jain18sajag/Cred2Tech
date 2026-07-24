const prisma = require('../../config/db');
const { encryptString } = require('../utils/fieldEncryption');

async function bulkUploadLegacyCases(req, res) {
  try {
    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const { cases } = req.body;

    if (!Array.isArray(cases) || cases.length === 0) {
      return res.status(400).json({ error: 'No cases provided for upload' });
    }
    const MAX_BULK_UPLOAD_ROWS = 200;
    if (cases.length > MAX_BULK_UPLOAD_ROWS) {
      return res.status(400).json({ error: `Too many cases in one upload (max ${MAX_BULK_UPLOAD_ROWS}, got ${cases.length})` });
    }

    const results = {
      total: cases.length,
      success: 0,
      failed: 0,
      errors: []
    };

    const parseNum = (val, fallback = 0) => {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? fallback : parsed;
    };

    const parseIntSafe = (val, fallback = 0) => {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? fallback : parsed;
    };

    for (let i = 0; i < cases.length; i++) {
      const row = cases[i];
      try {
        // 1. Basic Validation
        if (!row.business_pan) throw new Error('Missing Business PAN');
        if (!row.loan_amount) throw new Error('Missing Loan Amount');
        if (!row.product_type) throw new Error('Missing Product Type');

        await prisma.$transaction(async (tx) => {
          // 2. Find or Create Customer by PAN
          let customer = await tx.customer.findFirst({
            where: { tenant_id: tenantId, business_pan: row.business_pan }
          });

          if (!customer) {
            customer = await tx.customer.create({
              data: {
                tenant_id: tenantId,
                category: 'MSME', // default for business PANs
                business_pan: row.business_pan,
                business_name: row.business_name || `Legacy Customer ${row.business_pan}`,
                business_mobile: row.business_mobile || null,
                business_email: row.business_email || null,
                entity_type: row.entity_type || 'PROPRIETORSHIP',
                industry: row.industry || 'Other',
                business_vintage: row.vintage_years ? `${row.vintage_years} Years` : null,
                created_by_user_id: userId
              }
            });
          }

          // 3. Prepare Applicants Data
          // NOTE: these get created via a nested `applicants: { create: [...] }`
          // write below, which bypasses the Applicant model's own Prisma query
          // extensions (config/db.js's encryption hooks only intercept
          // top-level `prisma.applicant.*` calls) — pan_number is encrypted
          // explicitly here instead.
          const applicantsData = [
            {
              is_primary: true,
              type: 'PRIMARY',
              name: customer.business_name,
              pan_number: encryptString(customer.business_pan, { deterministic: true }),
              mobile: customer.business_mobile || '0000000000',
              email: customer.business_email || null,
              bureau_fetched: row.bureau_score_applicant ? true : false,
              cibil_score: parseIntSafe(row.bureau_score_applicant, null)
            }
          ];

          if (row.co_applicant_name || row.co_applicant_pan) {
            applicantsData.push({
              is_primary: false,
              type: 'CO_APPLICANT',
              name: row.co_applicant_name || 'Co-Applicant',
              pan_number: row.co_applicant_pan ? encryptString(row.co_applicant_pan, { deterministic: true }) : null,
              mobile: row.co_applicant_mobile || null,
              email: row.co_applicant_email || null,
              bureau_fetched: row.bureau_score_co_applicant ? true : false,
              cibil_score: parseIntSafe(row.bureau_score_co_applicant, null)
            });
          }

          // 4. Create Case and nested Applicants
          const newCase = await tx.case.create({
            data: {
              tenant: { connect: { id: tenantId } },
              customer: { connect: { id: customer.id } },
              created_by: { connect: { id: userId } },
              product_type: row.product_type,
              loan_amount: parseNum(row.loan_amount),
              dsa_notes: row.dsa_notes ? `[Legacy Upload] ${row.dsa_notes}` : '[Legacy Upload]',
              esr_generated: true,
              stage: 'ESR_GENERATED',
              customer_name: customer.business_name,
              entity_type: customer.entity_type,
              cibil_score: parseIntSafe(row.bureau_score_applicant, null),
              applicants: {
                create: applicantsData
              }
            },
            include: { applicants: true }
          });

          const primaryApp = newCase.applicants.find(a => a.type === 'PRIMARY');
          const coApp = newCase.applicants.find(a => a.type === 'CO_APPLICANT');

          // 5. Create ESR Financials with Uploaded Overrides
          await tx.caseEsrFinancials.create({
            data: {
              case_entity: { connect: { id: newCase.id } },
              extraction_status: 'COMPLETED',
              extracted_at: new Date(),
              selected_income_method: 'LEGACY_UPLOAD',
              selected_monthly_income: parseNum(row.loan_amount) * 0.05, // Will be bypassed, but safe fallback
              
              requested_loan_amount: parseNum(row.loan_amount),
              requested_tenure_months: 60, // Default for legacy
              product_type: row.product_type,
              
              property_value: parseNum(row.property_value, null),
              property_type: row.property_type || null,
              occupancy_type: row.occupancy_type || null,

              bureau_score: parseIntSafe(row.bureau_score_applicant, null),
              existing_obligations: 0, // Will be overridden dynamically by dynamicEligibility engine
              icici_exposure: parseNum(row.icici_exposure, 0),

              itr_pat: parseNum(row.itr_pat, 0),
              itr_depreciation: parseNum(row.itr_depreciation, 0),
              itr_finance_cost: parseNum(row.itr_finance_cost, 0),
              itr_gross_receipts: parseNum(row.itr_gross_receipts, 0),

              gst_avg_monthly_sales: parseNum(row.gst_avg_monthly_sales, 0),
              gst_industry_margin: parseNum(row.gst_industry_margin, null),

              bank_avg_balance: parseNum(row.bank_avg_balance, 0),
            }
          });

          // 6. Insert Income Entries
          const incomeEntries = [];

          // Primary Income
          if (parseNum(row.applicant_salary)) incomeEntries.push({ case_id: newCase.id, applicant_id: primaryApp?.id, income_type: 'Salary', annual_amount: parseNum(row.applicant_salary), applicant_label: primaryApp?.name });
          if (parseNum(row.applicant_incentives)) incomeEntries.push({ case_id: newCase.id, applicant_id: primaryApp?.id, income_type: 'Bonus/Incentive', annual_amount: parseNum(row.applicant_incentives), applicant_label: primaryApp?.name });
          if (parseNum(row.monthly_rental_bank)) incomeEntries.push({ case_id: newCase.id, applicant_id: primaryApp?.id, income_type: 'Rental Income (Bank Credit)', annual_amount: parseNum(row.monthly_rental_bank) * 12, applicant_label: primaryApp?.name });
          if (parseNum(row.monthly_rental_cash)) incomeEntries.push({ case_id: newCase.id, applicant_id: primaryApp?.id, income_type: 'Rental Income (Cash)', annual_amount: parseNum(row.monthly_rental_cash) * 12, applicant_label: primaryApp?.name });
          if (parseNum(row.agri_income)) incomeEntries.push({ case_id: newCase.id, applicant_id: primaryApp?.id, income_type: 'Agricultural Income', annual_amount: parseNum(row.agri_income), applicant_label: primaryApp?.name });

          // Co-Applicant Income
          if (coApp && parseNum(row.co_applicant_salary)) incomeEntries.push({ case_id: newCase.id, applicant_id: coApp.id, income_type: 'Salary', annual_amount: parseNum(row.co_applicant_salary), applicant_label: coApp.name });
          if (coApp && parseNum(row.co_applicant_incentives)) incomeEntries.push({ case_id: newCase.id, applicant_id: coApp.id, income_type: 'Bonus/Incentive', annual_amount: parseNum(row.co_applicant_incentives), applicant_label: coApp.name });

          if (incomeEntries.length > 0) {
            await tx.caseIncomeEntry.createMany({ data: incomeEntries });
          }

          // 7. Insert Obligations
          const obligations = [];
          if (parseNum(row.obligation_hl)) obligations.push({ case_id: newCase.id, applicant_id: primaryApp.id, loan_type: 'Home Loan', emi_per_month: parseNum(row.obligation_hl), status: 'ACTIVE', source: 'MANUAL' });
          if (parseNum(row.obligation_lap)) obligations.push({ case_id: newCase.id, applicant_id: primaryApp.id, loan_type: 'LAP', emi_per_month: parseNum(row.obligation_lap), status: 'ACTIVE', source: 'MANUAL' });
          if (parseNum(row.obligation_cc)) obligations.push({ case_id: newCase.id, applicant_id: primaryApp.id, loan_type: 'Credit Card', emi_per_month: parseNum(row.obligation_cc), status: 'ACTIVE', source: 'MANUAL' });
          if (parseNum(row.obligation_od)) obligations.push({ case_id: newCase.id, applicant_id: primaryApp.id, loan_type: 'Overdraft', emi_per_month: parseNum(row.obligation_od), status: 'ACTIVE', source: 'MANUAL' });
          if (parseNum(row.obligation_pl)) obligations.push({ case_id: newCase.id, applicant_id: primaryApp.id, loan_type: 'Personal Loan', emi_per_month: parseNum(row.obligation_pl), status: 'ACTIVE', source: 'MANUAL' });

          if (obligations.length > 0) {
            await tx.caseCreditObligation.createMany({ data: obligations });
          }
        });

        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push(`Row ${i + 1} (${row.business_pan || 'Unknown'}): ${err.message}`);
      }
    }

    return res.json(results);
  } catch (err) {
    console.error('Legacy upload error:', err);
    res.status(500).json({ error: 'Failed to process legacy upload' });
  }
}

module.exports = {
  bulkUploadLegacyCases
};
