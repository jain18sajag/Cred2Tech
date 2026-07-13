/**
 * bankAbbPolicy.js
 *
 * Implements bank policy ABB calculations:
 * - ABB = average of balances on 5th, 10th, 15th, 25th.
 * - Monthly income = ABB / divisor.
 *
 * Divisor rules:
 * - SUPER_HNI = 2
 * - ELITE = 2
 * - NORMAL = 2
 * - OTHERS = 3
 */

'use strict';

const toNum = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/,/g, '').replace(/₹/g, '').trim());
    return Number.isFinite(n) ? n : null;
};

/**
 * Standardize transactions from raw bank JSON into a flat array of:
 * { date: Date, balance: number, type: string }
 */
function normalizeBankTransactions(rawBankJson) {
    if (!rawBankJson || typeof rawBankJson !== 'object') return [];

    let raw = rawBankJson;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }

    const unwrapped = raw.result?.[0] || raw.result || raw.data || raw;
    let allTransactions = [];

    // Helper to check if an object represents a transaction row
    function isTransaction(obj) {
        if (!obj || typeof obj !== 'object') return false;
        const hasDate = ('date' in obj) || ('transactionDate' in obj) || ('txnDate' in obj);
        const hasBalance = ('balance' in obj) || ('computedBalance' in obj) || ('closingBalance' in obj) || ('currentBalance' in obj);
        return hasDate && hasBalance;
    }

    // Recursively traverse to find transaction arrays
    function traverse(node) {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
            if (node.length > 0 && isTransaction(node[0])) {
                for (const item of node) {
                    if (isTransaction(item)) {
                        const dateVal = item.date ?? item.transactionDate ?? item.txnDate;
                        const balanceVal = item.balance ?? item.computedBalance ?? item.closingBalance ?? item.currentBalance;
                        const typeVal = item.type ?? item.transactionType ?? item.crDb;

                        allTransactions.push({
                            date: dateVal,
                            balance: balanceVal,
                            type: typeVal,
                            raw: item
                        });
                    }
                }
            } else {
                for (const item of node) {
                    traverse(item);
                }
            }
        } else {
            for (const key of Object.keys(node)) {
                traverse(node[key]);
            }
        }
    }

    traverse(unwrapped);

    // Standardize transactions with parsed dates and numeric balances
    const parsedTransactions = allTransactions.map(tx => {
        let parsedDate = null;
        if (tx.date) {
            const str = String(tx.date).trim();
            // DD-MM-YYYY or DD/MM/YYYY
            const matchDMY = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
            if (matchDMY) {
                parsedDate = new Date(parseInt(matchDMY[3], 10), parseInt(matchDMY[2], 10) - 1, parseInt(matchDMY[1], 10));
            } else {
                parsedDate = new Date(str);
            }
        }
        const numBal = toNum(tx.balance);
        return {
            ...tx,
            balance: numBal,
            parsedDate: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null
        };
    }).filter(tx => tx.parsedDate !== null && tx.balance !== null);

    // Sort by parsedDate ascending
    parsedTransactions.sort((a, b) => a.parsedDate - b.parsedDate);

    return parsedTransactions;
}

/**
 * Find the balance of the transaction that happened closest to (on or before) the targetDate.
 */
function calculateBalanceOnOrBeforeDate(transactions, targetDate) {
    let bestBalance = null;
    for (const tx of transactions) {
        if (tx.parsedDate <= targetDate) {
            bestBalance = tx.balance;
        } else {
            break; // transactions are sorted ascending, so we can stop
        }
    }
    return bestBalance;
}

/**
 * Calculates policy ABB by checking balances on or before the 5th, 10th, 15th, and 25th.
 */
