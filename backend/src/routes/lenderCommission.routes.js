// lenderCommission.routes.js
// Routes for lender commission management.
// Restricted to DSA_ADMIN and strictly tenant-scoped.

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/lenderCommission.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');

router.use(authenticate);
router.use(requireRole('DSA_ADMIN'));


router.get('/',    ctrl.list);
router.get('/:id', ctrl.get);
router.post('/',   ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
