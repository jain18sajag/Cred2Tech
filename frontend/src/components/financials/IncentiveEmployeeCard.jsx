import React, { useState } from 'react';
import IncentiveCasesTable from './IncentiveCasesTable';
import { Target } from 'lucide-react';

export default function IncentiveEmployeeCard({ employee }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const cardStyle = {
    background: '#fff',
    border: '1px solid #E5E7EB',
    borderRadius: '12px',
    marginBottom: '16px',
    boxShadow: isExpanded ? '0 10px 25px -5px rgba(0,0,0,0.05)' : '0 1px 2px 0 rgba(0,0,0,0.05)',
    overflow: 'hidden',
    transition: 'all 0.2s',
    borderLeft: '4px solid #FF5A36' // Using the brand orange color from the prototype
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
    background: '#FFF5F2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#FF5A36'
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

  const formatCurrency = (amount) => {
    if (amount == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div style={cardStyle}>
      <div style={headerStyle} onClick={() => setIsExpanded(!isExpanded)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={avatarStyle}>
            <Target size={16} strokeWidth={2.5} />
          </div>
          <div>
            <div style={nameStyle}>{employee.name}</div>
            <div style={metricStyle}>
              {employee.metrics.cases} {employee.metrics.cases === 1 ? 'case' : 'cases'} · Volume: {formatCurrency(employee.metrics.volume)} · Payout: <span style={{ color: '#111827', fontWeight: '600' }}>{formatCurrency(employee.metrics.payout)}</span>
              {employee.hasPddPending && (
                <span style={{ color: '#F59E0B', fontWeight: '600', marginLeft: '8px' }}>
                  ⚠ PDD Pending
                </span>
              )}
            </div>
          </div>
        </div>
        
        <button 
          style={detailsBtnStyle}
          onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
        >
          {isExpanded ? '▼ Details' : '▶ Details'}
        </button>
      </div>

      {isExpanded && (
        <div style={{ borderTop: '1px solid #E5E7EB' }}>
          <IncentiveCasesTable cases={employee.cases} />
        </div>
      )}
    </div>
  );
}
