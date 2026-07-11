const { PrismaClient } = require('@prisma/client');
const { normalizeParameter, isCriticalParameter } = require('../src/utils/esrParsers');

const prisma = new PrismaClient();
const MANUAL_REVIEW = 'MANUAL_REVIEW_REQUIRED';
const NOT_ALLOWED = 'NOT_ALLOWED';

const EXTRA_PARAMETERS = [
  // Lender identification / exposure
  { key: 'lender_policy_key', label: 'Lender Policy Key', category: 'Lender Policy', data_type: 'string' },
  { key: 'bureau_hard_reject_below', label: 'Bureau Hard-Reject Floor', category: 'Lender Policy', data_type: 'integer' },
  { key: 'grp_exposure_field', label: 'GRP Exposure Field', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'hdfc_exposure_field', label: 'HDFC Exposure Field', category: 'Eligibility Calculation', data_type: 'string' },

  // HDFC salaried policy
  { key: 'hdfc_salaried_salary_pct_upto_1lakh', label: 'HDFC Salaried Salary % Up To 1 Lakh', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'hdfc_salaried_salary_pct_above_1lakh', label: 'HDFC Salaried Salary % Above 1 Lakh', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'hdfc_salaried_bank_salary_cap_pct', label: 'HDFC Salaried Bank Salary Cap %', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'hdfc_salaried_salary_threshold', label: 'HDFC Salaried Salary Threshold', category: 'Eligibility Calculation', data_type: 'money' },

  // HDFC banking policy
  { key: 'banking_abb_days', label: 'Banking ABB Sample Days', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'banking_abb_divisor_upto_75l', label: 'Banking ABB Divisor Up To 75L', category: 'Eligibility Calculation', data_type: 'integer' },
  { key: 'banking_abb_divisor_above_75l', label: 'Banking ABB Divisor Above 75L', category: 'Eligibility Calculation', data_type: 'integer' },
  { key: 'banking_loan_switch_threshold', label: 'Banking Loan Switch Threshold', category: 'Eligibility Calculation', data_type: 'money' },
  { key: 'banking_business_credit_cap_multiplier', label: 'Banking Business Credit Cap Multiplier', category: 'Eligibility Calculation', data_type: 'number' },
  { key: 'banking_obligation_treatment', label: 'Banking Obligation Treatment', category: 'Eligibility Calculation', data_type: 'string' },

  // HDFC GST margins
  { key: 'gst_margin_manufacturing', label: 'GST Margin - Manufacturing', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'gst_margin_factory', label: 'GST Margin - Factory', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'gst_margin_wholesale', label: 'GST Margin - Wholesale', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'gst_margin_retail', label: 'GST Margin - Retail', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'gst_margin_service', label: 'GST Margin - Service', category: 'Eligibility Calculation', data_type: 'percent' },

  // HDFC NPM / GRP / DSCR
  { key: 'npm_growth_threshold', label: 'NPM Growth Threshold', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'npm_two_year_rule', label: 'NPM Two Year Rule', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'npm_depreciation_fraction', label: 'NPM Depreciation Fraction', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'hdfc_other_income_policy', label: 'HDFC Other Income Policy', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'hdfc_unsecured_pos_treatment', label: 'HDFC Unsecured POS Treatment', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'grp_doctor_multiplier', label: 'GRP Doctor Multiplier', category: 'Eligibility Calculation', data_type: 'number' },
  { key: 'grp_other_professional_multiplier', label: 'GRP Other Professional Multiplier', category: 'Eligibility Calculation', data_type: 'number' },
  { key: 'dscr_min_ratio', label: 'DSCR Minimum Ratio', category: 'Eligibility Calculation', data_type: 'number' },
  { key: 'dscr_obligation_multiplier', label: 'DSCR Obligation Multiplier', category: 'Eligibility Calculation', data_type: 'integer' },
  { key: 'dscr_calculation_rule', label: 'DSCR Calculation Rule', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'dscr_income_source_rule', label: 'DSCR Income Source Rule', category: 'Eligibility Calculation', data_type: 'string' },
  { key: 'nwm_active', label: 'Net Worth Method Active', category: 'Eligibility Calculation', data_type: 'boolean' },
  { key: 'nwm_depreciation_fraction', label: 'NWM Depreciation Fraction', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'nwm_property_addon_annual_pct', label: 'NWM Property Add-on Annual %', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'nwm_financial_asset_annual_pct', label: 'NWM Financial Asset Annual %', category: 'Eligibility Calculation', data_type: 'percent' },
  { key: 'nwm_cibil_high', label: 'NWM CIBIL Threshold - 1.5L Income', category: 'Eligibility Calculation', data_type: 'integer' },
  { key: 'nwm_income_high_cibil', label: 'NWM Income Threshold - CIBIL 770', category: 'Eligibility Calculation', data_type: 'money' },
  { key: 'nwm_cibil_standard', label: 'NWM CIBIL Threshold - 3L Income', category: 'Eligibility Calculation', data_type: 'integer' },
  { key: 'nwm_income_standard_cibil', label: 'NWM Income Threshold - CIBIL 750', category: 'Eligibility Calculation', data_type: 'money' },
  { key: 'manual_scheme_only', label: 'Manual Scheme Only', category: 'Eligibility Calculation', data_type: 'boolean' },
  { key: 'manual_scheme_notes', label: 'Manual Scheme Notes', category: 'Eligibility Calculation', data_type: 'string' },
];

