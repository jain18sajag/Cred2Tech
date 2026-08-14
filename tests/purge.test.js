// Data retention / purge redesign — end-to-end test against a REAL disposable
// Postgres + real local Redis + real local-disk storage. Deliberately loads
// its own .env.test (never the default .env, which points at the live
// remote dsacrm) BEFORE requiring anything that constructs a PrismaClient
// or a Redis connection, since both read process.env at module-load time.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env.test') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const prisma = require('../config/db');
const {
  reconcileRetentionSchedules,
  enqueueDuePurges,
  purgeRecord,
  manualPurgeCase,
  getCasePurgeStatus,
  RETENTION_DAYS,
} = require('../src/services/purge/dataRetentionPurge.service');
const { updateStage } = require('../src/services/case.service');
const { purgeQueue, QUEUE_NAME } = require('../src/queues/purgeQueue');
const { Worker, QueueEvents } = require('bullmq');
const redisConnection = require('../src/config/redis');
const { queueConnection } = require('../src/config/redis');

const MARKER = `TESTPURGE-${crypto.randomUUID()}`;
const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT);

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

const created = { scheduleIds: [], auditLogIds: [], documentIds: [], gstSummaryIds: [] };
let fixture;

async function buildFixture() {
  const tenant = await prisma.tenant.create({
    data: { name: `${MARKER}-tenant`, email: `${MARKER}@tenant.test`, type: 'DSA' },
  });
  const role = await prisma.role.upsert({
    where: { name: 'DSA_ADMIN' }, update: {}, create: { name: 'DSA_ADMIN' },
  });
  const user = await prisma.user.create({
    data: {
      name: `${MARKER}-user`, email: `${MARKER}@user.test`, password_hash: 'x',
      role_id: role.id, tenant_id: tenant.id,
    },
  });
  const superAdminRole = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' }, update: {}, create: { name: 'SUPER_ADMIN' },
  });
  const adminUser = await prisma.user.create({
    data: {
      name: `${MARKER}-admin`, email: `${MARKER}@admin.test`, password_hash: 'x',
      role_id: superAdminRole.id, tenant_id: tenant.id,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      tenant_id: tenant.id, business_pan: `${MARKER.slice(0, 10)}F`.toUpperCase(),
      created_by_user_id: user.id,
    },
  });
  const caseRow = await prisma.case.create({
    data: { tenant_id: tenant.id, customer_id: customer.id, created_by_user_id: user.id },
  });
  const applicant = await prisma.applicant.create({
    data: { case_id: caseRow.id, type: 'PRIMARY', name: `${MARKER}-applicant` },
  });
  return { tenant, user, adminUser, customer, case: caseRow, applicant };
}

