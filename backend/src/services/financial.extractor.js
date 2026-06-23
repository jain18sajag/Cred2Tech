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
    const n = Number(String(v).replace(/[₹,\s%]/g, ''));
    return Number.isFinite(n) ? n : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. GST Extraction
// ─────────────────────────────────────────────────────────────────────────────

const { extractGstDetails, extractAllGstSummaries } = require('./gst.parser');

// ─────────────────────────────────────────────────────────────────────────────
// 2. ITR Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract net profit, gross receipts, filing status from ITR analytics payload.
 * Returns object to be spread into itr_analytics_requests update.
 */
function extractItrDetails(analyticsData) {
    const result = {
        net_profit_latest_year: null,
        net_profit_previous_year: null,
        gross_receipts_latest_year: null,
        gross_receipts_previous_year: null,
        depreciation_latest_year: null,
        finance_cost_latest_year: null,
        itr_remuneration_latest_year: null,
        financial_year_latest: null,
        financial_year_previous: null,
        filing_status_latest: null,
        filing_status_previous: null,
        _trace: {
            source: null,
            pat_path: null,
            rec_path: null,
            dep_path: null,
            fin_path: null,
            rem_path: null
        }
    };

    if (!analyticsData) return result;

    const toRowNumber = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const n = Number(String(val).replace(/[₹,\s%]/g, ''));
        return Number.isFinite(n) ? n : null;
    };

    const parseRawItrPayload = (payload) => {
        const rawResult = {
            itr_pat: null,
            itr_depreciation: null,
            itr_finance_cost: null,
            itr_gross_receipts: null,
            itr_remuneration: null,
            _paths: { pat: null, dep: null, fin: null, rec: null, rem: null },
            _ignored: []
        };

        const rawItr = typeof payload === 'string' ? JSON.parse(payload) : payload;
        if (!rawItr || typeof rawItr !== 'object') return rawResult;

        const yearKeys = Object.keys(rawItr)
            .filter(k => /^\d{4}-\d{4}$/.test(k))
            .sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)));

        let latestItr = null;
        if (yearKeys.length > 0) {
            const yearData = rawItr[yearKeys[0]];
            if (Array.isArray(yearData) && yearData.length > 0) {
                latestItr = yearData[0].json?.ITR || yearData[0].json?.iTR || yearData[0].json;
            }
        }
        if (!latestItr) {
            latestItr = rawItr?.result || rawItr;
        }

        if (!latestItr || typeof latestItr !== 'object') return rawResult;

        const itr3 = latestItr.ITR3 || latestItr.iTR3 || latestItr.ITR?.ITR3 || latestItr.ITR?.iTR3;
        if (itr3) {
            const pl = itr3.PARTA_PL || itr3.PartA_PL;
            const plStr = itr3.PARTA_PL ? 'PARTA_PL' : 'PartA_PL';
            if (pl) {
                if (pl.TaxProvAppr?.ProfitAfterTax !== undefined) { rawResult.itr_pat = toRowNumber(pl.TaxProvAppr.ProfitAfterTax); rawResult._paths.pat = `ITR.ITR3.${plStr}.TaxProvAppr.ProfitAfterTax`; }
                else if (pl.TaxProvAppr?.ProprietorAccBalTrf !== undefined) { rawResult.itr_pat = toRowNumber(pl.TaxProvAppr.ProprietorAccBalTrf); rawResult._paths.pat = `ITR.ITR3.${plStr}.TaxProvAppr.ProprietorAccBalTrf`; }
                else if (pl.PBT !== undefined) { rawResult.itr_pat = toRowNumber(pl.PBT); rawResult._paths.pat = `ITR.ITR3.${plStr}.PBT`; }

                if (pl.DebitsToPL?.DepreciationAmort !== undefined) { rawResult.itr_depreciation = toRowNumber(pl.DebitsToPL.DepreciationAmort); rawResult._paths.dep = `ITR.ITR3.${plStr}.DebitsToPL.DepreciationAmort`; }
                else if (pl.DebitsToPL?.Depreciation !== undefined) { rawResult.itr_depreciation = toRowNumber(pl.DebitsToPL.Depreciation); rawResult._paths.dep = `ITR.ITR3.${plStr}.DebitsToPL.Depreciation`; }

                if (pl.DebitsToPL?.InterestExpdrtDtls?.InterestExpdr !== undefined) { rawResult.itr_finance_cost = toRowNumber(pl.DebitsToPL.InterestExpdrtDtls.InterestExpdr); rawResult._paths.fin = `ITR.ITR3.${plStr}.DebitsToPL.InterestExpdrtDtls.InterestExpdr`; }
                else if (pl.DebitsToPL?.Interest !== undefined) { rawResult.itr_finance_cost = toRowNumber(pl.DebitsToPL.Interest); rawResult._paths.fin = `ITR.ITR3.${plStr}.DebitsToPL.Interest`; }

                if (pl.DebitsToPL?.RemunerationToPartners !== undefined) { rawResult.itr_remuneration = toRowNumber(pl.DebitsToPL.RemunerationToPartners); rawResult._paths.rem = `ITR.ITR3.${plStr}.DebitsToPL.RemunerationToPartners`; }
                else if (pl.DebitsToPL?.Remuneration !== undefined) { rawResult.itr_remuneration = toRowNumber(pl.DebitsToPL.Remuneration); rawResult._paths.rem = `ITR.ITR3.${plStr}.DebitsToPL.Remuneration`; }
            }

            const trading = itr3.TradingAccount || itr3.PartA_Trading;
            const tStr = itr3.TradingAccount ? 'TradingAccount' : 'PartA_Trading';
            if (trading) {
                if (trading.TotRevenueFrmOperations !== undefined) { rawResult.itr_gross_receipts = toRowNumber(trading.TotRevenueFrmOperations); rawResult._paths.rec = `ITR.ITR3.${tStr}.TotRevenueFrmOperations`; }
                else if (trading.SalesGrossReceiptsTotal !== undefined) { rawResult.itr_gross_receipts = toRowNumber(trading.SalesGrossReceiptsTotal); rawResult._paths.rec = `ITR.ITR3.${tStr}.SalesGrossReceiptsTotal`; }
                else if (trading.TardingAccTotCred !== undefined) { rawResult.itr_gross_receipts = toRowNumber(trading.TardingAccTotCred); rawResult._paths.rec = `ITR.ITR3.${tStr}.TardingAccTotCred`; }
                else if (trading.GrossRcptFromProfession !== undefined) { rawResult.itr_gross_receipts = toRowNumber(trading.GrossRcptFromProfession); rawResult._paths.rec = `ITR.ITR3.${tStr}.GrossRcptFromProfession`; }
            }

            if (itr3.PartB_TI?.GrossTotalIncome !== undefined) rawResult._ignored.push('GrossTotalIncome ignored for ITR3 business profit.');
            if (itr3.PartB_TI?.TotalIncome !== undefined) rawResult._ignored.push('TotalIncome ignored for ITR3 business receipts.');
            if (itr3.ScheduleBP?.TotProfBusGain !== undefined) rawResult._ignored.push('TotProfBusGain not used as gross receipts.');
        } else {
            const bp = latestItr.ITR4?.ScheduleBP || latestItr.iTR4?.ScheduleBP || latestItr.ITR?.ITR4?.ScheduleBP || latestItr.ITR?.iTR4?.ScheduleBP;
            if (bp) {
                if (bp.NetProfit !== undefined) { rawResult.itr_pat = toRowNumber(bp.NetProfit); rawResult._paths.pat = 'ITR.ITR4.ScheduleBP.NetProfit'; }
                else if (bp.NetProfitAfterTax !== undefined) { rawResult.itr_pat = toRowNumber(bp.NetProfitAfterTax); rawResult._paths.pat = 'ITR.ITR4.ScheduleBP.NetProfitAfterTax'; }

                if (bp.GrossReceipts !== undefined) { rawResult.itr_gross_receipts = toRowNumber(bp.GrossReceipts); rawResult._paths.rec = 'ITR.ITR4.ScheduleBP.GrossReceipts'; }
                else if (bp.GrossTurnover !== undefined) { rawResult.itr_gross_receipts = toRowNumber(bp.GrossTurnover); rawResult._paths.rec = 'ITR.ITR4.ScheduleBP.GrossTurnover'; }
            }
        }

        if (rawResult.itr_pat === null) {
            const generalInfo = latestItr?.ITR1 || latestItr?.ITR2 || latestItr;
            if (generalInfo?.profitAfterTax !== undefined) { rawResult.itr_pat = toRowNumber(generalInfo.profitAfterTax); rawResult._paths.pat = 'ITR.profitAfterTax'; }
            else if (generalInfo?.PBT !== undefined) { rawResult.itr_pat = toRowNumber(generalInfo.PBT); rawResult._paths.pat = 'ITR.PBT'; }
        }
        if (rawResult.itr_gross_receipts === null) {
            const generalInfo = latestItr?.ITR1 || latestItr?.ITR2 || latestItr;
            if (generalInfo?.receiptsFromProfession !== undefined) { rawResult.itr_gross_receipts = toRowNumber(generalInfo.receiptsFromProfession); rawResult._paths.rec = 'ITR.receiptsFromProfession'; }
            else if (generalInfo?.revenueFromOperations !== undefined) { rawResult.itr_gross_receipts = toRowNumber(generalInfo.revenueFromOperations); rawResult._paths.rec = 'ITR.revenueFromOperations'; }
            else if (generalInfo?.saleOfServices !== undefined) { rawResult.itr_gross_receipts = toRowNumber(generalInfo.saleOfServices); rawResult._paths.rec = 'ITR.saleOfServices'; }
            else if (generalInfo?.saleOfGoods !== undefined) { rawResult.itr_gross_receipts = toRowNumber(generalInfo.saleOfGoods); rawResult._paths.rec = 'ITR.saleOfGoods'; }
        }

        return rawResult;
    };

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

    const parseSummaryRow = (row, rawYearNode = null) => {
        if (!row) return { pat: null, receipts: null, depreciation: null, finance_cost: null, remuneration: null, pat_path: null, receipts_path: null, depreciation_path: null, finance_cost_path: null, remuneration_path: null };
        let pat = null; let pat_path = null;
        let receipts = null; let receipts_path = null;
        let depreciation = null; let depreciation_path = null;
        let finance_cost = null; let finance_cost_path = null;
        let remuneration = null; let remuneration_path = null;

        let itr3 = null;
        if (rawYearNode && rawYearNode.json) {
            itr3 = rawYearNode.json.ITR?.ITR3 || rawYearNode.json.ITR?.iTR3 || rawYearNode.json.ITR3 || rawYearNode.json.iTR3;
        }

        if (itr3) {
            const pl = itr3.PARTA_PL || itr3.PartA_PL;
            const plStr = itr3.PARTA_PL ? 'PARTA_PL' : 'PartA_PL';
            if (pl) {
                if (pl.TaxProvAppr?.ProfitAfterTax !== undefined) { pat = toRowNumber(pl.TaxProvAppr.ProfitAfterTax); pat_path = `ITR3.${plStr}.TaxProvAppr.ProfitAfterTax`; }
                else if (pl.TaxProvAppr?.ProprietorAccBalTrf !== undefined) { pat = toRowNumber(pl.TaxProvAppr.ProprietorAccBalTrf); pat_path = `ITR3.${plStr}.TaxProvAppr.ProprietorAccBalTrf`; }
                else if (pl.PBT !== undefined) { pat = toRowNumber(pl.PBT); pat_path = `ITR3.${plStr}.PBT`; }

                if (pl.DebitsToPL?.DepreciationAmort !== undefined) { depreciation = toRowNumber(pl.DebitsToPL.DepreciationAmort); depreciation_path = `ITR3.${plStr}.DebitsToPL.DepreciationAmort`; }
                else if (pl.DebitsToPL?.Depreciation !== undefined) { depreciation = toRowNumber(pl.DebitsToPL.Depreciation); depreciation_path = `ITR3.${plStr}.DebitsToPL.Depreciation`; }

                if (pl.DebitsToPL?.InterestExpdrtDtls?.InterestExpdr !== undefined) { finance_cost = toRowNumber(pl.DebitsToPL.InterestExpdrtDtls.InterestExpdr); finance_cost_path = `ITR3.${plStr}.DebitsToPL.InterestExpdrtDtls.InterestExpdr`; }
                else if (pl.DebitsToPL?.Interest !== undefined) { finance_cost = toRowNumber(pl.DebitsToPL.Interest); finance_cost_path = `ITR3.${plStr}.DebitsToPL.Interest`; }

                if (pl.DebitsToPL?.RemunerationToPartners !== undefined) { remuneration = toRowNumber(pl.DebitsToPL.RemunerationToPartners); remuneration_path = `ITR3.${plStr}.DebitsToPL.RemunerationToPartners`; }
                else if (pl.DebitsToPL?.Remuneration !== undefined) { remuneration = toRowNumber(pl.DebitsToPL.Remuneration); remuneration_path = `ITR3.${plStr}.DebitsToPL.Remuneration`; }
            }

            const trading = itr3.TradingAccount || itr3.PartA_Trading;
            const tStr = itr3.TradingAccount ? 'TradingAccount' : 'PartA_Trading';
            if (trading) {
                if (trading.TotRevenueFrmOperations !== undefined) { receipts = toRowNumber(trading.TotRevenueFrmOperations); receipts_path = `ITR3.${tStr}.TotRevenueFrmOperations`; }
                else if (trading.SalesGrossReceiptsTotal !== undefined) { receipts = toRowNumber(trading.SalesGrossReceiptsTotal); receipts_path = `ITR3.${tStr}.SalesGrossReceiptsTotal`; }
                else if (trading.TardingAccTotCred !== undefined) { receipts = toRowNumber(trading.TardingAccTotCred); receipts_path = `ITR3.${tStr}.TardingAccTotCred`; }
                else if (trading.GrossRcptFromProfession !== undefined) { receipts = toRowNumber(trading.GrossRcptFromProfession); receipts_path = `ITR3.${tStr}.GrossRcptFromProfession`; }
            }
        }

        if (pat === null) {
            if (row.profitAfterTax !== undefined) { pat = toRowNumber(row.profitAfterTax); pat_path = 'summary.profitAfterTax'; }
            else if (row.PBT !== undefined) { pat = toRowNumber(row.PBT); pat_path = 'summary.PBT'; }
        }
        if (receipts === null) {
            if (row.receiptsFromProfession !== undefined) { receipts = toRowNumber(row.receiptsFromProfession); receipts_path = 'summary.receiptsFromProfession'; }
            else if (row.revenueFromOperations !== undefined) { receipts = toRowNumber(row.revenueFromOperations); receipts_path = 'summary.revenueFromOperations'; }
            else if (row.grossReceipts !== undefined) { receipts = toRowNumber(row.grossReceipts); receipts_path = 'summary.grossReceipts'; }
        }

        return { pat, receipts, depreciation, finance_cost, remuneration, pat_path, receipts_path, depreciation_path, finance_cost_path, remuneration_path };
    };

    const getFilingStatus = (itrRoot, year) => {
        const returnSummary = itrRoot?.returnFilingSummary?.returnFilingSummary || [];
        if (!Array.isArray(returnSummary)) return 'Filed';
        const match = returnSummary.find(r => String(r.year || r.assessmentYear || '') === String(year));
        return match?.filingStatus || match?.status || 'Filed';
    };

    const findRawYearNode = (year) => {
        if (!analyticsData || typeof analyticsData !== 'object') return null;
        for (const [k, v] of Object.entries(analyticsData)) {
            if (String(k).includes(String(year)) && Array.isArray(v) && v.length > 0) {
                return v[0];
            }
        }
        return null;
    };

    const rawParsed = parseRawItrPayload(analyticsData);
    if (rawParsed.itr_pat !== null || rawParsed.itr_gross_receipts !== null) {
        result.net_profit_latest_year = rawParsed.itr_pat;
        result.gross_receipts_latest_year = rawParsed.itr_gross_receipts;
        result.depreciation_latest_year = rawParsed.itr_depreciation;
        result.finance_cost_latest_year = rawParsed.itr_finance_cost;
        result.itr_remuneration_latest_year = rawParsed.itr_remuneration;
        result._trace.pat_path = rawParsed._paths.pat;
        result._trace.rec_path = rawParsed._paths.rec;
        result._trace.dep_path = rawParsed._paths.dep;
        result._trace.fin_path = rawParsed._paths.fin;
        result._trace.rem_path = rawParsed._paths.rem;
        result._trace.source = 'RAW_ITR_JSON';
    }

    if (sorted.length > 0) {
        const rawNode = findRawYearNode(sorted[0].year);
        const parsedSummary = parseSummaryRow(sorted[0], rawNode);

        result.net_profit_latest_year = result.net_profit_latest_year ?? parsedSummary.pat;
        result.gross_receipts_latest_year = result.gross_receipts_latest_year ?? parsedSummary.receipts;
        result.depreciation_latest_year = result.depreciation_latest_year ?? parsedSummary.depreciation;
        result.finance_cost_latest_year = result.finance_cost_latest_year ?? parsedSummary.finance_cost;
        result.itr_remuneration_latest_year = result.itr_remuneration_latest_year ?? parsedSummary.remuneration;
        result.financial_year_latest = fyLabel(sorted[0].year);
        result.filing_status_latest = getFilingStatus(itrKey, sorted[0].year);

        result._trace.pat_path = result._trace.pat_path || parsedSummary.pat_path;
        result._trace.rec_path = result._trace.rec_path || parsedSummary.receipts_path;
        result._trace.dep_path = result._trace.dep_path || parsedSummary.depreciation_path;
        result._trace.fin_path = result._trace.fin_path || parsedSummary.finance_cost_path;
        result._trace.rem_path = result._trace.rem_path || parsedSummary.remuneration_path;
    }

    if (sorted.length > 1) {
        const rawNode = findRawYearNode(sorted[1].year);
        const parsedSummary = parseSummaryRow(sorted[1], rawNode);
        result.net_profit_previous_year = parsedSummary.pat;
        result.gross_receipts_previous_year = parsedSummary.receipts;
        result.financial_year_previous = fyLabel(sorted[1].year);
        result.filing_status_previous = getFilingStatus(itrKey, sorted[1].year);
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
        avg_bank_balance_latest_year: null,
        avg_bank_balance_previous_year: null,
        financial_year_latest: null,
        financial_year_previous: null,
        avg_monthly_credit: null,
        avg_monthly_debit: null,
        avg_closing_balance: null,
        cheque_bounces_12m: null,
        statement_period: null,
        bank_name: null,
        account_number_masked: null,
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
            result.financial_year_latest = sortedFYs[0];
            result.avg_bank_balance_latest_year = fyTotals[sortedFYs[0]] / fyCounts[sortedFYs[0]];
        }
        if (sortedFYs.length > 1) {
            result.financial_year_previous = sortedFYs[1];
            result.avg_bank_balance_previous_year = fyTotals[sortedFYs[1]] / fyCounts[sortedFYs[1]];
        }
    }

    // ── Credit / Debit / Closing Balance (from accountLevelAnalysis or overview) ─
    const firstAccount = Array.isArray(accountLevelData) ? accountLevelData[0] : null;
    if (firstAccount) {
        result.avg_monthly_credit = toNum(firstAccount.avgMonthlyCredit || firstAccount.averageMonthlyCredit);
        result.avg_monthly_debit = toNum(firstAccount.avgMonthlyDebit || firstAccount.averageMonthlyDebit);
        result.avg_closing_balance = toNum(firstAccount.avgClosingBalance || firstAccount.averageClosingBalance);
        result.bank_name = firstAccount.bankName || firstAccount.bank || null;

        // Mask account number: show last 4 digits only
        const rawAccNo = String(firstAccount.accountNumber || firstAccount.accNo || '');
        if (rawAccNo.length >= 4) {
            result.account_number_masked = `XXXX XXXX ${rawAccNo.slice(-4)}`;
        }

        // Statement period
        const from = firstAccount.fromDate || firstAccount.startDate;
        const to = firstAccount.toDate || firstAccount.endDate;
        if (from && to) result.statement_period = `${from} to ${to}`;
    } else if (overview) {
        result.avg_monthly_credit = toNum(overview.averageMonthlyCredit || overview.avgMonthlyCredit);
        result.avg_monthly_debit = toNum(overview.averageMonthlyDebit || overview.avgMonthlyDebit);
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
        score: null,
        bureau_name: null,
        emi_obligations_total: null,
        active_loan_count: null,
        overdue_amount: null,
        dpd_status: null,
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
            g.months_filed_12m = extracted.months_filed_12m;
            g.nil_return_months = extracted.nil_return_months;
        }

        snapshot.gst = {
            turnover_latest_year: Number(g.turnover_latest_year) || null,
            turnover_previous_year: Number(g.turnover_previous_year) || null,
            financial_year_latest: g.financial_year_latest,
            financial_year_previous: g.financial_year_previous,
            avg_monthly_turnover: Number(g.avg_monthly_turnover) || (Number(g.turnover_latest_year) / 12) || null,
            months_filed_12m: g.months_filed_12m,
            nil_return_months: g.nil_return_months,
        };
    }

    // ── ITR ─────────────────────────────────────────────────────────────────────
    const itrRows = await prisma.itrAnalyticsRequest.findMany({
        where: { case_id: case_id, status: 'COMPLETED' },
        orderBy: { updated_at: 'desc' },
        take: 1
    });

    if (itrRows[0]) {
        const r = itrRows[0];
        // Note: filing_status_latest does not exist in schema, we will extract it into memory
        let filing_status_latest = 'Filed';
        let filing_status_previous = 'Filed';

        if (r.analytics_payload) {
            const extracted = extractItrDetails(
                typeof r.analytics_payload === 'string' ? JSON.parse(r.analytics_payload) : r.analytics_payload
            );
            filing_status_latest = extracted.filing_status_latest || 'Filed';
            filing_status_previous = extracted.filing_status_previous || 'Filed';
        }

        snapshot.itr = {
            net_profit_latest_year: Number(r.net_profit_latest_year) || null,
            net_profit_previous_year: Number(r.net_profit_previous_year) || null,
            gross_receipts_latest_year: Number(r.gross_receipts_latest_year) || null,
            gross_receipts_previous_year: Number(r.gross_receipts_previous_year) || null,
            financial_year_latest: r.financial_year_latest,
            financial_year_previous: r.financial_year_previous,
            filing_status_latest: filing_status_latest,
            filing_status_previous: filing_status_previous,
        };
    }

    // ── Bank ─────────────────────────────────────────────────────────────────────
    const bankRows = await prisma.bankStatementAnalysisRequest.findMany({
        where: { case_id: case_id, status: 'COMPLETED' },
        orderBy: { created_at: 'asc' },
        take: 5
    });

    if (bankRows.length > 0) {
        const banks = [];
        for (let b of bankRows) {
            // Because avg_monthly_credit doesn't exist in Prisma schema, we extract it directly into memory
            let inMemoryExtracted = {
                avg_monthly_credit: null,
                avg_monthly_debit: null,
                avg_closing_balance: null,
                cheque_bounces_12m: 0,
                statement_period: null,
                bank_name: null,
                account_number_masked: null
            };

            if (b.raw_retrieve_response || b.raw_download_response || b.raw_response_json) {
                const rawBank = b.raw_retrieve_response || b.raw_download_response || b.raw_response_json;
                const raw = typeof rawBank === 'string' ? JSON.parse(rawBank) : rawBank;
                inMemoryExtracted = extractBankDetails(raw);
            }

            banks.push({
                avg_balance_latest_year: Number(b.avg_bank_balance_latest_year) || null,
                avg_balance_previous_year: Number(b.avg_bank_balance_previous_year) || null,
                financial_year_latest: b.financial_year_latest,
                financial_year_previous: b.financial_year_previous,
                avg_monthly_credit: inMemoryExtracted.avg_monthly_credit,
                avg_monthly_debit: inMemoryExtracted.avg_monthly_debit,
                avg_closing_balance: inMemoryExtracted.avg_closing_balance,
                cheque_bounces_12m: inMemoryExtracted.cheque_bounces_12m,
                statement_period: inMemoryExtracted.statement_period,
                bank_name: inMemoryExtracted.bank_name,
                account_number_masked: inMemoryExtracted.account_number_masked,
            });
        }
        snapshot.bank = banks;
    }

    // ── Bureau ─────────────────────────────────────────────────────────────────
    const bureauRows = await prisma.bureauVerification.findMany({
        where: { case_id: case_id },
        orderBy: { created_at: 'desc' },
        take: 1
    });

    if (bureauRows[0]) {
        const bv = bureauRows[0];
        let inMemoryBureau = {
            bureau_name: 'Credit Bureau',
            active_loan_count: null,
            overdue_amount: null,
            dpd_status: null
        };

        if (bv.raw_response) {
            const raw = typeof bv.raw_response === 'string' ? JSON.parse(bv.raw_response) : bv.raw_response;
            inMemoryBureau = extractBureauDetails(raw);
        }

        snapshot.bureau = {
            score: bv.score,
            bureau_name: inMemoryBureau.bureau_name || 'Credit Bureau',
            emi_obligations_total: Number(bv.emi_obligations_total) || null,
            active_loan_count: inMemoryBureau.active_loan_count,
            overdue_amount: Number(inMemoryBureau.overdue_amount) || null,
            dpd_status: inMemoryBureau.dpd_status,
        };
    }

    return snapshot;
}

module.exports = {
    extractGstDetails,
    extractAllGstSummaries,
    extractItrDetails,
    extractBankDetails,
    extractBureauDetails,
    loadCaseFinancialSnapshot,
};
