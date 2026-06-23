const prisma = require('../../config/db');

async function checkCustomerByPan(business_pan, tenant_id) {
  const pan = business_pan?.trim().toUpperCase();
  const customer = await prisma.customer.findFirst({
    where: {
      business_pan: pan,
      tenant_id
    }
  });
  return customer;
}

async function findDuplicates({ pan, mobile, email }, tenant_id) {
  // Normalize PAN
  const normalizedPan = pan?.trim().toUpperCase();

  // If PAN is provided, it is the primary identifier. We should only match by PAN.
  if (normalizedPan) {
    return await prisma.customer.findFirst({
      where: {
        business_pan: normalizedPan,
        tenant_id
      }
    });
  }

  // If no PAN is provided yet, fallback to mobile or email
  const or = [];
  if (mobile) or.push({ business_mobile: mobile });
  if (email) or.push({ business_email: email });

  if (or.length === 0) return null;

  return await prisma.customer.findFirst({
    where: {
      tenant_id,
      OR: or
    }
  });
}

async function getReusableSummary(customer_id, tenant_id) {
  const [gst, itr, bank, allCases] = await Promise.all([
    prisma.gstrAnalyticsRequest.findFirst({
      where: { customer_id, status: { in: ['COMPLETED', 'REPORT_READY', 'CALLBACK_RECEIVED'] } },
      orderBy: { updated_at: 'desc' }
    }),
    prisma.itrAnalyticsRequest.findFirst({
      where: { customer_id, status: 'COMPLETED' },
      orderBy: { updated_at: 'desc' }
    }),
    prisma.bankStatementAnalysisRequest.findFirst({
      where: { customer_id, status: 'COMPLETED' },
      orderBy: { updated_at: 'desc' }
    }),
    prisma.case.findMany({
      where: { customer_id, tenant_id },
      orderBy: { created_at: 'desc' },
      include: {
        applicants: {
          include: {
            bureau_checks: { where: { status: { in: ['SUCCESS', 'COMPLETED'] } }, orderBy: { created_at: 'desc' }, take: 1 },
            salary_ocr_results: { where: { ocr_status: 'COMPLETED' }, orderBy: { created_at: 'desc' }, take: 3 },
            income_entries: true,
            obligations: true
          }
        }
      }
    })
  ]);

  const latestCase = allCases[0] || null;
  const allApplicants = latestCase?.applicants || [];
  const allIncomeEntries = allApplicants.flatMap(a => a.income_entries || []);

  const bureauAvailable = allApplicants.some(a => a.bureau_checks.length > 0 || a.obligations.length > 0);
  const ocrAvailable = allApplicants.some(a => a.salary_ocr_results.length > 0);

  return {
    has_previous_case: !!latestCase,
    previous_cases_count: allCases.length,
    latest_case_id: latestCase?.id || null,
    gst: gst ? { available: true, last_updated: gst.updated_at } : { available: false, last_updated: null },
    itr: itr ? { available: true, last_updated: itr.updated_at } : { available: false, last_updated: null },
    bank: bank ? { available: true, last_updated: bank.updated_at } : { available: false, last_updated: null },
    bureau: bureauAvailable ? { available: true, last_updated: null } : { available: false, last_updated: null },
    salary_ocr: ocrAvailable ? { available: true, last_updated: null } : { available: false, last_updated: null },
    income_entries: allIncomeEntries.length > 0 ? { available: true, count: allIncomeEntries.length } : { available: false, count: 0 },
    applicants: allApplicants.length > 0 ? { available: true, count: allApplicants.length } : { available: false, count: 0 }
  };
}

async function createOrAttachCustomer(data, tenant_id, user_id) {
  const { business_pan, business_mobile, business_email, business_name, customer_id, is_professional, profession_type } = data;
  const normalizedPan = business_pan?.trim().toUpperCase();
  const verifiedSources = ['GST_LEGAL_NAME', 'GST_TRADE_NAME', 'PAN_VERIFICATION'];

  if (customer_id) {
    const existing = await prisma.customer.findFirst({
      where: { id: parseInt(customer_id, 10), tenant_id }
    });
    
    if (!existing) {
        throw new Error('Customer not found or unauthorized.');
    }

    const keepVerifiedName = existing && verifiedSources.includes(existing.business_name_source);
    const finalBusinessName = keepVerifiedName ? existing.business_name : (business_name || existing.business_name);
    const finalSource = keepVerifiedName ? existing.business_name_source : (business_name ? 'MANUAL' : existing.business_name_source);

    return await prisma.customer.update({
      where: { id: existing.id },
      data: {
        business_mobile,
        business_email,
        business_name: finalBusinessName,
        business_name_source: finalSource,
        is_professional: is_professional !== undefined ? is_professional : existing.is_professional,
        profession_type: profession_type !== undefined ? profession_type : existing.profession_type
      }
    });
  }

  // Try to find the existing customer within this tenant
  let customer = await prisma.customer.findFirst({
    where: {
      business_pan: normalizedPan,
      tenant_id
    }
  });

  // If not found, create a new one
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        tenant_id,
        business_pan: normalizedPan,
        business_mobile,
        business_email,
        business_name,
        business_name_source: business_name ? 'MANUAL' : null,
        is_professional: is_professional || false,
        profession_type: profession_type || null,
        created_by_user_id: user_id
      }
    });
  } else {
    // Dynamically update fields if the user provided new data
    const keepVerifiedName = customer && verifiedSources.includes(customer.business_name_source);
    const finalBusinessName = keepVerifiedName ? customer.business_name : (business_name || customer.business_name);
    const finalSource = keepVerifiedName ? customer.business_name_source : (business_name ? 'MANUAL' : customer.business_name_source);

    customer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        business_mobile: business_mobile || customer.business_mobile,
        business_email: business_email || customer.business_email,
        business_name: finalBusinessName,
        business_name_source: finalSource,
        is_professional: is_professional !== undefined ? is_professional : customer.is_professional,
        profession_type: profession_type !== undefined ? profession_type : customer.profession_type
      }
    });
  }

  // Harden: Sync Case snapshots (customer_name, entity_type) to prevent stale data in Pipeline
  const { syncCustomerSnapshots } = require('./case.service');
  syncCustomerSnapshots(customer.id, tenant_id).catch(err => console.error('Snapshot sync failed:', err));

  return customer;
}

module.exports = {
  checkCustomerByPan,
  findDuplicates,
  getReusableSummary,
  createOrAttachCustomer
};
