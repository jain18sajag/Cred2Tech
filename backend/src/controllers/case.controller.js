const caseService = require('../services/case.service');
const prisma = require('../../config/db');
const { buildReportFileName, generateLoanApplicationSummaryWorkbook } = require('../services/reports/loanApplicationSummary.service');
const { buildBulkUploadResponse } = require('../utils/bulkUploadResponse');

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
    const { id, type, name, pan_number, mobile, email, pincode, employment_type } = req.body;

    if (!type || !['PRIMARY', 'CO_APPLICANT'].includes(type)) {
      return res.status(400).json({ error: 'Invalid applicant type.' });
    }

    const tenant_id = req.user.tenant_id;
    const mobileStr = mobile ? mobile.toString().replace(/\D/g, '') : null;

    const applicant = await caseService.addApplicant(caseId, { id, type, name, pan_number, mobile: mobileStr, email, pincode, employment_type }, tenant_id);
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
    const cases = await caseService.getAllCases(tenant_id, req.user);
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
    const caseRecord = await caseService.getCaseById(caseId, tenant_id, req.user);
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
        api_logs: true,
        created_by: true
      }
    });

    if (!caseRecord) return res.status(404).json({ error: 'Case not found' });

    const roleName = req.user.role?.name || req.user.role;
    if (caseRecord.tenant_id !== req.user.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const isBypassed = roleName === 'DSA_ADMIN';
    if (!isBypassed && caseRecord.created_by_user_id !== req.user.id) {
      if (!caseRecord.created_by?.hierarchy_path?.startsWith(req.user.hierarchy_path)) {
        return res.status(403).json({ error: 'Forbidden: Hierarchy restriction' });
      }
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
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
}

async function getCoBorrowers(req, res) {
  // #swagger.tags = ['Cases']
  try {
    const caseId = parseInt(req.params.id, 10);
    const caseRecord = await prisma.case.findUnique({
      where: { id: caseId },
      include: { applicants: true, created_by: true }
    });

    if (!caseRecord) return res.status(404).json({ error: 'Case not found' });

    const roleName = req.user.role?.name || req.user.role;
    if (caseRecord.tenant_id !== req.user.tenant_id) return res.status(403).json({ error: 'Forbidden' });

    const isBypassed = roleName === 'DSA_ADMIN';
    if (!isBypassed && caseRecord.created_by_user_id !== req.user.id) {
      if (!caseRecord.created_by?.hierarchy_path?.startsWith(req.user.hierarchy_path)) {
        return res.status(403).json({ error: 'Forbidden: Hierarchy restriction' });
      }
    }

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
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
}

async function getActivityLog(req, res) {
  // #swagger.tags = ['Cases']
  try {
    const caseId = parseInt(req.params.id, 10);
    const caseRecord = await prisma.case.findUnique({ where: { id: caseId }, include: { created_by: true } });

    if (!caseRecord) return res.status(404).json({ error: 'Case not found' });

    const roleName = req.user.role?.name || req.user.role;
    if (caseRecord.tenant_id !== req.user.tenant_id) return res.status(403).json({ error: 'Forbidden' });

    const isBypassed = roleName === 'DSA_ADMIN';
    if (!isBypassed && caseRecord.created_by_user_id !== req.user.id) {
      if (!caseRecord.created_by?.hierarchy_path?.startsWith(req.user.hierarchy_path)) {
        return res.status(403).json({ error: 'Forbidden: Hierarchy restriction' });
      }
    }

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
  } catch (error) {
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
    }, req.user);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error while fetching pipeline cases.' });
  }
}

async function updateStage(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const { stage, tenant_lender_id, product_type } = req.body;
    const tenant_id = req.user.tenant_id;

    if (!stage) return res.status(400).json({ error: 'Stage is required' });

    // Protection: Financial stages must only be reached via Disbursement Service
    if (['PARTLY_DISBURSED', 'DISBURSED'].includes(stage)) {
      return res.status(400).json({ error: `Direct update to ${stage} is not allowed. Please use the Disbursement flow.` });
    }

    const updatedCase = await caseService.advanceStage(caseId, tenant_id, stage, req.user.id, { tenant_lender_id, product_type });
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

async function downloadBulkTemplate(req, res) {
  try {
    const bulkCaseUploadService = require('../services/bulkCaseUpload.service');
    const buffer = await bulkCaseUploadService.generateTemplate();

    res.setHeader('Content-Disposition', 'attachment; filename="Cred2Tech_Case_Bulk_Upload_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Template generation error:', error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
}

async function uploadBulkCases(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const tenantId = req.user.tenant_id;
    const userId = req.user.id;
    const bulkCaseUploadService = require('../services/bulkCaseUpload.service');
    const fs = require('fs');

    const fileBuffer = fs.readFileSync(req.file.path);
    const result = await bulkCaseUploadService.processUpload(fileBuffer, tenantId, userId);
    
    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch(e) {}

    if (result.failedRows > 0 && result.createdCases === 0) {
      return res.status(400).json(buildBulkUploadResponse(result, false, 'Bulk upload validation failed'));
    }

    res.status(201).json(buildBulkUploadResponse(result, true, 'Bulk upload completed'));

  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error during upload' });
  }
}

async function downloadLoanApplicationSummary(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    if (!caseId) return res.status(400).json({ error: 'Invalid case id.' });

    const buffer = await generateLoanApplicationSummaryWorkbook({
      caseId,
      tenantId: req.user.tenant_id,
      user: req.user
    });

    const fileName = buildReportFileName(caseId);
    const encodedName = encodeURIComponent(fileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodedName}`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(buffer));
  } catch (error) {
    if (error.statusCode === 404 || error.message === 'Case not found or unauthorized.') {
      return res.status(404).json({ error: 'Case not found or unauthorized.' });
    }
    console.error('[LoanApplicationSummary] Download failed:', error);
    res.status(500).json({ error: 'Failed to generate Loan Application Summary.' });
  }
}

async function getPullStatuses(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const tenantId = req.user.tenant_id;

    const existingCase = await prisma.case.findFirst({
      where: { id: caseId, tenant_id: tenantId }
    });
    if (!existingCase) {
      return res.status(403).json({ error: 'Case not found or unauthorized.' });
    }

    const { calculateRealPullStatuses } = require('../services/pullStatus.service');
    const statuses = await calculateRealPullStatuses(caseId);
    res.json(statuses);
  } catch (error) {
    console.error('[getPullStatuses] Error:', error);
    res.status(500).json({ error: 'Failed to retrieve pull statuses.' });
  }
}

async function allocateDsaUser(req, res) {
  try {
    const { id } = req.params;
    const { assigned_dsa_user_id } = req.body;
    
    if (!assigned_dsa_user_id) {
      return res.status(400).json({ error: 'assigned_dsa_user_id is required' });
    }

    const updatedCase = await caseService.allocateDsaUser(
      parseInt(id, 10),
      req.user.tenant_id,
      parseInt(assigned_dsa_user_id, 10),
      req.user
    );

    res.json(updatedCase);
  } catch (error) {
    console.error('[allocateDsaUser] Error:', error);
    res.status(400).json({ error: error.message || 'Failed to allocate case' });
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
  rollbackStage,
  downloadBulkTemplate,
  downloadLoanApplicationSummary,
  uploadBulkCases,
  getPullStatuses,
  allocateDsaUser
};
