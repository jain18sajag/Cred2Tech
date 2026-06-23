const prisma = require('../../config/db');
const esrService = require('./esr.service');
const razorpayService = require('./razorpay.service');

const directCustomerService = {
  getDashboard: async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, mobile: true, status: true, created_at: true }
    });

    const activeCase = await prisma.case.findFirst({
      where: { 
        msme_customer_user_id: userId,
        stage: { notIn: ['CLOSED', 'REJECTED'] }
      },
      orderBy: { created_at: 'desc' },
      include: {
        customer: true,
        applicants: { where: { is_primary: true } },
        case_payment: true
      }
    });

    // Check if there is an unlinked paid payment (paid but case not started yet)
    const unlinkedPayment = await prisma.casePayment.findFirst({
      where: { user_id: userId, case_id: null, status: 'PAID' },
      orderBy: { created_at: 'desc' }
    });

    let paymentStatus = 'UNPAID';
    if (activeCase && activeCase.case_payment?.status === 'PAID') {
      paymentStatus = 'PAID';
    } else if (unlinkedPayment) {
      paymentStatus = 'PAID';
    }

    return { 
      user, 
      activeCase, 
      paymentStatus,
      emptyState: !activeCase
    };
  },

  updateProfile: async (userId, data) => {
    return await prisma.user.update({
      where: { id: userId },
      data: { name: data.name, email: data.email }
    });
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

  createPaymentOrder: async (userId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    if (dashboard.paymentStatus === 'PAID') {
      throw new Error("Payment already completed or valid paid access exists");
    }

    const config = await directCustomerService.getPaymentConfig();
    const activeCaseId = dashboard.activeCase ? dashboard.activeCase.id : null;
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
      await prisma.case.update({
        where: { id: casePayment.case_id },
        data: { case_payment_id: updatedPayment.id }
      });
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
    
    if (dashboard.activeCase) {
      await prisma.activityLog.create({
        data: {
          case_id: dashboard.activeCase.id,
          activity_type: 'ELIGIBILITY_FORM_STARTED',
          description: 'User resumed the eligibility form',
          performed_by_user_id: userId
        }
      });
    }
    
    return dashboard.activeCase;
  },

  updateBusinessDetails: async (userId, data) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const dashboard = await directCustomerService.getDashboard(userId);
    if (dashboard.paymentStatus !== 'PAID') {
      throw new Error("Payment required to save business details");
    }

    let activeCase = dashboard.activeCase;

    // Delayed Creation: Create Customer and Case if they don't exist yet
    if (!activeCase) {
      const customer = await prisma.customer.create({
        data: {
          tenant_id: user.tenant_id,
          category: 'MSME',
          business_pan: data.business_pan,
          business_name: data.business_name,
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
        await prisma.case.update({
          where: { id: activeCase.id },
          data: { case_payment_id: unlinkedPayment.id }
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

    return await directCustomerService.getDashboard(userId).then(d => d.activeCase);
  },

  updateLoanDetails: async (userId, data) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    const activeCase = dashboard.activeCase;
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
    const activeCase = dashboard.activeCase;
    
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
    if (!dashboard.activeCase) throw new Error("No active case found");

    return await prisma.eligibilityReport.findFirst({
      where: { case_id: dashboard.activeCase.id },
      orderBy: { created_at: 'desc' },
      include: {
        lenders: {
          include: { lender: true, product: true }
        }
      }
    });
  },

  selectLender: async (userId, esrLenderId) => {
    const dashboard = await directCustomerService.getDashboard(userId);
    const activeCase = dashboard.activeCase;
    if (!activeCase) throw new Error("No active case found");

    const esrLender = await prisma.eligibilityReportLender.findFirst({
      where: {
        id: esrLenderId,
        esr: { case_id: activeCase.id },
        is_eligible: true
      }
    });

    if (!esrLender) {
      throw new Error("Invalid lender selection or lender is not eligible");
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

  submitCase: async (userId, caseId) => {
    let targetCaseId = caseId;
    
    // Fallback to active case if caseId is not provided
    if (!targetCaseId) {
      const dashboard = await directCustomerService.getDashboard(userId);
      if (!dashboard.activeCase) throw new Error("No active case found");
      targetCaseId = dashboard.activeCase.id;
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

    const updatedCase = await prisma.case.update({
      where: { id: activeCase.id },
      data: {
        msme_submitted_at: new Date(),
        stage: 'LEAD_CREATED'
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
