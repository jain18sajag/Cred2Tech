// proposal.service.js
const prisma = require('../../config/db');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function generateProposalNumber(caseId, lenderCode, seq) {
    const code = (lenderCode || 'LENDER').toUpperCase().replace(/\s+/g, '').slice(0, 8);
    const s = String(seq).padStart(2, '0');
    return `PROP-${caseId}-${code}-${s}`;
}

/**
 * Get next sequence number for proposals on this case+lender
 */
async function getNextSeq(caseId, lenderId) {
    const count = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS cnt FROM proposals WHERE case_id = $1 AND lender_id = $2`,
        caseId, lenderId
    );
    return Number(count[0]?.cnt || 0) + 1;
}

/**
 * Resolve lender code from lenders table (text id)
 */
async function getLenderCode(lenderId) {
    const rows = await prisma.$queryRawUnsafe(
        `SELECT code FROM lenders WHERE id = $1 LIMIT 1`,
        lenderId
    );
    return rows[0]?.code || lenderId;
}

// ──────────────────────────────────────────────────────────────────────────────
// createProposalDraft
// ──────────────────────────────────────────────────────────────────────────────
async function createProposalDraft({ case_id, lender_id, scheme_id, user_id, tenant_id }) {
    // Fetch ESR financial snapshot for this case
    const esrFinancials = await prisma.$queryRawUnsafe(
        `SELECT * FROM case_esr_financials WHERE case_id = $1 LIMIT 1`,
        case_id
    );
    const esr = esrFinancials[0] || null;

    // Fetch ESR eligibility report to find lender-specific output
    const esrReport = await prisma.$queryRawUnsafe(
        `SELECT id, raw_payload FROM eligibility_reports WHERE case_id = $1 LIMIT 1`,
        case_id
    );
    const report = esrReport[0] || null;
    let lenderEligibility = null;
    if (report?.raw_payload) {
        const payload = typeof report.raw_payload === 'string'
            ? JSON.parse(report.raw_payload) : report.raw_payload;
        lenderEligibility = (payload.lenders || []).find(l => String(l.lender_id) === String(lender_id)) || null;
    }

    const lenderCode = await getLenderCode(lender_id);
    const seq = await getNextSeq(case_id, lender_id);
    const proposalNumber = generateProposalNumber(case_id, lenderCode, seq);

    // Derive prefilled values from ESR output and case ESR financials
    const eligibleAmount = lenderEligibility?.final_eligible_loan_amount || null;
    const roi_min = lenderEligibility?.roi_min || null;
    const roi_max = lenderEligibility?.roi_max || null;
    const tenure_months = lenderEligibility?.max_tenure_months || null;
    const preferredSchemeId = scheme_id || null;

    const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO proposals (
            tenant_id, case_id, lender_id, scheme_id, case_esr_financial_id,
            proposal_number, proposal_status, lender_submission_status,
            requested_amount, eligible_amount, roi_min, roi_max, tenure_months,
            created_by_user_id, updated_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,'draft','draft',$7,$8,$9,$10,$11,$12,$12)
        RETURNING *
    `,
        tenant_id, case_id, lender_id, preferredSchemeId, esr?.id || null,
        proposalNumber,
        esr?.requested_loan_amount || eligibleAmount,
        eligibleAmount,
        roi_min, roi_max, tenure_months,
        user_id
    );

    const proposal = rows[0];

    // Auto-attach all existing case documents to proposal
    const caseDocs = await prisma.$queryRawUnsafe(
        `SELECT id, document_type FROM documents WHERE case_id = $1 AND status = 'ACTIVE'`,
        case_id
    );
    if (caseDocs.length > 0) {
        for (const doc of caseDocs) {
            await prisma.$executeRawUnsafe(
                `INSERT INTO proposal_documents (proposal_id, document_id, document_type)
                 VALUES ($1, $2, $3) ON CONFLICT (proposal_id, document_id) DO NOTHING`,
                proposal.id, doc.id, doc.document_type
            );
        }
    }

    return proposal;
}

