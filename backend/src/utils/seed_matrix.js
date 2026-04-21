const prisma = require('../../config/db');

const parameterMasterConfig = [
  // HL General parameters
  { key: 'hl_min_loan', label: 'Minimum Loan Amount - HL', category: 'Loan Parameters' },
  { key: 'hl_max_loan', label: 'Maximum Loan Amount - HL', category: 'Loan Parameters' },
  { key: 'hl_roi_min', label: 'ROI Range Min - HL', category: 'Loan Parameters' },
  { key: 'hl_roi_max', label: 'ROI Range Max - HL', category: 'Loan Parameters' },
  { key: 'hl_pf_min', label: 'PF Range Min - HL', category: 'Loan Parameters' },
  { key: 'hl_pf_max', label: 'PF Range Max - HL', category: 'Loan Parameters' },
  { key: 'hl_max_tenure', label: 'Max Tenure (Months) - HL', category: 'Loan Parameters' },
  { key: 'hl_dbr_foir', label: 'DBR/FOIR %', category: 'Loan Parameters' },
  
  // HL LTV
  { key: 'hl_ltv_residential', label: 'Residential Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_upto_30', label: 'Loan upto 30 lacs', category: 'HL LTV' },
  { key: 'hl_ltv_30_75', label: '>30 lac - 75 lacs', category: 'HL LTV' },
  { key: 'hl_ltv_above_75', label: '>75 lacs', category: 'HL LTV' },
  { key: 'hl_ltv_commercial', label: 'Comercial Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_industrial', label: 'Industrial Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_plot', label: 'Plot Purchase', category: 'HL LTV' },
  { key: 'hl_ltv_other', label: 'Any other point to be highlighted', category: 'HL LTV' },

  // LAP General parameters
  { key: 'lap_min_loan', label: 'Minimum Loan Amount - LAP', category: 'Loan Parameters' },
  { key: 'lap_max_loan', label: 'Maximum Loan Amount - LAP', category: 'Loan Parameters' },
  { key: 'lap_roi_min', label: 'ROI Range Min - LAP', category: 'Loan Parameters' },
  { key: 'lap_roi_max', label: 'ROI Range Max - LAP', category: 'Loan Parameters' },
  { key: 'lap_pf_min', label: 'PF Range Min - LAP', category: 'Loan Parameters' },
  { key: 'lap_pf_max', label: 'PF Range Max - LAP', category: 'Loan Parameters' },
  { key: 'lap_max_tenure', label: 'Max Tenure (Months) - LAP', category: 'Loan Parameters' },
  { key: 'lap_dbr_foir', label: 'DBR/FOIR % (LAP)', category: 'Loan Parameters' },

  // LAP LTV - Residential
  { key: 'lap_ltv_res_self', label: 'Self Occpied', category: 'LAP LTV - Residential' },
  { key: 'lap_ltv_res_rented', label: 'Rented', category: 'LAP LTV - Residential' },
  { key: 'lap_ltv_res_vacant', label: 'Vaccant', category: 'LAP LTV - Residential' },

  // LAP LTV - Commercial
  { key: 'lap_ltv_com_self', label: 'Self Occpied', category: 'LAP LTV - Commercial' },
  { key: 'lap_ltv_com_rented', label: 'Rented', category: 'LAP LTV - Commercial' },
  { key: 'lap_ltv_com_vacant', label: 'Vaccant', category: 'LAP LTV - Commercial' },

  // LAP LTV - Industrial
  { key: 'lap_ltv_ind_self', label: 'Self Occpied', category: 'LAP LTV - Industrial' },
  { key: 'lap_ltv_ind_rented', label: 'Rented', category: 'LAP LTV - Industrial' },
  { key: 'lap_ltv_ind_vacant', label: 'Vaccant', category: 'LAP LTV - Industrial' },

  // LAP LTV - Mixed Use
  { key: 'lap_ltv_mix_self', label: 'Self Occpied', category: 'LAP LTV - Mixed Use' },
  { key: 'lap_ltv_mix_rented', label: 'Rented', category: 'LAP LTV - Mixed Use' },
  { key: 'lap_ltv_mix_vacant', label: 'Vaccant', category: 'LAP LTV - Mixed Use' },

  // LAP LTV - Plot
  { key: 'lap_ltv_plot_self', label: 'Self Occpied', category: 'LAP LTV - Plot' },
  { key: 'lap_ltv_plot_rented', label: 'Rented', category: 'LAP LTV - Plot' },
  { key: 'lap_ltv_plot_vacant', label: 'Vaccant', category: 'LAP LTV - Plot' },

  // Special LAP
  { key: 'lap_ltv_special', label: 'Specialised Property', category: 'LAP LTV - Special' },

  // Age limits & Bureau
  { key: 'age_maturity_income', label: 'Income considered Applicant Age At Maturity', category: 'Age & Bureau' },
  { key: 'age_maturity_non_income', label: 'Non Income considered age at maturity', category: 'Age & Bureau' },
  { key: 'bureau_cutoff', label: 'Bureau Cut Off Score', category: 'Age & Bureau' },
  { key: 'bureau_name', label: 'Which Bureau', category: 'Age & Bureau' },

  // Eligibility / DBR Calculation
  { key: 'elig_rental_bank', label: 'Eligibility - Rental - Bank Credit', category: 'Eligibility Calculation' },
  { key: 'elig_rental_cash', label: 'Eligibility - Rental - Cash', category: 'Eligibility Calculation' },
  { key: 'elig_agri_itr', label: 'Eligibility - Agricultural Income ITR', category: 'Eligibility Calculation' },
  { key: 'dbr_rental_bank', label: 'DBR - Rental - Bank Credit - 100%', category: 'DBR/FOIR % Calculation' },
  { key: 'dbr_rental_cash', label: 'DBR - Rental - Cash - 50%', category: 'DBR/FOIR % Calculation' },
  { key: 'dbr_agri_itr', label: 'DBR - Agricultural Income ITR - 100%', category: 'DBR/FOIR % Calculation' },
  { key: 'existing_obligation', label: 'Existing Obligation', category: 'DBR/FOIR % Calculation' }
];

