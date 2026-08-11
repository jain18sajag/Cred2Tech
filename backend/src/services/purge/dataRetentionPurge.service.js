/**
 * Data Retention / Purge Service (CT-004-DPP compliance)
 *
 *  - reconcileRetentionSchedules() → backfills DataRetentionSchedule rows
 *    for any source record that doesn't have one yet, expiry = created_at + 179 days.
 *  - enqueueDuePurges()            → finds schedule rows past expiry and
 *    enqueues one BullMQ job per record. Queries ONLY the schedule table,
 *    never the 4 source tables directly.
 *  - purgeRecord()                 → the actual per-record purge: nulls the
 *    sensitive columns (raw payloads AND derived credit figures), deletes
 *    child rows / linked documents, writes the audit trail.
 *
 * Both the 1AM cron (jobs/purgeScheduler.js) and the BullMQ worker
 * (workers/purge.worker.js) call into this file — it owns all the business
 * logic, they own only scheduling/queue wiring.
 */

const prisma = require('../../../config/db');
const { deleteDocument } = require('../document.service');
const { purgeQueue } = require('../../queues/purgeQueue');
const { sendCasePurgedNotification } = require('./purgeNotification.email');

const RETENTION_DAYS = 179;
const RECONCILE_BATCH_LIMIT = 5000;
const ENQUEUE_BATCH_SIZE = 500;

