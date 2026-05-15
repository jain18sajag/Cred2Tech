const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../../../config/db');

/**
 * Runs Veri5 Digital Credit Score Check for an applicant / co-applicant
 */
async function runBureauCheck({ caseId, applicantId, mobileNumber, firstName, lastName, panNumber, applicantType }) {
  const userId = process.env.VERI5_USER_ID;
  const clientCode = process.env.VERI5_CLIENT_CODE;
  const apiKey = process.env.VERI5_API_KEY;
  const salt = process.env.VERI5_SALT;
  const baseUrl = process.env.VERI5_BASE_URL || 'https://sandbox.veri5digital.com';

  if (!userId || !clientCode || !apiKey || !salt) {
    throw new Error("Veri5 Digital environment variables are missing");
  }

  // Idempotency Check: Prevent duplicate scores for the exact same applicant within the system
  const existingCheck = await prisma.bureauVerification.findFirst({
    where: {
      case_id: parseInt(caseId),
      applicant_id: parseInt(applicantId),
      status: 'SUCCESS'
    }
  });

  if (existingCheck && existingCheck.score) {
    return {
      status: 'CACHED',
      score: existingCheck.score,
      message: 'Bureau already fetched successfully'
    };
  }

  const requestId = crypto.randomUUID();
  const stan = crypto.randomUUID();

  // Hash Generation: SHA256(clientCode|requestId|APIKey|Salt)
  const rawString = `${clientCode}|${requestId}|${apiKey}|${salt}`;
  const hash = crypto.createHash('sha256').update(rawString).digest('hex');

  const payload = {
    sourceEntityType: "IT_SERVICE",
    verificationType: "CREDIT_SCORE_CHECK",
    userId: userId,
    clientCode: clientCode,
    requestId: requestId,
    stan: stan,
    hash: hash,
    toBeVerifiedData: {
      mobileNumber: mobileNumber,
      firstName: firstName,
      lastName: lastName,
      consentPurpose: "Pull data for user onboarding"
    }
  };

  // Only inject panNumber for Production Live endpoints, because the Veri5 Sandbox 
  // rigidly crashes with HTTP 500 when un-mocked PANs are probed.
  if (panNumber && !baseUrl.includes('sandbox')) {
    payload.toBeVerifiedData.panNumber = panNumber;
  }

  let responsePayload = null;
  let apiStatus = 'PENDING';
  let score = null;

  try {
    const { data } = await axios.post(`${baseUrl}/verification-service/verifyID`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000 // 30-second timeout — fail fast instead of hanging indefinitely
    });

    responsePayload = data;

    // Check robustly for both Sandbox (code 200) and Live (isSuccess/result.status)
    if (data?.status?.isSuccess || data?.status?.code === 200 || data?.result?.status === 'SUCCESS') {
      apiStatus = 'SUCCESS';

      // Map to structured format extracting score
      // Note from Live payload: verifiedData is inside data.result
      const vData = data?.result?.verifiedData;

      if (vData && vData.ResponseData && vData.ResponseData.data) {
        score = vData.ResponseData.data.score?.toString() || null;
      }

    } else {
      apiStatus = 'FAILED';
    }
  } catch (error) {
    apiStatus = 'FAILED';
    const is504 = error.response?.status === 504 || error.code === 'ECONNABORTED';
    responsePayload = {
      message: is504
        ? 'Bureau provider gateway timed out (504). The Veri5 sandbox may be slow or your IP may need whitelisting.'
        : error.message,
      data: error.response?.data,
      status: error.response?.status
    };
  }

  // 1. Audit Logging Native (Logs ALL traces regardless of crash)
  await prisma.bureauVerificationLog.create({
    data: {
      case_id: parseInt(caseId),
      applicant_id: parseInt(applicantId),
      request_payload: payload,
      response_payload: responsePayload || {},
      status: apiStatus
    }
  });

  // 2. Structured Verification Data Point
  const verificationRecord = await prisma.bureauVerification.create({
    data: {
      case_id: parseInt(caseId),
      applicant_id: parseInt(applicantId),
      applicant_type: applicantType,
      request_id: requestId,
      stan: stan,
      mobile_number: mobileNumber,
      score: score,
      raw_response: responsePayload || {},
      status: apiStatus
    }
  });

  // 3. Mark Applicant Native Boolean Flag if SUCCESS
  if (apiStatus === 'SUCCESS') {
    const scoreVal = score ? parseInt(score) : null;

    // Use a transaction to ensure both Applicant and Case (if primary) are updated
    await prisma.$transaction(async (tx) => {
      // Update Applicant
      const updatedApplicant = await tx.applicant.update({
        where: { id: parseInt(applicantId) },
        data: { bureau_fetched: true, cibil_score: scoreVal }
      });

      // SYNC RULE: If this is the primary applicant, update the Case snapshot (ONLY if not in financial/locked stage)
      if (updatedApplicant.is_primary) {
        const caseRecord = await tx.case.findUnique({ where: { id: parseInt(caseId) } });
        const financialStages = ['DISBURSED', 'PARTLY_DISBURSED', 'CLOSED'];
        if (caseRecord && !financialStages.includes(caseRecord.stage)) {
          await tx.case.update({
            where: { id: parseInt(caseId) },
            data: { cibil_score: scoreVal }
          });
        }
      }
    });
  }

  if (apiStatus === 'FAILED') {
    throw new Error(responsePayload?.message || "Failed to execute Bureau Verification");
  }

  return verificationRecord;
}

module.exports = {
  runBureauCheck
};
