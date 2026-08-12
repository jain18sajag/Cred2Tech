const prisma = require('../../../config/db');
const { getStorageProvider } = require('../storage/index');

// Only these relations to Case have onDelete: Cascade in schema.prisma —
// everything else referencing case_id must be deleted explicitly before the
// Case row itself, or Postgres rejects the delete with a foreign-key
// violation. Order matters for three reasons, all verified directly against
// schema.prisma:
//   1. Document is deleted LAST — gstrAnalyticsRequest/itrAnalyticsRequest/
//      bankStatementAnalysisRequest/salarySlipOcrResult each hold their own
//      FK into documents (gst_pdf_document_id etc.), so those rows must be
//      gone before their referenced Document rows can go.
//   2. gstFinancialYearSummary must go before gstrAnalyticsRequest (it has a
//      required FK to gst_request_id with no cascade).
//   3. dataRetentionSchedule must go after purgeAuditLog's retention_schedule_id
//      is detached (handled separately below) — purgeAuditLog rows themselves
//      are a permanent audit trail and are never deleted here.
const NON_CASCADING_MODELS_IN_ORDER = [
  'activityLog',
  'caseStageHistory',
  'casePayment',
  'apiUsageLog',
  'customerConsent',
  // gstFinancialYearSummary is handled separately, before this loop runs —
  // it has a required FK to gst_request_id with no cascade, so it must be
  // gone before gstrAnalyticsRequest is deleted below.
  'gstrAnalyticsRequest',
  'itrAnalyticsRequest',
  'bankStatementAnalysisRequest',
  'caseDataPullStatus',
  'bureauVerification',
  'bureauVerificationLog',
  'proposal', // cascades ProposalDocument automatically (documents FK still onDelete: Cascade there)
  'caseSanction',
  'disbursement',
  'pDDTask',
  'salarySlipOcrResult',
  'commissionLedger',
  'subDsaPayoutLedger',
  'salesIncentiveLedger',
  'dataPullBackgroundJob',
  'systemNotification',
  'caseFeedback',
  'vendorApiAuditLog',
  'dataRetentionSchedule',
];

// Cascades automatically once the Case row is deleted — listed here only so
// their row counts can be included in the audit log for a complete picture.
const CASCADING_MODELS = [
  'applicant',
  'casePropertyDetails',
  'caseIncomeEntry',
  'caseCreditObligation',
  'caseEsrFinancials',
  'eligibilityReport',
  'caseEsrCalculationLog',
];

async function findCaseTree(rootCaseId) {
  const all = [];
  let frontier = [rootCaseId];
  while (frontier.length > 0) {
    const rows = await prisma.case.findMany({
      where: { id: { in: frontier } },
      select: {
        id: true, tenant_id: true, customer_id: true, customer_name: true, stage: true,
        child_cases: { select: { id: true } },
      },
    });
    all.push(...rows);
    frontier = rows.flatMap((r) => r.child_cases.map((c) => c.id));
  }
  return all;
}

/**
 * Permanently and irreversibly deletes a case, every case cloned from it
 * (parent_case_id descendants), and every row across every related table —
 * plus the actual files in storage for every Document involved. Nothing
 * about this is recoverable; see AdminDataPurgePage.jsx's danger-zone
 * confirmation for the UI-side guardrails. SUPER_ADMIN only (enforced at
 * the route level).
 */