async function seedDueAndNotDueRows() {
  const { tenant, user, customer, case: caseRow, applicant } = fixture;

  // ---- bureau_verifications: one due (200d old), one not due (10d old) ----
  const bureauDue = await prisma.bureauVerification.create({
    data: {
      case_id: caseRow.id, applicant_id: applicant.id, applicant_type: 'PRIMARY',
      request_id: `${MARKER}-bureau-due`, stan: '000001', mobile_number: '9000000000',
      score: '750', raw_response: { dummy: 'raw' }, emi_obligations_total: 5000,
      status: 'COMPLETED', created_at: daysAgo(200),
    },
  });
  const bureauNotDue = await prisma.bureauVerification.create({
    data: {
      case_id: caseRow.id, applicant_id: applicant.id, applicant_type: 'PRIMARY',
      request_id: `${MARKER}-bureau-notdue`, stan: '000002', mobile_number: '9000000001',
      score: '700', raw_response: { dummy: 'raw2' }, status: 'COMPLETED', created_at: daysAgo(10),
    },
  });

  // ---- gstr_analytics_requests: due row gets a child summary + a document ----
  const gstDue = await prisma.gstrAnalyticsRequest.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id, applicant_id: applicant.id,
      mode: 'IN_SYSTEM', gstin: `${MARKER.slice(0, 15)}`.toUpperCase(), from_date: '2025-01-01', to_date: '2025-12-31',
      raw_fetch_data: { a: 1 }, raw_report_data: { b: 2 }, raw_gst_data: { c: 3 },
      provider_callback_payload: { d: 4 }, callback_payload: { e: 5 },
      turnover_latest_year: 1000000, turnover_previous_year: 900000, avg_monthly_turnover: 83333,
      financial_year_latest: 'FY 2024-25', financial_year_previous: 'FY 2023-24',
      created_by_user_id: user.id, created_at: daysAgo(200),
    },
  });
  const gstNotDue = await prisma.gstrAnalyticsRequest.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id, applicant_id: applicant.id,
      mode: 'IN_SYSTEM', gstin: `${MARKER.slice(0, 14)}Z`.toUpperCase(), from_date: '2025-01-01', to_date: '2025-12-31',
      raw_fetch_data: { a: 1 }, created_by_user_id: user.id, created_at: daysAgo(10),
    },
  });

  const scratchRelPath = `${MARKER}/dummy-gst-report.pdf`;
  const scratchAbsPath = path.join(UPLOADS_ROOT, scratchRelPath);
  await fs.promises.mkdir(path.dirname(scratchAbsPath), { recursive: true });
  await fs.promises.writeFile(scratchAbsPath, 'dummy pdf content');

  const gstDoc = await prisma.document.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id,
      document_type: 'GST_REPORT_PDF', source_type: 'VENDOR_DOWNLOAD',
      storage_provider: 'LOCAL', storage_path: scratchRelPath,
      file_name: 'dummy-gst-report.pdf', mime_type: 'application/pdf', extension: 'pdf',
    },
  });
  created.documentIds.push(gstDoc.id);
  await prisma.gstrAnalyticsRequest.update({ where: { id: gstDue.id }, data: { gst_pdf_document_id: gstDoc.id } });

  const gstSummary = await prisma.gstFinancialYearSummary.create({
    data: {
      gst_request_id: gstDue.id, gstin: gstDue.gstin, financial_year: 'FY 2024-25',
      source: 'GSTR3B', turnover: 1000000, processing_version: 1,
    },
  });
  created.gstSummaryIds.push(gstSummary.id);

  // ---- itr_analytics_requests ----
  const itrDue = await prisma.itrAnalyticsRequest.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id, applicant_id: applicant.id,
      pan: `${MARKER.slice(0, 10)}F`.toUpperCase(),
      analytics_payload: { itr: 'data' }, net_profit_latest_year: 500000, gross_receipts_latest_year: 2000000,
      financial_year_latest: 'FY 2024-25', created_by_user_id: user.id, created_at: daysAgo(200),
    },
  });
  const itrNotDue = await prisma.itrAnalyticsRequest.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id, applicant_id: applicant.id,
      pan: `${MARKER.slice(0, 9)}FZ`.toUpperCase(),
      analytics_payload: { itr: 'data2' }, created_by_user_id: user.id, created_at: daysAgo(10),
    },
  });

  // ---- bank_statement_analysis_requests ----
  const bankDue = await prisma.bankStatementAnalysisRequest.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id, applicant_id: applicant.id,
      files_payload: { f: 1 }, raw_analyze_response: { g: 1 }, avg_bank_balance_latest_year: 150000,
      financial_year_latest: 'FY 2024-25', created_by_user_id: user.id, created_at: daysAgo(200),
    },
  });
  const bankNotDue = await prisma.bankStatementAnalysisRequest.create({
    data: {
      tenant_id: tenant.id, customer_id: customer.id, case_id: caseRow.id, applicant_id: applicant.id,
      files_payload: { f: 2 }, created_by_user_id: user.id, created_at: daysAgo(10),
    },
  });

  return {
    bureauDue, bureauNotDue, gstDue, gstNotDue, itrDue, itrNotDue, bankDue, bankNotDue,
    gstDoc, scratchAbsPath,
  };
}

