// lenderCommission.controller.js
// Controllers for managing lender commission rules.
// Enforces role-based access (DSA_ADMIN only) and tenant isolation.

const svc = require('../services/lenderCommission.service');
const prisma = require('../../config/db');

async function list(req, res) {
  try {
    const rules = await svc.listRules(req.user.tenant_id);
    res.json(rules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function get(req, res) {
  try {
    const rule = await svc.getRule(parseInt(req.params.id), req.user.tenant_id);
    res.json(rule);
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}

async function create(req, res) {
  try {
    const rule = await svc.createRule(req.user.tenant_id, req.body);
    
    // Audit log
    await prisma.auditLog.create({
      data: {
        tenant_id: req.user.tenant_id,
        user_id: req.user.id,
        action: 'COMMISSION_RULE_CREATED',
        description: `Created commission rule for tenant lender ${req.body.tenant_lender_id} and product ${req.body.product_type}`
      }
    });

    res.status(201).json(rule);
  } catch (e) {
    if (e.message.includes('already configured')) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id);
    const rule = await svc.updateRule(id, req.user.tenant_id, req.body);

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenant_id: req.user.tenant_id,
        user_id: req.user.id,
        action: 'COMMISSION_RULE_UPDATED',
        description: `Updated commission rule ID ${id}`
      }
    });

    res.json(rule);
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    await svc.deleteRule(id, req.user.tenant_id);

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenant_id: req.user.tenant_id,
        user_id: req.user.id,
        action: 'COMMISSION_RULE_DELETED',
        description: `Deleted commission rule ID ${id}`
      }
    });

    res.json({ success: true });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
}

module.exports = { list, get, create, update, remove };
