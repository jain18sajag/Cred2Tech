const caseFeedbackService = require('../services/caseFeedback.service');
const { sendCaughtError } = require('../utils/sendError');

async function submit(req, res) {
  try {
    const feedback = await caseFeedbackService.submit(req.body || {}, req.user);
    return res.status(201).json({ success: true, data: feedback });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to submit feedback');
  }
}

async function listForAdmin(req, res) {
  try {
    const result = await caseFeedbackService.listForAdmin(req.query);
    return res.json({ success: true, ...result });
  } catch (err) {
    sendCaughtError(res, err, 'Failed to load case feedback');
  }
}

module.exports = { submit, listForAdmin };
