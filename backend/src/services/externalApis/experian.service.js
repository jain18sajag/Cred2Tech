const axios = require('axios');
const prisma = require('../../../config/db');
const { ingestFromUrl } = require('../document.service');
require('dotenv').config();

const SIGNZY_AUTH_TOKEN = process.env.SIGNZY_AUTH_TOKEN;
const EXPERIAN_API_URL = 'https://api-preproduction.signzy.app/api/v3/bureau/experian-report';

/**
 * Fetches Experian bureau obligations and saves them to CaseCreditObligation
 */
async function runExperianCheck({ caseId, applicantId, payloadData }) {
  try {
    const { phoneNumber, pan, firstName, lastName, dateOfBirth, pincode } = payloadData;

    // Default fallback pincode if missing, as required by the API
    const finalPincode = pincode || '560026';
    const parsedPhone = parseInt((phoneNumber || '').replace(/\D/g, ''), 10);
    const parsedPincode = parseInt(String(finalPincode).replace(/\D/g, ''), 10);

    const payload = {
      phoneNumber: parsedPhone,
      pan,
      firstName,
      lastName,
      dateOfBirth,
      pincode: parsedPincode,
      consent: {
        consentFlag: true,
        consentTimestamp: Math.floor(Date.now() / 1000),
        consentIpAddress: "0.0.0.0",
        consentMessageId: "CM_1"
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': SIGNZY_AUTH_TOKEN || ''
    };

    console.log(`[Experian Service] Fetching data for Applicant: ${applicantId}, Case: ${caseId}`);
    
    // 1. Fetch from Experian API
    let apiResponse;
    try {
      apiResponse = await axios.post(EXPERIAN_API_URL, payload, { headers });
    } catch (apiError) {
      console.error('[Experian Service] API call failed:', apiError.response?.data || apiError.message);
      // Log the failure but don't throw to prevent crashing the main flow
      await prisma.bureauVerificationLog.create({
        data: {
          case_id: caseId,
          applicant_id: applicantId,
          status: 'EXPERIAN_FAILED',
          request_payload: payload,
          response_payload: apiError.response?.data || { error: apiError.message }
        }
      });
      return { status: 'FAILED', error: apiError.message };
    }

    const responseData = apiResponse.data;

    // 2. Log successful request
    await prisma.bureauVerificationLog.create({
      data: {
        case_id: caseId,
        applicant_id: applicantId,
        status: 'EXPERIAN_SUCCESS',
        request_payload: payload,
        response_payload: responseData
      }
    });

    // 2.5 Extract and store Excel report if available
    const excelUrl = responseData?.data?.excelExperianReport;
    if (excelUrl) {
      try {
        const caseRecord = await prisma.case.findUnique({ where: { id: caseId } });
        if (caseRecord) {
          await ingestFromUrl({
            vendorUrl: excelUrl,
            documentType: 'OTHER',
            tenantId: caseRecord.tenant_id,
            caseId,
            applicantId,
            originalFileName: `Experian_Report_${pan}.xlsx`,
            metadata: { source: 'Experian_API' }
          });
          console.log(`[Experian Service] Excel report downloaded and saved for Applicant: ${applicantId}`);
        }
      } catch (err) {
        console.error('[Experian Service] Failed to save Excel report:', err.message);
      }
    }

    // 3. Extract obligations. Parsing + the DB write get their own try/catch,
    // separate from the outer one: the vendor call above already succeeded
    // and got logged, so a failure here is a distinct "we have the data but
    // couldn't save it" case that needs its own record — otherwise it's
    // indistinguishable from a vendor failure and impossible to diagnose
    // after the fact (this is exactly what was happening: Experian was
    // returning full reports every time, but every single parse/save was
    // silently throwing and discarding all obligations with no trace).
    try {
      const reportData = responseData?.data?.jsonExperianReport || responseData?.jsonExperianReport;
      const accounts = reportData?.CAIS_Account?.CAIS_Account_DETAILS || [];

      if (accounts.length === 0) {
        console.log(`[Experian Service] No obligations found for Applicant: ${applicantId}`);
        return { status: 'SUCCESS', message: 'No obligations found' };
      }

      console.log(`[Experian Service] Found ${accounts.length} accounts for Applicant: ${applicantId}. Processing...`);

      // Experian/Signzy send numeric fields inconsistently — sometimes a
      // number, sometimes a numeric string, sometimes a non-numeric
      // placeholder like "" or "N/A". parseFloat() on the latter yields NaN,
      // which Prisma rejects for the (NOT NULL) Float columns below and
      // fails the *entire* createMany batch — so one bad account was wiping
      // out all the good ones. Always fall back to a finite number.
      const safeFloat = (val) => {
        if (val === null || val === undefined || val === '') return 0;
        const n = parseFloat(val);
        return Number.isFinite(n) ? n : 0;
      };

      const parseExperianDate = (dateValue) => {
        // Date format is YYYYMMDD, but Experian sends it as a JS number, not
        // a string — dateValue.length on a number is always undefined, so
        // this always returned null previously. Coerce to string first.
        if (dateValue === null || dateValue === undefined || dateValue === '') return null;
        const s = String(dateValue);
        if (s.length !== 8) return null;
        const year = s.substring(0, 4);
        const month = s.substring(4, 6);
        const day = s.substring(6, 8);
        const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
        return isNaN(date.getTime()) ? null : date;
      };

      let totalEmi = 0;
      const obligations = [];

      for (const acc of accounts) {
        const loanAmount = safeFloat(acc.Highest_Credit_or_Original_Loan_Amount);
        const outstandingAmount = safeFloat(acc.Current_Balance);
        const emi = safeFloat(acc.Scheduled_Monthly_Payment_Amount);

        const isClosed = acc.accountStatusDescription?.toLowerCase?.().includes('closed') || outstandingAmount <= 0;

        // If it's an active loan but EMI is 0, we flag it for manual verification
        const needsVerification = !isClosed && emi === 0;

        if (!isClosed) {
          totalEmi += emi;
        }

        obligations.push({
          case_id: caseId,
          applicant_id: applicantId,
          lender_name: acc.Subscriber_Name || acc.Identification_Number || 'Unknown Lender',
          loan_type: acc.accountTypeDescription || 'Unknown',
          loan_amount: loanAmount,
          outstanding_amount: outstandingAmount,
          emi_per_month: emi,
          status: acc.accountStatusDescription || 'Unknown',
          loan_start_date: parseExperianDate(acc.Open_Date),
          source: 'BUREAU',
          needs_verification: needsVerification
        });
      }

      // 4. Replace this applicant's bureau-sourced obligations with the
      // freshly parsed set (delete-then-insert avoids duplicates on repeat pulls).
      await prisma.caseCreditObligation.deleteMany({
        where: {
          applicant_id: applicantId,
          source: 'BUREAU'
        }
      });

      if (obligations.length > 0) {
        await prisma.caseCreditObligation.createMany({
          data: obligations
        });
      }

      console.log(`[Experian Service] Successfully processed ${obligations.length} obligations for Applicant: ${applicantId}`);

      return {
        status: 'SUCCESS',
        obligationsCount: obligations.length,
        totalEmi
      };
    } catch (parseError) {
      console.error('[Experian Service] Failed to parse/save obligations:', parseError);
      await prisma.bureauVerificationLog.create({
        data: {
          case_id: caseId,
          applicant_id: applicantId,
          status: 'OBLIGATIONS_PARSE_FAILED',
          request_payload: payload,
          response_payload: { error: parseError.message, stack: parseError.stack }
        }
      });
      return { status: 'FAILED', error: parseError.message };
    }

  } catch (error) {
    console.error('[Experian Service] Internal error during processing:', error);
    return { status: 'FAILED', error: error.message };
  }
}

module.exports = {
  runExperianCheck
};
