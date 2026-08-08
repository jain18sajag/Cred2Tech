const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { ADMIN_ROLES } = require('../services/ticket.service');
const ticketRecipientController = require('../controllers/ticketRecipient.controller');

router.use(authenticate, requireRole(...ADMIN_ROLES));

router.get('/', ticketRecipientController.list);
router.post('/', ticketRecipientController.add);
router.put('/:id', ticketRecipientController.update);
router.delete('/:id', ticketRecipientController.remove);

module.exports = router;
