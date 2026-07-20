// tenantLender.service.js
// All tenant-scoped lender contact CRUD operations.
// Every query enforces tenant_id so DSA data never leaks across tenants.

const prisma = require('../../config/db');

// ── List tenant's configured lenders (with their contacts) ───────────────────
async function listTenantLenders(tenantId) {
  // 1. Auto-provision all active platform lenders into tenant_lenders
  await prisma.$executeRawUnsafe(`
    INSERT INTO tenant_lenders (tenant_id, lender_name, platform_lender_id, is_active, is_esr_enabled, created_at, updated_at)
    SELECT $1, name, id::text, true, true, NOW(), NOW()
    FROM lenders
    WHERE status = 'ACTIVE' 
      AND NOT EXISTS (
        SELECT 1 FROM tenant_lenders tl 
        WHERE tl.tenant_id = $1 AND tl.platform_lender_id = lenders.id::text
      )
  `, tenantId);

  // 2. Fetch all tenant lenders
  const tenantLenders = await prisma.$queryRawUnsafe(`
    SELECT tl.*, l.code
    FROM tenant_lenders tl
    LEFT JOIN lenders l ON l.id::text = tl.platform_lender_id
    WHERE tl.tenant_id = $1
    ORDER BY tl.lender_name ASC
  `, tenantId);

  // 3. Fetch all contacts for the tenant
  const contacts = await prisma.$queryRawUnsafe(`
    SELECT * FROM tenant_lender_contacts
    WHERE tenant_id = $1
    ORDER BY product_type ASC, is_primary DESC, created_at ASC
  `, tenantId);

  // 4. Map contacts
  const result = tenantLenders.map(tl => ({
    id: tl.id,
    tenant_lender_id: tl.id,
    platform_lender_id: tl.platform_lender_id,
    lender_name: tl.lender_name,
    code: tl.code,
    is_active: tl.is_active,
    is_esr_enabled: tl.is_esr_enabled,
    source: tl.platform_lender_id ? 'PLATFORM' : 'CUSTOM',
    contacts: contacts.filter(c => c.tenant_lender_id === tl.id)
  }));

  return result;
}

