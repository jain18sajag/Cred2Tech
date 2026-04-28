// tenantLender.controller.js
// HTTP handlers for tenant lender contact CRUD.
// All writes are DSA_ADMIN only (enforced at route level).

const svc = require('../services/tenantLender.service');

// GET /api/tenant/lenders
async function list(req, res) {
  try {
    const data = await svc.listTenantLenders(req.user.tenant_id);
    res.json(data);
  } catch (e) {
    console.error('[TenantLender] list error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// POST /api/tenant/lenders
async function create(req, res) {
  try {
    const { lender_name } = req.body;
    if (!lender_name?.trim()) return res.status(400).json({ error: 'lender_name is required' });

    const data = await svc.createTenantLender({
      tenantId: req.user.tenant_id,
      lenderName: lender_name,
      userId: req.user.id,
    });
    res.status(201).json(data);
  } catch (e) {
    console.error('[TenantLender] create error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// PUT /api/tenant/lenders/:id
async function update(req, res) {
  try {
    const id = parseInt(req.params.id);
    const { lender_name, is_active } = req.body;
    const data = await svc.updateTenantLender(id, req.user.tenant_id, {
      lenderName: lender_name,
      isActive:   is_active,
    });
    res.json(data);
  } catch (e) {
    console.error('[TenantLender] update error:', e.message);
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
}

// DELETE /api/tenant/lenders/:id
async function remove(req, res) {
  try {
    const id = parseInt(req.params.id);
    const data = await svc.deleteTenantLender(id, req.user.tenant_id);
    res.json(data);
  } catch (e) {
    console.error('[TenantLender] delete error:', e.message);
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
}

// POST /api/tenant/lender-contacts
async function createContact(req, res) {
  try {
    const {
      tenant_lender_id, product_type, contact_name,
      contact_email, contact_mobile, is_primary
    } = req.body;

    if (!tenant_lender_id) return res.status(400).json({ error: 'tenant_lender_id required' });
    if (!product_type)     return res.status(400).json({ error: 'product_type required' });
    if (!contact_name)     return res.status(400).json({ error: 'contact_name required' });
    if (!contact_email)    return res.status(400).json({ error: 'contact_email required' });

    const data = await svc.createTenantLenderContact({
      tenantLenderId: parseInt(tenant_lender_id),
      tenantId:       req.user.tenant_id,
      productType:    product_type,
      contactName:    contact_name,
      contactEmail:   contact_email,
      contactMobile:  contact_mobile,
      isPrimary:      is_primary,
      userId:         req.user.id,
    });
    res.status(201).json(data);
  } catch (e) {
    console.error('[TenantLender] createContact error:', e.message);
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
}

// PUT /api/tenant/lender-contacts/:id
async function updateContact(req, res) {
  try {
    const id = parseInt(req.params.id);
    const data = await svc.updateTenantLenderContact(id, req.user.tenant_id, req.body);
    res.json(data);
  } catch (e) {
    console.error('[TenantLender] updateContact error:', e.message);
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
}

// DELETE /api/tenant/lender-contacts/:id
async function removeContact(req, res) {
  try {
    const id = parseInt(req.params.id);
    const data = await svc.deleteTenantLenderContact(id, req.user.tenant_id);
    res.json(data);
  } catch (e) {
    console.error('[TenantLender] removeContact error:', e.message);
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
}

module.exports = { list, create, update, remove, createContact, updateContact, removeContact };
