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

  const handleRunEligibility = async () => {
    setActionLoading(true);
    try {
      const res = await msmeApi.initiateEligibility();
      if (res.data.next_step === 'OPEN_ELIGIBILITY_FORM') {
        navigate('/msme/onboarding');
      } else {
        // Handle Payment
        initiatePayment();
      }
    } catch (err) {
      toast.error('Failed to initiate eligibility check');
      setActionLoading(false);
    }
  };

  const initiatePayment = async () => {
    try {
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
            navigate('/msme/onboarding');
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
        theme: { color: "#635BFF" }
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

  return (
    <div>
      <div className="alert-banner">
        <div>
          <h2>Welcome back, {user?.name || 'User'}!</h2>
          <p>Check your eligibility across multiple lenders instantly without affecting your credit score.</p>
        </div>
        <div>
          <button 
            onClick={handleRunEligibility} 
            disabled={actionLoading}
            className="btn-primary"
            style={{ padding: '12px 24px', boxShadow: 'none', background: '#fff', color: 'var(--accent)' }}
          >
            {actionLoading ? 'Loading...' : 'Run Eligibility →'}
          </button>
        </div>
      </div>

      {!emptyState ? (
        <div className="bento-grid">
          <div className="bento-card bento-3">
            <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>📄 Current Application</h3>
            
            <div className="stat-row">
              <span className="stat-label">Status</span>
              <span className="badge-status active">{activeCase.stage}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Loan Amount</span>
              <span className="stat-val">₹{activeCase.loan_amount?.toLocaleString() || 'N/A'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Product</span>
              <span className="stat-val">{activeCase.product_type || 'N/A'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Created On</span>
              <span className="stat-val">{new Date(activeCase.created_at).toLocaleDateString()}</span>
            </div>
            
            {activeCase.stage !== 'CLOSED' && activeCase.stage !== 'REJECTED' && (
              <button onClick={() => navigate('/msme/onboarding')} className="btn-primary" style={{ marginTop: '20px' }}>
                Continue Application →
              </button>
            )}
          </div>

          <div className="bento-card bento-3">
            <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '16px' }}>🏢 Profile Summary</h3>
            
            <div className="stat-row">
              <span className="stat-label">Business Name</span>
              <span className="stat-val">{activeCase.customer?.business_name || 'N/A'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Entity Type</span>
              <span className="stat-val">{activeCase.customer?.entity_type || 'N/A'}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">PAN Number</span>
              <span className="stat-val">{activeCase.customer?.business_pan || 'N/A'}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <h3>No Active Applications</h3>
          <p>You don't have any previous loan applications. Click below to start a new eligibility check.</p>
          <button 
            onClick={handleRunEligibility} 
            disabled={actionLoading}
            className="btn-primary"
            style={{ width: 'auto', display: 'inline-block', padding: '12px 30px' }}
          >
            {actionLoading ? 'Please wait...' : 'Start Now →'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MsmeDashboard;
