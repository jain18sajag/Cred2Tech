const IORedis = require('ioredis');

function createConnection(extra = {}) {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    // Hard BullMQ requirement (its blocking connection commands need it),
    // not optional tuning — do not remove.
    maxRetriesPerRequest: null,
    ...extra,
  });
  connection.on('error', (err) => {
    console.error('[redis] connection error:', err.message);
  });
  return connection;
}

// Default connection — NO commandTimeout. Required for the BullMQ Worker
// (purge.worker.js), which legitimately issues long-lived blocking read
// commands as part of normal job processing; a commandTimeout here would
// fire on those by design and break the worker's ability to pick up jobs
// at all, not just protect against a genuinely dead Redis.
const connection = createConnection();

// Separate connection for the Queue side only (purgeQueue.js's .add() calls,
// which never block by design) — safe to bound with a commandTimeout so
// enqueueing fails fast instead of hanging indefinitely when Redis is
// unreachable (e.g. not yet provisioned on a freshly deployed server).
// dataRetentionPurge.service.js's enqueueDuePurges() relies on this: it
// needs .add() to reject within a bounded time so it can revert a schedule
// row's optimistic QUEUED claim back to PENDING for the next sweep to retry,
// instead of the whole sweep hanging.
const queueConnection = createConnection({ commandTimeout: 10000 });

module.exports = connection;
module.exports.queueConnection = queueConnection;
