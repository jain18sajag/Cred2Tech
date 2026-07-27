const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams to access :id from parent
const incomeCtrl = require('../controllers/income.controller');
const obligationsCtrl = require('../controllers/obligations.controller');
const esrCtrl = require('../controllers/esr.controller');
const proposalCtrl = require('../controllers/proposal.controller');
const sendToLenderCtrl = require('../controllers/case.sendToLender.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { requireCaseAccess } = require('../middleware/caseAccess.middleware');
const enforceMsmeCaseOwnership = require('../middleware/msmeCaseOwnership.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA', 'MSME_CUSTOMER'));
router.use(enforceMsmeCaseOwnership);
router.use(requireCaseAccess);

// Proposal creation/submission and lender dispatch are DSA/Admin-only actions.
// MSME self-service customers never send proposals to a lender directly - their
// case goes through /api/msme/case/submit into the Cred2Tech admin queue, and
// only after an admin allocates it to a DSA does a DSA create/send the proposal.
const requireDsaOrAdmin = requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA');

// ── Income Summary  (/api/cases/:id/income-summary) ──────────────────────────
router.get('/income-summary',             incomeCtrl.getSummary);
router.post('/income-entries',            incomeCtrl.addEntry);
router.put('/income-entries/:entryId',    incomeCtrl.updateEntry);
router.delete('/income-entries/:entryId', incomeCtrl.deleteEntry);
router.put('/income-summary/confirm',     incomeCtrl.confirm);

// ── Bureau Obligations  (/api/cases/:id/bureau-obligations) ──────────────────
router.post('/bureau-obligations/sync',      obligationsCtrl.sync);
router.get('/bureau-obligations',            obligationsCtrl.getAll);
router.post('/bureau-obligations',           obligationsCtrl.add);
router.put('/bureau-obligations/:oblId',     obligationsCtrl.update);
router.delete('/bureau-obligations/:oblId',  obligationsCtrl.remove);

// ── Eligibility Summary Report  (/api/cases/:id/esr) ─────────────────────────
router.post('/esr/generate', esrCtrl.generate);
router.post('/esr/recalculate', esrCtrl.recalculate);
router.get('/esr/logs', esrCtrl.listLogs);
router.get('/esr/logs/:calculationRunId', esrCtrl.getLog);
router.get('/esr/logs/:calculationRunId/download', esrCtrl.downloadLog);
router.get('/esr',           esrCtrl.get);

// ── Proposals  (/api/cases/:id/proposals/...) ────────────────────────────────
router.post('/proposals/create',                  requireDsaOrAdmin, proposalCtrl.create);
router.get('/proposals',                          proposalCtrl.listAll);
router.get('/proposals/:pid',                     proposalCtrl.getOne);
router.patch('/proposals/:pid',                   requireDsaOrAdmin, proposalCtrl.update);
router.post('/proposals/:pid/documents',          requireDsaOrAdmin, proposalCtrl.attachDocs);
router.delete('/proposals/:pid/documents/:docId', requireDsaOrAdmin, proposalCtrl.detachDoc);
router.post('/proposals/:pid/submit',             requireDsaOrAdmin, proposalCtrl.submit);
router.post('/proposals/:pid/send',               requireDsaOrAdmin, proposalCtrl.send); // Professional Email Dispatch
router.post('/proposals/:pid/clone',              requireDsaOrAdmin, proposalCtrl.clone);

// ── Legacy Routes (Deprecated - use Proposals flow) ──────────────────────────
router.post('/send-to-lender',       requireDsaOrAdmin, sendToLenderCtrl.sendToLender);
router.post('/send-to-other-lender', requireDsaOrAdmin, sendToLenderCtrl.sendToOtherLender);

module.exports = router;
