const directCustomerService = require('../services/direct.customer.service');

async function getDashboard(req, res) {
  try {
    const result = await directCustomerService.getDashboard(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const result = await directCustomerService.updateProfile(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function initiateEligibility(req, res) {
  try {
    const result = await directCustomerService.initiateEligibility(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function startForm(req, res) {
  try {
    const result = await directCustomerService.startForm(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }
}

async function updateBusinessDetails(req, res) {
  try {
    const result = await directCustomerService.updateBusinessDetails(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function updateLoanDetails(req, res) {
  try {
    const result = await directCustomerService.updateLoanDetails(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function getPaymentConfig(req, res) {
  try {
    const result = await directCustomerService.getPaymentConfig();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function createPaymentOrder(req, res) {
  try {
    const result = await directCustomerService.createPaymentOrder(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function verifyPayment(req, res) {
  try {
    const result = await directCustomerService.verifyPayment(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function runEligibility(req, res) {
  try {
    const result = await directCustomerService.runEligibility(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(403).json({ error: err.message }); // Use 403 for payment gate
  }
}

async function getEligibilityResult(req, res) {
  try {
    const result = await directCustomerService.getEligibilityResult(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function selectLender(req, res) {
  try {
    const { esr_lender_id } = req.body;
    if (!esr_lender_id) return res.status(400).json({ error: 'esr_lender_id is required' });
    const result = await directCustomerService.selectLender(req.user.id, parseInt(esr_lender_id, 10));
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function submitCase(req, res) {
  try {
    const { caseId } = req.body;
    const result = await directCustomerService.submitCase(req.user.id, caseId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  getDashboard, updateProfile, initiateEligibility, startForm, updateBusinessDetails, updateLoanDetails,
  getPaymentConfig, createPaymentOrder, verifyPayment, runEligibility, getEligibilityResult,
  selectLender, submitCase
};
