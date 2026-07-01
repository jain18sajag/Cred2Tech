const express = require('express');
const router = express.Router();
const controller = require('../controllers/loanApplicationSummary.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const enforceMsmeCaseOwnership = require('../middleware/msmeCaseOwnership.middleware');
const { requireCaseAccess } = require('../middleware/caseAccess.middleware');

function validateCaseIdParam(req, res, next) {
  if (!/^\d+$/.test(String(req.params.caseId || ''))) {
    return res.status(400).json({ error: 'Invalid case id.' });
  }
  next();
}

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA', 'MSME_CUSTOMER'));
router.use('/:caseId', validateCaseIdParam);
router.use(enforceMsmeCaseOwnership);
router.use(requireCaseAccess);

router.post('/:caseId/generate', controller.generate);

module.exports = router;
