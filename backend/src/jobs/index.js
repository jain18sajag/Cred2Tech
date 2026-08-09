const cron = require('node-cron');
const purgeConfidentialData = require('./purgeConfidentialData');

function initJobs() {
  console.log('Initializing scheduled cron jobs...');

  // Run the data purge job every day at midnight server time (0 0 * * *)
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Running daily purgeConfidentialData job...');
    await purgeConfidentialData();
  });

  console.log('Scheduled cron jobs initialized.');
}

module.exports = {
  initJobs
};
