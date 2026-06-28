import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { caseService } from '../api/caseService';
import { toast } from 'react-hot-toast';
import {
  FileText,
  ArrowRight,
  Clock,
  Wallet,
  AlertCircle,
  TrendingUp,
  Calendar,
  CheckCircle2,
  PieChart,
  Search,
  X
} from 'lucide-react';

export default function PartDisbursementPage() {
  const [data, setData] = useState({ cases: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);

  // Tranche Update Form State
  const [trancheForm, setTrancheForm] = useState({
    amount: '',
    disbursement_date: new Date().toISOString().split('T')[0],
    next_disbursement_due_date: '',
    remarks: '',
    pdd_pending: false,
    pdd_documents: [{ document_name: '', due_date: '' }]
  });

  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await caseService.getPartialDisbursements();
      console.log('[DEBUG] Partial Disbursements Result:', result);
      setData(result);
    } catch (error) {
      toast.error('Failed to load partial disbursements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenUpdate = (caseObj) => {
    setSelectedCase(caseObj);
    setTrancheForm({
      amount: caseObj.remaining_disbursement_amount,
      disbursement_date: new Date().toISOString().split('T')[0],
      next_disbursement_due_date: '',
      remarks: '',
      pdd_pending: false,
      pdd_documents: [{ document_name: '', due_date: '' }]
    });
    setShowUpdateModal(true);
  };

  const handleSaveTranche = async () => {
    if (!trancheForm.amount) return toast.error('Please enter disbursement amount');

    try {
      const payload = {
        ...trancheForm,
        pdd_tasks: trancheForm.pdd_pending ? trancheForm.pdd_documents : []
      };
      const idempotencyKey = `auto_${selectedCase.id}_${Date.now()}`;
      await caseService.recordDisbursement(selectedCase.id, payload, idempotencyKey);
      toast.success('Disbursement recorded successfully');
      setShowUpdateModal(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to record disbursement');
    }
  };

  const filteredCases = (data?.cases || []).filter(c =>
    c.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.id?.toString().includes(searchTerm)
  );

  const formatCr = (val) => {
    const num = parseFloat(val) || 0;
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `₹${(num / 100000).toFixed(2)} L`;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  if (loading && (!data || !data.cases)) return <div style={{ padding: 40, textAlign: 'center' }}>Loading cases...</div>;

  const stats = data?.stats || {};

  return (
    <div style={{ padding: '24px 30px', maxWidth: 1400, margin: '0 auto', fontFamily: "'Manrope', sans-serif" }}>

      {/* HEADER SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: '#0A2540', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🏗️</span> Part Disbursement
          </h2>
          <p style={{ color: '#425466', fontSize: 14, margin: 0 }}>Track and update pending disbursement tranches across all cases</p>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#8898AA' }} />
          <input
            type="text"
            placeholder="Search by customer name or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: '10px 12px 10px 40px', borderRadius: 980, border: '1.5px solid rgba(60,66,87,0.12)', fontSize: 13, width: 300, outline: 'none' }}
          />
        </div>
      </div>

      {/* SUMMARY CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 32 }}>
        <StatCard
          icon={<TrendingUp size={20} color="#635BFF" />}
          label="Total Pending Volume"
          value={formatCr(stats.totalPendingVolume)}
          sublabel={`${stats.pendingCount || 0} cases pending`}
          bg="rgba(99,91,255,0.05)"
        />
        <StatCard
          icon={<Calendar size={20} color="#EA580C" />}
          label="Disbursement Due This Month"
          value={formatCr(stats.dueThisMonthVolume)}
          sublabel={`${stats.dueThisMonthCount || 0} case due in ${new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' })}`}
          bg="rgba(234,88,12,0.05)"
        />
        <StatCard
          icon={<CheckCircle2 size={20} color="#166534" />}
          label="Volume Disbursed This Month"
          value={formatCr(stats.volumeDisbursedThisMonth)}
          sublabel={`${stats.tranchesThisMonth || 0} tranches recorded this month`}
          bg="rgba(22,101,52,0.05)"
        />
        <StatCard
          icon={<PieChart size={20} color="#7C3AED" />}
          label="Closing Balance"
          value={formatCr((stats.totalPendingVolume || 0) - (stats.dueThisMonthVolume || 0))}
          sublabel="Total pending after this month"
          bg="rgba(124,58,237,0.05)"
          isLast
        />
      </div>

      {/* PIPELINE TABLE */}
      <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(60,66,87,0.12)', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Lender / Product</th>
              <th style={thStyle}>Sanctioned</th>
              <th style={thStyle}>Disbursed</th>
              <th style={thStyle}>Pending Amount</th>
              <th style={thStyle}>Next Due Date</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredCases.map((c) => {
              const sanctioned = parseFloat(c.sanctioned_amount) || 0;
              const disbursed = parseFloat(c.total_disbursed_amount) || 0;
              const disbursedPct = sanctioned > 0 ? (disbursed / sanctioned) * 100 : 0;
              const isOverdue = c.next_disbursement_due_date && new Date(c.next_disbursement_due_date) < new Date();

              return (
                <tr key={c.id} style={{ borderBottom: '1px solid rgba(60,66,87,0.06)', transition: '.2s' }} className="table-row-hover">
                  <td style={tdStyle}>
                    <div
                      onClick={() => navigate(`/cases/${c.id}`)}
                      style={{ fontWeight: 700, color: '#635BFF', cursor: 'pointer' }}
                    >
                      {c.customer_name}
                    </div>
                    <div style={{ fontSize: 11, color: '#8898AA' }}>CASE-{c.id}</div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#0A2540' }}>{c.lender_name}</div>
                    <div style={{ fontSize: 11, color: '#425466' }}>{c.product_type}</div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 700 }}>{formatCr(c.sanctioned_amount)}</div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 700, color: '#166534' }}>{formatCr(c.total_disbursed_amount)}</div>
                    <div style={{ fontSize: 10, color: '#64748B', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 40, height: 4, background: '#E2E8F0', borderRadius: 2 }}>
                        <div style={{ width: `${disbursedPct}%`, height: '100%', background: '#166534', borderRadius: 2 }}></div>
                      </div>
                      {disbursedPct.toFixed(0)}% disbursed
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 700, color: '#C2410C' }}>{formatCr(c.remaining_disbursement_amount)}</div>
                  </td>
                  <td style={tdStyle}>
                    {c.next_disbursement_due_date ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: isOverdue ? '#DC2626' : '#0A2540' }}>
                          <Calendar size={14} /> {new Date(c.next_disbursement_due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: isOverdue ? '#DC2626' : '#EA580C' }}>
                          {isOverdue ? 'Overdue' : 'Due soon'}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: '#8898AA' }}>Not Scheduled</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      onClick={() => handleOpenUpdate(c)}
                      style={{
                        background: 'linear-gradient(135deg,#635BFF,#7C3AED)', color: '#fff', border: 'none',
                        padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                        cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,91,255,0.24)'
                      }}
                    >
                      Update
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* RECORD NEW DISBURSEMENT MODAL */}
      {showUpdateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10, 37, 64, 0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 24, width: 620, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 32px 64px rgba(0,0,0,0.2)' }}>
            {/* Modal Header */}
            <div style={{ padding: '24px 30px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0A2540', display: 'flex', alignItems: 'center', gap: 10 }}>
                  🏗️ Record New Disbursement
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#425466' }}>
                  {selectedCase?.customer_name} · {selectedCase?.lender_name} · CASE-{selectedCase?.id}
                </p>
              </div>
              <button onClick={() => setShowUpdateModal(false)} style={{ border: 'none', background: '#F6F9FC', padding: 8, borderRadius: '50%', cursor: 'pointer' }}><X size={20} color="#8898AA" /></button>
            </div>

            <div style={{ padding: 30 }}>
              {/* Top Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
                <div style={{ padding: '16px', background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Sanctioned</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#0A2540' }}>{formatCr(selectedCase.sanctioned_amount)}</div>
                </div>
                <div style={{ padding: '16px', background: '#F0FDF4', borderRadius: 12, border: '1px solid #DCFCE7', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#166534', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Disbursed So Far</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#15803d' }}>{formatCr(selectedCase.total_disbursed_amount)}</div>
                </div>
                <div style={{ padding: '16px', background: '#FFF7ED', borderRadius: 12, border: '1px solid #FFEDD5', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#C2410C', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Balance Pending</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#EA580C' }}>{formatCr(selectedCase.remaining_disbursement_amount)}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#425466', marginBottom: 6 }}>New Disbursement Amount (₹) *</label>
                  <input
                    type="number"
                    value={trancheForm.amount}
                    onChange={(e) => setTrancheForm({ ...trancheForm, amount: e.target.value })}
                    placeholder="e.g. 4000000"
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 15, fontWeight: 600 }}
                  />
                  <div style={{ fontSize: 11, color: '#8898AA', marginTop: 4 }}>Max pending balance: {formatCr(selectedCase.remaining_disbursement_amount)}</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#425466', marginBottom: 6 }}>Date of Disbursement *</label>
                  <input
                    type="date"
                    value={trancheForm.disbursement_date}
                    onChange={(e) => setTrancheForm({ ...trancheForm, disbursement_date: e.target.value })}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14 }}
                  />
                </div>
              </div>

              {/* Balance Pending Alert & New Due Date */}
              {selectedCase.remaining_disbursement_amount - trancheForm.amount > 0 && (
                <div style={{ background: '#FFF7ED', border: '1px solid #FFD8A8', borderRadius: 16, padding: '20px', marginBottom: 24 }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#EA580C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>⏰</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#9A3412' }}>Balance Pending After This Disbursement</div>
                      <div style={{ fontSize: 12, color: '#C2410C', marginTop: 2 }}>
                        After this disbursement of ₹{parseFloat(trancheForm.amount).toLocaleString('en-IN')}, a balance of <strong>{formatCr(selectedCase.remaining_disbursement_amount - trancheForm.amount)}</strong> will remain pending.
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#9A3412', textTransform: 'uppercase', marginBottom: 6 }}>New Due Date for Balance Amount *</label>
                    <input
                      type="date"
                      value={trancheForm.next_disbursement_due_date}
                      onChange={(e) => setTrancheForm({ ...trancheForm, next_disbursement_due_date: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #FED7AA', background: '#fff' }}
                    />
                    <div style={{ fontSize: 10, color: '#9A3412', marginTop: 4 }}>The case will stay in Part Disbursement until the balance is fully cleared</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#425466', marginBottom: 6 }}>Notes (Optional)</label>
                <textarea
                  placeholder="Any remarks for this disbursement tranche..."
                  value={trancheForm.remarks}
                  onChange={(e) => setTrancheForm({ ...trancheForm, remarks: e.target.value })}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1.5px solid #E2E8F0', fontSize: 14, minHeight: 80 }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  onClick={() => setShowUpdateModal(false)}
                  style={{ padding: '12px 24px', borderRadius: 12, border: '1.5px solid #E2E8F0', background: '#fff', fontSize: 14, fontWeight: 700, color: '#425466', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTranche}
                  style={{
                    padding: '12px 30px', borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg,#635BFF,#7C3AED)',
                    fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    boxShadow: '0 8px 20px rgba(99,91,255,0.3)'
                  }}
                >
                  ✓ Save Disbursement →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .table-row-hover:hover { background: rgba(99,91,255,0.02) !important; }
      `}</style>
    </div>
  );
}

function StatCard({ icon, label, value, sublabel, bg, isLast }) {
  return (
    <div style={{
      background: '#fff', padding: '24px', borderRadius: 20,
      border: isLast ? '2.5px solid #635BFF' : '1px solid rgba(60,66,87,0.12)',
      boxShadow: isLast ? '0 8px 24px rgba(99,91,255,0.12)' : '0 4px 12px rgba(0,0,0,0.02)'
    }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        {icon}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#0A2540', marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#425466', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#8898AA' }}>{sublabel}</div>
    </div>
  );
}

const thStyle = {
  padding: '16px 20px', textAlign: 'left', fontSize: 10, fontWeight: 800,
  textTransform: 'uppercase', letterSpacing: '1px', color: '#8898AA', borderBottom: '1px solid rgba(60,66,87,0.1)'
};

const tdStyle = {
  padding: '20px', fontSize: 14, color: '#0A2540', verticalAlign: 'middle'
};
