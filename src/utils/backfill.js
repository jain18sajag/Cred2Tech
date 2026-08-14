const prisma = require('../../config/db');

async function runSafeBackfill() {
  try {
    console.log('[Backfill] Running safe backfill policy for existing records...');
    
    // Backfill Applicant table: if name, dob, and pan_number exist, set pan_verified to true
    const updatedApplicants = await prisma.applicant.updateMany({
      where: {
        pan_verified: false,
        NOT: [
          { name: null },
          { name: "" },
          { dob: null },
          { dob: "" },
          { pan_number: null },
          { pan_number: "" }
        ]
      },
      data: {
        pan_verified: true,
        pan_verification_status: 'SUCCESS'
      }
    });

    console.log(`[Backfill] Successfully backfilled ${updatedApplicants.count} applicants.`);
  } catch (err) {
    console.error('[Backfill] Safe backfill error:', err);
  }
}

module.exports = { runSafeBackfill };
