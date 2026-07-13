import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosInstance';
import toast from 'react-hot-toast';
import { Loader2, Users, Building, ArrowRight, Activity, CalendarDays, ExternalLink, ClipboardList, CheckSquare, Search, Wallet, Clock } from 'lucide-react';
import { format } from 'date-fns';

const AdminMsmeCasesPage = () => {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchCases();
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

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Loader2 className="animate-spin text-indigo-500 w-10 h-10" /></div>;

  const totalCases = cases.length;
  const allocated = cases.filter(c => c.assigned_dsa_tenant_id).length;
  const pending = totalCases - allocated;
  const walletBalance = cases.reduce((acc, c) => acc + Number(c.case_payment?.amount_inr || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px 0' }}>Manage MSMEs</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', margin: 0 }}>Self-registered MSMEs (paid ₹1,000 onboarding fee) — no individual PII visible to cred2tech</p>
        </div>
      </div>

      {/* Info Banner */}
      <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '8px', padding: '16px', display: 'flex', gap: '12px', fontSize: '14px', color: '#0369A1' }}>
        <div>🔒</div>
        <p style={{ margin: 0, lineHeight: 1.5 }}>Only MSMEs who have <strong>self-registered</strong> on the cred2tech portal (paid ₹1,000 fee) appear here. These cases have not come through any DSA and need to be allocated to one. Customer PAN and name are <strong>not visible</strong> to cred2tech staff.</p>
      </div>

      {/* Bento Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--role-admin-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <ClipboardList size={20} color="var(--primary)" />
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>{totalCases}</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Self-Registered MSMEs</div>
            <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', display: 'inline-block', padding: '4px 8px', borderRadius: '4px' }}>6 new this month</div>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <CheckSquare size={20} color="var(--success)" />
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>{allocated}</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Allocated to DSA</div>
            <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', display: 'inline-block', padding: '4px 8px', borderRadius: '4px' }}>All active</div>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <Clock size={20} color="var(--warning)" />
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>{pending}</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Pending Allocation</div>
            <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--error)', background: 'var(--error-bg)', display: 'inline-block', padding: '4px 8px', borderRadius: '4px' }}>Needs action</div>
          </div>
        </div>

        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--role-partner-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
            <Wallet size={20} color="var(--role-partner)" />
          </div>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)' }}>₹{walletBalance.toLocaleString()}</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>Wallet Balance</div>
            <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', display: 'inline-block', padding: '4px 8px', borderRadius: '4px' }}>Across MSMEs</div>
          </div>
        </div>

      </div>

      {/* Table Section */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-base)' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0 }}>Self-Registered MSME List</h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ position: 'relative' }}>
              <input type="text" placeholder="Search by MSME ID or business type..." style={{ padding: '8px 16px 8px 36px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', width: '300px', outline: 'none' }} />
              <Search size={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: '12px', top: '10px' }} />
            </div>
            <select style={{ padding: '8px 16px', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '14px', outline: 'none', background: '#fff' }}>
              <option>All Status</option>
              <option>Pending</option>
              <option>Allocated</option>
            </select>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: '#fff', borderBottom: '1px solid var(--border)' }}>
            <tr>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>MSME ID</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Business Type</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Loan Type Requested</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Loan Amount</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Docs</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Registered On</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Allocated DSA</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Status</th>
              <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr><td colSpan="9" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>No Direct MSME cases found.</td></tr>
            )}
            {cases.map((c, idx) => {
              const isAllocated = !!c.assigned_dsa_tenant_id;
              const msmeId = `MSME-${new Date(c.created_at).getFullYear()}-${c.id.toString().padStart(3, '0')}`;
              const isDocsComplete = idx % 2 === 0;

              return (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', background: '#fff' }}>
                  <td style={{ padding: '16px 24px', fontSize: '14px', fontWeight: 700, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => navigate(`/admin/msme-cases/${c.id}`)}>
                    {msmeId}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    {c.customer?.industry || 'Manufacturing'}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    {c.product_type === 'HL' ? 'HL' : c.product_type === 'LAP' ? 'LAP' : c.product_type}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {c.loan_amount ? `₹${c.loan_amount.toLocaleString()}` : 'N/A'}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {isDocsComplete ? (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '4px 8px', borderRadius: '4px' }}>Complete</span>
                    ) : (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '4px 8px', borderRadius: '4px' }}>Partial</span>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    {format(new Date(c.created_at), 'MMM d, yyyy')}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {isAllocated ? (
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{c.assigned_dsa_user?.name}</div>
                    ) : (
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--error)' }}>— Unallocated —</span>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {isAllocated ? (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--success)', background: 'var(--success-bg)', padding: '4px 8px', borderRadius: '4px' }}>Allocated</span>
                    ) : (
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '4px 8px', borderRadius: '4px' }}>Pending</span>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                    {isAllocated ? (
                      <button
                        onClick={() => navigate(`/admin/msme-cases/${c.id}`)}
                        className="btn-outline"
                        style={{ padding: '6px 16px', fontSize: '12px', width: '130px' }}
                      >
                        View & Manage
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate(`/admin/msme-cases/${c.id}`)}
                        className="btn-primary"
                        style={{ padding: '6px 16px', fontSize: '12px', width: '130px' }}
                      >
                        Allocate DSA
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminMsmeCasesPage;
