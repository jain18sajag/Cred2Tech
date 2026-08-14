/**
 * BullMQ worker processing individual data-retention purge jobs. One job =
 * one record from one of the 4 purge-eligible tables (see
 * services/purge/dataRetentionPurge.service.js for the actual purge logic —
 * this file is queue wiring only).
 */

const { Worker } = require('bullmq');
const connection = require('../config/redis');
const { QUEUE_NAME } = require('../queues/purgeQueue');
const { purgeRecord } = require('../services/purge/dataRetentionPurge.service');

let worker;

function initPurgeWorker() {
  if (worker) return worker;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => purgeRecord(job.data),
    { connection, concurrency: 5 },
  );

  worker.on('completed', (job) => {
    console.log(`[purge-worker] completed schedule=${job.data.scheduleId} table=${job.data.sourceTable} record=${job.data.recordId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[purge-worker] failed schedule=${job?.data?.scheduleId} table=${job?.data?.sourceTable} record=${job?.data?.recordId}: ${err.message}`);
  });

  console.log('[purge-worker] initialized, concurrency=5');
  return worker;
}

module.exports = { initPurgeWorker };
