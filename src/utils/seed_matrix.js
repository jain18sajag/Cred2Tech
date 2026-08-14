const prisma = require('../../config/db');

const parameterMasterConfig = [
  { key: 'hl_min_loan', label: 'Minimum Loan Amount - HL', category: 'Loan Parameters' },
  { key: 'hl_max_loan', label: 'Maximum Loan Amount - HL', category: 'Loan Parameters' },
  { key: 'hl_roi_min', label: 'ROI Range Min - HL', category: 'Loan Parameters' },
  { key: 'hl_roi_max', label: 'ROI Range Max - HL', category: 'Loan Parameters' },
  { key: 'hl_pf_min', label: 'PF Range Min - HL', category: 'Loan Parameters' },
  { key: 'hl_pf_max', label: 'PF Range Max - HL', category: 'Loan Parameters' },
  { key: 'hl_max_tenure', label: 'Max Tenure (Months) - HL', category: 'Loan Parameters' },
  { key: 'hl_dbr_foir', label: 'DBR/FOIR %', category: 'Loan Parameters' },

  { key: 'hl_ltv_residential', label: 'Residential Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_upto_30', label: 'Loan upto 30 lacs', category: 'HL LTV' },
  { key: 'hl_ltv_30_75', label: '>30 lac - 75 lacs', category: 'HL LTV' },
  { key: 'hl_ltv_above_75', label: '>75 lacs', category: 'HL LTV' },
  { key: 'hl_ltv_commercial', label: 'Comercial Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_industrial', label: 'Industrial Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_plot', label: 'Plot Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_other', label: 'Any other point to be highlighted', category: 'HL LTV' },

  { key: 'lap_min_loan', label: 'Minimum Loan Amount - LAP', category: 'Loan Parameters' },
  { key: 'lap_max_loan', label: 'Maximum Loan Amount - LAP', category: 'Loan Parameters' },
  { key: 'lap_roi_min', label: 'ROI Range Min - LAP', category: 'Loan Parameters' },
  { key: 'lap_roi_max', label: 'ROI Range Max - LAP', category: 'Loan Parameters' },
  { key: 'lap_pf_min', label: 'PF Range Min - LAP', category: 'Loan Parameters' },
  { key: 'lap_pf_max', label: 'PF Range Max - LAP', category: 'Loan Parameters' },
  { key: 'lap_max_tenure', label: 'Max Tenure (Months) - LAP', category: 'Loan Parameters' },
  { key: 'lap_dbr_foir', label: 'DBR/FOIR % (LAP)', category: 'Loan Parameters' },

  { key: 'lap_ltv_res_self', label: 'Self Occpied', category: 'LAP LTV - Residential' },
  { key: 'lap_ltv_res_rented', label: 'Rented', category: 'LAP LTV - Residential' },
  { key: 'lap_ltv_res_vacant', label: 'Vaccant', category: 'LAP LTV - Residential' },

  { key: 'lap_ltv_com_self', label: 'Self Occpied', category: 'LAP LTV - Commercial' },
  { key: 'lap_ltv_com_rented', label: 'Rented', category: 'LAP LTV - Commercial' },
  { key: 'lap_ltv_com_vacant', label: 'Vaccant', category: 'LAP LTV - Commercial' },

  { key: 'lap_ltv_ind_self', label: 'Self Occpied', category: 'LAP LTV - Industrial' },
  { key: 'lap_ltv_ind_rented', label: 'Rented', category: 'LAP LTV - Industrial' },
  { key: 'lap_ltv_ind_vacant', label: 'Vaccant', category: 'LAP LTV - Industrial' },

  { key: 'lap_ltv_mix_self', label: 'Self Occpied', category: 'LAP LTV - Mixed Use' },
  { key: 'lap_ltv_mix_rented', label: 'Rented', category: 'LAP LTV - Mixed Use' },
  { key: 'lap_ltv_mix_vacant', label: 'Vaccant', category: 'LAP LTV - Mixed Use' },

  { key: 'lap_ltv_plot_self', label: 'Self Occpied', category: 'LAP LTV - Plot' },
  { key: 'lap_ltv_plot_rented', label: 'Rented', category: 'LAP LTV - Plot' },
  { key: 'lap_ltv_plot_vacant', label: 'Vaccant', category: 'LAP LTV - Plot' },

  { key: 'lap_ltv_special', label: 'Specialised Property', category: 'LAP LTV - Special' },

  { key: 'age_maturity_income', label: 'Income considered Applicant Age At Maturity', category: 'Age & Bureau' },
  { key: 'age_maturity_non_income', label: 'Non Income considered age at maturity', category: 'Age & Bureau' },
  { key: 'bureau_cutoff', label: 'Bureau Cut Off Score', category: 'Age & Bureau' },
  { key: 'bureau_name', label: 'Which Bureau', category: 'Age & Bureau' },

  { key: 'elig_rental_bank', label: 'Eligibility - Rental - Bank Credit', category: 'Eligibility Calculation' },
  { key: 'elig_rental_cash', label: 'Eligibility - Rental - Cash', category: 'Eligibility Calculation' },
  { key: 'elig_agri_itr', label: 'Eligibility - Agricultural Income ITR', category: 'Eligibility Calculation' },
  { key: 'dbr_rental_bank', label: 'DBR - Rental - Bank Credit - 100%', category: 'DBR/FOIR % Calculation' },
  { key: 'dbr_rental_cash', label: 'DBR - Rental - Cash - 50%', category: 'DBR/FOIR % Calculation' },
  { key: 'dbr_agri_itr', label: 'DBR - Agricultural Income ITR - 100%', category: 'DBR/FOIR % Calculation' },
  { key: 'existing_obligation', label: 'Existing Obligation', category: 'DBR/FOIR % Calculation' },

  { key: 'banking_abb_multiplier', label: 'ABB Income Multiplier (Banking)', category: 'Eligibility Calculation' },
  { key: 'no_dbr_months_multiplier', label: 'No-DBR Income Multiplier (months)', category: 'Eligibility Calculation' },
  { key: 'grp_annual_receipts_multiplier', label: 'GRP Annual Receipts Multiplier', category: 'Eligibility Calculation' },
  { key: 'npm_depreciation_fraction', label: 'NPM Depreciation Addback Fraction', category: 'Eligibility Calculation' },
  { key: 'nwm_loan_percent', label: 'Net Worth → Max Loan % (NWM)', category: 'Eligibility Calculation' },

  { key: 'min_loan_hl', label: 'Min Loan (HL)', category: 'LOAN RANGE PARAMETERS' },
  { key: 'max_loan_hl', label: 'Max Loan (HL)', category: 'LOAN RANGE PARAMETERS' },
  { key: 'min_loan_lap', label: 'Min Loan (LAP)', category: 'LOAN RANGE PARAMETERS' },
  { key: 'max_loan_lap', label: 'Max Loan (LAP)', category: 'LOAN RANGE PARAMETERS' },
  { key: 'roi_range_hl', label: 'ROI Range (HL)', category: 'ROI PARAMETERS' },
  { key: 'roi_range_lap', label: 'ROI Range (LAP)', category: 'ROI PARAMETERS' },
  { key: 'processing_fee_hl', label: 'Processing Fee (HL)', category: 'PROCESSING FEES' },
  { key: 'processing_fee_lap', label: 'Processing Fee (LAP)', category: 'PROCESSING FEES' },
  { key: 'max_tenure_hl', label: 'Max Tenure (HL months)', category: 'TENURE' },
  { key: 'max_tenure_lap', label: 'Max Tenure (LAP months)', category: 'TENURE' },
  { key: 'age_income_applicant', label: 'Age Eligibility (Income Applicant)', category: 'AGE ELIGIBILITY' },
  { key: 'age_non_income_applicant', label: 'Age Eligibility (Non-Income Applicant)', category: 'AGE ELIGIBILITY' },
  { key: 'min_cibil_score', label: 'Min CIBIL Score', category: 'BUREAU PARAMETERS' },
  { key: 'bureau_type', label: 'Bureau Preference', category: 'BUREAU PARAMETERS' },
  { key: 'income_method', label: 'Income Method Rules', category: 'INCOME ELIGIBILITY' },
  { key: 'foir', label: 'FOIR Slab', category: 'INCOME ELIGIBILITY' },
  { key: 'insr', label: 'INSR Logic', category: 'INCOME ELIGIBILITY' },
  { key: 'rental_income_bank', label: 'Rental Income (Banked)', category: 'OTHER INCOME SOURCES' },
  { key: 'rental_income_cash', label: 'Rental Income (Cash)', category: 'OTHER INCOME SOURCES' },
  { key: 'agriculture_income', label: 'Agriculture Income', category: 'OTHER INCOME SOURCES' },
  { key: 'existing_obligation_rule', label: 'Existing Obligation Deductions', category: 'EXISTING OBLIGATION RULE' },
  { key: 'ltv_residential_self', label: 'Residential Self Occupied', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_residential_rented', label: 'Residential Rented', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_residential_vacant', label: 'Residential Vacant', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_commercial_self', label: 'Commercial Self Occupied', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_commercial_rented', label: 'Commercial Rented', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_commercial_vacant', label: 'Commercial Vacant', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_industrial_self', label: 'Industrial Self Occupied', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_industrial_rented', label: 'Industrial Rented', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_plot_property', label: 'Plot Property', category: 'LAP LTV PARAMETERS' },
  { key: 'ltv_special_property', label: 'Special Property', category: 'LAP LTV PARAMETERS' },
  { key: 'hl_ltv_30_to_75', label: 'LTV > 30L & <= 75L', category: 'HL LTV PARAMETERS' }
];