// Only the raw JSON wrappers were purged by the old job (src/jobs/purgeConfidentialData.js,
// now retired). This map also covers the *derived* credit figures (bureau
// score, GST turnover, ITR net profit, bank average balance, etc.) — per
// CT-004-DPP, those are the actual sensitive credit information, not just
// their raw JSON container. Identity/evidence fields (ids, status, PAN/GSTIN,
// timestamps) are deliberately left untouched.
const PURGE_FIELD_MAP = {
  bureau_verifications: {
    model: 'bureauVerification',
    idIsUuid: true,
    nullFields: ['raw_response', 'score', 'emi_obligations_total'],
    documentIdFields: [],
  },
  gstr_analytics_requests: {
    model: 'gstrAnalyticsRequest',
    nullFields: [
      'raw_fetch_data', 'raw_report_data', 'raw_gst_data', 'provider_callback_payload', 'callback_payload',
      'report_json_url', 'report_excel_url', 'report_pdf_url',
      'turnover_latest_year', 'turnover_previous_year', 'avg_monthly_turnover',
      'months_filed_12m', 'nil_return_months',
      'selected_turnover_latest_fy', 'selected_turnover_previous_fy', 'selected_turnover_source',
      'rolling_12_month_turnover', 'rolling_12_month_end_period',
      'financial_year_latest', 'financial_year_previous',
    ],
    documentIdFields: ['gst_pdf_document_id', 'gst_excel_document_id', 'gst_json_document_id'],
    childDelete: { model: 'gstFinancialYearSummary', fk: 'gst_request_id' },
  },
  itr_analytics_requests: {
    model: 'itrAnalyticsRequest',
    nullFields: [
      'analytics_payload',
      'net_profit_latest_year', 'net_profit_previous_year',
      'gross_receipts_latest_year', 'gross_receipts_previous_year',
      'financial_year_latest', 'financial_year_previous',
    ],
    documentIdFields: ['itr_document_id'],
  },
  bank_statement_analysis_requests: {
    model: 'bankStatementAnalysisRequest',
    nullFields: [
      'files_payload', 'raw_analyze_response', 'raw_retrieve_response', 'raw_download_response',
      'report_json_url', 'report_excel_url',
      'avg_bank_balance_latest_year', 'avg_bank_balance_previous_year',
      'financial_year_latest', 'financial_year_previous',
    ],
    documentIdFields: ['bank_excel_document_id', 'bank_json_document_id'],
  },
};

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Backfills DataRetentionSchedule rows for any source record that doesn't
 * have one yet. Runs nightly rather than hooking into each of the 4
 * services' creation/webhook-ingestion call sites — those already carry
 * fragile idempotency logic (e.g. webhook_claimed_at TOCTOU handling), and a
 * up-to-24h lag before a schedule row exists is irrelevant given a 179-day
 * window and a daily cadence: nothing purges early (expiry is computed from
 * the row's real created_at) and nothing is missed (next night catches it).
 */
async function reconcileRetentionSchedules() {
  const results = {};

  const bureauRows = await prisma.$queryRaw`
    SELECT bv.id, bv.case_id, bv.applicant_id, bv.created_at, c.tenant_id, c.customer_id
    FROM "bureau_verifications" bv
    JOIN "cases" c ON c.id = bv.case_id
    LEFT JOIN "data_retention_schedules" drs
      ON drs.source_table = 'bureau_verifications' AND drs.record_id = bv.id::text
    WHERE drs.id IS NULL
    LIMIT ${RECONCILE_BATCH_LIMIT}
  `;
  results.bureau_verifications = await insertScheduleRows('bureau_verifications', bureauRows);

  const gstRows = await prisma.$queryRaw`
    SELECT t.id, t.tenant_id, t.customer_id, t.case_id, t.applicant_id, t.created_at
    FROM "gstr_analytics_requests" t
    LEFT JOIN "data_retention_schedules" drs
      ON drs.source_table = 'gstr_analytics_requests' AND drs.record_id = t.id::text
    WHERE drs.id IS NULL
    LIMIT ${RECONCILE_BATCH_LIMIT}
  `;
  results.gstr_analytics_requests = await insertScheduleRows('gstr_analytics_requests', gstRows);

  const itrRows = await prisma.$queryRaw`
    SELECT t.id, t.tenant_id, t.customer_id, t.case_id, t.applicant_id, t.created_at
    FROM "itr_analytics_requests" t
    LEFT JOIN "data_retention_schedules" drs
      ON drs.source_table = 'itr_analytics_requests' AND drs.record_id = t.id::text
    WHERE drs.id IS NULL
    LIMIT ${RECONCILE_BATCH_LIMIT}
  `;
  results.itr_analytics_requests = await insertScheduleRows('itr_analytics_requests', itrRows);

  const bankRows = await prisma.$queryRaw`
    SELECT t.id, t.tenant_id, t.customer_id, t.case_id, t.applicant_id, t.created_at
    FROM "bank_statement_analysis_requests" t
    LEFT JOIN "data_retention_schedules" drs
      ON drs.source_table = 'bank_statement_analysis_requests' AND drs.record_id = t.id::text
    WHERE drs.id IS NULL
    LIMIT ${RECONCILE_BATCH_LIMIT}
  `;
  results.bank_statement_analysis_requests = await insertScheduleRows('bank_statement_analysis_requests', bankRows);

  return results;
}

async function insertScheduleRows(sourceTable, rows) {
  if (rows.length === 0) return { inserted: 0 };
  const data = rows.map((r) => ({
    source_table: sourceTable,
    record_id: String(r.id),
    tenant_id: r.tenant_id ?? null,
    customer_id: r.customer_id ?? null,
    case_id: r.case_id ?? null,
    applicant_id: r.applicant_id ?? null,
    recorded_at: r.created_at,
    expiry_date: addDays(r.created_at, RETENTION_DAYS),
    status: 'PENDING',
  }));
  const { count } = await prisma.dataRetentionSchedule.createMany({ data, skipDuplicates: true });
  return { inserted: count };
}

const STALE_QUEUED_MINUTES = 60;

/**
 * Backstop for the narrow case a caught Redis error can't cover: a process
 * crash (or kill -9) between claiming a row as QUEUED and actually calling
 * purgeQueue.add() for it. Without this, such a row would sit at QUEUED
 * forever — enqueueDuePurges only ever selects PENDING — with no job ever
 * in the queue. Anything claimed over an hour ago with no corresponding
 * progress is safe to assume lost and hand back to the next sweep.
 */
async function requeueStaleClaims() {
  const staleBefore = new Date(Date.now() - STALE_QUEUED_MINUTES * 60 * 1000);
  const { count } = await prisma.dataRetentionSchedule.updateMany({
    where: { status: 'QUEUED', updated_at: { lt: staleBefore } },
    data: { status: 'PENDING' },
  });
  if (count > 0) {
    console.log(`[purge] requeued ${count} stale QUEUED schedule row(s) back to PENDING`);
  }
  return { requeued: count };
}

/**
 * Finds schedule rows past expiry and enqueues one BullMQ job per record.
 * Queries ONLY data_retention_schedules — never the 4 source tables.
 */
async function enqueueDuePurges() {
  await requeueStaleClaims();

  let totalEnqueued = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const due = await prisma.dataRetentionSchedule.findMany({
      where: { status: 'PENDING', expiry_date: { lte: new Date() } },
      orderBy: { expiry_date: 'asc' },
      take: ENQUEUE_BATCH_SIZE,
    });
    if (due.length === 0) break;

    // Optimistic claim before enqueueing, so a double cron-fire (e.g. if PM2
    // is ever scaled beyond instances:1) can't double-enqueue the same rows.
    await prisma.dataRetentionSchedule.updateMany({
      where: { id: { in: due.map((d) => d.id) }, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });

    for (const row of due) {
      try {
        await purgeQueue.add(
          'purge-record',
          {
            scheduleId: row.id,
            sourceTable: row.source_table,
            recordId: row.record_id,
            tenantId: row.tenant_id,
            customerId: row.customer_id,
          },
          { jobId: `schedule-${row.id}` },
        );
        totalEnqueued += 1;
      } catch (err) {
        // Enqueue failed (e.g. Redis unreachable/not yet provisioned on a
        // new server) — revert this row's claim back to PENDING so the next
        // sweep retries it, instead of stranding it at QUEUED with no job
        // ever actually enqueued (enqueueDuePurges only ever selects
        // status: 'PENDING', so a row stuck at QUEUED would otherwise never
        // be picked up again).
        console.error(`[purge] failed to enqueue schedule=${row.id}: ${err.message}`);
        await prisma.dataRetentionSchedule.updateMany({
          where: { id: row.id, status: 'QUEUED' },
          data: { status: 'PENDING' },
        }).catch((revertErr) => {
          console.error(`[purge] failed to revert stranded QUEUED schedule=${row.id}: ${revertErr.message}`);
        });
      }
    }

    if (due.length < ENQUEUE_BATCH_SIZE) break;
  }
  return { enqueued: totalEnqueued };
}

async function handlePurgeFailure({
  scheduleId, sourceTable, recordId, tenantId, customerId, error,
  triggerType = 'SCHEDULED', triggeredByUserId = null, reason = null,
}) {
  const errorMessage = String(error?.message || error).slice(0, 2000);
  try {
    await prisma.dataRetentionSchedule.update({
      where: { id: scheduleId },
      data: { status: 'FAILED', last_error: errorMessage, attempts: { increment: 1 } },
    });
  } catch (updateErr) {
    console.error(`[purge] failed to record schedule failure for scheduleId=${scheduleId}: ${updateErr.message}`);
  }
  try {
    await prisma.purgeAuditLog.create({
      data: {
        customer_id: customerId ?? null,
        tenant_id: tenantId ?? null,
        table_name: sourceTable,
        record_id: String(recordId),
        purged_fields: [],
        status: 'FAILED',
        error_message: errorMessage,
        retention_schedule_id: scheduleId,
        trigger_type: triggerType,
        triggered_by_user_id: triggeredByUserId,
        reason,
      },
    });
  } catch (auditErr) {
    console.error(`[purge] failed to write failure audit log for scheduleId=${scheduleId}: ${auditErr.message}`);
  }
}

/**
 * Fires once, permanently, the moment every purge-eligible record for a case
 * has reached PURGED — whether via the nightly retention job or a manual
 * admin request (both funnel through purgeRecord(), so this needs no
 * separate wiring per trigger type). Sets Case.data_purged_at (which
 * case.service.js's updateStage() checks to block further stage changes)
 * and emails the MSME customer. The updateMany claim on data_purged_at
 * being still null is what makes this safe to call after every single
 * record's purge without risking a duplicate email if two records for the
 * same case finish moments apart.
 */
async function maybeNotifyCasePurged(caseId) {
  try {
    const remaining = await prisma.dataRetentionSchedule.count({
      where: { case_id: caseId, status: { not: 'PURGED' } },
    });
    if (remaining > 0) return;

    const claimed = await prisma.case.updateMany({
      where: { id: caseId, data_purged_at: null },
      data: { data_purged_at: new Date() },
    });
    if (claimed.count === 0) return; // already notified by a concurrent call

    const caseRow = await prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        product_type: true,
        customer_name: true,
        customer: { select: { business_email: true, business_name: true } },
        msme_customer_user: { select: { synced_email: true } },
      },
    });
    if (!caseRow) return;

    const recipientEmail = caseRow.customer?.business_email || caseRow.msme_customer_user?.synced_email || null;
    await sendCasePurgedNotification({
      recipientEmail,
      customerName: caseRow.customer?.business_name || caseRow.customer_name,
      caseId: caseRow.id,
      productType: caseRow.product_type,
    });
  } catch (err) {
    console.error(`[purge] case-purged notification check failed for case=${caseId}: ${err.message}`);
  }
}

