// const prisma = require('../../config/db');
// const COMPLETED_STATUSES = ['COMPLETED', 'COMPLETE', 'SUCCESS'];

// const toNum = (v) => {
//     if (v === undefined || v === null || v === '') return null;
//     const n = Number(String(v).replace(/,/g, ''));
//     return Number.isFinite(n) ? n : null;
// };

// const avg = (arr) => {
//     const nums = arr.map(toNum).filter(v => v !== null);
//     return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
// };

// const latestByYear = (arr) => {
//     if (!Array.isArray(arr)) return null;
//     return [...arr]
//         .filter(x => x && x.year !== undefined)
//         .sort((a, b) => Number(b.year) - Number(a.year))[0] || null;
// };

// const pickLatestPreferredRecord = (records = []) => {
//     if (!Array.isArray(records) || records.length === 0) return null;
//     const completed = records.find((record) =>
//         COMPLETED_STATUSES.includes(String(record?.status || '').toUpperCase())
//     );
//     return completed || records[0];
// };

// async function extractEsrFinancials(case_id, tenant_id = null) {

// try {

// const hasTenantScope = tenant_id !== null && tenant_id !== undefined;
// const caseWhere = hasTenantScope ? { id: case_id, tenant_id } : { id: case_id };
// const caseRecord = await prisma.case.findFirst({
// where: caseWhere,
// include: {
// property: true,
// obligations: { where: { status: 'ACTIVE' } },
// gst_requests: { orderBy: { created_at: 'desc' }, take: 10 },
// itr_analytics: { orderBy: { created_at: 'desc' }, take: 10 },
// bank_statements: { orderBy: { created_at: 'desc' }, take: 10 },
// bureau_checks: { orderBy: { created_at: 'desc' }, take: 10 },
// applicants: { where: { type: 'PRIMARY' } }
// }
// });

// if (!caseRecord) return;

// ////////////////////////////////////////////////////////////
// // 1️⃣ OBLIGATIONS
// ////////////////////////////////////////////////////////////

// let existing_obligations = 0;
// let icici_exposure = 0;

// caseRecord.obligations.forEach(obl => {

// if (obl.include_in_foir)
// existing_obligations += (obl.emi_per_month || 0);

// if (obl.lender_name?.toUpperCase().includes('ICICI'))
// icici_exposure += (obl.outstanding_amount || 0);

// });

// ////////////////////////////////////////////////////////////
// // 2️⃣ GST EXTRACTION
// ////////////////////////////////////////////////////////////

// let gst_avg_monthly_sales = null;
// let gst_industry_type = null;
// let gst_industry_margin = 0.10;

// const gstReq = pickLatestPreferredRecord(caseRecord.gst_requests);

// if (gstReq?.raw_gst_data) {

// const rawGst =
// typeof gstReq.raw_gst_data === 'string'
// ? JSON.parse(gstReq.raw_gst_data)
// : gstReq.raw_gst_data;

// const gstData = Array.isArray(rawGst?.data)
// ? rawGst.data
// : [];

// const monthlyBlock =
// gstData.find(x => x['Monthly Sales&Purchase']);

// const monthlySummary =
// monthlyBlock?.['Monthly Sales&Purchase']
// ?.find(x => x['Monthly Sale Summary']);

// const monthlyRows =
// monthlySummary?.['Monthly Sale Summary']
// ?.find(x => Array.isArray(x.data))?.data || [];

// gst_avg_monthly_sales = avg(
// monthlyRows
// .filter(x => !String(x.Month).toLowerCase().includes('total'))
// .map(x => x['Taxable Value'])
// );

// const entityBlock =
// gstData.find(x => x['Entity Details'])
// ?.['Entity Details'];

// const firstEntity =
// entityBlock ? Object.values(entityBlock)[0] : null;

// const nature =
// firstEntity?.gstinDetails
// ?.natureOfBusinessActivities;

// gst_industry_type =
// Array.isArray(nature)
// ? nature.join(', ')
// : nature;

// }

// ////////////////////////////////////////////////////////////
// // 3️⃣ ITR EXTRACTION
// ////////////////////////////////////////////////////////////

