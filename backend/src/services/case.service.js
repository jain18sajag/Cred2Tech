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

  const user = await prisma.user.findUnique({
    where: { id: user_id },
    include: { role: true }
  });
  const isMsme = user && user.role?.name === 'MSME_CUSTOMER';

  // Idempotency check: Look for an existing DRAFT case for this customer in the last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existingDraftCase = await prisma.case.findFirst({
    where: {
      customer_id: customer.id,
      tenant_id: tenant_id,
      stage: 'DRAFT',
      created_at: { gte: twentyFourHoursAgo }
    }
  });

  if (existingDraftCase) {
    return existingDraftCase;
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
      lead_source: isMsme ? 'DIRECT_MSME' : 'DSA',
      msme_customer_user_id: isMsme ? user_id : null,
      applicants: {
        create: {
          type: 'PRIMARY',
          is_primary: true,   // FIXED: was missing, causing Case.cibil_score to never update
          mobile: customer.business_mobile,
          email: customer.business_email,
          pan_number: customer.business_pan,
          otp_verified: customer.mobile_verified || false // Security Fix: Remove || true bypass
        }
      }
    }
  });

  // 3. Link unlinked payment if MSME
  if (isMsme) {
    const unlinkedPayment = await prisma.casePayment.findFirst({
      where: { user_id: user_id, case_id: null, status: 'PAID' },
      orderBy: { created_at: 'desc' }
    });

    if (unlinkedPayment) {
      await prisma.casePayment.update({
        where: { id: unlinkedPayment.id },
        data: { case_id: newCase.id }
      });
      await prisma.case.update({
        where: { id: newCase.id },
        data: { case_payment_id: unlinkedPayment.id }
      });
    }
  }

  return newCase;
}

async function createSalariedCase({ business_pan, business_name, business_mobile, business_email, product_type }, tenant_id, user_id) {
  const normalizedPan = business_pan?.trim().toUpperCase();

  // We use business_pan / business_name to reuse the existing structure for Salaried Individuals
  // 1. Create the customer and the initial case inside a transaction
  return await prisma.$transaction(async (tx) => {
    // Upsert or create customer
    let customer = await tx.customer.findFirst({
      where: { tenant_id, business_pan: normalizedPan }
    });

    if (customer) {
      // Update existing customer details in case they changed in UI
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          business_name,
          business_mobile,
          business_email,
          category: 'SALARIED'
        }
      });
    } else {
      customer = await tx.customer.create({
        data: {
          tenant_id,
          category: 'SALARIED',
          business_pan: normalizedPan,
          business_name,
          business_mobile,
          business_email,
          entity_type: 'Individual', // Appropriate default for salaried
          created_by_user_id: user_id
        }
      });
    }

    // Idempotency check: Look for an existing DRAFT case for this customer in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingDraftCase = await tx.case.findFirst({
      where: {
        customer_id: customer.id,
        tenant_id: tenant_id,
        stage: 'DRAFT',
        created_at: { gte: twentyFourHoursAgo }
      },
      include: {
        applicants: true
      }
    });

    if (existingDraftCase) {
      return existingDraftCase;
    }

    // Create the case with primary applicant
    const newCase = await tx.case.create({
      data: {
        tenant_id,
        customer_id: customer.id,
        created_by_user_id: user_id,
        product_type: product_type || null,
        stage: 'DRAFT',
        customer_name: customer.business_name,
        entity_type: customer.entity_type,
        applicants: {
          create: {
            type: 'PRIMARY',
            is_primary: true,
            employment_type: 'SALARIED',
            name: customer.business_name,
            mobile: customer.business_mobile,
            email: customer.business_email,
            pan_number: customer.business_pan,
            otp_verified: customer.mobile_verified || false
          }
        }
      },
      include: {
        applicants: true
      }
    });

    return newCase;
  });
}

