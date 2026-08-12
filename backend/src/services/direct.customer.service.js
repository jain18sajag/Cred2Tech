const prisma = require('../../config/db');
const esrService = require('./esr.service');
const razorpayService = require('./razorpay.service');

// A DSA continuing an MSME customer's case (createCaseFromExisting) creates a
// brand-new Case row sharing the same customer_id rather than continuing the
// original one — so the same underlying application ends up as two
// disconnected rows. Collapse to one per customer_id, keeping whichever was
// created most recently (the one actually being worked on now). Cases are
// expected pre-sorted newest-first.
//
// Only ever apply this to a single-case *summary* (e.g. getDashboard's
// activeCase) — never to a full case listing. createCaseFromExisting is
// DSA-only (AddCustomerWizardPage's checkPanDuplicate/handleContinueAsNewCase
// short-circuit for MSME actors), so it can never be the source of a
// same-customer_id row here; the only way two cases in this MSME-scoped
// dataset share a customer_id now is the "New Case" button — a genuinely
// separate application the customer deliberately started and paid for a
// second time, which must show up as its own row, not get silently merged
// into the newer one.
function dedupeByCustomer(cases) {
  const seen = new Set();
  const deduped = [];
  for (const c of cases) {
    if (seen.has(c.customer_id)) continue;
    seen.add(c.customer_id);
    deduped.push(c);
  }
  return deduped;
}

