import React, { useState, useEffect } from 'react';
import { msmeApi } from '../api/directMsme';
import { useMsmeAuth } from '../context/MsmeAuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useRazorpay } from 'react-razorpay';
import { caseService } from '../api/caseService';

const STEPS = [
  { id: 1, label: 'Business Profile' },
  { id: 2, label: 'Loan Requirements' },
  { id: 3, label: 'Eligibility Check' },
  { id: 4, label: 'Prepare Application' },
  { id: 5, label: 'Submit' }
];

const MsmeOnboarding = () => {
  const { user } = useMsmeAuth();
  const navigate = useNavigate();
  const { Razorpay } = useRazorpay();
  
  const [activeCase, setActiveCase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  const [currentStep, setCurrentStep] = useState(1);
  const [eligibilityResult, setEligibilityResult] = useState(null);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('UNPAID');
  
  // Forms
  const [businessData, setBusinessData] = useState({ business_name: '', business_pan: '', entity_type: 'Proprietorship', industry: '', business_vintage: '' });
  const [loanData, setLoanData] = useState({ loan_amount: '', product_type: 'BL', dsa_notes: '' });
  
  // Prepare Application Form (Step 4)
  const [finalAmount, setFinalAmount] = useState('');
  const [finalTenor, setFinalTenor] = useState('12');
  const [references, setReferences] = useState([
    { name: '', mobile: '', relationship: 'Colleague', address: '' },
    { name: '', mobile: '', relationship: 'Colleague', address: '' }
  ]);

  useEffect(() => {
    fetchCaseState();
  }, []);

  const fetchCaseState = async () => {
    try {
      setLoading(true);
      const res = await msmeApi.startForm();
      setActiveCase(res.data || null);
      if (res.data) {
        syncStateWithCase(res.data);
      } else {
        setCurrentStep(1);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load form');
      navigate('/msme/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const syncStateWithCase = async (c) => {
    if (!c) return;
    if (c.customer) {
      setBusinessData({
        business_name: c.customer.business_name || '',
        business_pan: c.customer.business_pan || '',
        entity_type: c.customer.entity_type || 'Proprietorship',
        industry: c.customer.industry || '',
        business_vintage: c.customer.business_vintage || ''
      });
    }
    setLoanData({
      loan_amount: c.loan_amount || '',
      product_type: c.product_type || 'BL',
      dsa_notes: c.dsa_notes || ''
    });

    if (c.msme_submitted_at) setCurrentStep(5);
    else if (c.msme_selected_lender_esr_id) setCurrentStep(4);
    else if (c.esr_generated) {
      setCurrentStep(3);
      fetchEligibilityResult();
    }
    else if (c.loan_amount) setCurrentStep(2);
    else setCurrentStep(1);
  };

  const fetchEligibilityResult = async () => {
    try {
      const res = await msmeApi.getEligibilityResult();
      setEligibilityResult(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const checkPaymentStatus = async () => {
    try {
      const db = await msmeApi.getDashboard();
      setPaymentStatus(db.data.paymentStatus);
      if (db.data.paymentStatus !== 'PAID') {
        const conf = await msmeApi.getPaymentConfig();
        setPaymentConfig(conf.data);
      }
    } catch (e) {
      console.error('Payment config err', e);
    }
  };

  useEffect(() => {
    if (currentStep === 3) checkPaymentStatus();
  }, [currentStep]);

  const handlePayment = async () => {
    try {
      setActionLoading(true);
      const res = await msmeApi.createPaymentOrder();
      const options = {
        key: res.data.key_id,
        amount: res.data.amount_paise,
        currency: res.data.currency,
        name: 'Cred2Tech MSME Assessment',
        description: 'Multi-Lender Eligibility Check',
        order_id: res.data.order_id,
        handler: async function (response) {
          try {
            await msmeApi.verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });
            toast.success('Payment successful!');
            setPaymentStatus('PAID');
          } catch (err) {
            toast.error('Payment verification failed');
          }
        },
        theme: { color: '#8b5cf6' }
      };
      const rzp1 = new Razorpay(options);
      rzp1.open();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to initiate payment');
    } finally {
      setActionLoading(false);
    }
  };

  const saveBusinessDetails = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await msmeApi.updateBusinessDetails(businessData);
      setActiveCase(res.data);
      toast.success('Business details saved');
      setCurrentStep(2);
    } catch (err) {
      toast.error('Failed to save business details');
    } finally {
      setActionLoading(false);
    }
  };

  const saveLoanDetails = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await msmeApi.updateLoanDetails(loanData);
      setActiveCase(res.data);
      toast.success('Loan requirements saved');
      setCurrentStep(3);
    } catch (err) {
      toast.error('Failed to save loan requirements');
    } finally {
      setActionLoading(false);
    }
  };

  const runEligibility = async () => {
    setActionLoading(true);
    try {
      await msmeApi.runEligibility();
      toast.success('Eligibility check complete');
      await fetchEligibilityResult();
      fetchCaseState();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run eligibility');
    } finally {
      setActionLoading(false);
    }
  };

  const selectLender = async (esrLenderId) => {
    setActionLoading(true);
    try {
      await msmeApi.selectLender(esrLenderId);
      toast.success('Lender selected');
      await fetchCaseState();
    } catch (err) {
      toast.error('Failed to select lender');
    } finally {
      setActionLoading(false);
    }
  };

  const submitToCred2Tech = async () => {
    if (!finalAmount || Number(finalAmount) <= 0) { toast.error('Loan amount is required and must be greater than 0'); return; }
    if (!finalTenor || Number(finalTenor) <= 0) { toast.error('Tenor is required and must be greater than 0'); return; }
    for (let i = 0; i < 2; i++) {
       if (!references[i] || !references[i].name || !references[i].mobile || references[i].mobile.length !== 10) {
           toast.error(`Reference ${i + 1} is incomplete or invalid (Mobile must be 10 digits)`); return;
       }
    }

    setActionLoading(true);
    try {
      await msmeApi.submitCase({
        final_amount: finalAmount,
        final_tenor: finalTenor,
        references
      });
      toast.success('Application submitted successfully!');
      fetchCaseState();
    } catch (err) {
      toast.error('Failed to submit application');
    } finally {
      setActionLoading(false);
    }
  };

  // EMI Calculation for Prepare Application Step
  const emi = React.useMemo(() => {
    if (!finalAmount || !finalTenor) return 0;
    const P = Number(finalAmount) * 100000;
    const r = 11.5 / 12 / 100;
    const n = Number(finalTenor) * 12;
    if (r === 0) return P / n;
    return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }, [finalAmount, finalTenor]);

  const totalRepayment = emi * Number(finalTenor) * 12;
  const totalInterest = Math.max(0, totalRepayment - (Number(finalAmount) * 100000));

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--mid)' }}>Loading application...</div>;

  return (
    <div className="msme-card" style={{ maxWidth: '900px', margin: '0 auto' }}>
      
      <div className="msme-card-header" style={{ paddingBottom: '0', borderBottom: 'none' }}>
        <div>
          <h3>Application Details</h3>
          <p style={{ color: 'var(--mid)', fontSize: '13px', marginTop: '4px' }}>Complete all steps to find your best lender matches.</p>
        </div>
        <button onClick={() => navigate('/msme/dashboard')} className="btn-ghost">Close</button>
      </div>

      <div className="msme-card-body" style={{ paddingTop: '16px' }}>
        
        {/* Wizard Bar */}
        <div className="wizard-bar">
          {STEPS.map((s, idx) => {
            const isCompleted = currentStep > s.id;
            const isActive = currentStep === s.id;
            return (
              <React.Fragment key={s.id}>
                <div className={`wstep ${isActive ? 'active' : ''} ${isCompleted ? 'done' : ''}`}>
                  <div className="wstep-num">{isCompleted ? '✓' : s.id}</div>
                  {s.label}
                </div>
                {idx < STEPS.length - 1 && <div className="wstep-line" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* STEP 1: Business Details */}
        {currentStep === 1 && (
          <form onSubmit={saveBusinessDetails}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
              <div className="form-group">
                <label>Business Name</label>
                <input required type="text" value={businessData.business_name} onChange={e=>setBusinessData({...businessData, business_name: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Business PAN</label>
                <input required type="text" maxLength={10} value={businessData.business_pan} onChange={e=>setBusinessData({...businessData, business_pan: e.target.value.toUpperCase()})} style={{ textTransform: 'uppercase' }} placeholder="ABCDE1234F" />
              </div>
              <div className="form-group">
                <label>Entity Type</label>
                <select value={businessData.entity_type} onChange={e=>setBusinessData({...businessData, entity_type: e.target.value})}>
                  <option>Proprietorship</option>
                  <option>Partnership</option>
                  <option>Private Limited</option>
                  <option>LLP</option>
                </select>
              </div>
              <div className="form-group">
                <label>Industry</label>
                <input type="text" value={businessData.industry} onChange={e=>setBusinessData({...businessData, industry: e.target.value})} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <button disabled={actionLoading} type="submit" className="btn-primary" style={{ width: 'auto', padding: '12px 30px' }}>
                {actionLoading ? 'Saving...' : 'Next Step →'}
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: Loan Requirements */}
        {currentStep === 2 && (
          <form onSubmit={saveLoanDetails}>
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
              <div className="form-group">
                <label>Required Loan Amount (₹)</label>
                <input required type="number" min={10000} value={loanData.loan_amount} onChange={e=>setLoanData({...loanData, loan_amount: e.target.value})} placeholder="e.g. 5000000" />
              </div>
              <div className="form-group">
                <label>Loan Product</label>
                <select value={loanData.product_type} onChange={e=>setLoanData({...loanData, product_type: e.target.value})}>
                  <option value="BL">Business Loan (Unsecured)</option>
                  <option value="LAP">Loan Against Property</option>
                  <option value="WC">Working Capital</option>
                  <option value="ML">Machinery Loan</option>
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>Additional Requirements / Notes</label>
                <textarea rows={3} value={loanData.dsa_notes} onChange={e=>setLoanData({...loanData, dsa_notes: e.target.value})} placeholder="Any specific requirements..."></textarea>
              </div>
             </div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <button type="button" onClick={() => setCurrentStep(1)} className="btn-outline" style={{ border: 'none', background: 'transparent' }}>← Back</button>
              <button disabled={actionLoading} type="submit" className="btn-primary" style={{ width: 'auto', padding: '12px 30px' }}>
                {actionLoading ? 'Saving...' : 'Next Step →'}
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: Eligibility */}
        {currentStep === 3 && (
          <div>
            {!activeCase?.esr_generated ? (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <h3 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '12px', color: 'var(--text)' }}>Ready for Eligibility Check</h3>
                {paymentStatus !== 'PAID' ? (
                  <>
                    <p style={{ color: 'var(--mid)', marginBottom: '30px', maxWidth: '400px', margin: '0 auto 30px', lineHeight: '1.6' }}>
                      To generate your multi-lender eligibility report, a one-time assessment fee is required.
                    </p>
                    {paymentConfig && (
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', maxWidth: '300px', margin: '0 auto 30px' }}>
                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Assessment Fee</div>
                        <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--text)' }}>₹{paymentConfig.amount_inr}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>One-time payment. Valid for 90 days.</div>
                      </div>
                    )}
                    <button onClick={handlePayment} disabled={actionLoading || !paymentConfig} className="btn-primary" style={{ width: 'auto', display: 'inline-block', padding: '14px 40px', fontSize: '16px' }}>
                      {actionLoading ? 'Processing...' : `Pay ₹${paymentConfig?.amount_inr || '...'} to Continue`}
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ color: 'var(--success)', marginBottom: '30px', maxWidth: '400px', margin: '0 auto 30px', lineHeight: '1.6', fontWeight: 600 }}>
                      ✓ Payment Confirmed. Click below to generate your Eligibility Report across multiple lenders.
                    </p>
                    <button onClick={runEligibility} disabled={actionLoading} className="btn-primary" style={{ width: 'auto', display: 'inline-block', padding: '14px 40px', fontSize: '16px' }}>
                      {actionLoading ? 'Generating...' : 'Generate Eligibility Report'}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Your Lender Matches</h3>
                  <span className="badge-status active">Analysis Complete</span>
                </div>
                
                {eligibilityResult ? (
                  <div className="esr-grid">
                    {eligibilityResult.lenders.map((l) => (
                      <div key={l.id} className={`esr-card ${l.is_eligible ? 'eligible' : 'ineligible'}`}>
                        <div className="lender-name">
                          {l.lender_name}
                          {l.is_eligible ? <span className="badge-status success">Eligible</span> : <span className="badge-status" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>Not Eligible</span>}
                        </div>
                        <div className="esr-row">
                          <span className="label">Product</span>
                          <span className="val">{l.product_display_name || l.product_type}</span>
                        </div>
                        <div className="esr-row">
                          <span className="label">Max Amount</span>
                          <span className="val">₹{l.max_loan_amount?.toLocaleString() || 'N/A'}</span>
                        </div>
                        {l.rejection_reasons?.length > 0 && (
                          <div className="esr-reason">Reason: {l.rejection_reasons[0]}</div>
                        )}
                        {activeCase.msme_selected_lender_esr_id === l.id ? (
                           <button className="btn-primary" disabled style={{ marginTop: '20px', padding: '10px', background: 'var(--success)', color: 'white', border: 'none' }}>
                             ✓ Selected
                           </button>
                        ) : (
                           <button onClick={() => selectLender(l.id)} disabled={actionLoading || activeCase.msme_selected_lender_esr_id} className="btn-primary" style={{ marginTop: '20px', padding: '10px' }}>
                             Select this Lender →
                           </button>
                        )}
                      </div>
                    ))}
                    {eligibilityResult.lenders.length === 0 && (
                      <p style={{ color: 'var(--mid)', padding: '20px 0', fontStyle: 'italic' }}>No specific lender match. You can still submit for manual review.</p>
                    )}
                  </div>
                ) : (
                  <p style={{ color: 'var(--light)', padding: '20px 0' }}>Loading results...</p>
                )}
                
                {activeCase.msme_selected_lender_esr_id && (
                  <div style={{ marginTop: '24px', background: '#1E293B', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '12px' }}>
                    <div>
                      <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '4px' }}>Selected Lender</div>
                      <div style={{ color: 'white', fontSize: '18px', fontWeight: '700' }}>
                        {eligibilityResult?.lenders?.find(l => l.id === activeCase.msme_selected_lender_esr_id)?.lender_name || 'Bank'}
                      </div>
                    </div>
                    <button onClick={() => setCurrentStep(4)} className="btn-primary" style={{ width: 'auto', padding: '12px 24px', background: '#6D28D9', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 600 }}>
                      Prepare My Application →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Prepare Application */}
        {currentStep === 4 && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
              <button onClick={() => setCurrentStep(3)} style={{ fontSize: '12px', color: 'var(--primary)', fontWeight: 600, marginBottom: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>← Eligible Lenders</button>
              <h3 style={{ fontSize: '24px', fontWeight: '800', margin: '0 0 4px', color: 'var(--text)' }}>Prepare Application</h3>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-tertiary)' }}>
                {businessData.business_name} — CASE-{activeCase.id} <span style={{ margin: '0 8px' }}>|</span> Preferred Lender: <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{eligibilityResult?.lenders?.find(l => l.id === activeCase.msme_selected_lender_esr_id)?.lender_name || 'Selected Lender'}</span>
              </p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '18px' }}>💰</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Loan Details</h4>
              </div>
              <p style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-tertiary)' }}>Enter the loan amount and tenor for this application</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', background: 'var(--surface)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '16px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', letterSpacing: '0.5px' }}>LOAN AMOUNT (₹ LAKHS) *</label>
                  <input type="number" value={finalAmount} onChange={e => setFinalAmount(e.target.value)} placeholder="e.g. 40" required style={{ padding: '12px', fontSize: '15px' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', letterSpacing: '0.5px' }}>TENOR (YEARS) *</label>
                  <input type="number" value={finalTenor} onChange={e => setFinalTenor(e.target.value)} placeholder="e.g. 12" required style={{ padding: '12px', fontSize: '15px' }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569', letterSpacing: '0.5px' }}>INDICATIVE RATE (% P.A.)</label>
                  <input type="text" value="11.5" disabled style={{ background: '#F8FAFC', color: '#94A3B8', padding: '12px', fontSize: '15px' }} />
                </div>
              </div>

              {emi > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px', marginTop: '16px' }}>
                  <div style={{ padding: '20px', background: '#F3E8FF', borderRadius: '12px', border: '1px solid #D8B4FE', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '12px', color: '#6B21A8', fontWeight: 600, marginBottom: '8px' }}>Monthly EMI</div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#581C87' }}>₹{Math.round(emi).toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '20px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '8px' }}>Total Interest</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-secondary)' }}>₹{(totalInterest / 100000).toFixed(1)}L</div>
                  </div>
                  <div style={{ padding: '20px', background: 'var(--surface)', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '8px' }}>Total Repayment</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-secondary)' }}>₹{(totalRepayment / 100000).toFixed(1)}L</div>
                  </div>
                  <div style={{ padding: '20px', background: '#F0FDF4', borderRadius: '12px', border: '1px solid #BBF7D0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ fontSize: '12px', color: '#166534', fontWeight: 600, marginBottom: '8px' }}>EMI to Income Ratio</div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#15803D' }}>~45%</div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '18px' }}>🤝</span>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>Co-Applicant Profiles</h4>
                </div>
                <span style={{ fontSize: '12px', color: '#10B981', background: '#D1FAE5', padding: '4px 12px', borderRadius: '20px', fontWeight: 600 }}>2 Co-Applicants</span>
              </div>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-tertiary)' }}>Relationship with the company / promoter — included in proposal</p>
              
              <div style={{ background: 'var(--surface)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '15px' }}>{businessData.business_name}</div>
                    <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Primary Borrower / Promoter</div>
                  </div>
                  <span style={{ fontSize: '12px', border: '1px solid #8B5CF6', color: '#7C3AED', padding: '4px 12px', borderRadius: '16px', fontWeight: 600 }}>Primary</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase' }}>Designation</div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Managing Director</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase' }}>Share in Business</div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>60%</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase' }}>PAN</div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{businessData.business_pan}</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{ fontSize: '18px' }}>👥</span>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '700' }}>References</h4>
                <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#475569', padding: '4px 10px', borderRadius: '12px', fontWeight: 600 }}>2 required</span>
              </div>
              
              <div style={{ background: 'var(--surface)', padding: '24px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                {references.map((ref, idx) => (
                  <div key={idx} style={{ marginBottom: idx === 0 ? '32px' : 0, paddingBottom: idx === 0 ? '32px' : 0, borderBottom: idx === 0 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>REFERENCE {idx + 1}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 240px', gap: '20px', marginBottom: '16px' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>FULL NAME</label>
                        <input value={ref.name} onChange={e => setReferences(rs => rs.map((r, i) => i === idx ? { ...r, name: e.target.value } : r))} placeholder="e.g. Suhas Kulkarni" style={{ padding: '12px' }} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>MOBILE</label>
                        <input maxLength={10} value={ref.mobile} onChange={e => setReferences(rs => rs.map((r, i) => i === idx ? { ...r, mobile: e.target.value } : r))} placeholder="e.g. 9823456781" style={{ padding: '12px' }} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>RELATIONSHIP</label>
                        <select value={ref.relationship} onChange={e => setReferences(rs => rs.map((r, i) => i === idx ? { ...r, relationship: e.target.value } : r))} style={{ padding: '12px' }}>
                          <option>Business Associate</option>
                          <option>Colleague</option>
                          <option>Relative</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>ADDRESS</label>
                      <input value={ref.address} onChange={e => setReferences(rs => rs.map((r, i) => i === idx ? { ...r, address: e.target.value } : r))} placeholder="e.g. 12, Kothrud, Pune - 411 038" style={{ padding: '12px' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ position: 'sticky', bottom: '0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px', background: '#1E293B', borderRadius: '12px', border: '1px solid #334155', marginTop: '40px', zIndex: 10 }}>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Preferred Lender</div>
                <div style={{ fontWeight: 700, fontSize: '20px', color: 'white', marginBottom: '8px' }}>
                  {eligibilityResult?.lenders?.find(l => l.id === activeCase.msme_selected_lender_esr_id)?.lender_name || 'Selected Lender'}
                </div>
                <div style={{ fontSize: '12px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#3B82F6' }}>ℹ</span> Your application will be reviewed by cred2tech team. No email is sent directly to the lender.
                </div>
              </div>
              <button onClick={submitToCred2Tech} disabled={actionLoading} className="btn-primary" style={{ padding: '14px 32px', background: '#6D28D9', border: 'none', fontSize: '15px', fontWeight: 600 }}>
                {actionLoading ? 'Submitting...' : 'Submit to cred2tech Team →'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: Submit Success */}
        {currentStep === 5 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div className="success-box" style={{ maxWidth: '550px', margin: '0 auto', textAlign: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '40px', borderRadius: '16px' }}>
              <div style={{ fontSize: '64px', marginBottom: '20px' }}>🎉</div>
              <h3 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '12px', color: 'var(--text)' }}>Application Submitted to cred2tech!</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '30px', lineHeight: '1.6', fontSize: '14px' }}>
                Your complete application bundle has been securely submitted to the <strong>cred2tech team</strong>. We will review your profile and match your application with the most suitable DSA partner and lender product. You will receive an update on your registered mobile within 24-48 hours.
              </p>
              
              <div style={{ background: '#F0FFF4', border: '1px solid #9AE6B4', borderRadius: '12px', padding: '24px', textAlign: 'left', marginBottom: '30px' }}>
                <h4 style={{ margin: '0 0 16px', color: '#276749', fontSize: '15px' }}>What happens next?</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px', color: '#2F855A' }}>
                  <div style={{ display: 'flex', gap: '10px' }}><span>✅</span> cred2tech team reviews your application bundle & documents</div>
                  <div style={{ display: 'flex', gap: '10px' }}><span>🕵️</span> Your case is allocated to a suitable DSA partner based on your location</div>
                  <div style={{ display: 'flex', gap: '10px' }}><span>📞</span> Your assigned DSA will contact you within 24-48 hours</div>
                  <div style={{ display: 'flex', gap: '10px' }}><span>📄</span> DSA lodges formal application with the best-matched lender</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '20px', textAlign: 'left', marginBottom: '30px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Reference No.</div>
                  <div style={{ fontWeight: 800 }}>CASE-{activeCase.id}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Submitted On</div>
                  <div style={{ fontWeight: 800 }}>{activeCase.msme_submitted_at ? new Date(activeCase.msme_submitted_at).toLocaleDateString('en-IN') : 'Just now'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Status</div>
                  <div style={{ fontWeight: 800, color: '#3182CE' }}>Pending Allocation</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                <button onClick={() => navigate('/msme/dashboard')} className="btn-primary" style={{ padding: '12px 30px', background: '#6D28D9' }}>
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MsmeOnboarding;