/**
 * Purges a single record: nulls sensitive columns + deletes child rows in
 * one transaction alongside the audit-log write and schedule-status update
 * (the old job's bug was doing these as separate, non-transactional calls).
 * Linked document/S3 deletion happens AFTER the transaction commits — best
 * effort, matching the established precedent in case.service.js's applicant
 * removal flow (~line 1790): storage I/O can't be rolled back once the DB
 * commit lands, and a storage failure must not undo an already-committed purge.
 */
async function purgeRecord({
  scheduleId, sourceTable, recordId, tenantId: payloadTenantId, customerId: payloadCustomerId,
  triggerType = 'SCHEDULED', triggeredByUserId = null, reason = null,
}) {
  const fieldMap = PURGE_FIELD_MAP[sourceTable];
  if (!fieldMap) throw new Error(`purgeRecord: unknown source_table "${sourceTable}"`);
  const castId = fieldMap.idIsUuid ? recordId : parseInt(recordId, 10);

  let txResult;
  try {
    txResult = await prisma.$transaction(async (tx) => {
      const row = await tx[fieldMap.model].findUnique({ where: { id: castId } });

      if (!row) {
        // Row already gone (e.g. hard-deleted via case.service.js's
        // applicant-removal flow) — idempotent, not an error. Still record
        // it in the audit trail: absence of data is a valid purged state.
        const auditLog = await tx.purgeAuditLog.create({
          data: {
            customer_id: payloadCustomerId ?? null,
            tenant_id: payloadTenantId ?? null,
            table_name: sourceTable,
            record_id: String(recordId),
            purged_fields: [],
            status: 'SUCCESS',
            retention_schedule_id: scheduleId,
            trigger_type: triggerType,
            triggered_by_user_id: triggeredByUserId,
            reason,
          },
        });
        const updatedSchedule = await tx.dataRetentionSchedule.update({
          where: { id: scheduleId },
          data: { status: 'PURGED', purged_at: new Date() },
        });
        return { documentIds: [], tenantId: null, auditLogId: auditLog.id, alreadyGone: true, caseId: updatedSchedule.case_id };
      }

      let resolvedTenantId = payloadTenantId ?? null;
      let resolvedCustomerId = payloadCustomerId ?? null;
      if (sourceTable === 'bureau_verifications') {
        const caseRow = await tx.case.findUnique({
          where: { id: row.case_id },
          select: { tenant_id: true, customer_id: true },
        });
        resolvedTenantId = caseRow?.tenant_id ?? resolvedTenantId;
        resolvedCustomerId = caseRow?.customer_id ?? resolvedCustomerId;
      } else {
        resolvedTenantId = row.tenant_id ?? resolvedTenantId;
        resolvedCustomerId = row.customer_id ?? resolvedCustomerId;
      }

      const purgedFields = fieldMap.nullFields.filter((f) => row[f] !== null && row[f] !== undefined);
      if (purgedFields.length > 0) {
        await tx[fieldMap.model].update({
          where: { id: castId },
          data: Object.fromEntries(purgedFields.map((f) => [f, null])),
        });
      }

      if (fieldMap.childDelete) {
        await tx[fieldMap.childDelete.model].deleteMany({ where: { [fieldMap.childDelete.fk]: row.id } });
      }

      const documentIds = fieldMap.documentIdFields.map((f) => row[f]).filter(Boolean);

      const auditLog = await tx.purgeAuditLog.create({
        data: {
          customer_id: resolvedCustomerId,
          tenant_id: resolvedTenantId,
          table_name: sourceTable,
          record_id: String(recordId),
          purged_fields: purgedFields,
          status: 'SUCCESS',
          retention_schedule_id: scheduleId,
          trigger_type: triggerType,
          triggered_by_user_id: triggeredByUserId,
          reason,
        },
      });

      const updatedSchedule = await tx.dataRetentionSchedule.update({
        where: { id: scheduleId },
        data: { status: 'PURGED', purged_at: new Date() },
      });

      return { documentIds, tenantId: resolvedTenantId, auditLogId: auditLog.id, alreadyGone: false, caseId: updatedSchedule.case_id };
    });
  } catch (err) {
    await handlePurgeFailure({
      scheduleId, sourceTable, recordId, tenantId: payloadTenantId, customerId: payloadCustomerId, error: err,
      triggerType, triggeredByUserId, reason,
    });
    throw err;
  }

  // Once this specific record is committed as PURGED, check whether it was
  // the LAST purge-eligible record for its case — if so, notify the MSME
  // customer exactly once. Runs for both the "row already gone" and normal
  // paths, and before the early-return below (which some paths hit).
  if (txResult.caseId) {
    await maybeNotifyCasePurged(txResult.caseId);
  }

  if (txResult.alreadyGone || txResult.documentIds.length === 0) return txResult;

  let allDeleted = true;
  for (const documentId of txResult.documentIds) {
    try {
      await deleteDocument(documentId, txResult.tenantId);
    } catch (err) {
      allDeleted = false;
      console.error(`[purge] document delete failed for schedule=${scheduleId} documentId=${documentId}: ${err.message}`);
    }
  }
  if (allDeleted && txResult.auditLogId) {
    await prisma.purgeAuditLog.update({ where: { id: txResult.auditLogId }, data: { files_deleted: true } });
  }

  return txResult;
}

