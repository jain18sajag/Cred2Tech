const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Utility for parsing numbers safely
const parseNum = (val, fallback = null) => {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'number') return val;
  const stripped = String(val).replace(/[^0-9.-]+/g, '');
  const num = parseFloat(stripped);
  return isNaN(num) ? fallback : num;
};

// Utility for parsing boolean safely
const parseBool = (val, fallback = false) => {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'boolean') return val;
  const str = String(val).trim().toLowerCase();
  if (str === 'yes' || str === 'true' || str === '1') return true;
  if (str === 'no' || str === 'false' || str === '0') return false;
  return fallback;
};

// Utility for formatting dates
const parseDate = (val) => {
  if (!val) return null;
  const date = new Date(val);
  return isNaN(date.getTime()) ? null : date;
};

class BulkCaseUploadService {
  /**
   * Generates the multi-sheet Excel Template
   */
  async generateTemplate() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Cred2Tech';
    workbook.created = new Date();

    // 1. Instructions Sheet
    const sheetInstructions = workbook.addWorksheet('Instructions');
    sheetInstructions.columns = [{ header: 'Instructions for Bulk Upload', width: 80 }];
    sheetInstructions.addRow(['- Do not rename sheet names or column headers.']);
    sheetInstructions.addRow(['- "Case Ref" is mandatory and must be unique within this workbook.']);
    sheetInstructions.addRow(['- Co-applicants, manual incomes, and obligations are linked to the case using "Case Ref".']);
    sheetInstructions.addRow(['- Blank optional fields are allowed.']);
    sheetInstructions.addRow(['- PAN and GST formats must be exact. Dates as yyyy-mm-dd or Excel dates.']);
    sheetInstructions.addRow(['- After successful upload, cases will be visible in the pipeline. Click Generate ESR to apply banking/GST logic.']);
    sheetInstructions.getRow(1).font = { bold: true };

    // 2. Cases Sheet
    const sheetCases = workbook.addWorksheet('Cases');
    const casesHeaders = [
      'Case Ref', 'Customer Type', 'Source', 'DSA Name', 'Assigned To Email', 'Product Type', 'Preferred Lender', 'Selected Income Method', 'Required Loan Amount', 'Required Tenure Months', 'Required ROI', 'Case Stage', 'Remarks',
      'Customer Name', 'Applicant Name', 'Applicant Role', 'Mobile', 'Email', 'PAN', 'Aadhaar Number', 'DOB', 'Gender', 'Father Name', 'Marital Status', 'Current Address', 'Current City', 'Current State', 'Current Pincode', 'Permanent Address', 'Permanent City', 'Permanent State', 'Permanent Pincode', 'Address Ownership',
      'Company Type', 'Company Name', 'Company Mobile', 'Company Email', 'Company PAN', 'GST Number', 'CIN / LLPIN', 'Udyam Number', 'Industry Type', 'Business Vintage Years', 'Annual Turnover', 'Company Address', 'Company City', 'Company State', 'Company Pincode',
      'Property Type', 'Occupancy Status', 'Ownership', 'Market Value', 'Property Address', 'Property City', 'Property State', 'Property Pincode', 'Property Owner Name', 'Property Title Status', 'LTV Percent', 'Property Remarks',
      'Selected Monthly Income', 'Gross Salary Monthly', 'Net Salary Monthly', 'Salary As Per Slip Monthly', 'Net Profit After Tax Current Year', 'Net Profit After Tax Previous Year', 'Depreciation Current Year', 'Depreciation Previous Year', 'Interest On Loan Current Year', 'Interest On Loan Previous Year', 'Director Remuneration Current Year', 'Director Remuneration Previous Year', 'Partner Salary Current Year', 'Partner Salary Previous Year', 'Annual Sales As Per GSTR', 'Last 12 Month Sales As Per GSTR', 'GST Average Monthly Sales', 'Turnover As Per ITR', 'Annual Gross Receipts', 'Annual Business Credits', 'Average Bank Balance', 'ABB', 'Monthly Rental Income Bank', 'Monthly Rental Income Cash', 'Annual Agriculture Income', 'Professional Fees Annual', 'Interest Income Annual', 'Dividend Income Annual', 'Other Income Annual', 'HDFC Exposure', 'ICICI Exposure', 'Existing EMI Total', 'Primary CIBIL Score', 'Lowest CIBIL Score',
      'PAN Status', 'GST Status', 'ITR Status', 'Bank Statement Status', 'Bureau Status', 'Salary OCR Status', 'Property Document Status', 'KYC Document Status'
    ];
    sheetCases.addRow(casesHeaders);
    sheetCases.getRow(1).font = { bold: true };
    sheetCases.views = [{ state: 'frozen', ySplit: 1 }];
    
