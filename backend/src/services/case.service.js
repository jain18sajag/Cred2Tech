const prisma = require('../../config/db');

async function createCase(customer_id, product_type, tenant_id, user_id) {
  // 1. Verify that the customer exists and belongs to the correct tenant
  const customer = await prisma.customer.findFirst({
    where: {
      id: parseInt(customer_id, 10),
      tenant_id: tenant_id
    }
  });

  if (!customer) {
    throw new Error('Customer not found or unauthorized.');
  }

  // 2. Create the case
  const newCase = await prisma.case.create({
    data: {
      tenant_id: tenant_id,
      customer_id: customer.id,
      created_by_user_id: user_id,
      product_type: product_type || null,
      stage: 'DRAFT',
      applicants: {
        create: {
          type: 'PRIMARY',
          mobile: customer.business_mobile,
          email: customer.business_email,
          pan_number: customer.business_pan
        }
      }
    }
  });

  return newCase;
}

async function addApplicant(case_id, applicantData, tenant_id) {
  // 1. Verify case exists and belongs to tenant
  const existingCase = await prisma.case.findFirst({
    where: {
      id: case_id,
      tenant_id: tenant_id
    }
  });

  if (!existingCase) {
    throw new Error('Case not found or unauthorized.');
  }

  if (applicantData.id) {
    return await prisma.applicant.update({
      where: { id: parseInt(applicantData.id, 10) },
      data: {
        pan_number: applicantData.pan_number,
        mobile: applicantData.mobile,
        email: applicantData.email
      }
    });
  }

  // 2. Add the applicant
  const applicant = await prisma.applicant.create({
    data: {
      case_id: existingCase.id,
      type: applicantData.type,
      pan_number: applicantData.pan_number,
      mobile: applicantData.mobile,
      email: applicantData.email
    }
  });

  return applicant;
}

async function updateProduct(case_id, product_type, tenant_id) {
  const existingCase = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!existingCase) throw new Error('Case not found or unauthorized.');

  return await prisma.case.update({
    where: { id: existingCase.id },
    data: { product_type, stage: 'LEAD_CREATED' }
  });
}

async function updateProductProperty(case_id, payload, tenant_id) {
  const { product_type, property } = payload;
  const existingCase = await prisma.case.findFirst({ where: { id: case_id, tenant_id } });
  if (!existingCase) throw new Error('Case not found or unauthorized.');

  // Property required for LAP / HL
  const propertyRequired = ['LAP', 'HL'].includes(product_type);
  if (propertyRequired && property && !property.market_value) {
    throw new Error('Market value is required for LAP/HL products.');
  }

  const [updatedCase] = await prisma.$transaction([
    prisma.case.update({
      where: { id: case_id },
      data: { product_type, stage: 'LEAD_CREATED' }
    }),
    ...(property ? [
      prisma.casePropertyDetails.upsert({
        where: { case_id },
        create: { case_id, ...property },
        update: { ...property, updated_at: new Date() }
      })
    ] : [])
  ]);

  // Return the full updated case with property
  const finalCase = await prisma.case.findUnique({
    where: { id: case_id },
    include: { property: true, applicants: true, data_pull_status: true }
  });

  // Extract ESR financials asynchronously
  const { extractEsrFinancials } = require('./esrFinancials.service');
  extractEsrFinancials(case_id).catch(err => console.error(err));

  return finalCase;
}


async function getAllCases(tenant_id) {
  return await prisma.case.findMany({
    where: { tenant_id },
    include: {
      customer: true,
      applicants: true
    },
    orderBy: { created_at: 'desc' }
  });
}

async function getCaseById(case_id, tenant_id) {
  const existingCase = await prisma.case.findFirst({
    where: {
      id: parseInt(case_id, 10),
      tenant_id: tenant_id
    },
    include: {
      customer: {
         include: {
            gst_profiles: { take: 1, orderBy: { created_at: 'desc' } },
            itr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
            bank_statements: { take: 1, orderBy: { created_at: 'desc' } }
         }
      },
      applicants: {
         include: {
            itr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
            bank_statements: { take: 1, orderBy: { created_at: 'desc' } }
         }
      },
      property: true,
      data_pull_status: true
    }
  });

  if (!existingCase) {
    throw new Error('Case not found or unauthorized.');
  }

  // Ensure primary applicant exists for old cases (backfill/fix)
  if (!existingCase.applicants.some(a => a.type === 'PRIMARY')) {
     const primaryApp = await prisma.applicant.create({
        data: {
           case_id: existingCase.id,
           type: 'PRIMARY',
           mobile: existingCase.customer.business_mobile,
           email: existingCase.customer.business_email,
           pan_number: existingCase.customer.business_pan,
           otp_verified: existingCase.customer.mobile_verified // If customer mobile was verified, mark applicant verified
        }
     });
     existingCase.applicants.push(primaryApp);
  }

  return existingCase;
}

module.exports = {
  createCase,
  addApplicant,
  updateProduct,
  updateProductProperty,
  getAllCases,
  getCaseById
};
