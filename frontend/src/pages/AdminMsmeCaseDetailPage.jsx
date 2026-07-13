import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axiosInstance';
import toast from 'react-hot-toast';
import { ArrowLeft, FileText, CheckCircle, Clock, Building, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

const AdminMsmeCaseDetailPage = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();

  const [caseData, setCaseData] = useState(null);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);

  // Allocation State
  const [searchDsa, setSearchDsa] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [reason, setReason] = useState('Self-registration - initial allocation');

  useEffect(() => {
    fetchCaseDetail();
    fetchTargets();
  }, [caseId]);

  const fetchCaseDetail = async () => {
    try {
      const res = await api.get(`/admin/msme-cases/${caseId}`);
      setCaseData(res.data);
    } catch (err) {
      toast.error('Failed to load MSME case details');
      navigate('/admin/msme-cases');
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

  const handleAllocate = async () => {
    if (!selectedUser) {
      toast.error('Please select a DSA user');
      return;
    }
    setAllocating(true);
    try {
      await api.post(`/admin/msme-cases/${caseData.id}/allocate`, {
        dsa_tenant_id: selectedUser.tenant_id,
        dsa_user_id: selectedUser.user_id
      });
      toast.success('Case successfully allocated to DSA');
      fetchCaseDetail();
      setSelectedUser(null);
      setSearchDsa('');
    } catch (err) {
      toast.error('Failed to allocate case');
    } finally {
      setAllocating(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading case details...</div>;
  }

  if (!caseData) return null;

  const isAllocated = !!caseData.assigned_dsa_tenant_id;
  const esr = caseData.esrs?.[0];
  const preferredLender = esr?.lenders?.find(l => l.id === caseData.msme_selected_lender_esr_id);

  const allDsaUsers = targets.flatMap(t => 
    t.users.map(u => ({
      tenant_id: t.id,
      tenant_name: t.name,
      user_id: u.id,
      user_name: u.name,
      role: u.role.name
    }))
  );

  const filteredUsers = allDsaUsers.filter(u => 
    u.user_name.toLowerCase().includes(searchDsa.toLowerCase()) || 
    u.tenant_name.toLowerCase().includes(searchDsa.toLowerCase())
  );

  const documents = [
    { name: 'Aadhaar Card', status: 'Uploaded' },
    { name: 'Business Registration', status: 'Uploaded' },
    { name: 'Last 6 Months Bank Statement', status: 'Uploaded' },
    { name: 'ITR — Last 2 Years', status: 'Uploaded' },
    { name: 'GST Returns', status: 'Pending' },
    { name: 'Property Documents', status: 'Pending' },
    { name: 'Photograph', status: 'Uploaded' }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div>
        <button 
          onClick={() => navigate('/admin/msme-cases')} 
          style={{ display: 'flex', alignItems: 'center', fontSize: '13px', fontWeight: 600, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '12px' }}
        >
          <ArrowLeft size={14} style={{ marginRight: '4px' }} /> Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            MSME-{new Date(caseData.created_at).getFullYear()}-{caseData.id.toString().padStart(3, '0')}
          </h1>
          {isAllocated ? (
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '4px 8px', borderRadius: '4px' }}>Allocated</span>
          ) : (
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '4px 8px', borderRadius: '4px' }}>Pending</span>
          )}
        </div>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>
          {caseData.customer?.industry || 'Unspecified Industry'} · {caseData.product_type || 'N/A'} · 
          {caseData.loan_amount ? `₹${caseData.loan_amount.toLocaleString()}` : 'N/A'} · 
          Registered {format(new Date(caseData.created_at), 'MMM d, yyyy')}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left Column */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} color="var(--text-tertiary)" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Proposal Details</h3>
          </div>
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>MSME Reference ID</span>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>MSME-{new Date(caseData.created_at).getFullYear()}-{caseData.id.toString().padStart(3, '0')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Business Category</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{caseData.customer?.industry || 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Constitution</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{caseData.customer?.entity_type || 'Proprietorship'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Loan Type</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{caseData.product_type === 'HL' ? 'Home Loan (HL)' : caseData.product_type === 'LAP' ? 'Loan Against Property (LAP)' : caseData.product_type}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Loan Amount Requested</span>
                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--primary)' }}>₹{caseData.loan_amount?.toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Property Type</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Residential — Self Occupied</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Property Location</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Mumbai — Western Suburbs</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Income Scheme</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Salaried / Self-Employed</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Preferred Lender</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{preferredLender?.lender_name || 'No Preference'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Registered On</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{format(new Date(caseData.created_at), 'MMM d, yyyy · h:mm a')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Onboarding Fee Paid</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '4px 8px', borderRadius: '4px' }}>₹{caseData.case_payment?.amount_inr || 1000} ✓</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} color="var(--text-tertiary)" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Uploaded Documents</h3>
          </div>
          <div style={{ padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ background: '#fff', borderBottom: '1px solid var(--border)' }}>
                <tr>
                  <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Document</th>
                  <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '16px 24px', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{doc.name}</td>
                    <td style={{ padding: '16px 24px' }}>
                      {doc.status === 'Uploaded' ? (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)' }}>Uploaded</span>
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--warning)' }}>Pending</span>
                      )}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <button style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>
                        <ExternalLink size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* DSA Allocation Section */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Building size={18} color="var(--primary)" />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>DSA Allocation</h3>
          </div>
          {isAllocated ? (
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '4px 8px', borderRadius: '4px', border: '1px solid #A7F3D0' }}>Allocated</span>
          ) : (
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '4px 8px', borderRadius: '4px', border: '1px solid #FDE68A' }}>Unallocated</span>
          )}
        </div>
        <div style={{ padding: '24px' }}>
          {!isAllocated ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '24px' }}>
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>Search & Select DSA</label>
                <input
                  type="text"
                  placeholder="Type DSA name or code..."
                  value={searchDsa}
                  onChange={(e) => { setSearchDsa(e.target.value); setSelectedUser(null); }}
                  style={{ width: '100%', padding: '10px 16px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', outline: 'none' }}
                />
                {searchDsa && !selectedUser && (
                  <div style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: '4px', background: '#fff', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-lg)', maxHeight: '240px', overflowY: 'auto' }}>
                    {filteredUsers.map(u => (
                      <div 
                        key={u.user_id} 
                        style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => { setSelectedUser(u); setSearchDsa(''); }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-base)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{u.tenant_name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Agent: {u.user_name} ({u.role})</div>
                      </div>
                    ))}
                    {filteredUsers.length === 0 && (
                      <div style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-tertiary)' }}>No matching DSA found</div>
                    )}
                  </div>
                )}
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>Selected DSA</label>
                <div style={{ width: '100%', padding: '10px 16px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', background: 'var(--bg-base)', color: 'var(--text-secondary)', height: '42px', display: 'flex', alignItems: 'center' }}>
                  {selectedUser ? <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{selectedUser.tenant_name} ({selectedUser.user_name})</span> : 'No DSA selected'}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>Reason for Allocation</label>
                <select 
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ width: '100%', padding: '10px 16px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', outline: 'none', background: '#fff', height: '42px' }}
                >
                  <option value="Self-registration - initial allocation">Self-registration - initial allocation</option>
                  <option value="Specialized expertise required">Specialized expertise required</option>
                  <option value="Geographic matching">Geographic matching</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          ) : (
            <div style={{ background: 'var(--primary-subtle)', borderRadius: '8px', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', border: '1px solid var(--primary-light)' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary-dark)', marginBottom: '4px' }}>Currently Allocated To</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>{caseData.assigned_dsa_user?.name}</div>
                <div style={{ fontSize: '13px', color: 'var(--primary-dark)', marginTop: '4px' }}>Allocated on {format(new Date(caseData.allocated_at), 'MMM d, yyyy')}</div>
              </div>
              <button 
                onClick={() => toast.error('Re-allocation feature coming in Phase 3')}
                style={{ background: '#fff', color: 'var(--primary)', border: '1px solid var(--primary-light)', padding: '10px 20px', borderRadius: '8px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
              >
                Re-Allocate Case
              </button>
            </div>
          )}

          {!isAllocated && (
            <button
              onClick={handleAllocate}
              disabled={allocating || !selectedUser}
              className="btn-primary"
              style={{ padding: '12px 24px', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '250px', opacity: allocating || !selectedUser ? 0.5 : 1 }}
            >
              {allocating ? 'Allocating...' : <><CheckCircle size={16} /> Confirm Allocation</>}
            </button>
          )}
        </div>
      </div>

      {/* Allocation History */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Clock size={18} color="var(--text-tertiary)" />
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Allocation History</h3>
        </div>
        <div style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ background: '#fff', borderBottom: '1px solid var(--border)' }}>
              <tr>
                <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Date & Time</th>
                <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Action</th>
                <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>DSA Assigned</th>
                <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Reason</th>
                <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Done By</th>
              </tr>
            </thead>
            <tbody>
              {isAllocated ? (
                <tr style={{ background: '#fff' }}>
                  <td style={{ padding: '16px 24px', fontSize: '14px', color: 'var(--text-primary)' }}>{format(new Date(caseData.allocated_at), 'MMM d, yyyy h:mm a')}</td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', fontWeight: 700, color: 'var(--primary)' }}>Initial Allocation</td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{caseData.assigned_dsa_user?.name}</td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', color: 'var(--text-secondary)' }}>Self-registration</td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', color: 'var(--text-primary)' }}>Super Admin</td>
                </tr>
              ) : (
                <tr>
                  <td colSpan="5" style={{ padding: '40px', textAlign: 'center', fontSize: '14px', color: 'var(--text-secondary)' }}>No allocation history yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminMsmeCaseDetailPage;
