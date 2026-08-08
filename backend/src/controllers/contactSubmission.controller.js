/**
 * Public "Contact Us" Submission Controller
 *
 * Routes (mounted under /api/contact-submissions via contactSubmission.routes.js):
 *   POST   /api/contact-submissions           → public — marketing site's /contact form
 *   GET    /api/contact-submissions           → admin list (search/pagination)
 *   GET    /api/contact-submissions/unread-count → admin sidebar badge count
 *   GET    /api/contact-submissions/:id       → admin detail
 *   POST   /api/contact-submissions/:id/read  → admin: mark as read
 */
const { contactSubmissionService } = require('../services/contactSubmission.service');
const { sendCaughtError } = require('../utils/sendError');

async function create(req, res) {
  try {
    const { fullName, businessName, mobileNumber, email, role, helpType, message } = req.body || {};
    const submission = await contactSubmissionService.create(
      { fullName, businessName, mobileNumber, email, role, helpType, message },
      req.ip,
    );
    return res.status(201).json({ success: true, data: { id: submission.id } });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to submit your enquiry');
  }
}

async function listForAdmin(req, res) {
  try {
    const result = await contactSubmissionService.listForAdmin(req.query);
    return res.json({ success: true, ...result });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load contact submissions');
  }
}

async function unreadCount(req, res) {
  try {
    const count = await contactSubmissionService.getUnreadCount();
    return res.json({ success: true, count });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load unread count');
  }
}

async function getById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const submission = await contactSubmissionService.getById(id);
    return res.json({ success: true, data: submission });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load submission');
  }
}

async function markAsRead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const updated = await contactSubmissionService.markAsRead(id);
    return res.json({ success: true, data: updated });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to mark as read');
  }
}

module.exports = { create, listForAdmin, unreadCount, getById, markAsRead };
