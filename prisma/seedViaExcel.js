const path = require('path');
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const bulkCaseUploadService = require('../src/services/bulkCaseUpload.service');

async function main() {
  console.log('Seeding MSME case via Excel Bulk Upload Service...');

  const tenantId = 1;
  // Get an admin or user to own the case
  let user = await prisma.user.findFirst({ where: { tenant_id: tenantId } });
  if (!user) {
    throw new Error("No user found for tenant 1");
  }

  const userId = user.id;

  // 1. Get Template Buffer
  const templateBuffer = await bulkCaseUploadService.generateTemplate();
  
  // 2. Load into Workbook to add our data
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);
  
  const sheetCases = workbook.getWorksheet('Cases');
  
  // The first row is headers (added by generateTemplate), second is sample data.
  // Let's clear the sample data and add our own.
  sheetCases.spliceRows(2, sheetCases.rowCount - 1);
  
  // Get headers from first row to construct an object mapped row
  const headers = sheetCases.getRow(1).values; // Note: values array is 1-indexed in ExcelJS
  
  const rowData = {
    'Case Ref': 'MSME-EXCEL-001',
    'Customer Type': 'Proprietorship',
    'Source': 'EXCEL_UPLOAD',
    'Product Type': 'LAP',
    'Selected Income Method': 'Any',
    'Case Stage': 'LEAD_CREATED',
    'Applicant Name': 'Ramesh MSME',
    'Mobile': '9876543299',
    'Email': 'ramesh@msme.com',
    'PAN': 'RTYUI9876F',
    'Company Name': 'Ramesh Manufacturing',
    'Company PAN': 'RTYUI9876F',
    'Industry Type': 'Manufacturing',
    'Business Vintage Years': '5',
    'Property Type': 'Commercial - Office / Shop',
    'Occupancy Status': 'Self Occupied',
    'Ownership': 'Sole Owner',
    'Market Value': 15000000,
    'Property Address': '456 Industrial Area',
    'Net Profit After Tax Current Year': 2500000,
    'Depreciation Current Year': 300000,
    'Interest On Loan Current Year': 150000,
    'GST Average Monthly Sales': 1200000,
    'Average Bank Balance': 500000,
    'Primary CIBIL Score': 780
  };

  const newRow = [];
  for (let col = 1; col < headers.length; col++) {
    const header = headers[col];
    newRow[col] = rowData[header] || '';
  }
  
  sheetCases.addRow(newRow);

  // We can also clear the CoApplicants, ManualIncome, BureauObligations sheets to keep it simple,
  // or leave them as is (they are linked to CASE-UPLOAD-001, so they will be ignored for our case).
  
  const modifiedBuffer = await workbook.xlsx.writeBuffer();
  
  console.log('Processing upload...');
  const result = await bulkCaseUploadService.processUpload(modifiedBuffer, tenantId, userId);
  
  console.log('Upload Result:', JSON.stringify(result, null, 2));
  
  if (result.failedRows > 0) {
    console.error('Failed Errors:', result.errors);
  } else {
    console.log('Successfully seeded fully calculated case via Excel bulk upload logic!');
    
    // As a bonus, let's create a CasePayment so it's fully unlocked in MSME Direct
    const msmeCase = await prisma.case.findFirst({
      where: { dsa_notes: { contains: '[Case Ref: MSME-EXCEL-001]' } }
    });
    
    if (msmeCase) {
      const payment = await prisma.casePayment.create({
        data: {
          user: { connect: { id: userId } },
          case_entity: { connect: { id: msmeCase.id } },
          purpose: 'DIRECT_MSME_ELIGIBILITY',
          amount_inr: 1000.00,
          amount_paise: 100000,
          currency: 'INR',
          razorpay_order_id: 'order_excel_' + Date.now(),
          razorpay_payment_id: 'pay_excel_' + Date.now(),
          status: 'PAID',
          verified_at: new Date()
        }
      });
      await prisma.case.update({
        where: { id: msmeCase.id },
        data: { case_payment: { connect: { id: payment.id } } }
      });
      console.log('Attached PAID CasePayment to the case for MSME Direct bypass.');
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
