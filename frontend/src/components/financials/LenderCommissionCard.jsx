import React, { useState } from 'react';
import LenderCommissionCasesTable from './LenderCommissionCasesTable';
import { Landmark } from 'lucide-react';

export default function LenderCommissionCard({ lender, onUpdateClick }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const cardStyle = {
    background: '#fff',
    border: '1px solid #E5E7EB',
    borderRadius: '12px',
    marginBottom: '16px',
    boxShadow: isExpanded ? '0 10px 25px -5px rgba(0,0,0,0.05)' : '0 1px 2px 0 rgba(0,0,0,0.05)',
    overflow: 'hidden',
    transition: 'all 0.2s',
    borderLeft: '4px solid #3B82F6' // Using a distinct blue for Lenders vs DSA members
  };

  const headerStyle = {
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    background: isExpanded ? '#F9FAFB' : '#fff'
  };

  const avatarStyle = {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: '#EFF6FF',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#3B82F6'
  };

  const nameStyle = {
    fontSize: '15px',
    fontWeight: '700',
    color: '#111827',
    marginBottom: '4px'
  };

  const metricStyle = {
    fontSize: '12px',
    color: '#6B7280'
  };

  const detailsBtnStyle = {
    background: '#fff',
    color: '#374151',
    border: '1px solid #D1D5DB',
    borderRadius: '20px',
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  };
  
  const uploadBtnStyle = {
    background: '#fff',
    color: '#3B82F6',
    border: '1px solid #BFDBFE',
    borderRadius: '20px',
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  };

  const formatCurrency = (amount) => {
    if (amount == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle} onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={avatarStyle}>
            <Landmark size={16} strokeWidth={2.5} />
          </div>
          <div>
            <div style={nameStyle}>{lender.lender_name}</div>
            <div style={metricStyle}>
              {lender.metrics.cases} {lender.metrics.cases === 1 ? 'case' : 'cases'} · Volume: {formatCurrency(lender.metrics.volume)} · Gross Comm: <span style={{ color: '#111827', fontWeight: '600' }}>{formatCurrency(lender.metrics.gross_commission)}</span> · Pending: <span style={{ color: '#EF4444', fontWeight: '600' }}>{formatCurrency(lender.metrics.pending_amount)}</span>
              {lender.hasPddPending && (
                <span style={{ color: '#F59E0B', fontWeight: '600', marginLeft: '8px' }}>
                  ⚠ PDD Pending
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            style={uploadBtnStyle}
            onClick={(e) => { e.stopPropagation(); alert("MIS Upload (TODO)"); }}
          >
            Upload MIS
          </button>
          <button 
            style={detailsBtnStyle}
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
          >
            {isExpanded ? '▼ Details' : '▶ Details'}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div style={{ borderTop: '1px solid #E5E7EB' }}>
          <LenderCommissionCasesTable cases={lender.cases} onUpdateClick={onUpdateClick} />
        </div>
      )}
    </div>
  );
}
