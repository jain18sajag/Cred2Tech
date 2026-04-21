const esrService = require('../services/esr.service');

async function generate(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const userId = req.user.id;
    const result = await esrService.generateESR(caseId, userId, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to generate ESR.' });
  }
}

async function get(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const result = await esrService.getESR(caseId, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    if (err.message.includes('No ESR')) return res.status(404).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch ESR.' });
  }
}

module.exports = { generate, get };
