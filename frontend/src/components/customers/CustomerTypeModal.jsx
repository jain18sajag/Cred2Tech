import React from 'react';
import { X, Building2, Briefcase } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const CustomerTypeModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  if (!isOpen) return null;

  const handleSelectMSME = () => {
    onClose();
    navigate('/customers/add');
  };

  const handleSelectSalaried = () => {
    onClose();
    navigate('/customers/salaried/add');
  };

  return (
    <div 
      className="modal-overlay" 
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', 
        display: 'flex', alignItems: 'center', justifyContent: 'center', 
        zIndex: 1100, backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)'
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div 
        className="modal-content"
        style={{
          background: 'var(--surface, #ffffff)', borderRadius: '24px', 
          width: '540px', maxWidth: '96vw', boxShadow: '0 28px 72px rgba(0,0,0,.2)', 
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '24px 28px 18px', borderBottom: '1px solid var(--border, #e2e8f0)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text, #1a202c)', margin: 0, letterSpacing: '-.3px' }}>Add New Customer</h3>
            <p style={{ fontSize: '13px', color: 'var(--mid, #718096)', marginTop: '3px', marginBottom: 0 }}>Select the customer type to begin the right journey</p>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--light, #a0aec0)', fontSize: '24px', lineHeight: 1, padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '24px 28px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* MSME Card */}
          <div 
            onClick={handleSelectMSME}
            className="hover-card"
            style={{
              border: '2px solid var(--border, #e2e8f0)', borderRadius: '16px', padding: '22px 20px', 
              cursor: 'pointer', transition: '.2s', background: 'var(--surface2, #f7fafc)'
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent, #635bff)'; e.currentTarget.style.background = 'var(--accent-dim, #f0f0ff)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border, #e2e8f0)'; e.currentTarget.style.background = 'var(--surface2, #f7fafc)'; }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏭</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text, #1a202c)', marginBottom: '6px' }}>MSME / Business</div>
            <div style={{ fontSize: '12px', color: 'var(--mid, #718096)', lineHeight: 1.5 }}>Self-employed, business owners, proprietorships, partnerships, LLPs & Pvt Ltd companies</div>
            <div style={{ marginTop: '14px', fontSize: '11px', fontWeight: 600, color: 'var(--accent, #635bff)' }}>GST · ITR · Bank Statement →</div>
          </div>

          {/* Salaried Card */}
          <div 
            onClick={handleSelectSalaried}
            className="hover-card"
            style={{
              border: '2px solid var(--border, #e2e8f0)', borderRadius: '16px', padding: '22px 20px', 
              cursor: 'pointer', transition: '.2s', background: 'var(--surface2, #f7fafc)'
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--success, #1dc683)'; e.currentTarget.style.background = 'var(--success-dim, #e8f9f2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--border, #e2e8f0)'; e.currentTarget.style.background = 'var(--surface2, #f7fafc)'; }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>👔</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text, #1a202c)', marginBottom: '6px' }}>Salaried Individual</div>
            <div style={{ fontSize: '12px', color: 'var(--mid, #718096)', lineHeight: 1.5 }}>Employees with regular salary income — Home Loan, LAP or Personal Loan</div>
            <div style={{ marginTop: '14px', fontSize: '11px', fontWeight: 600, color: 'var(--success, #1dc683)' }}>Salary Slips · OCR · Eligibility →</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomerTypeModal;