function normalizeValue(pKey, rawValue) {
  if (rawValue === MANUAL_REVIEW || rawValue === NOT_ALLOWED) {
    return {
      raw: rawValue,
      normalized: null,
      type: rawValue === NOT_ALLOWED ? 'not_allowed' : 'unsupported_rule',
      error: rawValue === NOT_ALLOWED
        ? 'Explicitly not allowed by HDFC LAP policy'
        : 'Explicitly marked for manual review based on HDFC LAP policy'
    };
  }

  try {
    return normalizeParameter(pKey, String(rawValue));
  } catch (e) {
    return { raw: String(rawValue), normalized: null, type: 'unsupported_rule', error: e.message };
  }
}

function buildHdfcLapMapping() {
  const LAP_COMMON = {
    lender_policy_key: 'HDFC_LAP',
    lap_min_loan: '1100000',
    lap_max_loan: 'No Capping',
    lap_roi_min: '8%',
    lap_roi_max: '10.25%',
    lap_pf_min: '0.35%',
    lap_pf_max: '1%',
    lap_max_tenure: '180 Months',
    age_maturity_income: '65',
    age_maturity_non_income: '75',
    bureau_cutoff: '740',
    // Below this floor is a hard reject; between this and bureau_cutoff is still
    // eligible but requires deviation approval (matches the reference eligibility
    // engine's HDFC_LAP_NORMS.bureau_hard_reject_below).
    bureau_hard_reject_below: '710',
    bureau_name: 'CIBIL',
    hdfc_other_income_policy: 'Rental bank/ITR income only for NPM/DSCR at 100% capped to main business profit. Rental cash and agriculture not considered.',
    hdfc_unsecured_pos_treatment: 'For HDFC unsecured loans, deduct POS from final eligible loan amount instead of EMI obligation for Salaried/NPM/GST/GRP; add EMI back to ABB for Banking.',

    // HDFC LAP LTV matrix
    lap_ltv_res_self: '65%',
    lap_ltv_res_rented: '65%',
    lap_ltv_res_vacant: '65%',
    lap_ltv_com_self: '65%',
    lap_ltv_com_rented: '65%',
    lap_ltv_com_vacant: '65%',
    lap_ltv_ind_self: '50%',
    lap_ltv_ind_rented: '50%',
    lap_ltv_ind_vacant: NOT_ALLOWED,
    lap_ltv_mix_self: '65%',
    lap_ltv_mix_rented: '65%',
    lap_ltv_mix_vacant: '65%',
    lap_ltv_plot_self: '30%',
    lap_ltv_plot_rented: '30%',
    lap_ltv_plot_vacant: '30%',
    lap_ltv_special: '50%',

    // HDFC obligation rule common default
    existing_obligation: 'All obligations considered except loans closing in next 12 months. For HDFC unsecured loans in Salaried/NPM/GST/GRP, POS is deducted from final eligible loan amount instead of EMI obligation.'
  };

  return {
    LAP: {
      Salaried: {
        ...LAP_COMMON,
        age_maturity_income: '58',
        bureau_cutoff: '710',
        lap_max_tenure: '180 Months',
        lap_dbr_foir: '50%, 60%',
        hdfc_salaried_salary_threshold: '100000',
        hdfc_salaried_salary_pct_upto_1lakh: '50%',
        hdfc_salaried_salary_pct_above_1lakh: '60%',
        hdfc_salaried_bank_salary_cap_pct: '70%',
        lap_ltv_ind_self: MANUAL_REVIEW,
        lap_ltv_ind_rented: MANUAL_REVIEW,
        lap_ltv_ind_vacant: NOT_ALLOWED,
        lap_ltv_plot_self: MANUAL_REVIEW,
        lap_ltv_plot_rented: MANUAL_REVIEW,
        lap_ltv_plot_vacant: MANUAL_REVIEW,
        lap_ltv_special: NOT_ALLOWED,
      },

      'Net Profit Method': {
        ...LAP_COMMON,
        lap_max_tenure: '180 Months',
        lap_dbr_foir: '65%',
        npm_depreciation_fraction: '100%',
        npm_growth_threshold: '100%',
        npm_two_year_rule: 'IF_GROWTH_GT_100_USE_2_YEAR_AVERAGE_ELSE_LATEST_YEAR'
      },

      Banking: {
        ...LAP_COMMON,
        lap_max_loan: '50000000',
        lap_max_tenure: '120 Months',
        lap_dbr_foir: 'No DBR',
        banking_abb_days: '5,15,25',
        banking_abb_divisor_upto_75l: '3',
        banking_abb_divisor_above_75l: '4',
        banking_loan_switch_threshold: '7500000',
        banking_business_credit_cap_multiplier: '1',
        banking_obligation_treatment: 'ADD_EMI_TO_ABB',
        existing_obligation: 'ADD_EMI_TO_ABB'
      },

      GST: {
        ...LAP_COMMON,
        lap_max_loan: '50000000',
        lap_max_tenure: '120 Months',
        lap_dbr_foir: '65%',
        gst_margin_manufacturing: '8%',
        gst_margin_factory: '8%',
        gst_margin_wholesale: '9%',
        gst_margin_retail: '9%',
        gst_margin_service: '10%'
      },

      GRP: {
        ...LAP_COMMON,
        lap_max_loan: '50000000',
        lap_max_tenure: '120 Months',
        lap_dbr_foir: 'No DBR',
        grp_doctor_multiplier: '4',
        grp_other_professional_multiplier: '3',
        grp_annual_receipts_multiplier: '4',
        grp_exposure_field: 'hdfc_exposure',
        hdfc_exposure_field: 'hdfc_exposure'
      },

      'Net Worth Method': {
        ...LAP_COMMON,
        lap_min_loan: '50000000',
        lap_max_loan: 'No Capping',
        lap_max_tenure: '180 Months',
        age_maturity_income: '65',
        age_maturity_non_income: '75',
        bureau_cutoff: '740',
        nwm_active: 'Yes',
        nwm_depreciation_fraction: '66.67%',
        nwm_property_addon_annual_pct: '3%',
        nwm_financial_asset_annual_pct: '5%',
        nwm_cibil_high: '770',
        nwm_income_high_cibil: '150000',
        nwm_cibil_standard: '750',
        nwm_income_standard_cibil: '300000'
      },

      DSCR: {
        ...LAP_COMMON,
        lap_min_loan: '50000000',
        lap_max_loan: 'No Capping',
        lap_dbr_foir: 'No DBR',
        lap_max_tenure: '180 Months',
        age_maturity_income: '65',
        age_maturity_non_income: '75',
        dscr_min_ratio: '1.25',
        dscr_obligation_multiplier: '12',
        dscr_calculation_rule: 'ANNUAL_INCOME_DIVIDED_BY_ANNUAL_OBLIGATION_PLUS_PROPOSED_ANNUAL_EMI',
        dscr_income_source_rule: 'USE_DIRECT_ANNUAL_INCOME_OR_ITR_NPM_ANNUAL_INCOME_FALLBACK'
      }
    }
  };
}

