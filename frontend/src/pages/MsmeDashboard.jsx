import React, { useState, useEffect } from 'react';
import { msmeApi } from '../api/directMsme';
import { useMsmeAuth } from '../context/MsmeAuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useRazorpay } from 'react-razorpay';

const MsmeDashboard = () => {
  const { user } = useMsmeAuth();
  const navigate = useNavigate();
  const { Razorpay } = useRazorpay();
  
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState(null);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const res = await msmeApi.getDashboard();
      setDashboardData(res.data);
    } catch (err) {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleStartEligibilityClick = async () => {
    if (!dashboardData) return;
    if (dashboardData.paymentStatus === 'PAID') {
      navigate(dashboardData.activeCase ? `/msme/onboarding?caseId=${dashboardData.activeCase.id}` : '/msme/onboarding');
    } else {
      setActionLoading(true);
      try {
        const conf = await msmeApi.getPaymentConfig();
        setPaymentConfig(conf.data);
        setShowPaymentModal(true);
      } catch (err) {
        toast.error('Failed to load pricing');
      } finally {
        setActionLoading(false);
      }
    }
  };

  const initiatePayment = async () => {
    try {
      setActionLoading(true);
      const orderRes = await msmeApi.createPaymentOrder();
      const { order_id, amount_paise, currency, key_id } = orderRes.data;

      const options = {
        key: key_id,
        amount: amount_paise,
        currency: currency,
        name: "Cred2Tech",
        description: "Eligibility Assessment Fee",
        order_id: order_id,
        handler: async function (response) {
          try {
            await msmeApi.verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            });
            toast.success("Payment successful!");
            setShowPaymentModal(false);
            navigate(dashboardData.activeCase ? `/msme/onboarding?caseId=${dashboardData.activeCase.id}` : '/msme/onboarding');
          } catch (err) {
            toast.error("Payment verification failed");
            setActionLoading(false);
          }
        },
        prefill: {
          name: user.name,
          email: user.email,
          contact: user.mobile
        },
        theme: { color: "#276749" }
      };

      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function (response) {
        toast.error(`Payment Failed: ${response.error.description}`);
        setActionLoading(false);
      });
      rzp.open();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to initiate payment');
      setActionLoading(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--mid)' }}>Loading dashboard...</div>;

  const { activeCase, emptyState } = dashboardData;
  const businessName = activeCase?.customer?.business_name || user?.name || 'User';

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      
      {/* 1. Payment Modal */}
      {showPaymentModal && paymentConfig && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: '#fff', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '400px', textAlign: 'center', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '12px', color: 'var(--text)' }}>Eligibility Assessment</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
              To check your eligibility across multiple lenders and receive a detailed report, a one-time assessment fee is required. This data is valid for 90 days.
            </p>
            
            <div style={{ background: 'var(--surface2)', padding: '20px', borderRadius: '12px', marginBottom: '24px', border: '1px solid var(--border)' }}>
               <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '1px', marginBottom: '8px' }}>Amount Due</div>
               <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--text)' }}>₹{paymentConfig.amount_inr}</div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowPaymentModal(false)} disabled={actionLoading} className="btn-outline" style={{ flex: 1, padding: '12px' }}>Cancel</button>
              <button onClick={initiatePayment} disabled={actionLoading} className="btn-primary" style={{ flex: 1, padding: '12px', background: '#276749' }}>
                {actionLoading ? 'Processing...' : 'Pay Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Top Header / Banner */}
      {!emptyState ? (
        <div style={{ background: '#276749', color: '#fff', padding: '32px', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <div style={{ fontSize: '14px', opacity: 0.8, marginBottom: '4px' }}>Welcome back!</div>
            <h2 style={{ fontSize: '28px', fontWeight: 800, margin: 0 }}>{businessName}</h2>
            <div style={{ fontSize: '12px', opacity: 0.8, marginTop: '8px' }}>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })} — This Month's Activity</div>
          </div>
          <div style={{ textAlign: 'right' }}>
             <div style={{ fontSize: '13px', opacity: 0.8, marginBottom: '4px' }}>Registered Mobile</div>
             <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px' }}>+91 {user?.mobile}</div>
             <button onClick={handleStartEligibilityClick} disabled={actionLoading} className="btn-primary" style={{ background: '#fff', color: '#276749', padding: '10px 24px', borderRadius: '8px', fontWeight: 700 }}>
               ✨ Check Loan Eligibility →
             </button>
          </div>
        </div>
      ) : (
        <div style={{ background: '#6D28D9', color: '#fff', padding: '40px', borderRadius: '16px', textAlign: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 12px 0' }}>Welcome back, {businessName}!</h2>
          <p style={{ fontSize: '16px', opacity: 0.9, marginBottom: '24px', maxWidth: '600px', margin: '0 auto 24px' }}>Check your eligibility across multiple lenders instantly without affecting your credit score.</p>
          <button onClick={handleStartEligibilityClick} disabled={actionLoading} className="btn-primary" style={{ background: '#fff', color: '#6D28D9', padding: '14px 32px', borderRadius: '8px', fontSize: '16px', fontWeight: 700 }}>
            Run Eligibility →
          </button>
        </div>
      )}

      {/* 3. Empty vs Active State Bodies */}
      {emptyState ? (
         <div style={{ background: '#fff', border: '1px dashed var(--border)', borderRadius: '16px', padding: '60px 20px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', marginBottom: '12px' }}>No Active Applications</h3>
            <p style={{ color: 'var(--text-tertiary)', marginBottom: '24px' }}>You don't have any previous loan applications. Click below to start a new eligibility check.</p>
            <button onClick={handleStartEligibilityClick} disabled={actionLoading} className="btn-primary" style={{ background: '#6D28D9', padding: '12px 30px' }}>
              Start Now →
            </button>
         </div>
      ) : (
         <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' }}>
            
            {/* Left Content */}
            <div>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '12px' }}>📂</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)' }}>1</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Active Cases</div>
                  <div style={{ fontSize: '11px', color: '#3182CE', marginTop: '8px', fontWeight: 700 }}>This Month</div>
                </div>
                <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '12px' }}>📊</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)' }}>₹{activeCase.loan_amount ? (activeCase.loan_amount / 100000).toFixed(1) + 'L' : '0L'}</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loan Applied</div>
                  <div style={{ fontSize: '11px', color: '#38A169', marginTop: '8px', fontWeight: 700 }}>{activeCase.product_type}</div>
                </div>
                <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '24px', marginBottom: '12px' }}>⭐</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text)' }}>742</div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Your CIBIL Score</div>
                  <div style={{ fontSize: '11px', color: '#38A169', marginTop: '8px', fontWeight: 700, background: '#F0FFF4', display: 'inline-block', padding: '2px 8px', borderRadius: '10px' }}>Good</div>
                </div>
              </div>

              {/* Data Table */}
              <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>My Loan Cases</h3>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead style={{ background: 'var(--surface2)', fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    <tr>
                      <th style={{ padding: '16px 24px' }}>CASE ID</th>
                      <th style={{ padding: '16px 24px' }}>PRODUCT</th>
                      <th style={{ padding: '16px 24px' }}>AMOUNT</th>
                      <th style={{ padding: '16px 24px' }}>STATUS</th>
                      <th style={{ padding: '16px 24px', textAlign: 'right' }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 24px', fontWeight: 700 }}>CASE-{activeCase.id}</td>
                      <td style={{ padding: '16px 24px' }}>{activeCase.product_type || 'TBD'}</td>
                      <td style={{ padding: '16px 24px' }}>{activeCase.loan_amount ? `₹${(activeCase.loan_amount / 100000).toFixed(1)}L` : '-'}</td>
                      <td style={{ padding: '16px 24px' }}>
                        <span className="badge-status" style={{ background: '#EBF4FF', color: '#3182CE' }}>{activeCase.stage}</span>
                      </td>
                      <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                         {activeCase.stage !== 'CLOSED' && activeCase.stage !== 'REJECTED' ? (
                            <button onClick={() => navigate(`/msme/onboarding?caseId=${activeCase.id}`)} className="btn-primary" style={{ background: '#6D28D9', padding: '6px 16px', fontSize: '12px' }}>
                              Continue →
                            </button>
                         ) : (
                            <button className="btn-outline" style={{ padding: '6px 16px', fontSize: '12px' }}>Track</button>
                         )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Sidebar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid var(--border)', padding: '24px' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 800 }}>Quick Actions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button className="btn-primary" style={{ background: '#6D28D9', padding: '12px' }}>📊 View My Cases</button>
                  <button className="btn-outline" style={{ padding: '12px' }}>📁 Track Cases</button>
                  <button className="btn-outline" style={{ padding: '12px' }}>📄 My Documents</button>
                </div>
              </div>

              <div style={{ background: '#F0FFF4', borderRadius: '16px', border: '1px solid #9AE6B4', padding: '24px' }}>
                <div style={{ fontSize: '12px', color: '#276749', fontWeight: 700, marginBottom: '8px' }}>Your Allocated DSA</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#22543D', marginBottom: '4px' }}>
                  {activeCase?.assigned_dsa_user?.name || 'Cred2Tech Direct (Pending Allocation)'}
                </div>
                <div style={{ fontSize: '13px', color: '#2F855A', marginBottom: '16px' }}>Support Team</div>
                <div style={{ fontSize: '12px', color: '#276749', opacity: 0.8 }}>This case is managed by the agent above.</div>
              </div>

            </div>

         </div>
      )}

    </div>
  );
};

export default MsmeDashboard;
