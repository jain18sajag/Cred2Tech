const prisma = require('../../config/db');
const { extractGstDetails, extractAllGstSummaries } = require('./financial.extractor');

/**
 * Idempotent service to finalize a GST Analytics Request.
 * It fetches the request, processes the raw payloads using the new GST parser,
 * and upserts the structured rows into gst_financial_year_summaries.
 * Finally, it updates the status of the request.
 */
async function finalizeGstAnalyticsRequest(requestId, tenantId) {
    // We enforce tenant isolation
    const request = await prisma.gstrAnalyticsRequest.findFirst({
        where: { id: requestId, tenant_id: tenantId }
    });

    if (!request) {
        throw new Error(`GST Analytics Request not found: ${requestId}`);
    }

    if (request.metrics_status === 'COMPLETED' || request.status === 'COMPLETED') {
        // Idempotent return
        return request;
    }

    const newVersion = (request.processing_version || 1) + 1;

    try {
        const summaries = extractAllGstSummaries(request.raw_fetch_data, request.raw_report_data);
        const reportSnapshot = request.raw_report_data
            ? extractGstDetails(request.raw_report_data)
            : extractGstDetails(request.raw_fetch_data);

        // Perform the updates in a transaction
        await prisma.$transaction(async (tx) => {
            // Invalidate older summaries by logically soft-deleting them if needed,
            // but the uniqueness is on [gst_request_id, financial_year, source, processing_version]
            // We just insert the new processing version.
            
            for (const s of summaries) {
                await tx.gstFinancialYearSummary.create({
                    data: {
                        gst_request_id: request.id,
                        case_id: request.case_id,
                        applicant_id: request.applicant_id,
                        gstin: request.gstin,
                        financial_year: s.financial_year,
                        source: s.source,
                        turnover: s.turnover,
                        months_available: s.months_available,
                        months_filed: s.months_filed,
                        zero_filing_months: s.zero_filing_months,
                        unavailable_months: s.unavailable_months,
                        is_complete: s.is_complete,
                        processing_version: newVersion
                    }
                });
            }

            // Update the main request
            await tx.gstrAnalyticsRequest.update({
                where: { id: request.id },
                data: {
                    processing_version: newVersion,
                    metrics_status: 'COMPLETED',
                    status: 'COMPLETED',
                    metrics_extracted_at: new Date(),
                    turnover_latest_year: reportSnapshot.turnover_latest_year,
                    financial_year_latest: reportSnapshot.financial_year_latest,
                    avg_monthly_turnover: reportSnapshot.avg_monthly_turnover,
                    months_filed_12m: reportSnapshot.months_filed_12m,
                    nil_return_months: reportSnapshot.nil_return_months,
                    rolling_12_month_turnover: reportSnapshot.turnover_latest_year,
                    rolling_12_month_end_period: reportSnapshot.financial_year_latest,
                    selected_turnover_latest_fy: reportSnapshot.turnover_latest_year,
                    selected_turnover_source: 'GSTR1_GROSS_SALES_ROLLING_12M'
                }
            });
        });

        // Refetch and return
        return await prisma.gstrAnalyticsRequest.findFirst({
            where: { id: request.id }
        });
    } catch (error) {
        await prisma.gstrAnalyticsRequest.update({
            where: { id: request.id },
            data: {
                metrics_status: 'FAILED',
                metrics_error: error.message,
                status: 'FAILED'
            }
        });
        throw error;
    }
}

module.exports = {
    finalizeGstAnalyticsRequest
};
