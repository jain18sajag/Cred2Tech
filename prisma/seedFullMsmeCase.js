const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding FULL MSME Dummy Case with Income, GST, ITR, and ESR...');

  const tenantId = 1;

  // 1. Role
  let role = await prisma.role.findUnique({ where: { name: 'MSME_CUSTOMER' } });
  if (!role) {
    role = await prisma.role.create({ data: { name: 'MSME_CUSTOMER' } });
  }

  // 2. User
  const mobile = '9812345670';
  let user = await prisma.user.findFirst({ where: { mobile } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Rajesh Enterprises',
        email: 'rajesh@example.com',
        mobile,
        role: { connect: { id: role.id } },
        tenant: { connect: { id: tenantId } },
        status: 'ACTIVE',
        password_hash: 'dummy_hash_for_otp_user'
      }
    });
  }

  // 3. Customer
  let customer = await prisma.customer.findFirst({ where: { business_mobile: mobile } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        business_name: 'Rajesh Enterprises V2',
        business_pan: 'XYZDE1234F',
        entity_type: 'Proprietorship',
        industry: 'Manufacturing',
        business_vintage: '5 Years',
        business_mobile: mobile,
        tenant: { connect: { id: tenantId } },
        created_by: { connect: { id: user.id } }
      }
    });
  }

  // 4. Case
  const msmeCase = await prisma.case.create({
    data: {
      customer: { connect: { id: customer.id } },
      msme_customer_user: { connect: { id: user.id } },
      stage: 'ESR_GENERATED',
      esr_generated: true,
      loan_amount: 4000000,
      product_type: 'LAP',
      dsa_notes: 'Fully seeded case till ESR',
      lead_source: 'DIRECT_MSME',
      tenant: { connect: { id: tenantId } },
      created_by: { connect: { id: user.id } }
    }
  });

  // 5. Applicant (Primary)
  const applicant = await prisma.applicant.create({
    data: {
      case: { connect: { id: msmeCase.id } },
      type: 'PRIMARY',
      is_primary: true,
      mobile: user.mobile,
      pan_number: 'XYZDE1234F',
      name: 'Rajesh Kumar V2'
    }
  });

  // 6. CasePayment
  const payment = await prisma.casePayment.create({
    data: {
      user: { connect: { id: user.id } },
      case_entity: { connect: { id: msmeCase.id } },
      purpose: 'DIRECT_MSME_ELIGIBILITY',
      amount_inr: 1000.00,
      amount_paise: 100000,
      currency: 'INR',
      razorpay_order_id: 'order_dummy_' + Date.now(),
      razorpay_payment_id: 'pay_dummy_' + Date.now(),
      status: 'PAID',
      verified_at: new Date()
    }
  });

  await prisma.case.update({
    where: { id: msmeCase.id },
    data: { case_payment: { connect: { id: payment.id } } }
  });

  // 7. Income Entries (GST, ITR, Salary)
  await prisma.caseIncomeEntry.create({
    data: {
      case_entity: { connect: { id: msmeCase.id } },
      applicant: { connect: { id: applicant.id } },
      income_type: 'ITR',
      annual_amount: 3000000,
      remarks: 'Mocked ITR PAT'
    }
  });

  await prisma.caseIncomeEntry.create({
    data: {
      case_entity: { connect: { id: msmeCase.id } },
      applicant: { connect: { id: applicant.id } },
      income_type: 'GST',
      annual_amount: 9600000,
      remarks: 'Mocked GST Sales'
    }
  });

  // 8. Property Details (for LAP)
  await prisma.casePropertyDetails.create({
    data: {
      case_entity: { connect: { id: msmeCase.id } },
      property_type: 'Commercial',
      market_value: 12000000,
      ownership_type: 'Self'
    }
  });

  // 9. CaseEsrFinancials
  await prisma.caseEsrFinancials.create({
    data: {
      case_entity: { connect: { id: msmeCase.id } },
      product_type: 'LAP',
      extraction_status: 'COMPLETED',
      extracted_at: new Date(),
      selected_income_method: 'ANY', // Bypass vendor pulls in ESR engine
      selected_monthly_income: 250000,
      itr_pat: 3000000,
      gst_avg_monthly_sales: 800000,
      property_value: 12000000
    }
  });

  // 10. EligibilityReport & Lenders
  const report = await prisma.eligibilityReport.create({
    data: {
      case_entity: { connect: { id: msmeCase.id } },
      tenant: { connect: { id: tenantId } },
      version_number: 1,
      is_latest: true,
      input_snapshot: {}
    }
  });

  // Create 3 Lender options for the ESR
  const mockLenders = [
    { name: 'HDFC Bank', amount: 4000000, rate: 10.5, tenor: 120, emi: 53975 },
    { name: 'ICICI Bank', amount: 3500000, rate: 11.0, tenor: 120, emi: 48212 },
    { name: 'Axis Bank', amount: 3800000, rate: 11.5, tenor: 120, emi: 53424 }
  ];

  for (const l of mockLenders) {
    let lender = await prisma.lender.findFirst({ where: { name: l.name } });
    if (!lender) {
      lender = await prisma.lender.create({ data: { name: l.name, category: 'BANK', status: 'ACTIVE' } });
    }

    let product = await prisma.lenderProduct.findFirst({ where: { lender_id: lender.id, product_type: 'LAP' } });
    if (!product) {
      product = await prisma.lenderProduct.create({ data: { lender_id: lender.id, product_type: 'LAP', status: 'ACTIVE' } });
    }

    await prisma.eligibilityReportLender.create({
      data: {
        esr: { connect: { id: report.id } },
        lender_id: lender.id,
        is_eligible: true,
        eligible_amount: l.amount,
        roi: l.rate,
        tenure_months: l.tenor,
        emi: l.emi,
        remarks: 'Eligible based on mocked ITR & GST',
        lender_name: l.name,
        product_type: 'LAP',
        product_display_name: 'LAP'
      }
    });
  }

  console.log('SUCCESS! Fully seeded case generated with CASE_ID:', msmeCase.id);
  console.log('You can now login with mobile: 9812345670 and navigate to the dashboard to see the full ESR state!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
