const express = require('express');
const router = express.Router();
const externalApiController = require('../controllers/externalApi.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.post('/bureau-pull', externalApiController.bureauPull);
router.post('/gst-fetch', externalApiController.gstFetch);
router.post('/itr-fetch', externalApiController.itrFetch);
router.post('/bank-analysis', externalApiController.bankAnalysis);

module.exports = router;
