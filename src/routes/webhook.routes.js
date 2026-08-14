const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

// Use raw body parser explicitly for the razorpay webhook to verify signatures accurately
router.post('/razorpay', express.raw({ type: 'application/json' }), webhookController.handleRazorpayWebhook);

module.exports = router;