// ... keeping other functions untouched ...
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
    const existing = await prisma.applicant.findUnique({ where: { id: parseInt(applicantData.id, 10) } });
    if (existing && existing.pan_verified) {
      return await prisma.applicant.update({
        where: { id: parseInt(applicantData.id, 10) },
        data: {
          mobile: applicantData.mobile,
          email: applicantData.email,
          employment_type: applicantData.employment_type || undefined
        }
      });
    }
    return await prisma.applicant.update({
      where: { id: parseInt(applicantData.id, 10) },
      data: {
        name: applicantData.name,
        pan_number: applicantData.pan_number,
        mobile: applicantData.mobile,
        email: applicantData.email,
        employment_type: applicantData.employment_type || undefined
      }
    });
  }

  // Idempotent check for Co-applicants
  if (applicantData.pan_number && applicantData.type === 'CO_APPLICANT') {
    const existingCoApp = await prisma.applicant.findFirst({
      where: {
        case_id: existingCase.id,
        pan_number: applicantData.pan_number,
        type: 'CO_APPLICANT'
      }
    });
    if (existingCoApp) {
      if (existingCoApp.pan_verified) {
        return await prisma.applicant.update({
          where: { id: existingCoApp.id },
          data: {
            mobile: applicantData.mobile || existingCoApp.mobile,
            email: applicantData.email || existingCoApp.email,
            employment_type: applicantData.employment_type || existingCoApp.employment_type
          }
        });
      }
      return await prisma.applicant.update({
        where: { id: existingCoApp.id },
        data: {
          name: applicantData.name || existingCoApp.name,
          mobile: applicantData.mobile || existingCoApp.mobile,
          email: applicantData.email || existingCoApp.email,
          employment_type: applicantData.employment_type || existingCoApp.employment_type
        }
      });
    }
  }

  // Enforce: only one PRIMARY applicant per case
  if (applicantData.type === 'PRIMARY') {
    const existingPrimary = await prisma.applicant.findFirst({
      where: { case_id: existingCase.id, type: 'PRIMARY' }
    });
    if (existingPrimary) {
      if (existingPrimary.pan_verified) {
        return await prisma.applicant.update({
          where: { id: existingPrimary.id },
          data: {
            mobile: applicantData.mobile,
            email: applicantData.email,
            employment_type: applicantData.employment_type || undefined
          }
        });
      }
      // Gracefully update instead of throwing
      return await prisma.applicant.update({
        where: { id: existingPrimary.id },
        data: {
          name: applicantData.name,
          pan_number: applicantData.pan_number,
          mobile: applicantData.mobile,
          email: applicantData.email,
          employment_type: applicantData.employment_type || undefined
        }
      });
    }
  }

  // 2. Add the applicant
  const applicant = await prisma.applicant.create({
    data: {
      case_id: existingCase.id,
      type: applicantData.type,
      is_primary: applicantData.type === 'PRIMARY',
      name: applicantData.name,
      pan_number: applicantData.pan_number,
      mobile: applicantData.mobile,
      email: applicantData.email,
      employment_type: applicantData.employment_type || 'SELF_EMPLOYED'
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

  // Removed background extractEsrFinancials call to prevent wiping out bulk upload manual financials.
  // The ESR orchestrator already validates freshness on generation.

  return finalCase;
}


async function getAllCases(tenant_id, currentUser) {
  const isBypassed = currentUser.role === 'DSA_ADMIN';

  const hierarchyFilter = isBypassed ? {} : {
    created_by: {
      hierarchy_path: { startsWith: currentUser.hierarchy_path }
    }
  };

  return await prisma.case.findMany({
    where: { 
      tenant_id,
      ...hierarchyFilter
    },
    include: {
      customer: true,
      applicants: true
    },
    orderBy: { created_at: 'desc' }
  });
}

async function getCaseById(case_id, tenant_id, currentUser) {
  const isBypassed = ['DSA_ADMIN', 'SUPER_ADMIN', 'MSME_CUSTOMER'].includes(currentUser.role);

  const hierarchyFilter = isBypassed ? {} : {
    created_by: {
      hierarchy_path: { startsWith: currentUser.hierarchy_path || '' }
    }
  };

  const existingCase = await prisma.case.findFirst({
    where: {
      id: parseInt(case_id, 10),
      tenant_id: tenant_id,
      ...hierarchyFilter
    },
    include: {
      customer: {
        include: {
          gst_profiles: { take: 1, orderBy: { created_at: 'desc' } },
          pan_profiles: { orderBy: { created_at: 'desc' }, include: { gstin_records: true } },
          gst_requests: { take: 1, orderBy: { updated_at: 'desc' }, where: { applicant_id: null, status: { in: ['COMPLETED', 'REPORT_READY', 'CALLBACK_RECEIVED'] } } },
          itr_analytics: { take: 1, orderBy: { updated_at: 'desc' }, where: { applicant_id: null } },
          bank_statements: { take: 1, orderBy: { updated_at: 'desc' }, where: { applicant_id: null } }
        }
      },
      applicants: {
        include: {
          bureau_checks: { orderBy: { created_at: 'desc' } },
          salary_ocr_results: { orderBy: { created_at: 'desc' } },
          income_entries: true,
          obligations: true,
          itr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
          bank_statements: { take: 1, orderBy: { created_at: 'desc' } }
        }
      },
      property: true,
      esr_financials: true,
      data_pull_status: true,
      stage_history: { 
        orderBy: { changed_at: 'desc' },
        include: { user: { select: { name: true, email: true } } }
      },
      activity_logs: { 
        orderBy: { created_at: 'desc' },
        include: { user: { select: { name: true, email: true } } }
      }
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

  // Fetch suggested co-applicants from other cases
  const otherCases = await prisma.case.findMany({
    where: {
      customer_id: existingCase.customer_id,
      tenant_id: tenant_id,
      id: { not: existingCase.id }
    },
    include: {
      applicants: {
        where: { type: 'CO_APPLICANT' },
        include: {
          bureau_checks: { take: 1 },
          documents: { take: 1 },
          income_entries: { take: 1 },
          obligations: { take: 1 },
          salary_ocr_results: { take: 1 },
          bank_statements: { take: 1 },
          itr_analytics: { take: 1 }
        }
      }
    },
    orderBy: { created_at: 'desc' }
  });

  const suggestions = [];
  const seenIdentifiers = new Set();
  // also add current case applicants to seen to avoid suggesting them
  for (const a of existingCase.applicants) {
    if (a.pan_number) seenIdentifiers.add(a.pan_number.toUpperCase());
    else if (a.mobile) seenIdentifiers.add(a.mobile);
  }

  for (const c of otherCases) {
    for (const a of c.applicants) {
      const identifier = a.pan_number ? a.pan_number.toUpperCase() : a.mobile;
      if (!identifier || seenIdentifiers.has(identifier)) continue;

      seenIdentifiers.add(identifier);
      suggestions.push({
        source_case_id: c.id,
        source_applicant_id: a.id,
        name: a.name,
        pan_number: a.pan_number,
        mobile: a.mobile,
        email: a.email,
        relationship_to_primary: a.relationship_to_primary,
        last_used_product: c.product_type,
        bureau_available: a.bureau_checks.length > 0 || a.bureau_fetched,
        documents_available: a.documents.length > 0,
        income_available: a.income_entries.length > 0,
        obligations_available: a.obligations.length > 0,
        salary_ocr_available: a.salary_ocr_results.length > 0,
        bank_available: a.bank_statements.length > 0,
        itr_available: a.itr_analytics.length > 0
      });
    }
  }

  // Extract business financials strictly
  const business_financials = {
    gst_profile: existingCase.customer.gst_profiles[0] || null,
    gst_request: existingCase.customer.gst_requests[0] || null,
    itr_analytics: existingCase.customer.itr_analytics[0] || null,
    bank_statements: existingCase.customer.bank_statements[0] || null
  };

  // Strip these from customer to avoid frontend confusion
  delete existingCase.customer.gst_profiles;
  delete existingCase.customer.gst_requests;
  delete existingCase.customer.itr_analytics;
  delete existingCase.customer.bank_statements;

  // STRIP HEAVY JSON PAYLOADS to prevent frontend freezing!
  if (business_financials.gst_request) {
    delete business_financials.gst_request.raw_gst_data;
  }
  if (business_financials.itr_analytics) {
    delete business_financials.itr_analytics.analytics_payload;
  }
  if (business_financials.bank_statements) {
    delete business_financials.bank_statements.raw_analyze_response;
    delete business_financials.bank_statements.raw_retrieve_response;
    delete business_financials.bank_statements.raw_download_response;
    delete business_financials.bank_statements.files_payload;
  }

  existingCase.applicants.forEach(app => {
    if (app.itr_analytics) {
      app.itr_analytics.forEach(itr => delete itr.analytics_payload);
    }
    if (app.bank_statements) {
      app.bank_statements.forEach(bank => {
        delete bank.raw_analyze_response;
        delete bank.raw_retrieve_response;
        delete bank.raw_download_response;
        delete bank.files_payload;
      });
    }
  });

  const { calculateRealPullStatuses } = require('./pullStatus.service');
  const real_pull_statuses = await calculateRealPullStatuses(existingCase.id);

  return {
    ...existingCase,
    business_financials,
    suggested_co_applicants: suggestions,
    real_pull_statuses
  };
}


async function getPipeline(tenantId, params, currentUser) {
  const { search, stage, lender, entity_type, alert, sort_by, sort_order, page, limit } = params;

  const isBypassed = currentUser.role === 'DSA_ADMIN';

  const hierarchyFilter = isBypassed ? {} : {
    created_by: {
      hierarchy_path: { startsWith: currentUser.hierarchy_path }
    }
  };

  let where = { 
    tenant_id: tenantId,
    ...hierarchyFilter
  };

  if (search) {
    where.OR = [
      { customer_name: { contains: search, mode: 'insensitive' } },
      { lender_name: { contains: search, mode: 'insensitive' } },
      { customer: { business_pan: { contains: search, mode: 'insensitive' } } },
      { customer: { business_mobile: { contains: search, mode: 'insensitive' } } },
      { customer: { business_email: { contains: search, mode: 'insensitive' } } },
      { customer: { business_name: { contains: search, mode: 'insensitive' } } }
    ];
    if (!isNaN(parseInt(search))) {
      where.OR.push({ id: parseInt(search) });
    }
  }

  if (stage) {
    if (stage === 'All') { } // Ignore filter
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
        customer: { select: { business_name: true, business_pan: true, industry: true, business_vintage: true, category: true } }
      }
    }),
    prisma.case.count({ where })
  ]);

  // Distinct customers count
  const distinctCustomers = await prisma.case.findMany({
    where: { 
      tenant_id: tenantId,
      ...hierarchyFilter 
    },
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

  // 2. Strict State Machine Dictionary
  const STATE_TRANSITIONS = {
    'DRAFT': ['LEAD_CREATED', 'REJECTED'],
    'LEAD_CREATED': ['DATA_COLLECTION', 'LEAD_SENT_TO_LENDER', 'REJECTED', 'CLOSED'],
    'DATA_COLLECTION': ['INCOME_REVIEWED', 'LEAD_SENT_TO_LENDER', 'REJECTED', 'CLOSED'],
    'INCOME_REVIEWED': ['LEAD_SENT_TO_LENDER', 'ESR_GENERATED', 'REJECTED', 'CLOSED'],
    'LEAD_SENT_TO_LENDER': ['ESR_GENERATED', 'IN_REVIEW', 'REJECTED', 'CLOSED'],
    'ESR_GENERATED': ['LEAD_SENT_TO_LENDER', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'],
    'IN_REVIEW': ['APPROVED', 'REJECTED', 'CLOSED'],
    'APPROVED': ['PARTLY_DISBURSED', 'DISBURSED', 'REJECTED', 'CLOSED'],
    'PARTLY_DISBURSED': ['DISBURSED', 'CLOSED', 'REJECTED'],
    'DISBURSED': ['CLOSED', 'REJECTED'],
    'CLOSED': [],
    'REJECTED': [] // Terminal state, unless rolled back by DSA_ADMIN
  };

  const allowedNext = STATE_TRANSITIONS[existingCase.stage];
  if (!allowedNext || !allowedNext.includes(newStage)) {
    throw new Error(`Invalid stage transition: Cannot move from ${existingCase.stage} to ${newStage}. Valid next stages are: ${allowedNext.join(', ')}`);
  }

  // 3. Case Lock Logic — lock on DISBURSED or PARTLY_DISBURSED (compliance requirement)
  const lockOnDisbursement = ['DISBURSED', 'PARTLY_DISBURSED', 'CLOSED'].includes(newStage);

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

async function advanceStage(caseId, tenantId, targetStage, userId) {
  const existingCase = await prisma.case.findFirst({
    where: { id: caseId, tenant_id: tenantId },
    select: { stage: true }
  });
  if (!existingCase) throw new Error('Case not found or unauthorized.');

  const forwardPaths = {
    LEAD_CREATED: {
      LEAD_SENT_TO_LENDER: ['LEAD_SENT_TO_LENDER'],
      ESR_GENERATED: ['LEAD_SENT_TO_LENDER', 'ESR_GENERATED']
    },
    DATA_COLLECTION: {
      LEAD_SENT_TO_LENDER: ['LEAD_SENT_TO_LENDER'],
      ESR_GENERATED: ['LEAD_SENT_TO_LENDER', 'ESR_GENERATED']
    },
    INCOME_REVIEWED: {
      LEAD_SENT_TO_LENDER: ['LEAD_SENT_TO_LENDER'],
      ESR_GENERATED: ['LEAD_SENT_TO_LENDER', 'ESR_GENERATED']
    },
    LEAD_SENT_TO_LENDER: {
      ESR_GENERATED: ['ESR_GENERATED']
    }
  };

  const steps = forwardPaths[existingCase.stage]?.[targetStage];
  if (!steps) {
    return await updateStage(caseId, tenantId, targetStage, userId);
  }

  let updatedCase = existingCase;
  for (const stage of steps) {
    updatedCase = await updateStage(caseId, tenantId, stage, userId);
  }
  return updatedCase;
}

async function rollbackStage(caseId, targetStage, reason, userId, tenantId, userRole) {
  if (userRole !== 'DSA_ADMIN') {
    throw new Error('Only DSA_ADMIN can perform stage rollback operations.');
  }

  const STAGE_ORDER = {
    'DRAFT': 1,
    'LEAD_CREATED': 2,
    'DATA_COLLECTION': 3,
    'INCOME_REVIEWED': 4,
    'LEAD_SENT_TO_LENDER': 5,
    'ESR_GENERATED': 6,
    'IN_REVIEW': 7,
    'APPROVED': 8,
    'PARTLY_DISBURSED': 9,
    'DISBURSED': 10,
    'CLOSED': 11,
    'REJECTED': 11
  };

  return await prisma.$transaction(async (tx) => {
    const existingCase = await tx.case.findFirst({
      where: { id: caseId, tenant_id: tenantId },
      include: {
        sanction: true,
        disbursements: true,
        pdd_tasks: true
      }
    });

    if (!existingCase) {
      throw new Error('Case not found.');
    }

    const currentOrder = STAGE_ORDER[existingCase.stage];
    const targetOrder = STAGE_ORDER[targetStage];

    if (!currentOrder || !targetOrder) {
      throw new Error('Invalid stages provided for rollback.');
    }

    if (targetOrder >= currentOrder) {
      throw new Error('Target stage must be earlier than the current stage to perform a rollback.');
    }

    let sanctionDeletedPayload = null;
    let cancelledDisbursements = [];
    let deletedPdds = [];

    // Rule: Rollback to APPROVED or before -> Cancel active disbursements and PDD tasks
    if (targetOrder <= STAGE_ORDER['APPROVED']) {
      // 1. Cancel disbursements
      const activeDisbursements = existingCase.disbursements.filter(d => d.status === 'RECORDED');
      if (activeDisbursements.length > 0) {
        cancelledDisbursements = activeDisbursements.map(d => d.id);
        await tx.disbursement.updateMany({
          where: { id: { in: cancelledDisbursements } },
          data: { status: 'CANCELLED', updated_at: new Date() }
        });
      }

      // 2. Archive and Delete related PDD tasks
      if (existingCase.pdd_tasks.length > 0) {
        deletedPdds = existingCase.pdd_tasks;
        await tx.pDDTask.deleteMany({
          where: { id: { in: deletedPdds.map(p => p.id) } }
        });
      }
    }

    // Rule: Rollback BEFORE APPROVED -> Archive sanction
    if (targetOrder < STAGE_ORDER['APPROVED'] && existingCase.sanction) {
      sanctionDeletedPayload = existingCase.sanction;

      // We can only hard delete the sanction if there are NO disbursements (not even CANCELLED ones),
      // because Disbursements have a hard foreign key (case_sanction_id) pointing to the Sanction.
      // If we don't delete it here, it's fine: the sanction service uses an `upsert` and will cleanly 
      // overwrite this row upon the next approval without throwing constraint errors.
      if (existingCase.disbursements.length === 0) {
        await tx.caseSanction.delete({
          where: { id: existingCase.sanction.id }
        });
      }
    }

    // Recompute Financial Summary Fields
    let updateData = {
      stage: targetStage,
      updated_at: new Date()
    };

    if (targetOrder === STAGE_ORDER['APPROVED']) {
      // If target is APPROVED, we kept sanction but wiped disbursements
      updateData.total_disbursed_amount = 0;
      updateData.remaining_disbursement_amount = existingCase.sanction ? existingCase.sanction.sanctioned_amount : 0;
      updateData.first_disbursement_date = null;
      updateData.last_disbursement_date = null;
    } else if (targetOrder < STAGE_ORDER['APPROVED']) {
      // If target before APPROVED, wipe sanction and disbursement snapshots
      updateData.sanctioned_amount = null;
      updateData.total_disbursed_amount = 0;
      updateData.remaining_disbursement_amount = null;
      updateData.first_disbursement_date = null;
      updateData.last_disbursement_date = null;
      // also clear lender/product snapshot from case if it was only driven by sanction
      // (But normally we keep lender_name from ESR/Lead sent. We will leave them intact for now)
    } else if (existingCase.stage === 'CLOSED' && targetStage === 'DISBURSED') {
      // Reopen to disbursed - do not touch financials. Case remains locked.
    }

    // Unlock case if we roll back from DISBURSED
    if (targetOrder < STAGE_ORDER['PARTLY_DISBURSED']) {
      updateData.is_locked = false;
    }

    // Apply Case Update
    const updatedCase = await tx.case.update({
      where: { id: caseId },
      data: updateData
    });

    // Logging: Audit Log
    const auditMetadata = {
      old_stage: existingCase.stage,
      target_stage: targetStage,
      reason,
      cancelled_disbursement_ids: cancelledDisbursements,
      affected_pdd_task_ids: deletedPdds,
      deleted_sanction_payload: sanctionDeletedPayload,
      financial_snapshot_before: {
        sanctioned_amount: existingCase.sanctioned_amount,
        total_disbursed_amount: existingCase.total_disbursed_amount,
        remaining_disbursement_amount: existingCase.remaining_disbursement_amount
      },
      financial_snapshot_after: {
        sanctioned_amount: updatedCase.sanctioned_amount,
        total_disbursed_amount: updatedCase.total_disbursed_amount,
        remaining_disbursement_amount: updatedCase.remaining_disbursement_amount
      },
      performed_by: userId,
      performed_at: new Date()
    };

    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        user_id: userId,
        action: 'STAGE_ROLLBACK',
        description: JSON.stringify(auditMetadata)
      }
    });

    // Logging: Activity Log
    await tx.activityLog.create({
      data: {
        case_id: caseId,
        customer_id: existingCase.customer_id,
        activity_type: 'STAGE_ROLLBACK',
        description: `Rollback to ${targetStage}. Reason: ${reason} ${sanctionDeletedPayload ? '(Sanction Deleted)' : ''}`,
        performed_by_user_id: userId
      }
    });

    // Logging: Stage History
    await tx.caseStageHistory.create({
      data: {
        case_id: caseId,
        tenant_id: tenantId,
        old_stage: existingCase.stage,
        new_stage: targetStage,
        changed_by: userId
      }
    });

    return updatedCase;
  });
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

async function createCaseFromExisting(customerId, tenantId, userId, productType = null) {
  return await prisma.$transaction(async (tx) => {
    // 1. Verify customer
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId }
    });
    if (!customer) throw new Error('Customer not found or unauthorized.');

    // 2. Find latest case with high-value data (OCR, Income, or Obligations)
    let latestCase = await tx.case.findFirst({
      where: {
        customer_id: customerId,
        tenant_id: tenantId,
        applicants: {
          some: {
            OR: [
              { salary_ocr_results: { some: {} } },
              { income_entries: { some: {} } },
              { obligations: { some: {} } }
            ]
          }
        }
      },
      orderBy: { created_at: 'desc' },
      include: {
        applicants: {
          include: {
            income_entries: true,
            obligations: true,
            salary_ocr_results: true,
            documents: true,
            itr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
            bank_statements: { take: 1, orderBy: { created_at: 'desc' } },
            gstr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
            bureau_checks: { take: 1, orderBy: { created_at: 'desc' } }
          }
        },
        property: true,
        esr_financials: true
      }
    });

    if (!latestCase) {
      // Fallback: Latest case with at least one applicant
      latestCase = await tx.case.findFirst({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          applicants: { some: {} }
        },
        orderBy: { created_at: 'desc' },
        include: {
          applicants: {
            include: {
              income_entries: true,
              obligations: true,
              salary_ocr_results: true,
              documents: true,
              itr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
              bank_statements: { take: 1, orderBy: { created_at: 'desc' } },
              gstr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
              bureau_checks: { take: 1, orderBy: { created_at: 'desc' } }
            }
          },
          property: true,
          esr_financials: true
        }
      });
    }

    if (!latestCase) {
      // Final Fallback: Absolute latest case
      latestCase = await tx.case.findFirst({
        where: { customer_id: customerId, tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        include: {
          applicants: {
            include: {
              income_entries: true,
              obligations: true,
              salary_ocr_results: true,
              documents: true,
              itr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
              bank_statements: { take: 1, orderBy: { created_at: 'desc' } },
              gstr_analytics: { take: 1, orderBy: { created_at: 'desc' } },
              bureau_checks: { take: 1, orderBy: { created_at: 'desc' } }
            }
          },
          property: true,
          esr_financials: true
        }
      });
    }

    if (!latestCase) {
      return await createCase(customerId, productType, tenantId, userId);
    }

    // 3. Create new Case
    const user = await tx.user.findUnique({ where: { id: userId }, include: { role: true } });
    const isMsme = user?.role?.name === 'MSME_CUSTOMER';

    const newCase = await tx.case.create({
      data: {
        tenant_id: tenantId,
        customer_id: customerId,
        created_by_user_id: userId,
        product_type: productType || latestCase.product_type,
        stage: 'DRAFT',
        customer_name: customer.business_name,
        entity_type: customer.entity_type,
        lead_source: isMsme ? 'DIRECT_MSME' : 'DSA',
        msme_customer_user_id: isMsme ? userId : null
      }
    });

    // 4. Clone Applicants and their nested data (ONLY PRIMARY)
    for (const oldApp of latestCase.applicants) {
      if (oldApp.type !== 'PRIMARY') continue;

      const newApp = await tx.applicant.create({
        data: {
          case_id: newCase.id,
          type: oldApp.type,
          is_primary: oldApp.is_primary,
          employment_type: oldApp.employment_type,
          name: oldApp.name,
          pan_number: oldApp.pan_number,
          mobile: oldApp.mobile,
          email: oldApp.email,
          cibil_score: oldApp.cibil_score,
          otp_verified: oldApp.otp_verified,
          bureau_fetched: oldApp.bureau_fetched
        }
      });

      // Clone Income Entries
      if (oldApp.income_entries.length > 0) {
        await tx.caseIncomeEntry.createMany({
          data: oldApp.income_entries.map(entry => ({
            case_id: newCase.id,
            applicant_id: newApp.id,
            income_type: entry.income_type,
            applicant_label: entry.applicant_label,
            annual_amount: entry.annual_amount,
            supporting_doc_type: entry.supporting_doc_type,
            remarks: entry.remarks
          }))
        });
      }

      // Clone Obligations
      if (oldApp.obligations.length > 0) {
        await tx.caseCreditObligation.createMany({
          data: oldApp.obligations.map(ob => ({
            case_id: newCase.id,
            applicant_id: newApp.id,
            lender_name: ob.lender_name,
            loan_type: ob.loan_type,
            loan_amount: ob.loan_amount,
            outstanding_amount: ob.outstanding_amount,
            loan_start_date: ob.loan_start_date,
            emi_per_month: ob.emi_per_month,
            status: ob.status,
            source: ob.source,
            needs_verification: ob.needs_verification,
            include_in_foir: ob.include_in_foir,
            remarks: ob.remarks
          }))
        });
      }

      // Clone Salary OCR Results
      if (oldApp.salary_ocr_results.length > 0) {
        for (const ocr of oldApp.salary_ocr_results) {
          let newDocId = null;

          // If there's an associated document, clone it first
          if (ocr.document_id) {
            const oldDoc = await tx.document.findUnique({ where: { id: ocr.document_id } });
            if (oldDoc) {
              const newDoc = await tx.document.create({
                data: {
                  tenant_id: tenantId,
                  customer_id: customerId,
                  case_id: newCase.id,
                  applicant_id: newApp.id,
                  document_type: oldDoc.document_type,
                  source_type: oldDoc.source_type,
                  source_url: oldDoc.source_url,
                  storage_provider: oldDoc.storage_provider,
                  storage_path: oldDoc.storage_path,
                  file_name: oldDoc.file_name,
                  original_file_name: oldDoc.original_file_name,
                  mime_type: oldDoc.mime_type,
                  extension: oldDoc.extension,
                  file_size_bytes: oldDoc.file_size_bytes,
                  checksum_md5: oldDoc.checksum_md5,
                  status: oldDoc.status,
                  metadata: oldDoc.metadata || {},
                  uploaded_by_user_id: userId
                }
              });
              newDocId = newDoc.id;
            }
          }

          await tx.salarySlipOcrResult.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              case_id: newCase.id,
              applicant_id: newApp.id,
              document_id: newDocId,
              month: ocr.month,
              year: ocr.year,
              ocr_status: ocr.ocr_status,
              gross_salary: ocr.gross_salary,
              net_salary: ocr.net_salary,
              deductions: ocr.deductions,
              employer_name: ocr.employer_name,
              employee_name: ocr.employee_name,
              vendor_name: ocr.vendor_name,
              vendor_job_id: ocr.vendor_job_id,
              raw_ocr_response: ocr.raw_ocr_response || {},
              extracted_json: ocr.extracted_json || {},
              error_message: ocr.error_message
            }
          });
        }
      }

      // Clone Bureau Checks
      for (const bureau of oldApp.bureau_checks) {
        await tx.bureauVerification.create({
          data: {
            case_id: newCase.id,
            applicant_id: newApp.id,
            applicant_type: newApp.type,
            request_id: `${bureau.request_id}_REUSE_${Date.now()}`,
            stan: bureau.stan,
            mobile_number: bureau.mobile_number,
            score: bureau.score,
            raw_response: bureau.raw_response || {},
            status: bureau.status,
            emi_obligations_total: bureau.emi_obligations_total
          }
        });
      }

      // Clone ITR Analytics
      for (const itr of oldApp.itr_analytics) {
        await tx.itrAnalyticsRequest.create({
          data: {
            tenant_id: tenantId,
            customer_id: customerId,
            case_id: newCase.id,
            applicant_id: newApp.id,
            pan: itr.pan,
            reference_id: `${itr.reference_id}_REUSE_${Date.now()}`,
            status: itr.status,
            analytics_payload: itr.analytics_payload || {},
            provider_message: itr.provider_message,
            net_profit_latest_year: itr.net_profit_latest_year,
            net_profit_previous_year: itr.net_profit_previous_year,
            gross_receipts_latest_year: itr.gross_receipts_latest_year,
            gross_receipts_previous_year: itr.gross_receipts_previous_year,
            financial_year_latest: itr.financial_year_latest,
            financial_year_previous: itr.financial_year_previous,
            created_by_user_id: userId
          }
        });
      }

      // Clone Bank Statements
      for (const bank of oldApp.bank_statements) {
        await tx.bankStatementAnalysisRequest.create({
          data: {
            tenant_id: tenantId,
            customer_id: customerId,
            case_id: newCase.id,
            applicant_id: newApp.id,
            reference_id: `${bank.reference_id}_REUSE_${Date.now()}`,
            status: bank.status,
            analysis_payload: bank.analysis_payload || {},
            provider_message: bank.provider_message,
            average_monthly_balance: bank.average_monthly_balance,
            average_monthly_credits: bank.average_monthly_credits,
            average_monthly_debits: bank.average_monthly_debits,
            emi_bounces: bank.emi_bounces,
            created_by_user_id: userId
          }
        });
      }

      // Clone GST Analytics
      for (const gst of oldApp.gstr_analytics) {
        await tx.gstrAnalyticsRequest.create({
          data: {
            tenant_id: tenantId,
            customer_id: customerId,
            case_id: newCase.id,
            applicant_id: newApp.id,
            mode: gst.mode,
            auth_type: gst.auth_type,
            gstin: gst.gstin,
            username: gst.username,
            from_date: gst.from_date,
            to_date: gst.to_date,
            provider_request_id: `${gst.provider_request_id}_REUSE_${Date.now()}`,
            status: gst.status,
            provider_message: gst.provider_message,
            raw_gst_data: gst.raw_gst_data || {},
            turnover_latest_year: gst.turnover_latest_year,
            turnover_previous_year: gst.turnover_previous_year,
            financial_year_latest: gst.financial_year_latest,
            financial_year_previous: gst.financial_year_previous,
            created_by_user_id: userId
          }
        });
      }
    }

    // 5. Clone ESR Financials (optional but good for reuse)
    if (latestCase.esr_financials) {
      await tx.caseEsrFinancials.create({
        data: {
          case_id: newCase.id,
          requested_loan_amount: latestCase.esr_financials.requested_loan_amount,
          requested_tenure_months: latestCase.esr_financials.requested_tenure_months,
          product_type: productType || latestCase.esr_financials.product_type,
          property_value: latestCase.esr_financials.property_value,
          property_type: latestCase.esr_financials.property_type,
          occupancy_type: latestCase.esr_financials.occupancy_type,
          bureau_score: latestCase.esr_financials.bureau_score,
          applicant_age: latestCase.esr_financials.applicant_age,
          existing_obligations: latestCase.esr_financials.existing_obligations,
          icici_exposure: latestCase.esr_financials.icici_exposure,
          itr_pat: latestCase.esr_financials.itr_pat,
          itr_depreciation: latestCase.esr_financials.itr_depreciation,
          itr_finance_cost: latestCase.esr_financials.itr_finance_cost,
          itr_gross_receipts: latestCase.esr_financials.itr_gross_receipts,
          gst_avg_monthly_sales: latestCase.esr_financials.gst_avg_monthly_sales,
          gst_industry_type: latestCase.esr_financials.gst_industry_type,
          gst_industry_margin: latestCase.esr_financials.gst_industry_margin,
          bank_avg_balance: latestCase.esr_financials.bank_avg_balance,
          bank_monthly_income: latestCase.esr_financials.bank_monthly_income,
          net_profit_income: latestCase.esr_financials.net_profit_income,
          gst_income: latestCase.esr_financials.gst_income,
          banking_income: latestCase.esr_financials.banking_income,
          selected_income_method: latestCase.esr_financials.selected_income_method,
          selected_monthly_income: latestCase.esr_financials.selected_monthly_income,
          constitution_type: latestCase.esr_financials.constitution_type,
          employment_type: latestCase.esr_financials.employment_type,
          business_vintage_months: latestCase.esr_financials.business_vintage_months
        }
      });
    }

    return newCase;
  });
}

