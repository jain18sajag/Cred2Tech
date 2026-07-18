/**
 * bankParser.service.js
 * 
 * Centralized logic for parsing raw bank JSON payloads from Signzy and other vendors.
 * Handles various JSON wrappers, date formats, and financial year snapshots.
 */
const toNum = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/,/g, '').replace(/₹/g, '').trim());
    return Number.isFinite(n) ? n : null;
};

/**
 * Extracts Average Bank Balance (ABB) and FY snapshot from raw JSON.
 * Priority: raw_retrieve_response > raw_download_response
 */
function normalizeSamplingDays(sampleDays) {
    const days = Array.isArray(sampleDays)
        ? sampleDays
        : String(sampleDays || '')
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);

    const normalized = days
        .map(day => String(day).replace(/[^0-9]/g, ''))
        .filter(Boolean);

    return normalized.length > 0 ? normalized : ['5', '10', '15', '25'];
}

function extractBankFySnapshot(rawPayload, options = {}) {
    const targetDays = normalizeSamplingDays(options.sampleDays);
    const useVendorDailyAbb = options.useVendorDailyAbb === true;
    const result = {
        latest: null,
        previous: null,
        fy_latest: null,
        fy_previous: null,
        avg_monthly_credit: null,
        total_credits: null,
        _trace: {
            vendor_adb_latest: null,
            vendor_adb_used: false,
            strict_abb_available: false,
            monthly_abb_table: {}, // { 'Apr 2025': { '5th': 100, '10th': 200, ..., 'Monthly ABB': 150 } }
            final_abb_sum: 0,
            final_abb_months: 0,
            sampling_days: targetDays.join(', ')
        }
    };
    if (!rawPayload) return result;

    const rawBank = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;

    // Support various nested paths for overview in different Signzy/Bank response shapes
    const overview =
        rawBank?.overview
        ?? rawBank?.result?.overview
        ?? rawBank?.result?.[0]?.overview
        ?? rawBank?.data?.overview
        ?? rawBank?.[0]?.overview;

    let balances = overview?.monthlyAverageDailyBalance;

    // Fallback: summary.avgEodBalance (sometimes an array of { amount, month })
    if (!Array.isArray(balances)) {
        const fallback = rawBank?.summary?.avgEodBalance;
        if (Array.isArray(fallback)) {
            balances = fallback.map(x => ({
                averageDailyBalance: x.amount,
                month: x.month || x.date || x.duration
            }));
        }
    }

    if (Array.isArray(balances) && balances.length > 0) {
        const fyTotals = {};
        const fyCounts = {};

        for (const entry of balances) {
            const dateStr = entry.month || entry.date || entry.duration || '';
            const avgBal = toNum(entry.averageDailyBalance);
            if (avgBal === null) continue;

            let fyKey = 'FY (aggregated)';
            if (dateStr) {
                // Regex supports: "Feb 2023", "Feb-2023", "2023-02", "2023/02"
                const match =
                    dateStr.match(/(\d{4})[\-\/](\d{1,2})/) ||
                    dateStr.match(/(\w{3})[\s\-\/](\d{4})/);

                if (match) {
                    let year, month;
                    if (!isNaN(match[1])) {
                        year = parseInt(match[1]); month = parseInt(match[2]);
                    } else {
                        const monthMap = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
                        month = monthMap[match[1]] || 1; year = parseInt(match[2]);
                    }
                    const fyStart = month >= 4 ? year : year - 1;
                    fyKey = `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;
                }
            }

            fyTotals[fyKey] = (fyTotals[fyKey] || 0) + avgBal;
            fyCounts[fyKey] = (fyCounts[fyKey] || 0) + 1;
        }

        const sortedFYs = Object.keys(fyTotals).sort().reverse();
        if (sortedFYs.length > 0) {
            result.fy_latest = sortedFYs[0];
            result.latest = fyTotals[sortedFYs[0]] / fyCounts[sortedFYs[0]];
        }
        if (sortedFYs.length > 1) {
            result.fy_previous = sortedFYs[1];
            result.previous = fyTotals[sortedFYs[1]] / fyCounts[sortedFYs[1]];
        }
    }

    // ICICI must use strict sampled balances, but lenders such as Tata define
    // ABB as the vendor's daily average balance. Keep both policies isolated.
    const vendorAdbLatest = result.latest !== null
        ? result.latest
        : (toNum(overview?.averageDailyBalance) ?? toNum(rawBank?.summary?.avgEodBalance) ?? null);
    result._trace.vendor_adb_latest = vendorAdbLatest;

    if (useVendorDailyAbb && vendorAdbLatest !== null) {
        result.latest = vendorAdbLatest;
        result._trace.vendor_adb_used = true;
    } else {
        // Strict-sampling lenders may show vendor ADB in trace, but it must not feed ESR.
        result.latest = null;
        result.previous = null;
        result.fy_latest = null;
        result.fy_previous = null;
    }

    // Extract average monthly credit and total credits from overview or account level
    const accountLevel = rawBank?.accountLevelAnalysis ?? rawBank?.result?.[0]?.accountLevelAnalysis ?? rawBank?.result?.accountLevelAnalysis ?? [];
    const firstAccount = Array.isArray(accountLevel) ? accountLevel[0] : null;

    if (firstAccount) {
        result.avg_monthly_credit = toNum(firstAccount.avgMonthlyCredit || firstAccount.averageMonthlyCredit);
        result.total_credits = toNum(firstAccount.totalCreditAmount || firstAccount.totalCredits);
    } else if (overview) {
        result.avg_monthly_credit = toNum(overview.averageMonthlyCredit || overview.avgMonthlyCredit);
        result.total_credits = toNum(overview.totalCreditAmount || overview.totalCredits);
    }

    // Final fallback: Calculate from summary.dataDeposits if available
    if (result.total_credits === null && rawBank?.summary?.dataDeposits) {
        let totalDepositSum = 0;
        let monthsCount = Array.isArray(rawBank.summary.months) ? rawBank.summary.months.length : 12;

        // Use 'Deposits' if it exists (parent category), otherwise sum all categories
        const depositsObj = rawBank.summary.dataDeposits;
        const targetCategories = depositsObj.Deposits ? [depositsObj.Deposits] : Object.values(depositsObj);

        for (const catDataObj of targetCategories) {
            const catData = catDataObj?.data;
            if (Array.isArray(catData)) {
                for (const m of catData) {
                    const amount = Number(m.amount);
                    if (!isNaN(amount)) {
                        totalDepositSum += amount;
                    }
                }
            }
        }

        if (totalDepositSum > 0) {
            result.total_credits = totalDepositSum;
            if (result.avg_monthly_credit === null) {
                result.avg_monthly_credit = totalDepositSum / monthsCount;
            }
        }
    }

    // Strict sampled ABB. ICICI uses 5/10/15/25, while HDFC policy uses 5/15/25.
    // ------------------------------------------------
    // If we have the dailyBalance object, use it.
    let sampledLatestAbb = null;
    let sampledPreviousAbb = null;
    const dailyBal = rawBank?.dailyBalance || rawBank?.result?.dailyBalance || rawBank?.data?.dailyBalance || rawBank?.result?.[0]?.dailyBalance || rawBank?.[0]?.dailyBalance;

    // Some vendor responses wrap the days inside a 'day' object: { day: { '1': [...], '5': [...] }, month: [...] }
    const daysObj = dailyBal?.day || dailyBal;

    if (daysObj && targetDays.every(day => daysObj[day])) {
        const monthsData = {}; // { 'Apr 2025': { samples: { '5th': 0, ... }, count: 0 } }

        for (const day of targetDays) {
            const dayArr = daysObj[day];
            if (Array.isArray(dayArr)) {
                for (const entry of dayArr) {
                    if (entry.month !== 'Average' && entry.month !== 'Mode' && entry.month !== 'Median') {
                        const amt = toNum(entry.amount);
                        if (amt !== null) {
                            if (!monthsData[entry.month]) monthsData[entry.month] = { sum: 0, count: 0, samples: {} };
                            const sampleKey = `${day}th`;
                            if (!(sampleKey in monthsData[entry.month].samples)) {
                                monthsData[entry.month].sum += amt;
                                monthsData[entry.month].count += 1;
                                monthsData[entry.month].samples[sampleKey] = amt;
                            }
                        }
                    }
                }
            }
        }

        const fyTotals = {};
        const fyCounts = {};
        const requiredSampleCount = targetDays.length;

        for (const [monthStr, data] of Object.entries(monthsData)) {
            if (data.count === requiredSampleCount) {
                const monthlyAbb = data.sum / requiredSampleCount;
                result._trace.monthly_abb_table[monthStr] = { ...data.samples, 'Monthly ABB': monthlyAbb };

                let fyKey = 'FY (aggregated)';
                const match = monthStr.match(/(\w{3})[\s\-\/](\d{4})/) || monthStr.match(/(\d{4})[\-\/](\d{1,2})/);
                if (match) {
                    let year, month;
                    if (isNaN(match[1])) {
                        const monthMap = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
                        month = monthMap[match[1]] || 1; year = parseInt(match[2]);
                    } else {
                        year = parseInt(match[1]); month = parseInt(match[2]);
                    }
                    const fyStart = month >= 4 ? year : year - 1;
                    fyKey = `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;
                }
                fyTotals[fyKey] = (fyTotals[fyKey] || 0) + monthlyAbb;
                fyCounts[fyKey] = (fyCounts[fyKey] || 0) + 1;
            }
        }

        const sortedFYs = Object.keys(fyTotals).sort().reverse();
        if (sortedFYs.length > 0) {
            sampledLatestAbb = fyTotals[sortedFYs[0]] / fyCounts[sortedFYs[0]];
            result._trace.final_abb_sum = fyTotals[sortedFYs[0]];
            result._trace.final_abb_months = fyCounts[sortedFYs[0]];
        }
        if (sortedFYs.length > 1) {
            sampledPreviousAbb = fyTotals[sortedFYs[1]] / fyCounts[sortedFYs[1]];
        }
    }

    // Override the vendor average with our strict sampled average if available
    if (sampledLatestAbb !== null && (!useVendorDailyAbb || result.latest === null)) {
        result.latest = sampledLatestAbb;
        result._trace.vendor_adb_used = false;
        result._trace.strict_abb_available = true;
    }
    if (sampledPreviousAbb !== null) {
        result.previous = sampledPreviousAbb;
    }

    return result;
}

