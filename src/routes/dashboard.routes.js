const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

// ─── DSA Dashboard Routes ─────────────────────────────────────────────────────
// DSA_ADMIN: full tenant scope
// DSA_MEMBER: hierarchy-scoped (enforced in service layer)
// SUB_DSA: own cases only (enforced in service layer)

const dsaRouter = express.Router();
dsaRouter.use(authenticate);
dsaRouter.use(requireRole('DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'));

dsaRouter.get('/summary', ctrl.getDsaSummary);
dsaRouter.get('/wallet', ctrl.getDsaWallet);
dsaRouter.get('/cases', ctrl.getDsaCases);
dsaRouter.get('/stage-summary', ctrl.getDsaStageSummary);

// ─── Platform Dashboard Routes ────────────────────────────────────────────────
// SUPER_ADMIN only. CRED2TECH_MEMBER requires platform_dashboard_view (future).
// All responses are aggregate only — NO PII.

const platformRouter = express.Router();
platformRouter.use(authenticate);
platformRouter.use(requireRole('SUPER_ADMIN')); // Explicit restriction per updated plan

platformRouter.get('/summary', ctrl.getPlatformSummary);
platformRouter.get('/api-usage', ctrl.getPlatformApiUsage);
platformRouter.get('/funnel', ctrl.getPlatformFunnel);
platformRouter.get('/top-dsas', ctrl.getTopDsas);
platformRouter.get('/top-lenders', ctrl.getTopLenders);

// Mount both
router.use('/dsa', dsaRouter);
router.use('/platform', platformRouter);

module.exports = router;
