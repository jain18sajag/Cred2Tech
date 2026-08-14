const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PARAMETERS = [
  // LOAN RANGE
  { parameter_key: 'min_loan_hl', parameter_label: 'Min Loan (HL)', category: 'LOAN RANGE PARAMETERS', data_type: 'currency_range', display_order: 1 },
  { parameter_key: 'max_loan_hl', parameter_label: 'Max Loan (HL)', category: 'LOAN RANGE PARAMETERS', data_type: 'currency_range', display_order: 2 },
  { parameter_key: 'min_loan_lap', parameter_label: 'Min Loan (LAP)', category: 'LOAN RANGE PARAMETERS', data_type: 'currency_range', display_order: 3 },
  { parameter_key: 'max_loan_lap', parameter_label: 'Max Loan (LAP)', category: 'LOAN RANGE PARAMETERS', data_type: 'currency_range', display_order: 4 },
  
  // ROI
  { parameter_key: 'roi_range_hl', parameter_label: 'ROI Range (HL)', category: 'ROI PARAMETERS', data_type: 'percentage_range', display_order: 5 },
  { parameter_key: 'roi_range_lap', parameter_label: 'ROI Range (LAP)', category: 'ROI PARAMETERS', data_type: 'percentage_range', display_order: 6 },
  
  // PROCESSING FEES
  { parameter_key: 'processing_fee_hl', parameter_label: 'Processing Fee (HL)', category: 'PROCESSING FEES', data_type: 'percentage_range', display_order: 7 },
  { parameter_key: 'processing_fee_lap', parameter_label: 'Processing Fee (LAP)', category: 'PROCESSING FEES', data_type: 'percentage_range', display_order: 8 },
  
  // TENURE
  { parameter_key: 'max_tenure_hl', parameter_label: 'Max Tenure (HL months)', category: 'TENURE', data_type: 'integer', display_order: 9 },
  { parameter_key: 'max_tenure_lap', parameter_label: 'Max Tenure (LAP months)', category: 'TENURE', data_type: 'integer', display_order: 10 },
  
  // AGE ELIGIBILITY
  { parameter_key: 'age_income_applicant', parameter_label: 'Age Eligibility (Income Applicant)', category: 'AGE ELIGIBILITY', data_type: 'string', display_order: 11 },
  { parameter_key: 'age_non_income_applicant', parameter_label: 'Age Eligibility (Non-Income Applicant)', category: 'AGE ELIGIBILITY', data_type: 'string', display_order: 12 },
  
  // BUREAU
  { parameter_key: 'min_cibil_score', parameter_label: 'Min CIBIL Score', category: 'BUREAU PARAMETERS', data_type: 'integer', display_order: 13 },
  { parameter_key: 'bureau_type', parameter_label: 'Bureau Preference', category: 'BUREAU PARAMETERS', data_type: 'string', display_order: 14 },
  
  // INCOME
  { parameter_key: 'income_method', parameter_label: 'Income Method Rules', category: 'INCOME ELIGIBILITY', data_type: 'json_slab', display_order: 15 },
  { parameter_key: 'foir', parameter_label: 'FOIR Slab', category: 'INCOME ELIGIBILITY', data_type: 'json_slab', display_order: 16 },
  { parameter_key: 'insr', parameter_label: 'INSR Logic', category: 'INCOME ELIGIBILITY', data_type: 'json_slab', display_order: 17 },
  
  // OTHER INCOME
  { parameter_key: 'rental_income_bank', parameter_label: 'Rental Income (Banked)', category: 'OTHER INCOME SOURCES', data_type: 'percentage', display_order: 18 },
  { parameter_key: 'rental_income_cash', parameter_label: 'Rental Income (Cash)', category: 'OTHER INCOME SOURCES', data_type: 'percentage', display_order: 19 },
  { parameter_key: 'agriculture_income', parameter_label: 'Agriculture Income', category: 'OTHER INCOME SOURCES', data_type: 'percentage', display_order: 20 },
  
  // EXISTING OBLIGATION
  { parameter_key: 'existing_obligation_rule', parameter_label: 'Existing Obligation Deductions', category: 'EXISTING OBLIGATION RULE', data_type: 'json_slab', display_order: 21 },
  
  // LAP LTV
  { parameter_key: 'ltv_residential_self', parameter_label: 'Residential Self Occupied', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 22 },
  { parameter_key: 'ltv_residential_rented', parameter_label: 'Residential Rented', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 23 },
  { parameter_key: 'ltv_residential_vacant', parameter_label: 'Residential Vacant', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 24 },
  { parameter_key: 'ltv_commercial_self', parameter_label: 'Commercial Self Occupied', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 25 },
  { parameter_key: 'ltv_commercial_rented', parameter_label: 'Commercial Rented', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 26 },
  { parameter_key: 'ltv_commercial_vacant', parameter_label: 'Commercial Vacant', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 27 },
  { parameter_key: 'ltv_industrial_self', parameter_label: 'Industrial Self Occupied', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 28 },
  { parameter_key: 'ltv_industrial_rented', parameter_label: 'Industrial Rented', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 29 },
  { parameter_key: 'ltv_plot_property', parameter_label: 'Plot Property', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 30 },
  { parameter_key: 'ltv_special_property', parameter_label: 'Special Property', category: 'LAP LTV PARAMETERS', data_type: 'json_slab', display_order: 31 },
  
  // HL LTV
  { parameter_key: 'hl_ltv_upto_30', parameter_label: 'LTV <= 30L', category: 'HL LTV PARAMETERS', data_type: 'percentage', display_order: 32 },
  { parameter_key: 'hl_ltv_30_to_75', parameter_label: 'LTV > 30L & <= 75L', category: 'HL LTV PARAMETERS', data_type: 'percentage', display_order: 33 },
  { parameter_key: 'hl_ltv_above_75', parameter_label: 'LTV > 75L', category: 'HL LTV PARAMETERS', data_type: 'percentage', display_order: 34 },
  { parameter_key: 'hl_ltv_commercial', parameter_label: 'HL on Commercial', category: 'HL LTV PARAMETERS', data_type: 'percentage', display_order: 35 },
  { parameter_key: 'hl_ltv_industrial', parameter_label: 'HL on Industrial', category: 'HL LTV PARAMETERS', data_type: 'percentage', display_order: 36 },
  { parameter_key: 'hl_ltv_plot', parameter_label: 'HL on Plot', category: 'HL LTV PARAMETERS', data_type: 'percentage', display_order: 37 },
];

async function seedParameters() {
  console.log('Seeding Parameter Master Matrix...');
  try {
    for (const param of PARAMETERS) {
      await prisma.parameterMaster.upsert({
        where: { parameter_key: param.parameter_key },
        update: param,
        create: param,
      });
    }
    console.log(`✅ successfully upserted ${PARAMETERS.length} matrix parameters.`);
  } catch(e) {
    console.error("❌ Seeding Failed", e);
  } finally {
    await prisma.$disconnect();
  }
}

seedParameters();
