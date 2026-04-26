/**
 * financial.extractor.js
 * 
 * Centralized service for extracting structured financial values from raw JSON payloads.
 * Used by:
 *   - GST callback/sync     → extractGstDetails()
 *   - ITR sync              → extractItrDetails()
 *   - Bank webhook/sync     → extractBankDetails()
 *   - Bureau callback       → extractBureauDetails()
 *   - proposal.service.js   → backfillFromRaw() fallback
 * 
 * Principles:
 *   - Raw JSON is ALWAYS preserved for audit (never deleted)
 *   - Structured columns are the application source (fast, stable)
 *   - If structured columns are null, parse raw once and backfill (never parse repeatedly)
 */

const toNum = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. GST Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract FY turnover, months filed, nil months from raw GST JSON.
 * Returns object to be spread into gstr_analytics_requests update.
 */
function extractGstDetails(rawGstData) {
    const result = {
        turnover_latest_year:   null,
        turnover_previous_year: null,
        financial_year_latest:   null,
        financial_year_previous: null,
        avg_monthly_turnover:   null,
        months_filed_12m:       null,
        nil_return_months:      null,
    };

    if (!rawGstData) return result;

    // ── Format 1: Overview_Monthly → "Overview of GST Returns" ─────────────────
    const overviewRows = rawGstData?.Overview_Monthly?.['Overview of GST Returns'];
    if (Array.isArray(overviewRows)) {
        const fyTotals = {};
        const fyMonthsFiled = {};
        const fyNilMonths = {};

        for (const row of overviewRows) {
            const monthYear = row['Month Year'];
            if (!monthYear || monthYear === 'Total') continue;

            const parts = monthYear.split('-');
            if (parts.length !== 2) continue;
            const month = parts[0];
            const year = parseInt(parts[1], 10);
            if (!Number.isFinite(year)) continue;

            const fyStart = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].includes(month) ? year : year - 1;
            const fyKey = `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;

            const sales = Number(row['Total Value of Sales (A)']) || 0;
            fyTotals[fyKey] = (fyTotals[fyKey] || 0) + sales;

            // Count months filed vs nil
            if (!fyMonthsFiled[fyKey]) fyMonthsFiled[fyKey] = 0;
            if (!fyNilMonths[fyKey]) fyNilMonths[fyKey] = 0;
            if (sales > 0) fyMonthsFiled[fyKey]++;
            else fyNilMonths[fyKey]++;
        }

        const sortedFYs = Object.keys(fyTotals).sort().reverse();
        if (sortedFYs.length > 0) {
            result.financial_year_latest  = sortedFYs[0];
            result.turnover_latest_year   = fyTotals[sortedFYs[0]];
            result.avg_monthly_turnover   = fyTotals[sortedFYs[0]] / 12;
            result.months_filed_12m       = fyMonthsFiled[sortedFYs[0]] || 0;
            result.nil_return_months      = fyNilMonths[sortedFYs[0]] || 0;
        }
        if (sortedFYs.length > 1) {
            result.financial_year_previous  = sortedFYs[1];
            result.turnover_previous_year   = fyTotals[sortedFYs[1]];
        }
    }

    // ── Format 2: Legacy Monthly Sales&Purchase fallback ────────────────────────
    if (result.turnover_latest_year === null && Array.isArray(rawGstData?.data)) {
        const monthlyBlock = rawGstData.data.find(x => x['Monthly Sales&Purchase']);
        const rows = monthlyBlock?.['Monthly Sales&Purchase']
            ?.find(x => x['Monthly Sale Summary'])
            ?.['Monthly Sale Summary']
            ?.find(x => Array.isArray(x.data))?.data || [];

        const dataRows = rows.filter(x => !String(x.Month || '').toLowerCase().includes('total'));
        if (dataRows.length > 0) {
            const total = dataRows.reduce((s, r) => s + (Number(r['Taxable Value']) || 0), 0);
            result.turnover_latest_year  = total;
            result.financial_year_latest = 'FY (aggregated)';
            result.avg_monthly_turnover  = total / 12;
            result.months_filed_12m      = dataRows.filter(r => Number(r['Taxable Value']) > 0).length;
            result.nil_return_months     = dataRows.filter(r => !(Number(r['Taxable Value']) > 0)).length;
        }
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ITR Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract net profit, gross receipts, filing status from ITR analytics payload.
 * Returns object to be spread into itr_analytics_requests update.
 */
function extractItrDetails(analyticsData) {
    const result = {
        net_profit_latest_year:      null,
        net_profit_previous_year:    null,
        gross_receipts_latest_year:  null,
        gross_receipts_previous_year: null,
        financial_year_latest:       null,
        financial_year_previous:     null,
        filing_status_latest:        null,
        filing_status_previous:      null,
    };

    if (!analyticsData) return result;

    const actual = analyticsData?.result || analyticsData;
    const itrKey = actual?.iTR || actual?.ITR;
    const plArray = itrKey?.profitAndLossStatement?.profitAndLossStatement || [];

    const sorted = [...plArray]
        .filter(x => x && x.year !== undefined)
        .sort((a, b) => Number(b.year) - Number(a.year));

    const fyLabel = (yearStr) => {
        const y = parseInt(yearStr, 10);
        return Number.isFinite(y) ? `FY ${y}-${String(y + 1).slice(2)}` : String(yearStr);
    };

    const extractRow = (row) => {
        if (!row) return { pat: null, receipts: null };
        const pat = toNum(row.profitAfterTax);
        const receipts = toNum(row.receiptsFromProfession)
            ?? toNum(row.revenueFromOperations)
            ?? toNum(row.saleOfServices)
            ?? toNum(row.saleOfGoods)
            ?? toNum(row.grossTotalIncome);
        return { pat, receipts };
    };

    // Try to get filing status from return summary
    const returnSummary = itrKey?.returnFilingSummary?.returnFilingSummary || [];
    const getFilingStatus = (year) => {
        if (!Array.isArray(returnSummary)) return 'Filed';
        const match = returnSummary.find(r => String(r.year || r.assessmentYear || '') === String(year));
        return match?.filingStatus || match?.status || 'Filed';
    };

    if (sorted.length > 0) {
        const { pat, receipts } = extractRow(sorted[0]);
        result.net_profit_latest_year    = pat;
        result.gross_receipts_latest_year = receipts;
        result.financial_year_latest     = fyLabel(sorted[0].year);
        result.filing_status_latest      = getFilingStatus(sorted[0].year);
    }
    if (sorted.length > 1) {
        const { pat, receipts } = extractRow(sorted[1]);
        result.net_profit_previous_year    = pat;
        result.gross_receipts_previous_year = receipts;
        result.financial_year_previous     = fyLabel(sorted[1].year);
        result.filing_status_previous      = getFilingStatus(sorted[1].year);
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Bank Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract avg monthly credit, debit, closing balance, cheque bounces, bank name
 * from the raw bank JSON retrieve response.
 * Returns object to be spread into bank_statement_analysis_requests update.
 */
function extractBankDetails(rawRetrieveData) {
    const result = {
        avg_bank_balance_latest_year:   null,
        avg_bank_balance_previous_year: null,
        financial_year_latest:          null,
        financial_year_previous:        null,
        avg_monthly_credit:             null,
        avg_monthly_debit:              null,
        avg_closing_balance:            null,
        cheque_bounces_12m:             null,
        statement_period:               null,
        bank_name:                      null,
        account_number_masked:          null,
    };

    if (!rawRetrieveData) return result;

    // Support rawBank.overview or rawBank.result[0].overview
    const accountLevelData = rawRetrieveData?.accountLevelAnalysis
        ?? rawRetrieveData?.result?.[0]?.accountLevelAnalysis
        ?? rawRetrieveData?.result?.accountLevelAnalysis
        ?? [];

    const overview = rawRetrieveData?.overview
        ?? rawRetrieveData?.result?.[0]?.overview
        ?? rawRetrieveData?.[0]?.overview;

    // ── FY Average Balance from monthlyAverageDailyBalance ─────────────────────
    const balances = overview?.monthlyAverageDailyBalance;
    if (Array.isArray(balances) && balances.length > 0) {
        const fyTotals = {};
        const fyCounts = {};

        for (const entry of balances) {
            const dateStr = entry.month || entry.date || '';
            const avgBal = toNum(entry.averageDailyBalance);
            if (avgBal === null) continue;

            let fyKey = 'FY (aggregated)';
            if (dateStr) {
                const match = dateStr.match(/(\d{4})[\-\/](\d{1,2})/) || dateStr.match(/(\w{3})[\-\/](\d{4})/);
                if (match) {
                    let year, month;
                    if (!isNaN(match[1])) {
                        year = parseInt(match[1]); month = parseInt(match[2]);
                    } else {
                        const monthMap = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
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
            result.financial_year_latest          = sortedFYs[0];
            result.avg_bank_balance_latest_year   = fyTotals[sortedFYs[0]] / fyCounts[sortedFYs[0]];
        }
        if (sortedFYs.length > 1) {
            result.financial_year_previous        = sortedFYs[1];
            result.avg_bank_balance_previous_year = fyTotals[sortedFYs[1]] / fyCounts[sortedFYs[1]];
        }
    }

    // ── Credit / Debit / Closing Balance (from accountLevelAnalysis or overview) ─
    const firstAccount = Array.isArray(accountLevelData) ? accountLevelData[0] : null;
    if (firstAccount) {
        result.avg_monthly_credit  = toNum(firstAccount.avgMonthlyCredit  || firstAccount.averageMonthlyCredit);
        result.avg_monthly_debit   = toNum(firstAccount.avgMonthlyDebit   || firstAccount.averageMonthlyDebit);
        result.avg_closing_balance = toNum(firstAccount.avgClosingBalance || firstAccount.averageClosingBalance);
        result.bank_name           = firstAccount.bankName || firstAccount.bank || null;

        // Mask account number: show last 4 digits only
        const rawAccNo = String(firstAccount.accountNumber || firstAccount.accNo || '');
        if (rawAccNo.length >= 4) {
            result.account_number_masked = `XXXX XXXX ${rawAccNo.slice(-4)}`;
        }

        // Statement period
        const from = firstAccount.fromDate || firstAccount.startDate;
        const to   = firstAccount.toDate   || firstAccount.endDate;
        if (from && to) result.statement_period = `${from} to ${to}`;
    } else if (overview) {
        result.avg_monthly_credit  = toNum(overview.averageMonthlyCredit || overview.avgMonthlyCredit);
        result.avg_monthly_debit   = toNum(overview.averageMonthlyDebit  || overview.avgMonthlyDebit);
        result.avg_closing_balance = toNum(overview.averageClosingBalance);
    }

    // ── Cheque Bounces ──────────────────────────────────────────────────────────
    const bounceCount = toNum(
        firstAccount?.bouncedCheques
        ?? firstAccount?.chequeBounces
        ?? overview?.totalBouncedCheques
        ?? overview?.chequeBounces
    );
    result.cheque_bounces_12m = bounceCount !== null ? Math.round(bounceCount) : 0;

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Bureau Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract bureau score, name, active loans, overdue, DPD from raw bureau response.
 * Returns object to be spread into bureau_verifications update.
 */
function extractBureauDetails(rawResponse) {
    const result = {
        score:             null,
        bureau_name:       null,
        emi_obligations_total: null,
        active_loan_count: null,
        overdue_amount:    null,
        dpd_status:        null,
    };

    if (!rawResponse) return result;

    const raw = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;

    // Top-level score (Veri5 / Experian / CRIF shape)
    result.score = toNum(
        raw?.score
        ?? raw?.creditScore
        ?? raw?.bureauScore
        ?? raw?.crScore
        ?? raw?.result?.score
        ?? raw?.data?.score
    );

    // Bureau name
    result.bureau_name = raw?.bureau || raw?.bureauName || raw?.source || 'Credit Bureau';

    // Active loans
    result.active_loan_count = toNum(
        raw?.activeLoanCount
        ?? raw?.activeAccounts
        ?? raw?.result?.activeLoanCount
        ?? raw?.data?.activeLoanCount
    );

    // Overdue amount
    result.overdue_amount = toNum(
        raw?.overdueAmount
        ?? raw?.totalOverdue
        ?? raw?.result?.overdueAmount
        ?? raw?.data?.overdueAmount
    );

    // DPD status
    const dpd = raw?.dpdStatus ?? raw?.dpd ?? raw?.result?.dpdStatus ?? raw?.data?.dpdStatus;
    if (dpd !== undefined && dpd !== null) {
        result.dpd_status = String(dpd);
    }

    // EMI obligations (total monthly EMI from active loans)
    result.emi_obligations_total = toNum(
        raw?.totalEmiAmount
        ?? raw?.monthlyObligations
        ?? raw?.result?.totalEmiAmount
        ?? raw?.data?.totalEmiAmount
    );

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Backfill helper — reads structured columns, falls back to raw JSON parse
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load structured financial snapshot for a case.
 * If structured columns are populated: use them directly.
 * If ANY column is null AND raw JSON exists: parse once, persist, then return.
 * Never parses raw JSON on every call — only backfills once.
 */
async function loadCaseFinancialSnapshot(prisma, case_id) {
    const snapshot = {
        gst: null,
        itr: null,
        bank: null,
        bureau: null,
    };

    // ── GST ─────────────────────────────────────────────────────────────────────
    const gstRows = await prisma.$queryRawUnsafe(`
        SELECT id, turnover_latest_year, turnover_previous_year,
               financial_year_latest, financial_year_previous,
               avg_monthly_turnover, months_filed_12m, nil_return_months,
               raw_gst_data
        FROM gstr_analytics_requests
        WHERE case_id = $1 AND status IN ('REPORT_READY','COMPLETED')
        ORDER BY updated_at DESC LIMIT 1
    `, case_id);

    if (gstRows[0]) {
        const g = gstRows[0];
        // Backfill if avg_monthly_turnover is null but turnover_latest exists
        if (g.avg_monthly_turnover === null && g.turnover_latest_year !== null) {
            const extracted = g.raw_gst_data
                ? extractGstDetails(typeof g.raw_gst_data === 'string' ? JSON.parse(g.raw_gst_data) : g.raw_gst_data)
                : { avg_monthly_turnover: Number(g.turnover_latest_year) / 12, months_filed_12m: null, nil_return_months: null };

            await prisma.$executeRawUnsafe(
                `UPDATE gstr_analytics_requests SET avg_monthly_turnover=$1, months_filed_12m=$2, nil_return_months=$3 WHERE id=$4`,
                extracted.avg_monthly_turnover, extracted.months_filed_12m, extracted.nil_return_months, g.id
            );
            g.avg_monthly_turnover = extracted.avg_monthly_turnover;
            g.months_filed_12m     = extracted.months_filed_12m;
            g.nil_return_months    = extracted.nil_return_months;
        }

        snapshot.gst = {
            turnover_latest_year:    Number(g.turnover_latest_year) || null,
            turnover_previous_year:  Number(g.turnover_previous_year) || null,
            financial_year_latest:   g.financial_year_latest,
            financial_year_previous: g.financial_year_previous,
            avg_monthly_turnover:    Number(g.avg_monthly_turnover) || (Number(g.turnover_latest_year) / 12) || null,
            months_filed_12m:        g.months_filed_12m,
            nil_return_months:       g.nil_return_months,
        };
    }

    // ── ITR ─────────────────────────────────────────────────────────────────────
    const itrRows = await prisma.$queryRawUnsafe(`
        SELECT id, net_profit_latest_year, net_profit_previous_year,
               gross_receipts_latest_year, gross_receipts_previous_year,
               financial_year_latest, financial_year_previous,
               filing_status_latest, filing_status_previous,
               analytics_payload
        FROM itr_analytics_requests
        WHERE case_id = $1 AND status = 'COMPLETED'
        ORDER BY updated_at DESC LIMIT 1
    `, case_id);

    if (itrRows[0]) {
        const r = itrRows[0];
        // Backfill filing_status if null
        if (r.filing_status_latest === null && r.analytics_payload) {
            const extracted = extractItrDetails(
                typeof r.analytics_payload === 'string' ? JSON.parse(r.analytics_payload) : r.analytics_payload
            );
            await prisma.$executeRawUnsafe(
                `UPDATE itr_analytics_requests SET filing_status_latest=$1, filing_status_previous=$2 WHERE id=$3`,
                extracted.filing_status_latest || 'Filed',
                extracted.filing_status_previous || 'Filed',
                r.id
            );
            r.filing_status_latest   = extracted.filing_status_latest   || 'Filed';
            r.filing_status_previous = extracted.filing_status_previous || 'Filed';
        }

        snapshot.itr = {
            net_profit_latest_year:      Number(r.net_profit_latest_year)      || null,
            net_profit_previous_year:    Number(r.net_profit_previous_year)    || null,
            gross_receipts_latest_year:  Number(r.gross_receipts_latest_year)  || null,
            gross_receipts_previous_year: Number(r.gross_receipts_previous_year) || null,
            financial_year_latest:       r.financial_year_latest,
            financial_year_previous:     r.financial_year_previous,
            filing_status_latest:        r.filing_status_latest  || 'Filed',
            filing_status_previous:      r.filing_status_previous || 'Filed',
        };
    }

    // ── Bank ─────────────────────────────────────────────────────────────────────
    const bankRows = await prisma.$queryRawUnsafe(`
        SELECT id, avg_bank_balance_latest_year, avg_bank_balance_previous_year,
               financial_year_latest, financial_year_previous,
               avg_monthly_credit, avg_monthly_debit, avg_closing_balance,
               cheque_bounces_12m, statement_period, bank_name, account_number_masked,
               raw_retrieve_response
        FROM bank_statement_analysis_requests
        WHERE case_id = $1 AND status = 'COMPLETED'
        ORDER BY created_at ASC LIMIT 5
    `, case_id);

    if (bankRows.length > 0) {
        const banks = [];
        for (const b of bankRows) {
            // Backfill if detailed columns are null
            if (b.avg_monthly_credit === null && b.raw_retrieve_response) {
                const raw = typeof b.raw_retrieve_response === 'string'
                    ? JSON.parse(b.raw_retrieve_response) : b.raw_retrieve_response;
                const extracted = extractBankDetails(raw);
                await prisma.$executeRawUnsafe(
                    `UPDATE bank_statement_analysis_requests
                     SET avg_monthly_credit=$1, avg_monthly_debit=$2, avg_closing_balance=$3,
                         cheque_bounces_12m=$4, statement_period=$5, bank_name=$6, account_number_masked=$7
                     WHERE id=$8`,
                    extracted.avg_monthly_credit, extracted.avg_monthly_debit,
                    extracted.avg_closing_balance, extracted.cheque_bounces_12m,
                    extracted.statement_period, extracted.bank_name, extracted.account_number_masked,
                    b.id
                );
                Object.assign(b, extracted);
            }
            banks.push({
                avg_balance_latest_year:   Number(b.avg_bank_balance_latest_year) || null,
                avg_balance_previous_year: Number(b.avg_bank_balance_previous_year) || null,
                financial_year_latest:     b.financial_year_latest,
                financial_year_previous:   b.financial_year_previous,
                avg_monthly_credit:        Number(b.avg_monthly_credit) || null,
                avg_monthly_debit:         Number(b.avg_monthly_debit) || null,
                avg_closing_balance:       Number(b.avg_closing_balance) || null,
                cheque_bounces_12m:        b.cheque_bounces_12m,
                statement_period:          b.statement_period,
                bank_name:                 b.bank_name,
                account_number_masked:     b.account_number_masked,
            });
        }
        snapshot.bank = banks;
    }

    // ── Bureau ─────────────────────────────────────────────────────────────────
    const bureauRows = await prisma.$queryRawUnsafe(`
        SELECT id, score, bureau_name, emi_obligations_total,
               active_loan_count, overdue_amount, dpd_status,
               applicant_type, raw_response
        FROM bureau_verifications
        WHERE case_id = $1
        ORDER BY created_at DESC LIMIT 1
    `, case_id);

    if (bureauRows[0]) {
        const bv = bureauRows[0];
        // Backfill if bureau_name is null
        if (bv.bureau_name === null && bv.raw_response) {
            const raw = typeof bv.raw_response === 'string' ? JSON.parse(bv.raw_response) : bv.raw_response;
            const extracted = extractBureauDetails(raw);
            await prisma.$executeRawUnsafe(
                `UPDATE bureau_verifications SET bureau_name=$1, active_loan_count=$2, overdue_amount=$3, dpd_status=$4 WHERE id=$5`,
                extracted.bureau_name, extracted.active_loan_count, extracted.overdue_amount, extracted.dpd_status, bv.id
            );
            Object.assign(bv, extracted);
        }
        snapshot.bureau = {
            score:                 bv.score,
            bureau_name:           bv.bureau_name || 'Credit Bureau',
            emi_obligations_total: Number(bv.emi_obligations_total) || null,
            active_loan_count:     bv.active_loan_count,
            overdue_amount:        Number(bv.overdue_amount) || null,
            dpd_status:            bv.dpd_status,
        };
    }

    return snapshot;
}

module.exports = {
    extractGstDetails,
    extractItrDetails,
    extractBankDetails,
    extractBureauDetails,
    loadCaseFinancialSnapshot,
};
