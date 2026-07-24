const salesIncentiveService = require('../services/salesIncentive.service');
const { sendCaughtError } = require('../utils/sendError');

async function getRules(req, res) {
  try {
    const rules = await salesIncentiveService.listRules(req.user.tenant_id);
    res.json(rules);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch incentive rules', 500);
  }
}

async function createRule(req, res) {
  try {
    const rule = await salesIncentiveService.createRule(req.user.tenant_id, req.user.id, req.body);
    res.status(201).json(rule);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to create incentive rule');
  }
}

async function updateRule(req, res) {
  try {
    const rule = await salesIncentiveService.updateRule(req.user.tenant_id, parseInt(req.params.id), req.user.id, req.body);
    res.json(rule);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to update incentive rule');
  }
}

async function deleteRule(req, res) {
  try {
    await salesIncentiveService.deleteRule(req.user.tenant_id, parseInt(req.params.id), req.user.id);
    res.json({ message: 'Rule deactivated successfully' });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to deactivate incentive rule');
  }
}

async function getEmployeesConfig(req, res) {
  try {
    const employees = await salesIncentiveService.listEmployeesWithConfig(req.user.tenant_id);
    res.json(employees);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch employee incentive config', 500);
  }
}

async function getPayouts(req, res) {
  try {
    const data = await salesIncentiveService.listPayouts(req.user.tenant_id, req.query, req.user);
    res.json(data);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch payouts', 500);
  }
}

async function calculateIncentives(req, res) {
  try {
    const results = await salesIncentiveService.calculateIncentives(req.user.tenant_id, req.body);
    res.json(results);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to calculate incentives');
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
    sendCaughtError(res, error, 'Failed to update payout status');
  }
}

async function syncMissingIncentives(req, res) {
  try {
    const { hierarchyLevel } = req.params;
    const { tenant_id } = req.user;
    const processedCount = await salesIncentiveService.syncMissingIncentives(tenant_id, hierarchyLevel);
    res.json({ success: true, processedCount, message: `Successfully synced ${processedCount} missing incentives.` });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to sync missing incentives', 500);
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
  updatePayoutStatus,
  syncMissingIncentives
};