test('data retention purge — end to end against real Postgres/Redis/disk', async (t) => {
  // The disposable Postgres DB is recreated per run (autoincrement IDs reset
  // to 1), but this Redis DB isn't — a leftover completed/failed job from a
  // prior run can share a jobId (e.g. "schedule-9") with this run's, and
  // BullMQ silently no-ops .add() for an existing terminal-state job. Flush
  // ONLY the isolated test DB (index 1, asserted below — never the shared
  // default DB 0 the real dev server's worker listens on) so each run starts
  // clean. redisConnection is guaranteed to be REDIS_URL's own DB via .env.test.
  assert.equal(redisConnection.options.db, 1, 'refusing to flush: expected the isolated test Redis DB (index 1), see .env.test REDIS_URL');
  await redisConnection.flushdb();

  fixture = await buildFixture();
  const rows = await seedDueAndNotDueRows();

  await t.test('reconcileRetentionSchedules backfills a schedule row per record with correct expiry', async () => {
    const result = await reconcileRetentionSchedules();
    assert.ok(Object.values(result).every((r) => r.inserted >= 1), `expected inserts in every table, got ${JSON.stringify(result)}`);

    const bureauSchedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bureau_verifications', record_id: rows.bureauDue.id },
    });
    assert.ok(bureauSchedule, 'schedule row should exist for the due bureau record');
    const expectedExpiry = new Date(rows.bureauDue.created_at.getTime() + RETENTION_DAYS * 86400000);
    assert.equal(bureauSchedule.expiry_date.getTime(), expectedExpiry.getTime());
    assert.equal(bureauSchedule.status, 'PENDING');
  });

  await t.test('enqueueDuePurges only claims and enqueues rows past expiry', async () => {
    const { enqueued } = await enqueueDuePurges();
    assert.ok(enqueued >= 4, `expected at least the 4 due dummy rows enqueued, got ${enqueued}`);

    const dueSchedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bureau_verifications', record_id: rows.bureauDue.id },
    });
    assert.equal(dueSchedule.status, 'QUEUED');

    const notDueSchedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bureau_verifications', record_id: rows.bureauNotDue.id },
    });
    assert.equal(notDueSchedule.status, 'PENDING', 'a 10-day-old record must never be enqueued');
  });

  await t.test('purgeRecord nulls sensitive fields, keeps identity fields, writes a transactional audit trail', async () => {
    const schedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bureau_verifications', record_id: rows.bureauDue.id },
    });
    created.scheduleIds.push(schedule.id);

    await purgeRecord({
      scheduleId: schedule.id, sourceTable: 'bureau_verifications', recordId: rows.bureauDue.id,
      tenantId: fixture.tenant.id, customerId: fixture.customer.id,
    });

    const purged = await prisma.bureauVerification.findUnique({ where: { id: rows.bureauDue.id } });
    assert.equal(purged.raw_response, null);
    assert.equal(purged.score, null);
    assert.equal(purged.emi_obligations_total, null);
    // identity/evidence fields must survive
    assert.equal(purged.request_id, `${MARKER}-bureau-due`);
    assert.equal(purged.status, 'COMPLETED');

    const updatedSchedule = await prisma.dataRetentionSchedule.findUnique({ where: { id: schedule.id } });
    assert.equal(updatedSchedule.status, 'PURGED');
    assert.ok(updatedSchedule.purged_at);

    const auditLog = await prisma.purgeAuditLog.findFirst({ where: { retention_schedule_id: schedule.id } });
    created.auditLogIds.push(auditLog.id);
    assert.equal(auditLog.status, 'SUCCESS');
    assert.equal(auditLog.trigger_type, 'SCHEDULED');
    assert.deepEqual(new Set(auditLog.purged_fields), new Set(['raw_response', 'score', 'emi_obligations_total']));
  });

  await t.test('purgeRecord on GST record also deletes child financial-year summary and S3/local document', async () => {
    const schedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'gstr_analytics_requests', record_id: String(rows.gstDue.id) },
    });
    created.scheduleIds.push(schedule.id);

    assert.ok(fs.existsSync(rows.scratchAbsPath), 'scratch file must exist before purge');

    await purgeRecord({
      scheduleId: schedule.id, sourceTable: 'gstr_analytics_requests', recordId: rows.gstDue.id,
      tenantId: fixture.tenant.id, customerId: fixture.customer.id,
    });

    const purged = await prisma.gstrAnalyticsRequest.findUnique({ where: { id: rows.gstDue.id } });
    assert.equal(purged.raw_fetch_data, null);
    assert.equal(purged.callback_payload, null, 'callback_payload (the field the old job missed) must be nulled');
    assert.equal(purged.turnover_latest_year, null);
    assert.equal(purged.financial_year_latest, null);
    assert.equal(purged.gstin, rows.gstDue.gstin, 'gstin identity field must survive');

    const remainingSummaries = await prisma.gstFinancialYearSummary.findMany({ where: { gst_request_id: rows.gstDue.id } });
    assert.equal(remainingSummaries.length, 0, 'GstFinancialYearSummary child rows must be deleted');

    const doc = await prisma.document.findUnique({ where: { id: rows.gstDoc.id } });
    assert.equal(doc.status, 'DELETED');
    assert.ok(doc.deleted_at);
    assert.equal(fs.existsSync(rows.scratchAbsPath), false, 'the underlying file must actually be removed from disk');

    const auditLog = await prisma.purgeAuditLog.findFirst({ where: { retention_schedule_id: schedule.id } });
    created.auditLogIds.push(auditLog.id);
    assert.equal(auditLog.files_deleted, true);
  });

  await t.test('purgeRecord on ITR and bank records nulls derived income figures the old job left behind', async () => {
    const itrSchedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'itr_analytics_requests', record_id: String(rows.itrDue.id) },
    });
    created.scheduleIds.push(itrSchedule.id);
    await purgeRecord({
      scheduleId: itrSchedule.id, sourceTable: 'itr_analytics_requests', recordId: rows.itrDue.id,
      tenantId: fixture.tenant.id, customerId: fixture.customer.id,
    });
    const purgedItr = await prisma.itrAnalyticsRequest.findUnique({ where: { id: rows.itrDue.id } });
    assert.equal(purgedItr.net_profit_latest_year, null);
    assert.equal(purgedItr.gross_receipts_latest_year, null);
    assert.equal(purgedItr.analytics_payload, null);
    assert.equal(purgedItr.pan, rows.itrDue.pan);

    const bankSchedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bank_statement_analysis_requests', record_id: String(rows.bankDue.id) },
    });
    created.scheduleIds.push(bankSchedule.id);
    await purgeRecord({
      scheduleId: bankSchedule.id, sourceTable: 'bank_statement_analysis_requests', recordId: rows.bankDue.id,
      tenantId: fixture.tenant.id, customerId: fixture.customer.id,
    });
    const purgedBank = await prisma.bankStatementAnalysisRequest.findUnique({ where: { id: rows.bankDue.id } });
    assert.equal(purgedBank.avg_bank_balance_latest_year, null);
    assert.equal(purgedBank.files_payload, null);
  });

  await t.test('not-due records are untouched after all purge calls above', async () => {
    const bureau = await prisma.bureauVerification.findUnique({ where: { id: rows.bureauNotDue.id } });
    assert.notEqual(bureau.raw_response, null);
    assert.notEqual(bureau.score, null);
  });

  await t.test('real BullMQ worker end-to-end: enqueue -> process -> Postgres reflects PURGED', async (t) => {
    const endToEndBureau = await prisma.bureauVerification.create({
      data: {
        case_id: fixture.case.id, applicant_id: fixture.applicant.id, applicant_type: 'PRIMARY',
        request_id: `${MARKER}-bureau-e2e`, stan: '000003', mobile_number: '9000000002',
        score: '650', raw_response: { e2e: true }, status: 'COMPLETED', created_at: daysAgo(200),
      },
    });
    await reconcileRetentionSchedules();
    const schedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bureau_verifications', record_id: endToEndBureau.id },
    });
    created.scheduleIds.push(schedule.id);

    const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redisConnection });
    await queueEvents.waitUntilReady();
    const worker = new Worker(QUEUE_NAME, async (job) => purgeRecord(job.data), { connection: redisConnection, concurrency: 1 });
    await worker.waitUntilReady();

    try {
      await enqueueDuePurges();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('worker did not complete job in time')), 15000);
        queueEvents.on('completed', ({ jobId }) => {
          if (jobId === `schedule-${schedule.id}`) { clearTimeout(timer); resolve(); }
        });
        queueEvents.on('failed', ({ jobId, failedReason }) => {
          if (jobId === `schedule-${schedule.id}`) { clearTimeout(timer); reject(new Error(failedReason)); }
        });
      });
    } finally {
      await worker.close();
      await queueEvents.close();
    }

    const purged = await prisma.bureauVerification.findUnique({ where: { id: endToEndBureau.id } });
    assert.equal(purged.raw_response, null);
    const updatedSchedule = await prisma.dataRetentionSchedule.findUnique({ where: { id: schedule.id } });
    assert.equal(updatedSchedule.status, 'PURGED');
  });

  await t.test('manualPurgeCase: SUPER_ADMIN-triggered early purge on a fresh case, recorded distinctly from scheduled purges', async () => {
    const manualCustomer = await prisma.customer.create({
      data: {
        tenant_id: fixture.tenant.id, business_pan: `${MARKER.slice(0, 9)}MF`.toUpperCase(),
        business_name: `${MARKER}-biz`, business_email: `${MARKER.toLowerCase()}@example.test`,
        created_by_user_id: fixture.user.id,
      },
    });
    const manualCase = await prisma.case.create({
      data: { tenant_id: fixture.tenant.id, customer_id: manualCustomer.id, created_by_user_id: fixture.user.id },
    });
    // Only 5 days old — well within the 179-day window, simulating an early/manual erasure request.
    const manualBank = await prisma.bankStatementAnalysisRequest.create({
      data: {
        tenant_id: fixture.tenant.id, customer_id: manualCustomer.id, case_id: manualCase.id,
        files_payload: { manual: true }, avg_bank_balance_latest_year: 99999,
        created_by_user_id: fixture.user.id, created_at: daysAgo(5),
      },
    });

    const result = await manualPurgeCase({
      caseId: manualCase.id, triggeredByUserId: fixture.adminUser.id, reason: 'Customer requested early erasure (test)',
    });
    assert.equal(result.purgedCount, 1);
    assert.equal(result.alreadyPurgedCount, 0);

    const purgedBank = await prisma.bankStatementAnalysisRequest.findUnique({ where: { id: manualBank.id } });
    assert.equal(purgedBank.avg_bank_balance_latest_year, null);
    assert.equal(purgedBank.files_payload, null);

    const auditLog = await prisma.purgeAuditLog.findFirst({
      where: { table_name: 'bank_statement_analysis_requests', record_id: String(manualBank.id) },
    });
    created.auditLogIds.push(auditLog.id);
    assert.equal(auditLog.trigger_type, 'MANUAL');
    assert.equal(auditLog.triggered_by_user_id, fixture.adminUser.id);
    assert.equal(auditLog.reason, 'Customer requested early erasure (test)');

    // Re-running the manual purge on the same (already-purged) case must be
    // reported as already-purged, not re-processed / not a duplicate audit entry.
    const secondResult = await manualPurgeCase({
      caseId: manualCase.id, triggeredByUserId: fixture.adminUser.id, reason: 'duplicate request (test)',
    });
    assert.equal(secondResult.purgedCount, 0);
    assert.equal(secondResult.alreadyPurgedCount, 1);

    const status = await getCasePurgeStatus(manualCase.id);
    assert.equal(status.schedules.length, 1);
    assert.equal(status.schedules[0].status, 'PURGED');

    created.scheduleIds.push(status.schedules[0].id);
    await prisma.bankStatementAnalysisRequest.delete({ where: { id: manualBank.id } }).catch(() => {});
    await prisma.case.delete({ where: { id: manualCase.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: manualCustomer.id } }).catch(() => {});
  });

  await t.test('case-fully-purged notification: sets Case.data_purged_at once and permanently locks the case', async () => {
    const notifyCustomer = await prisma.customer.create({
      data: {
        tenant_id: fixture.tenant.id, business_pan: `${MARKER.slice(0, 8)}NF`.toUpperCase(),
        business_name: `${MARKER}-notify-biz`, business_email: `${MARKER.toLowerCase()}-notify@example.test`,
        created_by_user_id: fixture.user.id,
      },
    });
    const notifyCase = await prisma.case.create({
      data: { tenant_id: fixture.tenant.id, customer_id: notifyCustomer.id, created_by_user_id: fixture.user.id, stage: 'DRAFT' },
    });
    const notifyBank = await prisma.bankStatementAnalysisRequest.create({
      data: {
        tenant_id: fixture.tenant.id, customer_id: notifyCustomer.id, case_id: notifyCase.id,
        files_payload: { x: 1 }, created_by_user_id: fixture.user.id, created_at: daysAgo(200),
      },
    });

    await reconcileRetentionSchedules();
    const schedule = await prisma.dataRetentionSchedule.findFirst({
      where: { source_table: 'bank_statement_analysis_requests', record_id: String(notifyBank.id) },
    });
    created.scheduleIds.push(schedule.id);

    // This is the case's only purge-eligible record, so purging it should
    // trip maybeNotifyCasePurged (case.service.js's updateStage import below
    // then verifies the resulting lock).
    await purgeRecord({
      scheduleId: schedule.id, sourceTable: 'bank_statement_analysis_requests', recordId: notifyBank.id,
      tenantId: fixture.tenant.id, customerId: notifyCustomer.id,
    });

    const purgedCase = await prisma.case.findUnique({ where: { id: notifyCase.id } });
    assert.ok(purgedCase.data_purged_at, 'Case.data_purged_at should be set once its last record is purged');

    await assert.rejects(
      () => updateStage(notifyCase.id, fixture.tenant.id, 'LEAD_CREATED', fixture.user.id),
      /permanently purged/,
      'updateStage must refuse to move a purged case to any new stage',
    );

    await prisma.bankStatementAnalysisRequest.delete({ where: { id: notifyBank.id } }).catch(() => {});
    await prisma.case.delete({ where: { id: notifyCase.id } }).catch(() => {});
    await prisma.customer.delete({ where: { id: notifyCustomer.id } }).catch(() => {});
  });
});

