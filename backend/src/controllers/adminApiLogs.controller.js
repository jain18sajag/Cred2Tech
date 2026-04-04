const prisma = require('../../config/db');

async function getApiLogs(req, res) {
  // #swagger.tags = ['API Usage Logs']
  // #swagger.summary = 'Filter global API Usage Logs'
  // #swagger.description = 'Fetch logs natively, mapping pagination and filtering options.'
  /* #swagger.parameters['tenant_id'] = { description: 'Filter by Tenant ID', in: 'query', type: 'integer' } */
  try {
    const { tenant_id, api_code, status, date_from, date_to, triggered_by_user_id, page = 1, limit = 50 } = req.query;

    const where = {};
    if (tenant_id) where.tenant_id = parseInt(tenant_id, 10);
    if (api_code) where.api_code = api_code;
    if (status) where.status = status;
    if (triggered_by_user_id) where.triggered_by_user_id = parseInt(triggered_by_user_id, 10);

    if (date_from || date_to) {
       where.created_at = {};
       if (date_from) where.created_at.gte = new Date(date_from);
       if (date_to) where.created_at.lte = new Date(date_to);
    }

    const offset = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.apiUsageLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: parseInt(limit, 10),
        include: {
          tenant: { select: { name: true } },
          user: { select: { name: true } },
          customer: { select: { business_name: true, business_pan: true } }
        }
      }),
      prisma.apiUsageLog.count({ where })
    ]);

    const mapped = logs.map(l => ({
       id: l.id,
       tenant_name: l.tenant?.name,
       triggered_by_user: l.user?.name,
       customer_name: l.customer?.business_name || l.customer?.business_pan,
       case_reference: l.case_id,
       api_code: l.api_code,
       credits_used: l.credits_used,
       status: l.status,
       error_message: l.error_message,
       reference_id: l.reference_id,
       timestamp: l.created_at
    }));

    res.json({ logs: mapped, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch API logs' });
  }
}

async function getTenantLogs(req, res) {
  try {
    const tenant_id = parseInt(req.params.tenant_id, 10);
    req.query.tenant_id = tenant_id; // Mutate and pass down cleanly
    return getApiLogs(req, res);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tenant logs' });
  }
}

async function getLogsSummary(req, res) {
  // #swagger.tags = ['API Usage Logs']
  // #swagger.summary = 'Get aggregated visual KPIs'
  /* #swagger.responses[200] = { description: 'Returns overall total calls, failed calls, credits consumed, and refunds grouped globally' } */
  try {
     const [totalCalls, creditsConsumed, failedCalls, refunds] = await Promise.all([
        prisma.apiUsageLog.count(),
        prisma.apiUsageLog.aggregate({ _sum: { credits_used: true } }),
        prisma.apiUsageLog.count({ where: { status: 'FAILED' } }),
        prisma.walletTransaction.aggregate({ where: { reference_type: 'REFUND' }, _sum: { amount: true } })
     ]);

     const groupByApi = await prisma.apiUsageLog.groupBy({
        by: ['api_code'],
        _count: { api_code: true }
     });

     res.json({
        total_api_calls: totalCalls,
        total_credits_consumed: creditsConsumed._sum.credits_used || 0,
        total_failed_calls: failedCalls,
        total_refunds: refunds._sum.amount || 0,
        usage_per_api_code: groupByApi
     });
  } catch(error) {
    res.status(500).json({ error: "Failed to fetch log summary" });
  }
}

module.exports = {
  getApiLogs,
  getTenantLogs,
  getLogsSummary
};