// ── Create a tenant lender ────────────────────────────────────────────────────
async function createTenantLender({ tenantId, lenderName, platformLenderId, isEsrEnabled, maxCapAmount, userId }) {
  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO tenant_lenders (tenant_id, lender_name, is_active, platform_lender_id, is_esr_enabled, max_cap_amount, created_by_user_id, updated_at)
    VALUES ($1, $2, true, $4, $5, $6, $3, NOW())
    RETURNING *
  `, tenantId, lenderName.trim(), userId, platformLenderId || null, isEsrEnabled || false, maxCapAmount !== undefined ? maxCapAmount : null);
  return rows[0];
}

// ── Update a tenant lender ────────────────────────────────────────────────────
async function updateTenantLender(id, tenantId, { lenderName, isActive, platformLenderId, isEsrEnabled, maxCapAmount }) {
  const sets = [];
  const vals = [];
  let idx = 1;

  if (lenderName !== undefined) { sets.push(`lender_name = $${idx++}`); vals.push(lenderName.trim()); }
  if (isActive !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(isActive); }
  if (platformLenderId !== undefined) { sets.push(`platform_lender_id = $${idx++}`); vals.push(platformLenderId); }
  if (isEsrEnabled !== undefined) { sets.push(`is_esr_enabled = $${idx++}`); vals.push(isEsrEnabled); }
  if (maxCapAmount !== undefined) { sets.push(`max_cap_amount = $${idx++}`); vals.push(maxCapAmount); }

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
  tenantLenderId, platformLenderId, tenantId, productType, contactName, contactEmail, contactMobile, dsaCode, isPrimary, userId
}) {
  let actualTenantLenderId = tenantLenderId;

  // Auto-create override if global lender and no tenantLenderId
  if (!actualTenantLenderId && platformLenderId) {
    const plRows = await prisma.$queryRawUnsafe(`SELECT name FROM lenders WHERE id = $1 AND status = 'ACTIVE'`, platformLenderId);
    if (!plRows[0]) throw new Error('Platform lender not found or inactive');

    const existingOverride = await prisma.$queryRawUnsafe(`
      SELECT id FROM tenant_lenders WHERE tenant_id = $1 AND platform_lender_id = $2
    `, tenantId, platformLenderId);

    if (existingOverride[0]) {
      actualTenantLenderId = existingOverride[0].id;
    } else {
      const newOverride = await prisma.$queryRawUnsafe(`
        INSERT INTO tenant_lenders (tenant_id, lender_name, is_active, platform_lender_id, is_esr_enabled, created_by_user_id, updated_at)
        VALUES ($1, $2, true, $3, false, $4, NOW())
        RETURNING id
      `, tenantId, plRows[0].name, platformLenderId, userId);
      actualTenantLenderId = newOverride[0].id;
    }
  }

  if (!actualTenantLenderId) throw new Error('tenantLenderId or platformLenderId is required');

  // Verify lender belongs to this tenant
  const lenderRows = await prisma.$queryRawUnsafe(
    `SELECT id FROM tenant_lenders WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    actualTenantLenderId, tenantId
  );
  if (!lenderRows[0]) throw new Error('Lender not found or unauthorized');

  productType = productType.toUpperCase();
  contactEmail = contactEmail.trim().toLowerCase();

  // Duplicate Check
  const dupeCheck = await prisma.$queryRawUnsafe(`
    SELECT id FROM tenant_lender_contacts
    WHERE tenant_id = $1 AND tenant_lender_id = $2 AND product_type = $3 AND contact_email = $4
  `, tenantId, actualTenantLenderId, productType, contactEmail);
  if (dupeCheck.length > 0) throw new Error('Contact already exists for this lender and product.');

  // Primary Check
  if (isPrimary !== false) {
    await prisma.$queryRawUnsafe(`
      UPDATE tenant_lender_contacts SET is_primary = false
      WHERE tenant_id = $1 AND tenant_lender_id = $2 AND product_type = $3
    `, tenantId, actualTenantLenderId, productType);
  }

  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO tenant_lender_contacts
      (tenant_lender_id, tenant_id, product_type, contact_name, contact_email, contact_mobile, dsa_code, is_primary, created_by_user_id, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    RETURNING *
  `,
    actualTenantLenderId, tenantId, productType, contactName.trim(),
    contactEmail, contactMobile || null, dsaCode || null,
    isPrimary !== false, userId
  );
  return rows[0];
}

// ── Update a contact ──────────────────────────────────────────────────────────
async function updateTenantLenderContact(id, tenantId, fields) {
  const allowed = ['product_type', 'contact_name', 'contact_email', 'contact_mobile', 'dsa_code', 'is_primary'];
  
  // First fetch the existing contact to know its tenant_lender_id and product_type
  const existing = await prisma.$queryRawUnsafe(`
    SELECT tenant_lender_id, product_type, contact_email FROM tenant_lender_contacts WHERE id = $1 AND tenant_id = $2
  `, id, tenantId);
  if (!existing[0]) throw new Error('Contact not found or unauthorized');
  
  const tenantLenderId = existing[0].tenant_lender_id;
  const newProductType = fields.product_type ? fields.product_type.toUpperCase() : existing[0].product_type;
  const newEmail = fields.contact_email ? fields.contact_email.trim().toLowerCase() : existing[0].contact_email;

  // Duplicate Check if email or product_type changed
  if (newProductType !== existing[0].product_type || newEmail !== existing[0].contact_email) {
    const dupeCheck = await prisma.$queryRawUnsafe(`
      SELECT id FROM tenant_lender_contacts
      WHERE tenant_id = $1 AND tenant_lender_id = $2 AND product_type = $3 AND contact_email = $4 AND id != $5
    `, tenantId, tenantLenderId, newProductType, newEmail, id);
    if (dupeCheck.length > 0) throw new Error('Contact already exists for this lender and product.');
  }

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

  // If is_primary is set to true, unset others for the SAME product type
  if (fields.is_primary === true) {
    await prisma.$queryRawUnsafe(`
      UPDATE tenant_lender_contacts SET is_primary = false
      WHERE tenant_id = $1 AND tenant_lender_id = $2 AND product_type = $3 AND id != $4
    `, tenantId, tenantLenderId, newProductType, id);
  }

  const rows = await prisma.$queryRawUnsafe(
    `UPDATE tenant_lender_contacts SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
    ...vals
  );
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
async function resolveContactForLender({ tenantId, lenderName, productType }) {
  productType = productType || 'ALL';

  // 1. Try exact match
  let rows = await prisma.$queryRawUnsafe(`
    SELECT tlc.*, tl.lender_name
    FROM tenant_lender_contacts tlc
    JOIN tenant_lenders tl ON tl.id = tlc.tenant_lender_id
    WHERE tlc.tenant_id = $1
      AND LOWER(tl.lender_name) = LOWER($2)
      AND LOWER(tlc.product_type) = LOWER($3)
      AND tl.is_active = true
    ORDER BY tlc.is_primary DESC, tlc.created_at ASC
    LIMIT 1
  `, tenantId, lenderName, productType);

  if (rows.length > 0) return rows[0];

  // 2. Try 'ALL' match as fallback
  if (productType.toUpperCase() !== 'ALL') {
    rows = await prisma.$queryRawUnsafe(`
      SELECT tlc.*, tl.lender_name
      FROM tenant_lender_contacts tlc
      JOIN tenant_lenders tl ON tl.id = tlc.tenant_lender_id
      WHERE tlc.tenant_id = $1
        AND LOWER(tl.lender_name) = LOWER($2)
        AND tlc.product_type = 'ALL'
        AND tl.is_active = true
      ORDER BY tlc.is_primary DESC, tlc.created_at ASC
      LIMIT 1
    `, tenantId, lenderName);
    if (rows.length > 0) return rows[0];
  }

  // 3. None found
  return null;
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
