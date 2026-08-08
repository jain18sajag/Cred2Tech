const prisma = require('../../config/db');
const { extractGstDetails } = require('./financial.extractor');

/**
 * Priority of sources for GST turnover.
 * LENDER > PROVIDER_REPORT > GSTR3B > GSTR1
 */
const SOURCE_PRIORITY = {
    'PROVIDER_REPORT': 10,
    'GSTR3B': 20,
    'GSTR1': 30
};

/**
 * Fetches the best available GST analytics snapshot for a given context.
 * Prioritizes completed processing metrics over new/empty rows.
 *
 * @param {Object} params
 * @param {number} params.tenantId
 * @param {number} [params.caseId]
 * @param {number} [params.applicantId]
 * @param {string} [params.gstin]
 * @returns {Promise<Object>} A backwards-compatible snapshot object.
 */
async function getBestUsableGstSnapshot({ tenantId, caseId, applicantId, gstin }) {
    if (!tenantId || (!caseId && !applicantId && !gstin)) {
        return null;
    }

    const whereClause = { tenant_id: tenantId };
    if (caseId) whereClause.case_id = caseId;
    if (applicantId) whereClause.applicant_id = applicantId;
    if (gstin) whereClause.gstin = gstin;

    // Fetch the most recently completed request first
    const requests = await prisma.gstrAnalyticsRequest.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' }
    });

    if (!requests || requests.length === 0) return null;

    let bestRequest = requests.find(r => r.metrics_status === 'COMPLETED');
    if (!bestRequest) {
        bestRequest = requests[0]; // fallback to latest even if not completed
    }

    const rollingSnapshot = _buildRollingSnapshotFromRequest(bestRequest);

    // Parsed per-FY summaries are fetched regardless of whether a rolling
    // snapshot exists — they're the only source with a genuine previous-year
    // figure. A rolling-window pull's own turnover_previous_year column is
    // frequently never populated (extractGstFySnapshot only sets it when the
    // vendor's Overview_Monthly report format was present at ingestion), so
    // returning the rolling snapshot immediately silently discarded a real,
    // already-parsed previous-year turnover sitting in
    // gst_financial_year_summaries — this was the root cause of "Previous
    // Year (FY 2024-25) ... Gross Turnover / Receipts as -" even after a
    // successful GST pull with multiple FY rows on file.
    const summaries = await prisma.gstFinancialYearSummary.findMany({
        where: {
            gst_request_id: bestRequest.id,
            processing_version: bestRequest.processing_version
        }
    });

    // Group by FY, pick the best source
    const bestByFy = {};
    for (const row of summaries) {
        const fy = row.financial_year;
        if (!bestByFy[fy]) {
            bestByFy[fy] = row;
        } else {
            const currentPriority = SOURCE_PRIORITY[bestByFy[fy].source] || 100;
            const rowPriority = SOURCE_PRIORITY[row.source] || 100;
            if (rowPriority < currentPriority) {
                bestByFy[fy] = row;
            } else if (rowPriority === currentPriority && row.is_complete && !bestByFy[fy].is_complete) {
                bestByFy[fy] = row;
            }
        }
    }

    // Sort FYs descending (e.g., FY 2023-24 > FY 2022-23), and only consider
    // an FY "meaningful" (usable as a whole-year comparison figure) once at
    // least half of it has been filed — the most recent FY in this list is
    // often the still-in-progress current year (e.g. 2-3 months filed),
    // which is not what "previous year" turnover should ever resolve to.
    const sortedFys = Object.values(bestByFy).sort((a, b) => b.financial_year.localeCompare(a.financial_year));
    const meaningfulFys = sortedFys.filter(s => (s.months_filed || 0) >= 6);

    if (rollingSnapshot) {
        if (rollingSnapshot.turnover_previous_year == null && meaningfulFys.length > 0) {
            // meaningfulFys[0] is the most recent substantially-complete FY,
            // which is what the rolling snapshot's own turnover_latest_year
            // already represents (just computed a different way, over a
            // rolling window rather than a strict FY) — the entry after it
            // is the actual previous year to backfill.
            const previousFy = meaningfulFys.length > 1 ? meaningfulFys[1] : null;
            if (previousFy) {
                rollingSnapshot.turnover_previous_year = previousFy.turnover;
                rollingSnapshot.financial_year_previous = rollingSnapshot.financial_year_previous || previousFy.financial_year;
            }
        }
        return rollingSnapshot;
    }

    if (!summaries || summaries.length === 0) {
        // Fallback for requests that haven't been processed by the new pipeline yet
        return {
            turnover_latest_year: bestRequest.turnover_latest_year,
            turnover_previous_year: bestRequest.turnover_previous_year,
            financial_year_latest: bestRequest.financial_year_latest,
            financial_year_previous: bestRequest.financial_year_previous,
            avg_monthly_turnover: bestRequest.avg_monthly_turnover,
            months_filed_12m: bestRequest.months_filed_12m,
            nil_return_months: bestRequest.nil_return_months
        };
    }

    if (sortedFys.length === 0) return null;

    const latest = sortedFys[0];
    const previous = sortedFys.length > 1 ? sortedFys[1] : null;

    // Formulate a backwards-compatible object
    return {
        turnover_latest_year: latest.turnover,
        turnover_previous_year: previous ? previous.turnover : null,
        financial_year_latest: latest.financial_year,
        financial_year_previous: previous ? previous.financial_year : null,
        avg_monthly_turnover: latest.months_filed > 0 ? latest.turnover / latest.months_filed : null,
        months_filed_12m: latest.months_filed,
        nil_return_months: latest.zero_filing_months,
        _raw_summaries: summaries, // to allow consumers to access the exact Indian FY slices if needed
        _best_request_id: bestRequest.id
    };
}

function _buildRollingSnapshotFromRequest(request) {
    if (!request) return null;

    if (request.raw_report_data) {
        try {
            const extracted = extractGstDetails(request.raw_report_data);
            if (extracted?.turnover_latest_year) {
                return {
                    turnover_latest_year: extracted.turnover_latest_year,
                    turnover_previous_year: request.turnover_previous_year,
                    financial_year_latest: extracted.financial_year_latest,
                    financial_year_previous: request.financial_year_previous,
                    avg_monthly_turnover: extracted.avg_monthly_turnover,
                    months_filed_12m: extracted.months_filed_12m,
                    nil_return_months: extracted.nil_return_months,
                    selected_turnover_source: 'GSTR1_GROSS_SALES_ROLLING_12M_RAW_REPORT',
                    _best_request_id: request.id
                };
            }
        } catch (err) {
            console.warn(`[GST Snapshot] Raw report rolling turnover parse failed for request ${request.id}: ${err.message}`);
        }
    }

    if (request.rolling_12_month_turnover || request.avg_monthly_turnover) {
        const turnover = request.rolling_12_month_turnover || request.turnover_latest_year || null;
        return {
            turnover_latest_year: turnover,
            turnover_previous_year: request.turnover_previous_year,
            financial_year_latest: request.rolling_12_month_end_period || request.financial_year_latest,
            financial_year_previous: request.financial_year_previous,
            avg_monthly_turnover: request.avg_monthly_turnover || (turnover ? Number(turnover) / 12 : null),
            months_filed_12m: request.months_filed_12m,
            nil_return_months: request.nil_return_months,
            selected_turnover_source: request.selected_turnover_source || 'GSTR1_GROSS_SALES_ROLLING_12M',
            _best_request_id: request.id
        };
    }

    return null;
}

module.exports = {
    getBestUsableGstSnapshot
};
