const { Queue } = require('bullmq');
// The Queue side never issues blocking commands, so it's safe (and
// important — see config/redis.js) to use the bounded-commandTimeout
// connection here rather than the default one shared with the Worker.
const { queueConnection: connection } = require('../config/redis');

const QUEUE_NAME = 'data-retention-purge';

// removeOnFail: false is deliberate — failed jobs stay visible in Redis for
// operator triage, but Redis/BullMQ job history is NOT the durable compliance
// record on its own. DataRetentionSchedule.status + PurgeAuditLog (Postgres)
// are the actual evidence trail; both are written synchronously inside the
// worker before a job is considered done or failed (see purge.worker.js).
const purgeQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: false,
  },
});

module.exports = { purgeQueue, QUEUE_NAME };