async function reuseApplicant(caseId, sourceApplicantId, tenantId, userId) {
  return await prisma.$transaction(async (tx) => {
    // 1. Verify target case
    const targetCase = await tx.case.findFirst({
      where: { id: parseInt(caseId, 10), tenant_id: tenantId }
    });
    if (!targetCase) throw new Error('Target case not found or unauthorized.');
    if (targetCase.is_locked) throw new Error('Target case is locked.');

    // 2. Verify source applicant
    const sourceApp = await tx.applicant.findFirst({
      where: { id: parseInt(sourceApplicantId, 10) },
      include: {
        case: true,
        bureau_checks: true,
        documents: true,
        income_entries: true,
        obligations: true,
        salary_ocr_results: true,
        bank_statements: true,
        itr_analytics: true
      }
    });
    if (!sourceApp) throw new Error('Source applicant not found.');
    if (sourceApp.type !== 'CO_APPLICANT') throw new Error('Only CO_APPLICANT records can be reused.');
    if (sourceApp.case.tenant_id !== tenantId) throw new Error('Source applicant belongs to a different tenant.');
    if (sourceApp.case.customer_id !== targetCase.customer_id) throw new Error('Source applicant belongs to a different customer.');

    // 3. Prevent duplicate reuse in the same target case
    const alreadyReused = await tx.applicant.findFirst({
      where: {
        case_id: targetCase.id,
        pan_number: sourceApp.pan_number,
        mobile: sourceApp.mobile
      }
    });
    if (alreadyReused) throw new Error('This applicant is already added to the current case.');

    // 4. Create new CO_APPLICANT
    const newApp = await tx.applicant.create({
      data: {
        case_id: targetCase.id,
        type: 'CO_APPLICANT',
        is_primary: false,
        employment_type: sourceApp.employment_type,
        name: sourceApp.name,
        pan_number: sourceApp.pan_number,
        mobile: sourceApp.mobile,
        email: sourceApp.email,
        relationship_to_primary: sourceApp.relationship_to_primary,
        cibil_score: sourceApp.cibil_score,
        otp_verified: true,
        bureau_fetched: sourceApp.bureau_fetched
      }
    });

    // 5. Clone Documents (Reference existing files)
    for (const doc of sourceApp.documents) {
      await tx.document.create({
        data: {
          tenant_id: tenantId,
          customer_id: targetCase.customer_id,
          case_id: targetCase.id,
          applicant_id: newApp.id,
          document_type: doc.document_type,
          source_type: doc.source_type,
          source_url: doc.source_url,
          storage_provider: doc.storage_provider,
          storage_path: doc.storage_path,
          file_name: doc.file_name,
          original_file_name: doc.original_file_name,
          mime_type: doc.mime_type,
          extension: doc.extension,
          file_size_bytes: doc.file_size_bytes,
          checksum_md5: doc.checksum_md5,
          status: doc.status,
          metadata: { ...doc.metadata, reused_from_document_id: doc.id, reused_from_case_id: sourceApp.case_id },
          uploaded_by_user_id: userId
        }
      });
    }

    // 6. Clone Bureau Checks
    for (const bureau of sourceApp.bureau_checks) {
      await tx.bureauVerification.create({
        data: {
          case_id: targetCase.id,
          applicant_id: newApp.id,
          applicant_type: newApp.type,
          request_id: `${bureau.request_id}_REUSE_${Date.now()}`,
          stan: bureau.stan,
          mobile_number: bureau.mobile_number,
          score: bureau.score,
          raw_response: bureau.raw_response ? bureau.raw_response : {},
          status: bureau.status,
          emi_obligations_total: bureau.emi_obligations_total
        }
      });
    }

    // 7. Clone Income Entries
    if (sourceApp.income_entries.length > 0) {
      await tx.caseIncomeEntry.createMany({
        data: sourceApp.income_entries.map(entry => ({
          case_id: targetCase.id,
          applicant_id: newApp.id,
          income_type: entry.income_type,
          applicant_label: entry.applicant_label,
          annual_amount: entry.annual_amount,
          supporting_doc_type: entry.supporting_doc_type,
          remarks: entry.remarks ? `[Reused] ${entry.remarks}` : '[Reused]'
        }))
      });
    }

    // 8. Clone Obligations
    if (sourceApp.obligations.length > 0) {
      await tx.caseCreditObligation.createMany({
        data: sourceApp.obligations.map(ob => ({
          case_id: targetCase.id,
          applicant_id: newApp.id,
          lender_name: ob.lender_name,
          loan_type: ob.loan_type,
          loan_amount: ob.loan_amount,
          outstanding_amount: ob.outstanding_amount,
          loan_start_date: ob.loan_start_date,
          emi_per_month: ob.emi_per_month,
          status: ob.status,
          source: ob.source,
          needs_verification: ob.needs_verification,
          include_in_foir: ob.include_in_foir,
          remarks: ob.remarks ? `[Reused] ${ob.remarks}` : '[Reused]'
        }))
      });
    }

    // 9. Clone Salary OCR
    for (const ocr of sourceApp.salary_ocr_results) {
      let newDocId = null;
      if (ocr.document_id) {
        // Find the newly cloned document for this OCR result by matching storage_path
        const oldDoc = sourceApp.documents.find(d => d.id === ocr.document_id);
        if (oldDoc) {
          const newlyClonedDoc = await tx.document.findFirst({
            where: { applicant_id: newApp.id, storage_path: oldDoc.storage_path }
          });
          if (newlyClonedDoc) newDocId = newlyClonedDoc.id;
        }
      }

      await tx.salarySlipOcrResult.create({
        data: {
          tenant_id: tenantId,
          customer_id: targetCase.customer_id,
          case_id: targetCase.id,
          applicant_id: newApp.id,
          document_id: newDocId,
          month: ocr.month,
          year: ocr.year,
          ocr_status: ocr.ocr_status,
          gross_salary: ocr.gross_salary,
          net_salary: ocr.net_salary,
          deductions: ocr.deductions,
          employer_name: ocr.employer_name,
          employee_name: ocr.employee_name,
          vendor_name: ocr.vendor_name,
          vendor_job_id: ocr.vendor_job_id,
          raw_ocr_response: ocr.raw_ocr_response ? ocr.raw_ocr_response : {},
          extracted_json: ocr.extracted_json ? ocr.extracted_json : {},
          error_message: ocr.error_message
        }
      });
    }

    // 10. Clone ITR Analytics
    if (sourceApp.itr_analytics && sourceApp.itr_analytics.length > 0) {
      for (const itr of sourceApp.itr_analytics) {
        await tx.itrAnalyticsRequest.create({
          data: {
            tenant_id: tenantId,
            customer_id: targetCase.customer_id,
            case_id: targetCase.id,
            applicant_id: newApp.id,
            pan: itr.pan,
            reference_id: `${itr.reference_id}_REUSE_${Date.now()}`,
            status: itr.status,
            analytics_payload: itr.analytics_payload || {},
            provider_message: itr.provider_message,
            net_profit_latest_year: itr.net_profit_latest_year,
            net_profit_previous_year: itr.net_profit_previous_year,
            gross_receipts_latest_year: itr.gross_receipts_latest_year,
            gross_receipts_previous_year: itr.gross_receipts_previous_year,
            financial_year_latest: itr.financial_year_latest,
            financial_year_previous: itr.financial_year_previous,
            created_by_user_id: userId
          }
        });
      }
    }

    // 11. Clone Bank Statements
    if (sourceApp.bank_statements && sourceApp.bank_statements.length > 0) {
      for (const bank of sourceApp.bank_statements) {
        await tx.bankStatementAnalysisRequest.create({
          data: {
            tenant_id: tenantId,
            customer_id: targetCase.customer_id,
            case_id: targetCase.id,
            applicant_id: newApp.id,
            reference_id: `${bank.reference_id}_REUSE_${Date.now()}`,
            status: bank.status,
            analysis_payload: bank.analysis_payload || {},
            provider_message: bank.provider_message,
            average_monthly_balance: bank.average_monthly_balance,
            average_monthly_credits: bank.average_monthly_credits,
            average_monthly_debits: bank.average_monthly_debits,
            emi_bounces: bank.emi_bounces,
            created_by_user_id: userId
          }
        });
      }
    }

    // 12. Clone GST Analytics
    if (sourceApp.gstr_analytics && sourceApp.gstr_analytics.length > 0) {
      for (const gst of sourceApp.gstr_analytics) {
        await tx.gstrAnalyticsRequest.create({
          data: {
            tenant_id: tenantId,
            customer_id: targetCase.customer_id,
            case_id: targetCase.id,
            applicant_id: newApp.id,
            mode: gst.mode,
            auth_type: gst.auth_type,
            gstin: gst.gstin,
            username: gst.username,
            from_date: gst.from_date,
            to_date: gst.to_date,
            provider_request_id: `${gst.provider_request_id}_REUSE_${Date.now()}`,
            status: gst.status,
            provider_message: gst.provider_message,
            raw_gst_data: gst.raw_gst_data || {},
            turnover_latest_year: gst.turnover_latest_year,
            turnover_previous_year: gst.turnover_previous_year,
            financial_year_latest: gst.financial_year_latest,
            financial_year_previous: gst.financial_year_previous,
            created_by_user_id: userId
          }
        });
      }
    }

    return newApp;
  });
}

