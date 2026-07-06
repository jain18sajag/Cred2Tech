const toNum = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/[₹,\s%]/g, ''));
    return Number.isFinite(n) ? n : null;
};

const monthMap = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const parseMonthYear = (rawLabel) => {
    if (!rawLabel || typeof rawLabel !== 'string') return null;
    const label = rawLabel.replace(/[.,]/g, '').trim();

    let match = label.match(/^([A-Za-z]{3,})[\s\-\/]+(\d{4})$/);
    if (match) {
        const month = monthMap[match[1].substring(0, 3).toLowerCase()];
        const year = Number(match[2]);
        if (month && Number.isFinite(year)) return { year, month, label: `${match[1].substring(0, 3)} ${year}` };
    }

    match = label.match(/^(\d{1,2})[\s\-\/](\d{4})$/);
    if (match) {
        const month = Number(match[1]);
        const year = Number(match[2]);
        if (month >= 1 && month <= 12 && Number.isFinite(year)) return { year, month, label: `${month}/${year}` };
    }

    match = label.match(/^(\d{4})[\-\/](\d{1,2})$/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (month >= 1 && month <= 12 && Number.isFinite(year)) return { year, month, label: `${month}/${year}` };
    }
    return null;
};

const getRowValue = (row, keys) => {
    if (!row || typeof row !== 'object') return undefined;
    for (const key of keys) if (row[key] !== undefined) return row[key];
    return undefined;
};

const findAllMonthlySaleSummaryRows = (node, out = []) => {
    if (!node) return out;
    if (Array.isArray(node)) {
        for (const item of node) findAllMonthlySaleSummaryRows(item, out);
        return out;
    }
    if (typeof node !== 'object') return out;

    if (node['Monthly Sales&Purchase'] !== undefined) {
        const mspItems = Array.isArray(node['Monthly Sales&Purchase']) ? node['Monthly Sales&Purchase'] : [node['Monthly Sales&Purchase']];
        for (const item of mspItems) {
            if (!item || typeof item !== 'object') continue;
            const summary = item['Monthly Sale Summary'] || item['Monthly Sales Summary'];
            const summaryItems = Array.isArray(summary) ? summary : (summary ? [summary] : []);
            for (const summaryItem of summaryItems) {
                if (summaryItem && Array.isArray(summaryItem.data)) out.push(...summaryItem.data);
                if (summaryItem && Array.isArray(summaryItem.Data)) out.push(...summaryItem.Data);
            }
        }
    }

    if (node['Monthly Sale Summary'] !== undefined) {
        const summaryItems = Array.isArray(node['Monthly Sale Summary']) ? node['Monthly Sale Summary'] : [node['Monthly Sale Summary']];
        for (const summaryItem of summaryItems) {
            if (summaryItem && Array.isArray(summaryItem.data)) out.push(...summaryItem.data);
            if (summaryItem && Array.isArray(summaryItem.Data)) out.push(...summaryItem.Data);
        }
    }

    // Support for Overview of GST Returns (ICICI/Signzy).
    // Lender calculators use GSTR 1 Gross Sales (E=A+B-C+D), not raw Sales (A),
    // so credit/debit note amendments are respected.
    if (node['Overview of GST Returns'] !== undefined) {
        const overview = node['Overview of GST Returns'];
        const overviewItems = Array.isArray(overview) ? overview : [overview];
        for (const row of overviewItems) {
            // Remap for common interface
            out.push({
                'Month': row['Month Year'],
                'Taxable Value': row['GSTR 1 Gross Sales (E=A+B-C+D)'] ?? row['Total Value of Sales (A)']
            });
        }
    }

    if (node['Overview_Monthly'] !== undefined && typeof node['Overview_Monthly'] === 'object') {
        findAllMonthlySaleSummaryRows(node['Overview_Monthly'], out);
    }

    for (const value of Object.values(node)) {
        if (value && typeof value === 'object') findAllMonthlySaleSummaryRows(value, out);
    }
    return out;
};

