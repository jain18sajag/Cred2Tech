const prisma = require('../../config/db');
const bcrypt = require('bcrypt');

async function createTenant(req, res) {
  console.log('CREATE TENANT PAYLOAD:', JSON.stringify(req.body));
  try {
    const {
      name, email, mobile, type, pan_number, gst_number,
      company_type, state, city, pincode, status
    } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'email is required for tenant creation' });
    }

    // Check if email already exists for cleaner error UX
    const existing = await prisma.tenant.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: `A tenant with email "${email}" already exists. Please use a different email address.` });
    }

    const tenant = await prisma.tenant.create({
      data: {
        name,
        email,
        mobile: mobile || null,
        type,
        pan_number: pan_number || null,
        gst_number: gst_number || null,
        company_type: company_type || null,
        state: state || null,
        city: city || null,
        pincode: pincode || null,
        status: status || 'ACTIVE',
        created_by: req.user.id,
        updated_by: req.user.id,
      }
    });
    res.status(201).json(tenant);
  } catch (error) {
    // Catch any remaining Prisma unique constraint errors (P2002) as a safety net
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0] || 'field';
      return res.status(409).json({ error: `A tenant with this ${field} already exists.` });
    }
    res.status(400).json({ error: error.message });
  }
}

async function getTenants(req, res) {
  try {
    const tenants = await prisma.tenant.findMany();
    res.json(tenants);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
}

async function updateTenantStatus(req, res) {
  try {
    const tenant = await prisma.tenant.update({
      where: { id: parseInt(req.params.id, 10) },
      data: {
        status: req.body.status,
        updated_by: req.user.id
      }
    });
    res.json(tenant);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

/**
 * Public (unauthenticated) DSA self-registration.
 * Creates a DSA tenant + initial DSA_ADMIN user in one call.
 */
async function publicRegisterDSA(req, res) {
  try {
    const {
      name, email, mobile,
      pan_number, gst_number, company_type,
      state, city, pincode,
      admin_name, admin_email, admin_mobile, admin_password,
    } = req.body;

    // --- Basic validation ---
    if (!name || !email || !admin_name || !admin_email || !admin_password) {
      return res.status(400).json({ error: 'name, email, admin_name, admin_email and admin_password are required.' });
    }

    // --- Check for duplicate tenant email ---
    const existingTenant = await prisma.tenant.findUnique({ where: { email } });
    if (existingTenant) {
      return res.status(409).json({ error: `A tenant with email "${email}" already exists.` });
    }

    // --- Check for duplicate admin user email ---
    const existingUser = await prisma.user.findUnique({ where: { email: admin_email } });
    if (existingUser) {
      return res.status(409).json({ error: `A user with email "${admin_email}" already exists.` });
    }

    // --- Resolve DSA_ADMIN role ---
    const dsaAdminRole = await prisma.role.findUnique({ where: { name: 'DSA_ADMIN' } });
    if (!dsaAdminRole) {
      return res.status(500).json({ error: 'DSA_ADMIN role not found. Please contact the platform administrator.' });
    }

    // --- Create tenant (always DSA type for self-registration) ---
    const tenant = await prisma.tenant.create({
      data: {
        name,
        email,
        mobile: mobile || null,
        type: 'DSA',
        pan_number: pan_number ? pan_number.toUpperCase() : null,
        gst_number: gst_number ? gst_number.toUpperCase() : null,
        company_type: company_type || null,
        state: state || null,
        city: city || null,
        pincode: pincode || null,
        status: 'ACTIVE',
      },
    });

    // --- Create DSA admin user ---
    const password_hash = await bcrypt.hash(admin_password, 10);
    const user = await prisma.user.create({
      data: {
        name: admin_name,
        email: admin_email,
        mobile: admin_mobile || null,
        password_hash,
        role_id: dsaAdminRole.id,
        tenant_id: tenant.id,
        status: 'ACTIVE',
      },
    });

    return res.status(201).json({
      message: 'DSA registered successfully. You can now log in.',
      tenant: { id: tenant.id, name: tenant.name, email: tenant.email },
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0] || 'field';
      return res.status(409).json({ error: `A record with this ${field} already exists.` });
    }
    console.error('[publicRegisterDSA]', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}

module.exports = {
  createTenant,
  getTenants,
  updateTenantStatus,
  publicRegisterDSA,
};
