import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { customerService } from '../api/customerService';
import { caseService } from '../api/caseService';
import { otpService } from '../api/otpService';
import FormField from '../components/ui/FormField';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { Search, CheckCircle2, ChevronRight, Check, AlertCircle } from 'lucide-react';
import GstAnalyticsForm from '../components/GstAnalyticsForm';
import ItrAnalyticsForm from '../components/ItrAnalyticsForm';
import BankStatementUpload from '../components/BankStatementUpload';
import SalarySlipUploader from '../components/onboarding/SalarySlipUploader';
import DataPullProgress from '../components/onboarding/DataPullProgress';
import api from '../api/axiosInstance';
import { useAuth } from '../context/AuthContext';
import { usePullStatusStream } from '../hooks/usePullStatusStream';

import { msmeApi } from '../api/directMsme';

const AddCustomerWizardPage = ({ mode = 'DSA' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const searchParams = new URLSearchParams(location.search);
  const urlCaseId = searchParams.get('caseId');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [caseId, setCaseId] = useState(null);
  const [isResumed, setIsResumed] = useState(false);
  const [coappPanVerifyingMap, setCoappPanVerifyingMap] = useState({});
  const { statuses: realPullStatuses, isConnected: sseConnected } = usePullStatusStream(caseId);

  const [formData, setFormData] = useState({
    customer_id: null,
    business_pan: '',
    business_name: '',
    business_mobile: '',
    business_email: '',
    dob: '',
    mobile_verified: false,
    applicants: [],
    linked_gstins: [],
    product_type: '',
    is_professional: false,
    profession_type: '',
    // Property (Step 3)
    property_type: '',
    occupancy_status: 'Self Occupied',
    ownership_type: 'Sole Owner',
    market_value: ''
  });

  const [costs, setCosts] = useState({ GST_FETCH: 0, ITR_ANALYTICS: 0, BANK_ANALYSIS: 0 });
  const [walletBalance, setWalletBalance] = useState(0);

  useEffect(() => {
    if (urlCaseId) {
      const wasStartedFresh = sessionStorage.getItem('onboarding_started_fresh_' + urlCaseId) === 'true';
      if (!wasStartedFresh) {
        setIsResumed(true);
      }
    }
  }, [urlCaseId]);


  useEffect(() => {
    if (mode !== 'MSME_SELF_SERVICE') {
      api.get('/wallet/api-costs')
        .then(res => {
          const data = res.data;
          const gst = data.find(d => d.api_code === 'GST_FETCH')?.tenant_cost || 0;
          const itr = data.find(d => d.api_code === 'ITR_ANALYTICS')?.tenant_cost || 0;
          const bank = data.find(d => d.api_code === 'BANK_ANALYSIS')?.tenant_cost || 0;
          setCosts({ GST_FETCH: gst, ITR_ANALYTICS: itr, BANK_ANALYSIS: bank });
        })
        .catch(err => console.error(err));

      api.get('/wallet/balance')
        .then(res => setWalletBalance(res.data.balance))
        .catch(console.error);
    }
  }, [mode]);

useEffect(() => {
  if (mode === 'MSME_SELF_SERVICE') {
    msmeApi.getDashboard().then(res => {
      setFormData(prev => ({
        ...prev,
        business_mobile: prev.business_mobile || res.data.user.mobile,
        mobile_verified: true
      }));
    }).catch(console.error);
  }
}, [mode]);

const [panVerifying, setPanVerifying] = useState(false);
const [existingCustomer, setExistingCustomer] = useState(null);
const [duplicateWarning, setDuplicateWarning] = useState(null);
const [suggestedCoApplicants, setSuggestedCoApplicants] = useState([]);

// OTP Modal State
const [otpModal, setOtpModal] = useState({
  isOpen: false,
  targetType: null,
  targetId: null,
  mobile: '',
  purpose: '',
  otpInput: '',
  loading: false
});

useEffect(() => {
  restoreSession();
}, [urlCaseId]);

const restoreSession = async () => {
  try {
    setLoading(true);
    if (!urlCaseId) {
      setLoading(false);
      return;
    }

    const caseData = await caseService.getCaseById(urlCaseId);

    if (caseData.stage === 'LEAD_CREATED') {
      toast.success("This case is already active.");
      navigate(mode === 'MSME_SELF_SERVICE' ? '/msme/dashboard' : '/customers', { replace: true });
      return;
    }

    setCaseId(caseData.id);
    setSuggestedCoApplicants(caseData.suggested_co_applicants || []);

    // Identify Primary from applicants list
    const primaryApp = caseData.applicants?.find(a => a.type === 'PRIMARY');

    setFormData({
      customer_id: caseData.customer?.id,
      business_pan: caseData.customer?.business_pan || '',
      business_name: caseData.customer?.business_name || '',
      business_mobile: (caseData.customer?.business_mobile || '').replace(/\D/g, ''),
      business_email: caseData.customer?.business_email || '',
      dob: caseData.customer?.dob || '',
      mobile_verified: mode === 'MSME_SELF_SERVICE' ? true : (caseData.customer?.mobile_verified || false),
      is_professional: caseData.customer?.is_professional || false,
      profession_type: caseData.customer?.profession_type || '',
      pan_verified: primaryApp?.pan_verified || false,
      applicants: (caseData.applicants || []).map(app => ({
        ...app,
        mobile: (app.mobile || '').replace(/\D/g, ''),
        linked_gstins: caseData.customer?.pan_profiles?.find(p => p.pan === app.pan_number)?.gstin_records || []
      })),
      product_type: caseData.product_type || '',
      property_type: caseData.property?.property_type || '',
      occupancy_status: caseData.property?.occupancy_status || 'Self Occupied',
      ownership_type: caseData.property?.ownership_type || 'Sole Owner',
      market_value: caseData.property?.market_value || '',
      // Recover pull statuses
      gst_completed: (caseData.data_pull_status?.gst_status === 'COMPLETE') || !!caseData.business_financials?.gst_profile || !!caseData.business_financials?.gst_request,
      gst_profile: caseData.business_financials?.gst_profile?.raw_response || null,
      itr_completed: (caseData.data_pull_status?.itr_status === 'COMPLETE') || !!caseData.business_financials?.itr_analytics,
      business_itr_profile: caseData.business_financials?.itr_analytics || null,
      business_bank_profile: caseData.business_financials?.bank_statements || null,
      pan_profile: caseData.customer?.pan_profiles?.find(p => p.pan === caseData.customer.business_pan) || null,
      linked_gstins: caseData.customer?.pan_profiles?.find(p => p.pan === caseData.customer.business_pan)?.gstin_records || []
    });

    // Navigate to step 2 if primary details and mobile are verified
    if (caseData.customer?.mobile_verified && caseData.applicants?.length > 0) {
      setCurrentStep(2);
    } else {
      setCurrentStep(1);
    }

  } catch (error) {
    console.error(error);
    toast.error('Failed to restore case draft.');
  } finally {
    setLoading(false);
  }
};

const checkPanDuplicate = async (pan) => {
  if (!pan || pan.length !== 10) return; // Only check complete 10-char PAN
  try {
    const res = await api.get('/customers/check-existing-by-pan', { params: { pan } });
    if (res.data?.existingCustomerFound && res.data.customer?.id) {
      setDuplicateWarning({
        id: res.data.customer.id,
        name: res.data.customer.business_name,
        pan: res.data.customer.business_pan,
        mobile: res.data.customer.business_mobile,
        category: res.data.customer.category,
        summary: res.data.reusable_summary
      });
    } else {
      setDuplicateWarning(null);
    }
  } catch (err) {
    // 404 means no duplicate found — this is the normal path
    if (err.response?.status === 404) {
      setDuplicateWarning(null);
    } else {
      console.error('[PAN duplicate check]', err);
    }
  }
};

const handleContinueAsNewCase = async () => {
  if (!duplicateWarning) return;
  try {
    setSaving(true);
    const res = await api.post('/cases/create-from-existing', {
      customer_id: duplicateWarning.id
    });
    const newCaseId = res.data.id;
    sessionStorage.setItem('onboarding_started_fresh_' + newCaseId, 'true');
    toast.success('New case created with existing customer data!');
    setDuplicateWarning(null);
    navigate(`/customers/add?caseId=${newCaseId}`);
  } catch (error) {
    console.error('[handleContinueAsNewCase]', error);
    toast.error(error.response?.data?.error || 'Failed to create new case from existing customer.');
  } finally {
    setSaving(false);
  }
};

const ensureDraftSaved = async () => {
  let targetCaseId = caseId;
  let targetCustomerId = formData.customer_id;

  if (!targetCaseId && !formData.business_pan) {
    throw new Error("PAN is required to start the case");
  }

  // Validation: Ensure mobile is numeric (to prevent PAN being entered in mobile field)
  if (/[a-zA-Z]/.test(formData.business_mobile)) {
    throw new Error("Invalid Mobile Number. Please ensure you haven't entered the PAN in the mobile field.");
  }

  // Always upsert the customer data so email/name updates are preserved
  const customer = await customerService.createOrAttach({
    customer_id: formData.customer_id,
    business_pan: formData.business_pan,
    business_name: formData.business_name,
    business_mobile: formData.business_mobile,
    business_email: formData.business_email,
    dob: formData.dob,
    is_professional: formData.is_professional === 'true' || formData.is_professional === true,
    profession_type: (formData.is_professional === 'true' || formData.is_professional === true) ? formData.profession_type : null
  });
  targetCustomerId = customer.id;

  if (!targetCaseId) {
    const newCase = await caseService.createCase(customer.id);
    targetCaseId = newCase.id;
    sessionStorage.setItem('onboarding_started_fresh_' + targetCaseId, 'true');

    setCaseId(targetCaseId);
    setFormData(prev => ({
      ...prev,
      customer_id: targetCustomerId,
      applicants: newCase.applicants || []
    }));
    navigate(`?caseId=${targetCaseId}`, { replace: true });
  }

  return { targetCaseId, targetCustomerId };
};

const handleVerifyPan = async (isCoapplicant = false, idx = null) => {
  // Prevent React onClick passing the synthetic event object as the first parameter
  if (typeof isCoapplicant === 'object') {
    isCoapplicant = false;
    idx = null;
  }

  const panToVerify = isCoapplicant ? formData.applicants[idx].pan_number : formData.business_pan;
  if (!panToVerify || panToVerify.length < 10) return toast.error('Valid 10-digit PAN required');

  if (isCoapplicant) {
    setCoappPanVerifyingMap(prev => ({ ...prev, [idx]: true }));
  } else {
    setPanVerifying(true);
  }

  try {
    // Create or ensure case exists
    let targetCaseId = caseId;
    let targetCustomerId = formData.customer_id;
    if (!targetCaseId) {
      const draft = await ensureDraftSaved();
      targetCaseId = draft.targetCaseId;
      targetCustomerId = draft.targetCustomerId;
    }

    let applicantId = isCoapplicant && idx !== null ? formData.applicants[idx].id : null;
    if (isCoapplicant && idx !== null && !applicantId) {
      // Save the applicant first to get their ID, ensuring PAN-first flow works
      const savedApp = await caseService.addApplicant(targetCaseId, formData.applicants[idx]);
      applicantId = savedApp.id;
      const list = [...formData.applicants];
      list[idx] = savedApp;
      setFormData(prev => ({ ...prev, applicants: list }));
    }

    const res = await api.post(`/external/pan/verify`, {
      pan: panToVerify,
      customer_id: targetCustomerId,
      case_id: targetCaseId,
      is_coapplicant: isCoapplicant,
      applicant_id: applicantId
    });
    const data = res.data;

    const entityName = data.name || '';
    const entityDob = data.dob || '';

    if (isCoapplicant && idx !== null) {
      const list = [...formData.applicants];
      list[idx] = {
        ...list[idx],
        id: applicantId, // make sure ID is preserved
        name: entityName,
        dob: entityDob,
        pan_verified: true
      };
      setFormData(prev => ({ ...prev, applicants: list }));
    } else {
      setFormData(prev => ({
        ...prev,
        business_name: entityName && !prev.business_name ? entityName : prev.business_name,
        dob: entityDob && !prev.dob ? entityDob : prev.dob,
        pan_verified: true
      }));
    }

    toast.success('PAN Verified Successfully!');

  } catch (err) {
    const errMsg = err.response?.data?.error_message || err.response?.data?.error || err.message || 'Failed to verify PAN';
    toast.error(errMsg);
  } finally {
    if (isCoapplicant) {
      setCoappPanVerifyingMap(prev => ({ ...prev, [idx]: false }));
    } else {
      setPanVerifying(false);
    }
  }
};

const handleResetPan = async (isCoapplicant = false, idx = null) => {
  let applicantId = null;
  if (isCoapplicant) {
    applicantId = formData.applicants[idx]?.id;
  } else {
    // For primary applicant, find the applicant with type === 'PRIMARY'
    const primaryApp = formData.applicants.find(a => a.type === 'PRIMARY');
    applicantId = primaryApp?.id;
  }

  if (!applicantId) {
    return toast.error("Cannot reset: Applicant ID not found");
  }

  if (!window.confirm("Are you sure you want to reset this PAN verification? This will clear verified names and lock status.")) {
    return;
  }

  try {
    setSaving(true);
    await api.post('/external/pan/reset', {
      applicant_id: applicantId,
      case_id: caseId
    });
    toast.success("PAN Verification reset successfully.");
    
    // Refresh page details
    await restoreSession();
  } catch (err) {
    toast.error(err.response?.data?.error || "Failed to reset PAN verification");
  } finally {
    setSaving(false);
  }
};

const handleFetchGst = async () => {
  if (!formData.business_pan || formData.business_pan.length < 10) return toast.error('Valid PAN required');
  if (!formData.customer_id || !caseId) return toast.error('Please verify mobile first to generate a case');
  setSaving(true);

  try {
    const res = await api.post(`/external/pan/fetch`, {
      pan: formData.business_pan,
      customer_id: formData.customer_id,
      case_id: caseId
    });
    const data = res.data;

    setFormData(prev => ({
      ...prev,
      pan_profile: data,
      linked_gstins: data.gst_records || []
    }));

    toast.success('GST Records Fetched Successfully!');

  } catch (err) {
    const errMsg = err.response?.data?.error_message || err.response?.data?.error || err.message || 'Failed to fetch GST';
    toast.error(errMsg);
  } finally {
    setSaving(false);
  }
};


const handleSendPrimaryOtp = async () => {
  try {
    setSaving(true);
    const { targetCustomerId } = await ensureDraftSaved();
    const res = await otpService.sendOtp({
      mobile: formData.business_mobile,
      purpose: 'PRIMARY_APPLICANT',
      target_type: 'CUSTOMER',
      target_id: targetCustomerId
    });
    if (res.otp) toast.success(`[DEV] OTP: ${res.otp}`, { duration: 10000 });
    else toast.success('OTP sent');

    setOtpModal({ isOpen: true, targetType: 'CUSTOMER', targetId: targetCustomerId, mobile: formData.business_mobile, purpose: 'PRIMARY_APPLICANT', otpInput: '', loading: false });
  } catch (e) {
    toast.error(e.response?.data?.error || e.message);
  } finally {
    setSaving(false);
  }
};

const handleSendCoapplicantOtp = async (index) => {
  const app = formData.applicants[index];
  if (!app.pan_number || !app.mobile) return toast.error("PAN and Mobile required for Co-Applicant OTP");

  try {
    setSaving(true);
    const { targetCaseId } = await ensureDraftSaved();

    let targetAppId = app.id;
    if (!targetAppId) {
      const savedApp = await caseService.addApplicant(targetCaseId, app);
      targetAppId = savedApp.id;
      const newArr = [...formData.applicants];
      newArr[index] = savedApp;
      setFormData(prev => ({ ...prev, applicants: newArr }));
    }

    const res = await otpService.sendOtp({
      mobile: app.mobile,
      purpose: 'CO_APPLICANT',
      target_type: 'APPLICANT',
      target_id: targetAppId
    });
    if (res.otp) toast.success(`[DEV] OTP: ${res.otp}`, { duration: 10000 });
    else toast.success('OTP sent');

    setOtpModal({ isOpen: true, targetType: 'APPLICANT', targetId: targetAppId, mobile: app.mobile, purpose: 'CO_APPLICANT', otpInput: '', loading: false });
  } catch (err) {
    toast.error(err.response?.data?.error || err.message || 'Failed to send OTP');
  } finally {
    setSaving(false);
  }
};

const handleVerifyOtpSubmit = async () => {
  if (otpModal.otpInput.length < 6) return toast.error("Enter valid 6-digit OTP");
  try {
    setOtpModal(prev => ({ ...prev, loading: true }));
    await otpService.verifyOtp({
      otp: otpModal.otpInput,
      target_type: otpModal.targetType,
      target_id: otpModal.targetId
    });

    toast.success("Verified Successfully!");

    if (otpModal.targetType === 'CUSTOMER') {
      setFormData(prev => ({ ...prev, mobile_verified: true }));
    } else {
      const newArr = [...formData.applicants].map(a =>
        a.id === otpModal.targetId ? { ...a, otp_verified: true } : a
      );
      setFormData(prev => ({ ...prev, applicants: newArr }));
    }
    setOtpModal({ isOpen: false, targetType: null, targetId: null, mobile: '', purpose: '', otpInput: '', loading: false });
  } catch (err) {
    toast.error(err.response?.data?.error || 'Invalid OTP');
  } finally {
    setOtpModal(prev => ({ ...prev, loading: false }));
  }
};

const handleResendOtp = async () => {
  try {
    setOtpModal(prev => ({ ...prev, loading: true }));
    const res = await otpService.resendOtp({
      mobile: otpModal.mobile,
      purpose: otpModal.purpose,
      target_type: otpModal.targetType,
      target_id: otpModal.targetId
    });
    if (res.otp) toast.success(`[DEV] New OTP: ${res.otp}`, { duration: 10000 });
    else toast.success('New OTP sent');
  } catch (err) {
    toast.error(err.response?.data?.error || 'Failed to resend');
  } finally {
    setOtpModal(prev => ({ ...prev, loading: false }));
  }
};

const addCoApplicantRow = () => {
  setFormData(prev => ({
    ...prev,
    applicants: [...prev.applicants, { type: 'CO_APPLICANT', name: '', employment_type: 'SELF_EMPLOYED', pan_number: '', mobile: '', email: '', otp_verified: false }]
  }));
};

const updateApplicantRow = (idx, field, val) => {
  const list = [...formData.applicants];
  list[idx] = { ...list[idx], [field]: val };
  setFormData(prev => ({ ...prev, applicants: list }));
};

const handleReuseApplicant = async (sourceAppId) => {
  try {
    setSaving(true);
    await caseService.reuseApplicant(caseId, sourceAppId);
    toast.success("Applicant added from past case successfully!");
    await restoreSession(); // Refresh to pull them into current applicants
  } catch (error) {
    toast.error(error.response?.data?.error || "Failed to reuse applicant");
  } finally {
    setSaving(false);
  }
};

const removeApplicant = async (index) => {
  const app = formData.applicants[index];
  if (app.id) {
    if (!window.confirm('Are you sure you want to remove this applicant from the current case?')) return;
    try {
      setSaving(true);
      await caseService.removeApplicant(caseId, app.id);
      toast.success("Applicant removed from case.");
      await restoreSession();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to remove applicant");
    } finally {
      setSaving(false);
    }
  } else {
    const arr = [...formData.applicants];
    arr.splice(index, 1);
    setFormData(prev => ({ ...prev, applicants: arr }));
  }
};

const handleStep1Submit = async (e) => {
  e.preventDefault();
  if (!formData.business_pan) return toast.error("Business PAN is required.");
  if (!formData.mobile_verified && mode !== 'MSME_SELF_SERVICE') return toast.error("Primary Business Mobile must be verified before proceeding.");

  try {
    setSaving(true);
    const { targetCaseId } = await ensureDraftSaved();

    const savedApps = [];
    for (const app of formData.applicants) {
      if (app.pan_number) {
        const savedApp = await caseService.addApplicant(targetCaseId, app);
        savedApps.push(savedApp);
      }
    }
    setFormData(prev => ({ ...prev, applicants: savedApps }));

    setCurrentStep(2);
  } catch (error) {
    toast.error(error.response?.data?.error || error.message);
  } finally {
    setSaving(false);
  }
};

const handleGenerateGst = async (months) => {
  if (!formData.customer_id) return toast.error("Customer ID missing. Please go back and resave.");

  try {
    setSaving(true);
    const res = await api.post(`/external/gst-fetch`, {
      customer_id: formData.customer_id, case_id: caseId,
      months, gstin: formData.gstin || '27XXXXX1234X1Z5'
    });
    const data = res.data;

    setFormData(prev => ({ ...prev, gst_completed: true, gst_profile: data.gstProfile }));
    toast.success("GST Report Generated successfully!");
  } catch (err) {
    if (err.message.includes('Insufficient credits')) toast.error("Insufficient Credits - Top Up Required!", { duration: 5000 });
    else toast.error(err.message);
  } finally {
    setSaving(false);
  }
};

const handleGenerateItr = async (years) => {
  if (!formData.customer_id) return toast.error("Customer ID missing.");

  try {
    setSaving(true);
    const res = await api.post(`/external/itr-fetch`, {
      customer_id: formData.customer_id, case_id: caseId,
      years, pan: formData.business_pan
    });
    const data = res.data;

    setFormData(prev => ({ ...prev, itr_completed: true, itr_profile: data.itrProfile }));
    toast.success("ITR Report Generated successfully!");
  } catch (err) {
    if (err.message.includes('Insufficient credits')) toast.error("Insufficient Credits - Top Up Required!", { duration: 5000 });
    else toast.error(err.message);
  } finally {
    setSaving(false);
  }
};

const handleRunBureau = async (applicantId) => {
  if (!caseId) return toast.error("Case ID missing");
  if (saving) return; // prevent double-click race
  try {
    setSaving(true);
    const res = await api.post(`/verification/bureau/run/${caseId}`, { applicantId });
    const data = res.data;

    if (data.status === 'FAILED') {
      const errMsg = data.errors?.[0]?.error || 'Bureau fetch failed';
      toast.error(errMsg);
      return;
    }

    if (data.status === 'PARTIAL_SUCCESS') {
      toast.error(`Partial failure: ${data.errors?.[0]?.error || 'Some applicants failed'}`);
    } else {
      toast.success("Bureau pull success!");
    }

    // Update local state to reflect bureau_fetched and the new score
    const updatedApps = formData.applicants.map(a => {
      if (a.id === applicantId) {
        // Find the score in the response
        const newScore = a.type === 'PRIMARY' ? data.applicantScore : data.coApplicantScores.find(cs => cs.applicantId === a.id)?.score;
        return { ...a, bureau_fetched: true, cibil_score: newScore || a.cibil_score };
      }
      return a;
    });
    setFormData(prev => ({ ...prev, applicants: updatedApps }));
  } catch (err) {
    toast.error(err.response?.data?.error || "Bureau fetch failed");
  } finally {
    setSaving(false);
  }
};

const handleStep2Submit = async (e) => {
  e.preventDefault();
  // ESR Guard: Allow if any reused or freshly-pulled income source exists
  const hasReusedIncomeEntries = formData.applicants?.some(a => a.income_entries?.length > 0);
  const hasBankData = !!formData.customer_bank_profile;
  const hasIncome = formData.gst_completed || formData.itr_completed || hasBankData || hasReusedIncomeEntries;
  if (!hasIncome) {
    return toast.error("At least one financial source (GST, ITR, Bank, or Income Entry) must be completed before product selection.");
  }
  setCurrentStep(3);
};

const PROPERTY_REQUIRED = ['LAP', 'HL'];

const handleStep3Submit = async (e) => {
  e.preventDefault();
  if (!formData.product_type) return toast.error('Please select a loan product.');
  const needsProperty = PROPERTY_REQUIRED.includes(formData.product_type);
  if (needsProperty && !formData.property_type) return toast.error('Property type is required for LAP/HL.');
  if (needsProperty && !formData.market_value) return toast.error('Market value is required for LAP/HL.');

  try {
    setSaving(true);
    const payload = {
      product_type: formData.product_type,
      property: needsProperty ? {
        property_type: formData.property_type,
        occupancy_status: formData.occupancy_status,
        ownership_type: formData.ownership_type,
        market_value: parseFloat(formData.market_value)
      } : null
    };
    await caseService.updateProductProperty(caseId, payload);
    localStorage.removeItem('draftCaseId');
    toast.success('Product & property saved!');
    navigate(`/cases/${caseId}/income-summary`);
  } catch (error) {
    toast.error(error.response?.data?.error || 'Failed to save product details.');
  } finally {
    setSaving(false);
  }
};

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}><LoadingSpinner size={40} /></div>;

  const sectionDescription = currentStep === 1 ? "Business Details" : currentStep === 2 ? "Financial Information" : "Product Selection";

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            {formData.business_name || (isResumed ? "Resume Draft Case" : "New Customer Onboarding")}
          </h1>
          <p style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
            {isResumed && <span style={{ fontWeight: 600, marginRight: 8, color: 'var(--primary)' }}>Continuing saved application •</span>}
            {sectionDescription}
          </p>
        </div>
        {caseId && (
          <div style={{ color: 'var(--success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={16} /> Auto-saved
          </div>
        )}
      </div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {currentStep === 1 && (
        <form onSubmit={handleStep1Submit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {duplicateWarning && !caseId && mode !== 'MSME_SELF_SERVICE' && (
            <div className="notice" style={{ background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: '12px', padding: '20px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FFE0B2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Search size={22} color="#F57C00" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h4 style={{ fontWeight: 700, fontSize: 16, color: '#E65100', marginBottom: 4 }}>Existing customer found: {duplicateWarning.name || 'N/A'}</h4>
                      <p style={{ fontSize: 13, color: '#BF360C', marginBottom: 12 }}>PAN {duplicateWarning.pan} is already registered in your tenant. You can reuse the existing data for a new case.</p>
                    </div>
                    <button type="button" onClick={() => navigate(`/customers/${duplicateWarning.id}`)} style={{ background: 'white', border: '1px solid #FFB74D', padding: '6px 12px', borderRadius: '6px', fontSize: 12, fontWeight: 600, color: '#E65100', cursor: 'pointer' }}>View Existing Profile</button>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.5)', borderRadius: '8px', padding: '12px', marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                    <div style={{ fontSize: 11, color: '#A04000', fontWeight: 600, textTransform: 'uppercase', gridColumn: '1/-1', marginBottom: -4 }}>Reusable Data Available:</div>
                    {duplicateWarning.summary?.gst?.available && <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#5D4037' }}><Check size={14} color="#388E3C" /> GST Data</div>}
                    {duplicateWarning.summary?.itr?.available && <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#5D4037' }}><Check size={14} color="#388E3C" /> ITR Analytics</div>}
                    {duplicateWarning.summary?.bank?.available && <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#5D4037' }}><Check size={14} color="#388E3C" /> Bank Statement</div>}
                    {duplicateWarning.summary?.bureau?.available && <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#5D4037' }}><Check size={14} color="#388E3C" /> Bureau Score</div>}
                    {duplicateWarning.summary?.salary_ocr?.available && <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, color: '#5D4037' }}><Check size={14} color="#388E3C" /> Salary OCR</div>}
                  </div>

                  <button
                    type="button"
                    onClick={handleContinueAsNewCase}
                    disabled={saving}
                    style={{ background: '#E65100', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    {saving ? 'Creating...' : 'Continue as New Case →'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Business Entity Card */}
          <div className="card">
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Business Entity</h3>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Enter PAN — profile fetched automatically</span>
            </div>

            <div style={{ padding: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                <FormField label="PAN NUMBER" name="business_pan" required disabled={formData.pan_profile || formData.pan_verified || (formData.mobile_verified && mode !== 'MSME_SELF_SERVICE')}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      type="text"
                      value={formData.business_pan}
                      onChange={e => setFormData({ ...formData, business_pan: e.target.value.toUpperCase() })}
                      onBlur={() => checkPanDuplicate(formData.business_pan)}
                      className="form-control"
                      placeholder="E.G. AABCE1234F"
                      disabled={formData.pan_profile || formData.pan_verified || (formData.mobile_verified && mode !== 'MSME_SELF_SERVICE')}
                      style={{ textTransform: 'uppercase' }}
                    />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button type="button" onClick={handleVerifyPan} disabled={panVerifying || !formData.business_pan || formData.pan_verified} className="btn btn-secondary">
                        {panVerifying ? 'Wait...' : (formData.pan_verified ? 'Verified' : 'Verify PAN')}
                      </button>
                      {formData.pan_verified && (user?.role === 'DSA_ADMIN' || user?.role === 'SUPER_ADMIN') && (
                        <button type="button" onClick={() => handleResetPan(false, null)} className="btn btn-danger" style={{ backgroundColor: 'var(--error)', color: 'white', border: 'none' }} disabled={saving}>
                          Reset
                        </button>
                      )}
                      <button type="button" onClick={handleFetchGst} disabled={saving || !formData.business_pan || formData.pan_profile} className="btn btn-outline" style={{ border: '1px solid var(--border)', background: 'white' }}>
                        {formData.pan_profile ? 'GST Fetched' : 'Fetch GST'}
                      </button>
                    </div>
                  </div>
                </FormField>

                <FormField label="BUSINESS NAME / FULL NAME" name="business_name">
                  <input
                    type="text"
                    value={formData.business_name}
                    onChange={e => setFormData({ ...formData, business_name: e.target.value })}
                    className="form-control"
                    placeholder="Autofetched via PAN or enter manually"
                  />
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                <FormField label="DATE OF BIRTH / INCORPORATION" name="dob">
                  <input
                    type="date"
                    value={formData.dob || ''}
                    onChange={e => setFormData({ ...formData, dob: e.target.value })}
                    className="form-control"
                  />
                </FormField>

                <FormField label="MOBILE NUMBER" name="business_mobile" required disabled={formData.mobile_verified}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      type="tel"
                      value={formData.business_mobile}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, ''); // Keep only digits
                        setFormData({ ...formData, business_mobile: val });
                      }}
                      className="form-control"
                      placeholder="9820012345"
                      disabled={formData.mobile_verified || mode === 'MSME_SELF_SERVICE'}
                    />
                    {(!formData.mobile_verified && mode !== 'MSME_SELF_SERVICE') ? (
                      <button type="button" onClick={handleSendPrimaryOtp} disabled={saving || !formData.business_mobile || !formData.business_pan} className="btn btn-primary" style={{ padding: '0 20px' }}>Send OTP</button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontWeight: 600, padding: '0 10px', whiteSpace: 'nowrap' }}>
                        <CheckCircle2 size={18} /> Verified
                        {mode !== 'MSME_SELF_SERVICE' && (
                          <button type="button" onClick={() => setFormData({ ...formData, mobile_verified: false })} style={{ marginLeft: 8, fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Edit</button>
                        )}
                      </div>
                    )}
                  </div>
                </FormField>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <FormField label="EMAIL ADDRESS" name="business_email" required>
                  <input
                    type="email"
                    value={formData.business_email}
                    onChange={e => setFormData({ ...formData, business_email: e.target.value })}
                    className="form-control"
                    placeholder="admin@company.in"
                  />
                </FormField>

                <FormField label="ARE YOU A PROFESSIONAL?" name="is_professional">
                  <select
                    className="form-control"
                    value={formData.is_professional === true || formData.is_professional === 'true' ? 'true' : 'false'}
                    onChange={e => {
                      const isProf = e.target.value === 'true';
                      setFormData({ ...formData, is_professional: isProf, profession_type: isProf ? formData.profession_type : '' })
                    }}
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </FormField>
              </div>

              {(formData.is_professional === true || formData.is_professional === 'true') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 24 }}>
                  <FormField label="SELECT YOUR PROFESSION" name="profession_type" required>
                    <select
                      className="form-control"
                      value={formData.profession_type || ''}
                      onChange={e => setFormData({ ...formData, profession_type: e.target.value })}
                    >
                      <option value="">Select Profession</option>
                      <option value="CA">CA</option>
                      <option value="Lawyer">Lawyer</option>
                      <option value="Doctor">Doctor</option>
                      <option value="Other">Other</option>
                    </select>
                  </FormField>
                </div>
              )}

              <div style={{ marginTop: 24, padding: '14px 16px', background: 'var(--primary-subtle)', borderRadius: 'var(--radius)', color: 'var(--primary-dark)', fontSize: 12 }}>
                📌 After entering PAN and Mobile, trigger 'Send OTP' to lock your draft and verify ownership.
              </div>
            </div>
          </div>

          {/* Co-Applicants Card */}
          <div className="card">
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Co-Applicants</h3>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>Add each co-applicant's PAN, mobile and email. Bureau is pulled via OTP consent on their mobile.</p>
              </div>
              <button type="button" onClick={addCoApplicantRow} className="btn btn-secondary btn-sm" style={{ fontWeight: 600 }}>+ Add Co-Applicant</button>
            </div>

            <div style={{ padding: 24 }}>
              {/* SUGGESTED CO-APPLICANTS */}
              {suggestedCoApplicants && suggestedCoApplicants.length > 0 && (
                <div style={{ marginBottom: 30 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary-dark)', marginBottom: 12 }}>Suggested Co-Applicants from Past Cases</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {suggestedCoApplicants.map((suggestion, idx) => (
                      <div key={idx} style={{ background: '#F8F9FA', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{suggestion.name || 'Unnamed Co-Applicant'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>
                            PAN: {suggestion.pan_number ? `${suggestion.pan_number.substring(0, 2)}******${suggestion.pan_number.substring(8)}` : 'N/A'} • Mobile: {suggestion.mobile}
                            {suggestion.relationship_to_primary && ` • ${suggestion.relationship_to_primary}`}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {suggestion.bureau_available && <span style={{ fontSize: 11, background: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 12 }}>Bureau Available</span>}
                            {suggestion.documents_available && <span style={{ fontSize: 11, background: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 12 }}>Documents</span>}
                            {suggestion.income_available && <span style={{ fontSize: 11, background: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 12 }}>Income</span>}
                            {suggestion.salary_ocr_available && <span style={{ fontSize: 11, background: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 12 }}>Salary OCR</span>}
                            {suggestion.obligations_available && <span style={{ fontSize: 11, background: '#E3F2FD', color: '#1565C0', padding: '2px 8px', borderRadius: 12 }}>Obligations</span>}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleReuseApplicant(suggestion.source_applicant_id)}
                          disabled={saving}
                          className="btn btn-secondary btn-sm"
                          style={{ fontWeight: 600, color: 'var(--primary)', borderColor: 'var(--primary)' }}>
                          Use in this case
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {formData.applicants.filter(a => a.type === 'CO_APPLICANT').length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius)', color: 'var(--text-tertiary)' }}>
                  No Co-Applicants appended to this profile yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {formData.applicants.map((app, realIdx) => {
                    if (app.type !== 'CO_APPLICANT') return null;
                    const coApplicantIdx = formData.applicants.filter((a, i) => a.type === 'CO_APPLICANT' && i < realIdx).length;
                    return (
                      <div key={realIdx} style={{ backgroundColor: 'var(--bg-base)', border: '1px solid var(--border)', padding: 24, borderRadius: 'var(--radius)', position: 'relative' }}>
                        <div style={{ position: 'absolute', top: 18, right: 24, display: 'flex', gap: 12 }}>
                          <button type="button" onClick={() => removeApplicant(realIdx)} style={{ color: 'var(--error)', fontSize: 13, fontWeight: 600, border: 'none', background: 'none' }}>Remove ×</button>
                        </div>
                        <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-secondary)' }}>Applicant #{coApplicantIdx + 1}</h4>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16, alignItems: 'end', marginBottom: 16 }}>
                          <FormField label="PAN NUMBER" name={`copan_${realIdx}`} required>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                type="text"
                                value={app.pan_number || ''}
                                onChange={e => updateApplicantRow(realIdx, 'pan_number', e.target.value.toUpperCase())}
                                className="form-control"
                                style={{ textTransform: 'uppercase' }}
                                disabled={app.pan_verified}
                                placeholder="E.G. AABCE1234F"
                              />
                              {!app.pan_verified ? (
                                <button
                                  type="button"
                                  onClick={() => handleVerifyPan(true, realIdx)}
                                  disabled={coappPanVerifyingMap[realIdx] || !app.pan_number}
                                  className="btn btn-secondary"
                                  style={{ whiteSpace: 'nowrap' }}
                                >
                                  {coappPanVerifyingMap[realIdx] ? 'Wait...' : 'Verify PAN'}
                                </button>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <CheckCircle2 size={16} /> Verified
                                  </span>
                                  {(user?.role === 'DSA_ADMIN' || user?.role === 'SUPER_ADMIN') && (
                                    <button
                                      type="button"
                                      onClick={() => handleResetPan(true, realIdx)}
                                      className="btn btn-danger btn-sm"
                                      style={{ backgroundColor: 'var(--error)', color: 'white', border: 'none', padding: '4px 8px', fontSize: 11 }}
                                      disabled={saving}
                                    >
                                      Reset
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </FormField>
                          <FormField label="FULL NAME" name={`coname_${realIdx}`}>
                            <input
                              type="text"
                              value={app.name || ''}
                              onChange={e => updateApplicantRow(realIdx, 'name', e.target.value)}
                              className="form-control"
                              placeholder={app.pan_verified ? "Autofetched" : "Enter Full Name"}
                              disabled={app.pan_verified}
                            />
                          </FormField>
                          <FormField label="DATE OF BIRTH" name={`codob_${realIdx}`}>
                            <input
                              type="date"
                              value={app.dob || ''}
                              onChange={e => updateApplicantRow(realIdx, 'dob', e.target.value)}
                              className="form-control"
                              disabled={app.pan_verified}
                            />
                          </FormField>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 16, alignItems: 'end' }}>
                          <FormField label="EMPLOYMENT TYPE" name={`coemp_${realIdx}`}>
                            <select className="form-control" value={app.employment_type || 'SELF_EMPLOYED'} onChange={e => updateApplicantRow(realIdx, 'employment_type', e.target.value)}>
                              <option value="SELF_EMPLOYED">Self Employed</option>
                              <option value="SALARIED">Salaried</option>
                            </select>
                          </FormField>
                          <FormField label="MOBILE NUMBER" name={`comob_${realIdx}`}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                type="tel"
                                value={app.mobile || ''}
                                onChange={e => {
                                  const val = e.target.value.replace(/\D/g, ''); // Keep only digits
                                  updateApplicantRow(realIdx, 'mobile', val);
                                }}
                                className="form-control"
                                placeholder="9820012345"
                                disabled={app.otp_verified}
                              />
                              {!app.otp_verified ? (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => handleSendCoapplicantOtp(realIdx)}
                                  style={{ padding: '0 16px', whiteSpace: 'nowrap' }}
                                  disabled={saving || !app.mobile || !app.pan_verified}
                                >
                                  Send OTP
                                </button>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--success)', fontWeight: 600, padding: '0 8px', whiteSpace: 'nowrap', fontSize: 12 }}>
                                  <CheckCircle2 size={16} /> Verified
                                </div>
                              )}
                            </div>
                          </FormField>
                          <FormField label="EMAIL" name={`coemail_${realIdx}`}>
                            <input
                              type="email"
                              value={app.email || ''}
                              onChange={e => updateApplicantRow(realIdx, 'email', e.target.value)}
                              className="form-control"
                              placeholder="coapp@email.com"
                            />
                          </FormField>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving || (!formData.mobile_verified && mode !== 'MSME_SELF_SERVICE')}>
              {saving ? 'Processing...' : 'Continue to Financials →'}
            </button>
          </div>
        </form>
      )}

      {currentStep === 2 && (
        <form onSubmit={handleStep2Submit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Bureau Section - NEW */}
          {/* Business Financials - Only if Business PAN is provided */}
          {formData.business_pan && (
            <div className="card">
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Business Financials</h3>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>Extrapolated from Business PAN: {formData.business_pan}</p>
              </div>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
                <GstAnalyticsForm
                  caseId={caseId}
                  customerId={formData.customer_id}
                  linkedGstins={formData.linked_gstins || []}
                  onComplete={() => setFormData(prev => ({ ...prev, gst_completed: true }))}
                  onboardingMode={mode}
                />
                <ItrAnalyticsForm
                  caseId={caseId}
                  customerId={formData.customer_id}
                  applicantId={null}
                  applicantType="PRIMARY"
                  applicantName={formData.business_name || formData.business_pan || 'Primary Business'}
                  prefillPan={formData.business_pan}
                  walletBalance={walletBalance}
                  itrCost={costs.ITR_ANALYTICS}
                  existingRecord={formData.business_itr_profile}
                  onComplete={(data) => setFormData(prev => ({ ...prev, itr_completed: true, business_itr_profile: data }))}
                  mode={mode}
                />
                <BankStatementUpload
                  caseId={caseId}
                  customerId={formData.customer_id}
                  applicantId={null}
                  applicantType="PRIMARY"
                  applicantName={formData.business_name || formData.business_pan || 'Primary Business'}
                  walletBalance={walletBalance}
                  analyzeCost={costs.BANK_ANALYSIS}
                  existingStatus={formData.business_bank_profile}
                  onComplete={(status, payload) => console.log('Primary bank complete')}
                  mode={mode}
                />
              </div>
            </div>
          )}

          {/* Applicant Financials */}
          {formData.applicants.sort((a, b) => a.type === 'PRIMARY' ? -1 : 1).map((app, idx) => (
            <div key={app.id || idx} className="card">
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>
                  {app.type === 'PRIMARY' ? 'Primary Borrower' : `Co-Applicant #${formData.applicants.filter(x => x.type === 'CO_APPLICANT').indexOf(app) + 1}`}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  {app.pan_number || 'PAN Pending'} • {app.employment_type || 'Unknown Employment'}
                </p>
              </div>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

                {/* Bureau Verification */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: app.bureau_fetched ? 'var(--success)' : 'var(--warning)' }} />
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600 }}>Bureau Verification</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {app.bureau_fetched && (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>
                        CIBIL: {app.cibil_score || 'N/A'}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`btn btn-sm ${app.bureau_fetched ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => handleRunBureau(app.id)}
                      disabled={saving || (!(app.otp_verified || (app.type === 'PRIMARY' && formData.mobile_verified)) && !(app.type === 'PRIMARY' && mode === 'MSME_SELF_SERVICE')) || app.bureau_fetched}
                      title={(!(app.otp_verified || (app.type === 'PRIMARY' && formData.mobile_verified)) && !(app.type === 'PRIMARY' && mode === 'MSME_SELF_SERVICE')) ? "OTP Verification required before pulling Bureau" : ""}
                    >
                      {app.bureau_fetched ? 'Verified' : 'Run Bureau'}
                    </button>
                  </div>
                </div>

                {/* SELF EMPLOYED Financials */}
                {app.employment_type === 'SELF_EMPLOYED' && (
                  <>
                    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Applicant GST Profile</h4>
                      <GstAnalyticsForm
                        caseId={caseId}
                        customerId={formData.customer_id}
                        applicantId={app.id}
                        linkedGstins={app.linked_gstins || []}
                        onComplete={() => console.log(`Applicant ${app.id} GST complete`)}
                        onboardingMode={mode}
                      />
                    </div>
                    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Applicant ITR Analytics</h4>
                      <ItrAnalyticsForm
                        caseId={caseId}
                        customerId={formData.customer_id}
                        applicantId={app.id}
                        applicantType={app.type}
                        applicantName={app.pan_number || `Applicant ${idx + 1}`}
                        prefillPan={app.pan_number || ''}
                        walletBalance={walletBalance}
                        itrCost={costs.ITR_ANALYTICS}
                        existingRecord={app.itr_analytics?.[0] || null}
                        onComplete={(data) => console.log(`Applicant ${idx} ITR complete`)}
                        mode={mode}
                      />
                    </div>
                    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Applicant Bank Statements</h4>
                      <BankStatementUpload
                        caseId={caseId}
                        customerId={formData.customer_id}
                        applicantId={app.id}
                        applicantType={app.type}
                        applicantName={app.pan_number || `Applicant ${idx + 1}`}
                        walletBalance={walletBalance}
                        analyzeCost={costs.BANK_ANALYSIS}
                        existingStatus={app.bank_statements?.[0] || null}
                        onComplete={(status, payload) => console.log(`Applicant ${idx} bank complete`)}
                        mode={mode}
                      />
                    </div>
                  </>
                )}

                {/* SALARIED Financials */}
                {app.employment_type === 'SALARIED' && (
                  <>
                    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Applicant Bank Statements</h4>
                      <BankStatementUpload
                        caseId={caseId}
                        customerId={formData.customer_id}
                        applicantId={app.id}
                        applicantType={app.type}
                        applicantName={app.pan_number || `Applicant ${idx + 1}`}
                        walletBalance={walletBalance}
                        analyzeCost={costs.BANK_ANALYSIS}
                        existingStatus={app.bank_statements?.[0] || null}
                        onComplete={(status, payload) => console.log(`Applicant ${idx} bank complete`)}
                        mode={mode}
                      />
                    </div>
                    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 16 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Salary Slip OCR</h4>
                      <SalarySlipUploader
                        caseId={caseId}
                        applicantId={app.id}
                        applicantName={app.pan_number}
                        mode={mode}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn btn-ghost" type="button" onClick={() => setCurrentStep(1)}>← Back</button>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>Continue to Product Selection →</button>
          </div>
        </form>
      )}
      {currentStep === 3 && (
        <form onSubmit={handleStep3Submit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Top row: Product + Data Pull Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Loan Product Card */}
            <div className="card">
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg,#FFF5EB,transparent)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--warning)' }}>🏦 Loan Product <span style={{ color: 'var(--error)', fontSize: 12 }}>*</span></h3>
              </div>
              <div style={{ padding: 24 }}>
                <FormField label="SELECT PRODUCT" name="product_type" required>
                  <select
                    className="form-control"
                    value={formData.product_type}
                    onChange={e => setFormData({ ...formData, product_type: e.target.value })}
                    required
                    style={{ border: formData.product_type ? '2px solid var(--warning)' : undefined, background: formData.product_type ? '#FFF5EB' : undefined, color: formData.product_type ? 'var(--warning)' : undefined, fontWeight: 600 }}
                  >
                    <option value="">— Select a loan product —</option>
                    <option value="LAP">LAP — Loan Against Property</option>
                    <option value="HL">HL — Home Loan</option>
                    <option value="WC">Working Capital (CC / OD)</option>
                    <option value="TL">Term Loan (MSME / BL)</option>
                    <option value="ML">Machinery / Equipment Finance</option>
                    <option value="BL">Business Loan (Unsecured)</option>
                    <option value="Other">Other — Specify</option>
                  </select>
                </FormField>
                <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--primary-subtle)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--primary-dark)' }}>
                  💡 Loan amount &amp; tenure will be captured after the lender is identified via ESR.
                </div>
              </div>
            </div>

            {/* Data Pull Status */}
            <div className="card">
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>📡 Data Pull Status</h3>
              </div>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <DataPullProgress
                  label="Bureau Pull"
                  status={realPullStatuses.bureau.status === 'COMPLETED' ? 'COMPLETE' : (realPullStatuses.bureau.status === 'PARTIALLY_COMPLETED' ? 'PENDING' : realPullStatuses.bureau.status)}
                  description={`${realPullStatuses.bureau.completedCount} of ${realPullStatuses.bureau.totalCount} fetched`}
                />
                <DataPullProgress
                  label="GST Report"
                  status={realPullStatuses.gst.status === 'COMPLETED' ? 'COMPLETE' : realPullStatuses.gst.status}
                />
                <DataPullProgress
                  label="ITR Analytics"
                  status={realPullStatuses.itr.status === 'COMPLETED' ? 'COMPLETE' : realPullStatuses.itr.status}
                />
                <DataPullProgress
                  label="Bank Analysis"
                  status={realPullStatuses.bank.status === 'COMPLETED' ? 'COMPLETE' : realPullStatuses.bank.status}
                />
              </div>
            </div>
          </div>

          {/* Property Details — only for LAP / HL */}
          {PROPERTY_REQUIRED.includes(formData.product_type) && (
            <div className="card">
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>🏢 Property &amp; Collateral Details</h3>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Required for {formData.product_type}</span>
              </div>
              <div style={{ padding: 24 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 20 }}>
                  <FormField label="PROPERTY TYPE" name="property_type" required>
                    <select className="form-control" value={formData.property_type} onChange={e => setFormData({ ...formData, property_type: e.target.value })} required>
                      <option value="">— Select —</option>
                      <option value="Commercial — Office / Shop">Commercial — Office / Shop</option>
                      <option value="Residential — House / Flat">Residential — House / Flat</option>
                      <option value="Industrial — Factory / Warehouse">Industrial — Factory / Warehouse</option>
                      <option value="Plot / Land">Plot / Land</option>
                    </select>
                  </FormField>
                  <FormField label="OCCUPANCY STATUS" name="occupancy_status">
                    <select className="form-control" value={formData.occupancy_status} onChange={e => setFormData({ ...formData, occupancy_status: e.target.value })}>
                      <option value="Self Occupied">Self Occupied</option>
                      <option value="Rented Out">Rented Out</option>
                      <option value="Vacant">Vacant</option>
                    </select>
                  </FormField>
                  <FormField label="OWNERSHIP" name="ownership_type">
                    <select className="form-control" value={formData.ownership_type} onChange={e => setFormData({ ...formData, ownership_type: e.target.value })}>
                      <option value="Sole Owner">Sole Owner</option>
                      <option value="Joint Owner">Joint Owner</option>
                      <option value="Company Owned">Company Owned</option>
                    </select>
                  </FormField>
                </div>
                <div style={{ maxWidth: 300 }}>
                  <FormField label="MARKET VALUE (₹)" name="market_value" required>
                    <input type="number" className="form-control" placeholder="e.g. 8500000" value={formData.market_value} onChange={e => setFormData({ ...formData, market_value: e.target.value })} required min="1" />
                  </FormField>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>DSA estimate — lender does independent valuation</div>
                </div>
                <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--primary-subtle)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--primary-dark)' }}>
                  💡 Property location, title clearance, full address will be collected after the lender is identified.
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
            <button className="btn btn-ghost" type="button" onClick={() => setCurrentStep(2)}>← Back</button>
            <button className="btn btn-primary btn-lg" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Next: Income Summary →'}
            </button>
          </div>
        </form>
      )}

    </div>

    {/* OTP Modal */}
    {otpModal.isOpen && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'var(--bg-base)', padding: '32px 40px', borderRadius: '12px', width: '100%', maxWidth: 480, margin: '20px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
            <h3 style={{ fontSize: 20, fontWeight: 700 }}>Verify Mobile OTP</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
            We've sent a 6-digit verification code to <strong>{otpModal.mobile}</strong>.
          </p>
          <FormField label="ENTER 6-DIGIT OTP" name="otpInput">
            <input
              autoFocus
              type="text"
              pattern="\d*"
              maxLength={6}
              className="form-control"
              value={otpModal.otpInput}
              onChange={e => setOtpModal(prev => ({ ...prev, otpInput: e.target.value.replace(/\D/g, '') }))}
              style={{ fontSize: 24, letterSpacing: '0.5em', textAlign: 'center', padding: '16px 0', fontFamily: 'monospace' }}
            />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleResendOtp} disabled={otpModal.loading}>
              Resend OTP
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setOtpModal(prev => ({ ...prev, isOpen: false }))} disabled={otpModal.loading}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleVerifyOtpSubmit} disabled={otpModal.loading || otpModal.otpInput.length < 6}>
                {otpModal.loading ? 'Verifying...' : 'Verify →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
};

export default AddCustomerWizardPage;
