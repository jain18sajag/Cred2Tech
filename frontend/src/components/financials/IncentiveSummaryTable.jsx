import React from 'react';

export default function IncentiveSummaryTable({ summaryData }) {
  // Using static colors/styles to match the compact enterprise KPI styling
  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    background: '#fff',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    border: '1px solid #E5E7EB',
    marginBottom: '24px',
    fontSize: '13px'
  };

  const thStyle = {
    padding: '12px 16px',
    textAlign: 'left',
    color: '#6B7280',
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #E5E7EB',
    background: '#F9FAFB'
  };

  const tdStyle = {
    padding: '16px',
    borderBottom: '1px solid #E5E7EB',
    color: '#111827',
    fontWeight: '500'
  };

  // Safe fallback if data is missing
  const data = summaryData || [
    { period: 'Current Month', cases: 0, volume: '₹0', eligible: '₹0', paid: '₹0', pending: '₹0' },
    { period: 'Previous Month', cases: 0, volume: '₹0', eligible: '₹0', paid: '₹0', pending: '₹0' },
    { period: 'Older', cases: 6, volume: '₹2.73 Cr', eligible: '₹0', paid: '₹0', pending: '₹0' }
  ];

  const formatCurrency = (amount) => {
    if (amount == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>PERIOD</th>
          <th style={{...thStyle, textAlign: 'center'}}>CASES DISBURSED</th>
          <th style={{...thStyle, textAlign: 'right'}}>DISBURSEMENT VOLUME</th>
          <th style={{...thStyle, textAlign: 'right'}}>PAYOUT ELIGIBLE</th>
          <th style={{...thStyle, textAlign: 'right'}}>PAID DUES</th>
          <th style={{...thStyle, textAlign: 'right', color: '#EF4444'}}>PENDING</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row, idx) => (
          <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#FAFAFA' }}>
            <td style={{...tdStyle, fontWeight: '600'}}>{row.period}</td>
            <td style={{...tdStyle, textAlign: 'center'}}>{row.cases}</td>
            <td style={{...tdStyle, textAlign: 'right', color: '#4B5563'}}>{formatCurrency(row.volume)}</td>
            <td style={{...tdStyle, textAlign: 'right', color: '#10B981'}}>{formatCurrency(row.eligible)}</td>
            <td style={{...tdStyle, textAlign: 'right', color: '#10B981'}}>{formatCurrency(row.paid)}</td>
            <td style={{...tdStyle, textAlign: 'right', color: '#EF4444', fontWeight: '700'}}>{formatCurrency(row.pending)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
