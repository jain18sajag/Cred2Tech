// backend/src/services/case.clone.service.js

const crypto = require('crypto');
const prisma = require('../../config/db');

// Math.random().toString(36) isn't cryptographically random; these suffixes
// aren't security tokens (just collision-avoidance on cloned record IDs),
// but there's no reason not to use a properly random source. Keeps the same
// short length as the old suffix rather than a full UUID, since these are
// interpolated into columns that historically only ever held ~7-char suffixes.
const cloneSuffix = () => crypto.randomBytes(6).toString('hex');

/**
 * Deep clones a parent ESR case into a lender-specific child case.
 * Preserves relationships while allowing independent progression.
 * @param {number} parentCaseId 
 * @param {number} tenantId 
 * @param {object} lenderSnapshot 
 * @param {number} userId 
 */
async function cloneCaseForLender(parentCaseId, tenantId, lenderSnapshot, userId) {
  const {
    product_type,
    lender_name,
    // NOTE: platform_lender_id from proposal.lender_id is a STRING (UUID),
    // but Case.platform_lender_id is Int? — do NOT set it from proposal lender_id.
    // tenant_lender_id is the correct Int field to track the lender.
    tenant_lender_id,
    contact_id,
    dsa_code,
    contact_name,
    contact_email,
    contact_mobile
  } = lenderSnapshot;

  // 1. Check for duplicate child case (idempotency guard)
  const existingChild = await prisma.case.findFirst({
    where: {
      parent_case_id: parentCaseId,
      tenant_id: tenantId,
      product_type: product_type,
      lender_name: lender_name,
    }
  });

  if (existingChild) {
    console.log(`[CLONE] Duplicate child case found: CASE-${existingChild.id}. Returning existing.`);
    return { isDuplicate: true, case: existingChild };
  }

  // 2. Perform Deep Clone in a transaction
  return await prisma.$transaction(async (tx) => {
    // Fetch full parent case hierarchy
    const parentCase = await tx.case.findUnique({
      where: { id: parentCaseId },
      include: {
        applicants: true,
        property: true,
        income_entries: true,
        obligations: true,
        esr_financials: true,
        bureau_checks: true,
        bank_statements: true,
        itr_analytics: true,
        gst_requests: true,
        salary_ocr_results: true,
        documents: true
      }
    });

    if (!parentCase) throw new Error(`Parent case CASE-${parentCaseId} not found`);

    // Create the Base Case Clone
    const childCase = await tx.case.create({
      data: {
        tenant_id: tenantId,
        customer_id: parentCase.customer_id,
        product_type: product_type,
        loan_amount: parentCase.loan_amount,
        lender_name: lender_name,
        dsa_notes: parentCase.dsa_notes,
        esr_generated: parentCase.esr_generated,
        stage: 'LEAD_SENT_TO_LENDER',

        customer_name: parentCase.customer_name,
        entity_type: parentCase.entity_type,
        cibil_score: parentCase.cibil_score,
        alert_flag: parentCase.alert_flag,
        created_by_user_id: userId,

        // CRITICAL: lead_date must be set so this case shows in pipeline
        lead_date: new Date(),

        // Tracking & snapshot fields
        parent_case_id: parentCaseId,
        // NOTE: platform_lender_id is Int? on Case, so we cannot set a string lender UUID here.
        // tenant_lender_id (Int?) is the correct FK to track the lender.
        tenant_lender_id: tenant_lender_id ? parseInt(tenant_lender_id, 10) : null,
        contact_id: contact_id ? parseInt(contact_id, 10) : null,
        dsa_code: dsa_code || null,
        contact_name: contact_name || null,
        contact_email: contact_email || null,
        contact_mobile: contact_mobile || null,
        proposal_sent_at: new Date(),
        proposal_sent_by_user_id: userId,
        is_cloned_snapshot: true
      }
    });

    console.log(`[CLONE] Created child case CASE-${childCase.id} from parent CASE-${parentCaseId}`);

    // Clone Applicants — build a map: parentApplicantId → childApplicantId
    const applicantIdMap = {};
    for (const app of parentCase.applicants) {
      const newApp = await tx.applicant.create({
        data: {
          case_id: childCase.id,
          type: app.type,
          employment_type: app.employment_type,
          name: app.name,
          pan_number: app.pan_number,
          mobile: app.mobile,
          email: app.email,
          cibil_score: app.cibil_score,
          emi: app.emi,
          is_primary: app.is_primary,
          otp_verified: app.otp_verified,
          bureau_fetched: app.bureau_fetched,
          source_applicant_id: app.id
        }
      });
      applicantIdMap[app.id] = newApp.id;
    }

    console.log(`[CLONE] Cloned ${parentCase.applicants.length} applicants`);

    // Clone Property Details
    if (parentCase.property) {
      await tx.casePropertyDetails.create({
        data: {
          case_id: childCase.id,
          property_type: parentCase.property.property_type,
          occupancy_status: parentCase.property.occupancy_status,
          ownership_type: parentCase.property.ownership_type,
          market_value: parentCase.property.market_value,
          remarks: parentCase.property.remarks
        }
      });
    }

    // Clone Income Entries
    if (parentCase.income_entries.length > 0) {
      await tx.caseIncomeEntry.createMany({
        data: parentCase.income_entries.map(inc => ({
          case_id: childCase.id,
          // Remap applicant_id — if not found in map, skip (null is allowed)
          applicant_id: inc.applicant_id ? (applicantIdMap[inc.applicant_id] || null) : null,
          income_type: inc.income_type,
          applicant_label: inc.applicant_label,
          annual_amount: inc.annual_amount,
          supporting_doc_type: inc.supporting_doc_type,
          remarks: inc.remarks
        }))
      });
    }

    // Clone Credit Obligations
    if (parentCase.obligations.length > 0) {
      // Only clone obligations where the applicant_id has been successfully remapped
      const validObligations = parentCase.obligations.filter(ob => applicantIdMap[ob.applicant_id]);
      if (validObligations.length > 0) {
        await tx.caseCreditObligation.createMany({
          data: validObligations.map(ob => ({
            case_id: childCase.id,
            applicant_id: applicantIdMap[ob.applicant_id],
            lender_name: ob.lender_name,
            loan_type: ob.loan_type,
            loan_amount: ob.loan_amount,
            outstanding_amount: ob.outstanding_amount,
            loan_start_date: ob.loan_start_date,
            emi_per_month: ob.emi_per_month,
            status: ob.status,
            source: ob.source,
            needs_verification: ob.needs_verification,
            include_in_foir: ob.include_in_foir,
            remarks: ob.remarks
          }))
        });
      }
    }

    // Clone ESR Financials (snapshot for lender-specific analysis)
    if (parentCase.esr_financials) {
      const e = parentCase.esr_financials;
      await tx.caseEsrFinancials.create({
        data: {
          case_id: childCase.id,
          requested_loan_amount: e.requested_loan_amount,
          requested_tenure_months: e.requested_tenure_months,
          product_type: e.product_type,
          property_value: e.property_value,
          property_type: e.property_type,
          occupancy_type: e.occupancy_type,
          bureau_score: e.bureau_score,
          applicant_age: e.applicant_age,
          existing_obligations: e.existing_obligations,
          icici_exposure: e.icici_exposure,
          itr_pat: e.itr_pat,
          itr_depreciation: e.itr_depreciation,
          itr_finance_cost: e.itr_finance_cost,
          itr_gross_receipts: e.itr_gross_receipts,
          gst_avg_monthly_sales: e.gst_avg_monthly_sales,
          gst_industry_type: e.gst_industry_type,
          gst_industry_margin: e.gst_industry_margin,
          bank_avg_balance: e.bank_avg_balance,
          bank_total_credits: e.bank_total_credits,
          bank_avg_monthly_credit: e.bank_avg_monthly_credit,
          bank_monthly_income: e.bank_monthly_income,
          net_profit_income: e.net_profit_income,
          gst_income: e.gst_income,
          banking_income: e.banking_income,
          salaried_income: e.salaried_income,
          salaried_income_source: e.salaried_income_source,
          salaried_slip_count: e.salaried_slip_count,
          salaried_gross_monthly: e.salaried_gross_monthly,
          salaried_net_monthly: e.salaried_net_monthly,
          salaried_deductions_monthly: e.salaried_deductions_monthly,
          salaried_months_available: e.salaried_months_available,
          salaried_months_required: e.salaried_months_required,
          salaried_period_from: e.salaried_period_from,
          salaried_period_to: e.salaried_period_to,
          salaried_data_complete: e.salaried_data_complete,
          salaried_source: e.salaried_source,
          bank_net_salary_monthly: e.bank_net_salary_monthly,
          bank_salary_months_available: e.bank_salary_months_available,
          selected_income_method: e.selected_income_method,
          selected_monthly_income: e.selected_monthly_income,
          constitution_type: e.constitution_type,
          employment_type: e.employment_type,
          business_vintage_months: e.business_vintage_months,
          itr_remuneration: e.itr_remuneration,
          double_whammy_flag: e.double_whammy_flag,
          net_worth: e.net_worth,
          salaried_incentive_income: e.salaried_incentive_income,
          salaried_other_income: e.salaried_other_income,
          manual_eligible_loan_amount: e.manual_eligible_loan_amount,
          manual_proposed_emi: e.manual_proposed_emi,
          extraction_status: 'COMPLETED' // Cloned snapshot is already extracted
        }
      });
    }

     // Clone ESR (Eligibility Report)
    const parentESR = await tx.eligibilityReport.findFirst({
      where: { case_id: parentCaseId, is_latest: true },
      include: { lenders: true }
    });

    if (parentESR) {
      await tx.eligibilityReport.create({
        data: {
          case_id: childCase.id,
          tenant_id: tenantId,
          version_number: 1,
          is_latest: true,
          generated_by_user_id: userId,
          combined_income: parentESR.combined_income,
          property_value: parentESR.property_value,
          primary_cibil_score: parentESR.primary_cibil_score,
          lowest_cibil_score: parentESR.lowest_cibil_score,
          total_emi_per_month: parentESR.total_emi_per_month,
          input_snapshot: parentESR.input_snapshot,
          raw_payload: parentESR.raw_payload,
          status: parentESR.status,
          lenders: {
            create: parentESR.lenders.map(l => ({
              tenant_lender_id: l.tenant_lender_id,
              lender_id: l.lender_id,
              lender_name: l.lender_name,
              product_type: l.product_type,
              product_display_name: l.product_display_name,
              best_scheme_name: l.best_scheme_name,
              is_eligible: l.is_eligible,
              eligible_amount: l.eligible_amount,
              roi: l.roi,
              tenure_months: l.tenure_months,
              emi: l.emi,
              ltv: l.ltv,
              foir: l.foir,
              remarks: l.remarks,
              rejection_reasons: l.rejection_reasons,
              scheme_evaluations: l.scheme_evaluations
            }))
          }
        }
      });
    }


    // Clone Bureau Checks
    // BureauVerification.applicant_id is required (non-nullable), so only clone if we have a valid mapping
    for (const b of parentCase.bureau_checks) {
      const childApplicantId = applicantIdMap[b.applicant_id];
      if (!childApplicantId) {
        console.warn(`[CLONE] Skipping bureau check — no applicant mapping for applicant_id=${b.applicant_id}`);
        continue;
      }
      await tx.bureauVerification.create({
        data: {
          case_id: childCase.id,
          applicant_id: childApplicantId,
          applicant_type: b.applicant_type,
          // request_id must be unique — append clone marker
          request_id: `${b.request_id}_CLONE_${cloneSuffix()}`,
          stan: b.stan,
          mobile_number: b.mobile_number,
          score: b.score,
          raw_response: b.raw_response || null,
          status: b.status,
          emi_obligations_total: b.emi_obligations_total
        }
      });
    }

    // Clone Bank Statements
    for (const b of parentCase.bank_statements) {
      await tx.bankStatementAnalysisRequest.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: b.applicant_id ? (applicantIdMap[b.applicant_id] || null) : null,
          // report_id must be unique — append clone marker
          report_id: b.report_id ? `${b.report_id}_CLONE_${cloneSuffix()}` : null,
          status: b.status,
          provider_message: b.provider_message,
          report_json_url: b.report_json_url,
          report_excel_url: b.report_excel_url,
          files_payload: b.files_payload || null,
          avg_bank_balance_latest_year: b.avg_bank_balance_latest_year,
          avg_bank_balance_previous_year: b.avg_bank_balance_previous_year,
          financial_year_latest: b.financial_year_latest,
          financial_year_previous: b.financial_year_previous,
          created_by_user_id: userId
        }
      });
    }

    // Clone ITR Analytics
    for (const i of parentCase.itr_analytics) {
      await tx.itrAnalyticsRequest.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: i.applicant_id ? (applicantIdMap[i.applicant_id] || null) : null,
          pan: i.pan,
          // reference_id must be unique — append clone marker
          reference_id: i.reference_id ? `${i.reference_id}_CLONE_${cloneSuffix()}` : null,
          status: i.status,
          provider_message: i.provider_message,
          excel_url: i.excel_url,
          analytics_payload: i.analytics_payload || null,
          net_profit_latest_year: i.net_profit_latest_year,
          net_profit_previous_year: i.net_profit_previous_year,
          gross_receipts_latest_year: i.gross_receipts_latest_year,
          gross_receipts_previous_year: i.gross_receipts_previous_year,
          financial_year_latest: i.financial_year_latest,
          financial_year_previous: i.financial_year_previous,
          created_by_user_id: userId
        }
      });
    }

    // Clone GST Requests
    for (const g of parentCase.gst_requests) {
      await tx.gstrAnalyticsRequest.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: g.applicant_id ? (applicantIdMap[g.applicant_id] || null) : null,
          mode: g.mode,
          auth_type: g.auth_type,
          gstin: g.gstin,
          username: g.username,
          from_date: g.from_date || '',
          to_date: g.to_date || '',
          entity_details: g.entity_details ?? false,
          pdf_url_requested: g.pdf_url_requested ?? false,
          // provider_request_id must be unique — append clone marker
          provider_request_id: g.provider_request_id
            ? `${g.provider_request_id}_CLONE_${cloneSuffix()}`
            : null,
          status: g.status,
          provider_message: g.provider_message,
          raw_gst_data: g.raw_gst_data || null,
          report_json_url: g.report_json_url,
          report_excel_url: g.report_excel_url,
          report_pdf_url: g.report_pdf_url,
          turnover_latest_year: g.turnover_latest_year,
          turnover_previous_year: g.turnover_previous_year,
          financial_year_latest: g.financial_year_latest,
          financial_year_previous: g.financial_year_previous,
          created_by_user_id: userId
        }
      });
    }

    // Clone Salary OCR Results
    // SalarySlipOcrResult.applicant_id is required (non-nullable).
    // Schema fields: month, year (NOT salary_month, salary_year).
    // @@unique([case_id, applicant_id, month, year]) — new case_id means no conflict.
    for (const o of parentCase.salary_ocr_results) {
      const childApplicantId = applicantIdMap[o.applicant_id];
      if (!childApplicantId) {
        console.warn(`[CLONE] Skipping salary OCR — no applicant mapping for applicant_id=${o.applicant_id}`);
        continue;
      }
      await tx.salarySlipOcrResult.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: childApplicantId,
          month: o.month,
          year: o.year,
          ocr_status: o.ocr_status,
          source: o.source,
          gross_salary: o.gross_salary,
          net_salary: o.net_salary,
          deductions: o.deductions,
          deductions_is_derived: o.deductions_is_derived,
          employer_name: o.employer_name,
          employee_name: o.employee_name,
          employee_pan: o.employee_pan,
          ocr_confidence: o.ocr_confidence,
          pages_processed: o.pages_processed,
          net_salary_words_match: o.net_salary_words_match,
          extraction_checks: o.extraction_checks || null,
          extraction_warnings: o.extraction_warnings || null,
          extraction_source: o.extraction_source,
          salary_period: o.salary_period,
          name_match_status: o.name_match_status,
          pan_match_status: o.pan_match_status,
          vendor_name: o.vendor_name,
          vendor_job_id: o.vendor_job_id,
          raw_ocr_response: o.raw_ocr_response || null,
          extracted_json: o.extracted_json || null,
          error_message: o.error_message
        }
      });
    }

    // Clone Documents (links only — same physical file, new DB row pointing to child case)
    for (const d of parentCase.documents) {
      await tx.document.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: d.applicant_id ? (applicantIdMap[d.applicant_id] || null) : null,
          document_type: d.document_type,
          source_type: d.source_type,
          source_url: d.source_url,
          storage_provider: d.storage_provider,
          storage_path: d.storage_path,
          file_name: d.file_name,
          original_file_name: d.original_file_name,
          mime_type: d.mime_type,
          extension: d.extension,
          file_size_bytes: d.file_size_bytes,
          checksum_md5: d.checksum_md5,
          status: d.status,
          uploaded_by_user_id: userId,
          metadata: d.metadata || null
        }
      });
    }

    // Stage History for the new child case
    await tx.caseStageHistory.create({
      data: {
        case_id: childCase.id,
        tenant_id: tenantId,
        old_stage: 'DRAFT',
        new_stage: 'LEAD_SENT_TO_LENDER',
        changed_by: userId
      }
    });

    // Activity Logs
    await tx.activityLog.create({
      data: {
        case_id: childCase.id,
        customer_id: parentCase.customer_id,
        activity_type: 'CHILD_CASE_CREATED',
        description: `Child case created for ${lender_name}. Cloned from source CASE-${parentCaseId}.`,
        performed_by_user_id: userId
      }
    });

    await tx.activityLog.create({
      data: {
        case_id: parentCaseId,
        customer_id: parentCase.customer_id,
        activity_type: 'PROPOSAL_SENT',
        description: `Proposal sent to ${lender_name}. Created child lender case CASE-${childCase.id}.`,
        performed_by_user_id: userId
      }
    });

    return { isDuplicate: false, case: childCase };
  });
}

module.exports = {
  cloneCaseForLender
};
