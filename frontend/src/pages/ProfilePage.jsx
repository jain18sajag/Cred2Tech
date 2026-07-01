import React, { useEffect, useState } from 'react';
import { User, Mail, Phone, Shield, Building2, Layers, GitBranch, Calendar, Key, Activity, Edit, X } from 'lucide-react';
import { getMe } from '../api/authService';
import { updateTenant } from '../api/tenantService';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { formatDateTime, getInitials, formatHierarchyPath } from '../utils/helpers';

const InfoRow = ({ icon: Icon, label, value, mono = false }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '13px 0', borderBottom: '1px solid var(--border)' }}>
    <div style={{ width: 34, height: 34, borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon size={16} color="var(--text-tertiary)" />
    </div>
    <div style={{ flex: 1 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 14, color: value ? 'var(--text-primary)' : 'var(--text-tertiary)', fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 500 }}>
        {value || '—'}
      </p>
    </div>
  </div>
);

const SectionCard = ({ title, children }) => (
  <div className="card card-padded" style={{ marginBottom: 20 }}>
    <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{title}</h3>
    <div style={{ marginTop: 8 }}>{children}</div>
  </div>
);

const ProfilePage = () => {
  const { user: authUser, token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Edit Organization State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTenantData, setEditTenantData] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState('');

  const fetchProfile = async () => {
    try {
      const data = await getMe();
      setProfile(data.user || data);
    } catch {
      setProfile(authUser); // fallback to context data
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [authUser]);

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsEditing(true);
    setEditError('');
    try {
      await updateTenant(editTenantData.id, editTenantData);
      setShowEditModal(false);
      setEditTenantData(null);
      await fetchProfile(); // refresh data
    } catch (err) {
      setEditError(err?.response?.data?.error || 'Failed to update organization details.');
    } finally {
      setIsEditing(false);
    }
  };

  if (loading) return <LoadingSpinner fullPage />;

  const u = profile || authUser;
  if (!u) return null;

  return (
    <div>
      <PageHeader
        title="My Profile"
        subtitle="Your account details and session information"
        breadcrumbs={[{ label: 'Dashboard', path: '/' }, { label: 'My Profile' }]}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>
        {/* Profile card */}
        <div className="card card-padded" style={{ textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary), var(--primary-light))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 800, color: 'white',
            margin: '0 auto 16px',
            boxShadow: '0 8px 24px rgba(79,70,229,0.3)',
          }}>
            {getInitials(u.name)}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{u.name}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 14 }}>{u.email}</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge type="role" value={u.role?.name} />
            <Badge type="status" value={u.status} />
          </div>

          {u.hierarchy_level && (
            <div style={{ marginTop: 14 }}>
              <Badge type="level" value={u.hierarchy_level} />
            </div>
          )}

          <div style={{ marginTop: 20, padding: '12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-tertiary)' }}>
            <p><strong style={{ color: 'var(--text-secondary)' }}>User ID:</strong> #{u.id}</p>
            <p style={{ marginTop: 4 }}><strong style={{ color: 'var(--text-secondary)' }}>Member since:</strong><br />{formatDateTime(u.created_at)}</p>
          </div>
        </div>

        {/* Details */}
        <div>
          <SectionCard title="Basic Information">
            <InfoRow icon={User} label="Full Name" value={u.name} />
            <InfoRow icon={Mail} label="Email Address" value={u.email} />
            <InfoRow icon={Phone} label="Mobile" value={u.mobile} />
            <InfoRow icon={Activity} label="Account Status" value={u.status} />
          </SectionCard>

          <SectionCard title="Role & Access">
            <InfoRow icon={Shield} label="Platform Role" value={u.role?.name} />
            <InfoRow icon={User} label="Role ID" value={u.role_id?.toString()} />
          </SectionCard>

          <SectionCard title="Hierarchy & Organization">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12, marginTop: -32 }}>
              {u.role?.name === 'DSA_ADMIN' && u.tenant && (
                <button 
                  className="btn btn-outline btn-sm" 
                  onClick={() => {
                    setEditTenantData(u.tenant);
                    setShowEditModal(true);
                  }}
                >
                  <Edit size={14} style={{ marginRight: 4 }} /> Edit Organization
                </button>
              )}
            </div>
            <InfoRow icon={Building2} label="DSA Organization" value={u.tenant?.name || u.dsa?.name} />
            <InfoRow icon={Layers} label="Hierarchy Level" value={u.hierarchy_level} />
            <InfoRow icon={GitBranch} label="Hierarchy Path" value={formatHierarchyPath(u.hierarchy_path)} />
            <InfoRow icon={User} label="Manager ID" value={u.manager_id?.toString()} />
          </SectionCard>

          <SectionCard title="Session Information">
            <InfoRow icon={Calendar} label="Account Created" value={formatDateTime(u.created_at)} />
            <InfoRow icon={Key} label="Active Session Token (truncated)" value={token ? `${token.slice(0, 40)}…` : '—'} mono />
          </SectionCard>
        </div>
      </div>

      {/* Edit Organization Modal */}
      {showEditModal && editTenantData && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3 className="modal-title"><Edit size={16} /> Edit Organization ({editTenantData.name})</h3>
              <button className="icon-btn" onClick={() => setShowEditModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              {editError && <div className="notice notice-error" style={{ marginBottom: 16 }}>{editError}</div>}
              <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="form-label">Organization Name</label>
                  <input type="text" className="form-control" required value={editTenantData.name || ''} onChange={e => setEditTenantData({ ...editTenantData, name: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">Contact Mobile</label>
                  <input type="text" className="form-control" value={editTenantData.mobile || ''} onChange={e => setEditTenantData({ ...editTenantData, mobile: e.target.value })} />
                </div>
                <div>
                  <label className="form-label">PAN Number</label>
                  <input type="text" className="form-control" value={editTenantData.pan_number || ''} onChange={e => setEditTenantData({ ...editTenantData, pan_number: e.target.value })} style={{ textTransform: 'uppercase' }} />
                </div>
                <div>
                  <label className="form-label">GST Number</label>
                  <input type="text" className="form-control" value={editTenantData.gst_number || ''} onChange={e => setEditTenantData({ ...editTenantData, gst_number: e.target.value })} style={{ textTransform: 'uppercase' }} />
                </div>
                <div>
                  <label className="form-label">Company Type</label>
                  <select className="form-control" value={editTenantData.company_type || ''} onChange={e => setEditTenantData({ ...editTenantData, company_type: e.target.value })}>
                    <option value="">Select Company Type</option>
                    <option value="Proprietorship">Proprietorship</option>
                    <option value="Partnership">Partnership</option>
                    <option value="Private Limited">Private Limited</option>
                    <option value="Public Limited">Public Limited</option>
                    <option value="LLP">LLP</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">City</label>
                    <input type="text" className="form-control" value={editTenantData.city || ''} onChange={e => setEditTenantData({ ...editTenantData, city: e.target.value })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="form-label">State</label>
                    <input type="text" className="form-control" value={editTenantData.state || ''} onChange={e => setEditTenantData({ ...editTenantData, state: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Pincode</label>
                  <input type="text" className="form-control" value={editTenantData.pincode || ''} onChange={e => setEditTenantData({ ...editTenantData, pincode: e.target.value })} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                  <button type="button" className="btn btn-outline" onClick={() => setShowEditModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={isEditing}>{isEditing ? 'Saving...' : 'Save Changes'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ProfilePage;
