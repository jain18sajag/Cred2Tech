const bureauService = require('../services/externalApis/bureau.service');
const walletService = require('../services/wallet.service');
const prisma = require('../../config/db');

async function runBureauVerification(req, res) {
  try {
     const caseId = parseInt(req.params.caseId, 10);
     const tenantId = req.user.tenant_id;
     const { applicantId } = req.body;
     
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
        coApplicantScores: [],
        errors: []
     };

     // Filter applicants if applicantId is provided
     const applicantsToVerify = applicantId 
        ? caseRecord.applicants.filter(a => a.id === parseInt(applicantId, 10))
        : caseRecord.applicants;

     if (applicantsToVerify.length === 0 && applicantId) {
        return res.status(400).json({ error: 'Requested applicant not found in this case.' });
     }

     let successCount = 0;

     for (const applicant of applicantsToVerify) {
         let firstName = applicant.type === 'PRIMARY' ? caseRecord.customer.business_name?.split(' ')[0] || 'Unknown' : 'CoApplicant';
         let lastName = applicant.type === 'PRIMARY' ? caseRecord.customer.business_name?.split(' ').slice(1).join(' ') || 'User' : 'User';
         const mobile = applicant.mobile || caseRecord.customer.business_mobile || '9999999999';
         const panNumber = applicant.pan_number || caseRecord.customer.business_pan || '';

         const payload = {
             caseId: caseId,
             applicantId: applicant.id,
             mobileNumber: mobile,
             panNumber: panNumber,
             firstName,
             lastName,
             applicantType: applicant.type
         };

         try {
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

             successCount++;
             if (applicant.type === 'PRIMARY') {
                results.applicantScore = response.score;
             } else {
                results.coApplicantScores.push({ applicantId: applicant.id, score: response.score });
             }
         } catch(e) {
             console.error(`Bureau failed for applicant ${applicant.id}:`, e.message);
             results.errors.push({ applicantId: applicant.id, error: e.message });
         }
     }

     // Only mark COMPLETE if at least one applicant was processed
     if (successCount > 0) {
        await prisma.caseDataPullStatus.upsert({
           where: { case_id: caseId },
           update: { bureau_status: 'COMPLETE' },
           create: { case_id: caseId, bureau_status: 'COMPLETE' }
        });
     }

     // Return PARTIAL_FAILURE if some failed, SUCCESS only if all ran
     const overallStatus = results.errors.length === 0 ? 'SUCCESS' 
        : successCount === 0 ? 'FAILED' 
        : 'PARTIAL_SUCCESS';

     res.json({ status: overallStatus, ...results });
  } catch (error) {
     console.error(error);
     res.status(500).json({ error: error.message || 'Failed to execute Bureau Verification' });
  }
}

module.exports = {
  runBureauVerification
};
