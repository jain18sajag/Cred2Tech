const customerService = require('../services/customer.service');
const caseService = require('../services/case.service');
const prisma = require('../../config/db');
const { logSensitiveAccess } = require('../utils/auditLog');

async function checkCustomer(req, res) {
  try {
    const { pan } = req.query;

    // This endpoint is strictly PAN-only for the "Continue as New Case" reuse flow
    if (!pan) {
      return res.status(400).json({
        existingCustomerFound: false,
        error: 'pan query parameter is required'
      });
    }

    const normalizedPan = pan.trim().toUpperCase();

    // Validate PAN format (10 alphanumeric characters)
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(normalizedPan)) {
      return res.status(400).json({
        existingCustomerFound: false,
        error: 'Invalid PAN format'
      });
    }

    const tenant_id = req.user.tenant_id;

    // Strict PAN-only lookup within tenant
    const customer = await customerService.checkCustomerByPan(normalizedPan, tenant_id);

    if (!customer) {
      return res.status(404).json({
        existingCustomerFound: false,
        message: 'No existing customer found in your tenant'
      });
    }

    // Fetch reusable data summary
    const reusableSummary = await customerService.getReusableSummary(customer.id, tenant_id);

    return res.json({
      existingCustomerFound: true,
      matchType: 'PAN',
      customer: {
        id: customer.id,
        business_pan: customer.business_pan,
        business_name: customer.business_name,
        business_mobile: customer.business_mobile,
        business_email: customer.business_email,
        category: customer.category,
        entity_type: customer.entity_type
      },
      reusable_summary: reusableSummary
    });
  } catch (error) {
    console.error('[checkCustomer]', error);
    res.status(500).json({
      existingCustomerFound: false,
      error: 'Internal server error while checking customer.'
    });
  }
}

async function createOrAttach(req, res) {
  try {
    let { business_pan, business_mobile, business_email, business_name, customer_id, is_professional, profession_type } = req.body;
    
    business_pan = business_pan?.trim().toUpperCase();
    const mobileStr = business_mobile ? business_mobile.toString().replace(/\D/g, '') : null;

    if (!business_pan && !customer_id) {
      return res.status(400).json({ error: 'business_pan or customer_id is required.' });
    }

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const customer = await customerService.createOrAttachCustomer({
      customer_id,
      business_pan,
      business_mobile: mobileStr,
      business_email,
      business_name,
      is_professional,
      profession_type
    }, tenant_id, user_id);

    res.status(200).json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while creating or attaching customer.' });
  }
}

async function createSalariedCustomer(req, res) {
  try {
    let { business_pan, business_name, business_mobile, business_email, product_type } = req.body;
    
    business_pan = business_pan?.trim().toUpperCase();

    if (!business_pan) {
      return res.status(400).json({ error: 'business_pan is required.' });
    }

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const mobileStr = business_mobile ? business_mobile.toString().replace(/\D/g, '') : null;

    const newCase = await caseService.createSalariedCase({
      business_pan,
      business_name,
      business_mobile: mobileStr,
      business_email,
      product_type
    }, tenant_id, user_id);

    res.status(201).json({ success: true, data: newCase });
  } catch (error) {
    console.error('[customer.controller] createSalariedCustomer error:', error);
    res.status(500).json({ error: 'Internal server error while creating customer.' });
  }
}

function resolveApiStatus(logs, apiCode) {
    const apiLogs = logs.filter(l => l.api_code === apiCode);
    if (apiLogs.some(l => l.status === 'SUCCESS')) return 'COMPLETE';
    if (apiLogs.some(l => l.status === 'FAILED')) return 'PENDING';
    return 'NOT_STARTED';
}