const schemeMapping = {
  Salaried: 'SAL',
  'Net Profit Method': 'NPM',
  'NET PROFIT METHOD': 'NPM',
  'Cash Profit Method': 'NPM',
  'ITR Based': 'NPM',
  Banking: 'BANK',
  BANKING: 'BANK',
  'ABB Method': 'BANK',
  GST: 'GST',
  'GST Method': 'GST',
  'gross Margin Method': 'GST',
  'Gross Margin Method': 'GST',
  GRP: 'GRP',
  LIP: 'LIP',
  'Low LTV': 'LOW_LTV',
  'LOW LTV': 'LOW_LTV',
  'Net Worth Method': 'NWM',
  'Assessed income program(AIP)': 'AIP',
  'Assessed Income Program': 'AIP',
  'Any other method': 'ANY'
};

// Source: lender requirement workbooks supplied for the 2026-07 policy rollout.
// Only explicit numeric/text policy values are seeded. Tata is the exception:
// per the business instruction, blank cells in its workbook are stored as 0.
const lenderPolicyValues = {
  INDIA_SHELTERS: {
    HL: { hl_min_loan: '500000', hl_max_loan: { SAL: '7000000', NPM: '7000000', BANK: '30000000', GRP: '100000000', LIP: '15000000', LOW_LTV: '15000000', GST: '100000000', AIP: '3500000' }, hl_roi_min: '13%', hl_roi_max: '18%', hl_pf_min: '2%', hl_pf_max: '3%', hl_max_tenure: '240 Months', age_maturity_income: { SAL: '60', NPM: '75', AIP: '75', default: '70' }, age_maturity_non_income: '90', bureau_cutoff: null, bureau_name: 'CIBIL, CRIF', hl_dbr_foir: { SAL: '70%', NPM: '100% if ABB is at least 1x proposed EMI, else 80%', BANK: '67%', GRP: '100%', LIP: '100% if ABB is at least 1x proposed EMI, else 80%', LOW_LTV: null, GST: '100% if ABB is at least 1x proposed EMI, else 80%', AIP: '70%' }, elig_rental_bank: { BANK: 'NO', LOW_LTV: null, default: 'YES' }, elig_rental_cash: { BANK: 'NO', LOW_LTV: null, default: 'YES' }, elig_agri_itr: 'NO', dbr_rental_bank: { BANK: 'NO', default: '100%' }, dbr_rental_cash: { SAL: '50%', NPM: '50%', BANK: 'NO', AIP: '50%', default: '100%' }, dbr_agri_itr: 'NO', existing_obligation: { BANK: 'Loan availed in last 6 months: EMI reduced from ABB; same-statement EMI not obligated; other-bank EMI obligated', LOW_LTV: 'No obligation', default: 'All obligations considered except those closing in next 12 months' }, hl_ltv_upto_30: { SAL: '75%', NPM: '75%', LOW_LTV: null, AIP: '75%', default: '90%' }, hl_ltv_30_75: { SAL: '75%', NPM: '75%', LOW_LTV: null, AIP: '75%', default: '80%' }, hl_ltv_above_75: { LOW_LTV: null, default: '75%' }, hl_ltv_commercial: null, hl_ltv_industrial: null, hl_ltv_plot: null },
    LAP: { lap_min_loan: '500000', lap_max_loan: { AIP: '2000000', default: '5000000' }, lap_roi_min: '15%', lap_roi_max: '21%', lap_pf_min: '4%', lap_pf_max: '5%', lap_max_tenure: '180 Months', age_maturity_income: { SAL: '60', NPM: '75', AIP: '75', default: '70' }, age_maturity_non_income: '90', bureau_cutoff: null, bureau_name: 'CIBIL, CRIF', lap_dbr_foir: { SAL: '70%', NPM: '100% if ABB is at least 1x proposed EMI, else 80%', BANK: '67%', GRP: '100%', LIP: '100% if ABB is at least 1x proposed EMI, else 80%', LOW_LTV: null, GST: '100% if ABB is at least 1x proposed EMI, else 80%', AIP: '60%' }, elig_rental_bank: { BANK: 'NO', LOW_LTV: null, default: 'YES' }, elig_rental_cash: { BANK: 'NO', LOW_LTV: null, default: 'YES' }, elig_agri_itr: 'NO', dbr_rental_bank: { BANK: 'NO', default: '100%' }, dbr_rental_cash: { SAL: '50%', NPM: '50%', BANK: 'NO', AIP: '50%', default: '100%' }, dbr_agri_itr: 'NO', existing_obligation: { BANK: 'Loan availed in last 6 months: EMI reduced from ABB; same-statement EMI not obligated; other-bank EMI obligated', LOW_LTV: 'No obligation', default: 'All obligations considered except those closing in next 12 months' }, lap_ltv_res_self: { SAL: '50%', NPM: '50%', LOW_LTV: '50%', AIP: '50%', default: '70%' }, lap_ltv_res_rented: '50%', lap_ltv_res_vacant: { LOW_LTV: null, default: '50%' }, lap_ltv_com_self: null, lap_ltv_com_rented: null, lap_ltv_com_vacant: null, lap_ltv_ind_self: null, lap_ltv_ind_rented: null, lap_ltv_ind_vacant: null, lap_ltv_mix_self: { SAL: '50%', NPM: '50%', LOW_LTV: null, AIP: '50%', default: '65%' }, lap_ltv_mix_rented: { SAL: '50%', NPM: '50%', LOW_LTV: null, AIP: '50%', default: '55%' }, lap_ltv_mix_vacant: { SAL: '50%', NPM: '50%', LOW_LTV: null, AIP: '50%', default: '45%' }, lap_ltv_plot_self: null, lap_ltv_plot_rented: null, lap_ltv_plot_vacant: null, lap_ltv_special: { BANK: '50%', GRP: '50%', LIP: '50%', default: null } }
  },
  PIRAMAL: {
    HL: { hl_min_loan: '500000', hl_max_loan: { SAL: '30000000', BANK: '30000000', AIP: '2500000', LIP: '15000000', LOW_LTV: '15000000', default: '100000000' }, hl_roi_min: '9.99%', hl_roi_max: '14%', hl_pf_min: '1%', hl_pf_max: '2%', hl_max_tenure: '300 Months', age_maturity_income: { SAL: '60', default: '70' }, age_maturity_non_income: { SAL: '70', default: '90' }, bureau_name: 'CIBIL', hl_dbr_foir: { SAL: '<40000 - 50%, <50000 - 65%, >=50000 - 70%', BANK: '67%', NPM: '80%', GRP: '100%', GST: '80%', AIP: '50%' }, hl_ltv_upto_30: '90%', hl_ltv_30_75: '80%', hl_ltv_above_75: '75%', hl_ltv_commercial: '70%', hl_ltv_industrial: '50%', hl_ltv_plot: '65%' },
    LAP: { lap_min_loan: '500000', lap_max_loan: { SAL: '75000000', BANK: '30000000', AIP: '2500000', LIP: '15000000', LOW_LTV: '15000000', default: '100000000' }, lap_roi_min: '11.75%', lap_roi_max: '14%', lap_pf_min: '1.25%', lap_pf_max: '2%', lap_max_tenure: '180 Months', age_maturity_income: { SAL: '60', default: '70' }, age_maturity_non_income: { SAL: '70', default: '90' }, bureau_cutoff: null, bureau_name: { LOW_LTV: null, GST: null, AIP: null, default: 'CIBIL' }, lap_dbr_foir: { SAL: '<40000 - 50%, <50000 - 65%, >=50000 - 70%', NPM: '100% if ABB is at least 1x proposed EMI, else 80%', BANK: '67%', GRP: '100%', LIP: '100% if ABB is at least 1x proposed EMI, else 80%', LOW_LTV: null, GST: '100% if ABB is at least 1x proposed EMI, else 80%', AIP: '50%' }, elig_rental_bank: { SAL: 'NO', BANK: 'NO', LOW_LTV: null, default: 'YES' }, elig_rental_cash: { SAL: 'NO', BANK: 'NO', LOW_LTV: null, default: 'YES' }, elig_agri_itr: 'NO', dbr_rental_bank: { SAL: 'NO', BANK: 'NO', default: '100%' }, dbr_rental_cash: { SAL: 'NO', BANK: 'NO', default: '100%' }, dbr_agri_itr: 'NO', existing_obligation: { BANK: 'Loan availed in last 6 months: EMI reduced from ABB; same-statement EMI not obligated; other-bank EMI obligated', LOW_LTV: 'No obligation', default: 'All obligations considered except those closing in next 12 months' }, lap_ltv_res_self: { LOW_LTV: '50%', default: '70%' }, lap_ltv_res_rented: { LOW_LTV: null, default: '60%' }, lap_ltv_res_vacant: { LOW_LTV: null, default: '50%' }, lap_ltv_com_self: { SAL: null, LOW_LTV: '50%', default: '70%' }, lap_ltv_com_rented: { SAL: null, LOW_LTV: null, default: '60%' }, lap_ltv_com_vacant: { SAL: null, LOW_LTV: null, default: '50%' }, lap_ltv_ind_self: { SAL: null, LOW_LTV: null, default: '60%' }, lap_ltv_ind_rented: { SAL: null, LOW_LTV: null, default: '60%' }, lap_ltv_ind_vacant: { SAL: null, LOW_LTV: null, default: '50% (GP limit 45%)' }, lap_ltv_mix_self: { SAL: null, LOW_LTV: null, default: '65%' }, lap_ltv_mix_rented: { SAL: null, LOW_LTV: null, default: '55%' }, lap_ltv_mix_vacant: { SAL: null, LOW_LTV: null, default: '45%' }, lap_ltv_plot_self: { SAL: null, LOW_LTV: null, default: '50% (GP limit 45%)' }, lap_ltv_plot_rented: { SAL: null, LOW_LTV: null, default: 'NOT_ALLOWED' }, lap_ltv_plot_vacant: { SAL: null, LOW_LTV: null, default: 'NOT_ALLOWED' }, lap_ltv_special: { SAL: null, LOW_LTV: null, GST: null, AIP: null, default: '50%' } }
  },
  TATA_HOUSING: {
    HL: { hl_min_loan: { SAL: '500000', NPM: '500000', BANK: '1000000', GST: '3000000', GRP: '2000000', LIP: '5000000', LOW_LTV: '1000000' }, hl_max_loan: { LIP: '25000000', LOW_LTV: '30000000', default: '75000000' }, hl_roi_min: '7.5%', hl_roi_max: '8.5%', hl_pf_min: null, hl_pf_max: null, hl_max_tenure: { SAL: '360 Months', default: '240 Months' }, age_maturity_income: { SAL: '60', default: '70' }, age_maturity_non_income: '75', bureau_cutoff: '700', bureau_name: 'CIBIL', hl_dbr_foir: { SAL: '<70000 - 60%, <150000 - 65%, >=150000 - 70%', BANK: '55%', NPM: '80%', GST: '80%', GRP: '70%', LIP: '65%', LOW_LTV: null }, existing_obligation: { BANK: 'Loan availed in last 6 months: EMI reduced from ABB; loans closed in the last 12 months or closing shortly are added back to ABB; cash-out uses the last balance before loan credit for ABB', LOW_LTV: 'No obligation', NWM: null, ANY: null, default: 'All obligations considered except those closing in next 12 months' }, hl_ltv_upto_30: { LOW_LTV: '50%', default: '90%' }, hl_ltv_30_75: { LOW_LTV: '50%', default: '80%' }, hl_ltv_above_75: { LOW_LTV: '50%', default: '75%' }, hl_ltv_commercial: { LOW_LTV: null, default: '70%' }, hl_ltv_industrial: { LOW_LTV: null, default: '70%' }, hl_ltv_plot: { LOW_LTV: null, default: '70%' } },
    LAP: { lap_min_loan: { SAL: '500000', NPM: '500000', BANK: '1000000', GST: '3000000', GRP: '2000000', LIP: '5000000', LOW_LTV: '1000000' }, lap_max_loan: { LIP: '25000000', LOW_LTV: '30000000', default: '75000000' }, lap_roi_min: '9%', lap_roi_max: '10.5%', lap_pf_min: '0%', lap_pf_max: '1.5%', lap_max_tenure: '180 Months', age_maturity_income: { SAL: '60', default: '70' }, age_maturity_non_income: '75', bureau_cutoff: '700', bureau_name: 'CIBIL', lap_dbr_foir: { SAL: '<70000 - 60%, <150000 - 65%, >=150000 - 70%', BANK: '55%', NPM: '80%', GST: '80%', GRP: '70%', LIP: '65%', LOW_LTV: null }, existing_obligation: { BANK: 'Loan availed in last 6 months: EMI reduced from ABB; loans closed in the last 12 months or closing shortly are added back to ABB; cash-out uses the last balance before loan credit for ABB', LOW_LTV: 'No obligation', NWM: null, ANY: null, default: 'All obligations considered except those closing in next 12 months' }, lap_ltv_res_self: { LOW_LTV: '50%', default: '70%' }, lap_ltv_res_rented: { SAL: null, LOW_LTV: '40%', default: '65%' }, lap_ltv_res_vacant: { SAL: null, LIP: 'NOT_ALLOWED', LOW_LTV: 'NOT_ALLOWED', default: '60%' }, lap_ltv_com_self: { SAL: null, LOW_LTV: '50%', default: '60%' }, lap_ltv_com_rented: { SAL: null, LOW_LTV: '40%', default: '55%' }, lap_ltv_com_vacant: { SAL: null, LIP: 'NOT_ALLOWED', LOW_LTV: 'NOT_ALLOWED', default: '50%' }, lap_ltv_ind_self: { SAL: null, default: '45%' }, lap_ltv_ind_rented: { SAL: null, default: '45%' }, lap_ltv_ind_vacant: { SAL: null, default: 'NOT_ALLOWED' }, lap_ltv_mix_self: null, lap_ltv_mix_rented: null, lap_ltv_mix_vacant: null, lap_ltv_plot_self: null, lap_ltv_plot_rented: null, lap_ltv_plot_vacant: null, lap_ltv_special: { SAL: null, LOW_LTV: null, default: '50%' } }
  }
};

