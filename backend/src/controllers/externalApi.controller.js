const { executePaidApi } = require('../services/wallet.service');
const prisma = require('../../config/db');

// Dummy Resolvers for External APIs
const callBureauApi = async () => {
  await new Promise(res => setTimeout(res, 500));
  return { score: Math.floor(Math.random() * (850 - 300) + 300), report_id: "BUR" + Date.now() };
};

const callBankAnalysisApi = async () => {
  await new Promise(res => setTimeout(res, 800));
  return { abb: 150000, bounce_count: 0 };
};

async function handleConsent(customerId, caseId, type, method) {
   let consent = await prisma.customerConsent.findFirst({
      where: { customer_id: customerId, consent_type: type }
   });

   if (!consent) {
      consent = await prisma.customerConsent.create({
         data: {
            customer_id: customerId,
            case_id: caseId || null,
            consent_type: type,
            consent_source: method,
            status: 'GRANTED',
            granted_at: new Date()
         }
      });
   } else if (consent.status !== 'GRANTED') {
      consent = await prisma.customerConsent.update({
         where: { id: consent.id },
         data: { status: 'GRANTED', granted_at: new Date(), consent_source: method }
      });
   }
   return consent;
}

// Controllers mapping via executePaidApi
async function bureauPull(req, res) {
  try {
    const { customer_id, case_id } = req.body;
    const result = await executePaidApi({
      apiCode: 'BUREAU_PULL',
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      customerId: parseInt(customer_id, 10),
      caseId: case_id ? parseInt(case_id, 10) : null,
      requestPayload: req.body,
      handlerFunction: callBureauApi
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.status === 402) return res.status(402).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
}


async function itrFetch(req, res) {
  try {
     const { customer_id, case_id, consentMethod, pan } = req.body;
     if (!pan) return res.status(400).json({ error: "PAN is required for ITR" });

     const customer = await prisma.customer.findFirst({ where: { id: parseInt(customer_id, 10), tenant_id: req.user.tenant_id }});
     if (!customer) throw new Error("Unauthorized");

     await handleConsent(customer.id, case_id ? parseInt(case_id, 10) : null, 'ITR', consentMethod || 'DIRECT_LOGIN');

     const result = await executePaidApi({
      apiCode: 'ITR_FETCH',
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      customerId: customer.id,
      caseId: case_id ? parseInt(case_id, 10) : null,
      requestPayload: req.body,
      handlerFunction: async () => {
         await new Promise(res => setTimeout(res, 800));
         const mockedResponse = {
            pan: pan,
            ay_2023_income: Math.random() * (10000000 - 1000000) + 1000000,
            ay_2024_income: Math.random() * (10000000 - 1000000) + 1000000,
            ay_2025_income: Math.random() * (10000000 - 1000000) + 1000000,
            net_profit: 450000,
            tax_paid: 120000
         };

         const profile = await prisma.customerITRProfile.create({
            data: {
               customer_id: customer.id,
               pan: mockedResponse.pan,
               ay_2023_income: mockedResponse.ay_2023_income,
               ay_2024_income: mockedResponse.ay_2024_income,
               ay_2025_income: mockedResponse.ay_2025_income,
               net_profit: mockedResponse.net_profit,
               tax_paid: mockedResponse.tax_paid,
               raw_response: mockedResponse
            }
         });

         if (case_id) {
           await prisma.caseDataPullStatus.upsert({
              where: { case_id: parseInt(case_id, 10) },
              create: { case_id: parseInt(case_id, 10), itr_status: 'COMPLETE' },
              update: { itr_status: 'COMPLETE' }
           });
         }

         return profile;
      }
    });
    res.json({ status: "SUCCESS", creditsUsed: 0, itrProfile: result });
  } catch (error) {
    if (error.status === 402) return res.status(402).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
}

async function bankAnalysis(req, res) {
  try {
    const { customer_id, case_id } = req.body;
    const result = await executePaidApi({
      apiCode: 'BANK_ANALYSIS',
      tenantId: req.user.tenant_id,
      userId: req.user.id,
      customerId: parseInt(customer_id, 10),
      caseId: case_id ? parseInt(case_id, 10) : null,
      requestPayload: req.body,
      handlerFunction: callBankAnalysisApi
    });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error.status === 402) return res.status(402).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  bureauPull,
  itrFetch,
  bankAnalysis
};