// let itr_pat = null;
// let itr_depreciation = null;
// let itr_finance_cost = null;
// let itr_gross_receipts = null;

// const itrReq = pickLatestPreferredRecord(caseRecord.itr_analytics);

// if (itrReq?.analytics_payload) {

// const rawItr =
// typeof itrReq.analytics_payload === 'string'
// ? JSON.parse(itrReq.analytics_payload)
// : itrReq.analytics_payload;

// const actualItr = rawItr?.result || rawItr;
// const itrKey = actualItr?.iTR || actualItr?.ITR;

// const plArray =
// itrKey?.profitAndLossStatement
// ?.profitAndLossStatement || [];

// const latestPL = latestByYear(plArray);

// if (latestPL) {

// itr_pat = toNum(latestPL.profitAfterTax);

// itr_depreciation =
// toNum(latestPL.depreciationAndAmortization)
// ?? toNum(latestPL.depreciationAndAmortisation);

// itr_finance_cost =
// toNum(latestPL.financeCost);

// itr_gross_receipts =
// toNum(latestPL.receiptsFromProfession)
// ?? toNum(latestPL.revenueFromOperations)
// ?? toNum(latestPL.saleOfServices)
// ?? toNum(latestPL.saleOfGoods);

// }

// if (!itr_pat) {

// const taxCalc =
// latestByYear(
// itrKey?.taxCalculation
// ?.taxCalculation || []
// );

// itr_pat =
// toNum(taxCalc?.profitsAndGainsFromBusinessAndProfession);

// itr_gross_receipts =
// toNum(taxCalc?.grossTotalIncome);

// }

// }

// ////////////////////////////////////////////////////////////
// // 4️⃣ BANK EXTRACTION
// ////////////////////////////////////////////////////////////

// let bank_avg_balance = null;

// const bankReq = pickLatestPreferredRecord(caseRecord.bank_statements);

// if (bankReq) {

// let rawBank = bankReq.raw_download_response;

// if (rawBank)
// rawBank =
// typeof rawBank === 'string'
// ? JSON.parse(rawBank)
// : rawBank;

// let bankElement =
// Array.isArray(rawBank?.result)
// ? rawBank.result[0]
// : Array.isArray(rawBank)
// ? rawBank[0]
// : rawBank;

// bank_avg_balance =
// toNum(bankElement?.overview?.averageDailyBalance)
// ?? toNum(bankElement?.summary?.avgEodBalance);

// if (!bank_avg_balance) {

// const balances =
// bankElement?.overview?.monthlyAverageDailyBalance || [];

// bank_avg_balance =
// avg(balances.map(x => x.averageDailyBalance));

// }

// }

// ////////////////////////////////////////////////////////////
// // 5️⃣ BUREAU
// ////////////////////////////////////////////////////////////

// let bureau_score = null;
// let applicant_age = null;

// const bureauReq = pickLatestPreferredRecord(caseRecord.bureau_checks);

// if (bureauReq?.raw_response) {

// const rawBureau =
// typeof bureauReq.raw_response === 'string'
// ? JSON.parse(bureauReq.raw_response)
// : bureauReq.raw_response;

// const data =
// rawBureau?.verifiedData?.ResponseData?.data;

// bureau_score = toNum(data?.score);
// applicant_age = toNum(data?.age);

// }

// const applicant = caseRecord.applicants[0];

// if (!bureau_score && applicant?.cibil_score)
// bureau_score = applicant.cibil_score;

// ////////////////////////////////////////////////////////////
// // 6️⃣ ESR INCOME METHODS
// ////////////////////////////////////////////////////////////

// const net_profit_income =
// itr_pat !== null
// ? (itr_pat + (2/3 * (itr_depreciation || 0)) + (itr_finance_cost || 0)) / 12
// : null;

// const gst_income =
// gst_avg_monthly_sales
// ? gst_avg_monthly_sales * gst_industry_margin
// : null;

// const banking_income =
// bank_avg_balance
// ? bank_avg_balance / 2
// : null;

// const incomes = {

// NET_PROFIT: net_profit_income || 0,
// GST: gst_income || 0,
// BANKING: banking_income || 0

// };