// FY Helper
function getIndianFY(month, year) {
    if (month >= 4) {
        return `FY ${year}-${String(year + 1).slice(2)}`;
    } else {
        return `FY ${year - 1}-${String(year).slice(2)}`;
    }
}

// Sub-Parsers
function parseGstr1(raw) {
    const fyMap = {};
    if (!raw?.data?.gstr1) return fyMap;
    for (const [mmyyyy, payload] of Object.entries(raw.data.gstr1)) {
        if (!mmyyyy || mmyyyy.length !== 6) continue;
        const month = parseInt(mmyyyy.slice(0, 2), 10);
        const year = parseInt(mmyyyy.slice(2), 10);
        const fy = getIndianFY(month, year);
        
        const summary = payload?.RETSUM?.data?.sectionSummary || [];
        const ttlLiab = summary.find(s => s.returnSection === 'TTL_LIAB');
        
        let amount = 0;
        if (ttlLiab?.totalTaxableValueOfRecords) {
            amount = Number(ttlLiab.totalTaxableValueOfRecords);
        }
        
        if (!fyMap[fy]) fyMap[fy] = { turnover: 0, months_available: 0, months_filed: 0, zero_filing_months: 0 };
        fyMap[fy].months_available += 1;
        fyMap[fy].months_filed += 1; // Presence implies filed
        if (amount === 0) fyMap[fy].zero_filing_months += 1;
        fyMap[fy].turnover += amount;
    }
    return fyMap;
}

function parseGstr3b(raw) {
    const fyMap = {};
    if (!raw?.data?.gstr3b) return fyMap;
    for (const [mmyyyy, payload] of Object.entries(raw.data.gstr3b)) {
        if (!mmyyyy || mmyyyy.length !== 6) continue;
        const month = parseInt(mmyyyy.slice(0, 2), 10);
        const year = parseInt(mmyyyy.slice(2), 10);
        const fy = getIndianFY(month, year);
        
        let amount = 0;
        const txval = payload?.osup_det?.txval;
        if (txval !== undefined) {
            amount = Number(txval);
        }
        
        if (!fyMap[fy]) fyMap[fy] = { turnover: 0, months_available: 0, months_filed: 0, zero_filing_months: 0 };
        fyMap[fy].months_available += 1;
        fyMap[fy].months_filed += 1;
        if (amount === 0) fyMap[fy].zero_filing_months += 1;
        fyMap[fy].turnover += amount;
    }
    return fyMap;
}

function parseProviderReport(raw) {
    const fyMap = {};
    const saleRows = findAllMonthlySaleSummaryRows(raw);
    
    if (!Array.isArray(saleRows) || saleRows.length === 0) return fyMap;
    
    const monthlyMap = new Map();
    for (const row of saleRows) {
        if (!row || typeof row !== 'object') continue;
        const rawLabel = getRowValue(row, ['Month', 'month', 'Month Year', 'monthYear', 'Period', 'period']);
        if (String(rawLabel).toLowerCase().includes('total')) continue; // Skip aggregate rows

        const parsed = parseMonthYear(rawLabel);
        if (!parsed) continue;

        const amount = toNum(getRowValue(row, ['Taxable Value', 'taxable_value', 'taxableValue', 'TaxableValue']));
        if (amount === null) continue;

        const key = `${parsed.year.toString().padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}`;
        if (!monthlyMap.has(key)) {
            monthlyMap.set(key, { year: parsed.year, month: parsed.month, amount });
        }
    }
    
    for (const { year, month, amount } of monthlyMap.values()) {
        const fy = getIndianFY(month, year);
        if (!fyMap[fy]) fyMap[fy] = { turnover: 0, months_available: 0, months_filed: 0, zero_filing_months: 0 };
        fyMap[fy].months_available += 1;
        fyMap[fy].months_filed += 1; // For report, we only have data if filed
        if (amount === 0) fyMap[fy].zero_filing_months += 1;
        fyMap[fy].turnover += amount;
    }
    return fyMap;
}

