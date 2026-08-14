/**
 * Public "Request Demo" Controller
 *
 * Routes (mounted under /api/demo-requests via demoRequest.routes.js):
 *   POST   /api/demo-requests           → public — marketing site's /request-demo form
 *   GET    /api/demo-requests           → admin list (search/pagination)
 *   GET    /api/demo-requests/unread-count → admin sidebar/tab badge count
 *   GET    /api/demo-requests/:id       → admin detail
 *   POST   /api/demo-requests/:id/read  → admin: mark as read
 */
const { demoRequestService } = require('../services/demoRequest.service');
const { sendCaughtError } = require('../utils/sendError');

async function create(req, res) {
  try {
    const { fullName, businessName, mobileNumber, email, product, message } = req.body || {};
    const request = await demoRequestService.create(
      { fullName, businessName, mobileNumber, email, product, message },
      req.ip,
    );
    return res.status(201).json({ success: true, data: { id: request.id } });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to submit your demo request');
  }
}

async function listForAdmin(req, res) {
  try {
    const result = await demoRequestService.listForAdmin(req.query);
    return res.json({ success: true, ...result });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load demo requests');
  }
}

async function unreadCount(req, res) {
  try {
    const count = await demoRequestService.getUnreadCount();
    return res.json({ success: true, count });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load unread count');
  }
}

async function getById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const request = await demoRequestService.getById(id);
    return res.json({ success: true, data: request });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load demo request');
  }
}

async function markAsRead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const updated = await demoRequestService.markAsRead(id);
    return res.json({ success: true, data: updated });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to mark as read');
  }
}

module.exports = { create, listForAdmin, unreadCount, getById, markAsRead };
