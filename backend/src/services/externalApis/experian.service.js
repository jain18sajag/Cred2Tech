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
            documentType: 'BUREAU_REPORT_EXPERIAN',
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

    // 3. Extract obligations
    const reportData = responseData?.data?.jsonExperianReport || responseData?.jsonExperianReport;
    const accounts = reportData?.CAIS_Account?.CAIS_Account_DETAILS || [];
    
    if (accounts.length === 0) {
      console.log(`[Experian Service] No obligations found for Applicant: ${applicantId}`);
      return { status: 'SUCCESS', message: 'No obligations found' };
    }

    console.log(`[Experian Service] Found ${accounts.length} accounts for Applicant: ${applicantId}. Processing...`);

    const parseExperianDate = (dateString) => {
      // Date format is YYYYMMDD
      if (!dateString || dateString.length !== 8) return null;
      const year = dateString.substring(0, 4);
      const month = dateString.substring(4, 6);
      const day = dateString.substring(6, 8);
      return new Date(`${year}-${month}-${day}T00:00:00Z`);
    };

    let totalEmi = 0;
    const obligations = [];

    for (const acc of accounts) {
      // Safe parsing of financial values
      const loanAmount = acc.Highest_Credit_or_Original_Loan_Amount ? parseFloat(acc.Highest_Credit_or_Original_Loan_Amount) : 0;
      const outstandingAmount = acc.Current_Balance ? parseFloat(acc.Current_Balance) : 0;
      const emi = acc.Scheduled_Monthly_Payment_Amount ? parseFloat(acc.Scheduled_Monthly_Payment_Amount) : 0;
      
      const isClosed = acc.accountStatusDescription?.toLowerCase().includes('closed') || outstandingAmount <= 0;
      
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

    // 4. Upsert/Create in database
    // Delete old bureau obligations for this applicant to prevent duplicates if pulled again
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

  } catch (error) {
    console.error('[Experian Service] Internal error during processing:', error);
    return { status: 'FAILED', error: error.message };
  }
}

module.exports = {
  runExperianCheck
};
