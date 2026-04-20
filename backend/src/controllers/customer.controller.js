const customerService = require('../services/customer.service');
const prisma = require('../../config/db');

async function checkCustomer(req, res) {
  try {
    const { pan } = req.query;
    if (!pan) {
      return res.status(400).json({ error: 'PAN is required' });
    }

    const tenant_id = req.user.tenant_id;
    const customer = await customerService.checkCustomerByPan(pan, tenant_id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found in your tenant.' });
    }

    res.json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while checking customer.' });
  }
}

async function createOrAttach(req, res) {
  try {
    const { business_pan, business_mobile, business_email, business_name, customer_id } = req.body;
    
    if (!business_pan && !customer_id) {
      return res.status(400).json({ error: 'business_pan or customer_id is required.' });
    }

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const customer = await customerService.createOrAttachCustomer({
      customer_id,
      business_pan,
      business_mobile,
      business_email,
      business_name
    }, tenant_id, user_id);

    res.status(200).json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while creating or attaching customer.' });
  }
}

function resolveApiStatus(logs, apiCode) {
    const apiLogs = logs.filter(l => l.api_code === apiCode);
    if (apiLogs.some(l => l.status === 'SUCCESS')) return 'COMPLETE';
    if (apiLogs.some(l => l.status === 'FAILED')) return 'PENDING';
    return 'NOT_STARTED';
}

async function getProfile(req, res) {
  // #swagger.tags = ['Customers']
  // #swagger.summary = 'Get Customer Profile Drilldown'
  try {
    const customerId = parseInt(req.params.customer_id, 10);
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
         cases: { orderBy: { created_at: 'desc' }, include: { applicants: true } },
         activity_logs: { orderBy: { created_at: 'desc' }, include: { user: true } },
         api_logs: true
      }
    });

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // Isolation Check
    if (req.user.role.name !== 'SUPER_ADMIN' && customer.tenant_id !== req.user.tenant_id) {
       return res.status(403).json({ error: 'Forbidden. Customer belongs to different tenant.' });
    }

    const latestCase = customer.cases[0] || {};
    const primaryApplicant = latestCase.applicants?.find(a => a.type === 'PRIMARY') || {};
    const coBorrowers = (latestCase.applicants || []).filter(a => a.type === 'CO_APPLICANT').map(a => ({
       name: a.email || 'Co-Applicant', // If name isn't present, map email natively
       pan_masked: a.pan_number ? `XXXXX${a.pan_number.slice(5, 9)}X` : null,
       cibil_score: a.cibil_score,
       role: a.type,
       otp_verified: a.otp_verified,
       bureau_fetched: a.bureau_fetched
    }));

    res.json({
       customer_id: customer.id,
       case_id: latestCase.id,
       customer_name: customer.business_name || 'N/A',
       entity_type: customer.entity_type,
       industry: customer.industry,
       business_vintage: customer.business_vintage,
       cibil_score: primaryApplicant.cibil_score || null,
       loan_amount: latestCase.loan_amount,
       lender_name: latestCase.lender_name,
       case_stage: latestCase.stage,
       location: latestCase.location,
       property_value: latestCase.property_value,
       ltv_ratio: latestCase.ltv_ratio,
       co_borrowers: coBorrowers,
       primary_applicant_id: primaryApplicant.id || null,
       primary_applicant_bureau_fetched: primaryApplicant.bureau_fetched || false,
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
     const customer = await prisma.customer.findUnique({
       where: { id: customerId },
       include: { api_logs: true, cases: { include: { applicants: true } } }
     });

     if (!customer) return res.status(404).json({ error: 'Customer not found' });
     if (req.user.role.name !== 'SUPER_ADMIN' && customer.tenant_id !== req.user.tenant_id) {
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
  getProfile,
  getApiAvailability
};
