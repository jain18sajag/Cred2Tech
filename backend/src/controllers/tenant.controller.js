const prisma = require('../../config/db');

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

module.exports = {
  createTenant,
  getTenants,
  updateTenantStatus
};
