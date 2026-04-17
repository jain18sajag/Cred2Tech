const bureauService = require('../services/externalApis/bureau.service');
const walletService = require('../services/wallet.service');
const prisma = require('../../config/db');

async function runBureauVerification(req, res) {
  try {
     const caseId = parseInt(req.params.caseId, 10);
     const tenantId = req.user.tenant_id;
     
     const caseRecord = await prisma.case.findUnique({
        where: { id: caseId },
        include: { applicants: true, customer: true }
     });

     if (!caseRecord) return res.status(404).json({ error: 'Case not found' });
     if (req.user.role.name !== 'SUPER_ADMIN' && caseRecord.tenant_id !== tenantId) {
        return res.status(403).json({ error: 'Forbidden' });
     }

     const results = {
        caseId: caseId,
        applicantScore: null,
        coApplicantScores: []
     };

     for (const applicant of caseRecord.applicants) {
         let firstName = applicant.type === 'PRIMARY' ? caseRecord.customer.business_name?.split(' ')[0] || 'Unknown' : 'CoApplicant';
         let lastName = applicant.type === 'PRIMARY' ? caseRecord.customer.business_name?.split(' ').slice(1).join(' ') || 'User' : 'User';
         const mobile = applicant.mobile || caseRecord.customer.business_mobile || '9999999999';

         const payload = {
             caseId: caseId,
             applicantId: applicant.id,
             mobileNumber: mobile,
             firstName,
             lastName,
             applicantType: applicant.type
         };

         try {
             // Wallet integration: Deduct credits per applicant and log transaction safely.
             const response = await walletService.executePaidApi({
                apiCode: 'BUREAU_PULL',
                tenantId: tenantId,
                userId: req.user.id,
                customerId: caseRecord.customer_id,
                caseId: caseId,
                idempotencyKey: `bureau_case_${caseId}_app_${applicant.id}`,
                requestPayload: payload,
                handlerFunction: async () => {
                   return await bureauService.runBureauCheck(payload);
                }
             });

             if (applicant.type === 'PRIMARY') {
                results.applicantScore = response.score;
             } else {
                results.coApplicantScores.push({ applicantId: applicant.id, score: response.score });
             }
         } catch(e) {
             console.error(`Bureau failed for applicant ${applicant.id}:`, e.message);
             // Optionally fail the entire array, but usually we just skip or log
         }
     }

     await prisma.caseDataPullStatus.upsert({
         where: { case_id: caseId },
         update: { bureau_status: 'COMPLETE' },
         create: { case_id: caseId, bureau_status: 'COMPLETE' }
     });

     res.json({ status: 'SUCCESS', ...results });
  } catch (error) {
     console.error(error);
     res.status(500).json({ error: error.message || 'Failed to execute Bureau Verification' });
  }
}

module.exports = {
  runBureauVerification
};