test.after(async () => {
  // Best-effort teardown of everything tagged with MARKER, in FK-safe order.
  await prisma.purgeAuditLog.deleteMany({ where: { id: { in: created.auditLogIds } } }).catch(() => {});
  await prisma.dataRetentionSchedule.deleteMany({ where: { id: { in: created.scheduleIds } } }).catch(() => {});
  await prisma.dataRetentionSchedule.deleteMany({ where: { case_id: fixture?.case?.id } }).catch(() => {});
  await prisma.purgeAuditLog.deleteMany({ where: { customer_id: fixture?.customer?.id } }).catch(() => {});
  await prisma.gstFinancialYearSummary.deleteMany({ where: { id: { in: created.gstSummaryIds } } }).catch(() => {});
  await prisma.document.deleteMany({ where: { id: { in: created.documentIds } } }).catch(() => {});
  if (fixture?.case?.id) {
    await prisma.bureauVerification.deleteMany({ where: { case_id: fixture.case.id } }).catch(() => {});
    await prisma.gstrAnalyticsRequest.deleteMany({ where: { case_id: fixture.case.id } }).catch(() => {});
    await prisma.itrAnalyticsRequest.deleteMany({ where: { case_id: fixture.case.id } }).catch(() => {});
    await prisma.bankStatementAnalysisRequest.deleteMany({ where: { case_id: fixture.case.id } }).catch(() => {});
    await prisma.applicant.deleteMany({ where: { case_id: fixture.case.id } }).catch(() => {});
    await prisma.case.delete({ where: { id: fixture.case.id } }).catch(() => {});
  }
  if (fixture?.customer?.id) await prisma.customer.delete({ where: { id: fixture.customer.id } }).catch(() => {});
  if (fixture?.user?.id) await prisma.user.delete({ where: { id: fixture.user.id } }).catch(() => {});
  if (fixture?.adminUser?.id) await prisma.user.delete({ where: { id: fixture.adminUser.id } }).catch(() => {});
  if (fixture?.tenant?.id) await prisma.tenant.delete({ where: { id: fixture.tenant.id } }).catch(() => {});

  await fs.promises.rm(path.join(UPLOADS_ROOT, MARKER), { recursive: true, force: true }).catch(() => {});

  await purgeQueue.close();
  await prisma.$disconnect();
  // Both connections: purgeQueue was constructed with queueConnection (see
  // config/redis.js), which BullMQ does not close itself since it didn't
  // create it — leaving it open is exactly what kept this process alive
  // after all tests passed.
  await redisConnection.quit();
  await queueConnection.quit();
});
