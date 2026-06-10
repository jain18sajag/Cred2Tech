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
  Banking: 'BANK',
  GST: 'GST',
  GRP: 'GRP',
  'Net Worth Method': 'NWM'
};

const valueData = {
  HL: {
    hl_min_loan: { default: '500000' },
    hl_max_loan: { default: 'No Capping' },
    hl_roi_min: { default: '7.60%' },
    hl_roi_max: { default: '8.35%' },
    hl_pf_min: { default: '0.50%' },
    hl_pf_max: { default: '1%' },
    hl_max_tenure: { SAL: '300 Months', default: '240 Months' },
    hl_dbr_foir: { SAL: '<75k -60%, >75k - 70%', default: 'Max 100% ( Double wammy - 140%)' },

    banking_abb_multiplier: { default: '2' },
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

    age_maturity_income: { SAL: '70 - in income >1 lacs, 60 if income < 1 lacs and 75', default: '75' },
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
    existing_obligation: { default: 'All Obligation to be considered except getting closed in next 12 months' }
  },
  LAP: {
    lap_min_loan: { default: '1000000' },
    lap_max_loan: { default: 'No Capping' },
    lap_roi_min: { default: '8.25%' },
    lap_roi_max: { default: '10%' },
    lap_pf_min: { default: '0.50%' },
    lap_pf_max: { default: '1%' },
    lap_max_tenure: { default: '180 Months' },
    lap_dbr_foir: { SAL: '<75k -60%, >75k - 70%', default: 'Max 100% ( Double wammy - 140%)' },

    banking_abb_multiplier: { default: '2' },
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
    lap_ltv_ind_vacant: { default: '0%' },
    lap_ltv_mix_self: { default: '70%' },
    lap_ltv_mix_rented: { default: '70%' },
    lap_ltv_mix_vacant: { default: '70%' },
    lap_ltv_plot_self: { SAL: '60%', default: '40%' },
    lap_ltv_plot_rented: { SAL: '65%', default: '40%' },
    lap_ltv_plot_vacant: { default: '40%' },
    lap_ltv_special: { default: '50%' },

    age_maturity_income: { default: '75' },
    age_maturity_non_income: { default: '75' },
    bureau_cutoff: { default: '700' },
    bureau_name: { default: 'CIBIL' },

    elig_rental_bank: { SAL: 'Yes', NPM: 'Yes', BANK: 'NO', GST: 'NO', GRP: 'NO', NWM: 'Yes' },
    elig_rental_cash: { default: 'NO' },
    elig_agri_itr: { default: 'NO' },

    dbr_rental_bank: { SAL: '70%', NPM: '70%', BANK: 'No', GST: 'No', GRP: 'No', NWM: '70%' },
    dbr_rental_cash: { default: 'No' },
    dbr_agri_itr: { default: 'No' },
    existing_obligation: { default: 'All Obligation to be considered except getting closed in next 12 months' }
  }
};

async function cleanInvalidSeedValues() {
  await prisma.$executeRaw`
    UPDATE scheme_parameter_values spv
    JOIN parameter_master pm ON pm.id = spv.parameter_id
    SET spv.value = ${JSON.stringify('No Capping')}
    WHERE pm.parameter_key IN ('hl_max_loan', 'lap_max_loan')
      AND (
        LOWER(JSON_UNQUOTE(spv.value)) LIKE '%greter%'
        OR LOWER(JSON_UNQUOTE(spv.value)) LIKE '%greater%'
        OR LOWER(JSON_UNQUOTE(spv.value)) LIKE '%then%'
      )
  `;
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

    const lenders = ['ICICI', 'HDFC'];
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
            select: { parameter_id: true }
          });

          const existingParamIds = new Set(existingRows.map((row) => row.parameter_id));
          const mappedPrefix = schemeMapping[schemeName];

          for (const [paramKey, rule] of Object.entries(dataSet)) {
            const val = rule[mappedPrefix] !== undefined ? rule[mappedPrefix] : rule.default;
            if (!val || val === '') continue;

            const pId = paramKeyMap[paramKey];
            if (!pId) continue;
            if (existingParamIds.has(pId)) continue;

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
  }
}

module.exports = seedDataMatrix;