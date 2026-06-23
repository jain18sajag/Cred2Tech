const express = require('express');
const {
  getDashboard, updateProfile, initiateEligibility, startForm, updateBusinessDetails,
  updateLoanDetails, getPaymentConfig, createPaymentOrder, verifyPayment,
  runEligibility, getEligibilityResult, selectLender, submitCase
} = require('../controllers/direct.customer.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('MSME_CUSTOMER'));

router.get('/dashboard', getDashboard);
router.put('/profile', updateProfile);

router.post('/eligibility/initiate', initiateEligibility);
router.get('/eligibility/start-form', startForm);

router.put('/case/business-details', updateBusinessDetails);
router.put('/case/loan-details', updateLoanDetails);

router.get('/payment/config', getPaymentConfig);
router.post('/payment/create-order', createPaymentOrder);
router.post('/payment/verify', verifyPayment);

router.post('/eligibility/run', runEligibility);
router.get('/eligibility/result', getEligibilityResult);

router.post('/lender/select', selectLender);
router.post('/case/submit', submitCase);

module.exports = router;
