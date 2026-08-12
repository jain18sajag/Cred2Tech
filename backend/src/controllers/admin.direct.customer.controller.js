const prisma = require('../../config/db');
const { sendCaughtError } = require('../utils/sendError');

async function listDirectCases(req, res) {
  try {
    const cases = await prisma.case.findMany({
      where: { lead_source: 'DIRECT_MSME' },
      include: {
        customer: true,
        msme_customer_user: { select: { name: true, mobile: true, email: true } },
        case_payment: true,
        assigned_dsa_user: { select: { name: true } },
      },
      orderBy: { created_at: 'desc' }
    });
    return res.status(200).json(cases);
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch direct MSME cases', 500);
  }
}

async function getDirectCaseDetail(req, res) {
  try {
    const { caseId } = req.params;
    const caseData = await prisma.case.findUnique({
      where: { id: parseInt(caseId, 10) },
      include: {
        customer: true,
        msme_customer_user: { select: { name: true, mobile: true, email: true } },
        case_payment: true,
        assigned_dsa_user: { select: { name: true, tenant: { select: { name: true } } } },
        applicants: true,
        esrs: {
          orderBy: { created_at: 'desc' },
          take: 1,
          include: { lenders: true }
        }
      }
    });
    if (!caseData || caseData.lead_source !== 'DIRECT_MSME') {
      return res.status(404).json({ error: 'Direct MSME Case not found' });
    }
    return res.status(200).json(caseData);
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch direct MSME case detail', 500);
  }
}

async function getAllocationTargets(req, res) {
  try {
    // include (not select) on the top-level tenant.findMany already returns
    // every scalar Tenant column (pan_number, gst_number, state, city,
    // pincode, company_type, email, mobile, type, status, created_at, ...) —
    // the allocation page's "Tenant Details" panel reads those directly off
    // this response, no separate fetch needed for them.
    const tenants = await prisma.tenant.findMany({
      where: { type: 'DSA', status: 'ACTIVE' },
      include: {
        users: {
          where: { status: 'ACTIVE', role: { name: { in: ['DSA_ADMIN', 'DSA_MEMBER'] } } },
          select: {
            id: true, name: true, email: true, mobile: true, designation: true,
            status: true, created_at: true, last_login_at: true,
            role: { select: { name: true } },
          },
        }
      }
    });
    return res.status(200).json(tenants);
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to fetch allocation targets', 500);
  }
}

async function allocateDirectCase(req, res) {
  try {
    const { caseId } = req.params;
    const { dsa_tenant_id, dsa_user_id } = req.body;
    const parsedCaseId = parseInt(caseId, 10);

    if (!dsa_tenant_id || !dsa_user_id) {
      return res.status(400).json({ error: 'dsa_tenant_id and dsa_user_id are required' });
    }

    const dsaUser = await prisma.user.findFirst({
      where: { id: parseInt(dsa_user_id, 10), tenant_id: parseInt(dsa_tenant_id, 10) }
    });

    if (!dsaUser) {
      return res.status(400).json({ error: 'Invalid DSA tenant or user' });
    }

    // Re-allocation is allowed (no stage/already-allocated guard) — capture
    // who it was previously assigned to first, since the update below
    // overwrites that and there's no separate allocation-history table to
    // recover it from afterward.
    const previousCase = await prisma.case.findUnique({
      where: { id: parsedCaseId },
      select: { assigned_dsa_tenant_id: true, assigned_dsa_user: { select: { name: true, tenant: { select: { name: true } } } } }
    });
    const isReallocation = !!previousCase?.assigned_dsa_tenant_id;

    const updatedCase = await prisma.case.update({
      where: { id: parsedCaseId },
      data: {
        tenant_id: parseInt(dsa_tenant_id, 10), // Move case into DSA pipeline
        assigned_dsa_tenant_id: parseInt(dsa_tenant_id, 10),
        assigned_dsa_user_id: parseInt(dsa_user_id, 10),
        allocated_by_admin_id: req.user.id,
        allocated_at: new Date()
      }
    });

    await prisma.activityLog.create({
      data: {
        case_id: parsedCaseId,
        activity_type: isReallocation ? 'CASE_REALLOCATED' : 'CASE_ALLOCATED',
        description: isReallocation
          ? `Case re-allocated from ${previousCase.assigned_dsa_user?.tenant?.name || 'Unknown DSA'} (${previousCase.assigned_dsa_user?.name || 'Unknown agent'}) to ${dsaUser.name} (tenant #${dsa_tenant_id})`
          : `Case allocated to ${dsaUser.name} (tenant #${dsa_tenant_id})`,
        performed_by_user_id: req.user.id,
      }
    });

    return res.status(200).json(updatedCase);
  } catch (err) {
    return sendCaughtError(res, err, 'Failed to allocate direct case', 500);
  }
}

module.exports = { listDirectCases, getDirectCaseDetail, getAllocationTargets, allocateDirectCase };