    // Add Sample Case
    sheetCases.addRow(['CASE-UPLOAD-001', 'Proprietorship', 'EXCEL_UPLOAD', '', '', 'BL', 'Any', 'GST', 5000000, 60, 14, 'LEAD_CREATED', 'Sample Uploaded Case', 'Acme Trading', 'Rajesh Kumar', 'PRIMARY_BORROWER', '9876543210', 'rajesh@acme.com', 'ABCDE1234F', '', '', 'Male', '', '', '123 Acme St', 'Mumbai', 'Maharashtra', '400001', '', '', '', '', 'Sole Owner', 'Proprietorship', 'Acme Trading', '9876543210', 'info@acme.com', 'ABCDE1234F', '27ABCDE1234F1Z5', '', '', 'Trading', '5', 10000000, '123 Acme St', 'Mumbai', 'Maharashtra', '400001', 'Commercial - Office / Shop', 'Self Occupied', 'Company Owned', 15000000, '123 Acme St', 'Mumbai', 'Maharashtra', '400001', 'Acme Trading', 'Clear', 0, '', 0, 0, 0, 0, 1200000, 1000000, 200000, 150000, 50000, 40000, 0, 0, 0, 0, 10000000, 10000000, 833333, 9000000, 9000000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 750, 750, 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending', 'Pending']);

    // 3. CoApplicants Sheet
    const sheetCoApp = workbook.addWorksheet('CoApplicants');
    sheetCoApp.addRow(['Case Ref', 'CoApplicant Ref', 'Name', 'Role', 'Relationship', 'Mobile', 'Email', 'PAN', 'Aadhaar Number', 'DOB', 'Gender', 'Father Name', 'Address', 'City', 'State', 'Pincode', 'Address Ownership', 'Company Name', 'Company PAN', 'GST Number', 'DIN', 'CIBIL Score', 'Bureau Status', 'Include In ESR', 'Remarks']);
    sheetCoApp.getRow(1).font = { bold: true };
    sheetCoApp.views = [{ state: 'frozen', ySplit: 1 }];
    sheetCoApp.addRow(['CASE-UPLOAD-001', 'COAPP-001', 'Anita Kumar', 'Co-Applicant', 'Spouse', '9876543211', 'anita@acme.com', 'ZYXWV9876Q', '', '', 'Female', '', '', '', '', '', '', '', '', '', '', 780, 'Pending', 'Yes', 'Sample CoApplicant']);

    // 4. ManualIncome Sheet
    const sheetIncome = workbook.addWorksheet('ManualIncome');
    sheetIncome.addRow(['Case Ref', 'Income Ref', 'Applicant Ref', 'Applicant PAN', 'Income Type', 'Annual Amount', 'Monthly Amount', 'Supporting Doc', 'Rent Classification', 'Auto Include', 'Remarks']);
    sheetIncome.getRow(1).font = { bold: true };
    sheetIncome.views = [{ state: 'frozen', ySplit: 1 }];
    sheetIncome.addRow(['CASE-UPLOAD-001', 'INC-001', 'COAPP-001', 'ZYXWV9876Q', 'Salary', 1200000, 100000, 'Salary Slip', 'NOT_APPLICABLE', 'Yes', 'Co-applicant Salary']);

    // 5. BureauObligations Sheet
    const sheetObligations = workbook.addWorksheet('BureauObligations');
    sheetObligations.addRow(['Case Ref', 'Obligation Ref', 'Applicant Ref', 'Applicant PAN', 'Applicant Name', 'Lender Name', 'Loan Type', 'Loan Amount', 'Outstanding Amount', 'Start Date', 'EMI Per Month', 'Status', 'Source', 'Include FOIR', 'Closing In Next 12 Months', 'Remarks']);
    sheetObligations.getRow(1).font = { bold: true };
    sheetObligations.views = [{ state: 'frozen', ySplit: 1 }];
    sheetObligations.addRow(['CASE-UPLOAD-001', 'OBL-001', '', 'ABCDE1234F', 'Rajesh Kumar', 'HDFC Bank', 'Housing Loan', 5000000, 4500000, '2020-01-01', 45000, 'Active', 'Manual', 'Yes', 'No', 'Home Loan EMI']);

    // 6. ValidValues Sheet (Hidden by default for cleanliness)
    const sheetValidValues = workbook.addWorksheet('ValidValues');
    sheetValidValues.state = 'hidden';
    sheetValidValues.addRow(['Product Type', 'Preferred Lender', 'Income Method', 'Property Type', 'Occupancy Status', 'Ownership', 'Customer Type', 'Gender', 'Case Stage', 'Status', 'Income Type', 'Supporting Doc', 'Rent Classification', 'Loan Type', 'Include FOIR']);
    sheetValidValues.addRow(['LAP', 'ICICI BANK', 'SALARIED', 'Residential - House / Flat', 'Self Occupied', 'Sole Owner', 'Individual', 'Male', 'LEAD_CREATED', 'Pending', 'Director Salary', 'CA Certificate', 'BANK_CREDIT', 'Business Loan', 'Yes']);
    sheetValidValues.addRow(['HL', 'HDFC BANK', 'NET PROFIT METHOD', 'Commercial - Office / Shop', 'Rented Out', 'Joint Owner', 'Proprietorship', 'Female', 'DATA_COLLECTION', 'Completed', 'Partner\'s Salary', 'Salary Slip', 'CASH', 'Personal Loan', 'No']);
    sheetValidValues.addRow(['Business Loan', 'Any', 'BANKING', 'Industrial - Factory / Warehouse', 'Vacant', 'Company Owned', 'Partnership', 'Other', 'ESR_GENERATED', 'Failed', 'Interest on Capital', 'Form 16', 'ITR', 'Housing Loan', '']);
    sheetValidValues.addRow(['Personal Loan', '', 'GST', 'Plot / Land', '', '', 'Private Limited', '', 'APPROVED', 'Not Available', 'Rental Income - Bank', 'Bank Credit', 'NOT_APPLICABLE', 'LAP', '']);
    sheetValidValues.addRow(['', '', 'GRP', '', '', '', 'LLP', '', 'DISBURSED', 'Uploaded', 'Rental Income - Cash', 'ITR', '', 'Car Loan', '']);
    sheetValidValues.addRow(['', '', 'DSCR', '', '', '', 'HUF', '', 'CLOSED', 'Not Uploaded', 'Interest Income', 'Bank Statement', '', 'Two Wheeler Loan', '']);
    sheetValidValues.addRow(['', '', '', '', '', '', 'Company', '', 'DRAFT', '', 'Dividend Income', 'None', '', 'Credit Card', '']);
    sheetValidValues.addRow(['', '', '', '', '', '', '', '', '', '', 'Agriculture Income', '', '', 'Gold Loan', '']);
    sheetValidValues.addRow(['', '', '', '', '', '', '', '', '', '', 'Professional Fees', '', '', 'Education Loan', '']);
    sheetValidValues.addRow(['', '', '', '', '', '', '', '', '', '', 'Other', '', '', 'Overdraft', '']);
    sheetValidValues.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '', 'Other', '']);

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  /**
   * Processes the uploaded Excel file buffer
   */
  async processUpload(fileBuffer, tenantId, userId) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    // Extract sheets
    const sheetCases = workbook.getWorksheet('Cases');
    if (!sheetCases) throw new Error('Missing "Cases" sheet in the workbook.');
    
