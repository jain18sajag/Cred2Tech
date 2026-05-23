// subDsaPayout.controller.js
// HTTP handlers for SubDSA payout management.
// DSA_ADMIN: full access. SUB_DSA: read-only on own records.

const svc = require('../services/subDsaPayout.service');

// GET /api/sub-dsa/users
async function listSubDsaUsers(req, res) {
  try {
    const users = await svc.listSubDsaUsers(req.user.tenant_id);
    res.json(users);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// GET /api/sub-dsa/:userId/payout-config
async function getPayoutConfig(req, res) {
  try {
    const config = await svc.getPayoutConfig(req.user.tenant_id, parseInt(req.params.userId));
    res.json(config);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// PUT /api/sub-dsa/:userId/payout-config
async function upsertPayoutConfig(req, res) {
  try {
    const config = await svc.upsertPayoutConfig(req.user.tenant_id, parseInt(req.params.userId), req.body);
    res.json(config);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// GET /api/sub-dsa/payouts
async function listPayouts(req, res) {
  try {
    const result = await svc.listPayouts(req.user.tenant_id, req.query, req.user);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// PUT /api/sub-dsa/payouts/:id/status
async function updatePayoutStatus(req, res) {
  try {
    const { status, remarks } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    const result = await svc.updatePayoutStatus(
      req.user.tenant_id,
      req.params.id,
      status,
      remarks,
      req.user.id
    );
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// GET /api/sub-dsa/payouts/:id/history
async function getPayoutHistory(req, res) {
  try {
    const history = await svc.getPayoutHistory(req.user.tenant_id, req.params.id);
    res.json(history);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// POST /api/sub-dsa/invoices
async function generateInvoice(req, res) {
  try {
    const { sub_dsa_user_id, month_year, ledger_ids } = req.body;
    if (!sub_dsa_user_id || !month_year || !ledger_ids?.length) {
      return res.status(400).json({ error: 'sub_dsa_user_id, month_year, and ledger_ids are required' });
    }
    const result = await svc.generateInvoice(
      req.user.tenant_id,
      sub_dsa_user_id,
      month_year,
      ledger_ids,
      req.user.id
    );
    res.status(201).json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// POST /api/sub-dsa/:userId/calculate (utility endpoint: preview payout for a commission entry)
async function previewPayout(req, res) {
  try {
    const { commission_ledger_id } = req.body;
    if (!commission_ledger_id) return res.status(400).json({ error: 'commission_ledger_id is required' });

    const calc = await svc.calculatePayout(req.user.tenant_id, parseInt(req.params.userId), parseInt(commission_ledger_id));
    res.json(calc);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

module.exports = {
  listSubDsaUsers,
  getPayoutConfig,
  upsertPayoutConfig,
  listPayouts,
  updatePayoutStatus,
  getPayoutHistory,
  generateInvoice,
  previewPayout
};