const HDFC_MAPPING = buildHdfcLapMapping();

const UNSUPPORTED_HDFC_LAP_SCHEMES = [
  'LIP',
  'Low LTV'
];

function isUnsupportedHdfcLapSchemeName(name) {
  const canonical = normalizeSchemeKey(name);
  return UNSUPPORTED_HDFC_LAP_SCHEMES.includes(canonical);
}

const REQUIRED_HDFC_LAP_SCHEMES = [
  'Salaried',
  'Net Profit Method',
  'Banking',
  'GST',
  'GRP',
  'Net Worth Method',
  'DSCR'
];

function normalizeSchemeKey(name) {
  const text = String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (text.includes('SALARIED')) return 'Salaried';
  if (text.includes('NET') && text.includes('PROFIT')) return 'Net Profit Method';
  if (text === 'BANKING' || text.includes('BANKING')) return 'Banking';
  if (text === 'GST' || text.includes('GST')) return 'GST';
  if (text.includes('GRP') || text.includes('GROSS RECEIPT')) return 'GRP';
  if (text.includes('LIP')) return 'LIP';
  if (text.includes('LOW') && text.includes('LTV')) return 'Low LTV';
  if (text.includes('NET') && text.includes('WORTH')) return 'Net Worth Method';
  if (text.includes('DSCR') || text.includes('DCSR')) return 'DSCR';
  return String(name || '').trim();
}