    const sheetCoApp = workbook.getWorksheet('CoApplicants');
    const sheetIncome = workbook.getWorksheet('ManualIncome');
    const sheetObligations = workbook.getWorksheet('BureauObligations');

    const parseSheet = (sheet) => {
      if (!sheet) return [];
      const rows = [];
      let headers = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          headers = row.values.map(v => typeof v === 'string' ? v.trim() : v);
        } else {
          const rowData = {};
          row.eachCell((cell, colNumber) => {
            const header = headers[colNumber];
            if (header) {
              rowData[header] = cell.value;
            }
          });
          rows.push(rowData);
        }
      });
      return rows;
    };

    const casesList = parseSheet(sheetCases);
    const coAppsList = parseSheet(sheetCoApp);
    const incomeList = parseSheet(sheetIncome);
    const obligationsList = parseSheet(sheetObligations);

    const result = {
      totalRows: casesList.length,
      createdCases: 0,
      failedRows: 0,
      createdCaseRefs: [],
      errors: []
    };

    for (let i = 0; i < casesList.length; i++) {
      const row = casesList[i];
      const caseRef = row['Case Ref']?.toString().trim();
      
      try {
        if (!caseRef) throw new Error('Missing Case Ref');
        
        const pan = (row['PAN'] || row['Company PAN'] || '').toString().trim().toUpperCase();
        if (!pan) throw new Error('Customer/Applicant PAN is missing');
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error(`Invalid PAN Format: ${pan}`);
        
        // Ensure uniqueness of Case Ref in this tenant
        const existingCaseRef = await prisma.case.findFirst({
          where: { tenant_id: tenantId, dsa_notes: { contains: `[Case Ref: ${caseRef}]` } } 
          // We store case_ref in dsa_notes or external reference if available
        });
        if (existingCaseRef) throw new Error(`Case Ref ${caseRef} already exists in this tenant`);

        await prisma.$transaction(async (tx) => {
          // 1. Find or Create Customer
          let customer = await tx.customer.findFirst({
            where: { tenant_id: tenantId, business_pan: pan }
          });

          if (!customer) {
            customer = await tx.customer.create({
              data: {
                tenant_id: tenantId,
                category: row['Customer Type'] === 'Individual' ? 'INDIVIDUAL' : 'MSME',
                business_pan: pan,
                business_name: row['Company Name'] || row['Customer Name'] || row['Applicant Name'],
                business_mobile: String(row['Company Mobile'] || row['Mobile'] || '').substring(0, 15),
                business_email: row['Company Email'] || row['Email'] || null,
                entity_type: row['Company Type'] || row['Customer Type'] || 'PROPRIETORSHIP',
                industry: row['Industry Type'] || null,
                business_vintage: row['Business Vintage Years']?.toString() || null,
                created_by_user_id: userId
              }
            });
          }

          // 2. Determine Stage
          const validStages = ['LEAD_CREATED', 'DATA_COLLECTION', 'LEAD_SENT_TO_LENDER', 'ESR_GENERATED', 'APPROVED', 'PARTLY_DISBURSED', 'DISBURSED', 'REJECTED', 'CLOSED', 'DRAFT'];
          let mappedStage = validStages.includes(row['Case Stage']) ? row['Case Stage'] : 'DRAFT';
          
          const legacyMap = {
            'LEAD_SENT': 'LEAD_SENT_TO_LENDER',
            'LOGIN_DONE': 'ESR_GENERATED',
            'SANCTIONED': 'APPROVED'
          };
          if (legacyMap[row['Case Stage']]) {
            mappedStage = legacyMap[row['Case Stage']];
          }

          // 3. Create Case
          const newCase = await tx.case.create({
            data: {
              tenant: { connect: { id: tenantId } },
              customer: { connect: { id: customer.id } },
              created_by: { connect: { id: userId } },
              product_type: row['Product Type'],
              loan_amount: parseNum(row['Required Loan Amount']),
              dsa_notes: `[Bulk Upload] [Case Ref: ${caseRef}] ${row['Remarks'] || ''}`,
              esr_generated: false,
              stage: mappedStage,
              customer_name: customer.business_name,
              entity_type: customer.entity_type,
              cibil_score: parseNum(row['Primary CIBIL Score'])
            }
          });

          // 4. Create Primary Applicant
          const primaryApp = await tx.applicant.create({
            data: {
              case_id: newCase.id,
              type: 'PRIMARY',
              name: row['Applicant Name'] || customer.business_name,
              pan_number: pan,
              mobile: String(row['Mobile'] || customer.business_mobile || '').substring(0, 15),
              email: row['Email'] || null,
              cibil_score: parseNum(row['Primary CIBIL Score']),
              is_primary: true
            }
          });

          // 5. Create Case Property Details
          if (row['Property Type'] || row['Market Value']) {
            await tx.casePropertyDetails.create({
              data: {
                case_id: newCase.id,
                property_type: row['Property Type'],
                occupancy_status: row['Occupancy Status'],
                ownership_type: row['Ownership'],
                market_value: parseNum(row['Market Value']),
                remarks: row['Property Remarks']
              }
            });
          }

          // 6. Create ESR Financials
          await tx.caseEsrFinancials.create({
            data: {
              case_id: newCase.id,
              selected_income_method: row['Selected Income Method'] || 'SALARIED',
              selected_monthly_income: parseNum(row['Selected Monthly Income'], 0),
              salaried_income: parseNum(row['Net Salary Monthly'], 0),
              itr_pat: parseNum(row['Net Profit After Tax Current Year'], 0),
              itr_depreciation: parseNum(row['Depreciation Current Year'], 0),
              itr_finance_cost: parseNum(row['Interest On Loan Current Year'], 0),
              itr_gross_receipts: parseNum(row['Annual Gross Receipts'], 0),
              gst_avg_monthly_sales: parseNum(row['GST Average Monthly Sales'], 0),
              bank_avg_balance: parseNum(row['Average Bank Balance'], 0),
              existing_obligations: parseNum(row['Existing EMI Total'], 0),
              icici_exposure: parseNum(row['ICICI Exposure'], 0),
              bureau_score: parseNum(row['Primary CIBIL Score']),
              requested_loan_amount: parseNum(row['Required Loan Amount']),
              requested_tenure_months: parseNum(row['Required Tenure Months'], 60),
              product_type: row['Product Type']
            }
          });

          // 7. Process Co-Applicants
          const relatedCoApps = coAppsList.filter(c => c['Case Ref'] === caseRef);
          for (const co of relatedCoApps) {
            await tx.applicant.create({
              data: {
                case_id: newCase.id,
                type: 'CO_APPLICANT',
                name: co['Name'],
                pan_number: co['PAN']?.toString().trim().toUpperCase() || null,
                mobile: co['Mobile']?.toString().substring(0, 15) || null,
                email: co['Email'] || null,
                cibil_score: parseNum(co['CIBIL Score'])
              }
            });
          }

          // Fetch all applicants for this case to link income/obligations properly
          const allApplicants = await tx.applicant.findMany({ where: { case_id: newCase.id } });

          // 8. Process Manual Income
          const relatedIncome = incomeList.filter(i => i['Case Ref'] === caseRef);
          for (const inc of relatedIncome) {
            const incPan = inc['Applicant PAN']?.toString().trim().toUpperCase();
            const matchedApp = allApplicants.find(a => a.pan_number === incPan) || primaryApp;
            
            await tx.caseIncomeEntry.create({
              data: {
                case_id: newCase.id,
                applicant_id: matchedApp.id,
                applicant_label: matchedApp.name,
                income_type: inc['Income Type'] || 'Other',
                annual_amount: parseNum(inc['Annual Amount']) || (parseNum(inc['Monthly Amount']) * 12) || 0,
                supporting_doc_type: inc['Supporting Doc'],
                remarks: inc['Remarks']
              }
            });
          }

          // 9. Process Obligations
          const relatedObligations = obligationsList.filter(o => o['Case Ref'] === caseRef);
          for (const obl of relatedObligations) {
            const oblPan = obl['Applicant PAN']?.toString().trim().toUpperCase();
            const matchedApp = allApplicants.find(a => a.pan_number === oblPan) || primaryApp;
            
            await tx.caseCreditObligation.create({
              data: {
                case_id: newCase.id,
                applicant_id: matchedApp.id,
                lender_name: obl['Lender Name'],
                loan_type: obl['Loan Type'] || 'Other',
                loan_amount: parseNum(obl['Loan Amount']),
                outstanding_amount: parseNum(obl['Outstanding Amount']),
                emi_per_month: parseNum(obl['EMI Per Month'], 0),
                status: obl['Status'] === 'Closed' ? 'CLOSED' : 'ACTIVE',
                source: (obl['Source'] || 'MANUAL').toUpperCase(),
                include_in_foir: parseBool(obl['Include FOIR'], true),
                remarks: obl['Remarks']
              }
            });
          }

          // 10. Activity Log and Stage History
          await tx.activityLog.create({
            data: {
              case_id: newCase.id,
              performed_by_user_id: userId,
              activity_type: 'CASE_BULK_UPLOADED',
              description: 'Case created through Excel bulk upload'
            }
          });

          await tx.caseStageHistory.create({
            data: {
              tenant_id: tenantId,
              case_id: newCase.id,
              old_stage: 'DRAFT',
              new_stage: mappedStage,
              changed_by: userId
            }
          });

          result.createdCases++;
          result.createdCaseRefs.push({ caseRef, caseId: newCase.id, customerName: customer.business_name });
        }); // End Transaction

      } catch (err) {
        result.failedRows++;
        result.errors.push({
          sheet: 'Cases',
          row: i + 2, // +1 for 0-index, +1 for header
          caseRef: caseRef || 'Unknown',
          field: 'General',
          message: err.message
        });
      }
    }

    return result;
  }
}

module.exports = new BulkCaseUploadService();
