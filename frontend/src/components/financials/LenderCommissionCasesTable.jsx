import React from 'react';

export default function LenderCommissionCasesTable({ cases, onUpdateClick }) {
  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    background: '#fff',
    fontSize: '13px'
  };

  const thStyle = {
    padding: '12px 16px',
    textAlign: 'left',
    color: '#9CA3AF',
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #E5E7EB',
    background: '#fff'
  };

  const tdStyle = {
    padding: '16px',
    borderBottom: '1px solid #F3F4F6',
    color: '#374151',
    fontWeight: '500'
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'PENDING':
        return { background: '#F3F4F6', color: '#4B5563', border: '1px solid #E5E7EB' };
      case 'INVOICED':
        return { background: '#E0F2FE', color: '#0369A1', border: '1px solid #BAE6FD' };
      case 'PAID':
        return { background: '#D1FAE5', color: '#065F46', border: '1px solid #A7F3D0' };
      case 'CANCELLED':
        return { background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FECACA' };
      default:
        return { background: '#F3F4F6', color: '#4B5563' };
    }
  };

  const getStatusLabel = (status) => {
    switch(status) {
      case 'PENDING': return 'Pending';
      case 'INVOICED': return 'Invoice Raised';
      case 'PAID': return 'Paid';
      case 'CANCELLED': return 'Rejected';
      default: return status;
    }
  }

  const badgeBaseStyle = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.5px'
  };

  const actionBtnStyle = {
    background: '#fff',
    color: '#374151',
    border: '1px solid #D1D5DB',
    borderRadius: '20px',
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  };

  const formatCurrency = (amount) => {
    if (amount == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  if (!cases || cases.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280', fontSize: '13px' }}>
        No incentive records found for this period.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>CASE ID</th>
            <th style={thStyle}>CUSTOMER</th>
            <th style={thStyle}>PRODUCT</th>
            <th style={{...thStyle, textAlign: 'right'}}>DISB. AMT</th>
            <th style={{...thStyle, textAlign: 'right'}}>GROSS COMM</th>
            <th style={{...thStyle, textAlign: 'center'}}>SUBVENTION</th>
            <th style={{...thStyle, textAlign: 'right'}}>NET PAYABLE</th>
            <th style={{...thStyle, textAlign: 'center'}}>STATUS</th>
            <th style={{...thStyle, textAlign: 'center'}}>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, idx) => (
            <tr key={c.id || idx} style={{ background: idx % 2 !== 0 ? '#FAFAFA' : '#fff' }}>
              <td style={{...tdStyle, fontWeight: '700', color: '#111827'}}>{c.caseId}</td>
              <td style={tdStyle}>{c.customer} {c.pddPending && <span style={{ color: '#F59E0B', fontSize: '11px', marginLeft: '4px' }}>⚠ PDD</span>}</td>
              <td style={{...tdStyle, color: '#6B7280'}}>{c.product}</td>
              <td style={{...tdStyle, textAlign: 'right'}}>{formatCurrency(c.disbAmt)}</td>
              <td style={{...tdStyle, textAlign: 'right', color: '#10B981'}}>{formatCurrency(c.payout)}</td>
              <td style={{...tdStyle, textAlign: 'center', color: '#EF4444'}}>{c.subvention ? formatCurrency(c.subvention) : '—'}</td>
              <td style={{...tdStyle, textAlign: 'right', fontWeight: '700', color: '#111827'}}>{formatCurrency(c.netPayable)}</td>
              <td style={{...tdStyle, textAlign: 'center'}}>
                <span style={{ ...badgeBaseStyle, ...getStatusStyle(c.status) }}>
                  {getStatusLabel(c.status)}
                </span>
              </td>
              <td style={{...tdStyle, textAlign: 'center'}}>
                <button 
                  style={actionBtnStyle}
                  onClick={(e) => { e.stopPropagation(); onUpdateClick(c); }}
                >
                  Update
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
