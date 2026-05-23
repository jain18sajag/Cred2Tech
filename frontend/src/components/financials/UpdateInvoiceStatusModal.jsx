import React, { useState } from 'react';
import { updateLedgerStatus } from '../../api/commissionOperationsService';
import LoadingSpinner from '../ui/LoadingSpinner';
import { X } from 'lucide-react';

export default function UpdateInvoiceStatusModal({ caseData, onClose, onSuccess }) {
  // caseData contains { id, caseId, customer, status, ... }
  // Here we are updating status for one row (caseRow in UI is actually mapped to one or more ledgers? 
  // Wait, in LenderCommissionPage, caseData.ledgers has the actual ledger rows.
  // We'll update the first ledger or all ledgers for this case?
  // Let's update all ledgers attached to this case.

  const [status, setStatus] = useState(caseData.status);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    try {
      setLoading(true);
      // caseData.ledgers contains all ledgers for this case row
      for (const l of caseData.ledgers) {
        await updateLedgerStatus(l.id, status, remarks);
      }
      onSuccess();
    } catch (e) {
      console.error(e);
      alert("Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  const modalStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(17, 24, 39, 0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: '20px'
  };

  const contentStyle = {
    background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '400px',
    overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
  };

  return (
    <div style={modalStyle}>
      <div style={contentStyle}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>Update Status</h2>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6B7280' }}>{caseData.caseId} - {caseData.customer}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><X size={20} /></button>
        </div>
        
        <div style={{ padding: '24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>New Status</label>
            <select 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #D1D5DB', outline: 'none' }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="PENDING">Draft / Pending</option>
              <option value="INVOICED">Invoice Raised</option>
              <option value="PAID">Paid (Reconciled)</option>
              <option value="CANCELLED">Rejected</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Remarks (Optional)</label>
            <textarea 
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #D1D5DB', minHeight: '80px', outline: 'none', fontFamily: 'inherit', resize: 'vertical' }}
              placeholder="Add internal notes..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#F9FAFB' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #D1D5DB', background: '#fff', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button 
            onClick={handleSave} 
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#3B82F6', color: '#fff', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {loading ? <LoadingSpinner size={16} /> : 'Save Status'}
          </button>
        </div>
      </div>
    </div>
  );
}
