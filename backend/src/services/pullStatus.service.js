const prisma = require('../../config/db');

/**
 * Dynamically calculates the status of integration data pulls for a case.
 * Returns terminal status strings: NOT_STARTED, PENDING, PROCESSING, PARTIALLY_COMPLETED, COMPLETED, FAILED.
 */
async function calculateRealPullStatuses(caseId) {
  const caseIdInt = parseInt(caseId, 10);

  // Fetch all applicants for this case
  const applicants = await prisma.applicant.findMany({
    where: { case_id: caseIdInt },
    include: {
      bureau_checks: { orderBy: { created_at: 'desc' }, take: 1 }
    }
  });

  // Fetch all integration request records associated with the case
  const [gstRequests, itrRequests, bankRequests] = await Promise.all([
    prisma.gstrAnalyticsRequest.findMany({ where: { case_id: caseIdInt } }),
    prisma.itrAnalyticsRequest.findMany({ where: { case_id: caseIdInt } }),
    prisma.bankStatementAnalysisRequest.findMany({ where: { case_id: caseIdInt } })
  ]);

  // 1. Calculate Bureau Status (with applicant counts)
  let bureauStatus = 'NOT_STARTED';
  const totalApplicants = applicants.length;
  let completedBureauCount = 0;
  let processingBureauCount = 0;
  let failedBureauCount = 0;

  if (totalApplicants > 0) {
    for (const app of applicants) {
      // Safe backfill fallback policy: treat as verified/fetched if bureau_fetched is true
      // or if they have a successful check in the DB
      const latestCheck = app.bureau_checks[0];
      const isCompleted = app.bureau_fetched || latestCheck?.status === 'SUCCESS' || latestCheck?.status === 'COMPLETED';
      const isProcessing = latestCheck?.status === 'PROCESSING' || latestCheck?.status === 'INITIATED';
      const isFailed = latestCheck?.status === 'FAILED';

      if (isCompleted) {
        completedBureauCount++;
      } else if (isProcessing) {
        processingBureauCount++;
      } else if (isFailed) {
        failedBureauCount++;
      }
    }

    if (completedBureauCount === totalApplicants) {
      bureauStatus = 'COMPLETED';
    } else if (completedBureauCount > 0) {
      bureauStatus = 'PARTIALLY_COMPLETED';
    } else if (processingBureauCount > 0) {
      bureauStatus = 'PROCESSING';
    } else if (failedBureauCount > 0) {
      bureauStatus = 'FAILED';
    } else {
      bureauStatus = 'PENDING';
    }
  }

  // 2. Calculate GST Status
  // Using the new GST refactoring architecture: metrics_status and report_status
  let gstStatus = 'NOT_STARTED';
  if (gstRequests.length > 0) {
    const hasCompleted = gstRequests.some(r => r.report_status === 'COMPLETED' && r.metrics_status === 'COMPLETED');
    const hasFailed = gstRequests.some(r => r.report_status === 'FAILED' || r.metrics_status === 'FAILED' || r.status === 'FAILED');
    const hasProcessing = gstRequests.some(r => 
      ['INITIATED', 'PROCESSING', 'OTP_PENDING', 'OTP_VERIFIED', 'DATA_READY', 'REPORT_READY', 'CALLBACK_RECEIVED'].includes(r.status) &&
      r.metrics_status !== 'COMPLETED' && r.metrics_status !== 'FAILED'
    );

    if (hasCompleted) {
      gstStatus = 'COMPLETED';
    } else if (hasProcessing) {
      gstStatus = 'PROCESSING';
    } else if (hasFailed) {
      gstStatus = 'FAILED';
    } else {
      gstStatus = 'PENDING';
    }
  }

  // 3. Calculate ITR Status
  // Enums: INITIATED, PROCESSING, COMPLETED, FAILED
  let itrStatus = 'NOT_STARTED';
  if (itrRequests.length > 0) {
    const hasCompleted = itrRequests.some(r => r.status === 'COMPLETED');
    const hasFailed = itrRequests.some(r => r.status === 'FAILED');
    const hasProcessing = itrRequests.some(r => ['INITIATED', 'PROCESSING'].includes(r.status));

    if (hasCompleted) {
      itrStatus = 'COMPLETED';
    } else if (hasProcessing) {
      itrStatus = 'PROCESSING';
    } else if (hasFailed) {
      itrStatus = 'FAILED';
    } else {
      itrStatus = 'PENDING';
    }
  }

  // 4. Calculate Bank Status
  // Enums: INITIATED, PRE_ANALYZING, ANALYZING, COMPLETED, FAILED
  let bankStatus = 'NOT_STARTED';
  if (bankRequests.length > 0) {
    const hasCompleted = bankRequests.some(r => r.status === 'COMPLETED');
    const hasFailed = bankRequests.some(r => r.status === 'FAILED');
    const hasProcessing = bankRequests.some(r => ['INITIATED', 'PRE_ANALYZING', 'ANALYZING'].includes(r.status));

    if (hasCompleted) {
      bankStatus = 'COMPLETED';
    } else if (hasProcessing) {
      bankStatus = 'PROCESSING';
    } else if (hasFailed) {
      bankStatus = 'FAILED';
    } else {
      bankStatus = 'PENDING';
    }
  }

  return {
    bureau: {
      status: bureauStatus,
      completedCount: completedBureauCount,
      totalCount: totalApplicants
    },
    gst: {
      status: gstStatus
    },
    itr: {
      status: itrStatus
    },
    bank: {
      status: bankStatus
    }
  };
}

module.exports = {
  calculateRealPullStatuses
};
