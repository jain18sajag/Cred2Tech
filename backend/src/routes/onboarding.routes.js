const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access :id from parent
const incomeCtrl = require('../controllers/income.controller');
const obligationsCtrl = require('../controllers/obligations.controller');
const esrCtrl = require('../controllers/esr.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN'));

// ── Income Summary  (/api/cases/:id/income-summary) ──────────────────────────
router.get('/income-summary',         incomeCtrl.getSummary);
router.post('/income-entries',        incomeCtrl.addEntry);
router.delete('/income-entries/:entryId', incomeCtrl.deleteEntry);
router.put('/income-summary/confirm', incomeCtrl.confirm);

// ── Bureau Obligations  (/api/cases/:id/bureau-obligations) ──────────────────
router.post('/bureau-obligations/sync', obligationsCtrl.sync);
router.get('/bureau-obligations',       obligationsCtrl.getAll);
router.post('/bureau-obligations',      obligationsCtrl.add);
router.put('/bureau-obligations/:oblId', obligationsCtrl.update);

// ── Eligibility Summary Report  (/api/cases/:id/esr) ─────────────────────────
router.post('/esr/generate', esrCtrl.generate);
router.get('/esr',           esrCtrl.get);

module.exports = router;
