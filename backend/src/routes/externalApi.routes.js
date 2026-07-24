const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const externalApiController = require('../controllers/externalApi.controller');
const panController = require('../controllers/external.pan.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const gstController = require('../controllers/external.gst.controller');
const itrAnalyticsController = require('../controllers/external.itrAnalytics.controller');
const bankController = require('../controllers/external.bank.controller');

// Unauthenticated webhooks
router.post('/webhooks/signzy/gst', express.json(), gstController.handleSignzyCallback);
router.post('/webhooks/signzy/bank', express.json(), bankController.handleSignzyCallback);

router.use(authenticate);

// Every route below hits a paid/costly vendor API (bureau, PAN, ITR, bank,
// GST). Previously these had no role gate and no rate limit at all — any
// authenticated user (including a self-registered customer) could drive
// unlimited paid vendor calls. Keyed per-user (not per-IP) since the concern
// is one account hammering the vendor, not one network address.
const costlyApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: { error: 'Too many external verification requests. Please try again after 15 minutes.' }
});
router.use(costlyApiLimiter);
router.use(requireRole('SUPER_ADMIN', 'CRED2TECH_MEMBER', 'DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA', 'MSME_CUSTOMER'));

router.post('/bureau-pull', externalApiController.bureauPull);

// ITR Analytics Integration
router.post('/itr/analyze',   itrAnalyticsController.analyze);
router.post('/itr/initiate',  itrAnalyticsController.initiate);
router.post('/itr/authorise', itrAnalyticsController.authorise);
router.post('/itr/sync',      itrAnalyticsController.sync);
router.post('/itr/download',  itrAnalyticsController.download);

// Bank Statement Integration
router.post('/bank/analyze', bankController.analyze);
router.post('/bank/sync', bankController.syncStatus);
router.post('/bank/download', bankController.downloadData);

// GST Integration
router.post('/gst/create', gstController.createGstRequest);
router.post('/gst/submit-otp', gstController.submitGstOtp);
router.post('/gst/sync', gstController.syncGstData);
router.get('/gst/requests', gstController.getRequestDetails);

// 4. PAN Intelligence & Verify
router.post('/pan/verify', panController.verifyPan);
router.post('/pan/fetch', panController.fetchPanIntelligence);
router.post('/pan/reset', panController.resetPan);

module.exports = router;
