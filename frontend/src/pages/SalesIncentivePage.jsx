import React, { useState, useEffect, useCallback } from 'react';
import { salesIncentiveService } from '../api/salesIncentiveService';
import { useAuth } from '../context/AuthContext';
import { Target, ChevronDown, ChevronUp, FileText, X, Activity } from 'lucide-react';

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
  CALCULATED: { label: 'Calculated', color: '#6B7280', bg: '#F3F4F6' },
  APPROVED: { label: 'Approved', color: '#1D4ED8', bg: '#DBEAFE' },
  PAID: { label: 'Paid', color: '#065F46', bg: '#D1FAE5' },
  REJECTED: { label: 'Rejected', color: '#B91C1C', bg: '#FEE2E2' },
};

const VALID_TRANSITIONS = {
  CALCULATED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PAID', 'REJECTED'],
  PAID: [],
  REJECTED: [],
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: '#6B7280', bg: '#F3F4F6' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, color: m.color, background: m.bg }}>
      {m.label}
    </span>
  );
}

const thStyle = { padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#6B7280', textAlign: 'left', whiteSpace: 'nowrap', textTransform: 'uppercase' };

// ── Update Status Modal ──────────────────────────────────────────────────────
function UpdateStatusModal({ entry, onClose, onSuccess }) {
  const currentStatus = entry.status;
  const allowedNext = VALID_TRANSITIONS[currentStatus] || [];
  const [newStatus, setNewStatus] = useState(allowedNext[0] || '');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!newStatus) return;
    setSaving(true);
    try {
      await salesIncentiveService.updatePayoutStatus(entry.id, { status: newStatus, remarks });
      onSuccess();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const caseLabel = `${entry.case_entity?.case_number || `CASE-${entry.case_id}`} - ${entry.case_entity?.customer?.name || 'Customer'} - ${entry.user?.name || 'Employee'}`;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 460, boxShadow: '0 25px 60px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Target size={16} color="#ef4444" />
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Update Incentive Status</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color="#6B7280" /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#374151', fontWeight: 500 }}>
            {caseLabel}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>New Status</label>
            {allowedNext.length === 0 ? (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', borderRadius: 8, fontSize: 13, color: '#B91C1C' }}>Cannot update terminal state.</div>
            ) : (
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, background: '#fff' }}>
                {allowedNext.map(s => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
              </select>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Remarks</label>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Optional notes..." rows={3} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: 14, resize: 'vertical' }} />
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 24px', borderRadius: 20, border: 'none', background: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600, color: '#374151' }}>Cancel</button>
          {allowedNext.length > 0 && (
            <button onClick={handleSave} disabled={saving || !newStatus} style={{ padding: '9px 24px', borderRadius: 20, border: 'none', background: '#4F46E5', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
              Save Status →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Summary Row ──────────────────────────────────────────────────────────────
function SummaryRow({ label, data }) {
  return (
    <tr style={{ borderBottom: '1px solid #F3F4F6', background: '#fff' }}>
      <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: label === 'Older' ? 700 : 600, color: '#111827' }}>{label}</td>
      <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center' }}>{data.cases || 0}</td>
      <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center' }}>{fmt(data.volume || 0)}</td>
      <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center', color: '#059669' }}>{fmt(data.payout_eligible || 0)}</td>
      <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center', color: '#059669' }}>{fmt(data.paid_dues || 0)}</td>
      <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'center', fontWeight: 700, color: '#DC2626' }}>{fmt(data.pending || 0)}</td>
    </tr>
  );
}

// ── Employee Expandable Card ───────────────────────────────────────────────────
function EmployeeCard({ employee, ledgers, onUpdate, isAdmin }) {
  const [expanded, setExpanded] = useState(true);

  const totalVolume = ledgers.reduce((s, l) => s + parseFloat(l.base_amount || 0), 0);
  const totalPayout = ledgers.reduce((s, l) => s + parseFloat(l.calculated_incentive || 0), 0);
  const hasPending = ledgers.some(l => l.status === 'CALCULATED');

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Target size={14} color="#EF4444" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              {employee.name}
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
              {ledgers.length} cases - Volume: {fmt(totalVolume)} - Payout: {fmt(totalPayout)} {hasPending && <span style={{ color: '#D97706', fontWeight: 600 }}> - Pending Action</span>}
            </div>
          </div>
        </div>
        <button style={{ padding: '6px 12px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Details
        </button>
      </div>

      {expanded && (
        <div style={{ overflowX: 'auto', borderTop: '1px solid #F3F4F6' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fff' }}>
                <th style={thStyle}>Case ID</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Product</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Disb. Amt</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Payout</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Subvention</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Net Payable</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                {isAdmin && <th style={{ ...thStyle, textAlign: 'center' }}>Action</th>}
              </tr>
            </thead>
            <tbody>
              {ledgers.map(l => {
                const caseNum = l.case_entity?.case_number || `CASE-${l.case_id}`;
                const customer = l.case_entity?.customer?.name || '—';
                const product = l.case_entity?.product_type || '—';
                const disbAmt = parseFloat(l.base_amount || 0);
                const payout = parseFloat(l.calculated_incentive || 0);

                return (
                  <tr key={l.id} style={{ borderTop: '1px solid #F3F4F6', background: l.status === 'APPROVED' ? '#F4FBF7' : '#fff' }}>
                    <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700, color: '#111827' }}>{caseNum}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: '#374151' }}>{customer}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, color: '#374151' }}>{product}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, textAlign: 'right', color: '#111827' }}>{fmt(disbAmt)}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: '#059669' }}>{fmt(payout)}</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, textAlign: 'right', color: '#DC2626' }}>—</td>
                    <td style={{ padding: '12px 14px', fontSize: 13, textAlign: 'right', fontWeight: 700, color: '#111827' }}>{fmt(payout)}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}><StatusBadge status={l.status} /></td>
                    {isAdmin && (
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {(VALID_TRANSITIONS[l.status] || []).length > 0 && (
                          <button onClick={() => onUpdate(l)} style={{ padding: '4px 12px', borderRadius: 16, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Update</button>
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

// ── Main Page ────────────────────────────────────────────────────────────────
export default function SalesIncentivePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'DSA_ADMIN';

  const [loading, setLoading] = useState(true);
  const [ledgers, setLedgers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [rules, setRules] = useState([]);
  const [filters, setFilters] = useState({ month: '', user_id: '', product: '', search: '' });
  const [updateModal, setUpdateModal] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [newRule, setNewRule] = useState({
    hierarchy_level: '',
    commission_type: 'PERCENTAGE',
    commission_value: '',
    calculation_base: 'DISBURSED_AMOUNT'
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.month) params.month = filters.month;
      if (filters.user_id) params.user_id = filters.user_id;
      if (filters.search) params.search = filters.search;
      
      const [resPayouts, resEmployees, resRules] = await Promise.all([
        salesIncentiveService.getPayouts(params),
        salesIncentiveService.getEmployeesConfig(),
        salesIncentiveService.getRules()
      ]);
      setLedgers(resPayouts || []);
      setEmployees(resEmployees || []);
      setRules(resRules || []);
    } catch (e) {
      console.error('Failed to load:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateRule = async (e) => {
    e.preventDefault();
    try {
      await salesIncentiveService.createRule(newRule);
      setNewRule({ hierarchy_level: '', commission_type: 'PERCENTAGE', commission_value: '', calculation_base: 'DISBURSED_AMOUNT' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create rule');
    }
  };

  const grouped = ledgers.reduce((acc, l) => {
    const uid = l.user_id;
    if (!acc[uid]) acc[uid] = { user: l.user, ledgers: [] };
    acc[uid].ledgers.push(l);
    return acc;
  }, {});

  // Compute mock summary data from ledgers
  const totalVolume = ledgers.reduce((s, l) => s + parseFloat(l.base_amount || 0), 0);
  const totalPayout = ledgers.reduce((s, l) => s + parseFloat(l.calculated_incentive || 0), 0);
  const totalPaid = ledgers.filter(l => l.status === 'PAID').reduce((s, l) => s + parseFloat(l.calculated_incentive || 0), 0);
  
  const summary = {
    older: { cases: ledgers.length, volume: totalVolume, payout_eligible: totalPayout, paid_dues: totalPaid, pending: totalPayout - totalPaid }
  };

  const inputStyle = { padding: '8px 14px', border: '1px solid #E5E7EB', borderRadius: 8, fontSize: 13, background: '#F9FAFB', color: '#111827', width: '100%', outline: 'none' };

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', paddingBottom: 60 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Target size={16} color="#ef4444" />
            </div>
            Sales Incentive
          </div>
          <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Performance incentives & bonuses for team members — tracking & payout
          </div>
        </div>
        {isAdmin && (
          <button onClick={() => setShowConfigModal(true)} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={14} /> Rule Configuration
          </button>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F9FAFB' }}>
              <th style={thStyle}>Period</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Cases Disbursed</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Disbursement Volume</th>
              <th style={{ ...thStyle, textAlign: 'center', color: '#6B7280' }}>Payout Eligible</th>
              <th style={{ ...thStyle, textAlign: 'center', color: '#6B7280' }}>Paid Dues</th>
              <th style={{ ...thStyle, textAlign: 'center', color: '#DC2626' }}>Pending</th>
            </tr>
          </thead>
          <tbody>
            <SummaryRow label="Current Month" data={{ cases: 0, volume: 0, payout_eligible: 0, paid_dues: 0, pending: 0 }} />
            <SummaryRow label="Previous Month" data={{ cases: 0, volume: 0, payout_eligible: 0, paid_dues: 0, pending: 0 }} />
            <SummaryRow label="Older" data={summary.older} />
          </tbody>
        </table>
      </div>

      <div style={{ padding: '16px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 20, display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Month</label>
          <select value={filters.month} onChange={e => setFilters({...filters, month: e.target.value})} style={inputStyle}>
            <option value="">All Months</option>
            <option value="2026-03">March 2026</option>
            <option value="2026-02">February 2026</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Team Member</label>
          <select value={filters.user_id} onChange={e => setFilters({...filters, user_id: e.target.value})} style={inputStyle}>
            <option value="">All Members</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Product</label>
          <select style={inputStyle}><option>All Products</option></select>
        </div>
        <div style={{ flex: 2 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Search</label>
          <input type="text" placeholder="Customer name, case ID..." value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} style={inputStyle} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>Loading records...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, color: '#6B7280' }}>
          No incentive records found.
        </div>
      ) : (
        Object.entries(grouped).map(([uid, group]) => (
          <EmployeeCard key={uid} employee={group.user} ledgers={group.ledgers} onUpdate={setUpdateModal} isAdmin={isAdmin} />
        ))
      )}

      {updateModal && <UpdateStatusModal entry={updateModal} onClose={() => setUpdateModal(null)} onSuccess={() => { setUpdateModal(null); fetchData(); }} />}
      
      {showConfigModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, width: 800, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Incentive Rules Configuration</h3>
              <button onClick={() => setShowConfigModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#6B7280" /></button>
            </div>
            
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              <form onSubmit={handleCreateRule} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 24, background: '#F9FAFB', padding: 16, borderRadius: 8, border: '1px solid #E5E7EB' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Level</label>
                  <input required placeholder="e.g. L1" value={newRule.hierarchy_level} onChange={e => setNewRule({...newRule, hierarchy_level: e.target.value})} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Type</label>
                  <select value={newRule.commission_type} onChange={e => setNewRule({...newRule, commission_type: e.target.value})} style={inputStyle}>
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed (₹)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Value</label>
                  <input required type="number" step="0.01" value={newRule.commission_value} onChange={e => setNewRule({...newRule, commission_value: e.target.value})} style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Base</label>
                  <select value={newRule.calculation_base} onChange={e => setNewRule({...newRule, calculation_base: e.target.value})} style={inputStyle}>
                    <option value="DISBURSED_AMOUNT">Disbursed Amount</option>
                    <option value="FIXED_PER_CASE">Fixed Per Case</option>
                  </select>
                </div>
                <button type="submit" style={{ padding: '8px 16px', background: '#4F46E5', color: '#fff', borderRadius: 8, border: 'none', fontWeight: 600, cursor: 'pointer' }}>Add</button>
              </form>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                    <th style={thStyle}>Level</th>
                    <th style={thStyle}>Base</th>
                    <th style={thStyle}>Value</th>
                    <th style={thStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 700 }}>{r.hierarchy_level}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13 }}>{r.calculation_base.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#059669' }}>
                        {r.commission_type === 'PERCENTAGE' ? `${r.commission_value}%` : `₹${r.commission_value}`}
                      </td>
                      <td style={{ padding: '12px 14px' }}><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                  {rules.length === 0 && <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>No rules configured</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