const directCustomerService = {
  getDashboard: async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      // synced_dob/synced_pan_number/synced_business_name/synced_email/
      // synced_pincode: prefill values pushed from scheme.cred2tech.com (see
      // ssoProfileSync) — the onboarding wizard uses these to skip re-asking
      // for data the user already gave the sibling app, when starting a
      // brand-new case with none of its own yet.
      select: {
        id: true, name: true, email: true, mobile: true, status: true, created_at: true,
        synced_dob: true, synced_pan_number: true,
        synced_business_name: true, synced_email: true, synced_pincode: true
      }
    });

    const [nonTerminalCases, unlinkedPayment, allCases] = await Promise.all([
      prisma.case.findMany({
        where: {
          msme_customer_user_id: userId,
          stage: { notIn: ['CLOSED', 'REJECTED'] }
        },
        orderBy: { created_at: 'desc' },
        include: {
          customer: true,
          applicants: { where: { is_primary: true } },
          case_payment: true,
          assigned_dsa_user: { select: { name: true, tenant: { select: { name: true } } } }
        }
      }),
      // Unlinked paid payment (paid but case not started yet)
      prisma.casePayment.findFirst({
        where: { user_id: userId, case_id: null, status: 'PAID' },
        orderBy: { created_at: 'desc' }
      }),
      // All-time cases for this customer, across every stage — must match
      // getCases()'s count, so NOT deduped by customer_id either (see the
      // note on dedupeByCustomer above): a customer with two paid "New Case"
      // runs against the same business has two cases, not one.
      prisma.case.findMany({ where: { msme_customer_user_id: userId }, select: { id: true }, orderBy: { created_at: 'desc' } })
    ]);

    // The dashboard's "your active case" summary should keep showing the
    // customer's latest non-terminal case regardless of submission status —
    // they still want to see it while a DSA/admin is working it.
    const activeCase = dedupeByCustomer(nonTerminalCases)[0] || null;
    // Payment gating is a stricter question: "is there a case I can still
    // resume paying for, without charging again?" Only a case still being
    // filled out in the wizard (never submitted) qualifies — once the
    // customer hits Submit, msme_submitted_at is set and the case moves
    // into the DSA/admin pipeline. Without this distinction, an old
    // already-submitted case's PAID CasePayment gets reused as the
    // paymentStatus source of truth forever, so a genuinely new case the
    // customer starts afterwards never gets charged.
    const resumableCase = activeCase && !activeCase.msme_submitted_at ? activeCase : null;
    const totalCasesCount = allCases.length;

    let paymentStatus = 'UNPAID';

    if (unlinkedPayment) {
      paymentStatus = 'PAID';
    } else if (resumableCase && resumableCase.case_payment?.status === 'PAID') {
      paymentStatus = 'PAID';
    }

    return {
      user,
      // Always the customer's real latest non-terminal case, regardless of
      // any unlinked payment sitting around — those are independent facts
      // now that "New Case" lets a customer have both a fully submitted
      // case AND a separate unclaimed payment for a next one. This used to
      // null activeCase out entirely whenever unlinkedPayment existed (a
      // leftover from before "New Case" existed, when an unlinked payment
      // always meant "no case yet at all") — which blanked a customer's own
      // dashboard case summary to "No Active Applications" the moment they
      // paid for a second case, even though their first case was very much
      // still active.
      activeCase,
      // Case a fresh payment order (or the wizard's business-details save)
      // should attach to — null once the customer's existing case has been
      // submitted, so a new payment/case is started instead of silently
      // reusing the finished one.
      resumableCase: unlinkedPayment ? null : resumableCase,
      paymentStatus,
      // Distinct from paymentStatus: true only when there's a paid amount
      // not yet claimed by any case (case_id: null) — i.e. genuinely
      // spendable on a deliberately NEW case without paying again.
      // paymentStatus alone can already read 'PAID' purely because an old,
      // still-unsubmitted case's own payment is settled; that money is
      // earmarked for that case, not free to skip the gateway for a second
      // one (see msme/cases "New Case" button).
      hasUnclaimedPayment: !!unlinkedPayment,
      emptyState: !activeCase,
      totalCasesCount
    };
  },

  // Full case history for this MSME customer (dashboard only ever returns the
  // single most-recent active one) — scoped strictly to msme_customer_user_id
  // so a customer can never see another customer's cases. Deduped by
  // customer_id (see dedupeByCustomer) so a DSA-continued case doesn't show
  // up as a second, seemingly-unrelated application.
  getCases: async (userId) => {
    const cases = await prisma.case.findMany({
      where: { msme_customer_user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        customer_id: true,
        product_type: true,
        loan_amount: true,
        sanctioned_amount: true,
        total_disbursed_amount: true,
        stage: true,
        created_at: true,
        updated_at: true,
        data_purged_at: true,
        assigned_dsa_user: { select: { name: true, tenant: { select: { name: true } } } },
        case_payment: { select: { status: true } },
      },
    });
    // Every one of this customer's own cases, including multiple against the
    // same business/PAN from separate "New Case" runs — do NOT dedupe by
    // customer_id here (see the note on dedupeByCustomer above).
    return { cases };
  },

  // Full payment history for this MSME customer — every CasePayment row
  // regardless of status (INITIATED/PAID/FAILED), not just the PAID ones
  // getDashboard cares about, so a customer can see an attempt that failed
  // or never completed too. Scoped strictly to user_id, same as getCases.
  // Deliberately omits razorpay_signature (verification-only, never needed
  // client-side) and only returns the last 4 of the razorpay payment id, not
  // the full order/payment ids, since those aren't otherwise sensitive but
  // also serve no purpose being exposed in full to the browser.
  getPayments: async (userId) => {
    const payments = await prisma.casePayment.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        case_id: true,
        purpose: true,
        amount_inr: true,
        currency: true,
        status: true,
        failure_reason: true,
        razorpay_payment_id: true,
        verified_at: true,
        created_at: true,
      },
    });
    return {
      payments: payments.map((p) => ({
        ...p,
        razorpay_payment_id: p.razorpay_payment_id ? `••••${p.razorpay_payment_id.slice(-6)}` : null,
      })),
    };
  },

  // Partial update — only the fields actually present in `data` get
  // validated and written. The /msme/profile page always sends both name
  // and email together (a full form save), so that caller is unaffected;
  // this also lets the onboarding wizard silently sync just the email the
  // instant the customer types it (see business_email's onBlur), without
  // needing to know/resend their current name to satisfy a "both required"
  // rule that has nothing to do with what it's actually updating.
  updateProfile: async (userId, data) => {
    const updateData = {};
    if (data.name !== undefined) {
      const name = data.name?.trim();
      if (!name) throw new Error('Full name is required.');
      updateData.name = name;
    }
    if (data.email !== undefined) {
      const email = data.email?.trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email address is required.');
      updateData.email = email;
    }
    if (Object.keys(updateData).length === 0) throw new Error('Nothing to update.');

    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: updateData
      });
      // Never echo password_hash back to the client.
      const { password_hash, ...safeUser } = user;
      return safeUser;
    } catch (err) {
      if (err.code === 'P2002') throw new Error('That email address is already in use.');
      throw err;
    }
  },

  initiateEligibility: async (userId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    if (dashboard.paymentStatus === 'PAID') {
      return { next_step: "OPEN_ELIGIBILITY_FORM" };
    }
    return { next_step: "PAYMENT_REQUIRED" };
  },

  getPaymentConfig: async () => {
    const config = await prisma.apiPricing.findUnique({
      where: { api_code: 'DIRECT_MSME_ELIGIBILITY' }
    });
    if (!config) throw new Error("Payment configuration missing");
    
    return {
      amount_paise: config.default_credit_cost,
      amount_inr: config.default_credit_cost / 100,
      api_name: config.api_name,
      description: config.description
    };
  },

  // forceNew: the "New Case" button's payment (msme/cases page) — a
  // deliberate second case, not a continuation of whatever's currently
  // resumable. Gated on hasUnclaimedPayment (not the general paymentStatus)
  // and never pre-attached to the old resumable case, otherwise this order
  // settling as PAID would silently fund that old case instead of the new
  // one about to be created (case.service.js#createCase claims any
  // still-unlinked PAID payment for whatever case it creates next).
  createPaymentOrder: async (userId, { forceNew = false } = {}) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    const alreadyPaid = forceNew ? dashboard.hasUnclaimedPayment : dashboard.paymentStatus === 'PAID';
    if (alreadyPaid) {
      throw new Error("Payment already completed or valid paid access exists");
    }

    const config = await directCustomerService.getPaymentConfig();
    // Only attach this new payment to an existing case if that case is
    // still resumable (unsubmitted) — never to an already-submitted one,
    // otherwise a fresh charge for what the customer intends as a new case
    // silently gets tied back to their old, finished application.
    const activeCaseId = (!forceNew && dashboard.resumableCase) ? dashboard.resumableCase.id : null;
    const receipt = `msme_${userId}_${Date.now()}`;
    const order = await razorpayService.createOrder(config.amount_paise, receipt, 'INR');

    await prisma.casePayment.create({
      data: {
        user_id: userId,
        case_id: activeCaseId,
        purpose: 'DIRECT_MSME_ELIGIBILITY',
        amount_paise: config.amount_paise,
        amount_inr: config.amount_inr,
        razorpay_order_id: order.id,
        status: 'INITIATED'
      }
    });

    // Log activity if case exists
    if (activeCaseId) {
      await prisma.activityLog.create({
        data: {
          case_id: activeCaseId,
          activity_type: 'PAYMENT_INITIATED',
          description: 'Razorpay payment order created',
          performed_by_user_id: userId
        }
      });
    }

    return {
      order_id: order.id,
      amount_paise: config.amount_paise,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID
    };
  },

  verifyPayment: async (userId, data) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;
    
    const isValid = razorpayService.verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) throw new Error("Payment verification failed");

    const casePayment = await prisma.casePayment.findUnique({
      where: { razorpay_order_id }
    });

    if (!casePayment || casePayment.user_id !== userId) {
      throw new Error("Invalid payment record");
    }

    const updatedPayment = await prisma.casePayment.update({
      where: { id: casePayment.id },
      data: {
        razorpay_payment_id,
        razorpay_signature,
        status: 'PAID',
        verified_at: new Date()
      }
    });

    if (casePayment.case_id) {
      await prisma.activityLog.create({
        data: {
          case_id: casePayment.case_id,
          activity_type: 'PAYMENT_VERIFIED',
          description: 'Payment successfully verified',
          performed_by_user_id: userId
        }
      });
    } else {
      await prisma.activityLog.create({
        data: {
          activity_type: 'PAYMENT_VERIFIED',
          description: 'Payment successfully verified (Case pending)',
          performed_by_user_id: userId
        }
      });
    }

    return updatedPayment;
  },

  startForm: async (userId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    if (dashboard.paymentStatus !== 'PAID') {
      throw new Error("Payment required to open eligibility form");
    }
    
    if (dashboard.resumableCase) {
      await prisma.activityLog.create({
        data: {
          case_id: dashboard.resumableCase.id,
          activity_type: 'ELIGIBILITY_FORM_STARTED',
          description: 'User resumed the eligibility form',
          performed_by_user_id: userId
        }
      });
    }
    
    return dashboard.resumableCase;
  },

  updateBusinessDetails: async (userId, data) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const dashboard = await directCustomerService.getDashboard(userId);
    if (dashboard.paymentStatus !== 'PAID') {
      throw new Error("Payment required to save business details");
    }

    let activeCase = dashboard.resumableCase;

    // Delayed Creation: Create Customer and Case if they don't exist yet
    if (!activeCase) {
      const customer = await prisma.customer.create({
        data: {
          tenant_id: user.tenant_id,
          category: 'MSME',
          business_pan: data.business_pan,
          business_name: data.business_name,
          business_email: data.business_email,
          entity_type: data.entity_type,
          business_vintage: data.business_vintage,
          industry: data.industry,
          business_mobile: user.mobile,
          created_by_user_id: userId
        }
      });

      activeCase = await prisma.case.create({
        data: {
          tenant_id: user.tenant_id,
          customer_id: customer.id,
          stage: 'DRAFT',
          category: 'MSME', // Direct MSME self-service portal is MSME-only, never salaried
          lead_source: 'DIRECT_MSME',
          msme_customer_user_id: userId,
          created_by_user_id: userId
        }
      });

      await prisma.applicant.create({
        data: {
          case_id: activeCase.id,
          type: 'PRIMARY',
          is_primary: true,
          mobile: user.mobile,
          pan_number: data.business_pan,
          name: data.business_name || data.applicant_name
        }
      });

      // Link the unlinked payment to this newly created case
      const unlinkedPayment = await prisma.casePayment.findFirst({
        where: { user_id: userId, case_id: null, status: 'PAID' },
        orderBy: { created_at: 'desc' }
      });

      if (unlinkedPayment) {
        await prisma.casePayment.update({
          where: { id: unlinkedPayment.id },
          data: { case_id: activeCase.id }
        });
      }

      await prisma.activityLog.create({
        data: {
          case_id: activeCase.id,
          customer_id: customer.id,
          activity_type: 'CASE_CREATED',
          description: 'Customer and Draft Case created with business details',
          performed_by_user_id: userId
        }
      });
    } else {
      // Just update existing
      await prisma.customer.update({
        where: { id: activeCase.customer_id },
        data: {
          business_pan: data.business_pan,
          business_name: data.business_name,
          business_email: data.business_email,
          entity_type: data.entity_type,
          business_vintage: data.business_vintage,
          industry: data.industry
        }
      });

      if (data.business_pan && activeCase.applicants.length > 0) {
        await prisma.applicant.update({
          where: { id: activeCase.applicants[0].id },
          data: { pan_number: data.business_pan, name: data.business_name || data.applicant_name }
        });
      }

      await prisma.activityLog.create({
        data: {
          case_id: activeCase.id,
          customer_id: activeCase.customer_id,
          activity_type: 'BUSINESS_DETAILS_SAVED',
          description: 'Business details updated',
          performed_by_user_id: userId
        }
      });
    }

    // Sync real name & email to the User record (replaces dummy placeholders from OTP registration)
    const userUpdate = {};
    if (data.business_name) userUpdate.name = data.business_name;
    if (data.business_email) userUpdate.email = data.business_email;
    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userUpdate });
    }

    return await directCustomerService.getDashboard(userId).then(d => d.activeCase);
  },

  updateLoanDetails: async (userId, data) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    const activeCase = dashboard.resumableCase;
    if (!activeCase) throw new Error("No active case found. Please complete business details first.");

    await prisma.case.update({
      where: { id: activeCase.id },
      data: {
        loan_amount: parseFloat(data.loan_amount) || null,
        product_type: data.product_type,
        dsa_notes: data.dsa_notes
      }
    });

    await prisma.activityLog.create({
      data: {
        case_id: activeCase.id,
        activity_type: 'LOAN_DETAILS_SAVED',
        description: 'Loan requirement details updated',
        performed_by_user_id: userId
      }
    });

    return await directCustomerService.getDashboard(userId).then(d => d.activeCase);
  },

  runEligibility: async (userId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    const activeCase = dashboard.resumableCase;
    
    if (!activeCase) throw new Error("No active case found to run ESR");
    if (dashboard.paymentStatus !== 'PAID') {
      throw new Error("Payment required to run eligibility check.");
    }

    // Existing ESR integration
    const esr = await esrService.generateESR(activeCase.id, userId, activeCase.tenant_id);

    await prisma.case.update({
      where: { id: activeCase.id },
      data: { esr_generated: true, stage: 'ESR_GENERATED' }
    });

    await prisma.activityLog.create({
      data: {
        case_id: activeCase.id,
        activity_type: 'ESR_GENERATED',
        description: 'Eligibility report generated successfully',
        performed_by_user_id: userId
      }
    });

    return esr;
  },

  getEligibilityResult: async (userId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    if (!dashboard.resumableCase) throw new Error("No active case found");

    return await prisma.eligibilityReport.findFirst({
      where: { case_id: dashboard.resumableCase.id },
      orderBy: { created_at: 'desc' },
      include: {
        lenders: true
      }
    });
  },

  selectLender: async (userId, esrLenderId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    const activeCase = dashboard.resumableCase;
    if (!activeCase) throw new Error("No active case found");

    const esrLender = await prisma.eligibilityReportLender.findFirst({
      where: {
        id: esrLenderId,
        esr: { case_id: activeCase.id }
      }
    });

    if (!esrLender) {
      throw new Error("Invalid lender selection");
    }

    await prisma.case.update({
      where: { id: activeCase.id },
      data: { msme_selected_lender_esr_id: esrLender.id }
    });

    await prisma.activityLog.create({
      data: {
        case_id: activeCase.id,
        activity_type: 'LENDER_SELECTED',
        description: `Selected lender from ESR report`,
        performed_by_user_id: userId
      }
    });

    return { success: true };
  },

  submitCase: async (userId, caseId, submissionData = {}) => {
    let targetCaseId = caseId;
    
    // Fallback to active case if caseId is not provided
    if (!targetCaseId) {
      const dashboard = await directCustomerService.getDashboard(userId);
      if (!dashboard.resumableCase) throw new Error("No active case found");
      targetCaseId = dashboard.resumableCase.id;
    }

    const activeCase = await prisma.case.findFirst({
      where: {
        id: parseInt(targetCaseId, 10),
        msme_customer_user_id: userId
      }
    });

    if (!activeCase) {
      throw new Error("Case not found or unauthorized");
    }

    // NOTE: We intentionally do NOT create a Proposal here. The MSME customer's
    // selected lender (msme_selected_lender_esr_id) is kept on the Case as a
    // preference signal only - the assigned DSA creates the actual Proposal
    // themselves after the Cred2Tech admin allocates this case to them. The
    // customer's requested terms are preserved as a note for that DSA to see.
    const { requested_amount, tenure_months, interest_rate } = submissionData;
    let dsaNotes = activeCase.dsa_notes || '';
    if (requested_amount || tenure_months || interest_rate) {
      // requested_amount is a plain rupee figure from the wizard's amount
      // field, not lakhs - format it as currency instead of blindly
      // appending "L" (which previously turned ₹40,00,000 into "₹4000000L").
      const amountStr = requested_amount ? `₹${Number(requested_amount).toLocaleString('en-IN')}` : '—';
      const requestedTermsNote = `[MSME Requested Terms] Amount: ${amountStr}, Tenure: ${tenure_months || '—'} months, Rate: ${interest_rate || '—'}%`;
      dsaNotes = dsaNotes ? `${dsaNotes}\n${requestedTermsNote}` : requestedTermsNote;
    }

    const updatedCase = await prisma.case.update({
      where: { id: activeCase.id },
      data: {
        msme_submitted_at: new Date(),
        stage: 'LEAD_CREATED',
        dsa_notes: dsaNotes || undefined
      }
    });

    await prisma.activityLog.create({
      data: {
        case_id: activeCase.id,
        activity_type: 'SUBMITTED_TO_CRED2TECH',
        description: `Case submitted to Cred2Tech admin queue`,
        performed_by_user_id: userId
      }
    });

    return {
      case_id: updatedCase.id,
      case_reference: `MSME-${new Date().getFullYear()}-${updatedCase.id}`,
      message: "Submitted successfully"
    };
  }
};

module.exports = directCustomerService;
