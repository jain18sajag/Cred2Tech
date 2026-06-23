// proposal.service.js
const prisma = require('../../config/db');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function generateProposalNumber(caseId, lenderCode, seq) {
    const code = String(lenderCode || 'LENDER').toUpperCase().replace(/\s+/g, '').slice(0, 8);
    const s = String(seq).padStart(2, '0');
    return `PROP-${caseId}-${code}-${s}`;
}

/**
 * Get next sequence number for proposals on this case+lender
 * Robustly avoids collisions by counting any proposal that might share the same lender code
 */
async function getNextSeq(caseId, lenderCode) {
    const code = String(lenderCode || 'LENDER').toUpperCase().replace(/\s+/g, '').slice(0, 8);
    const prefix = `PROP-${caseId}-${code}-`;
    
    const count = await prisma.proposal.count({
        where: {
            case_id: Number(caseId),
            proposal_number: { startsWith: prefix }
        }
    });
    return count + 1;
}

/**
 * Resolve lender code from lenders table (text id)
 */
async function getLenderCode(lenderId, tenantLenderId) {
    if (lenderId) {
        const lender = await prisma.lender.findUnique({
            where: { id: String(lenderId) },
            select: { code: true }
        });
        if (lender?.code) return lender.code;
    }
    if (tenantLenderId) {
        const tl = await prisma.tenantLender.findUnique({
            where: { id: Number(tenantLenderId) },
            select: { lender_name: true }
        });
        if (tl?.lender_name) return tl.lender_name.slice(0, 8);
    }
    return String(lenderId || 'LENDER');
}
/**
 * Validates that the platform lender exists before attempting to link it.
 * This prevents foreign key constraint violations.
 */
async function validatePlatformLender(lenderId) {
    if (!lenderId) return null;
    const lender = await prisma.lender.findUnique({
        where: { id: String(lenderId) }
    });
    return lender ? String(lenderId) : null;
}

