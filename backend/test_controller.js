const prisma = require('./config/db');

function resolveApiStatus(logs, apiCode) {
    const apiLogs = logs.filter(l => l.api_code === apiCode);
    if (apiLogs.some(l => l.status === 'SUCCESS')) return 'COMPLETE';
    if (apiLogs.some(l => l.status === 'FAILED')) return 'PENDING';
    return 'NOT_STARTED';
}

async function test() {
  try {
     const customerId = 8;
     const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
         cases: { orderBy: { created_at: 'desc' }, include: { applicants: true } },
         activity_logs: { orderBy: { created_at: 'desc' }, include: { user: true } },
         api_logs: true
      }
    });

    const user = { role: { name: 'SUPER_ADMIN' }, tenant_id: 1 };

    // Isolation Check
    if (user.role.name !== 'SUPER_ADMIN' && customer.tenant_id !== user.tenant_id) {
       console.log("Forbidden");
    }

    const latestCase = customer.cases[0] || {};
    const primaryApplicant = latestCase.applicants?.find(a => a.type === 'PRIMARY') || {};
    const coBorrowers = (latestCase.applicants || []).filter(a => a.type === 'CO_APPLICANT').map(a => ({
       name: a.email || 'Co-Applicant', // If name isn't present, map email natively
       pan_masked: a.pan_number ? `XXXXX${a.pan_number.slice(5, 9)}X` : null,
       cibil_score: a.cibil_score,
       role: a.type,
       otp_verified: a.otp_verified,
       bureau_fetched: a.bureau_fetched
    }));

    const response = {
       customer_id: customer.id,
       customer_name: customer.business_name || 'N/A',
       entity_type: customer.entity_type,
       industry: customer.industry,
       business_vintage: customer.business_vintage,
       cibil_score: primaryApplicant.cibil_score || null,
       loan_amount: latestCase.loan_amount,
       lender_name: latestCase.lender_name,
       case_stage: latestCase.stage,
       location: latestCase.location,
       property_value: latestCase.property_value,
       ltv_ratio: latestCase.ltv_ratio,
       co_borrowers: coBorrowers,
       activity_log: customer.activity_logs.map(log => ({
          timestamp: log.created_at,
          activity_type: log.activity_type,
          description: log.description,
          performed_by: log.user ? log.user.name : 'System'
       })),
       api_status: {
          bureau: resolveApiStatus(customer.api_logs, 'BUREAU_PULL'),
          gst: resolveApiStatus(customer.api_logs, 'GST_FETCH'),
          itr: resolveApiStatus(customer.api_logs, 'ITR_FETCH')
       }
    };
    
    console.log("SUCCESS");
  } catch(e) {
    console.error("Prisma error:", e);
  } finally {
     await prisma.$disconnect();
  }
}
test();
