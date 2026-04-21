const obligationsService = require('../services/obligations.service');

async function sync(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const result = await obligationsService.syncObligationsFromBureau(caseId, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to sync obligations from bureau.' });
  }
}

async function getAll(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const result = await obligationsService.getObligations(caseId, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to load obligations.' });
  }
}

async function add(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const entry = await obligationsService.addObligation(caseId, req.body, req.user.tenant_id);
    res.status(201).json(entry);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    if (err.message.includes('required')) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to add obligation.' });
  }
}

async function update(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const oblId  = parseInt(req.params.oblId, 10);
    const result = await obligationsService.updateObligation(oblId, caseId, req.body, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('unauthorized')) return res.status(404).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to update obligation.' });
  }
}

module.exports = { sync, getAll, add, update };