function normalizeOtherLenderPayload(otherLender = {}) {
    const lenderName = String(otherLender.lender_name || otherLender.lenderName || '').trim();
    const contactName = String(otherLender.contact_name || otherLender.contactName || '').trim();
    const contactEmail = String(otherLender.contact_email || otherLender.contactEmail || '').trim().toLowerCase();
    const contactMobile = String(otherLender.contact_mobile || otherLender.contactMobile || '').trim();
    const productType = String(otherLender.product_type || otherLender.productType || 'ALL').trim() || 'ALL';
    const dsaCode = String(otherLender.dsa_code || otherLender.dsaCode || '').trim();

    if (!lenderName) throw new Error('Other lender name is required');
    if (!contactName) throw new Error('Other lender contact name is required');
    if (!contactEmail) throw new Error('Other lender contact email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('Other lender contact email is invalid');

    return { lenderName, contactName, contactEmail, contactMobile, productType, dsaCode };
}

async function createManualTenantLenderContact({ tenant_id, user_id, other_lender }) {
    const payload = normalizeOtherLenderPayload(other_lender);

    const tenantLender = await prisma.tenantLender.create({
        data: {
            tenant_id: Number(tenant_id),
            lender_name: payload.lenderName,
            platform_lender_id: null,
            is_esr_enabled: false,
            is_active: true,
            created_by_user_id: Number(user_id)
        }
    });

    const contact = await prisma.tenantLenderContact.create({
        data: {
            tenant_lender_id: tenantLender.id,
            tenant_id: Number(tenant_id),
            product_type: payload.productType,
            contact_name: payload.contactName,
            contact_email: payload.contactEmail,
            contact_mobile: payload.contactMobile || null,
            dsa_code: payload.dsaCode || null,
            is_primary: true,
            created_by_user_id: Number(user_id)
        }
    });

    return { tenantLenderId: tenantLender.id, contactId: contact.id };
}

// ──────────────────────────────────────────────────────────────────────────────
// createProposalDraft
// ──────────────────────────────────────────────────────────────────────────────
async function createProposalDraft({ case_id, lender_id, tenant_lender_id, scheme_id, other_lender, user_id, tenant_id }) {
    // 1. Validate platform lender to prevent foreign key errors
    const validLenderId = await validatePlatformLender(lender_id);
    let resolvedTenantLenderId = tenant_lender_id;

    if (!resolvedTenantLenderId && other_lender) {
        const manual = await createManualTenantLenderContact({ tenant_id, user_id, other_lender });
        resolvedTenantLenderId = manual.tenantLenderId;
    }

    // 2. Fetch ESR financial snapshot for this case
    const esr = await prisma.caseEsrFinancials.findUnique({
        where: { case_id: Number(case_id) }
    });

    // 3. Fetch ESR eligibility report to find lender-specific output
    const report = await prisma.eligibilityReport.findFirst({
        where: { case_id: Number(case_id), is_latest: true }
    });

    let lenderEligibility = null;
    if (validLenderId && report?.input_snapshot) {
        // With versioned ESR, we have structured EligibilityReportLender rows
        const lenderRow = await prisma.eligibilityReportLender.findFirst({
            where: {
                esr_id: report.id,
                lender_id: validLenderId
            }
        });
        if (lenderRow) {
            lenderEligibility = {
                final_eligible_loan_amount: lenderRow.eligible_amount,
                roi_min: lenderRow.roi,
                roi_max: lenderRow.roi,
                max_tenure_months: lenderRow.tenure_months
            };
        }
    }

    const lenderCode = await getLenderCode(validLenderId, resolvedTenantLenderId);
    const seq = await getNextSeq(case_id, lenderCode);
    const proposalNumber = generateProposalNumber(case_id, lenderCode, seq);

    // Derive prefilled values
    const eligibleAmount = lenderEligibility?.final_eligible_loan_amount || null;
    const roi_min = lenderEligibility?.roi_min || null;
    const roi_max = lenderEligibility?.roi_max || null;
    const tenure_months = lenderEligibility?.max_tenure_months || null;
    const preferredSchemeId = scheme_id || null;

    let proposal;
    try {
        proposal = await prisma.proposal.create({
            data: {
                tenant_id: Number(tenant_id),
                case_id: Number(case_id),
                lender_id: validLenderId,
                tenant_lender_id: resolvedTenantLenderId ? Number(resolvedTenantLenderId) : null,
                scheme_id: preferredSchemeId ? Number(preferredSchemeId) : null,
                case_esr_financial_id: esr?.id || null,
                proposal_number: proposalNumber,
                proposal_status: 'draft',
                lender_submission_status: 'draft',
                requested_amount: esr?.requested_loan_amount || eligibleAmount,
                eligible_amount: eligibleAmount,
                roi_min: roi_min,
                roi_max: roi_max,
                tenure_months: tenure_months,
                created_by_user_id: Number(user_id),
                updated_by_user_id: Number(user_id)
            }
        });
    } catch (err) {
        console.error('[Proposal] createProposalDraft Error:', err);
        throw err;
    }

    // Auto-attach all existing case documents to proposal
    const caseDocs = await prisma.document.findMany({
        where: { case_id: Number(case_id), status: 'ACTIVE' }
    });

    if (caseDocs.length > 0) {
        await prisma.proposalDocument.createMany({
            data: caseDocs.map(doc => ({
                proposal_id: proposal.id,
                document_id: doc.id,
                document_type: doc.document_type
            })),
            skipDuplicates: true
        });
    }

    return proposal;
}

// ──────────────────────────────────────────────────────────────────────────────
// getProposalForPrep (full prefill payload for frontend)
// ──────────────────────────────────────────────────────────────────────────────
async function getProposalForPrep({ proposal_id, case_id, tenant_id }) {
    const proposal = await prisma.proposal.findFirst({
        where: {
            id: Number(proposal_id),
            case_id: Number(case_id),
            tenant_id: Number(tenant_id)
        },
        include: {
            case: {
                include: {
                    customer: true,
                    applicants: { orderBy: { id: 'asc' } },
                    esr_financials: true,
                    property: true,
                    documents: { where: { status: 'ACTIVE' } }
                }
            },
            lender: true,
            tenant_lender: true
        }
    });

    if (!proposal) throw new Error('Proposal not found or unauthorized');

    const caseData = proposal.case;
    const customer = caseData.customer;
    const applicants = caseData.applicants;
    const esr = caseData.esr_financials || {};
    const property = caseData.property || {};

    // Resolve lender info (platform or custom)
    const lender = proposal.lender || (proposal.tenant_lender ? { name: proposal.tenant_lender.lender_name } : {});

    // 1. Lender Eligibility Snapshot (from versioned ESR)
    const report = await prisma.eligibilityReport.findFirst({
        where: { case_id: Number(case_id), is_latest: true }
    });
    let lenderEligibility = null;
    if (report) {
        const lenderRow = await prisma.eligibilityReportLender.findFirst({
            where: { esr_id: report.id, lender_id: proposal.lender_id }
        });
        if (lenderRow) {
            lenderEligibility = {
                final_eligible_loan_amount: lenderRow.eligible_amount,
                roi_min: lenderRow.roi,
                roi_max: lenderRow.roi,
                max_tenure_months: lenderRow.tenure_months
            };
        }
    }

    // 2. GST Analytics
    const { getBestUsableGstSnapshot } = require('./gstAnalyticsSnapshot.service');
    const gstData = await getBestUsableGstSnapshot({ tenantId: caseData.tenant_id, caseId: Number(case_id) });
    let gstExtraStats = { months_filed: null, nil_months: null, avg_monthly_turnover: null };
    if (gstData) {
        gstExtraStats.months_filed = gstData.months_filed_12m;
        gstExtraStats.nil_months = gstData.nil_return_months;
        gstExtraStats.avg_monthly_turnover = gstData.avg_monthly_turnover;
    }

    // 3. ITR Analytics
    const itrData = await prisma.itrAnalyticsRequest.findFirst({
        where: { case_id: Number(case_id), status: 'COMPLETED' },
        orderBy: { updated_at: 'desc' }
    });
    const itrYears = [];
    if (itrData) {
        if (itrData.financial_year_latest && itrData.gross_receipts_latest_year != null) {
            itrYears.push({ ay: `AY ${itrData.financial_year_latest}`, gross_receipts: itrData.gross_receipts_latest_year, net_profit: itrData.net_profit_latest_year, filing_status: 'Filed' });
        }
        if (itrData.financial_year_previous && itrData.gross_receipts_previous_year != null) {
            itrYears.push({ ay: `AY ${itrData.financial_year_previous}`, gross_receipts: itrData.gross_receipts_previous_year, net_profit: itrData.net_profit_previous_year, filing_status: 'Filed' });
        }
    }

    // 4. Bank Statement Analysis
    const bankRows = await prisma.bankStatementAnalysisRequest.findMany({
        where: { case_id: Number(case_id), status: 'COMPLETED' },
        orderBy: { created_at: 'asc' },
        take: 5
    });
    const bankAccounts = bankRows.map((b, idx) => {
        let bankDetails = {};
        if (b.raw_retrieve_response) {
            try {
                const raw = typeof b.raw_retrieve_response === 'string' ? JSON.parse(b.raw_retrieve_response) : b.raw_retrieve_response;
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
            } catch (e) { }
        }
        return { label: idx === 0 ? 'Primary Account' : `Account ${idx + 1}`, avg_balance_latest: b.avg_bank_balance_latest_year, avg_balance_previous: b.avg_bank_balance_previous_year, fy_latest: b.financial_year_latest, ...bankDetails };
    });

    // 5. Categorized Documents
    const allCaseDocs = await prisma.document.findMany({
        where: { case_id: Number(case_id), status: 'ACTIVE' },
        include: { proposal_docs: { where: { proposal_id: proposal.id } } },
        orderBy: [{ document_type: 'asc' }, { created_at: 'desc' }]
    });

    const categories = { 'KYC': [], 'Income Proof': [], 'Banking': [], 'Property': [], 'Other': [] };
    const KYC_DOC_TYPES = ['PAN_CARD', 'AADHAAR', 'PASSPORT', 'VOTER_ID'];
    const INCOME_DOC_TYPES = ['ITR', 'FORM_16', 'SALARY_SLIP', 'CA_CERTIFICATE', 'GST_PDF', 'GST_EXCEL', 'GST_JSON'];
    const BANK_DOC_TYPES = ['BANK_JSON', 'BANK_EXCEL', 'BANK_STATEMENT'];
    const PROPERTY_DOC_TYPES = ['PROPERTY_DOCUMENT', 'SALE_DEED', 'TITLE_DEED', 'NOC'];

    for (const doc of allCaseDocs) {
        let cat = 'Other';
        if (KYC_DOC_TYPES.includes(doc.document_type)) cat = 'KYC';
        else if (INCOME_DOC_TYPES.includes(doc.document_type)) cat = 'Income Proof';
        else if (BANK_DOC_TYPES.includes(doc.document_type)) cat = 'Banking';
        else if (PROPERTY_DOC_TYPES.includes(doc.document_type)) cat = 'Property';

        categories[cat].push({ ...doc, is_attached: doc.proposal_docs.length > 0 });
    }

    // 6. Fallback to ESR Financials for Bulk Uploads
    const finalGst = {
        turnover_latest: gstData?.turnover_latest_year || (esr?.gst_avg_monthly_sales ? esr.gst_avg_monthly_sales * 12 : null),
        turnover_previous: gstData?.turnover_previous_year || null,
        fy_latest: gstData?.financial_year_latest || null,
        fy_previous: gstData?.financial_year_previous || null,
        avg_monthly_turnover: gstExtraStats.avg_monthly_turnover || esr?.gst_avg_monthly_sales || null,
        months_filed: gstExtraStats.months_filed,
        nil_months: gstExtraStats.nil_months
    };

    const finalItrYears = itrYears.length > 0 ? itrYears : (esr?.itr_pat ? [{
        ay: 'Reported Data',
        gross_receipts: esr.itr_gross_receipts || null,
        net_profit: esr.itr_pat,
        filing_status: 'Available'
    }] : []);

    const finalBankAccounts = bankAccounts.length > 0 ? bankAccounts : (esr?.bank_avg_balance ? [{
        label: 'Primary Account',
        bank_name: 'Reported Data',
        avg_monthly_credit: esr.bank_avg_monthly_credit || esr.bank_total_credits || null,
        avg_closing_balance: esr.bank_avg_balance
    }] : []);

    // Try to get Office Address from GST/PAN profile
    const panProfile = await prisma.customerPanProfile.findFirst({
        where: { customer_id: customer.id },
        orderBy: { created_at: 'desc' }
    });

    return {
        proposal: { ...proposal, lender_name: lender.name || 'Unknown', lender_code: lender.code || '' },
        lender_eligibility: lenderEligibility,
        prefill: {
            applicant_name: applicants.find(a => a.type === 'PRIMARY')?.name || applicants[0]?.name,
            pan: applicants.find(a => a.type === 'PRIMARY')?.pan_number || customer.business_pan,
            mobile: applicants.find(a => a.type === 'PRIMARY')?.mobile || customer.business_mobile,
            cibil_score: applicants.find(a => a.type === 'PRIMARY')?.cibil_score || esr.bureau_score,
            entity_name: customer.business_name,
            entity_type: customer.entity_type,
            business_vintage: customer.business_vintage,
            industry: customer.industry,
            product_type: esr.product_type || caseData.product_type,
            income_method: esr.selected_income_method,
            monthly_income: esr.selected_monthly_income,
            existing_emi: esr.existing_obligations,
            property_value: esr.property_value || property.market_value,
            property_type: esr.property_type || property.property_type,
            occupancy_type: esr.occupancy_type || property.occupancy_status,
            property_address: property.remarks || null,
            residential_address: null, // Aadhaar data not strictly stored in DB columns
            office_address: panProfile?.principal_address || null,
        },
        applicants,
        co_applicants: applicants.filter(a => a.type !== 'PRIMARY'),
        financial_summary: {
            gst: finalGst,
            itr_years: finalItrYears,
            bank_accounts: finalBankAccounts,
        },
        documents_by_category: categories,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// updateProposalDraft
// ──────────────────────────────────────────────────────────────────────────────
async function updateProposalDraft({ proposal_id, case_id, tenant_id, user_id, user_role, fields }) {
    const baseAllowed = ['requested_amount', 'tenure_months', 'loan_purpose', 'remarks', 'additional_notes', 'preferred_banking_program'];
    const overrideFields = ['eligible_amount', 'roi_min', 'roi_max'];
    
    // Check if user has override permission (SUPER_ADMIN or DSA_ADMIN)
    const canOverride = ['SUPER_ADMIN', 'DSA_ADMIN'].includes(user_role);

    const data = {};
    for (const key of baseAllowed) {
        if (fields[key] !== undefined) {
            data[key] = fields[key];
        }
    }

    let isOverriding = false;
    const oldValues = {};
    
    if (canOverride) {
        for (const key of overrideFields) {
            if (fields[key] !== undefined) {
                data[key] = fields[key];
                isOverriding = true;
            }
        }
    } else {
        // Log a warning or throw if non-admin tries to override
        const attemptedOverride = overrideFields.some(key => fields[key] !== undefined);
        if (attemptedOverride) {
            throw new Error('You do not have the LENDER_ELIGIBILITY_OVERRIDE permission.');
        }
    }

    if (Object.keys(data).length === 0) throw new Error('No valid fields to update');

    data.updated_by_user_id = Number(user_id);

    const existingProposal = await prisma.proposal.findUnique({ where: { id: Number(proposal_id) } });
    if (!existingProposal || existingProposal.case_id !== Number(case_id) || existingProposal.tenant_id !== Number(tenant_id)) {
        throw new Error('Proposal not found or unauthorized');
    }

    if (isOverriding) {
        overrideFields.forEach(key => { oldValues[key] = existingProposal[key]; });
    }

    const proposal = await prisma.proposal.update({
        where: { id: Number(proposal_id) },
        data
    });

    if (isOverriding) {
        await prisma.auditLog.create({
            data: {
                tenant_id: Number(tenant_id),
                user_id: Number(user_id),
                action: 'LENDER_ELIGIBILITY_OVERRIDE',
                description: JSON.stringify({
                    proposal_id: proposal.id,
                    case_id: proposal.case_id,
                    old_values: oldValues,
                    new_values: {
                        eligible_amount: fields.eligible_amount,
                        roi_min: fields.roi_min,
                        roi_max: fields.roi_max
                    }
                })
            }
        });
    }

    return proposal;
}

// ──────────────────────────────────────────────────────────────────────────────
// attachDocumentsToProposal
// ──────────────────────────────────────────────────────────────────────────────
async function attachDocumentsToProposal({ proposal_id, case_id, tenant_id, document_ids }) {
    const proposal = await prisma.proposal.findFirst({
        where: {
            id: Number(proposal_id),
            case_id: Number(case_id),
            tenant_id: Number(tenant_id)
        }
    });
    if (!proposal) throw new Error('Proposal not found or unauthorized');

    for (const doc_id of document_ids) {
        const doc = await prisma.document.findUnique({
            where: { id: Number(doc_id) },
            select: { document_type: true }
        });
        if (doc) {
            await prisma.proposalDocument.upsert({
                where: {
                    proposal_id_document_id: {
                        proposal_id: proposal.id,
                        document_id: Number(doc_id)
                    }
                },
                update: { document_type: doc.document_type },
                create: {
                    proposal_id: proposal.id,
                    document_id: Number(doc_id),
                    document_type: doc.document_type
                }
            });
        }
    }

    return prisma.proposalDocument.findMany({
        where: { proposal_id: proposal.id },
        include: { document: true }
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// detachDocumentFromProposal
// ──────────────────────────────────────────────────────────────────────────────
async function detachDocumentFromProposal({ proposal_id, document_id, tenant_id }) {
    await prisma.proposalDocument.deleteMany({
        where: {
            proposal_id: Number(proposal_id),
            document_id: Number(document_id)
        }
    });
    return { success: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// submitProposal
// ──────────────────────────────────────────────────────────────────────────────
async function submitProposal({ proposal_id, case_id, user_id, tenant_id, snapshot }) {
    const proposal = await prisma.proposal.findFirst({
        where: {
            id: Number(proposal_id),
            case_id: Number(case_id),
            tenant_id: Number(tenant_id)
        }
    });
    if (!proposal) throw new Error('Proposal not found or unauthorized');
    // We allow re-submission if snapshot is provided (to update auditing)
    // if (proposal.proposal_status === 'submitted') throw new Error('Proposal already submitted');

    await prisma.proposal.update({
        where: { id: proposal.id },
        data: {
            proposal_status: 'submitted',
            lender_submission_status: 'submitted',
            submitted_at: new Date(),
            submitted_by_user_id: Number(user_id),
            submitted_payload_snapshot: snapshot || null,
            updated_by_user_id: Number(user_id)
        }
    });

    const alreadySubmittedCount = await prisma.proposal.count({
        where: {
            case_id: Number(case_id),
            proposal_status: 'submitted',
            NOT: { id: proposal.id }
        }
    });

    if (alreadySubmittedCount === 0) {
        const { updateStage } = require('./case.service');
        await updateStage(Number(case_id), Number(tenant_id), 'LEAD_SENT_TO_LENDER', Number(user_id));
    }

    return { success: true, proposal_id, submitted_at: new Date().toISOString() };
}

// ──────────────────────────────────────────────────────────────────────────────
// cloneProposalForLender
// ──────────────────────────────────────────────────────────────────────────────
async function cloneProposalForLender({ source_id, new_lender_id, new_tenant_lender_id, other_lender, user_id, tenant_id }) {
    const src = await prisma.proposal.findUnique({
        where: { id: Number(source_id) }
    });
    if (!src) throw new Error('Source proposal not found');

    const validLenderId = await validatePlatformLender(new_lender_id);
    let resolvedTenantLenderId = new_tenant_lender_id;

    if (!resolvedTenantLenderId && other_lender) {
        const manual = await createManualTenantLenderContact({ tenant_id, user_id, other_lender });
        resolvedTenantLenderId = manual.tenantLenderId;
    }

    const lenderCode = await getLenderCode(validLenderId, resolvedTenantLenderId);
    const seq = await getNextSeq(src.case_id, lenderCode);
    const proposalNumber = generateProposalNumber(src.case_id, lenderCode, seq);

    try {
        const cloned = await prisma.proposal.create({
            data: {
                tenant_id: Number(tenant_id),
                case_id: src.case_id,
                lender_id: validLenderId,
                tenant_lender_id: resolvedTenantLenderId ? Number(resolvedTenantLenderId) : null,
                scheme_id: src.scheme_id,
                case_esr_financial_id: src.case_esr_financial_id,
                proposal_source_id: src.id,
                proposal_number: proposalNumber,
                proposal_status: 'draft',
                lender_submission_status: 'draft',
                requested_amount: src.requested_amount,
                eligible_amount: src.eligible_amount,
                roi_min: src.roi_min,
                roi_max: src.roi_max,
                tenure_months: src.tenure_months,
                loan_purpose: src.loan_purpose,
                remarks: src.remarks,
                additional_notes: src.additional_notes,
                preferred_banking_program: src.preferred_banking_program,
                created_by_user_id: Number(user_id),
                updated_by_user_id: Number(user_id)
            }
        });

        const srcDocs = await prisma.proposalDocument.findMany({
            where: { proposal_id: src.id }
        });

        if (srcDocs.length > 0) {
            await prisma.proposalDocument.createMany({
                data: srcDocs.map(doc => ({
                    proposal_id: cloned.id,
                    document_id: doc.document_id,
                    document_type: doc.document_type
                })),
                skipDuplicates: true
            });
        }

        return cloned;
    } catch (err) {
        console.error('[Proposal] cloneProposalForLender Error:', err);
        throw err;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// listProposalsForCase
// ──────────────────────────────────────────────────────────────────────────────
async function listProposalsForCase({ case_id, tenant_id }) {
    const list = await prisma.proposal.findMany({
        where: {
            case_id: Number(case_id),
            tenant_id: Number(tenant_id)
        },
        include: {
            lender: {
                select: {
                    name: true,
                    code: true
                }
            },
            tenant_lender: {
                select: {
                    lender_name: true
                }
            }
        },
        orderBy: {
            created_at: 'asc'
        }
    });

    // Map to the expected format (lender_name, lender_code)
    return list.map(p => ({
        ...p,
        lender_name: p.lender?.name || p.tenant_lender?.lender_name || null,
        lender_code: p.lender?.code || null
    }));
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
