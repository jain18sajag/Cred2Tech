import React from 'react';
import { Search } from 'lucide-react';

export default function LenderCommissionFilters({ filters, setFilters, availableMonths = [], availableLenders = [] }) {
  const containerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    background: '#fff',
    padding: '16px',
    borderRadius: '12px',
    border: '1px solid #E5E7EB',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    marginBottom: '24px'
  };

  const fieldGroupStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  };

  const labelStyle = {
    fontSize: '11px',
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  };

  const inputStyle = {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid #D1D5DB',
    fontSize: '14px',
    color: '#111827',
    background: '#fff',
    outline: 'none',
    minWidth: '160px',
    transition: 'border-color 0.2s'
  };

  const searchContainerStyle = {
    ...fieldGroupStyle,
    flex: 1
  };

  const searchInputWrapperStyle = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  };

  return (
    <div style={containerStyle}>
      <div style={fieldGroupStyle}>
        <label style={labelStyle}>MONTH</label>
        <select 
          style={inputStyle} 
          value={filters.month || 'all'}
          onChange={(e) => setFilters({...filters, month: e.target.value === 'all' ? 'all' : e.target.value})}
          disabled={availableMonths.length === 0}
        >
          {availableMonths.length === 0 && <option value="">No data available</option>}
          {availableMonths.length > 0 && <option value="all">All Months</option>}
          {availableMonths.map(m => (
             <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div style={fieldGroupStyle}>
        <label style={labelStyle}>LENDER</label>
        <select 
          style={inputStyle}
          value={filters.lenderName || 'All Lenders'}
          onChange={(e) => setFilters({...filters, lenderName: e.target.value})}
        >
          <option value="All Lenders">All Lenders</option>
          {availableLenders.map(l => (
             <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      <div style={fieldGroupStyle}>
        <label style={labelStyle}>PRODUCT</label>
        <select 
          style={inputStyle}
          value={filters.product || 'All Products'}
          onChange={(e) => setFilters({...filters, product: e.target.value})}
        >
          <option value="All Products">All Products</option>
          <option value="LAP">LAP</option>
          <option value="HL">Home Loan</option>
          <option value="TL">Term Loan</option>
          <option value="BL">Business Loan</option>
        </select>
      </div>

      <div style={searchContainerStyle}>
        <label style={labelStyle}>SEARCH</label>
        <div style={searchInputWrapperStyle}>
          <input 
            type="text" 
            placeholder="Customer name, case ID..." 
            value={filters.search || ''}
            onChange={(e) => setFilters({...filters, search: e.target.value})}
            style={{ ...inputStyle, width: '100%', paddingLeft: '36px' }}
          />
          <Search size={16} color="#9CA3AF" style={{ position: 'absolute', left: '12px' }} />
        </div>
      </div>
    </div>
  );
}
