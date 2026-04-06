const caseService = require('../services/case.service');
const prisma = require('../../config/db');

async function createCase(req, res) {
  try {
    const { customer_id, product_type } = req.body;
    
    if (!customer_id) {
      return res.status(400).json({ error: 'customer_id is required.' });
    }

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const newCase = await caseService.createCase(customer_id, product_type, tenant_id, user_id);
    
    res.status(201).json(newCase);
  } catch (error) {
    if (error.message === 'Customer not found or unauthorized.') {
      return res.status(403).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error while creating case.' });
  }
}

async function addApplicant(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { id, type, pan_number, mobile, email } = req.body;
    
    if (!type || !['PRIMARY', 'CO_APPLICANT'].includes(type)) {
      return res.status(400).json({ error: 'Invalid applicant type.' });
    }

    const tenant_id = req.user.tenant_id;

    const applicant = await caseService.addApplicant(caseId, { id, type, pan_number, mobile, email }, tenant_id);
    res.status(201).json(applicant);
  } catch (error) {
    if (error.message === 'Case not found or unauthorized.') {
      return res.status(403).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error while adding applicant.' });
  }
}

async function updateProduct(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { product_type } = req.body;

    const tenant_id = req.user.tenant_id;

    const updatedCase = await caseService.updateProduct(caseId, product_type, tenant_id);
    res.json(updatedCase);
  } catch (error) {
    if (error.message === 'Case not found or unauthorized.') {
      return res.status(403).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error while updating product.' });
  }
}

async function getCases(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const cases = await caseService.getAllCases(tenant_id);
    res.json(cases);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while fetching cases.' });
  }
}

async function getCaseById(req, res) {
  try {
    const caseId = req.params.id;
    const tenant_id = req.user.tenant_id;
    const caseRecord = await caseService.getCaseById(caseId, tenant_id);
    res.json(caseRecord);
  } catch (error) {
    if (error.message === 'Case not found or unauthorized.') {
      return res.status(403).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error while fetching case.' });
  }
}

async function getSummary(req, res) {
  // #swagger.tags = ['Cases']
  // #swagger.summary = 'Fetch comprehensive case summary'
  try {
     const caseId = parseInt(req.params.id, 10);
     const caseRecord = await prisma.case.findUnique({
        where: { id: caseId },
        include: {
           customer: true,
           applicants: true,
           api_logs: true
        }
     });

     if (!caseRecord) return res.status(404).json({ error: 'Case not found' });
     if (req.user.role.name !== 'SUPER_ADMIN' && caseRecord.tenant_id !== req.user.tenant_id) {
        return res.status(403).json({ error: 'Forbidden' });
     }

     const primaryApplicant = caseRecord.applicants?.find(a => a.type === 'PRIMARY') || {};
     
     const hasSuccessLog = (apiCode) => caseRecord.api_logs.some(l => l.api_code === apiCode && l.status === 'SUCCESS');

     res.json({
        case_id: caseRecord.id,
        customer_name: caseRecord.customer.business_name || 'N/A',
        entity_type: caseRecord.customer.entity_type,
        industry: caseRecord.customer.industry,
        business_vintage: caseRecord.customer.business_vintage,
        cibil_score: primaryApplicant.cibil_score,
        lender: caseRecord.lender_name,
        loan_amount: caseRecord.loan_amount,
        property_type: caseRecord.property_type,
        occupancy: caseRecord.occupancy,
        property_value: caseRecord.property_value,
        location: caseRecord.location,
        ltv_ratio: caseRecord.ltv_ratio,
        dsa_notes: caseRecord.dsa_notes,
        reports_generated: {
           esr: false,
           bureau: hasSuccessLog('BUREAU_PULL'),
           gst: hasSuccessLog('GST_FETCH'),
           itr: hasSuccessLog('ITR_FETCH')
        }
     });
  } catch(error) {
     res.status(500).json({ error: 'Failed' });
  }
}

async function getCoBorrowers(req, res) {
  // #swagger.tags = ['Cases']
  try {
     const caseId = parseInt(req.params.id, 10);
     const caseRecord = await prisma.case.findUnique({
        where: { id: caseId },
        include: { applicants: true }
     });

     if (!caseRecord) return res.status(404).json({ error: 'Case not found' });
     if (req.user.role.name !== 'SUPER_ADMIN' && caseRecord.tenant_id !== req.user.tenant_id) return res.status(403).json({ error: 'Forbidden' });

     const coBorrowers = caseRecord.applicants.filter(a => a.type === 'CO_APPLICANT').map(a => ({
         name: a.email || 'Co-Applicant',
         pan_masked: a.pan_number ? `XXXXX${a.pan_number.slice(5, 9)}X` : null,
         cibil_score: a.cibil_score,
         emi: a.emi,
         role: a.type,
         otp_verified: a.otp_verified,
         bureau_fetched: a.bureau_fetched
     }));

     res.json(coBorrowers);
  } catch(error) {
     res.status(500).json({ error: 'Failed' });
  }
}

async function getActivityLog(req, res) {
  // #swagger.tags = ['Cases']
  try {
     const caseId = parseInt(req.params.id, 10);
     const caseRecord = await prisma.case.findUnique({ where: { id: caseId } });
     
     if (!caseRecord) return res.status(404).json({ error: 'Case not found' });
     if (req.user.role.name !== 'SUPER_ADMIN' && caseRecord.tenant_id !== req.user.tenant_id) return res.status(403).json({ error: 'Forbidden' });

     const logs = await prisma.activityLog.findMany({
         where: { case_id: caseId },
         orderBy: { created_at: 'desc' },
         include: { user: true }
     });

     res.json(logs.map(log => ({
         timestamp: log.created_at,
         activity_type: log.activity_type,
         description: log.description,
         performed_by: log.user ? log.user.name : 'System'
     })));
  } catch(error) {
     res.status(500).json({ error: 'Failed' });
  }
}

module.exports = {
  createCase,
  addApplicant,
  updateProduct,
  getCases,
  getCaseById,
  getSummary,
  getCoBorrowers,
  getActivityLog
};