async function hardDeleteCase({ caseId, triggeredByUserId, reason }) {
  const rootCaseId = parseInt(caseId, 10);
  const root = await prisma.case.findUnique({ where: { id: rootCaseId }, select: { id: true } });
  if (!root) throw Object.assign(new Error('Case not found.'), { statusCode: 404 });

  const tree = await findCaseTree(rootCaseId); // [root, ...all descendants], any order
  const caseIds = tree.map((c) => c.id);
  const rootInfo = tree.find((c) => c.id === rootCaseId);
  const childCaseIds = caseIds.filter((id) => id !== rootCaseId);

  // Deepest descendants first so no Case row is deleted while another Case
  // still points at it via parent_case_id (onDelete: NoAction on that FK).
  const depthOf = new Map(caseIds.map((id) => [id, 0]));
  {
    let frontier = [rootCaseId];
    let depth = 0;
    while (frontier.length > 0) {
      const next = [];
      for (const c of tree) {
        if (frontier.includes(c.id)) {
          for (const child of c.child_cases) next.push(child.id);
        }
      }
      depth += 1;
      for (const id of next) depthOf.set(id, depth);
      frontier = next;
    }
  }
  const deletionOrder = [...caseIds].sort((a, b) => depthOf.get(b) - depthOf.get(a));

  const rowCounts = {};
  const bump = (model, n) => { rowCounts[model] = (rowCounts[model] || 0) + n; };

  const documentsToDelete = await prisma.document.findMany({
    where: { case_id: { in: caseIds } },
    select: { id: true, storage_provider: true, storage_path: true },
  });

  const auditLogId = await prisma.$transaction(async (tx) => {
    // 1. gstFinancialYearSummary must clear before its parent gstrAnalyticsRequest rows.
    const gstRequestIds = (
      await tx.gstrAnalyticsRequest.findMany({ where: { case_id: { in: caseIds } }, select: { id: true } })
    ).map((r) => r.id);
    if (gstRequestIds.length > 0) {
      const { count } = await tx.gstFinancialYearSummary.deleteMany({ where: { gst_request_id: { in: gstRequestIds } } });
      bump('gstFinancialYearSummary', count);
    }

    // 2. Detach (never delete) purgeAuditLog rows from the retention schedules
    // this case's data is about to lose — the audit trail must outlive the purge it recorded.
    const scheduleIds = (
      await tx.dataRetentionSchedule.findMany({ where: { case_id: { in: caseIds } }, select: { id: true } })
    ).map((r) => r.id);
    if (scheduleIds.length > 0) {
      await tx.purgeAuditLog.updateMany({
        where: { retention_schedule_id: { in: scheduleIds } },
        data: { retention_schedule_id: null },
      });
    }

    // 3. Every other non-cascading table, Document last.
    for (const model of NON_CASCADING_MODELS_IN_ORDER) {
      const { count } = await tx[model].deleteMany({ where: { case_id: { in: caseIds } } });
      bump(model, count);
    }
    const { count: docCount } = await tx.document.deleteMany({ where: { case_id: { in: caseIds } } });
    bump('document', docCount);

    // 4. Cascading models — counted for the audit log only (Case deletion below removes them).
    for (const model of CASCADING_MODELS) {
      const count = await tx[model].count({ where: { case_id: { in: caseIds } } });
      bump(model, count);
    }

    // 5. Finally the Case rows themselves, deepest descendants first.
    for (const id of deletionOrder) {
      await tx.case.delete({ where: { id } });
    }
    bump('case', deletionOrder.length);

    const auditLog = await tx.caseHardDeleteLog.create({
      data: {
        case_id: rootCaseId,
        child_case_ids: childCaseIds,
        tenant_id: rootInfo?.tenant_id ?? null,
        customer_id: rootInfo?.customer_id ?? null,
        customer_name: rootInfo?.customer_name ?? null,
        case_stage: rootInfo?.stage ?? null,
        triggered_by_user_id: triggeredByUserId,
        reason,
        row_counts: rowCounts,
        documents_deleted: documentsToDelete.length,
      },
    });
    return auditLog.id;
  }, { timeout: 30000 });

  // Storage I/O can't be part of the DB transaction and can't be rolled back
  // once the rows are already gone — best effort, same precedent as
  // dataRetentionPurge.service.js's purgeRecord().
  let filesDeleted = 0;
  let filesFailed = 0;
  for (const doc of documentsToDelete) {
    try {
      const storage = getStorageProvider(doc.storage_provider);
      await storage.delete(doc.storage_path);
      filesDeleted += 1;
    } catch (err) {
      filesFailed += 1;
      console.error(`[hardDeleteCase] storage delete failed for document=${doc.id} path=${doc.storage_path}: ${err.message}`);
    }
  }
  if (documentsToDelete.length > 0) {
    await prisma.caseHardDeleteLog.update({
      where: { id: auditLogId },
      data: { files_deleted: filesDeleted, files_failed: filesFailed },
    });
  }

  return {
    deletedCaseId: rootCaseId,
    childCaseIds,
    totalCasesDeleted: deletionOrder.length,
    rowCounts,
    documentsDeleted: documentsToDelete.length,
    filesDeleted,
    filesFailed,
    auditLogId,
  };
}

module.exports = { hardDeleteCase };
