const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding MSME Dummy Case...');

  // 1. Get or Create MSME Role
  let role = await prisma.role.findUnique({ where: { name: 'MSME_CUSTOMER' } });
  if (!role) {
    role = await prisma.role.create({ data: { name: 'MSME_CUSTOMER' } });
  }

  // 2. Get or Create User
  const mobile = '9812345670';
  let user = await prisma.user.findFirst({ where: { mobile } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Rajesh Enterprises',
        email: 'rajesh@example.com',
        mobile,
        role: { connect: { id: role.id } },
        tenant: { connect: { id: 1 } },
        status: 'ACTIVE',
        password_hash: 'dummy_hash_for_otp_user'
      }
    });
    console.log('Created User:', user.mobile);
  } else {
    console.log('Found User:', user.mobile);
  }

  // 3. Create Customer
  const customer = await prisma.customer.create({
    data: {
      business_name: 'Rajesh Enterprises',
      business_pan: 'ABCDE1234F',
      entity_type: 'Proprietorship',
      industry: 'Manufacturing',
      business_vintage: '5 Years',
      tenant: { connect: { id: 1 } },
      created_by: { connect: { id: user.id } }
    }
  });
  console.log('Created Customer:', customer.id);

  // 4. Create Case
  const msmeCase = await prisma.case.create({
    data: {
      customer: { connect: { id: customer.id } },
      msme_customer_user: { connect: { id: user.id } },
      stage: 'DATA_COLLECTION',
      loan_amount: 4000000,
      product_type: 'LAP',
      dsa_notes: 'Dummy case created via seeder',
      lead_source: 'DIRECT_MSME',
      tenant: { connect: { id: 1 } },
      created_by: { connect: { id: user.id } }
    }
  });
  console.log('Created Case:', msmeCase.id);

  // 5. Create Payment and link
  const payment = await prisma.casePayment.create({
    data: {
      user: { connect: { id: user.id } },
      case: { connect: { id: msmeCase.id } },
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
    data: { case_payment_id: payment.id }
  });

  console.log('Created and linked PAID Payment:', payment.id);
  console.log('Done! Login with mobile 9812345670 and OTP 123456 to see the case at Step 3 (Ready for ESR generation).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