function getHdfcLapSchemeMapping(mapping, schemeName) {
  const canonical = normalizeSchemeKey(schemeName);
  return mapping[schemeName] || mapping[canonical] || null;
}

async function ensureHdfcLapSchemes(lapProductId, userId, stats, isApply) {
  const existingSchemes = await prisma.scheme.findMany({ where: { product_id: lapProductId } });
  const existingCanonical = new Map(existingSchemes.map(s => [normalizeSchemeKey(s.scheme_name), s]));

  for (const schemeName of REQUIRED_HDFC_LAP_SCHEMES) {
    if (existingCanonical.has(schemeName)) continue;
    stats.schemes_to_create += 1;

    if (!isApply) {
      console.log(`[DRY RUN] Would create missing HDFC LAP scheme: ${schemeName}`);
      continue;
    }

    await prisma.scheme.create({
      data: {
        product_id: lapProductId,
        scheme_name: schemeName,
        status: 'ACTIVE',
        created_by: userId,
        updated_by: userId
      }
    });
    console.log(`Created missing HDFC LAP scheme: ${schemeName}`);
  }
}



async function deactivateUnsupportedHdfcLapSchemes(lapProductId, userId, stats, isApply) {
  const schemes = await prisma.scheme.findMany({ where: { product_id: lapProductId } });
  const unsupported = schemes.filter(s => isUnsupportedHdfcLapSchemeName(s.scheme_name) && String(s.status || '').toUpperCase() !== 'INACTIVE');

  for (const scheme of unsupported) {
    stats.schemes_to_deactivate += 1;

    if (!isApply) {
      console.log(`[DRY RUN] Would deactivate unsupported HDFC LAP scheme: ${scheme.scheme_name}`);
      continue;
    }

    await prisma.scheme.update({
      where: { id: scheme.id },
      data: { status: 'INACTIVE', updated_by: userId }
    });
    console.log(`Deactivated unsupported HDFC LAP scheme: ${scheme.scheme_name}`);
  }
}

async function ensureParameterMaster(extraParameters, stats, isApply) {
  const existing = await prisma.parameterMaster.findMany();
  const byKey = new Map(existing.map(p => [p.parameter_key, p]));
  const maxDisplayOrder = existing.reduce((max, p) => Math.max(max, Number(p.display_order) || 0), 0);
  const created = [];

  for (let i = 0; i < extraParameters.length; i += 1) {
    const p = extraParameters[i];
    if (byKey.has(p.key)) continue;

    created.push(p.key);
    stats.parameters_to_create += 1;

    if (isApply) {
      await prisma.parameterMaster.create({
        data: {
          parameter_key: p.key,
          parameter_label: p.label,
          category: p.category || 'Eligibility Calculation',
          data_type: p.data_type || 'string',
          display_order: maxDisplayOrder + i + 1,
          is_editable_label: false
        }
      });
    }
  }

  return created;
}

