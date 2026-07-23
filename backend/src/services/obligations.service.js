const prisma = require('../../config/db');
const { markEsrInputsChanged } = require('./esrSnapshotMutation.service');
const { dedupeObligations } = require('../utils/obligationDedup');

function parseNumericInput(value, fieldName, { nullable = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw new Error(`${fieldName} is required.`);
  }
  const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} must be a valid number.`);
  return parsed;
}

/**
 * Parses a single bureau raw_response JSON to extract individual loan obligations.
 * Different bureau providers use different field structures — this function handles the
 * most common formats returned by Veri5.
 */
function parseObligationsFromBureauRaw(raw_response, applicant_id, case_id) {
  if (!raw_response) return [];
  try {
    // Veri5 response structure — credit accounts array
    const accounts = raw_response?.creditAccounts
      || raw_response?.providerResponse?.creditAccounts
      || raw_response?.providerResponse?.data?.creditAccounts
      || [];

    return accounts
      .filter(acc => acc && (acc.accountStatus === 'Active' || !acc.accountStatus))
      .map(acc => ({
        case_id,
        applicant_id,
        lender_name:        acc.subscriberName || acc.lenderName || null,
        loan_type:          acc.accountType || acc.loanType || null,
        loan_amount:        parseFloat(acc.sanctionedAmount || acc.loanAmount || 0) || null,
        outstanding_amount: parseFloat(acc.currentBalance || acc.outstandingAmount || 0) || null,
        loan_start_date:    acc.opened || acc.openDate ? new Date(acc.opened || acc.openDate) : null,
        emi_per_month:      parseFloat(acc.emi || acc.emiAmount || 0) || 0,
        status:             'ACTIVE',
        source:             'BUREAU',
        needs_verification: !acc.emi && !acc.emiAmount // EMI is missing = needs DSA to verify
      }));
  } catch {
    return [];
  }
}

/**
 * syncObligationsFromBureau — auto-populates CaseCreditObligation from bureau raw responses.
 * Called when user opens the Bureau & Obligations page.
 * Uses upsert logic: matches on (case_id + applicant_id + lender_name + loan_type).
 */
async function syncObligationsFromBureau(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: { applicants: true }
  });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  // Fetch all successful bureau verifications for this case
  const bureauChecks = await prisma.bureauVerification.findMany({
    where: { case_id, status: 'SUCCESS' }
  });

  let created = 0;
  let skipped = 0;

  for (const check of bureauChecks) {
    const rawObligations = parseObligationsFromBureauRaw(check.raw_response, check.applicant_id, case_id);

    for (const obl of rawObligations) {
      // Upsert: match on unique enough combination to avoid creating duplicates on re-sync
      const existing = await prisma.caseCreditObligation.findFirst({
        where: {
          case_id,
          applicant_id:   obl.applicant_id,
          lender_name:    obl.lender_name,
          loan_type:      obl.loan_type,
          source:         'BUREAU'
        }
      });

      if (!existing) {
        await prisma.caseCreditObligation.create({ data: obl });
        created++;
      } else {
        // Only update non-edited fields (don't overwrite DSA-edited EMI)
        await prisma.caseCreditObligation.update({
          where: { id: existing.id },
          data: {
            outstanding_amount: obl.outstanding_amount,
            needs_verification: existing.emi_per_month === 0  // Re-flag if EMI still 0
          }
        });
        skipped++;
      }
    }
  }

  if (created > 0 || skipped > 0) {
    await markEsrInputsChanged(prisma, case_id);
  }

  return { created, skipped };
}

/**
 * getObligations — returns all obligations grouped by applicant for a case.
 */
async function getObligations(case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({
    where: { id: case_id, tenant_id },
    include: {
      applicants: true,
      obligations: {
        where: { status: 'ACTIVE' },
        orderBy: [{ applicant_id: 'asc' }, { created_at: 'asc' }]
      }
    }
  });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  // Group by applicant
  const grouped = caseRecord.applicants.map(app => {
    const appObligations = caseRecord.obligations.filter(o => o.applicant_id === app.id);
    const totalEmi = appObligations.reduce((sum, o) => sum + (Number(o.emi_per_month) || 0), 0);
    return {
      applicant: {
        id:            app.id,
        type:          app.type,
        name:          app.name || (app.type === 'PRIMARY' ? 'Primary Borrower' : `Co-Applicant`),
        pan_number:    app.pan_number,
        cibil_score:   app.cibil_score,
        bureau_fetched: app.bureau_fetched
      },
      obligations:   appObligations,
      total_emi:     totalEmi,
      active_count:  appObligations.length
    };
  });

  const allActive = caseRecord.obligations;
  const dedupedActive = dedupeObligations(allActive);
  const combinedEmi = dedupedActive.obligations.reduce((sum, o) => sum + (Number(o.emi_per_month) || 0), 0);
  const allScores = caseRecord.applicants.map(a => a.cibil_score).filter(Boolean);
  const lowestCibil = allScores.length ? Math.min(...allScores) : null;

  return {
    grouped,
    summary: {
      combined_emi_per_month: combinedEmi,
      lowest_cibil_score:     lowestCibil,
      raw_obligation_count:   allActive.length,
      deduped_obligation_count: dedupedActive.obligations.length,
      duplicate_obligation_notes: dedupedActive.duplicates.map(entry => entry.note)
    }
  };
}

/**
 * addObligation — manually adds a loan not in bureau.
 */
async function addObligation(case_id, payload, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  const { applicant_id, lender_name, loan_type, loan_amount, outstanding_amount, loan_start_date, emi_per_month, remarks } = payload;
  if (!applicant_id) throw new Error('applicant_id is required.');

  return prisma.$transaction(async (tx) => {
    const result = await tx.caseCreditObligation.create({
      data: {
        case_id,
        applicant_id: parseInt(applicant_id, 10),
        lender_name,
        loan_type,
        loan_amount:        parseNumericInput(loan_amount, 'loan_amount'),
        outstanding_amount: parseNumericInput(outstanding_amount, 'outstanding_amount'),
        loan_start_date:    loan_start_date    ? new Date(loan_start_date) : null,
        emi_per_month:      parseNumericInput(emi_per_month, 'emi_per_month') || 0,
        status:  'ACTIVE',
        source:  'MANUAL',
        remarks
      }
    });

    await markEsrInputsChanged(tx, case_id);

    return result;
  });
}

/**
 * updateObligation — edits an obligation (primarily for EMI correction by DSA).
 */
async function updateObligation(obligation_id, case_id, payload, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');

  const existing = await prisma.caseCreditObligation.findFirst({ where: { id: obligation_id, case_id } });
  if (!existing) throw new Error('Obligation not found.');

  const { emi_per_month, status, lender_name, loan_type, outstanding_amount, remarks } = payload;

  return prisma.$transaction(async (tx) => {
    const result = await tx.caseCreditObligation.update({
      where: { id: obligation_id },
      data: {
        ...(emi_per_month    !== undefined ? { emi_per_month: parseNumericInput(emi_per_month, 'emi_per_month', { nullable: false }), needs_verification: false } : {}),
        ...(status           !== undefined ? { status } : {}),
        ...(lender_name      !== undefined ? { lender_name } : {}),
        ...(loan_type        !== undefined ? { loan_type } : {}),
        ...(outstanding_amount !== undefined ? { outstanding_amount: parseNumericInput(outstanding_amount, 'outstanding_amount') } : {}),
        ...(remarks          !== undefined ? { remarks } : {}),
        updated_at: new Date()
      }
    });

    await markEsrInputsChanged(tx, case_id);

    return result;
  });
}

async function deleteObligation(obligation_id, case_id, tenant_id) {
  const caseRecord = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!caseRecord) throw new Error('Case not found or unauthorized.');
  const existing = await prisma.caseCreditObligation.findFirst({ where: { id: obligation_id, case_id } });
  if (!existing) throw new Error('Obligation not found.');

  return prisma.$transaction(async tx => {
    const result = await tx.caseCreditObligation.update({
      where: { id: obligation_id },
      data: { status: 'CLOSED', include_in_foir: false, updated_at: new Date() }
    });
    await markEsrInputsChanged(tx, case_id);
    return result;
  });
}

module.exports = {
  syncObligationsFromBureau,
  getObligations,
  addObligation,
  updateObligation,
  deleteObligation
};
