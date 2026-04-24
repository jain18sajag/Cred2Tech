const express = require('express');
const router = express.Router();
const externalApiController = require('../controllers/externalApi.controller');
const panController = require('../controllers/external.pan.controller');
const { authenticate } = require('../middleware/auth.middleware');

const gstController = require('../controllers/external.gst.controller');
const itrAnalyticsController = require('../controllers/external.itrAnalytics.controller');
const bankController = require('../controllers/external.bank.controller');

// Unauthenticated webhooks
router.post('/webhooks/signzy/gst', express.json(), gstController.handleSignzyCallback);
router.post('/webhooks/signzy/bank', express.json(), bankController.handleSignzyCallback);

router.use(authenticate);

router.post('/bureau-pull', externalApiController.bureauPull);

// ITR Analytics Integration
router.post('/itr/analyze', itrAnalyticsController.analyze);
router.post('/itr/sync',    itrAnalyticsController.sync);
router.post('/itr/download', itrAnalyticsController.download);

// Bank Statement Integration
router.post('/bank/analyze', bankController.analyze);
router.post('/bank/sync', bankController.syncStatus);
router.post('/bank/download', bankController.downloadData);

// GST Integration
router.post('/gst/create', gstController.createGstRequest);
router.post('/gst/submit-otp', gstController.submitGstOtp);
router.post('/gst/sync', gstController.syncGstData);
router.get('/gst/requests', gstController.getRequestDetails);

// New PAN Integration
router.post('/pan/fetch', panController.fetchPanIntelligence);

module.exports = router;
