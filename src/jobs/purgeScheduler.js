/**
 * Data retention purge scheduler — runs once daily at exactly 1:00 AM, PLUS
 * once immediately on process startup. Thin cron wiring only; all business
 * logic lives in services/purge/dataRetentionPurge.service.js.
 *
 * Two steps per sweep:
 *  1. reconcileRetentionSchedules() — backfill schedule rows for any source
 *     record that doesn't have one yet. This is what makes a fresh
 *     deployment (new server, restored/migrated database) safe with zero
 *     manual setup: it derives every schedule row from each source record's
 *     own created_at, so pre-existing data — however old — picks up exactly
 *     where its real 179-day countdown already was, not from "when this
 *     server booted." Nothing is skipped and nothing purges early.
 *  2. enqueueDuePurges() — find schedule rows past expiry and hand them to
 *     the BullMQ queue (purge.worker.js does the actual per-record work),
 *     so this trigger itself stays fast and never blocks on the purge
 *     work itself.
 */

const cron = require('node-cron');
const { reconcileRetentionSchedules, enqueueDuePurges } = require('../services/purge/dataRetentionPurge.service');

async function runPurgeSweep(trigger) {
  console.log(`[purge-scheduler] Running data retention purge sweep (${trigger})...`);
  try {
    const reconciled = await reconcileRetentionSchedules();
    console.log('[purge-scheduler] Retention schedule reconciliation:', JSON.stringify(reconciled));
    const { enqueued } = await enqueueDuePurges();
    console.log(`[purge-scheduler] Enqueued ${enqueued} due purge job(s).`);
  } catch (err) {
    // Never crash the process over this — a transient DB/Redis hiccup at
    // boot or on a cron tick just gets picked up on the next sweep. No
    // record's window is missed by a failed sweep: enqueueDuePurges only
    // ever selects on `expiry_date <= now()`, unconditionally, so a sweep
    // that failed to run simply leaves overdue rows PENDING for the next
    // one to pick up — nothing is silently skipped or lost.
    console.error(`[purge-scheduler] Sweep (${trigger}) failed:`, err.message);
  }
}

function registerPurgeSchedulerJob() {
  // Exactly 1:00 AM daily. PM2 runs this backend at instances:1 today, so no
  // leader-election is needed for this trigger; if that ever changes, the
  // optimistic PENDING->QUEUED claim in enqueueDuePurges() plus BullMQ's
  // per-schedule-row jobId already neutralize a double cron-fire.
  cron.schedule('0 1 * * *', () => runPurgeSweep('1AM cron'));

  // Also run once immediately on process start — not just at the next 1AM
  // tick — so a freshly deployed server, or one restarting after downtime,
  // starts tracking/enqueueing overdue records right away instead of
  // waiting up to 24h. Fire-and-forget: server startup must never block on
  // this, and a failure here is caught inside runPurgeSweep and simply
  // retried at the next cron tick.
  runPurgeSweep('startup');
}

module.exports = { registerPurgeSchedulerJob, runPurgeSweep };
