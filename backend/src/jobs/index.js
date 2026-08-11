const { registerPurgeSchedulerJob } = require('./purgeScheduler');
const { initPurgeWorker } = require('../workers/purge.worker');

function initJobs() {
  console.log('Initializing scheduled cron jobs...');

  registerPurgeSchedulerJob();
  initPurgeWorker();

  console.log('Scheduled cron jobs initialized.');
}

module.exports = {
  initJobs
};