// New API to return GstFinancialYearSummary array
function extractAllGstSummaries(rawFetchData, rawReportData) {
    const summaries = [];
    const pushSummaries = (fyMap, source) => {
        for (const [fy, data] of Object.entries(fyMap)) {
            summaries.push({
                financial_year: fy,
                source: source,
                turnover: data.turnover,
                months_available: data.months_available,
                months_filed: data.months_filed,
                zero_filing_months: data.zero_filing_months,
                unavailable_months: 12 - data.months_filed,
                is_complete: data.months_filed === 12
            });
        }
    };

    if (rawFetchData) {
        const rawFetch = typeof rawFetchData === 'string' ? JSON.parse(rawFetchData) : rawFetchData;
        pushSummaries(parseGstr1(rawFetch), 'GSTR1');
        pushSummaries(parseGstr3b(rawFetch), 'GSTR3B');
    }

    if (rawReportData) {
        const rawReport = typeof rawReportData === 'string' ? JSON.parse(rawReportData) : rawReportData;
        pushSummaries(parseProviderReport(rawReport), 'PROVIDER_REPORT');
    }

    return summaries;
}

/**
 * Backward compatible extractGstDetails (used by ESR and Proposal).
 */
function extractGstDetails(rawGstData) {
    const raw = typeof rawGstData === 'string' ? JSON.parse(rawGstData) : rawGstData;
    const summaries = extractAllGstSummaries(null, raw); // Old behaviour mostly used the report
    
    // We recreate the old signature by reading from PROVIDER_REPORT
    const reportSummaries = summaries.filter(s => s.source === 'PROVIDER_REPORT')
        .sort((a, b) => b.financial_year.localeCompare(a.financial_year)); // Sort FY desc

    // To preserve EXACT backwards compatibility for the rolling 12 month average
    // We will do what the old logic did: fetch all months, sort desc, pick 12, avg them.
    const saleRows = findAllMonthlySaleSummaryRows(raw);
    const monthlyMap = new Map();
    const result = {
        turnover_latest_year: null, turnover_previous_year: null,
        financial_year_latest: null, financial_year_previous: null,
        avg_monthly_turnover: null, months_filed_12m: null, nil_return_months: null,
        _trace: { skipped_rows: [] }
    };
    
    if (Array.isArray(saleRows)) {
        for (const row of saleRows) {
            if (!row || typeof row !== 'object') continue;
            const rawLabel = getRowValue(row, ['Month', 'month', 'Month Year']);
            if (String(rawLabel).toLowerCase().includes('total')) continue;
            const parsed = parseMonthYear(rawLabel);
            if (!parsed) continue;
            const amount = toNum(getRowValue(row, ['Taxable Value', 'taxable_value']));
            if (amount === null) continue;
            const key = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
            if (!monthlyMap.has(key)) monthlyMap.set(key, { year: parsed.year, month: parsed.month, amount, label: parsed.label });
        }
        
        const sortedMonths = Array.from(monthlyMap.values()).sort((a, b) => (b.year - a.year) || (b.month - a.month));
        const selectedMonths = sortedMonths.slice(0, 12);
        const monthsUsed = selectedMonths.length;
        const totalTurnover = selectedMonths.reduce((sum, row) => sum + row.amount, 0);
        
        result.turnover_latest_year = totalTurnover;
        result.financial_year_latest = monthsUsed > 0 ? `Rolling ${monthsUsed} months ending ${selectedMonths[0].label}` : null;
        result.avg_monthly_turnover = monthsUsed > 0 ? totalTurnover / 12 : null;
        result.months_filed_12m = monthsUsed;
        result.nil_return_months = Math.max(0, 12 - monthsUsed);
    }
    return result;
}

module.exports = {
    extractGstDetails,
    extractAllGstSummaries,
    // Exported for tests
    parseGstr1,
    parseGstr3b,
    parseProviderReport
};