// Explicit business override: these three lenders do not block ESR on a
// minimum bureau score. Keep ICICI and HDFC configuration untouched.
for (const lenderCode of ['INDIA_SHELTERS', 'PIRAMAL', 'TATA_HOUSING']) {
  for (const productType of ['HL', 'LAP']) {
    lenderPolicyValues[lenderCode][productType].bureau_cutoff = '0';
  }
}

function resolvePolicySeedValue(lenderCode, productType, paramKey, schemePrefix, fallbackRule) {
  const lenderPolicy = lenderPolicyValues[lenderCode]?.[productType];
  const configured = lenderPolicy?.[paramKey];
  const rule = lenderPolicy ? configured : fallbackRule;
  const resolved = rule && typeof rule === 'object'
    ? (rule[schemePrefix] !== undefined ? rule[schemePrefix] : rule.default)
    : rule;

  if (lenderCode === 'TATA_HOUSING' && (resolved === null || resolved === undefined || resolved === '')) {
    return '0';
  }
  return resolved;
}

function hasExplicitLenderPolicyParam(lenderCode, productType, paramKey) {
  return Object.prototype.hasOwnProperty.call(lenderPolicyValues[lenderCode]?.[productType] || {}, paramKey);
}

const valueData = {
  HL: {
    hl_min_loan: { default: '500000' },
    hl_max_loan: { default: 'No Capping' },
    hl_roi_min: { default: '7.60%' },
    hl_roi_max: { default: '8.35%' },
    hl_pf_min: { default: '0.50%' },
    hl_pf_max: { default: '1%' },
    hl_max_tenure: { SAL: '300 Months', default: '240 Months' },
    hl_dbr_foir: { SAL: '<75k -60%, >75k - 70%', BANK: 'No DBR', GST: 'Max 100% ( Double wammy - 140%)', GRP: 'No DBR', default: 'Max 100% ( Double wammy - 140%)' },

    banking_abb_multiplier: { default: '3' },
    no_dbr_months_multiplier: { default: '60' },
    npm_depreciation_fraction: { default: '66.67%' },

    hl_ltv_residential: { default: '0' },
    hl_ltv_upto_30: { default: '90%' },
    hl_ltv_30_75: { default: '80%' },
    hl_ltv_above_75: { default: '75%' },
    hl_ltv_commercial: { default: '75%' },
    hl_ltv_industrial: { default: '40%' },
    hl_ltv_plot: { default: '75%' },
    hl_ltv_other: { default: '0%' },

    age_maturity_income: { SAL: '70 - in income >1 lacs, 60 if income < 1 lacs', default: '75' },
    age_maturity_non_income: { default: '75' },
    bureau_cutoff: { default: '700' },
    bureau_name: { default: 'CIBIL' },

    elig_rental_bank: { SAL: 'Yes', NPM: 'Yes', BANK: 'NO', GST: 'NO', GRP: 'NO', NWM: 'Yes' },
    elig_rental_cash: { default: 'NO' },
    elig_agri_itr: { SAL: 'Yes', NPM: 'Yes', BANK: 'NO', GST: 'NO', GRP: 'NO', NWM: 'Yes' },

    dbr_rental_bank: { SAL: '70%', NPM: '70%', BANK: 'No', GST: 'No', GRP: 'No', NWM: '70%' },
    dbr_rental_cash: { default: 'No' },
    dbr_agri_itr: {
      SAL: '50%, can be considered 100% if onweship proof provided.',
      NPM: '50%, can be considered 100% if onweship proof provided.',
      BANK: 'No',
      GST: 'No',
      GRP: 'No',
      NWM: '50%, can be considered 100% if onweship proof provided.'
    },
    existing_obligation: { BANK: 'Loan availed in last 12 months to be obligated', default: 'All Obligation to be considered except getting closed in next 12 months' }
  },
  LAP: {
    lap_min_loan: { default: '1000000' },
    lap_max_loan: { default: 'No Capping' },
    lap_roi_min: { default: '8.25%' },
    lap_roi_max: { default: '10%' },
    lap_pf_min: { default: '0.50%' },
    lap_pf_max: { default: '1%' },
    lap_max_tenure: { default: '180 Months' },
    lap_dbr_foir: { SAL: '<75k -60%, >75k - 70%', BANK: 'No DBR', GST: '90%', GRP: 'No DBR', default: 'Max 100% ( Double wammy - 140%)' },

    banking_abb_multiplier: { default: '3' },
    no_dbr_months_multiplier: { default: '60' },
    grp_annual_receipts_multiplier: { default: '4' },
    npm_depreciation_fraction: { default: '66.67%' },
    nwm_loan_percent: { default: '15%' },

    lap_ltv_res_self: { default: '70%' },
    lap_ltv_res_rented: { SAL: '65%', default: '70%' },
    lap_ltv_res_vacant: { SAL: '60%', default: '70%' },
    lap_ltv_com_self: { default: '70%' },
    lap_ltv_com_rented: { default: '70%' },
    lap_ltv_com_vacant: { default: '70%' },
    lap_ltv_ind_self: { default: '40%' },
    lap_ltv_ind_rented: { default: '40%' },
    lap_ltv_ind_vacant: { default: 'MANUAL_REVIEW_REQUIRED' },
    lap_ltv_mix_self: { default: '70%' },
    lap_ltv_mix_rented: { default: '70%' },
    lap_ltv_mix_vacant: { default: '70%' },
    lap_ltv_plot_self: { SAL: '60%', default: '40%' },
    lap_ltv_plot_rented: { SAL: '65%', default: '40%' },
    lap_ltv_plot_vacant: { default: '40%' },
    lap_ltv_special: { default: '50%' },

    age_maturity_income: { SAL: '70 - in income >1 lacs, 60 if income < 1 lacs', default: '75' },
    age_maturity_non_income: { default: '75' },
    bureau_cutoff: { default: '700' },
    bureau_name: { default: 'CIBIL' },

    elig_rental_bank: { SAL: 'Yes', NPM: 'Yes', BANK: 'NO', GST: 'NO', GRP: 'NO', NWM: 'Yes' },
    elig_rental_cash: { default: 'NO' },
    elig_agri_itr: { SAL: 'Yes', NPM: 'Yes', BANK: 'NO', GST: 'NO', GRP: 'NO', NWM: 'Yes' },

    dbr_rental_bank: { SAL: '70%', NPM: '70%', BANK: 'No', GST: 'No', GRP: 'No', NWM: '70%' },
    dbr_rental_cash: { default: 'No' },
    dbr_agri_itr: {
      SAL: '50%, can be considered 100% if onweship proof provided.',
      NPM: '50%, can be considered 100% if onweship proof provided.',
      BANK: 'No',
      GST: 'No',
      GRP: 'No',
      NWM: '50%, can be considered 100% if onweship proof provided.'
    },
    existing_obligation: { BANK: 'Loan availed in last 12 months to be obligated', default: 'All Obligation to be considered except getting closed in next 12 months' }
  }
};

