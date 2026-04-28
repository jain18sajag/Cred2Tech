// tenantLender.routes.js
// Tenant-scoped lender contact configuration.
// GET / list: DSA_ADMIN + DSA_MEMBER (read-only for member)
// POST / PUT / DELETE: DSA_ADMIN only

const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/tenantLender.controller');
const { authenticate }  = require('../middleware/auth.middleware');
const { requireRole }   = require('../middleware/role.middleware');

router.use(authenticate);

// ── Lenders ──────────────────────────────────────────────────────────────────
// Both roles can LIST (DSA_MEMBER needs it for Send to Other Lender modal)
router.get('/',     requireRole('DSA_ADMIN', 'DSA_MEMBER'), ctrl.list);

// Only DSA_ADMIN can mutate
router.post('/',    requireRole('DSA_ADMIN'), ctrl.create);
router.put('/:id',  requireRole('DSA_ADMIN'), ctrl.update);
router.delete('/:id', requireRole('DSA_ADMIN'), ctrl.remove);

// ── Contacts ─────────────────────────────────────────────────────────────────
// Mount separately under /lender-contacts
module.exports = router;
