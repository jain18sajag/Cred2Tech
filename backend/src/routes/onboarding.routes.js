const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access :id from parent
const incomeCtrl = require('../controllers/income.controller');
const obligationsCtrl = require('../controllers/obligations.controller');
const esrCtrl = require('../controllers/esr.controller');
const proposalCtrl = require('../controllers/proposal.controller');
const sendToLenderCtrl = require('../controllers/case.sendToLender.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN'));

// ── Income Summary  (/api/cases/:id/income-summary) ──────────────────────────
router.get('/income-summary',             incomeCtrl.getSummary);
router.post('/income-entries',            incomeCtrl.addEntry);
router.delete('/income-entries/:entryId', incomeCtrl.deleteEntry);
router.put('/income-summary/confirm',     incomeCtrl.confirm);

// ── Bureau Obligations  (/api/cases/:id/bureau-obligations) ──────────────────
router.post('/bureau-obligations/sync',      obligationsCtrl.sync);
router.get('/bureau-obligations',            obligationsCtrl.getAll);
router.post('/bureau-obligations',           obligationsCtrl.add);
router.put('/bureau-obligations/:oblId',     obligationsCtrl.update);

// ── Eligibility Summary Report  (/api/cases/:id/esr) ─────────────────────────
router.post('/esr/generate', esrCtrl.generate);
router.get('/esr',           esrCtrl.get);

// ── Proposals  (/api/cases/:id/proposals/...) ────────────────────────────────
router.post('/proposals/create',                  proposalCtrl.create);
router.get('/proposals',                          proposalCtrl.listAll);
router.get('/proposals/:pid',                     proposalCtrl.getOne);
router.patch('/proposals/:pid',                   proposalCtrl.update);
router.post('/proposals/:pid/documents',          proposalCtrl.attachDocs);
router.delete('/proposals/:pid/documents/:docId', proposalCtrl.detachDoc);
router.post('/proposals/:pid/submit',             proposalCtrl.submit);
router.post('/proposals/:pid/clone',              proposalCtrl.clone);

// ── Send to Lender  (/api/cases/:id/send-to-lender) ──────────────────────────
router.post('/send-to-lender',       sendToLenderCtrl.sendToLender);
router.post('/send-to-other-lender', sendToLenderCtrl.sendToOtherLender);

module.exports = router;