const schemeMapping = {
  'Salaried': 'SAL',
  'Net Profit Method': 'NPM',
  'Banking': 'BANK',
  'GST': 'GST',
  'GRP': 'GRP',
  'Net Worth Method': 'NWM'
};

const valueData = {
  HL: {
    hl_min_loan: { default: '500000' },
    hl_max_loan: { default: 'greter then 500000' },
    hl_roi_min: { default: '7.60%' },
    hl_roi_max: { default: '8.35%' },
    hl_pf_min: { default: '0.50%' },
    hl_pf_max: { default: '1%' },
    hl_max_tenure: { SAL: '300 Months', default: '240 Months' },
    hl_dbr_foir: { SAL: '<75k -60%, >75k - 70%', default: 'Max 100% ( Double wammy - 140%)' },
    
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
      BANK: 'No', GST: 'No', GRP: 'No',
      NWM: '50%, can be considered 100% if onweship proof provided.'
    },
    existing_obligation: { default: 'All Obligation to be considered except getting closed in next 12 months' }
  },
  LAP: {
    lap_min_loan: { default: '1000000' },
    lap_max_loan: { default: 'greter then 1000000' },
    lap_roi_min: { default: '8.25%' },
    lap_roi_max: { default: '10%' },
    lap_pf_min: { default: '0.50%' },
    lap_pf_max: { default: '1%' },
    lap_max_tenure: { default: '180 Months' },
    lap_dbr_foir: { SAL: '<75k -60%, >75k - 70%', default: 'Max 100% ( Double wammy - 140%)' },

    lap_ltv_res_self: { default: '70%' },
    lap_ltv_res_rented: { default: '70%' },
    lap_ltv_res_vacant: { default: '70%' },
    lap_ltv_com_self: { default: '70%' },
    lap_ltv_com_rented: { default: '70%' },
    lap_ltv_com_vacant: { default: '70%' },
    lap_ltv_ind_self: { default: '40%' },
    lap_ltv_ind_rented: { default: '40%' },
    lap_ltv_ind_vacant: { default: '0%' },
    lap_ltv_mix_self: { default: '70%' },
    lap_ltv_mix_rented: { default: '70%' },
    lap_ltv_mix_vacant: { default: '70%' },
    lap_ltv_plot_self: { default: '40%' },
    lap_ltv_plot_rented: { default: '40%' },
    lap_ltv_plot_vacant: { default: '40%' },
    lap_ltv_special: { default: '50%' },

    age_maturity_income: { default: '75' }, // 75% in sheet, but 75 makes sense
    age_maturity_non_income: { default: '75' },
    bureau_cutoff: { default: '700' },
    bureau_name: { default: 'CIBIL' },

    elig_rental_bank: { SAL: 'Yes', NPM: 'Yes', BANK: 'NO', GST: 'NO', GRP: 'NO', NWM: 'Yes' },
    elig_rental_cash: { default: 'NO' },
    elig_agri_itr: { default: 'NO' }, // Replaced blanks with NO

    dbr_rental_bank: { SAL: '70%', NPM: '70%', BANK: 'No', GST: 'No', GRP: 'No', NWM: '70%' },
    dbr_rental_cash: { default: 'No' },
    dbr_agri_itr: { default: 'No' },
    existing_obligation: { default: 'All Obligation to be considered except getting closed in next 12 months' }
  }
};

async function seedDataMatrix() {
  try {
    // 1. Seed Parameters
    let orderCounter = 1;
    for (const param of parameterMasterConfig) {
      await prisma.parameterMaster.upsert({
        where: { parameter_key: param.key },
        update: {
          parameter_label: param.label,
          category: param.category,
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
    for (let p of allParameters) {
        paramKeyMap[p.parameter_key] = p.id;
    }

    // 2. Insert Values
    // Fetch all required schemes
    const lenders = ['ICICI', 'HDFC'];
    const products = ['HL', 'LAP'];

    for (const lCode of lenders) {
      const lender = await prisma.lender.findUnique({ where: { code: lCode } });
      if (!lender) continue;

      for (const prodType of products) {
        const prod = await prisma.lenderProduct.findUnique({
          where: { lender_id_product_type: { lender_id: lender.id, product_type: prodType } }
        });
        if (!prod) continue;
        
        const dataSet = valueData[prodType];

        for (const schemeName of Object.keys(schemeMapping)) {
           const schemeObj = await prisma.scheme.findFirst({
              where: { product_id: prod.id, scheme_name: schemeName }
           });
           
           if (!schemeObj) continue;

           const mappedPrefix = schemeMapping[schemeName];

           for (const [paramKey, rule] of Object.entries(dataSet)) {
               const val = rule[mappedPrefix] !== undefined ? rule[mappedPrefix] : rule.default;
               if (!val || val === '') continue;
               
               const pId = paramKeyMap[paramKey];
               if (!pId) continue;

               await prisma.schemeParameterValue.upsert({
                   where: {
                       scheme_id_parameter_id: {
                           scheme_id: schemeObj.id,
                           parameter_id: pId
                       }
                   },
                   update: {
                       value: val
                   },
                   create: {
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
  } catch (e) {
    console.error('Migration Matrix error:', e);
  }
}

module.exports = seedDataMatrix;
