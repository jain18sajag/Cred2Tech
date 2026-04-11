const express = require('express');
const router = express.Router();
const externalApiController = require('../controllers/externalApi.controller');
const panController = require('../controllers/external.pan.controller');
const { authenticate } = require('../middleware/auth.middleware');

const gstController = require('../controllers/external.gst.controller');

// Unauthenticated webhook
router.post('/webhooks/signzy/gst', express.json(), gstController.handleSignzyCallback);

router.use(authenticate);

router.post('/bureau-pull', externalApiController.bureauPull);
router.post('/itr-fetch', externalApiController.itrFetch);
router.post('/bank-analysis', externalApiController.bankAnalysis);

// GST Integration
router.post('/gst/create', gstController.createGstRequest);
router.post('/gst/submit-otp', gstController.submitGstOtp);
router.post('/gst/sync', gstController.syncGstData);
router.get('/gst/requests', gstController.getRequestDetails);

// New PAN Integration
router.post('/pan/fetch', panController.fetchPanIntelligence);

module.exports = router;
