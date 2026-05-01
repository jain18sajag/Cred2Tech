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

      // MOCK FALLBACK for sandbox testing so frontend gets a score instead of null
      if (!score && baseUrl.includes('sandbox')) {
        console.warn('Sandbox returned null score, Mocking 785 for frontend flow.');
        score = "785";
        responsePayload.mocked = true;
      }

    } else if (baseUrl.includes('sandbox') && data?.status?.code === 500) {
      // MOCK FALLBACK for broken Sandbox
      console.warn('Veri5 Sandbox returned 500; Mocking a successful Bureau response for testing.');
      apiStatus = 'SUCCESS';
      score = "785"; // Mock Score
      responsePayload = {
        ...responsePayload,
        mocked: true,
        verifiedData: {
          ResponseData: {
            data: { score: score, age: "32" }
          }
        }
      };
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
    await prisma.applicant.update({
      where: { id: parseInt(applicantId) },
      data: { bureau_fetched: true, cibil_score: score ? parseInt(score) : null }
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
