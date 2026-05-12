// backend/src/services/case.clone.service.js

const prisma = require('../../config/db');

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
    platform_lender_id,
    tenant_lender_id,
    contact_id,
    dsa_code,
    contact_name,
    contact_email,
    contact_mobile
  } = lenderSnapshot;

  // 1. Check for duplicate child case
  const existingChild = await prisma.case.findFirst({
    where: {
      parent_case_id: parentCaseId,
      tenant_id: tenantId,
      product_type: product_type,
      lender_name: lender_name,
      // Consider contact_id / platform_lender_id for tighter scoping
    }
  });

  if (existingChild) {
    return { isDuplicate: true, case: existingChild };
  }

  // 2. Perform Deep Clone
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

    if (!parentCase) throw new Error('Parent case not found');

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
        
        // Tracking & snapshot fields
        parent_case_id: parentCaseId,
        platform_lender_id: platform_lender_id,
        tenant_lender_id: tenant_lender_id,
        contact_id: contact_id,
        dsa_code: dsa_code,
        contact_name: contact_name,
        contact_email: contact_email,
        contact_mobile: contact_mobile,
        proposal_sent_at: new Date(),
        proposal_sent_by_user_id: userId,
        is_cloned_snapshot: true
      }
    });

    // Clone Applicants
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

    if (parentCase.income_entries.length > 0) {
      await tx.caseIncomeEntry.createMany({
        data: parentCase.income_entries.map(inc => ({
          case_id: childCase.id,
          applicant_id: inc.applicant_id ? applicantIdMap[inc.applicant_id] : null,
          income_type: inc.income_type,
          applicant_label: inc.applicant_label,
          annual_amount: inc.annual_amount,
          supporting_doc_type: inc.supporting_doc_type,
          remarks: inc.remarks
        }))
      });
    }

    if (parentCase.obligations.length > 0) {
      await tx.caseCreditObligation.createMany({
        data: parentCase.obligations.map(ob => ({
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

    // Clone ESR Financials
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
          bank_monthly_income: e.bank_monthly_income,
          net_profit_income: e.net_profit_income,
          gst_income: e.gst_income,
          banking_income: e.banking_income,
          selected_income_method: e.selected_income_method,
          selected_monthly_income: e.selected_monthly_income,
          constitution_type: e.constitution_type,
          employment_type: e.employment_type,
          business_vintage_months: e.business_vintage_months
        }
      });
    }

    // Clone External Metadata (Preserving remote JSON/File links but duplicating DB rows to map to new applicants)
    
    // Bureau Checks
    for (const b of parentCase.bureau_checks) {
      await tx.bureauVerification.create({
        data: {
          case_id: childCase.id,
          applicant_id: b.applicant_id ? applicantIdMap[b.applicant_id] : null,
          applicant_type: b.applicant_type,
          request_id: b.request_id + '_CLONE_' + Math.random().toString(36).substring(7), // bypass @unique
          stan: b.stan,
          mobile_number: b.mobile_number,
          score: b.score,
          raw_response: b.raw_response ? b.raw_response : null,
          status: b.status,
          emi_obligations_total: b.emi_obligations_total
        }
      });
    }

    // Bank Statements
    for (const b of parentCase.bank_statements) {
      await tx.bankStatementAnalysisRequest.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: b.applicant_id ? applicantIdMap[b.applicant_id] : null,
          report_id: b.report_id ? b.report_id + '_CLONE_' + Math.random().toString(36).substring(7) : null, // bypass @unique
          status: b.status,
          provider_message: b.provider_message,
          report_json_url: b.report_json_url,
          report_excel_url: b.report_excel_url,
          files_payload: b.files_payload ? b.files_payload : null,
          avg_bank_balance_latest_year: b.avg_bank_balance_latest_year,
          avg_bank_balance_previous_year: b.avg_bank_balance_previous_year,
          financial_year_latest: b.financial_year_latest,
          financial_year_previous: b.financial_year_previous,
          created_by_user_id: userId
        }
      });
    }

    // ITR Analytics
    for (const i of parentCase.itr_analytics) {
      await tx.itrAnalyticsRequest.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: i.applicant_id ? applicantIdMap[i.applicant_id] : null,
          pan: i.pan,
          reference_id: i.reference_id ? i.reference_id + '_CLONE_' + Math.random().toString(36).substring(7) : null,
          status: i.status,
          provider_message: i.provider_message,
          excel_url: i.excel_url,
          analytics_payload: i.analytics_payload ? i.analytics_payload : null,
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

    // GST Requests
    for (const g of parentCase.gst_requests) {
      await tx.gstrAnalyticsRequest.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: g.applicant_id ? applicantIdMap[g.applicant_id] : null,
          mode: g.mode,
          auth_type: g.auth_type,
          gstin: g.gstin,
          username: g.username,
          from_date: g.from_date || '',
          to_date: g.to_date || '',
          provider_request_id: g.provider_request_id ? g.provider_request_id + '_CLONE_' + Math.random().toString(36).substring(7) : null,
          status: g.status,
          provider_message: g.provider_message,
          raw_gst_data: g.raw_gst_data ? g.raw_gst_data : null,
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

    // Salary OCR
    for (const o of parentCase.salary_ocr_results) {
      await tx.salarySlipOcrResult.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: o.applicant_id ? applicantIdMap[o.applicant_id] : null,
          report_json_url: o.report_json_url,
          net_salary: o.net_salary,
          gross_salary: o.gross_salary,
          employer_name: o.employer_name,
          salary_month: o.salary_month,
          salary_year: o.salary_year
        }
      });
    }

    // Documents
    for (const d of parentCase.documents) {
      await tx.document.create({
        data: {
          tenant_id: tenantId,
          customer_id: parentCase.customer_id,
          case_id: childCase.id,
          applicant_id: d.applicant_id ? applicantIdMap[d.applicant_id] : null,
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
          metadata: d.metadata ? d.metadata : null
        }
      });
    }

    // Add ActivityLogs and Stage History
    await tx.caseStageHistory.create({
      data: {
        case_id: childCase.id,
        tenant_id: tenantId,
        old_stage: 'DRAFT',
        new_stage: 'LEAD_SENT_TO_LENDER',
        changed_by: userId
      }
    });

    await tx.activityLog.create({
      data: {
        case_id: childCase.id,
        activity_type: 'CHILD_CASE_CREATED',
        description: `Child case created for ${lender_name}. Cloned from source Case CASE-${parentCaseId}.`,
        performed_by_user_id: userId
      }
    });

    await tx.activityLog.create({
      data: {
        case_id: parentCaseId,
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
