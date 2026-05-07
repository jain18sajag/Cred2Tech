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

  // 2. Create the case with primary applicant (is_primary MUST be true)
  const newCase = await prisma.case.create({
    data: {
      tenant_id: tenant_id,
      customer_id: customer.id,
      created_by_user_id: user_id,
      product_type: product_type || null,
      stage: 'DRAFT',
      customer_name: customer.business_name,
      entity_type: customer.entity_type,
      applicants: {
        create: {
          type: 'PRIMARY',
          is_primary: true,   // FIXED: was missing, causing Case.cibil_score to never update
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

  if (existingCase.is_locked) {
    throw new Error('Case is locked and cannot be modified.');
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

  // Enforce: only one PRIMARY applicant per case
  if (applicantData.type === 'PRIMARY') {
    const existingPrimary = await prisma.applicant.findFirst({
      where: { case_id: existingCase.id, type: 'PRIMARY' }
    });
    if (existingPrimary) {
      throw new Error('A primary applicant already exists for this case. Update the existing primary instead.');
    }
  }

  // 2. Add the applicant
  const applicant = await prisma.applicant.create({
    data: {
      case_id: existingCase.id,
      type: applicantData.type,
      is_primary: applicantData.type === 'PRIMARY',
      pan_number: applicantData.pan_number,
      mobile: applicantData.mobile,
      email: applicantData.email
    }
  });

  return applicant;
}

async function updateProduct(case_id, product_type, tenant_id) {
  const existingCase = await prisma.case.findFirst({ 
    where: { id: case_id, tenant_id },
    include: { customer: true }
  });
  if (!existingCase) throw new Error('Case not found or unauthorized.');

  if (existingCase.is_locked) {
    throw new Error('Case is locked and cannot be modified.');
  }

  const updated = await prisma.case.update({
    where: { id: existingCase.id },
    data: { 
      product_type, 
      stage: 'LEAD_CREATED',
      customer_name: existingCase.customer.business_name,
      entity_type: existingCase.customer.entity_type
    }
  });

  await prisma.caseStageHistory.create({
    data: {
      case_id: case_id,
      tenant_id: tenant_id,
      old_stage: existingCase.stage,
      new_stage: 'LEAD_CREATED',
      changed_by: null // system/implicit update
    }
  });

  return updated;
}

async function updateProductProperty(case_id, payload, tenant_id) {
  const { product_type, property } = payload;
  const existingCase = await prisma.case.findFirst({ 
    where: { id: case_id, tenant_id },
    include: { customer: true }
  });
  if (!existingCase) throw new Error('Case not found or unauthorized.');

  if (existingCase.is_locked) {
    throw new Error('Case is locked and cannot be modified.');
  }

  // Property required for LAP / HL
  const propertyRequired = ['LAP', 'HL'].includes(product_type);
  if (propertyRequired && property && !property.market_value) {
    throw new Error('Market value is required for LAP/HL products.');
  }

  const [updatedCase] = await prisma.$transaction([
    prisma.case.update({
      where: { id: case_id },
      data: { 
        product_type, 
        stage: 'LEAD_CREATED',
        customer_name: existingCase.customer.business_name,
        entity_type: existingCase.customer.entity_type
      }
    }),
    ...(property ? [
      prisma.casePropertyDetails.upsert({
        where: { case_id },
        create: { case_id, ...property },
        update: { ...property, updated_at: new Date() }
      })
    ] : []),
    prisma.caseStageHistory.create({
      data: {
        case_id: case_id,
        tenant_id: tenant_id,
        old_stage: existingCase.stage,
        new_stage: 'LEAD_CREATED',
        changed_by: null
      }
    })
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
      data_pull_status: true,
      stage_history: { orderBy: { changed_at: 'desc' } },
      activity_logs: { orderBy: { created_at: 'desc' } }
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


async function getPipeline(tenantId, params) {
  const { search, stage, lender, entity_type, alert, sort_by, sort_order, page, limit } = params;

  let where = { tenant_id: tenantId };

  if (search) {
    // Only search against Case fields (ID, customer_name, lender_name) to avoid heavy joins
    where.OR = [
      { customer_name: { contains: search, mode: 'insensitive' } },
      { lender_name: { contains: search, mode: 'insensitive' } }
    ];
    if (!isNaN(parseInt(search))) {
      where.OR.push({ id: parseInt(search) });
    }
  }

  if (stage) {
    if (stage === 'All') {} // Ignore filter
    else {
      // Map UI stage names to Backend Enum if needed, or assume they come exactly as enum
      where.stage = stage;
    }
  }

  if (lender && lender !== 'All Lenders') {
    where.lender_name = lender;
  }

  if (entity_type && entity_type !== 'All Entity Types') {
    where.entity_type = entity_type;
  }

  if (alert && alert !== 'All Alerts') {
    where.alert_flag = alert;
  }

  // Sorting
  let orderBy = {};
  const order = sort_order === 'asc' ? 'asc' : 'desc';
  
  if (sort_by === 'lead_date') orderBy = { lead_date: order };
  else if (sort_by === 'name') orderBy = { customer_name: order };
  else if (sort_by === 'cibil_score') orderBy = { cibil_score: order };
  else if (sort_by === 'loan_amount') orderBy = { loan_amount: order };
  else orderBy = { updated_at: order }; // default

  // Pagination
  const skip = (page - 1) * limit;

  const [cases, total_cases] = await Promise.all([
    prisma.case.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        customer: { select: { business_name: true, business_pan: true, industry: true, business_vintage: true } }
      }
    }),
    prisma.case.count({ where })
  ]);

  // Distinct customers count
  const distinctCustomers = await prisma.case.findMany({
    where: { tenant_id: tenantId },
    distinct: ['customer_id'],
    select: { customer_id: true }
  });

  return {
    cases,
    total_cases,
    total_customers: distinctCustomers.length,
    current_page: page,
    total_pages: Math.ceil(total_cases / limit)
  };
}

async function updateStage(caseId, tenantId, newStage, userId, tx = null) {
  const db = tx || prisma;
  const existingCase = await db.case.findFirst({ where: { id: caseId, tenant_id: tenantId } });
  if (!existingCase) throw new Error('Case not found or unauthorized.');

  // 1. Stage Change Idempotency
  if (existingCase.stage === newStage) return existingCase;

  // 2. Stage Locking Rule (restrict backward transitions from financial stages)
  const financialStages = ['DISBURSED', 'PARTLY_DISBURSED', 'CLOSED'];
  if (financialStages.includes(existingCase.stage)) {
    // REJECTED is blocked once case is in financial stage
    if (newStage === 'REJECTED') {
      throw new Error('Case cannot be rejected once disbursement has started. Please use closure or cancellation flow.');
    }

    const allowedNext = {
      'PARTLY_DISBURSED': ['DISBURSED', 'CLOSED'],
      'DISBURSED': ['CLOSED'],
      'CLOSED': []
    };
    if (!allowedNext[existingCase.stage] || !allowedNext[existingCase.stage].includes(newStage)) {
       throw new Error(`Backward transition from ${existingCase.stage} to ${newStage} is restricted.`);
    }
  }

  // 3. Case Lock Logic — lock on DISBURSED or PARTLY_DISBURSED (compliance requirement)
  const lockOnDisbursement = ['DISBURSED', 'PARTLY_DISBURSED'].includes(newStage);

  // Use updateMany to safely update with tenant_id filter
  await db.case.updateMany({
    where: { id: caseId, tenant_id: tenantId },
    data: { 
      stage: newStage, 
      updated_at: new Date(),
      is_locked: lockOnDisbursement ? true : existingCase.is_locked
    }
  });

  // Re-fetch for return value and consistency
  const updatedCase = await db.case.findFirst({ where: { id: caseId, tenant_id: tenantId } });

  // Log stage history
  await db.caseStageHistory.create({
    data: {
      case_id: caseId,
      tenant_id: tenantId,
      old_stage: existingCase.stage,
      new_stage: newStage,
      changed_by: userId
    }
  });

  // Log activity
  await db.activityLog.create({
    data: {
      case_id: caseId,
      customer_id: existingCase.customer_id,
      activity_type: 'STAGE_UPDATED',
      description: `Stage updated from ${existingCase.stage} to ${newStage}`,
      performed_by_user_id: userId
    }
  });

  return updatedCase;
}

async function syncCustomerSnapshots(customerId, tenantId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId }
  });
  if (!customer) return;

  // Harden: Snapshot Protection After Disbursement
  // Snapshot fields (name, entity, score) must remain immutable after financial stage.
  await prisma.case.updateMany({
    where: { 
      customer_id: customerId, 
      tenant_id: tenantId,
      stage: { notIn: ['DISBURSED', 'PARTLY_DISBURSED', 'CLOSED'] }
    },
    data: {
      customer_name: customer.business_name,
      entity_type: customer.entity_type
    }
  });
}

module.exports = {
  createCase,
  addApplicant,
  updateProduct,
  updateProductProperty,
  getAllCases,
  getCaseById,
  getPipeline,
  updateStage,
  syncCustomerSnapshots
};
