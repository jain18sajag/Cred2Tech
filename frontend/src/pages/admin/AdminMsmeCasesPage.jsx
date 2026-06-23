import React, { useState, useEffect } from 'react';
import api from '../api/axiosInstance';
import toast from 'react-hot-toast';
import { Loader2, Users, CalendarDays } from 'lucide-react';
import { format } from 'date-fns';
import '../styles/msme-theme.css'; // Import the scoped stylesheet

const AdminMsmeCasesPage = () => {
  const [cases, setCases] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);

  // Allocation Modal State
  const [showModal, setShowModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedUser, setSelectedUser] = useState('');

  useEffect(() => {
    fetchCases();
    fetchTargets();
  }, []);

  const fetchCases = async () => {
    try {
      const res = await api.get('/admin/msme-cases');
      setCases(res.data);
    } catch (err) {
      toast.error('Failed to load MSME cases');
    } finally {
      setLoading(false);
    }
  };

  const fetchTargets = async () => {
    try {
      const res = await api.get('/admin/msme-cases/allocation-targets');
      setTargets(res.data);
    } catch (err) {
      console.error('Failed to fetch allocation targets', err);
    }
  };

  const openAllocateModal = (c) => {
    setSelectedCase(c);
    setSelectedTenant('');
    setSelectedUser('');
    setShowModal(true);
  };

  const handleAllocate = async () => {
    if (!selectedTenant || !selectedUser) {
      toast.error('Please select a DSA and a user');
      return;
    }
    setAllocating(true);
    try {
      await api.post(`/admin/msme-cases/${selectedCase.id}/allocate`, {
        dsa_tenant_id: selectedTenant,
        dsa_user_id: selectedUser
      });
      toast.success('Case successfully allocated to DSA');
      setShowModal(false);
      fetchCases();
    } catch (err) {
      toast.error('Failed to allocate case');
    } finally {
      setAllocating(false);
    }
  };

  const availableUsers = targets.find(t => t.id === parseInt(selectedTenant))?.users || [];

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--mid)' }}>Loading MSME cases...</div>;

  return (
    <div className="msme-portal" style={{ background: 'transparent' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Users style={{ width: '24px', height: '24px', color: 'var(--accent)' }} />
          Direct MSME Leads
        </h1>
        <p style={{ color: 'var(--mid)', fontSize: '14px', marginTop: '4px' }}>Manage and allocate self-onboarded MSME customers to DSA partners.</p>
      </div>

      <div className="msme-table-wrapper">
        <table className="msme-table">
          <thead>
            <tr>
              <th>Business</th>
              <th>Requested Loan</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Allocation</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr><td colSpan="6" style={{ textAlign: 'center', color: 'var(--light)', padding: '40px' }}>No Direct MSME cases found.</td></tr>
            )}
            {cases.map(c => (
              <tr key={c.id}>
                <td>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>{c.customer?.business_name || 'N/A'}</div>
                  <div style={{ fontSize: '12px', color: 'var(--mid)' }}>PAN: {c.customer?.business_pan}</div>
                  <div style={{ fontSize: '12px', color: 'var(--light)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CalendarDays style={{ width: '12px', height: '12px' }} /> {format(new Date(c.created_at), 'MMM dd, yyyy')}
                  </div>
                </td>
                <td>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text)' }}>
                    {c.loan_amount ? `₹${c.loan_amount.toLocaleString()}` : 'Not Specified'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--mid)' }}>{c.product_type}</div>
                </td>
                <td>
                  <span className={`badge-status ${c.stage === 'ESR_GENERATED' ? 'active' : ''}`} style={c.stage === 'LEAD_CREATED' ? { background: 'var(--warn-dim)', color: '#7A4800' } : {}}>
                    {c.stage}
                  </span>
                </td>
                <td>
                  {c.case_payment ? (
                    <span className="badge-status success">Paid</span>
                  ) : (
                    <span className="badge-status">Pending</span>
                  )}
                </td>
                <td>
                  {c.assigned_dsa_tenant_id ? (
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text)' }}>{c.assigned_dsa_user?.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--light)' }}>Allocated on {c.allocated_at ? format(new Date(c.allocated_at), 'MMM dd') : ''}</div>
                    </div>
                  ) : (
                    <span className="badge-status" style={{ background: 'var(--warn-dim)', color: '#7A4800' }}>Unallocated</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {c.stage === 'LEAD_CREATED' && !c.assigned_dsa_tenant_id && (
                    <button
                      onClick={() => openAllocateModal(c)}
                      className="btn-ghost"
                    >
                      Allocate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,37,64,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
          <div className="msme-card" style={{ width: '100%', maxWidth: '440px', margin: 0 }}>
            <div className="msme-card-header">
              <h3>Allocate Case to DSA</h3>
              <button onClick={() => setShowModal(false)} className="btn-ghost" style={{ color: 'var(--light)' }}>×</button>
            </div>
            <div className="msme-card-body">
              <div className="form-group">
                <label>Select DSA Partner</label>
                <select 
                  value={selectedTenant} 
                  onChange={(e) => { setSelectedTenant(e.target.value); setSelectedUser(''); }}
                >
                  <option value="">-- Select DSA --</option>
                  {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {selectedTenant && (
                <div className="form-group">
                  <label>Select DSA Agent</label>
                  <select 
                    value={selectedUser} 
                    onChange={(e) => setSelectedUser(e.target.value)}
                  >
                    <option value="">-- Select User --</option>
                    {availableUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role.name})</option>)}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', paddingTop: '16px' }}>
                <button 
                  onClick={() => setShowModal(false)}
                  className="btn-outline"
                  style={{ flex: 1, textAlign: 'center' }}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAllocate}
                  disabled={allocating || !selectedTenant || !selectedUser}
                  className="btn-primary"
                  style={{ flex: 1, padding: '12px' }}
                >
                  {allocating ? 'Allocating...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMsmeCasesPage;
