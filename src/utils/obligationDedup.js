function normalizeText(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ');
}

function normalizeDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function normalizeAmount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? String(Math.round(num)) : '';
}

function buildObligationKey(obligation = {}) {
  const lender = normalizeText(obligation.lender_name || obligation.lenderName);
  const loanType = normalizeText(obligation.loan_type || obligation.loanType);
  const startDate = normalizeDate(obligation.loan_start_date || obligation.startDate);
  const balance = normalizeAmount(obligation.outstanding_amount || obligation.outstandingAmount);
  const loanAmount = normalizeAmount(obligation.loan_amount || obligation.loanAmount);
  const emi = normalizeAmount(obligation.emi_per_month || obligation.emi || obligation.monthlyPayment);
  const amountFingerprint = balance || loanAmount || emi;

  if (!lender || !loanType || !amountFingerprint) return null;
  return [lender, loanType, startDate, amountFingerprint].join('|');
}

function shouldReplaceDuplicate(current = {}, candidate = {}) {
  const currentIncluded = current.include_in_foir !== false;
  const candidateIncluded = candidate.include_in_foir !== false;
  if (candidateIncluded !== currentIncluded) return candidateIncluded;

  const currentEmi = Number(current.emi_per_month) || 0;
  const candidateEmi = Number(candidate.emi_per_month) || 0;
  if (candidateEmi !== currentEmi) return candidateEmi > currentEmi;

  const currentUpdated = current.updated_at ? new Date(current.updated_at).getTime() : 0;
  const candidateUpdated = candidate.updated_at ? new Date(candidate.updated_at).getTime() : 0;
  return candidateUpdated > currentUpdated;
}

function describeObligation(obligation = {}) {
  const lender = obligation.lender_name || 'Unknown lender';
  const loanType = obligation.loan_type || 'Loan';
  const emi = Number(obligation.emi_per_month) || 0;
  return `${lender} ${loanType} EMI ${emi.toLocaleString('en-IN')}`;
}

function dedupeObligations(obligations = []) {
  const ordered = [];
  const byKey = new Map();
  const duplicates = [];

  for (const obligation of Array.isArray(obligations) ? obligations : []) {
    const key = buildObligationKey(obligation);

    if (!key) {
      ordered.push(obligation);
      continue;
    }

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, obligation);
      ordered.push(obligation);
      continue;
    }

    const replacementWins = shouldReplaceDuplicate(existing, obligation);
    const kept = replacementWins ? obligation : existing;
    const skipped = replacementWins ? existing : obligation;

    if (replacementWins) {
      const index = ordered.indexOf(existing);
      if (index >= 0) ordered[index] = obligation;
      byKey.set(key, obligation);
    }

    duplicates.push({
      key,
      kept_id: kept.id || null,
      skipped_id: skipped.id || null,
      kept_applicant_id: kept.applicant_id || null,
      skipped_applicant_id: skipped.applicant_id || null,
      note: `Duplicate obligation ignored for ESR: kept ${describeObligation(kept)}, skipped duplicate row ${skipped.id || 'N/A'} for applicant ${skipped.applicant_id || 'N/A'}.`
    });
  }

  return { obligations: ordered, duplicates };
}

module.exports = {
  dedupeObligations,
  dedupeBureauObligations: dedupeObligations
};
