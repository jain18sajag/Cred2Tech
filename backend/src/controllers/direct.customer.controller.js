const directCustomerService = require('../services/direct.customer.service');
const { sendCaughtError } = require('../utils/sendError');

async function getDashboard(req, res) {
  try {
    const result = await directCustomerService.getDashboard(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to fetch dashboard');
  }
}

async function updateProfile(req, res) {
  try {
    const result = await directCustomerService.updateProfile(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to update profile');
  }
}

async function initiateEligibility(req, res) {
  try {
    const result = await directCustomerService.initiateEligibility(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to initiate eligibility check');
  }
}

async function startForm(req, res) {
  try {
    const result = await directCustomerService.startForm(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to start form', 403);
  }
}

async function updateBusinessDetails(req, res) {
  try {
    const result = await directCustomerService.updateBusinessDetails(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to update business details');
  }
}

async function updateLoanDetails(req, res) {
  try {
    const result = await directCustomerService.updateLoanDetails(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to update loan details');
  }
}

async function getPaymentConfig(req, res) {
  try {
    const result = await directCustomerService.getPaymentConfig();
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to fetch payment config');
  }
}

async function createPaymentOrder(req, res) {
  try {
    const result = await directCustomerService.createPaymentOrder(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to create payment order');
  }
}

async function verifyPayment(req, res) {
  try {
    const result = await directCustomerService.verifyPayment(req.user.id, req.body);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to verify payment');
  }
}

async function runEligibility(req, res) {
  try {
    const result = await directCustomerService.runEligibility(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to run eligibility check', 403); // 403 for payment gate
  }
}

async function getEligibilityResult(req, res) {
  try {
    const result = await directCustomerService.getEligibilityResult(req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to fetch eligibility result');
  }
}

async function selectLender(req, res) {
  try {
    const { esr_lender_id } = req.body;
    if (!esr_lender_id) return res.status(400).json({ error: 'esr_lender_id is required' });
    const result = await directCustomerService.selectLender(req.user.id, parseInt(esr_lender_id, 10));
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to select lender');
  }
}

async function submitCase(req, res) {
  try {
    const { caseId } = req.body || {};
    const result = await directCustomerService.submitCase(req.user.id, caseId);
    return res.status(200).json(result);
  } catch (err) {
    sendCaughtError(res, err, 'Failed to submit case');
  }
}

module.exports = {
  getDashboard, updateProfile, initiateEligibility, startForm, updateBusinessDetails, updateLoanDetails,
  getPaymentConfig, createPaymentOrder, verifyPayment, runEligibility, getEligibilityResult,
  selectLender, submitCase
};