/**
 * Extracts Salaried Income from raw bank JSON.
 * Specifically filters for CR/inward transactions, rejecting DB/payroll expenses.
 */
function extractBankSalary(rawPayload) {
    const result = {
        avgMonthlySalary: 0,
        validCreditCount: 0,
        ignoredDebitCount: 0,
        source: 'NO_VALID_SALARY'
    };
    if (!rawPayload) return result;

    const rawBank = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;

    // Vendor wrappers
    const salaryObj = rawBank?.salary || rawBank?.result?.salary || rawBank?.data?.salary || rawBank?.result?.[0]?.salary || rawBank?.[0]?.salary;
    if (!salaryObj) return result;

    // Arrays containing salary records
    const salaryArr = salaryObj.salary || salaryObj;
    if (!Array.isArray(salaryArr)) return result;

    let totalCreditSalary = 0;
    const creditTxns = new Set();

    for (const record of salaryArr) {
        // Record might represent a monthly summary or group of transactions
        if (record.transactionType === 'DB') {
            result.ignoredDebitCount += (Array.isArray(record.transactions) ? record.transactions.length : 1);
            continue;
        }

        if (Array.isArray(record.transactions)) {
            for (const txn of record.transactions) {
                if (txn.type === 'DB') {
                    result.ignoredDebitCount++;
                } else if (txn.type === 'CR') {
                    if (!creditTxns.has(txn.id || `${txn.date}-${txn.amount}`)) {
                        creditTxns.add(txn.id || `${txn.date}-${txn.amount}`);
                        totalCreditSalary += toNum(txn.amount) || 0;
                        result.validCreditCount++;
                    }
                }
            }
        } else if (record.transactionType === 'CR' || record.type === 'CR') {
            totalCreditSalary += toNum(record.amount) || 0;
            result.validCreditCount++;
        } else {
            // Default to ignoring if unsure, to be safe
            result.ignoredDebitCount++;
        }
    }

    if (result.validCreditCount > 0) {
        // Find months coverage for average
        const monthsCount = Array.isArray(rawBank?.summary?.months) ? rawBank.summary.months.length : 12;
        result.avgMonthlySalary = totalCreditSalary / monthsCount;
        result.source = 'BANK_STATEMENT_CREDIT';
    }

    return result;
}

/**
 * Convenience wrapper for ESR extraction to get just the average balance
 */
function _parseBankFromRaw(rawPayload) {
    const snapshot = extractBankFySnapshot(rawPayload);
    return snapshot.latest;
}

module.exports = {
    extractBankFySnapshot,
    _parseBankFromRaw,
    extractBankSalary
};
