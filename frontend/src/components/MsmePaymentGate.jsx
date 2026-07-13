import React, { useState, useEffect } from 'react';
import { msmeApi } from '../api/directMsme';
import { useRazorpay } from 'react-razorpay';
import toast from 'react-hot-toast';
import LoadingSpinner from './ui/LoadingSpinner';

const MsmePaymentGate = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [paymentConfig, setPaymentConfig] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const { Razorpay } = useRazorpay();

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const res = await msmeApi.getDashboard();
      setPaymentStatus(res.data.paymentStatus);
      if (res.data.paymentStatus !== 'PAID') {
        const configRes = await msmeApi.getPaymentConfig();
        setPaymentConfig(configRes.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load MSME dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    try {
      setActionLoading(true);
      const res = await msmeApi.createPaymentOrder();
      
      const options = {
        key: paymentConfig.key_id,
        amount: res.data.amount,
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

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <LoadingSpinner size={40} />
      </div>
    );
  }

  if (paymentStatus === 'PAID') {
    return <>{children}</>;
  }

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '0 20px' }}>
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--primary-dim)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px', margin: '0 auto 20px' }}>
          💳
        </div>
        <h3 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '12px', color: 'var(--text-primary)' }}>Start Your Application</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '30px', lineHeight: '1.6' }}>
          To unlock the multi-lender eligibility check and start your application, a one-time assessment fee is required.
        </p>
        
        {paymentConfig && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', maxWidth: '300px', margin: '0 auto 30px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Assessment Fee</div>
            <div style={{ fontSize: '36px', fontWeight: 800, color: 'var(--text-primary)' }}>₹{paymentConfig.amount_inr}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '8px' }}>One-time payment. Valid for 90 days.</div>
          </div>
        )}
        
        <button onClick={handlePayment} disabled={actionLoading || !paymentConfig} className="btn btn-primary btn-lg" style={{ padding: '14px 40px', width: '100%' }}>
          {actionLoading ? 'Processing...' : `Pay ₹${paymentConfig?.amount_inr || '...'} to Continue`}
        </button>
      </div>
    </div>
  );
};

export default MsmePaymentGate;