function calculatePolicyABB(rawBankJson) {
    const transactions = normalizeBankTransactions(rawBankJson);

    if (transactions.length === 0) {
        // Fallback: If transaction balances are not available, use monthlyAverageDailyBalance average.
        console.log(`[BANK ABB] source = FALLBACK_MONTHLY_AVERAGE_DAILY_BALANCE`);
        
        let raw = rawBankJson;
        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch (e) {
                return 0;
            }
        }

        const overview =
            raw?.overview
            ?? raw?.result?.overview
            ?? raw?.result?.[0]?.overview
            ?? raw?.data?.overview
            ?? raw?.[0]?.overview;

        let balances = overview?.monthlyAverageDailyBalance;
        if (!Array.isArray(balances)) {
            const fallback = raw?.summary?.avgEodBalance;
            if (Array.isArray(fallback)) {
                balances = fallback.map(x => ({
                    averageDailyBalance: x.amount,
                    month: x.month || x.date || x.duration
                }));
            }
        }

        if (Array.isArray(balances) && balances.length > 0) {
            let sum = 0;
            let count = 0;
            for (const entry of balances) {
                const avgBal = toNum(entry.averageDailyBalance);
                if (avgBal !== null) {
                    sum += avgBal;
                    count++;
                }
            }
            if (count > 0) {
                return sum / count;
            }
        }

        const singleAvg = overview?.averageDailyBalance ?? raw?.summary?.avgEodBalance;
        if (singleAvg !== undefined && singleAvg !== null) {
            const val = toNum(singleAvg);
            if (val !== null) return val;
        }
        return 0;
    }

    // Determine statement months based on transactions
    const minDate = transactions[0].parsedDate;
    const maxDate = transactions[transactions.length - 1].parsedDate;

    const statementMonths = [];
    let curr = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);

    while (curr <= end) {
        statementMonths.push({
            year: curr.getFullYear(),
            month: curr.getMonth(), // 0-indexed
        });
        curr = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
    }

    const monthlyAbbs = [];

    for (const period of statementMonths) {
        const benchmarkDays = [5, 10, 15, 25];
        const balances = [];

        for (const day of benchmarkDays) {
            const targetDate = new Date(period.year, period.month, day, 23, 59, 59, 999);
            const bal = calculateBalanceOnOrBeforeDate(transactions, targetDate);
            if (bal !== null) {
                balances.push(bal);
            }
        }

        if (balances.length > 0) {
            const monthAvg = balances.reduce((a, b) => a + b, 0) / balances.length;
            monthlyAbbs.push(monthAvg);
            console.log(`[BANK ABB] Month: ${period.year}-${period.month + 1}, Benchmarks: [${balances.join(', ')}], MonthAvg: ${monthAvg}`);
        }
    }

    if (monthlyAbbs.length > 0) {
        const policyAbb = monthlyAbbs.reduce((a, b) => a + b, 0) / monthlyAbbs.length;
        console.log(`[BANK ABB] Calculated Policy ABB: ${policyAbb}`);
        return policyAbb;
    }

    return 0;
}

/**
 * Returns divisor based on profile type.
 *
 * KNOWN GAP (confirmed with product owner, 2026-07-13): no ESR/case field
 * currently captures the Super HNI / Elite / Normal / Others tier
 * classification this depends on. The caller in dynamicEligibility.service.js
 * (resolveBankingAbbIncome) feeds this an exact-match check against a
 * concatenation of several unrelated ESR fields (profession, employment_type,
 * etc.), which will essentially never equal 'SUPER_HNI'/'ELITE'/'NORMAL'
 * exactly — so this always falls through to the divisor-3 ("Others") default.
 * That default is the conservative/correct fallback per the requirement
 * sheet, so this isn't actively wrong today, just inert until tier data
 * exists. Revisit getAbbDivisor's matching once a real tier field is added.
 */
function getAbbDivisor(profileType) {
    const prof = String(profileType || '').trim().toUpperCase();
    if (['SUPER_HNI', 'ELITE', 'NORMAL'].includes(prof)) {
        return 2;
    }
    return 3; // OTHERS
}

/**
 * Calculates banking income from ABB using divisor
 */
function calculateBankingIncomeFromAbb(abb, profileType) {
    const divisor = getAbbDivisor(profileType);
    return (abb || 0) / divisor;
}

module.exports = {
    normalizeBankTransactions,
    calculateBalanceOnOrBeforeDate,
    calculatePolicyABB,
    getAbbDivisor,
    calculateBankingIncomeFromAbb,
};
