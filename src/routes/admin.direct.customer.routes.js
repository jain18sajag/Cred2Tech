const express = require('express');
const {
  listDirectCases, getDirectCaseDetail, getAllocationTargets, allocateDirectCase
} = require('../controllers/admin.direct.customer.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('SUPER_ADMIN'));

router.get('/', listDirectCases);
router.get('/allocation-targets', getAllocationTargets);
router.get('/:caseId', getDirectCaseDetail);
router.post('/:caseId/allocate', allocateDirectCase);

module.exports = router;