const toINR = (v) => {
  if (!v) return null;
  const n = Number(v);
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

async function getProfile(req, res) {
  // #swagger.tags = ['Customers']
  // #swagger.summary = 'Get Customer Profile Drilldown'
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    const tenantId = req.user.tenant_id;
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';

    const customer = await prisma.customer.findFirst({
      // Scope by tenant at the query itself (not just the response check below) —
      // SUPER_ADMIN is the only role allowed to look across tenants.
      where: isSuperAdmin ? { id: customerId } : { id: customerId, tenant_id: tenantId },
      include: {
        pan_profiles: { take: 1, orderBy: { created_at: 'desc' } },
        cases: {
          where: { tenant_id: tenantId },
          orderBy: { created_at: 'desc' },
          include: {
            property: true,            // property details for Property & Collateral card
            esr_financials: true,      // FOIR from ESR financials
            applicants: {
              include: { bureau_checks: { orderBy: { created_at: 'desc' }, take: 1 } }
            }
          }
        },
        activity_logs: { orderBy: { created_at: 'desc' }, take: 20, include: { user: true } },
        api_logs: true,
        documents: {
          where: { tenant_id: tenantId, status: 'ACTIVE' },
          orderBy: { created_at: 'desc' },
          select: {
            id: true, document_type: true, original_file_name: true,
            file_name: true, mime_type: true, extension: true,
            file_size_bytes: true, status: true, case_id: true,
            applicant_id: true, created_at: true
          }
        },
        // Fetch latest GST, ITR, bank data for Income Summary card
        gst_requests: {
          orderBy: { updated_at: 'desc' },
          take: 1,
          where: { status: { in: ['REPORT_READY', 'COMPLETED', 'CALLBACK_RECEIVED'] } }
        },
        itr_analytics: {
          orderBy: { updated_at: 'desc' },
          take: 1,
          where: { status: 'COMPLETED' }
        },
        bank_statements: {
          orderBy: { updated_at: 'desc' },
          take: 1,
          where: { status: 'COMPLETED' }
        }
      }
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Tenant isolation (defense-in-depth — already enforced in the query above)
    if (!isSuperAdmin && customer.tenant_id !== tenantId) {
       return res.status(403).json({ error: 'Forbidden. Customer belongs to different tenant.' });
    }

    // Direct MSME customers share one tenant with every other direct customer,
    // so tenant_id alone doesn't isolate them from each other's profiles.
    if (req.user.role === 'MSME_CUSTOMER' && customer.created_by_user_id !== req.user.id) {
       return res.status(403).json({ error: 'Forbidden. You do not have access to this customer.' });
    }

    await logSensitiveAccess({
      tenantId: customer.tenant_id, userId: req.user.id, resourceType: 'CUSTOMER_PROFILE',
      resourceId: customerId, action: 'VIEW', ip: req.ip
    });

    const panProfile = customer.pan_profiles?.[0] || null;
    const latestCase = customer.cases?.[0] || null;
    const esrFinancials = latestCase?.esr_financials || null;

    // Compute FOIR from ESR financials
    const foirPct = (esrFinancials?.existing_obligations && esrFinancials?.selected_monthly_income)
      ? ((esrFinancials.existing_obligations / esrFinancials.selected_monthly_income) * 100).toFixed(0) + '%'
      : null;

    // Income Summary data from real financial pulls
    const gst = customer.gst_requests?.[0] || null;
    const itr = customer.itr_analytics?.[0] || null;
    const bank = customer.bank_statements?.[0] || null;

    // Build bureau summary — deduplicated across all cases
    const bureauSummary = [];
    const seenApplicants = new Set();
    for (const c of customer.cases) {
      for (const app of c.applicants) {
        if (seenApplicants.has(app.id)) continue;
        seenApplicants.add(app.id);
        const latestBureau = app.bureau_checks?.[0] || null;
        // Primary applicant gets the business name; co-applicant gets mobile or fallback
        const displayName = app.type === 'PRIMARY'
          ? (customer.business_name || app.mobile || 'Primary Applicant')
          : (app.name || app.mobile || 'Co-Applicant');
        bureauSummary.push({
          applicant_id: app.id,
          applicant_type: app.type,
          name: displayName,
          pan_masked: app.pan_number ? `XXXXX${app.pan_number.slice(5, 9)}X` : null,
          mobile: app.mobile,
          cibil_score: app.cibil_score,
          bureau_fetched: app.bureau_fetched,
          active_loan_count: latestBureau?.active_loan_count ?? null,
          emi_obligations_total: latestBureau?.emi_obligations_total ? Number(latestBureau.emi_obligations_total) : null,
          overdue_amount: latestBureau?.overdue_amount ? Number(latestBureau.overdue_amount) : null,
          status: app.bureau_fetched ? 'Active' : 'Pending'
        });
      }
    }

    const cases = customer.cases.map(c => ({
      id: c.id,
      stage: c.stage,
      product_type: c.product_type,
      loan_amount: c.loan_amount,
      lender_name: c.lender_name,
      updated_at: c.updated_at,
      created_at: c.created_at,
      // Property & Collateral — from CasePropertyDetails (Phase 1) or legacy Case fields
      property_type: c.property?.property_type || c.property_type || null,
      location: c.location || null,  // legacy field; CasePropertyDetails has no location
      property_value: c.property?.market_value || c.property_value || null,
      ownership_type: c.property?.ownership_type || null,
      encumbrance: c.property?.occupancy_status || null,  // using occupancy_status as closest equivalent
    }));

    res.json({
      customer_id: customer.id,
      customer_name: customer.business_name || 'N/A',
      entity_type: customer.entity_type,
      industry: customer.industry,
      business_vintage: customer.business_vintage,
      business_pan: customer.business_pan,
      business_mobile: customer.business_mobile,
      business_email: customer.business_email,
      mobile_verified: customer.mobile_verified,
      is_professional: customer.is_professional,
      profession_type: customer.profession_type,
      // PAN Profile enrichment
      gstin: panProfile?.gstin || null,
      legal_name: panProfile?.legal_name || null,
      trade_name: panProfile?.trade_name || null,
      principal_address: panProfile?.principal_address || null,
      principal_city: panProfile?.principal_city || null,
      principal_state: panProfile?.principal_state || null,
      principal_pincode: panProfile?.principal_pincode || null,
      director_names: panProfile?.director_names || null,
      annual_turnover_range: panProfile?.annual_turnover_range || null,
      // Income Summary — from real financial API pulls
      income_summary: {
        gst_turnover_avg_12m: gst?.turnover_latest_year ? toINR(Number(gst.turnover_latest_year) / 12) : null,
        gst_turnover_annual: gst?.turnover_latest_year ? toINR(gst.turnover_latest_year) : null,
        gst_fy: gst?.financial_year_latest || null,
        itr_net_income: itr?.net_profit_latest_year ? toINR(itr.net_profit_latest_year) : null,
        itr_fy: itr?.financial_year_latest || null,
        bank_avg_monthly_credit: bank?.avg_monthly_credit ? toINR(bank.avg_monthly_credit) : null,
        bank_fy: bank?.financial_year_latest || null,
        foir: foirPct,
        last_updated: latestCase?.updated_at || null,
      },
      // Cases list (with property data merged)
      cases,
      // Documents list
      documents: customer.documents,
      // Bureau summary
      bureau_summary: bureauSummary,
      // Activity log
      activity_log: customer.activity_logs.map(log => ({
        timestamp: log.created_at,
        activity_type: log.activity_type,
        description: log.description,
        performed_by: log.user ? log.user.name : 'System'
      })),
      api_status: {
        bureau: resolveApiStatus(customer.api_logs, 'BUREAU_PULL'),
        gst: resolveApiStatus(customer.api_logs, 'GST_FETCH'),
        itr: resolveApiStatus(customer.api_logs, 'ITR_ANALYTICS')
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed retrieving customer profile' });
  }
}

async function getApiAvailability(req, res) {
  // #swagger.tags = ['Customers']
  // #swagger.summary = 'Check API Action Button states'
  try {
     const customerId = parseInt(req.params.customer_id, 10);
     const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
     const customer = await prisma.customer.findFirst({
       where: isSuperAdmin ? { id: customerId } : { id: customerId, tenant_id: req.user.tenant_id },
       include: { api_logs: true, cases: { include: { applicants: true } } }
     });

     if (!customer) return res.status(404).json({ error: 'Customer not found' });
     if (!isSuperAdmin && customer.tenant_id !== req.user.tenant_id) {
       return res.status(403).json({ error: 'Forbidden.' });
     }
     if (req.user.role === 'MSME_CUSTOMER' && customer.created_by_user_id !== req.user.id) {
       return res.status(403).json({ error: 'Forbidden.' });
     }

     const apiStatus = {
        bureau: resolveApiStatus(customer.api_logs, 'BUREAU_PULL'),
        gst: resolveApiStatus(customer.api_logs, 'GST_FETCH'),
        itr: resolveApiStatus(customer.api_logs, 'ITR_ANALYTICS')
     };

     const latestCase = customer.cases[0] || {};
     const primaryApplicant = latestCase.applicants?.find(a => a.type === 'PRIMARY');
     const otpVerified = primaryApplicant ? primaryApplicant.otp_verified : false;

     res.json({
        case_id: latestCase.id,
        can_pull_gst: apiStatus.gst !== 'COMPLETE',
        can_pull_itr: apiStatus.itr !== 'COMPLETE',
        can_pull_bureau: apiStatus.bureau !== 'COMPLETE' && otpVerified,
        bureau_reason: !otpVerified ? "OTP not verified yet" : (apiStatus.bureau === 'COMPLETE' ? "Already pulled" : null)
     });
  } catch (error) {
     console.error(error);
     res.status(500).json({ error: 'Failed resolving availability' });
  }
}

module.exports = {
  checkCustomer,
  createOrAttach,
  createSalariedCustomer,
  getProfile,
  getApiAvailability
};