async function getOrCreateScheduleForRecord(sourceTable, { id, tenantId, customerId, caseId, applicantId, createdAt }) {
  const recordId = String(id);
  const existing = await prisma.dataRetentionSchedule.findFirst({
    where: { source_table: sourceTable, record_id: recordId },
  });
  if (existing) return existing;
  return prisma.dataRetentionSchedule.create({
    data: {
      source_table: sourceTable,
      record_id: recordId,
      tenant_id: tenantId ?? null,
      customer_id: customerId ?? null,
      case_id: caseId ?? null,
      applicant_id: applicantId ?? null,
      recorded_at: createdAt,
      expiry_date: addDays(createdAt, RETENTION_DAYS),
      status: 'PENDING',
    },
  });
}

/**
 * Admin-initiated early/manual purge for a single case — for right-to-
 * erasure / consent-withdrawal style requests raised BEFORE a record's
 * natural 179-day expiry (if it already expired, the scheduled job already
 * purged it — this reports that rather than re-processing). Access to this
 * is gated at the route layer to SUPER_ADMIN only (Cred2Tech's own internal
 * admin role) — never DSA_ADMIN, which is an external partner/channel role.
 */
async function manualPurgeCase({ caseId, triggeredByUserId, reason }) {
  const caseIdInt = parseInt(caseId, 10);
  if (!Number.isFinite(caseIdInt)) throw new Error(`manualPurgeCase: invalid caseId "${caseId}"`);

  const caseRow = await prisma.case.findUnique({
    where: { id: caseIdInt },
    select: { id: true, tenant_id: true, customer_id: true },
  });
  if (!caseRow) throw new Error(`manualPurgeCase: case ${caseIdInt} not found`);

  const [bureauRows, gstRows, itrRows, bankRows] = await Promise.all([
    prisma.bureauVerification.findMany({ where: { case_id: caseIdInt }, select: { id: true, applicant_id: true, created_at: true } }),
    prisma.gstrAnalyticsRequest.findMany({ where: { case_id: caseIdInt }, select: { id: true, tenant_id: true, customer_id: true, applicant_id: true, created_at: true } }),
    prisma.itrAnalyticsRequest.findMany({ where: { case_id: caseIdInt }, select: { id: true, tenant_id: true, customer_id: true, applicant_id: true, created_at: true } }),
    prisma.bankStatementAnalysisRequest.findMany({ where: { case_id: caseIdInt }, select: { id: true, tenant_id: true, customer_id: true, applicant_id: true, created_at: true } }),
  ]);

  const targets = [
    ...bureauRows.map((r) => ({
      sourceTable: 'bureau_verifications', id: r.id,
      tenantId: caseRow.tenant_id, customerId: caseRow.customer_id,
      caseId: caseIdInt, applicantId: r.applicant_id, createdAt: r.created_at,
    })),
    ...gstRows.map((r) => ({
      sourceTable: 'gstr_analytics_requests', id: r.id,
      tenantId: r.tenant_id, customerId: r.customer_id,
      caseId: caseIdInt, applicantId: r.applicant_id, createdAt: r.created_at,
    })),
    ...itrRows.map((r) => ({
      sourceTable: 'itr_analytics_requests', id: r.id,
      tenantId: r.tenant_id, customerId: r.customer_id,
      caseId: caseIdInt, applicantId: r.applicant_id, createdAt: r.created_at,
    })),
    ...bankRows.map((r) => ({
      sourceTable: 'bank_statement_analysis_requests', id: r.id,
      tenantId: r.tenant_id, customerId: r.customer_id,
      caseId: caseIdInt, applicantId: r.applicant_id, createdAt: r.created_at,
    })),
  ];

  const results = [];
  for (const target of targets) {
    const schedule = await getOrCreateScheduleForRecord(target.sourceTable, target);

    if (schedule.status === 'PURGED') {
      results.push({
        sourceTable: target.sourceTable,
        recordId: String(target.id),
        skipped: true,
        alreadyPurgedAt: schedule.purged_at,
      });
      continue;
    }

    const result = await purgeRecord({
      scheduleId: schedule.id,
      sourceTable: target.sourceTable,
      recordId: String(target.id),
      tenantId: target.tenantId,
      customerId: target.customerId,
      triggerType: 'MANUAL',
      triggeredByUserId,
      reason,
    });
    results.push({ sourceTable: target.sourceTable, recordId: String(target.id), skipped: false, ...result });
  }

  return {
    caseId: caseIdInt,
    purgedCount: results.filter((r) => !r.skipped).length,
    alreadyPurgedCount: results.filter((r) => r.skipped).length,
    results,
  };
}

