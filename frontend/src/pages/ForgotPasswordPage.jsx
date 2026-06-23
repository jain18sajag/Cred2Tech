import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axiosInstance';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Please enter your email address');

    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      // We still show success for security reasons (don't leak email existence)
      // but API handles this by always returning 200.
      setSent(true); 
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-base)', padding: 20 }}>
      <div style={{ maxWidth: 400, width: '100%', backgroundColor: 'var(--bg-surface)', padding: 32, borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Forgot Password</h1>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Enter your registered email address and we'll send you a link to reset your password.
          </p>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: 24, backgroundColor: 'var(--success-subtle)', borderRadius: 8, color: 'var(--success)', marginBottom: 24 }}>
            <CheckCircle2 size={48} style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Link Sent!</h3>
            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              If an account exists for <strong>{email}</strong>, a password reset link has been sent. Please check your inbox.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-tertiary)' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="form-control"
                  style={{ paddingLeft: 36 }}
                  required
                />
              </div>
            </div>
            
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading}
              style={{ width: '100%', padding: '10px' }}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={16} /> Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
