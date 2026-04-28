// tenantLender.service.js
// All tenant-scoped lender contact CRUD operations.
// Every query enforces tenant_id so DSA data never leaks across tenants.

const prisma = require('../../config/db');

// ── List tenant's configured lenders (with their contacts) ───────────────────
async function listTenantLenders(tenantId) {
  const lenders = await prisma.$queryRawUnsafe(`
    SELECT * FROM tenant_lenders
    WHERE tenant_id = $1
    ORDER BY lender_name ASC
  `, tenantId);

  if (lenders.length === 0) return [];

  const lenderIds = lenders.map(l => l.id);
  const contacts = await prisma.$queryRawUnsafe(`
    SELECT * FROM tenant_lender_contacts
    WHERE tenant_id = $1
    ORDER BY product_type ASC, is_primary DESC, created_at ASC
  `, tenantId);

  return lenders.map(l => ({
    ...l,
    contacts: contacts.filter(c => c.tenant_lender_id === l.id),
  }));
}

// ── Create a tenant lender ────────────────────────────────────────────────────
async function createTenantLender({ tenantId, lenderName, userId }) {
  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO tenant_lenders (tenant_id, lender_name, is_active, created_by_user_id, updated_at)
    VALUES ($1, $2, true, $3, NOW())
    RETURNING *
  `, tenantId, lenderName.trim(), userId);
  return rows[0];
}

// ── Update a tenant lender ────────────────────────────────────────────────────
async function updateTenantLender(id, tenantId, { lenderName, isActive }) {
  const sets = [];
  const vals = [];
  let idx = 1;

  if (lenderName !== undefined) { sets.push(`lender_name = $${idx++}`); vals.push(lenderName.trim()); }
  if (isActive  !== undefined) { sets.push(`is_active = $${idx++}`);   vals.push(isActive); }

  if (sets.length === 0) throw new Error('No fields to update');
  sets.push(`updated_at = NOW()`);
  vals.push(id, tenantId);

  const rows = await prisma.$queryRawUnsafe(
    `UPDATE tenant_lenders SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    ...vals
  );
  if (!rows[0]) throw new Error('Lender not found or unauthorized');
  return rows[0];
}

// ── Soft-delete a tenant lender (marks inactive) ─────────────────────────────
async function deleteTenantLender(id, tenantId) {
  const rows = await prisma.$queryRawUnsafe(`
    UPDATE tenant_lenders
    SET is_active = false, updated_at = NOW()
    WHERE id = $1 AND tenant_id = $2
    RETURNING id
  `, id, tenantId);
  if (!rows[0]) throw new Error('Lender not found or unauthorized');
  return { success: true };
}

// ── List contacts for one lender ──────────────────────────────────────────────
async function listTenantLenderContacts(tenantLenderId, tenantId) {
  return prisma.$queryRawUnsafe(`
    SELECT * FROM tenant_lender_contacts
    WHERE tenant_lender_id = $1 AND tenant_id = $2
    ORDER BY is_primary DESC, product_type ASC
  `, tenantLenderId, tenantId);
}

// ── Create a contact ──────────────────────────────────────────────────────────
async function createTenantLenderContact({
  tenantLenderId, tenantId, productType, contactName, contactEmail, contactMobile, isPrimary, userId
}) {
  // Verify lender belongs to this tenant
  const lenderRows = await prisma.$queryRawUnsafe(
    `SELECT id FROM tenant_lenders WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    tenantLenderId, tenantId
  );
  if (!lenderRows[0]) throw new Error('Lender not found or unauthorized');

  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO tenant_lender_contacts
      (tenant_lender_id, tenant_id, product_type, contact_name, contact_email, contact_mobile, is_primary, created_by_user_id, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    RETURNING *
  `,
    tenantLenderId, tenantId, productType.toUpperCase(), contactName.trim(),
    contactEmail.trim().toLowerCase(), contactMobile || null,
    isPrimary !== false, userId
  );
  return rows[0];
}

// ── Update a contact ──────────────────────────────────────────────────────────
async function updateTenantLenderContact(id, tenantId, fields) {
  const allowed = ['product_type', 'contact_name', 'contact_email', 'contact_mobile', 'is_primary'];
  const sets = [];
  const vals = [];
  let idx = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      let val = fields[key];
      if (key === 'product_type') val = val.toUpperCase();
      if (key === 'contact_name' || key === 'contact_email') val = val.trim();
      if (key === 'contact_email') val = val.toLowerCase();
      vals.push(val);
    }
  }

  if (sets.length === 0) throw new Error('No fields to update');
  sets.push(`updated_at = NOW()`);
  vals.push(id, tenantId);

  const rows = await prisma.$queryRawUnsafe(
    `UPDATE tenant_lender_contacts SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    ...vals
  );
  if (!rows[0]) throw new Error('Contact not found or unauthorized');
  return rows[0];
}

// ── Delete a contact (hard delete — contacts are operational config) ──────────
async function deleteTenantLenderContact(id, tenantId) {
  const rows = await prisma.$queryRawUnsafe(`
    DELETE FROM tenant_lender_contacts WHERE id = $1 AND tenant_id = $2 RETURNING id
  `, id, tenantId);
  if (!rows[0]) throw new Error('Contact not found or unauthorized');
  return { success: true };
}

// ── Resolve contact for a specific lender + product ──────────────────────────
// Used by the send-to-lender controller. Tries to match by lender_name (case-insensitive).
async function resolveContactForLender({ tenantId, lenderName, productType }) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT tlc.*
    FROM tenant_lender_contacts tlc
    JOIN tenant_lenders tl ON tl.id = tlc.tenant_lender_id
    WHERE tlc.tenant_id = $1
      AND LOWER(tl.lender_name) = LOWER($2)
      AND LOWER(tlc.product_type) = LOWER($3)
      AND tl.is_active = true
    ORDER BY tlc.is_primary DESC, tlc.created_at ASC
    LIMIT 1
  `, tenantId, lenderName, productType);

  return rows[0] || null;
}

// ── Resolve contact by contact ID (for "send to other lender" flow) ───────────
async function resolveContactById(contactId, tenantId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT tlc.*, tl.lender_name
    FROM tenant_lender_contacts tlc
    JOIN tenant_lenders tl ON tl.id = tlc.tenant_lender_id
    WHERE tlc.id = $1 AND tlc.tenant_id = $2 AND tl.is_active = true
    LIMIT 1
  `, contactId, tenantId);
  return rows[0] || null;
}

module.exports = {
  listTenantLenders,
  createTenantLender,
  updateTenantLender,
  deleteTenantLender,
  listTenantLenderContacts,
  createTenantLenderContact,
  updateTenantLenderContact,
  deleteTenantLenderContact,
  resolveContactForLender,
  resolveContactById,
};
