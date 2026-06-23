import React, { useState, useEffect } from 'react';
import { msmeApi } from '../api/directMsme';
import { useMsmeAuth } from '../context/MsmeAuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useRazorpay } from 'react-razorpay';

const STEPS = [
  { id: 1, label: 'Business Profile' },
  { id: 2, label: 'Loan Requirements' },
  { id: 3, label: 'Eligibility Check' },
  { id: 4, label: 'Submit' },
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
  
  // Forms
  const [businessData, setBusinessData] = useState({ business_name: '', business_pan: '', entity_type: 'Proprietorship', industry: '', business_vintage: '' });
  const [loanData, setLoanData] = useState({ loan_amount: '', product_type: 'BL', dsa_notes: '' });

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

    if (c.msme_submitted_at) setCurrentStep(4);
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
      fetchCaseState();
      setCurrentStep(4);
    } catch (err) {
      toast.error('Failed to select lender');
    } finally {
      setActionLoading(false);
    }
  };

  const submitApplication = async () => {
    setActionLoading(true);
    try {
      await msmeApi.submitCase();
      toast.success('Application submitted successfully!');
      fetchCaseState();
    } catch (err) {
      toast.error('Failed to submit application');
    } finally {
      setActionLoading(false);
    }
  };

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
                <p style={{ color: 'var(--mid)', marginBottom: '30px', maxWidth: '400px', margin: '0 auto 30px', lineHeight: '1.6' }}>We have your basic data and payment is confirmed. Click below to generate your Eligibility Report across multiple lenders.</p>
                <button onClick={runEligibility} disabled={actionLoading} className="btn-primary" style={{ width: 'auto', display: 'inline-block', padding: '14px 40px', fontSize: '16px' }}>
                  {actionLoading ? 'Generating...' : 'Generate Eligibility Report'}
                </button>
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
                          {l.lender.name}
                          {l.is_eligible ? <span className="badge-status success">Eligible</span> : <span className="badge-status" style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}>Not Eligible</span>}
                        </div>
                        <div className="esr-row">
                          <span className="label">Product</span>
                          <span className="val">{l.product.name}</span>
                        </div>
                        <div className="esr-row">
                          <span className="label">Max Amount</span>
                          <span className="val">₹{l.max_loan_amount?.toLocaleString() || 'N/A'}</span>
                        </div>
                        {l.rejection_reasons?.length > 0 && (
                          <div className="esr-reason">Reason: {l.rejection_reasons[0]}</div>
                        )}
                        {l.is_eligible && (
                          <button onClick={() => selectLender(l.id)} disabled={actionLoading} className="btn-primary" style={{ marginTop: '20px', padding: '10px' }}>
                            Select Lender
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
                  <div style={{ display: 'flex', justifyEnd: 'flex-end', paddingTop: '20px' }}>
                    <button onClick={() => setCurrentStep(4)} className="btn-primary" style={{ width: 'auto', marginLeft: 'auto', padding: '12px 30px' }}>
                      Continue to Submit →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Submit */}
        {currentStep === 4 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            {activeCase.msme_submitted_at ? (
               <div className="success-box" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', padding: '40px' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--success-dim)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 20px' }}>
                    ✓
                  </div>
                  <h3 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '12px', color: 'var(--text)' }}>Application Submitted!</h3>
                  <p style={{ color: 'var(--mid)', marginBottom: '30px', lineHeight: '1.6' }}>Our experts are reviewing your profile. You will be assigned a dedicated manager shortly.</p>
                  
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', textAlign: 'left' }}>
                    <div className="stat-row"><span className="stat-label">Application ID</span><span className="stat-val">#{activeCase.id}</span></div>
                    <div className="stat-row"><span className="stat-label">Status</span><span className="badge-status" style={{ background: 'var(--warn-dim)', color: '#7A4800' }}>{activeCase.stage}</span></div>
                    <div className="stat-row"><span className="stat-label">Requested Amount</span><span className="stat-val">₹{activeCase.loan_amount?.toLocaleString()}</span></div>
                  </div>

                  <button onClick={() => navigate('/msme/dashboard')} className="btn-outline" style={{ marginTop: '30px' }}>
                    Return to Dashboard
                  </button>
               </div>
            ) : (
               <div style={{ maxWidth: '500px', margin: '0 auto' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 20px' }}>
                    ⬆
                  </div>
                  <h3 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '12px', color: 'var(--text)' }}>Ready to Submit?</h3>
                  <p style={{ color: 'var(--mid)', marginBottom: '30px', lineHeight: '1.6' }}>You've selected your preferred lender. Click below to submit your application for final processing by Cred2Tech experts.</p>
                  
                  <button onClick={submitApplication} disabled={actionLoading} className="btn-primary" style={{ padding: '14px 40px', fontSize: '16px' }}>
                    {actionLoading ? 'Submitting...' : 'Submit Application'}
                  </button>
               </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default MsmeOnboarding;