function parseArgs() {
  const args = {
    apply: process.argv.includes('--apply'),
    dryRun: !process.argv.includes('--apply'),
    userId: 1,
    lenderId: null
  };

  for (const arg of process.argv) {
    if (arg.startsWith('--user-id=')) args.userId = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--lender-id=')) args.lenderId = arg.split('=')[1];
  }

  return args;
}

async function findHdfcLender(targetLenderId) {
  if (targetLenderId) {
    const lender = await prisma.lender.findUnique({ where: { id: targetLenderId } });
    if (!lender) throw new Error(`Failed to find lender with ID: ${targetLenderId}`);
    return lender;
  }

  const matches = await prisma.lender.findMany({
    where: {
      OR: [
        { name: { contains: 'HDFC', mode: 'insensitive' } },
        { code: { contains: 'HDFC', mode: 'insensitive' } }
      ]
    }
  });

  if (matches.length === 0) throw new Error('Failed to find any HDFC lender. Use --lender-id=<id>.');
  if (matches.length > 1) {
    const list = matches.map(m => ` - ${m.id} : ${m.name} (${m.code || 'NO_CODE'})`).join('\n');
    throw new Error(`Found multiple HDFC lenders. Please specify --lender-id=...\n${list}`);
  }
  return matches[0];
}

