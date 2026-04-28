// tenantLenderContacts.routes.js
// Separate router for /api/tenant/lender-contacts
// DSA_ADMIN: create, update, delete
// DSA_MEMBER: no access (contacts are config, not operational data)

const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/tenantLender.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole }  = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN'));

router.post('/',    ctrl.createContact);
router.put('/:id',  ctrl.updateContact);
router.delete('/:id', ctrl.removeContact);

module.exports = router;
