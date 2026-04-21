const incomeService = require('../services/income.service');

async function getSummary(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const result = await incomeService.getIncomeSummary(caseId, req.user.tenant_id);
    res.json(result);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to load income summary.' });
  }
}

async function addEntry(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const entry = await incomeService.addIncomeEntry(caseId, req.body, req.user.tenant_id);
    res.status(201).json(entry);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    if (err.message.includes('required') || err.message.includes('positive')) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to add income entry.' });
  }
}

async function deleteEntry(req, res) {
  try {
    const caseId   = parseInt(req.params.id, 10);
    const entryId  = parseInt(req.params.entryId, 10);
    await incomeService.deleteIncomeEntry(entryId, caseId, req.user.tenant_id);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('unauthorized')) return res.status(404).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to delete income entry.' });
  }
}

async function confirm(req, res) {
  try {
    const caseId = parseInt(req.params.id, 10);
    const updated = await incomeService.confirmIncomeSummary(caseId, req.user.tenant_id);
    res.json(updated);
  } catch (err) {
    if (err.message === 'Case not found or unauthorized.') return res.status(403).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm income summary.' });
  }
}

module.exports = { getSummary, addEntry, deleteEntry, confirm };