// let selected_income_method = null;
// let selected_monthly_income = 0;

// for (const [method, value] of Object.entries(incomes)) {

// if (value > selected_monthly_income) {

// selected_income_method = method;
// selected_monthly_income = value;

// }

// }

// ////////////////////////////////////////////////////////////
// // 7️⃣ UPSERT ESR TABLE
// ////////////////////////////////////////////////////////////

// const payload = {

// requested_loan_amount: caseRecord.loan_amount,
// product_type: caseRecord.product_type,

// property_type: caseRecord.property?.property_type,
// occupancy_type: caseRecord.property?.occupancy_status,
// property_value: caseRecord.property?.market_value,

// bureau_score,
// applicant_age,
// existing_obligations,
// icici_exposure,

// itr_pat,
// itr_depreciation,
// itr_finance_cost,
// itr_gross_receipts,

// gst_avg_monthly_sales,
// gst_industry_type,
// gst_industry_margin,

// bank_avg_balance,

// net_profit_income,
// gst_income,
// banking_income,

// selected_income_method,
// selected_monthly_income

// };

// await prisma.caseEsrFinancials.upsert({

// where: { case_id },

// update: payload,

// create: {

// case_id,
// ...payload

// }

// });

// console.log(`[ESR Extraction] Completed for Case ${case_id}`);

// } catch (err) {

// console.error(`[ESR Extraction Failed] Case ${case_id}`, err);

// }

// }

// module.exports = { extractEsrFinancials };




const prisma = require('../../config/db');

const COMPLETED_STATUSES = ['COMPLETED', 'COMPLETE', 'SUCCESS'];

const toNum = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

