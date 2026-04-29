const prisma = require('../../config/db');

async function getTenantSummary(req, res) {
  // #swagger.tags = ['Admin Controls', 'Tenant Management']
  // #swagger.summary = 'Fetch DSA summary drilldown'
  try {
    const tenantId = parseInt(req.params.tenant_id, 10);

    const [
      tenant,
      wallet,
      totalCustomers,
      totalCases,
      teamSize,
      apiLogs,
      recentWalletTransactions,
      lastActivity
    ] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.tenantWallet.findUnique({ where: { tenant_id: tenantId } }),
      prisma.customer.count({ where: { tenant_id: tenantId } }),
      prisma.case.count({ where: { tenant_id: tenantId } }),
      prisma.user.count({ where: { tenant_id: tenantId } }),
      prisma.apiUsageLog.findMany({ where: { tenant_id: tenantId, status: 'SUCCESS' } }),
      prisma.walletTransaction.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        take: 5
      }),
      prisma.activityLog.findFirst({
        where: { customer: { tenant_id: tenantId } },
        orderBy: { created_at: 'desc' }
      })
    ]);

    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    let gstPulls = 0;
    let itrPulls = 0;
    let bureauPulls = 0;

    for (const log of apiLogs) {
      if (log.api_code === 'GST_FETCH') gstPulls++;
      if (log.api_code === 'ITR_FETCH') itrPulls++;
      if (log.api_code === 'BUREAU_PULL') bureauPulls++;
    }

    res.json({
      tenant_id: tenant.id,
      tenant_name: tenant.name,
      pan_number: tenant.pan_number,
      gst_number: tenant.gst_number,
      city: tenant.city,
      email: tenant.email,
      mobile: tenant.mobile,
      wallet_balance: wallet?.balance || 0,
      total_customers: totalCustomers,
      total_cases: totalCases,
      total_api_usage: apiLogs.length,
      gst_pulls: gstPulls,
      itr_pulls: itrPulls,
      bureau_pulls: bureauPulls,
      last_activity: lastActivity ? lastActivity.created_at : null,
      team_size: teamSize,
      recent_wallet_transactions: recentWalletTransactions
    });

  } catch (err) {
    console.error('Tenant summary fetch failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = {
  getTenantSummary
};
