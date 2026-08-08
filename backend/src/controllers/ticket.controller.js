/**
 * Feedback / Support Ticket Controller
 *
 * Routes (mounted under /api/tickets via ticket.routes.js):
 *   POST   /api/tickets                    → submit feedback/issue (MSME + DSA/staff), multipart w/ optional screenshots
 *   GET    /api/tickets/mine               → the caller's own submissions
 *   GET    /api/tickets/unread-count       → admin sidebar badge count
 *   GET    /api/tickets                    → admin list (filters/sort/pagination)
 *   GET    /api/tickets/:id                → detail + timeline (admin: full; submitter: own ticket, notes hidden)
 *   PATCH  /api/tickets/:id/status         → admin: change status
 *   POST   /api/tickets/:id/notes          → admin: internal note (never emailed/shown to submitter)
 *   POST   /api/tickets/:id/reply          → admin: reply (emailed + shown to submitter)
 *   POST   /api/tickets/:id/messages       → submitter: their own follow-up reply (reopens if resolved/closed, flips ticket unread)
 *   POST   /api/tickets/:id/read           → admin: mark as read (unread badge only updates here)
 *   GET    /api/tickets/:id/attachments/:attachmentId → download a screenshot/attachment
 */
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../../config/db');
const { ticketService, isAdminRole } = require('../services/ticket.service');
const { getStorageProvider } = require('../services/storage/index');
const { sendCaughtError } = require('../utils/sendError');

function buildAttachmentKey(tenantId, userId, extension) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return path.posix.join('tickets', String(tenantId), String(userId), yyyy + mm, `${uuidv4()}${extension}`);
}

async function create(req, res) {
  try {
    const { type, subject, description } = req.body || {};
    const files = req.files || [];

    const attachments = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      const storageKey = buildAttachmentKey(req.user.tenant_id, req.user.id, ext);
      const storage = getStorageProvider('S3');
      await storage.save(file.buffer, storageKey, file.mimetype);
      attachments.push({
        storageKey,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      });
    }

    const ticket = await ticketService.create(req.user, { type, subject, description }, attachments);
    return res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to submit ticket');
  }
}

async function listMine(req, res) {
  try {
    const data = await ticketService.listMine(req.user.id);
    return res.json({ success: true, data });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load your tickets');
  }
}

async function listForAdmin(req, res) {
  try {
    const result = await ticketService.listForAdmin(req.query);
    return res.json({ success: true, ...result });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load tickets');
  }
}

async function unreadCount(req, res) {
  try {
    const count = await ticketService.getUnreadCount();
    return res.json({ success: true, count });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load unread count');
  }
}

async function getById(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid ticket id' });
    const ticket = await ticketService.getById(id, req.user);
    return res.json({ success: true, data: ticket });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load ticket');
  }
}

async function changeStatus(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, note } = req.body || {};
    const updated = await ticketService.changeStatus(id, { toStatus: status, note }, req.user);
    return res.json({ success: true, data: updated });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to update status');
  }
}

async function addNote(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const entry = await ticketService.addInternalNote(id, req.body?.note, req.user);
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to add note');
  }
}

async function reply(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const entry = await ticketService.replyToSubmitter(id, req.body?.note, req.user);
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to send reply');
  }
}

async function addMessage(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const ticket = await ticketService.addSubmitterMessage(id, req.body?.note, req.user);
    return res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to send message');
  }
}

async function markAsRead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await ticketService.markAsRead(id, req.user);
    return res.json({ success: true, data: updated });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to mark as read');
  }
}

async function downloadAttachment(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);
    if (!id || !attachmentId) return res.status(400).json({ error: 'Invalid id' });

    const attachment = await prisma.ticketAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.ticket_id !== id) return res.status(404).json({ error: 'Attachment not found' });

    if (!isAdminRole(req.user.role)) {
      const ticket = await prisma.ticket.findUnique({ where: { id }, select: { created_by_user_id: true } });
      if (!ticket || ticket.created_by_user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    const storage = getStorageProvider('S3');
    const stream = await storage.getStream(attachment.storage_key);
    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.file_name)}"`);
    stream.on('error', (err) => {
      console.error('[ticket.controller] attachment stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to stream attachment' });
    });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) sendCaughtError(res, err, 'Failed to download attachment');
  }
}

module.exports = {
  create,
  listMine,
  listForAdmin,
  unreadCount,
  getById,
  changeStatus,
  addNote,
  reply,
  addMessage,
  markAsRead,
  downloadAttachment,
};
