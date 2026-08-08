const express = require('express');
const multer = require('multer');
const path = require('path');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/role.middleware');
const { SUBMITTER_ROLES, ADMIN_ROLES } = require('../services/ticket.service');
const ticketController = require('../controllers/ticket.controller');

// Scoped to the POST /tickets route only — GET /tickets/unread-count is
// polled every ~30s by the admin sidebar and must not share this budget.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this IP, please try again after 15 minutes.' },
});

// Screenshots are expected to already be compressed client-side (see
// Cred2Tech-WebApp's FeedbackModal) — this cap is a generous safety net,
// not the primary size control. Buffered in memory, same as documents/
// upload — handed straight to the S3 storage provider, never touches disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 }, // 8MB/file, 5 files max
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type not allowed: ${ext}`));
  },
});

router.use(authenticate);

// Submission — open to MSME self-service customers and DSA/staff.
router.post('/', submitLimiter, requireRole(...SUBMITTER_ROLES, ...ADMIN_ROLES), upload.array('attachments', 5), ticketController.create);
router.get('/mine', requireRole(...SUBMITTER_ROLES, ...ADMIN_ROLES), ticketController.listMine);

// Admin management.
router.get('/unread-count', requireRole(...ADMIN_ROLES), ticketController.unreadCount);
router.get('/', requireRole(...ADMIN_ROLES), ticketController.listForAdmin);
router.patch('/:id/status', requireRole(...ADMIN_ROLES), ticketController.changeStatus);
router.post('/:id/notes', requireRole(...ADMIN_ROLES), ticketController.addNote);
router.post('/:id/reply', requireRole(...ADMIN_ROLES), ticketController.reply);
router.post('/:id/read', requireRole(...ADMIN_ROLES), ticketController.markAsRead);

// The submitter's own follow-up reply — ownership enforced in the service
// (403 if the caller didn't create this ticket).
router.post('/:id/messages', requireRole(...SUBMITTER_ROLES, ...ADMIN_ROLES), ticketController.addMessage);

// Detail + attachment download — admin (any ticket) or the submitter (their own),
// ownership enforced inside the controller/service.
router.get('/:id', requireRole(...SUBMITTER_ROLES, ...ADMIN_ROLES), ticketController.getById);
router.get('/:id/attachments/:attachmentId', requireRole(...SUBMITTER_ROLES, ...ADMIN_ROLES), ticketController.downloadAttachment);

module.exports = router;