async function run() {
  const args = parseArgs();
  const isApply = args.apply;

  console.log(`\n=== HDFC LAP LENDER PARAMETER UPDATE SCRIPT [${isApply ? 'APPLY MODE' : 'DRY RUN'}] ===\n`);
  console.log('Usage:');
  console.log('  node backend/scripts/update-hdfc-lap-parameters.js --apply --user-id=1');
  console.log('  node backend/scripts/update-hdfc-lap-parameters.js --apply --lender-id=<HDFC_LENDER_ID> --user-id=1\n');

  if (isApply && !args.userId) {
    throw new Error('--user-id=<id> is required in apply mode.');
  }

  const stats = {
    parameters_to_create: 0,
    schemes_to_create: 0,
    schemes_to_deactivate: 0,
    total_checked: 0,
    total_planned: 0,
    total_updated: 0,
    total_skipped: 0,
    total_failed: 0,
    total_not_allowed: 0,
    total_manual_review: 0
  };
  const unmatchedSchemes = new Set();
  const unmatchedParameters = new Set();
  const reviewList = [];

  const createdParamKeys = await ensureParameterMaster(EXTRA_PARAMETERS, stats, isApply);
  if (createdParamKeys.length > 0) {
    console.log(`${isApply ? 'Created' : 'Would create'} missing ParameterMaster keys:`);
    createdParamKeys.forEach(k => console.log(`  - ${k}`));
  }

  const lender = await findHdfcLender(args.lenderId);
  console.log(`Found Target Lender: ${lender.name} (ID: ${lender.id}, Code: ${lender.code || 'N/A'})`);

  const lapProduct = await prisma.lenderProduct.findFirst({ where: { lender_id: lender.id, product_type: 'LAP' } });
  if (!lapProduct) throw new Error('HDFC LAP product not found for this lender. Please create LAP product first.');

  await ensureHdfcLapSchemes(lapProduct.id, args.userId, stats, isApply);
  await deactivateUnsupportedHdfcLapSchemes(lapProduct.id, args.userId, stats, isApply);

  const parameters = await prisma.parameterMaster.findMany();
  const paramKeyToId = Object.fromEntries(parameters.map(p => [p.parameter_key, p.id]));

  const allSchemes = await prisma.scheme.findMany({ where: { product_id: lapProduct.id } });
  const schemes = allSchemes.filter(s => !isUnsupportedHdfcLapSchemeName(s.scheme_name) && String(s.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  const mapping = HDFC_MAPPING.LAP;
  const dbOps = [];

  console.log(`\n--- Processing Product: LAP | Schemes Found: ${schemes.length} ---`);

  for (const scheme of schemes) {
    const mappedSchemeValues = getHdfcLapSchemeMapping(mapping, scheme.scheme_name);
    if (!mappedSchemeValues) {
      unmatchedSchemes.add(`LAP - ${scheme.scheme_name}`);
      continue;
    }

    const existingValues = await prisma.schemeParameterValue.findMany({ where: { scheme_id: scheme.id } });
    const existingParamMap = Object.fromEntries(existingValues.map(ev => [ev.parameter_id, ev]));

    for (const [pKey, rawValue] of Object.entries(mappedSchemeValues)) {
      stats.total_checked += 1;
      const paramId = paramKeyToId[pKey];
      if (!paramId) {
        unmatchedParameters.add(pKey);
        stats.total_skipped += 1;
        continue;
      }

      const normalizedPayload = normalizeValue(pKey, rawValue);
      if (rawValue === MANUAL_REVIEW) stats.total_manual_review += 1;
      if (rawValue === NOT_ALLOWED) stats.total_not_allowed += 1;

      const isCrit = isCriticalParameter(pKey);
      const isFail = normalizedPayload.type === 'unsupported_rule' || normalizedPayload.error || (normalizedPayload.normalized === null && normalizedPayload.type !== 'no_cap' && normalizedPayload.type !== 'not_allowed');
      if (isCrit && isFail && rawValue !== MANUAL_REVIEW && rawValue !== NOT_ALLOWED) {
        reviewList.push({ scheme: scheme.scheme_name, param: pKey, value: rawValue, reason: normalizedPayload.error || 'Validation failed' });
        stats.total_failed += 1;
      }

      const existingVal = existingParamMap[paramId];
      stats.total_planned += 1;

      if (!isApply) {
        console.log(`[DRY RUN] LAP > ${scheme.scheme_name} > ${pKey}`);
        console.log(`  - Old Value:  ${existingVal ? JSON.stringify(existingVal.value) : 'None'}`);
        console.log(`  - New Raw:    ${rawValue}`);
        console.log(`  - Normalized: ${JSON.stringify(normalizedPayload)}`);
        console.log('  - Action:     WOULD_UPDATE\n');
      } else {
        dbOps.push(prisma.schemeParameterValue.upsert({
          where: { scheme_id_parameter_id: { scheme_id: scheme.id, parameter_id: paramId } },
          update: { value: normalizedPayload, updated_by: args.userId },
          create: { scheme_id: scheme.id, parameter_id: paramId, value: normalizedPayload, created_by: args.userId, updated_by: args.userId }
        }));
      }
    }
  }

  if (isApply && dbOps.length > 0) {
    console.log(`\nExecuting ${dbOps.length} updates in transaction...`);
    await prisma.$transaction(dbOps);
    stats.total_updated = dbOps.length;
    console.log('DB update complete.');
  }

  console.log('\n================ HDFC LAP UPDATE SUMMARY ================');
  console.log(`Mode:                    ${isApply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Missing params created:  ${stats.parameters_to_create}`);
  console.log(`Missing schemes created: ${stats.schemes_to_create}`);
  console.log(`HDFC unsupported schemes deactivated: ${stats.schemes_to_deactivate}`);
  console.log(`Total cells checked:     ${stats.total_checked}`);
  console.log(`Total planned updates:   ${stats.total_planned}`);
  console.log(`Total applied updates:   ${stats.total_updated}`);
  console.log(`Total skipped:           ${stats.total_skipped}`);
  console.log(`Total validation failed: ${stats.total_failed}`);
  console.log(`Manual review markers:   ${stats.total_manual_review}`);
  console.log(`Not allowed markers:     ${stats.total_not_allowed}`);

  if (unmatchedSchemes.size > 0) {
    console.log('\nUnmatched schemes. Create/rename scheme or add mapping if needed:');
    [...unmatchedSchemes].forEach(s => console.log(`  - ${s}`));
  }

  if (unmatchedParameters.size > 0) {
    console.log('\nUnmatched ParameterMaster keys. Add them to seed_matrix/parameter_master if you want config UI support:');
    [...unmatchedParameters].forEach(p => console.log(`  - ${p}`));
  }

  if (reviewList.length > 0) {
    console.log('\nValidation review required:');
    reviewList.forEach(r => console.log(`  - ${r.scheme} | ${r.param} = ${r.value}: ${r.reason}`));
  }
}

run()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
