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
    const { id, type, name, pan_number, mobile, email, employment_type } = req.body;
    
    if (!type || !['PRIMARY', 'CO_APPLICANT'].includes(type)) {
      return res.status(400).json({ error: 'Invalid applicant type.' });
    }

    const tenant_id = req.user.tenant_id;

    const applicant = await caseService.addApplicant(caseId, { id, type, pan_number, mobile, email, employment_type }, tenant_id);
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
    const updatedCase = await caseService.updateProduct(caseId, product_type, req.user.tenant_id);
    res.json(updatedCase);
  } catch (error) {
    if (error.message === 'Case not found or unauthorized.') return res.status(403).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Internal server error while updating product.' });
  }
}

async function updateProductProperty(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { product_type, property } = req.body;
    if (!product_type) return res.status(400).json({ error: 'product_type is required.' });

    const result = await caseService.updateProductProperty(caseId, { product_type, property }, req.user.tenant_id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Case not found or unauthorized.') return res.status(403).json({ error: error.message });
    if (error.message.includes('required')) return res.status(400).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Failed to save product and property.' });
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
           itr: hasSuccessLog('ITR_ANALYTICS')
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

async function getPipeline(req, res) {
  try {
    const tenant_id = req.user.tenant_id;
    const { search, stage, lender, entity_type, alert, sort_by, sort_order, page, limit } = req.query;
    
    const result = await caseService.getPipeline(tenant_id, {
      search, stage, lender, entity_type, alert, sort_by, sort_order,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10
    });
    
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while fetching pipeline cases.' });
  }
}

async function updateStage(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { stage } = req.body;
    const tenant_id = req.user.tenant_id;
    
    if (!stage) return res.status(400).json({ error: 'Stage is required' });
    
    // Protection: Financial stages must only be reached via Disbursement Service
    if (['PARTLY_DISBURSED', 'DISBURSED'].includes(stage)) {
      return res.status(400).json({ error: `Direct update to ${stage} is not allowed. Please use the Disbursement flow.` });
    }

    const updatedCase = await caseService.updateStage(caseId, tenant_id, stage, req.user.id);
    res.json(updatedCase);
  } catch (error) {
    if (error.message === 'Case not found or unauthorized.') return res.status(403).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Internal server error while updating case stage.' });
  }
}

async function createFromExisting(req, res) {
  try {
    const { customer_id, product_type } = req.body;
    if (!customer_id) return res.status(400).json({ error: 'customer_id is required.' });

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const newCase = await caseService.createCaseFromExisting(parseInt(customer_id, 10), tenant_id, user_id, product_type);
    res.status(201).json(newCase);
  } catch (error) {
    if (error.message === 'Customer not found or unauthorized.') return res.status(403).json({ error: error.message });
    console.error(error);
    res.status(500).json({ error: 'Internal server error while creating case from existing customer.' });
  }
}

async function reuseApplicant(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { source_applicant_id } = req.body;

    if (!source_applicant_id) {
      return res.status(400).json({ error: 'source_applicant_id is required.' });
    }

    const tenant_id = req.user.tenant_id;
    const user_id = req.user.id;

    const newApp = await caseService.reuseApplicant(caseId, source_applicant_id, tenant_id, user_id);
    res.status(201).json(newApp);
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('unauthorized') || error.message.includes('different')) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message.includes('locked') || error.message.includes('already added') || error.message.includes('Only CO_APPLICANT')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[reuseApplicant] Error:', error);
    res.status(500).json({ error: 'Internal server error while reusing applicant.' });
  }
}

async function removeApplicant(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const applicantId = parseInt(req.params.applicantId, 10);
    const tenant_id = req.user.tenant_id;

    await caseService.removeApplicant(caseId, applicantId, tenant_id);
    res.json({ message: 'Applicant removed successfully' });
  } catch (error) {
    if (error.message.includes('unauthorized') || error.message.includes('Primary')) {
      return res.status(403).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to remove applicant.' });
  }
}

async function rollbackStage(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { target_stage, reason, confirmation } = req.body;
    const userId = req.user.id;
    const tenantId = req.user.tenant_id;
    const userRole = req.user?.role?.name || req.user?.role || req.user?.role_name;

    if (userRole !== 'DSA_ADMIN') {
      return res.status(403).json({ error: 'Only DSA Admin can rollback stages.' });
    }

    if (!target_stage || !reason) {
      return res.status(400).json({ error: 'target_stage and reason are required.' });
    }

    if (confirmation !== true) {
      return res.status(400).json({ error: 'Rollback confirmation is required.' });
    }

    const updatedCase = await caseService.rollbackStage(caseId, target_stage, reason, userId, tenantId, userRole);
    res.json(updatedCase);
  } catch (error) {
    console.error(error);
    if (error.message.includes('earlier') || error.message.includes('Invalid') || error.message.includes('Only DSA_ADMIN')) {
       return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to rollback stage.' });
  }
}

module.exports = {
  createCase,
  createFromExisting,
  addApplicant,
  reuseApplicant,
  updateProduct,
  updateProductProperty,
  getCases,
  getCaseById,
  getSummary,
  getCoBorrowers,
  getPipeline,
  updateStage,
  getActivityLog,
  removeApplicant,
  rollbackStage
};
