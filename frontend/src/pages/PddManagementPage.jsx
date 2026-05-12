import React, { useState, useEffect } from 'react';
import {
  Search as FiSearch, Filter as FiFilter, RefreshCw as FiRefreshCw, Clock as FiClock, CheckCircle as FiCheckCircle, XCircle as FiXCircle,
  FileText as FiFileText, AlertCircle as FiAlertCircle, Check as FiCheck, X as FiX, Edit as FiEdit
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { getPddTasks, updatePddStatus } from '../api/pddService';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';

export default function PddManagementPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({
    total: 0, pending: 0, collected: 0, waived: 0, overdue: 0
  });
  const [loading, setLoading] = useState(true);

  // Filters
  const [activeTab, setActiveTab] = useState('ALL'); // ALL, PENDING, COLLECTED, WAIVED
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [modalForm, setModalForm] = useState({
    status: '',
    collection_date: '',
    collected_by: '',
    waiver_reason: '',
    remarks: ''
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, search]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearch(searchInput);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const query = {
        status: activeTab,
        search: search
      };
      const res = await getPddTasks(query);
      if (res.success) {
        setTasks(res.data);
        setSummary(res.summary);
      }
    } catch (err) {
      toast.error('Failed to load PDD tasks');
    } finally {
      setLoading(false);
    }
  };

  const openModal = (task) => {
    setSelectedTask(task);
    setModalForm({
      status: task.status === 'RECEIVED' ? 'COLLECTED' : task.status,
      collection_date: task.collection_date ? format(new Date(task.collection_date), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
      collected_by: task.collected_by || user.name || '',
      waiver_reason: task.waiver_reason || '',
      remarks: task.remarks || ''
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedTask(null);
  };

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const payload = {
        status: modalForm.status,
        remarks: modalForm.remarks
      };

      if (modalForm.status === 'COLLECTED') {
        payload.collection_date = modalForm.collection_date;
        payload.collected_by = modalForm.collected_by;
      } else if (modalForm.status === 'WAIVED') {
        payload.waiver_reason = modalForm.waiver_reason;
      }

      await updatePddStatus(selectedTask.pdd_task_id, payload);
      toast.success('PDD status updated successfully');
      closeModal();
      fetchTasks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update status');
    } finally {
      setSubmitting(false);
    }
  };

  // UI Helpers
  const getStatusBadge = (status, isOverdue) => {
    if (status === 'PENDING' && isOverdue) {
      return (
        <span style={{ background: '#FEE2E2', color: '#991B1B', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiAlertCircle size={12} /> OVERDUE
        </span>
      );
    }
    if (status === 'PENDING') {
      return (
        <span style={{ background: '#FEF3C7', color: '#92400E', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiClock size={12} /> PENDING
        </span>
      );
    }
    if (status === 'RECEIVED') {
      return (
        <span style={{ background: '#DCFCE7', color: '#166534', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiCheckCircle size={12} /> COLLECTED
        </span>
      );
    }
    if (status === 'WAIVED') {
      return (
        <span style={{ background: '#F3F4F6', color: '#374151', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <FiXCircle size={12} /> WAIVED
        </span>
      );
    }
    return (
      <span style={{ background: '#F3F4F6', color: '#374151', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
        {status}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
          Post-Disbursement
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiFileText color="#6366F1" size={24} /> PDD Management
            </h1>
            <div style={{ fontSize: 14, color: '#6B7280' }}>
              Document tracking and collection follow-up
            </div>
          </div>
        </div>
      </div>

      {/* Filters & KPIs Row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 280, display: 'flex', alignItems: 'center' }}>
          <FiSearch size={16} color="#9CA3AF" style={{ position: 'absolute', left: 12 }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by customer, Case ID or mobile..."
            style={{
              width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid #D1D5DB',
              fontSize: 14, outline: 'none', boxSizing: 'border-box'
            }}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={kpiCardStyle}>
          <div style={{ ...kpiTopBorder, background: '#6366F1' }} />
          <span style={kpiLabelStyle}>Total PDDs</span>
          <span style={{ ...kpiValueStyle, color: '#111827' }}>{summary.total}</span>
        </div>
        <div style={kpiCardStyle}>
          <div style={{ ...kpiTopBorder, background: '#F59E0B' }} />
          <span style={kpiLabelStyle}>Pending</span>
          <span style={{ ...kpiValueStyle, color: '#D97706' }}>{summary.pending}</span>
        </div>
        <div style={kpiCardStyle}>
          <div style={{ ...kpiTopBorder, background: '#EF4444' }} />
          <span style={kpiLabelStyle}>Overdue</span>
          <span style={{ ...kpiValueStyle, color: '#DC2626' }}>{summary.overdue}</span>
        </div>
        <div style={kpiCardStyle}>
          <div style={{ ...kpiTopBorder, background: '#10B981' }} />
          <span style={kpiLabelStyle}>Collected</span>
          <span style={{ ...kpiValueStyle, color: '#059669' }}>{summary.collected}</span>
        </div>
        <div style={kpiCardStyle}>
          <div style={{ ...kpiTopBorder, background: '#6B7280' }} />
          <span style={kpiLabelStyle}>Waived</span>
          <span style={{ ...kpiValueStyle, color: '#374151' }}>{summary.waived}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        {['ALL', 'PENDING', 'COLLECTED', 'WAIVED'].map(tab => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: isActive ? '#6366F1' : '#fff',
                color: isActive ? '#fff' : '#4B5563',
                border: `1px solid ${isActive ? '#6366F1' : '#D1D5DB'}`,
                padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              {tab === 'ALL' ? 'All Documents' : tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB', color: '#6B7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '16px 24px' }}>Customer Name</th>
              <th style={{ padding: '16px 12px' }}>Mobile</th>
              <th style={{ padding: '16px 12px' }}>Loan Amount</th>
              <th style={{ padding: '16px 12px' }}>Employee / DSA</th>
              <th style={{ padding: '16px 12px', width: '25%' }}>Document Name</th>
              <th style={{ padding: '16px 12px', width: '15%' }}>Due Date</th>
              <th style={{ padding: '16px 12px', width: '15%' }}>Status</th>
              <th style={{ padding: '16px 24px', width: '15%', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>
                  <FiRefreshCw size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 8px' }} />
                  Loading PDDs...
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ padding: '60px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 12, color: '#D1D5DB', display: 'flex', justifyContent: 'center' }}>
                    <FiFileText size={48} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No documents found</div>
                  <div style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>Try adjusting your filters or search term.</div>
                </td>
              </tr>
            ) : (
              Object.values(tasks.reduce((acc, task) => {
                if (!acc[task.case_id]) {
                  acc[task.case_id] = {
                    case_id: task.case_id,
                    case_code: task.case_code,
                    customer_name: task.customer_name,
                    customer_mobile: task.customer_mobile,
                    loan_amount: task.loan_amount,
                    employee_name: task.employee_name,
                    documents: []
                  };
                }
                acc[task.case_id].documents.push(task);
                return acc;
              }, {})).map(c => (
                <tr key={c.case_id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                  <td style={{ padding: '16px 24px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600, color: '#111827' }}>{c.customer_name || 'Unknown Customer'}</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{c.case_code}</div>
                    <div style={{ fontSize: 11, color: '#6366F1', fontWeight: 600, marginTop: 4 }}>
                      {c.documents.length} PDD{c.documents.length !== 1 ? 's' : ''}
                    </div>
                  </td>
                  <td style={{ padding: '16px 12px', verticalAlign: 'top', color: '#4B5563' }}>{c.customer_mobile}</td>
                  <td style={{ padding: '16px 12px', verticalAlign: 'top', color: '#111827', fontWeight: 600 }}>
                    ₹{c.loan_amount?.toLocaleString() || 'N/A'}
                  </td>
                  <td style={{ padding: '16px 12px', verticalAlign: 'top', color: '#4B5563' }}>{c.employee_name}</td>
                  
                  {/* Nested Table for Documents */}
                  <td colSpan={4} style={{ padding: 0, verticalAlign: 'top' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>
                        {c.documents.map((doc, idx) => (
                          <tr key={doc.pdd_task_id} style={{ borderBottom: idx < c.documents.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                            <td style={{ padding: '16px 12px', width: '35.7%', fontWeight: 500, color: '#374151' }}>{doc.document_name}</td>
                            <td style={{ padding: '16px 12px', width: '21.4%', color: '#6B7280', fontSize: 12 }}>
                              {doc.due_date ? format(new Date(doc.due_date), 'dd MMM yyyy') : '-'}
                            </td>
                            <td style={{ padding: '16px 12px', width: '21.4%' }}>
                              {getStatusBadge(doc.status, doc.is_overdue)}
                            </td>
                            <td style={{ padding: '16px 24px', width: '21.5%', textAlign: 'right' }}>
                              <button 
                                onClick={() => openModal(doc)}
                                style={{ ...actionBtn, background: doc.status === 'PENDING' ? '#6366F1' : '#8B5CF6' }}
                              >
                                {doc.status === 'PENDING' ? 'Update' : 'Edit'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div style={modalOverlayStyle} onClick={closeModal}>
          <div style={modalBoxStyle} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiEdit size={18} color="#6366F1" /> Update PDD Status
              </h2>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                <FiX size={20} />
              </button>
            </div>

            <form onSubmit={handleModalSubmit}>
              {/* Info Box */}
              <div style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#3730A3', marginBottom: 8 }}>
                  <span>{selectedTask?.customer_name}</span>
                  <span style={{ background: '#E0E7FF', padding: '2px 8px', borderRadius: 12, fontSize: 11 }}>{selectedTask?.case_code}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: '#4F46E5' }}>Document:</span>
                  <span style={{ fontWeight: 600, color: '#312E81' }}>{selectedTask?.document_name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: '#4F46E5' }}>Loan Amount:</span>
                  <span style={{ fontWeight: 600, color: '#312E81' }}>₹{selectedTask?.loan_amount?.toLocaleString() || 'N/A'}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={labelStyle}>Collection Status <span style={{ color: '#EF4444' }}>*</span></label>
                  <select
                    required
                    value={modalForm.status}
                    onChange={e => setModalForm({ ...modalForm, status: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="PENDING">Pending</option>
                    <option value="COLLECTED">Collected</option>
                    {(user.role === 'DSA_ADMIN' || user.role === 'SUPER_ADMIN') && (
                      <option value="WAIVED">Waived</option>
                    )}
                  </select>
                </div>

                {modalForm.status === 'COLLECTED' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={labelStyle}>Collection Date <span style={{ color: '#EF4444' }}>*</span></label>
                      <input
                        type="date"
                        required
                        value={modalForm.collection_date}
                        onChange={e => setModalForm({ ...modalForm, collection_date: e.target.value })}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Collected By <span style={{ color: '#EF4444' }}>*</span></label>
                      <input
                        type="text"
                        required
                        placeholder="Name of collector"
                        value={modalForm.collected_by}
                        onChange={e => setModalForm({ ...modalForm, collected_by: e.target.value })}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                )}

                {modalForm.status === 'WAIVED' && (
                  <div>
                    <label style={labelStyle}>Waiver Reason <span style={{ color: '#EF4444' }}>*</span></label>
                    <textarea
                      required
                      rows="2"
                      placeholder="Provide reason for waiving..."
                      value={modalForm.waiver_reason}
                      onChange={e => setModalForm({ ...modalForm, waiver_reason: e.target.value })}
                      style={{ ...inputStyle, resize: 'vertical' }}
                    />
                  </div>
                )}

                <div>
                  <label style={labelStyle}>Remarks (Optional)</label>
                  <textarea
                    rows="2"
                    placeholder="Any additional notes..."
                    value={modalForm.remarks}
                    onChange={e => setModalForm({ ...modalForm, remarks: e.target.value })}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, paddingTop: 16, borderTop: '1px solid #E5E7EB' }}>
                <button
                  type="button"
                  onClick={closeModal}
                  style={{ background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, padding: '8px 16px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ background: '#6366F1', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 600, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  disabled={submitting}
                >
                  {submitting ? <FiRefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <FiCheckCircle size={16} />}
                  Save Status
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// Inline Styles to match CustomersListPage.jsx pattern
const kpiCardStyle = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #E5E7EB',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  position: 'relative',
  overflow: 'hidden'
};

const kpiTopBorder = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: 4
};

const kpiLabelStyle = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#6B7280',
  marginBottom: 8,
  marginTop: 4
};

const kpiValueStyle = {
  fontSize: 24,
  fontWeight: 800
};

const actionBtn = {
  color: 'white', border: 'none', borderRadius: 20,
  padding: '4px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  color: '#4B5563',
  marginBottom: 6
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #D1D5DB',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box'
};

const modalOverlayStyle = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(17, 24, 39, 0.6)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16
};

const modalBoxStyle = {
  background: '#fff',
  borderRadius: 16,
  padding: 24,
  width: '100%',
  maxWidth: 480,
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
};
