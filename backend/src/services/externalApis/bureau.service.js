const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../../../config/db');

/**
 * Runs Veri5 Digital Credit Score Check for an applicant / co-applicant
 */
async function runBureauCheck({ caseId, applicantId, mobileNumber, firstName, lastName, applicantType }) {
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
    sourceEntityType: "ET11",
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

  let responsePayload = null;
  let apiStatus = 'PENDING';
  let score = null;

  try {
    const { data } = await axios.post(`${baseUrl}/verification-service/verifyID`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000 // 30-second timeout — fail fast instead of hanging indefinitely
    });

    responsePayload = data;

    if (data && data.responseCode === '000' || data.status === 'SUCCESS') {
      apiStatus = 'SUCCESS';

      // Map to structured format extracting score
      // Assuming response structure: data.verifiedData.ResponseData.data.score based on requirements
      if (data.verifiedData && data.verifiedData.ResponseData && data.verifiedData.ResponseData.data) {
        score = data.verifiedData.ResponseData.data.score?.toString() || null;
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
