// Admin CRUD for the ticket-notification To/Cc list. See ticketRecipient.service.js.
const ticketRecipientService = require('../services/ticketRecipient.service');
const { sendCaughtError } = require('../utils/sendError');

async function list(req, res) {
  try {
    const data = await ticketRecipientService.list();
    return res.json({ success: true, data });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load recipients');
  }
}

async function add(req, res) {
  try {
    const data = await ticketRecipientService.add(req.body || {}, req.user.id);
    return res.status(201).json({ success: true, data });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to add recipient');
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await ticketRecipientService.update(id, req.body || {});
    return res.json({ success: true, data });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to update recipient');
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const data = await ticketRecipientService.remove(id);
    return res.json({ success: true, ...data });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to remove recipient');
  }
}

module.exports = { list, add, update, remove };