/**
 * Read-only status for the admin purge page: current retention-schedule
 * state per record for this case, plus full audit history (both SCHEDULED
 * and MANUAL entries).
 */
async function getCasePurgeStatus(caseId) {
  const caseIdInt = parseInt(caseId, 10);
  const caseRow = await prisma.case.findUnique({
    where: { id: caseIdInt },
    select: {
      id: true,
      stage: true,
      category: true,
      product_type: true,
      loan_amount: true,
      sanctioned_amount: true,
      total_disbursed_amount: true,
      customer_name: true,
      entity_type: true,
      lead_source: true,
      lead_date: true,
      created_at: true,
      updated_at: true,
      customer: { select: { id: true, business_name: true, legal_business_name: true } },
      tenant: { select: { id: true, name: true, type: true } },
      created_by: { select: { id: true, name: true, email: true } },
      assigned_dsa_user: { select: { id: true, name: true, email: true } },
    },
  });
  const schedules = await prisma.dataRetentionSchedule.findMany({
    where: { case_id: caseIdInt },
    orderBy: { source_table: 'asc' },
  });
  const auditLogs = await prisma.purgeAuditLog.findMany({
    where: { retention_schedule_id: { in: schedules.map((s) => s.id) } },
    orderBy: { purged_at: 'desc' },
  });
  return { caseId: caseIdInt, case: caseRow, schedules, auditLogs };
}

module.exports = {
  PURGE_FIELD_MAP,
  RETENTION_DAYS,
  reconcileRetentionSchedules,
  enqueueDuePurges,
  purgeRecord,
  manualPurgeCase,
  getCasePurgeStatus,
};