async function cleanInvalidSeedValues() {
  // Keep this cleanup database-portable. The previous UPDATE ... JOIN and
  // JSON_UNQUOTE form was MySQL-only and failed on the project's PostgreSQL DB.
  const candidates = await prisma.schemeParameterValue.findMany({
    where: {
      parameter: {
        parameter_key: { in: ['hl_max_loan', 'lap_max_loan'] }
      }
    },
    select: { id: true, value: true }
  });

  const invalidIds = candidates
    .filter(({ value }) => /\b(greter|greater|then)\b/i.test(String(value ?? '')))
    .map(({ id }) => id);

  if (invalidIds.length > 0) {
    await prisma.schemeParameterValue.updateMany({
      where: { id: { in: invalidIds } },
      data: { value: 'No Capping' }
    });
  }
}

async function seedDataMatrix() {
  try {
    await cleanInvalidSeedValues();

    let orderCounter = 1;
    for (const param of parameterMasterConfig) {
      await prisma.parameterMaster.upsert({
        where: { parameter_key: param.key },
        update: {
          parameter_label: param.label,
          category: param.category
        },
        create: {
          parameter_key: param.key,
          parameter_label: param.label,
          category: param.category,
          data_type: 'string',
          display_order: orderCounter++
        }
      });
    }

    console.log('[seed] Parameter Master seeded updated.');

    const allParameters = await prisma.parameterMaster.findMany();
    const paramKeyMap = {};

    for (const p of allParameters) {
      paramKeyMap[p.parameter_key] = p.id;
    }

    // Apply the approved zero-cutoff override to every active method, including
    // legacy-named Tata schemes that may predate the canonical scheme names.
    const bureauCutoffParameterId = paramKeyMap.bureau_cutoff;
    if (bureauCutoffParameterId) {
      const zeroCutoffSchemes = await prisma.scheme.findMany({
        where: {
          status: 'ACTIVE',
          product: {
            status: 'ACTIVE',
            product_type: { in: ['HL', 'LAP'] },
            lender: { code: { in: ['INDIA_SHELTERS', 'PIRAMAL', 'TATA_HOUSING'] } }
          }
        },
        select: { id: true }
      });

      for (const scheme of zeroCutoffSchemes) {
        await prisma.schemeParameterValue.upsert({
          where: {
            scheme_id_parameter_id: {
              scheme_id: scheme.id,
              parameter_id: bureauCutoffParameterId
            }
          },
          update: { value: '0' },
          create: {
            scheme_id: scheme.id,
            parameter_id: bureauCutoffParameterId,
            value: '0'
          }
        });
      }
    }

    // This workbook runner is isolated to the three lenders in this rollout.
    // ICICI/HDFC retain their existing database configuration and calculation paths.
    const lenders = ['INDIA_SHELTERS', 'PIRAMAL', 'TATA_HOUSING'];
    const products = ['HL', 'LAP'];

    for (const lCode of lenders) {
      const lender = await prisma.lender.findUnique({ where: { code: lCode } });
      if (!lender) continue;

      for (const prodType of products) {
        const prod = await prisma.lenderProduct.findUnique({
          where: {
            lender_id_product_type: {
              lender_id: lender.id,
              product_type: prodType
            }
          }
        });

        if (!prod) continue;

        const dataSet = valueData[prodType];

        for (const schemeName of Object.keys(schemeMapping)) {
          const schemeObj = await prisma.scheme.findFirst({
            where: {
              product_id: prod.id,
              scheme_name: schemeName
            }
          });

          if (!schemeObj) continue;

          const existingRows = await prisma.schemeParameterValue.findMany({
            where: { scheme_id: schemeObj.id },
            select: { id: true, parameter_id: true, value: true }
          });

          const existingByParamId = new Map(existingRows.map((row) => [row.parameter_id, row]));
          const mappedPrefix = schemeMapping[schemeName];

          for (const [paramKey, rule] of Object.entries(dataSet)) {
            const val = resolvePolicySeedValue(lCode, prodType, paramKey, mappedPrefix, rule);
            const pId = paramKeyMap[paramKey];
            if (!pId) continue;
            const existing = existingByParamId.get(pId);
            const isWorkbookManaged = hasExplicitLenderPolicyParam(lCode, prodType, paramKey);

            if (val === null || val === undefined || val === '') {
              if (isWorkbookManaged && existing) {
                await prisma.schemeParameterValue.delete({ where: { id: existing.id } });
              }
              continue;
            }

            if (existing) {
              if (isWorkbookManaged && JSON.stringify(existing.value) !== JSON.stringify(val)) {
                await prisma.schemeParameterValue.update({
                  where: { id: existing.id },
                  data: { value: val }
                });
              }
              continue;
            }

            await prisma.schemeParameterValue.create({
              data: {
                scheme_id: schemeObj.id,
                parameter_id: pId,
                value: val
              }
            });
          }
        }
      }
    }

    console.log('[seed] Matrix Data values updated successfully.');
  } catch (error) {
    console.error('Migration Matrix error:', error);
    throw error;
  }
}

module.exports = seedDataMatrix;
