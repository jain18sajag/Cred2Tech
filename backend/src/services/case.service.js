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
      stage: 'DRAFT'
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

  // 2. Update product and stage
  const updatedCase = await prisma.case.update({
    where: { id: existingCase.id }, // We verified tenant_id above
    data: {
      product_type: product_type,
      stage: 'LEAD_CREATED' // Stage advances after product selection (Step 3)
    }
  });

  return updatedCase;
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
      data_pull_status: true
    }
  });

  if (!existingCase) {
    throw new Error('Case not found or unauthorized.');
  }

  return existingCase;
}

module.exports = {
  createCase,
  addApplicant,
  updateProduct,
  getAllCases,
  getCaseById
};
