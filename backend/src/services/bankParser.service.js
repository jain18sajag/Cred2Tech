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
function extractBankFySnapshot(rawPayload) {
    const result = { latest: null, previous: null, fy_latest: null, fy_previous: null };
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

    // Final fallback for single value fields if no monthly breakdown was found
    if (result.latest === null) {
        result.latest = toNum(overview?.averageDailyBalance) ?? toNum(rawBank?.summary?.avgEodBalance) ?? null;
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
    _parseBankFromRaw
};
