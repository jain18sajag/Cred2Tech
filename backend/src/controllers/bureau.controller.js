const bureauService = require('../services/externalApis/bureau.service');
const experianService = require('../services/externalApis/experian.service');
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
         const panNumber = applicant.pan_number || caseRecord.customer.business_pan || '';
         let mobile = applicant.mobile;

         // If applicant mobile is missing or looks like a PAN, fallback to business mobile
         if (!mobile || /[a-zA-Z]/.test(mobile)) {
            mobile = caseRecord.customer.business_mobile;
         }

         // Final fallback if both are missing or corrupted
         if (!mobile || /[a-zA-Z]/.test(mobile)) {
            mobile = '9999999999';
         }

         // Fetch intelligence from PAN profile if available
         let panProfile = null;
         if (panNumber) {
            panProfile = await prisma.customerPanProfile.findFirst({
               where: { pan: panNumber }
            });
         }

         const fullName = applicant.name
            || panProfile?.legal_name
            || (applicant.type === 'PRIMARY' ? caseRecord.customer.business_name : '');

         const nameParts = fullName?.trim().split(/\s+/).filter(Boolean) || [];
         let firstName = nameParts[0] || (applicant.type === 'PRIMARY' ? 'Unknown' : 'CoApplicant');
         let lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'User';

         console.log(`[Bureau Pull] Triggering for applicant ${applicant.id}:`, {
            fullName,
            firstName,
            lastName,
            mobile,
            pan: panNumber
         });

         const payload = {
            caseId: caseId,
            applicantId: applicant.id,
            mobileNumber: mobile,
            panNumber: panNumber,
            firstName,
            lastName,
            applicantType: applicant.type
         };

         let dobRaw = applicant.dob || panProfile?.dob || caseRecord.customer.dob;
         let formattedDob = '1990-01-01'; // Fallback
         if (dobRaw) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(dobRaw)) {
                formattedDob = dobRaw;
            } else {
               const parsedDate = new Date(dobRaw);
               if (!isNaN(parsedDate.getTime())) {
                  formattedDob = parsedDate.toISOString().split('T')[0];
               }
            }
         }

         const experianPayload = {
            phoneNumber: mobile,
            pan: panNumber,
            firstName,
            lastName,
            dateOfBirth: formattedDob,
            pincode: applicant.pincode || panProfile?.principal_pincode || '560026'
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
               userRole: req.user.role,
               handlerFunction: async () => {
                  return await bureauService.runBureauCheck(payload);
               }
            });

            // Immediately trigger Experian to get obligations
            // Not running through wallet as it might not be configured as a paid API yet, or we want it silently alongside
            await experianService.runExperianCheck({
               caseId: caseId,
               applicantId: applicant.id,
               payloadData: experianPayload
            });

            successCount++;
            
            // Sync the DB state regardless of whether this was a live pull or a cached response
            await prisma.applicant.update({
               where: { id: applicant.id },
               data: { 
                  bureau_fetched: true, 
                  cibil_score: response.score ? parseInt(response.score, 10) : null 
               }
            });

            if (applicant.type === 'PRIMARY') {
               results.applicantScore = response.score;
            } else {
               results.coApplicantScores.push({ applicantId: applicant.id, score: response.score });
            }
         } catch (e) {
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