const avg = (arr) => {
    const nums = arr.map(toNum).filter(v => v !== null);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

const latestByYear = (arr) => {
    if (!Array.isArray(arr)) return null;
    return [...arr]
        .filter(x => x && x.year !== undefined)
        .sort((a, b) => Number(b.year) - Number(a.year))[0] || null;
};

const pickLatestPreferredRecord = (records = []) => {
    if (!Array.isArray(records) || records.length === 0) return null;
    const completed = records.find((record) =>
        COMPLETED_STATUSES.includes(String(record?.status || '').toUpperCase())
    );
    return completed || records[0];
};

async function extractEsrFinancials(case_id, tenant_id = null) {

try {

const hasTenantScope = tenant_id !== null && tenant_id !== undefined;

const caseWhere = hasTenantScope
    ? { id: case_id, tenant_id }
    : { id: case_id };

const caseRecord = await prisma.case.findFirst({
where: caseWhere,
include: {
property: true,
obligations: { where: { status: 'ACTIVE' } },
gst_requests: { orderBy: { created_at: 'desc' }, take: 10 },
itr_analytics: { orderBy: { created_at: 'desc' }, take: 10 },
bank_statements: { orderBy: { created_at: 'desc' }, take: 10 },
bureau_checks: { orderBy: { created_at: 'desc' }, take: 10 },
applicants: { where: { type: 'PRIMARY' } }
}
});

if (!caseRecord) return;

////////////////////////////////////////////////////////////
// 1️⃣ OBLIGATIONS
////////////////////////////////////////////////////////////

let existing_obligations = 0;
let icici_exposure = 0;

caseRecord.obligations.forEach(obl => {

if (obl.include_in_foir)
existing_obligations += (obl.emi_per_month || 0);

if (obl.lender_name?.toUpperCase().includes('ICICI'))
icici_exposure += (obl.outstanding_amount || 0);

});

////////////////////////////////////////////////////////////
// 2⃣ GST EXTRACTION — uses snapshot columns first
////////////////////////////////////////////////////////////

let gst_avg_monthly_sales = null;
let gst_industry_type = null;
let gst_industry_margin = 0.10;

const gstReq = pickLatestPreferredRecord(caseRecord.gst_requests);

// PRIMARY: use persisted turnover_latest_year column (set at ingestion time)
if (gstReq?.turnover_latest_year != null) {
    const annualTurnover = Number(gstReq.turnover_latest_year);
    gst_avg_monthly_sales = annualTurnover / 12;
    console.log(`[ESR Extraction] GST from snapshot column: annual=${annualTurnover}, monthly=${gst_avg_monthly_sales}`);
} else if (gstReq?.raw_gst_data) {
// FALLBACK: parse from raw JSON for legacy records

let rawGst =
typeof gstReq.raw_gst_data === 'string'
? JSON.parse(gstReq.raw_gst_data)
: gstReq.raw_gst_data;

/**
 * PRIMARY FORMAT:
 * Overview_Monthly → Overview of GST Returns
 */
const overview =
rawGst?.Overview_Monthly?.['Overview of GST Returns'];

if (Array.isArray(overview)) {

const monthlyRows =
overview.filter(r => r['Month Year'] !== 'Total');

const totalSales =
monthlyRows.reduce((sum, row) =>
sum + (Number(row['Total Value of Sales (A)']) || 0)
, 0);

gst_avg_monthly_sales =
monthlyRows.length
? totalSales / monthlyRows.length
: null;

}

/**
 * FALLBACK FORMAT:
 * Monthly Sales&Purchase (older analytics vendors)
 */
if (!gst_avg_monthly_sales) {

const gstData =
Array.isArray(rawGst?.data) ? rawGst.data : [];

const monthlyBlock =
gstData.find(x => x['Monthly Sales&Purchase']);

const monthlySummary =
monthlyBlock?.['Monthly Sales&Purchase']
?.find(x => x['Monthly Sale Summary']);

const monthlyRows =
monthlySummary?.['Monthly Sale Summary']
?.find(x => Array.isArray(x.data))?.data || [];

gst_avg_monthly_sales = avg(
monthlyRows
.filter(x => !String(x.Month).toLowerCase().includes('total'))
.map(x => x['Taxable Value'])
);

}

/**
 * INDUSTRY TYPE
 */

const entityBlock =
rawGst?.data?.find(x => x['Entity Details'])
?.['Entity Details'];

const firstEntity =
entityBlock ? Object.values(entityBlock)[0] : null;

const nature =
firstEntity?.gstinDetails?.natureOfBusinessActivities;

gst_industry_type =
Array.isArray(nature)
? nature.join(', ')
: nature;

}

////////////////////////////////////////////////////////////
// 3⃣ ITR EXTRACTION — uses snapshot columns first
////////////////////////////////////////////////////////////

let itr_pat = null;
let itr_depreciation = null;
let itr_finance_cost = null;
let itr_gross_receipts = null;

const itrReq = pickLatestPreferredRecord(caseRecord.itr_analytics);

// PRIMARY: use persisted net_profit_latest_year (set at sync completion)
if (itrReq?.net_profit_latest_year != null) {
    itr_pat = Number(itrReq.net_profit_latest_year);
    itr_gross_receipts = itrReq.gross_receipts_latest_year != null ? Number(itrReq.gross_receipts_latest_year) : null;
    console.log(`[ESR Extraction] ITR from snapshot column: pat=${itr_pat}, receipts=${itr_gross_receipts}`);
} else if (itrReq?.analytics_payload) {
// FALLBACK: parse raw analytics payload for legacy records

const rawItr =
typeof itrReq.analytics_payload === 'string'
? JSON.parse(itrReq.analytics_payload)
: itrReq.analytics_payload;

const actualItr = rawItr?.result || rawItr;
const itrKey = actualItr?.iTR || actualItr?.ITR;

const plArray =
itrKey?.profitAndLossStatement?.profitAndLossStatement || [];

const latestPL = latestByYear(plArray);

if (latestPL) {

itr_pat = toNum(latestPL.profitAfterTax);

itr_depreciation =
toNum(latestPL.depreciationAndAmortization)
?? toNum(latestPL.depreciationAndAmortisation);

itr_finance_cost =
toNum(latestPL.financeCost);

itr_gross_receipts =
toNum(latestPL.receiptsFromProfession)
?? toNum(latestPL.revenueFromOperations)
?? toNum(latestPL.saleOfServices)
?? toNum(latestPL.saleOfGoods);

}

} // end of ITR raw fallback block

////////////////////////////////////////////////////////////
// 4️⃣ BANK EXTRACTION (UPDATED FOR monthlyAverageDailyBalance)
////////////////////////////////////////////////////////////

let bank_avg_balance = null;

const bankReq = pickLatestPreferredRecord(caseRecord.bank_statements);

// PRIMARY: use persisted avg_bank_balance_latest_year column (set at analysis completion)
if (bankReq?.avg_bank_balance_latest_year != null) {
    bank_avg_balance = Number(bankReq.avg_bank_balance_latest_year);
    console.log(`[ESR Extraction] Bank from snapshot column: avg_balance=${bank_avg_balance}`);
} else if (bankReq?.raw_retrieve_response) {
// FALLBACK: parse from raw JSON for legacy records

let rawBank =
typeof bankReq.raw_retrieve_response === 'string'
? JSON.parse(bankReq.raw_retrieve_response)
: bankReq.raw_retrieve_response;

const overview =
rawBank?.overview
?? rawBank?.result?.[0]?.overview
?? rawBank?.[0]?.overview;

const balances =
overview?.monthlyAverageDailyBalance;

if (Array.isArray(balances)) {

bank_avg_balance =
avg(balances.map(x => x.averageDailyBalance));

}

if (!bank_avg_balance) {

bank_avg_balance =
toNum(overview?.averageDailyBalance)
?? toNum(rawBank?.summary?.avgEodBalance);

}

} // end bank raw fallback


////////////////////////////////////////////////////////////
// 5️⃣ BUREAU
////////////////////////////////////////////////////////////

let bureau_score = null;
let applicant_age = null;

const bureauReq = pickLatestPreferredRecord(caseRecord.bureau_checks);

if (bureauReq?.raw_response) {

const rawBureau =
typeof bureauReq.raw_response === 'string'
? JSON.parse(bureauReq.raw_response)
: bureauReq.raw_response;

const data =
rawBureau?.verifiedData?.ResponseData?.data;

bureau_score =
toNum(data?.score)
?? toNum(data?.cibilScore)
?? toNum(data?.creditScore);

applicant_age =
toNum(data?.age);

}

const applicant = caseRecord.applicants[0];

if (!bureau_score && applicant?.cibil_score)
bureau_score = applicant.cibil_score;

////////////////////////////////////////////////////////////
// 6️⃣ ESR INCOME METHODS
////////////////////////////////////////////////////////////

const net_profit_income =
itr_pat !== null
? (itr_pat + (2/3 * (itr_depreciation || 0)) + (itr_finance_cost || 0)) / 12
: null;

const gst_income =
gst_avg_monthly_sales
? gst_avg_monthly_sales * gst_industry_margin
: null;

const banking_income =
bank_avg_balance
? bank_avg_balance / 2
: null;

const incomes = {

GST: gst_income || 0,
BANKING: banking_income || 0,
NET_PROFIT: net_profit_income || 0

};

let selected_income_method = null;
let selected_monthly_income = 0;

for (const [method, value] of Object.entries(incomes)) {

if (value > selected_monthly_income) {

selected_income_method = method;
selected_monthly_income = value;

}

}

////////////////////////////////////////////////////////////
// 7️⃣ UPSERT ESR TABLE
////////////////////////////////////////////////////////////

const payload = {

requested_loan_amount: caseRecord.loan_amount,
product_type: caseRecord.product_type,

property_type: caseRecord.property?.property_type,
occupancy_type: caseRecord.property?.occupancy_status,
property_value: caseRecord.property?.market_value,

bureau_score,
applicant_age,
existing_obligations,
icici_exposure,

itr_pat,
itr_depreciation,
itr_finance_cost,
itr_gross_receipts,

gst_avg_monthly_sales,
gst_industry_type,
gst_industry_margin,

bank_avg_balance,

net_profit_income,
gst_income,
banking_income,

selected_income_method,
selected_monthly_income

};

await prisma.caseEsrFinancials.upsert({

where: { case_id },

update: payload,

create: {
case_id,
...payload
}

});

console.log(`[ESR Extraction] Completed for Case ${case_id}`);

} catch (err) {

console.error(`[ESR Extraction Failed] Case ${case_id}`, err);

}

}

module.exports = { extractEsrFinancials };