async function removeApplicant(caseId, applicantId, tenantId) {
  return await prisma.$transaction(async (tx) => {
    const targetCase = await tx.case.findFirst({
      where: { id: parseInt(caseId, 10), tenant_id: tenantId }
    });
    if (!targetCase) throw new Error('Target case not found or unauthorized.');
    if (targetCase.is_locked) throw new Error('Target case is locked.');

    const app = await tx.applicant.findFirst({
      where: { id: parseInt(applicantId, 10), case_id: targetCase.id }
    });
    if (!app) throw new Error('Applicant not found in this case.');
    if (app.type === 'PRIMARY') throw new Error('Cannot remove primary applicant.');

    // Delete cascading references inside this case only
    await tx.caseIncomeEntry.deleteMany({ where: { applicant_id: app.id } });
    await tx.caseCreditObligation.deleteMany({ where: { applicant_id: app.id } });
    await tx.salarySlipOcrResult.deleteMany({ where: { applicant_id: app.id } });
    await tx.applicantBureauCheck.deleteMany({ where: { applicant_id: app.id } });
    await tx.document.deleteMany({ where: { applicant_id: app.id } });
    await tx.itrAnalyticsRequest.deleteMany({ where: { applicant_id: app.id } });
    await tx.bankStatementAnalysisRequest.deleteMany({ where: { applicant_id: app.id } });
    await tx.gstrAnalyticsRequest.deleteMany({ where: { applicant_id: app.id } });

    await tx.applicant.delete({ where: { id: app.id } });

    return { success: true, message: 'Applicant removed.' };
  });
}

module.exports = {
  createCase,
  createSalariedCase,
  createCaseFromExisting,
  addApplicant,
  reuseApplicant,
  removeApplicant,
  updateProduct,
  updateProductProperty,
  getAllCases,
  getCaseById,
  getPipeline,
  updateStage,
  advanceStage,
  rollbackStage,
  syncCustomerSnapshots
};
