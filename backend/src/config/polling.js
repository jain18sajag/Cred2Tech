/**
 * Configuration for Data Pull Background Polling and Reconciliation
 */

module.exports = {
    // Feature flags
    ENABLE_AUTOMATED_PULL_TRACKING: process.env.ENABLE_AUTOMATED_PULL_TRACKING === 'true',
    ENABLE_PULL_STATUS_SSE: process.env.ENABLE_PULL_STATUS_SSE === 'true',
    BANK_CALLBACK_ENABLED: process.env.BANK_CALLBACK_ENABLED === 'true',

    // Worker scheduling
    PULL_WORKER_INTERVAL_SECONDS: parseInt(process.env.PULL_WORKER_INTERVAL_SECONDS || '60', 10),
    PULL_WORKER_BATCH_SIZE: parseInt(process.env.PULL_WORKER_BATCH_SIZE || '10', 10),
    PULL_JOB_LEASE_SECONDS: parseInt(process.env.PULL_JOB_LEASE_SECONDS || '300', 10), // 5 minutes

    // Integration specific configurations (Delays in minutes)
    ITR: {
        VENDOR_POLL_DELAYS_MINUTES: [2, 5, 15, 30, 60],
        MAX_VENDOR_POLLS: 5,
        PROCESSING_DEADLINE_MINUTES: 120
    },
    GST: {
        RECONCILIATION_DELAYS_MINUTES: [15, 30, 60],
        MAX_RECONCILIATION_POLLS: 3,
        PROCESSING_DEADLINE_MINUTES: 120
    },
    BANK: {
        RECONCILIATION_DELAYS_MINUTES: [15, 30, 60],
        MAX_RECONCILIATION_POLLS: 3,
        PROCESSING_DEADLINE_MINUTES: 120
    }
};
