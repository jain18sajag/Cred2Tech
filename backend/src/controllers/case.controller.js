const caseService = require('../services/case.service');

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

module.exports = {
  createCase,
  addApplicant,
  updateProduct,
  getCases,
  getCaseById
};