// ──────────────────────────────────────────────────────────────────────────────
// getProposalForPrep (full prefill payload for frontend)
// ──────────────────────────────────────────────────────────────────────────────
async function getProposalForPrep({ proposal_id, case_id, tenant_id }) {
    // Proposal row
    const propRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM proposals WHERE id = $1 AND case_id = $2 AND tenant_id = $3 LIMIT 1`,
        proposal_id, case_id, tenant_id
    );
    if (!propRows[0]) throw new Error('Proposal not found');
    const proposal = propRows[0];

    // Case + customer
    const caseRows = await prisma.$queryRawUnsafe(`
        SELECT c.*, cu.business_name, cu.business_pan, cu.business_mobile, cu.business_vintage,
               cu.entity_type, cu.industry
        FROM cases c
        JOIN customers cu ON cu.id = c.customer_id
        WHERE c.id = $1 AND c.tenant_id = $2 LIMIT 1
    `, case_id, tenant_id);
    const caseData = caseRows[0] || {};

    // ALL applicants (primary + co-applicants)
    const allApplicants = await prisma.$queryRawUnsafe(
        `SELECT * FROM applicants WHERE case_id = $1 ORDER BY type ASC, id ASC`,
        case_id
    );
    const applicant = allApplicants.find(a => a.type === 'PRIMARY') || allApplicants[0] || {};
    const coApplicants = allApplicants.filter(a => a.type !== 'PRIMARY');

    // ESR financials
    const esrRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM case_esr_financials WHERE case_id = $1 LIMIT 1`,
        case_id
    );
    const esr = esrRows[0] || {};

    // Property
    const propDetailsRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM case_property_details WHERE case_id = $1 LIMIT 1`,
        case_id
    );
    const property = propDetailsRows[0] || {};

    // Lender name
    const lenderRows = await prisma.$queryRawUnsafe(
        `SELECT id, name, code FROM lenders WHERE id = $1 LIMIT 1`,
        proposal.lender_id
    );
    const lender = lenderRows[0] || {};

    // Scheme name
    let schemeName = null;
    if (proposal.scheme_id) {
        const schRows = await prisma.$queryRawUnsafe(
            `SELECT scheme_name FROM schemes WHERE id = $1 LIMIT 1`,
            proposal.scheme_id
        );
        schemeName = schRows[0]?.scheme_name || null;
    }

    // ESR eligibility report — find lender-specific computed values
    const esrReportRows = await prisma.$queryRawUnsafe(
        `SELECT raw_payload FROM eligibility_reports WHERE case_id = $1 LIMIT 1`,
        case_id
    );
    let lenderEligibility = null;
    if (esrReportRows[0]?.raw_payload) {
        const payload = typeof esrReportRows[0].raw_payload === 'string'
            ? JSON.parse(esrReportRows[0].raw_payload) : esrReportRows[0].raw_payload;
        lenderEligibility = (payload.lenders || []).find(l => String(l.lender_id) === String(proposal.lender_id)) || null;
    }

    // ── Financial Snapshots ──────────────────────────────────────────────────
    // GST — latest request with snapshot data (use raw_gst_data, not raw_analytics_response)
    const gstRows = await prisma.$queryRawUnsafe(`
        SELECT turnover_latest_year, turnover_previous_year,
               financial_year_latest, financial_year_previous,
               raw_gst_data
        FROM gstr_analytics_requests
        WHERE case_id = $1 AND status IN ('REPORT_READY','COMPLETED')
        ORDER BY updated_at DESC LIMIT 1
    `, case_id);
    const gstData = gstRows[0] || null;

    // Parse GST raw_gst_data for months filed, nil returns
    let gstExtraStats = { months_filed: null, nil_months: null, avg_monthly_turnover: null };
    if (gstData?.raw_gst_data) {
        try {
            const raw = typeof gstData.raw_gst_data === 'string'
                ? JSON.parse(gstData.raw_gst_data) : gstData.raw_gst_data;
            // Try to extract from common Signzy GST response shapes
            const gstpData = raw?.result?.data || raw?.data || raw;
            const table3b = gstpData?.table3BData || gstpData?.gstr3BData || [];
            gstExtraStats.months_filed = Array.isArray(table3b) ? table3b.filter(m => m && m.taxableValue > 0).length : null;
            gstExtraStats.nil_months = Array.isArray(table3b) ? table3b.filter(m => m && m.taxableValue === 0).length : null;
            if (gstData.turnover_latest_year) {
                gstExtraStats.avg_monthly_turnover = Number(gstData.turnover_latest_year) / 12;
            }
        } catch (e) { /* silent */ }
    } else if (gstData?.turnover_latest_year) {
        gstExtraStats.avg_monthly_turnover = Number(gstData.turnover_latest_year) / 12;
    }

    // ITR — latest completed request; uses analytics_payload (not raw_analytics_response)
    const itrRows = await prisma.$queryRawUnsafe(`
        SELECT net_profit_latest_year, net_profit_previous_year,
               gross_receipts_latest_year, gross_receipts_previous_year,
               financial_year_latest, financial_year_previous
        FROM itr_analytics_requests
        WHERE case_id = $1 AND status = 'COMPLETED'
        ORDER BY updated_at DESC LIMIT 1
    `, case_id);
    const itrData = itrRows[0] || null;

    // Build ITR year rows for the table
    const itrYears = [];
    if (itrData) {
        if (itrData.financial_year_latest && itrData.gross_receipts_latest_year != null) {
            itrYears.push({
                ay: `AY ${itrData.financial_year_latest}`,
                gross_receipts: itrData.gross_receipts_latest_year,
                net_profit: itrData.net_profit_latest_year,
                filing_status: 'Filed'
            });
        }
        if (itrData.financial_year_previous && itrData.gross_receipts_previous_year != null) {
            itrYears.push({
                ay: `AY ${itrData.financial_year_previous}`,
                gross_receipts: itrData.gross_receipts_previous_year,
                net_profit: itrData.net_profit_previous_year,
                filing_status: 'Filed'
            });
        }
    }

    // Bank — all completed requests ordered by created (primary = first)
    const bankRows = await prisma.$queryRawUnsafe(`
        SELECT id, avg_bank_balance_latest_year, avg_bank_balance_previous_year,
               financial_year_latest, financial_year_previous,
               report_json_url, raw_retrieve_response
        FROM bank_statement_analysis_requests
        WHERE case_id = $1 AND status = 'COMPLETED'
        ORDER BY created_at ASC LIMIT 5
    `, case_id);

    const bankAccounts = bankRows.map((b, idx) => {
        let bankDetails = {};
        if (b.raw_retrieve_response) {
            try {
                const raw = typeof b.raw_retrieve_response === 'string'
                    ? JSON.parse(b.raw_retrieve_response) : b.raw_retrieve_response;
                const accs = raw?.result?.accountLevelAnalysis || raw?.accountLevelAnalysis || [];
                if (accs[0]) {
                    bankDetails = {
                        bank_name: accs[0].bankName || accs[0].bank,
                        account_number: accs[0].accountNumber ? `XXXX XXXX ${String(accs[0].accountNumber).slice(-4)}` : null,
                        avg_monthly_credit: accs[0].avgMonthlyCredit || accs[0].averageMonthlyCredit,
                        avg_monthly_debit: accs[0].avgMonthlyDebit || accs[0].averageMonthlyDebit,
                        avg_closing_balance: accs[0].avgClosingBalance || accs[0].averageClosingBalance,
                        cheque_bounces: accs[0].chequeBounces || 0,
                        statement_period: accs[0].statementPeriod || null,
                    };
                }
            } catch (e) { /* silent */ }
        }
        return {
            label: idx === 0 ? 'Primary Account' : `Account ${idx + 1}`,
            avg_balance_latest: b.avg_bank_balance_latest_year,
            avg_balance_previous: b.avg_bank_balance_previous_year,
            fy_latest: b.financial_year_latest,
            ...bankDetails,
        };
    });

    // ── Case Documents (grouped + proposal attachment status) ────────────────
    const allCaseDocs = await prisma.$queryRawUnsafe(`
        SELECT d.id, d.document_type, d.original_file_name, d.file_name, d.created_at,
               pd.id AS proposal_doc_id
        FROM documents d
        LEFT JOIN proposal_documents pd ON pd.document_id = d.id AND pd.proposal_id = $1
        WHERE d.case_id = $2 AND d.status = 'ACTIVE'
        ORDER BY d.document_type, d.created_at DESC
    `, proposal_id, case_id);

    // KYC document requirements per applicant
    const KYC_DOC_TYPES = ['PAN_CARD', 'AADHAAR', 'PASSPORT', 'VOTER_ID'];
    const INCOME_DOC_TYPES = ['ITR', 'FORM_16', 'SALARY_SLIP', 'CA_CERTIFICATE', 'GST_PDF', 'GST_EXCEL', 'GST_JSON'];
    const BANK_DOC_TYPES = ['BANK_JSON', 'BANK_EXCEL', 'BANK_STATEMENT'];
    const PROPERTY_DOC_TYPES = ['PROPERTY_DOCUMENT', 'SALE_DEED', 'TITLE_DEED', 'NOC'];

    function catDoc(doc) {
        if (KYC_DOC_TYPES.includes(doc.document_type)) return 'KYC';
        if (INCOME_DOC_TYPES.includes(doc.document_type)) return 'Income Proof';
        if (BANK_DOC_TYPES.includes(doc.document_type)) return 'Banking';
        if (PROPERTY_DOC_TYPES.includes(doc.document_type)) return 'Property';
        return 'Other';
    }

    const categorized = { 'KYC': [], 'Income Proof': [], 'Banking': [], 'Property': [], 'Other': [] };
    for (const doc of allCaseDocs) {
        categorized[catDoc(doc)].push({ ...doc, is_attached: doc.proposal_doc_id != null });
    }

    return {
        proposal,
        lender,
        scheme_name: schemeName,
        lender_eligibility: lenderEligibility,
        prefill: {
            applicant_name:    applicant.name,
            pan:               applicant.pan_number || caseData.business_pan,
            mobile:            applicant.mobile || caseData.business_mobile,
            cibil_score:       applicant.cibil_score || esr.bureau_score,
            entity_name:       caseData.business_name,
            entity_type:       caseData.entity_type,
            business_vintage:  caseData.business_vintage,
            industry:          caseData.industry,
            product_type:      esr.product_type || caseData.product_type,
            income_method:     esr.selected_income_method,
            monthly_income:    esr.selected_monthly_income,
            existing_emi:      esr.existing_obligations,
            property_value:    esr.property_value || property.market_value,
            property_type:     esr.property_type || property.property_type,
            occupancy_type:    esr.occupancy_type || property.occupancy_status,
            property_address:  property.remarks || null,
        },
        applicants: allApplicants,
        co_applicants: coApplicants,
        financial_summary: {
            gst: {
                turnover_latest: gstData?.turnover_latest_year || null,
                turnover_previous: gstData?.turnover_previous_year || null,
                fy_latest: gstData?.financial_year_latest || null,
                fy_previous: gstData?.financial_year_previous || null,
                avg_monthly_turnover: gstExtraStats.avg_monthly_turnover,
                months_filed: gstExtraStats.months_filed,
                nil_months: gstExtraStats.nil_months,
            },
            itr_years: itrYears,
            bank_accounts: bankAccounts,
        },
        documents_by_category: categorized,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// updateProposalDraft
// ──────────────────────────────────────────────────────────────────────────────
async function updateProposalDraft({ proposal_id, case_id, tenant_id, user_id, fields }) {
    const allowed = ['requested_amount','tenure_months','loan_purpose','remarks','additional_notes','preferred_banking_program'];
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const key of allowed) {
        if (fields[key] !== undefined) {
            sets.push(`${key} = $${idx}`);
            vals.push(fields[key]);
            idx++;
        }
    }
    if (sets.length === 0) throw new Error('No valid fields to update');
    sets.push(`updated_by_user_id = $${idx}`, `updated_at = NOW()`);
    vals.push(user_id);
    idx++;
    vals.push(proposal_id, case_id, tenant_id);

    const rows = await prisma.$queryRawUnsafe(
        `UPDATE proposals SET ${sets.join(', ')} WHERE id = $${idx} AND case_id = $${idx+1} AND tenant_id = $${idx+2} RETURNING *`,
        ...vals
    );
    if (!rows[0]) throw new Error('Proposal not found or unauthorized');
    return rows[0];
}

// ──────────────────────────────────────────────────────────────────────────────
// attachDocumentsToProposal
// ──────────────────────────────────────────────────────────────────────────────
async function attachDocumentsToProposal({ proposal_id, case_id, tenant_id, document_ids }) {
    // Verify proposal belongs to case/tenant
    const check = await prisma.$queryRawUnsafe(
        `SELECT id FROM proposals WHERE id = $1 AND case_id = $2 AND tenant_id = $3`,
        proposal_id, case_id, tenant_id
    );
    if (!check[0]) throw new Error('Proposal not found or unauthorized');

    for (const doc_id of document_ids) {
        // Fetch doc type
        const docRows = await prisma.$queryRawUnsafe(
            `SELECT document_type FROM documents WHERE id = $1 LIMIT 1`, doc_id
        );
        const docType = docRows[0]?.document_type || null;
        await prisma.$executeRawUnsafe(
            `INSERT INTO proposal_documents (proposal_id, document_id, document_type)
             VALUES ($1, $2, $3) ON CONFLICT (proposal_id, document_id) DO NOTHING`,
            proposal_id, doc_id, docType
        );
    }

    // Return updated document list
    return prisma.$queryRawUnsafe(
        `SELECT pd.*, d.original_file_name, d.document_type
         FROM proposal_documents pd JOIN documents d ON d.id = pd.document_id
         WHERE pd.proposal_id = $1`, proposal_id
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// detachDocumentFromProposal
// ──────────────────────────────────────────────────────────────────────────────
async function detachDocumentFromProposal({ proposal_id, document_id, tenant_id }) {
    await prisma.$executeRawUnsafe(
        `DELETE FROM proposal_documents WHERE proposal_id = $1 AND document_id = $2`,
        proposal_id, document_id
    );
    return { success: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// submitProposal
// ──────────────────────────────────────────────────────────────────────────────
async function submitProposal({ proposal_id, case_id, user_id, tenant_id }) {
    // Verify proposal
    const propRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM proposals WHERE id = $1 AND case_id = $2 AND tenant_id = $3 LIMIT 1`,
        proposal_id, case_id, tenant_id
    );
    if (!propRows[0]) throw new Error('Proposal not found or unauthorized');
    if (propRows[0].proposal_status === 'submitted') throw new Error('Proposal already submitted');

    // Update proposal
    await prisma.$executeRawUnsafe(
        `UPDATE proposals SET proposal_status='submitted', lender_submission_status='submitted',
         submitted_at=NOW(), updated_at=NOW(), updated_by_user_id=$1
         WHERE id=$2`,
        user_id, proposal_id
    );

    // Update case stage ONLY if no other submitted proposals exist for this case
    const alreadySubmitted = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) AS cnt FROM proposals
         WHERE case_id = $1 AND proposal_status = 'submitted' AND id != $2`,
        case_id, proposal_id
    );
    if (Number(alreadySubmitted[0]?.cnt || 0) === 0) {
        // First submission — advance stage
        await prisma.$executeRawUnsafe(
            `UPDATE cases SET stage = 'LEAD_SENT_TO_LENDER', updated_at = NOW() WHERE id = $1`,
            case_id
        );
    }

    return { success: true, proposal_id, submitted_at: new Date().toISOString() };
}

// ──────────────────────────────────────────────────────────────────────────────
// cloneProposalForLender
// ──────────────────────────────────────────────────────────────────────────────
async function cloneProposalForLender({ proposal_id, new_lender_id, new_scheme_id, user_id, tenant_id }) {
    // Fetch source
    const srcRows = await prisma.$queryRawUnsafe(
        `SELECT * FROM proposals WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        proposal_id, tenant_id
    );
    if (!srcRows[0]) throw new Error('Source proposal not found');
    const src = srcRows[0];

    const lenderCode = await getLenderCode(new_lender_id);
    const seq = await getNextSeq(src.case_id, new_lender_id);
    const proposalNumber = generateProposalNumber(src.case_id, lenderCode, seq);

    // Create clone
    const cloneRows = await prisma.$queryRawUnsafe(`
        INSERT INTO proposals (
            tenant_id, case_id, lender_id, scheme_id, case_esr_financial_id,
            proposal_source_id, proposal_number, proposal_status, lender_submission_status,
            requested_amount, eligible_amount, roi_min, roi_max, tenure_months,
            loan_purpose, remarks, additional_notes, preferred_banking_program,
            created_by_user_id, updated_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','draft',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
        RETURNING *
    `,
        src.tenant_id, src.case_id, new_lender_id, new_scheme_id || src.scheme_id,
        src.case_esr_financial_id, src.id, proposalNumber,
        src.requested_amount, src.eligible_amount, src.roi_min, src.roi_max, src.tenure_months,
        src.loan_purpose, src.remarks, src.additional_notes, src.preferred_banking_program,
        user_id
    );
    const cloned = cloneRows[0];

    // Copy proposal_documents from source
    const srcDocs = await prisma.$queryRawUnsafe(
        `SELECT document_id, document_type FROM proposal_documents WHERE proposal_id = $1`,
        src.id
    );
    for (const doc of srcDocs) {
        await prisma.$executeRawUnsafe(
            `INSERT INTO proposal_documents (proposal_id, document_id, document_type)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            cloned.id, doc.document_id, doc.document_type
        );
    }

    return cloned;
}

// ──────────────────────────────────────────────────────────────────────────────
// listProposalsForCase
// ──────────────────────────────────────────────────────────────────────────────
async function listProposalsForCase({ case_id, tenant_id }) {
    return prisma.$queryRawUnsafe(`
        SELECT p.*, l.name AS lender_name, l.code AS lender_code
        FROM proposals p
        LEFT JOIN lenders l ON l.id = p.lender_id
        WHERE p.case_id = $1 AND p.tenant_id = $2
        ORDER BY p.created_at ASC
    `, case_id, tenant_id);
}

module.exports = {
    createProposalDraft,
    getProposalForPrep,
    updateProposalDraft,
    attachDocumentsToProposal,
    detachDocumentFromProposal,
    submitProposal,
    cloneProposalForLender,
    listProposalsForCase
};
