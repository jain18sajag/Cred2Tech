import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, CheckSquare, Square, FileText,
  Clock, AlertCircle, CheckCircle2, XCircle, RefreshCw,
  X, Info, RotateCcw
} from 'lucide-react';
import { getPayouts, updatePayoutStatus, generateInvoice, getPayoutHistory, getSubDsaUsers } from '../api/subDsaPayoutService';
import { useAuth } from '../context/AuthContext';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v) => {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const STATUS_META = {
  DRAFT: { label: 'Draft', color: '#6B7280', bg: '#F3F4F6' },
  INVOICE_RAISED: { label: 'Invoice Raised', color: '#2563EB', bg: '#EFF6FF' },
  UNDER_REVIEW: { label: 'Under Review', color: '#D97706', bg: '#FFFBEB' },
  RECONCILED: { label: 'Reconciled', color: '#059669', bg: '#ECFDF5' },
  PDD_PENDING: { label: 'PDD Pending', color: '#DC2626', bg: '#FEF2F2' },
  PAID: { label: 'Paid', color: '#065F46', bg: '#D1FAE5' },
  REJECTED: { label: 'Rejected', color: '#B91C1C', bg: '#FEE2E2' },
};

const VALID_TRANSITIONS = {
  DRAFT: ['INVOICE_RAISED', 'PDD_PENDING', 'REJECTED'],
  INVOICE_RAISED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['RECONCILED', 'REJECTED'],
  RECONCILED: ['PAID', 'REJECTED'],
  PDD_PENDING: ['RECONCILED', 'REJECTED'],
  PAID: [],
  REJECTED: ['DRAFT'],
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#6B7280', bg: '#F3F4F6' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      color: m.color, background: m.bg
    }}>
      {m.label}
    </span>
  );
}

