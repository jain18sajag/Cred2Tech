import React, { useState, useEffect } from 'react';
import { getInvoiceCandidates, previewInvoice, updateLedgerStatus } from '../../api/commissionOperationsService';
import LoadingSpinner from '../ui/LoadingSpinner';
import { X, Printer, Download } from 'lucide-react';

export default function GenerateInvoiceModal({ onClose, availableMonths, availableLenders, onSuccess }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  
  // Step 1 State
  const [filters, setFilters] = useState({
    month: availableMonths[0] || '',
    lenderName: '',
    product: 'All Products'
  });
  const [candidates, setCandidates] = useState([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState(new Set());
  const [candidateLoading, setCandidateLoading] = useState(false);

  // Step 2 State
  const [previewData, setPreviewData] = useState(null);

  useEffect(() => {
    if (filters.lenderName && filters.month) {
      fetchCandidates();
    } else {
      setCandidates([]);
    }
  }, [filters.lenderName, filters.month, filters.product]);

  const fetchCandidates = async () => {
    try {
      setCandidateLoading(true);
      const res = await getInvoiceCandidates(filters.lenderName, filters.product, filters.month);
      if (res.success) {
        setCandidates(res.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCandidateLoading(false);
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedCaseIds(new Set(candidates.map(c => c.id)));
    } else {
      setSelectedCaseIds(new Set());
    }
  };

  const handleSelectCase = (id) => {
    const newSet = new Set(selectedCaseIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedCaseIds(newSet);
  };

  const handlePreview = async () => {
    if (selectedCaseIds.size === 0) return alert("Select at least one case to invoice");
    
    // Collect ledger ids from selected cases
    const ledgerIds = [];
    candidates.forEach(c => {
      if (selectedCaseIds.has(c.id)) {
        ledgerIds.push(...c.ledger_ids);
      }
    });

    try {
      setLoading(true);
      const res = await previewInvoice(ledgerIds, filters.lenderName, filters.month);
      if (res.success) {
        setPreviewData(res.data);
        setStep(2);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to generate preview");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkInvoiced = async () => {
    // Collect ledger ids
    const ledgerIds = [];
    candidates.forEach(c => {
      if (selectedCaseIds.has(c.id)) {
        ledgerIds.push(...c.ledger_ids);
      }
    });

    try {
      setLoading(true);
      // In Phase 1, we just update status for all selected ledgers to INVOICED
      for (const ledgerId of ledgerIds) {
        await updateLedgerStatus(ledgerId, 'INVOICED', `Invoice ${previewData.invoice_number}`);
      }
      onSuccess();
    } catch (e) {
      console.error(e);
      alert("Error marking as invoiced");
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
    background: '#fff', borderRadius: '12px', width: '100%', maxWidth: step === 1 ? '700px' : '900px',
    maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
  };

  const formatCurrency = (amount) => {
    if (amount == null) return '—';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  const renderStep1 = () => (
    <>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>Generate Invoice</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6B7280' }}>Select pending cases to include in this invoice</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><X size={20} /></button>
      </div>
      
      <div style={{ padding: '24px', flex: 1, overflowY: 'auto', background: '#F9FAFB' }}>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Lender</label>
            <select 
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
              value={filters.lenderName}
              onChange={(e) => setFilters({...filters, lenderName: e.target.value})}
            >
              <option value="">-- Select Lender --</option>
              {availableLenders.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Month</label>
            <select 
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
              value={filters.month}
              onChange={(e) => setFilters({...filters, month: e.target.value})}
            >
              {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Product</label>
            <select 
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #D1D5DB' }}
              value={filters.product}
              onChange={(e) => setFilters({...filters, product: e.target.value})}
            >
              <option value="All Products">All Products</option>
              <option value="LAP">LAP</option>
              <option value="HL">Home Loan</option>
            </select>
          </div>
        </div>

        {candidateLoading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}><LoadingSpinner size={24} /></div>
        ) : !filters.lenderName ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280', background: '#fff', borderRadius: '8px', border: '1px dashed #D1D5DB' }}>
            Select a lender to view pending cases
          </div>
        ) : candidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280', background: '#fff', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
            No pending commission records found for this selection.
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #E5E7EB', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead style={{ background: '#F3F4F6' }}>
                <tr>
                  <th style={{ padding: '12px 16px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>
                    <input type="checkbox" checked={selectedCaseIds.size === candidates.length && candidates.length > 0} onChange={handleSelectAll} />
                  </th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#4B5563', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>CASE ID</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: '#4B5563', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>CUSTOMER</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', color: '#4B5563', fontWeight: '600', borderBottom: '1px solid #E5E7EB' }}>COMMISSION</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={c.id}>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6' }}>
                      <input type="checkbox" checked={selectedCaseIds.has(c.id)} onChange={() => handleSelectCase(c.id)} />
                    </td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', fontWeight: '600', color: '#111827' }}>{c.caseId}</td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', color: '#374151' }}>{c.customer}</td>
                    <td style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', textAlign: 'right', fontWeight: '600', color: '#10B981' }}>{formatCurrency(c.payout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
        <div style={{ fontSize: '14px', color: '#374151' }}>
          Selected: <span style={{ fontWeight: '600' }}>{selectedCaseIds.size}</span> cases
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button 
            onClick={handlePreview} 
            disabled={selectedCaseIds.size === 0 || loading}
            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: selectedCaseIds.size === 0 ? '#9CA3AF' : '#111827', color: '#fff', fontWeight: '600', cursor: selectedCaseIds.size === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {loading ? <LoadingSpinner size={16} /> : 'Preview Invoice'}
          </button>
        </div>
      </div>
    </>
  );

  const renderStep2 = () => (
    <>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>Preview Tax Invoice</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6B7280' }}>Please review the generated invoice before finalizing</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><X size={20} /></button>
      </div>

      <div style={{ padding: '32px', flex: 1, overflowY: 'auto', background: '#F3F4F6' }}>
        {/* Invoice PDF Wrapper */}
        <div style={{ background: '#fff', padding: '40px', borderRadius: '4px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', maxWidth: '800px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #111827', paddingBottom: '24px', marginBottom: '24px' }}>
            <div>
              <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', color: '#111827' }}>TAX INVOICE</h1>
              <div style={{ fontSize: '12px', color: '#4B5563', lineHeight: '1.5' }}>
                <div><strong>Invoice No:</strong> {previewData?.invoice_number}</div>
                <div><strong>Date:</strong> {previewData?.invoice_date}</div>
                <div><strong>Period:</strong> {previewData?.month}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827', marginBottom: '4px' }}>{previewData?.tenant?.name}</div>
              <div style={{ fontSize: '12px', color: '#4B5563', lineHeight: '1.5' }}>
                <div>State: {previewData?.tenant?.state}</div>
                <div>PAN: {previewData?.tenant?.pan}</div>
                <div>GSTIN: {previewData?.tenant?.gst}</div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#6B7280', textTransform: 'uppercase' }}>Billed To:</h3>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#111827' }}>{previewData?.lender_name}</div>
            <div style={{ fontSize: '12px', color: '#4B5563', marginTop: '4px' }}>Commission & Incentives for {previewData?.month}</div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '32px', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '2px solid #E5E7EB' }}>
                <th style={{ padding: '12px', textAlign: 'left', color: '#374151' }}>Case ID</th>
                <th style={{ padding: '12px', textAlign: 'left', color: '#374151' }}>Customer</th>
                <th style={{ padding: '12px', textAlign: 'left', color: '#374151' }}>Product</th>
                <th style={{ padding: '12px', textAlign: 'right', color: '#374151' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {previewData?.cases?.map((c, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '12px', color: '#111827' }}>{c.caseId}</td>
                  <td style={{ padding: '12px', color: '#4B5563' }}>{c.customer}</td>
                  <td style={{ padding: '12px', color: '#4B5563' }}>{c.product}</td>
                  <td style={{ padding: '12px', textAlign: 'right', color: '#111827', fontWeight: '500' }}>{formatCurrency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <table style={{ width: '300px', fontSize: '14px' }}>
              <tbody>
                <tr>
                  <td style={{ padding: '8px', color: '#4B5563' }}>Subtotal</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: '500' }}>{formatCurrency(previewData?.subtotal)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '8px', color: '#4B5563', borderBottom: '1px solid #E5E7EB' }}>GST (18%)</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: '500', borderBottom: '1px solid #E5E7EB' }}>{formatCurrency(previewData?.gst)}</td>
                </tr>
                <tr>
                  <td style={{ padding: '12px 8px', color: '#111827', fontWeight: 'bold', fontSize: '16px' }}>Total Amount</td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 'bold', fontSize: '16px' }}>{formatCurrency(previewData?.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

        </div>
      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
        <button onClick={() => setStep(1)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', fontWeight: '600', color: '#374151', cursor: 'pointer' }}>Back to Selection</button>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => alert("PDF Download Preview (TODO)")} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', fontWeight: '600', color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={16} /> Download
          </button>
          <button onClick={() => window.print()} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB', background: '#fff', fontWeight: '600', color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Printer size={16} /> Print
          </button>
          <button 
            onClick={handleMarkInvoiced} 
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#3B82F6', color: '#fff', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            {loading ? <LoadingSpinner size={16} /> : 'Mark as Invoiced'}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div style={modalStyle}>
      <div style={contentStyle}>
        {step === 1 ? renderStep1() : renderStep2()}
      </div>
    </div>
  );
}
