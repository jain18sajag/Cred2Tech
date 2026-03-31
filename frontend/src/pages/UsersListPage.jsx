import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, Eye, Edit, Trash2, UserPlus, RefreshCw } from 'lucide-react';
import { getUsers } from '../api/userService';
import { MOCK_USERS } from '../constants/mockData';
import { ROLE_OPTIONS, STATUS_OPTIONS } from '../constants/roles';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { formatDate, getInitials } from '../utils/helpers';

const UsersListPage = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterLevel, setFilterLevel] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getUsers();
      setUsers(Array.isArray(data) ? data : data.users || MOCK_USERS);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load users. Showing demo data.');
      setUsers(MOCK_USERS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const q = search.toLowerCase();
      const matchSearch = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.mobile?.includes(q);
      const matchRole = !filterRole || u.role?.name === filterRole;
      const matchStatus = !filterStatus || u.status === filterStatus;
      const matchLevel = !filterLevel || u.hierarchy_level === filterLevel;
      return matchSearch && matchRole && matchStatus && matchLevel;
    });
  }, [users, search, filterRole, filterStatus, filterLevel]);

  const SelectFilter = ({ value, onChange, options, placeholder }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="form-control" style={{ width: 'auto', minWidth: 130 }}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
  );

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${filtered.length} user${filtered.length !== 1 ? 's' : ''} in your access scope`}
        breadcrumbs={[{ label: 'Dashboard', path: '/' }, { label: 'Users' }]}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/users/create')}>
            <UserPlus size={15} /> Create User
          </button>
        }
      />

      {error && (
        <div className="notice notice-warning" style={{ marginBottom: 20 }}>
          <RefreshCw size={15} />
          <span>{error}</span>
        </div>
      )}

      {/* Filters */}
      <div className="card card-padded" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              className="form-control"
              placeholder="Search by name, email, or mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SlidersHorizontal size={15} color="var(--text-tertiary)" />
            <SelectFilter value={filterRole} onChange={setFilterRole} options={ROLE_OPTIONS} placeholder="All Roles" />
            <SelectFilter value={filterStatus} onChange={setFilterStatus} options={STATUS_OPTIONS} placeholder="All Status" />
            <SelectFilter value={filterLevel} onChange={setFilterLevel} options={['L1','L2','L3','L4']} placeholder="All Levels" />
            {(search || filterRole || filterStatus || filterLevel) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterRole(''); setFilterStatus(''); setFilterLevel(''); }}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card" style={{ padding: 48 }}><LoadingSpinner fullPage /></div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No users found"
            description="Try adjusting your search or filters, or create a new user."
            action={<button className="btn btn-primary btn-sm" onClick={() => navigate('/users/create')}><UserPlus size={14} /> Create User</button>}
          />
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Mobile</th>
                <th>Role</th>
                <th>Tenant ID</th>
                <th>Tenant Type</th>
                <th>Level</th>
                <th>Manager</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>
                        {getInitials(u.name)}
                      </div>
                      <div>
                        <p style={{ fontWeight: 500, fontSize: 14 }}>{u.name}</p>
                        <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{u.mobile || '—'}</td>
                  <td><Badge type="role" value={u.role?.name} /></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{u.tenant_id || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{u.tenant?.type || '—'}</td>
                  <td>{u.hierarchy_level ? <Badge type="level" value={u.hierarchy_level} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{u.manager_id || '—'}</td>
                  <td><Badge type="status" value={u.status} /></td>
                  <td style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{formatDate(u.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-icon" title="View" onClick={() => navigate(`/users/${u.id}`)}>
                        <Eye size={15} color="var(--primary)" />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Edit (coming soon)" onClick={() => navigate(`/users/${u.id}/edit`)} style={{ opacity: 0.5 }}>
                        <Edit size={15} color="var(--text-secondary)" />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Delete (coming soon)" onClick={() => navigate(`/users/${u.id}/edit`)} style={{ opacity: 0.5 }}>
                        <Trash2 size={15} color="var(--error)" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UsersListPage;