// ── Update Status Modal ──────────────────────────────────────────────────────
function UpdateStatusModal({ entry, onClose, onSuccess }) {
  const currentStatus = entry.status;
  const allowedNext = VALID_TRANSITIONS[currentStatus] || [];
  const [newStatus, setNewStatus] = useState(allowedNext[0] || '');
  const [remarks, setRemarks] = useState('');
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    getPayoutHistory(entry.id).then(setHistory).catch(() => {});
  }, [entry.id]);

  const handleSave = async () => {
    if (!newStatus) return;
    if (newStatus === 'REJECTED' && !remarks.trim()) {
      alert('Remarks are mandatory when rejecting a payout.');
      return;
    }
    setSaving(true);
    try {
      await updatePayoutStatus(entry.id, newStatus, remarks);
      onSuccess();
    } catch (e) {
      alert(e.response?.data?.error || e.message || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const caseLabel = `${entry.case_entity?.case_number || `CASE-${entry.case_id}`} · ${entry.case_entity?.customer?.name || 'Customer'} · ${entry.user?.name || 'SubDSA'}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 520, boxShadow: '0 25px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={18} color="#2563EB" />
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Update Payout Status</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} color="#6B7280" />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Case info pill */}
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151', fontWeight: 500 }}>
            {caseLabel}
          </div>

          {/* Current status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>Current Status:</span>
            <StatusBadge status={currentStatus} />
          </div>

          {/* New status */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>NEW STATUS</label>
            {allowedNext.length === 0 ? (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', borderRadius: 8, fontSize: 13, color: '#B91C1C' }}>
                This record is in a terminal state and cannot be updated.
              </div>
            ) : (
              <select
                value={newStatus}
                onChange={e => setNewStatus(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, background: '#fff', cursor: 'pointer' }}
              >
                {allowedNext.map(s => (
                  <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                ))}
              </select>
            )}
          </div>

          {/* Remarks */}
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              REMARKS {newStatus === 'REJECTED' ? <span style={{ color: '#DC2626' }}>*</span> : ''}
            </label>
            <textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Optional notes..."
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>

          {/* History toggle */}
          {history.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563EB', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
              >
                <Clock size={14} /> {showHistory ? 'Hide' : 'Show'} Status History ({history.length})
              </button>
              {showHistory && (
                <div style={{ marginTop: 10, borderLeft: '2px solid #E5E7EB', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map((h, i) => (
                    <div key={i} style={{ fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {h.old_status && <StatusBadge status={h.old_status} />}
                        <span style={{ color: '#6B7280' }}>→</span>
                        <StatusBadge status={h.new_status} />
                        <span style={{ color: '#9CA3AF', marginLeft: 4 }}>by {h.updated_by?.name || 'System'}</span>
                      </div>
                      {h.remarks && <div style={{ color: '#6B7280', marginTop: 2 }}>{h.remarks}</div>}
                      <div style={{ color: '#9CA3AF', marginTop: 2 }}>{new Date(h.updated_at).toLocaleString('en-IN')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 500 }}>
            Cancel
          </button>
          {allowedNext.length > 0 && (
            <button
              onClick={handleSave}
              disabled={saving || !newStatus}
              style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {saving ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              Save Status →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Generate Invoice Modal ───────────────────────────────────────────────────
function GenerateInvoiceModal({ subDsaUsers, selectedIds, allLedgers, onClose, onSuccess }) {
  const [subDsaUserId, setSubDsaUserId] = useState('');
  const [monthYear, setMonthYear] = useState('');
  const [saving, setSaving] = useState(false);

  const handleGenerate = async () => {
    if (!subDsaUserId || !monthYear || selectedIds.length === 0) {
      alert('Please select a SubDSA, month, and at least one payout entry.');
      return;
    }
    setSaving(true);
    try {
      const res = await generateInvoice(parseInt(subDsaUserId), monthYear, selectedIds);
      alert(`Invoice ${res.invoice_number} generated for ₹${parseFloat(res.total_payout).toLocaleString('en-IN')}!`);
      onSuccess();
    } catch (e) {
      alert(e.response?.data?.error || 'Invoice generation failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 460, boxShadow: '0 25px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Generate SubDSA Invoice</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#6B7280" /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400E', display: 'flex', gap: 8 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            {selectedIds.length} entry(ies) selected. All must be in DRAFT status.
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>SubDSA Partner</label>
            <select value={subDsaUserId} onChange={e => setSubDsaUserId(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14 }}>
              <option value="">— Select SubDSA —</option>
              {subDsaUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>Month-Year (YYYY-MM)</label>
            <input
              type="month"
              value={monthYear}
              onChange={e => setMonthYear(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleGenerate} disabled={saving}
            style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: '#4F46E5', color: '#fff', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Generating...' : '🧾 Generate Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Summary Row ──────────────────────────────────────────────────────────────
function SummaryRow({ label, data }) {
  return (
    <tr>
      <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: label === 'Older' ? 600 : 400, color: label === 'Older' ? '#111827' : '#374151' }}>{label}</td>
      <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right' }}>{data.cases}</td>
      <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right' }}>{fmt(data.volume)}</td>
      <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', color: '#059669' }}>{fmt(data.payout_eligible)}</td>
      <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', color: '#DC2626' }}>{data.subvention > 0 ? `-${fmt(data.subvention)}` : '—'}</td>
      <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', color: '#059669' }}>{fmt(data.paid_dues)}</td>
      <td style={{ padding: '10px 16px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: '#DC2626' }}>{fmt(data.pending)}</td>
    </tr>
  );
}

// ── SubDSA Expandable Card ───────────────────────────────────────────────────
function SubDsaCard({ subDsa, ledgers, selectedIds, onToggleSelect, onUpdate, isAdmin }) {
  const [expanded, setExpanded] = useState(true);

  const totalVolume = ledgers.reduce((s, l) => s + parseFloat(l.dsa_earned_amount || 0), 0);
  const totalPayout = ledgers.reduce((s, l) => s + parseFloat(l.sub_dsa_payout || 0), 0);

  const hasPddPending = ledgers.some(l => l.status === 'PDD_PENDING');

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
      {/* Card Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: '#FAFAFA' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: '#DBEAFE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#1D4ED8' }}>
            {(subDsa.name || 'S').charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 6 }}>
              {subDsa.name}
              {hasPddPending && (
                <span style={{ fontSize: 11, color: '#DC2626', background: '#FEE2E2', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
                  ⚠ PDD Pending
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
              {ledgers.length} cases · Volume: {fmt(totalVolume)} · Payout: {fmt(totalPayout)}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#6B7280' }}>{expanded ? '– Details' : '+ Details'}</span>
          {expanded ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
        </div>
      </div>

      {/* Case Table */}
      {expanded && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderTop: '1px solid #E5E7EB' }}>
                {isAdmin && <th style={{ padding: '8px 14px', width: 36 }}></th>}
                <th style={thStyle}>Case ID</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Product</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Disb. Amt</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Payout</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Subvention</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Net Payable</th>
                <th style={thStyle}>Status</th>
                {isAdmin && <th style={thStyle}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {ledgers.map(l => {
                const caseNum = l.case_entity?.case_number || `#${l.case_id}`;
                const customer = l.case_entity?.customer?.name || '—';
                const product = l.calculation_metadata?.product_type || '—';
                const subvent = parseFloat(l.subvention_amount || 0);
                const isSelected = selectedIds.includes(l.id);
                const canSelect = l.status === 'DRAFT';

                return (
                  <tr key={l.id} style={{ borderTop: '1px solid #F3F4F6', background: isSelected ? '#EFF6FF' : '#fff' }}>
                    {isAdmin && (
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {canSelect ? (
                          <button onClick={() => onToggleSelect(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                            {isSelected ? <CheckSquare size={16} color="#4F46E5" /> : <Square size={16} color="#D1D5DB" />}
                          </button>
                        ) : (
                          <div style={{ width: 16, height: 16 }} />
                        )}
                      </td>
                    )}
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#1D4ED8' }}>{caseNum}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151' }}>
                      {customer}
                      {l.status === 'PDD_PENDING' && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: '#DC2626', background: '#FEE2E2', padding: '1px 6px', borderRadius: 8, fontWeight: 600 }}>PDD</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, color: '#374151' }}>{product}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right' }}>{fmt(l.dsa_earned_amount)}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', color: '#059669', fontWeight: 600 }}>{fmt(l.sub_dsa_payout)}</td>
                    <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', color: subvent > 0 ? '#DC2626' : '#9CA3AF' }}>
                      {subvent > 0 ? `-${fmt(subvent)}` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>{fmt(l.net_payable)}</td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={l.status} /></td>
                    {isAdmin && (
                      <td style={{ padding: '10px 14px' }}>
                        {(VALID_TRANSITIONS[l.status] || []).length > 0 && (
                          <button
                            onClick={() => onUpdate(l)}
                            style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #4F46E5', background: '#EEF2FF', color: '#4F46E5', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                          >
                            Update
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle = { padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#6B7280', textAlign: 'left', whiteSpace: 'nowrap' };

// ── Main Page ────────────────────────────────────────────────────────────────
export default function SubDsaPayoutPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'DSA_ADMIN';

  const [loading, setLoading] = useState(true);
  const [ledgers, setLedgers] = useState([]);
  const [summary, setSummary] = useState({ current_month: {}, previous_month: {}, older: {} });
  const [subDsaUsers, setSubDsaUsers] = useState([]);
  const [filters, setFilters] = useState({ month: '', sub_dsa_user_id: '', status: '', product: '', search: '' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [updateModal, setUpdateModal] = useState(null);
  const [invoiceModal, setInvoiceModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.month) params.month = filters.month;
      if (filters.sub_dsa_user_id) params.sub_dsa_user_id = filters.sub_dsa_user_id;
      if (filters.status) params.status = filters.status;
      if (filters.product) params.product = filters.product;
      if (filters.search) params.search = filters.search;

      const res = await getPayouts(params);
      setLedgers(res.ledgers || []);
      setSummary(res.summary || { current_month: {}, previous_month: {}, older: {} });
    } catch (e) {
      console.error('Failed to load payouts:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (isAdmin) {
      getSubDsaUsers().then(setSubDsaUsers).catch(() => {});
    }
  }, [isAdmin]);

  // Group ledgers by SubDSA user
  const grouped = ledgers.reduce((acc, l) => {
    const uid = l.sub_dsa_user_id;
    if (!acc[uid]) acc[uid] = { user: l.user, ledgers: [] };
    acc[uid].ledgers.push(l);
    return acc;
  }, {});

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const filterBarStyle = { padding: '12px 16px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, marginBottom: 16 };
  const inputStyle = { padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, background: '#fff', cursor: 'pointer' };

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', paddingBottom: 60 }}>
      {/* Page Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
          🤝 Sub DSA Payout
        </div>
        <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
          Commission payable to Sub-DSA partners — case-wise tracking &amp; payout status
        </div>
      </div>

      {/* Summary Table */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              <th style={{ ...thStyle, padding: '12px 16px' }}>Period</th>
              <th style={{ ...thStyle, textAlign: 'right', padding: '12px 16px' }}>Cases Disbursed</th>
              <th style={{ ...thStyle, textAlign: 'right', padding: '12px 16px' }}>Disbursement Volume</th>
              <th style={{ ...thStyle, textAlign: 'right', padding: '12px 16px', color: '#059669' }}>Payout Eligible</th>
              <th style={{ ...thStyle, textAlign: 'right', padding: '12px 16px', color: '#DC2626' }}>Subvention</th>
              <th style={{ ...thStyle, textAlign: 'right', padding: '12px 16px', color: '#059669' }}>Paid Dues</th>
              <th style={{ ...thStyle, textAlign: 'right', padding: '12px 16px', color: '#DC2626' }}>Pending</th>
            </tr>
          </thead>
          <tbody>
            <SummaryRow label="Current Month" data={summary.current_month || {}} />
            <SummaryRow label="Previous Month" data={summary.previous_month || {}} />
            <SummaryRow label="Older" data={summary.older || {}} />
          </tbody>
        </table>
      </div>

      {/* Filter Bar */}
      <div style={{ ...filterBarStyle, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>Month</label>
          <input type="month" value={filters.month} onChange={e => setFilters(p => ({ ...p, month: e.target.value }))} style={inputStyle} />
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>Sub-DSA</label>
            <select value={filters.sub_dsa_user_id} onChange={e => setFilters(p => ({ ...p, sub_dsa_user_id: e.target.value }))} style={inputStyle}>
              <option value="">All Sub-DSAs</option>
              {subDsaUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>Invoice Status</label>
          <select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))} style={inputStyle}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>Search</label>
          <input
            type="text"
            placeholder="Customer name, case ID..."
            value={filters.search}
            onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
            style={{ ...inputStyle, minWidth: 200 }}
          />
        </div>
        <div style={{ flex: 1 }} />
        {isAdmin && selectedIds.length > 0 && (
          <button
            onClick={() => setInvoiceModal(true)}
            style={{ padding: '9px 20px', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FileText size={15} /> Generate Invoice ({selectedIds.length})
          </button>
        )}
      </div>

      {/* Content */}
      {loading && ledgers.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#9CA3AF' }}>
          <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
          <div>Loading payout records...</div>
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', color: '#6B7280' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🤝</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No payout records found</div>
          <div style={{ fontSize: 13 }}>Payout entries are created automatically when a SubDSA's case is disbursed and commission is recorded.</div>
        </div>
      ) : (
        <div>
          {Object.entries(grouped).map(([uid, group]) => (
            <SubDsaCard
              key={uid}
              subDsa={group.user || { name: 'Unknown' }}
              ledgers={group.ledgers}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onUpdate={setUpdateModal}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {updateModal && (
        <UpdateStatusModal
          entry={updateModal}
          onClose={() => setUpdateModal(null)}
          onSuccess={() => { setUpdateModal(null); fetchData(); }}
        />
      )}
      {invoiceModal && (
        <GenerateInvoiceModal
          subDsaUsers={subDsaUsers}
          selectedIds={selectedIds}
          allLedgers={ledgers}
          onClose={() => setInvoiceModal(false)}
          onSuccess={() => { setInvoiceModal(false); setSelectedIds([]); fetchData(); }}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
