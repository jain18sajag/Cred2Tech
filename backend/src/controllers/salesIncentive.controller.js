const salesIncentiveService = require('../services/salesIncentive.service');

async function getRules(req, res) {
  try {
    const rules = await salesIncentiveService.listRules(req.user.tenant_id);
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createRule(req, res) {
  try {
    const rule = await salesIncentiveService.createRule(req.user.tenant_id, req.user.id, req.body);
    res.status(201).json(rule);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function updateRule(req, res) {
  try {
    const rule = await salesIncentiveService.updateRule(req.user.tenant_id, parseInt(req.params.id), req.user.id, req.body);
    res.json(rule);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function deleteRule(req, res) {
  try {
    await salesIncentiveService.deleteRule(req.user.tenant_id, parseInt(req.params.id), req.user.id);
    res.json({ message: 'Rule deactivated successfully' });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function getEmployeesConfig(req, res) {
  try {
    const employees = await salesIncentiveService.listEmployeesWithConfig(req.user.tenant_id);
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getPayouts(req, res) {
  try {
    const data = await salesIncentiveService.listPayouts(req.user.tenant_id, req.query);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function calculateIncentives(req, res) {
  try {
    const results = await salesIncentiveService.calculateIncentives(req.user.tenant_id, req.body);
    res.json(results);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function updatePayoutStatus(req, res) {
  try {
    const updated = await salesIncentiveService.updatePayoutStatus(
      req.user.tenant_id,
      parseInt(req.params.id),
      req.body.status,
      req.body.remarks,
      req.user.id
    );
    res.json(updated);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

module.exports = {
  getRules,
  createRule,
  updateRule,
  deleteRule,
  getEmployeesConfig,
  getPayouts,
  calculateIncentives,
  updatePayoutStatus
};
