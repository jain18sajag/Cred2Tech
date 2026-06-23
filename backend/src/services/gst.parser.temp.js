// Temp file to write logic
function getIndianFY(month, year) {
    if (month >= 4) {
        return `FY ${year}-${String(year + 1).slice(2)}`;
    } else {
        return `FY ${year - 1}-${String(year).slice(2)}`;
    }
}

function parseGstr1(raw) {
    const fyMap = {};
    if (!raw?.data?.gstr1) return fyMap;
    for (const [mmyyyy, payload] of Object.entries(raw.data.gstr1)) {
        const month = parseInt(mmyyyy.slice(0, 2), 10);
        const year = parseInt(mmyyyy.slice(2), 10);
        const fy = getIndianFY(month, year);
        
        const summary = payload?.RETSUM?.data?.sectionSummary || [];
        const ttlLiab = summary.find(s => s.returnSection === 'TTL_LIAB');
        
        if (ttlLiab?.totalTaxableValueOfRecords) {
            fyMap[fy] = (fyMap[fy] || 0) + Number(ttlLiab.totalTaxableValueOfRecords);
        }
    }
    return fyMap;
}

function parseGstr3b(raw) {
    const fyMap = {};
    if (!raw?.data?.gstr3b) return fyMap;
    for (const [mmyyyy, payload] of Object.entries(raw.data.gstr3b)) {
        const month = parseInt(mmyyyy.slice(0, 2), 10);
        const year = parseInt(mmyyyy.slice(2), 10);
        const fy = getIndianFY(month, year);
        
        const txval = payload?.osup_det?.txval;
        if (txval) {
            fyMap[fy] = (fyMap[fy] || 0) + Number(txval);
        }
    }
    return fyMap;
}

function parseProviderReport(raw) {
    const fyMap = {};
    // Extract from Monthly Sale Summary
    // Already seen the code for this in the old extractGstDetails.
    // I can reuse the logic to find saleRows, parse them, and aggregate by Indian FY!
    return fyMap;
}

function extractGstDetails(rawGstData) {
    const raw = typeof rawGstData === 'string' ? JSON.parse(rawGstData) : rawGstData;
    
    // Attempt GSTR-1
    const gstr1Map = parseGstr1(raw);
    // Attempt GSTR-3B
    const gstr3bMap = parseGstr3b(raw);
    // Attempt Report
    const reportMap = parseProviderReport(raw);
    
    // Which one to use?
    // As per plan, prioritize Provider Report > GSTR-3B > GSTR-1.
    // But wait, the system should populate the NEW model GstFinancialYearSummary.
    // So this function should extract ALL of them and return an array of summaries!
    // But `extractGstDetails` is currently used to spread into `gstr_analytics_requests`!
    // The plan says: "I will author finalizeGstAnalyticsRequest() within gst.service.js... and push summary rows to GstFinancialYearSummary".
    // So `extractGstDetails` should return the structured data for ALL sources to be saved by the new `finalizeGstAnalyticsRequest()`.
}
