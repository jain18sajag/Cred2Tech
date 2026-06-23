import React, { useState } from 'react';
import { msmeAuthApi } from '../api/directMsme';
import { useMsmeAuth } from '../context/MsmeAuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import '../styles/msme-theme.css'; // Import the scoped stylesheet

const MsmeLogin = () => {
  const [step, setStep] = useState(1);
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useMsmeAuth();
  const navigate = useNavigate();

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!mobile || mobile.length !== 10) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);
    try {
      const res = await msmeAuthApi.sendOtp(mobile);
      toast.success(res.data.message || 'OTP sent successfully');
      if (res.data.otp) {
        toast(`Dev OTP: ${res.data.otp}`, { icon: '🛠️', duration: 6000 });
      }
      setStep(2);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || otp.length < 4) {
      toast.error('Please enter a valid OTP');
      return;
    }
    setLoading(true);
    try {
      const res = await msmeAuthApi.verifyOtp(mobile, otp);
      login(res.data.user, res.data.token);
      toast.success('Logged in successfully');
      navigate('/msme');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to verify OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="msme-portal">
      <div className="login-wrap">
        <div className="login-left">
          <div className="circle1"></div>
          <div className="circle2"></div>
          <div className="brand">
            <div style={{
              width:'64px', height:'64px', borderRadius:'18px', background:'#1D1D1F',
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px',
              boxShadow:'0 4px 20px rgba(0,0,0,.25)', fontWeight:'800', fontSize:'22px', color:'#fff', letterSpacing:'-.5px'
            }}>
              c2t
            </div>
            <h1>Cred2Tech</h1>
            <p>MSME Loan Eligibility Discovery &amp; DSA CRM Platform</p>
            <p style={{ marginTop:'18px', fontSize:'12px', color:'rgba(255,255,255,.35)' }}>
              Powered by consent-based APIs · Regulatory-compliant · Not a lender
            </p>
          </div>
        </div>
        
        <div className="login-right">
          <div className="login-box">
            <h2>Welcome back 👋</h2>
            <p className="subtitle">Sign in to your Cred2Tech business portal</p>

            {step === 1 ? (
              <form onSubmit={handleSendOtp}>
                <div className="info-box">
                  📱 OTP will be sent to your registered mobile number and email address
                </div>
                <div className="form-group">
                  <label>Registered Mobile Number</label>
                  <input
                    type="tel"
                    maxLength="10"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 10-digit mobile number"
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Sending...' : 'Send OTP →'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp}>
                <div className="success-box">
                  ✅ OTP sent to +91 ******{mobile.slice(-4)} and registered email
                </div>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ marginBottom: 0 }}>Enter OTP</label>
                    <button type="button" onClick={() => setStep(1)} className="btn-ghost">
                      Change Number
                    </button>
                  </div>
                  <input
                    type="text"
                    maxLength="6"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="• • • • • •"
                    style={{ letterSpacing: '4px', fontSize: '18px', textAlign: 'center' }}
                  />
                </div>
                <div style={{ fontSize:'11px', color:'var(--light)', margin:'-10px 0 14px', textAlign:'center' }}>
                  OTP valid for 10 minutes · <span style={{ color:'var(--accent)', cursor:'pointer', fontWeight:'600' }} onClick={handleSendOtp}>Resend OTP</span>
                </div>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Verifying...' : 'Verify OTP & Login →'}
                </button>
              </form>
            )}

            <p style={{ textAlign:'center', fontSize:'12px', color:'var(--light)', marginTop:'24px' }}>
              Platform acts as technology facilitator only. Not a lender or credit institution.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MsmeLogin;
