// Shared guard for the "once a case's data has been purged, it's permanently
// read-only" rule. Case.data_purged_at is set once by
// src/services/purge/dataRetentionPurge.service.js's maybeNotifyCasePurged
// (nightly job and manual admin purge both funnel through it) and never
// unset — mirrors the error case.service.js's updateStage() already throws,
// so every enforcement point in the app is consistent.
function assertCaseNotPurged(caseRecord) {
  if (caseRecord?.data_purged_at) {
    throw Object.assign(
      new Error('This case’s data has been permanently purged per data retention policy and can no longer be modified.'),
      { status: 403 },
    );
  }
}

module.exports = { assertCaseNotPurged };
