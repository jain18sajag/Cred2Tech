const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { ADMIN_ROLES } = require('../services/contactSubmission.service');
const controller = require('../controllers/contactSubmission.controller');

// Public submission is unauthenticated by design (anonymous website
// visitors) — rate-limited per IP instead, same shape as ticket.routes.js's
// submitLimiter, to keep the form from being usable as a spam vector.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this IP, please try again later.' },
});

router.post('/', submitLimiter, controller.create);

// Everything else is admin-only.
router.get('/unread-count', authenticate, requireRole(...ADMIN_ROLES), controller.unreadCount);
router.get('/', authenticate, requireRole(...ADMIN_ROLES), controller.listForAdmin);
router.get('/:id', authenticate, requireRole(...ADMIN_ROLES), controller.getById);
router.post('/:id/read', authenticate, requireRole(...ADMIN_ROLES), controller.markAsRead);

module.exports = router;
