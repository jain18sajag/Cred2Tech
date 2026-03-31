import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SlidersHorizontal, Eye, Edit, Building, RefreshCw } from 'lucide-react';
import { getTenants } from '../api/tenantService';
import { MOCK_TENANTS } from '../constants/mockData';
import { STATUS_OPTIONS } from '../constants/roles';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { formatDate } from '../utils/helpers';

const TenantsListPage = () => {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const fetchTenants = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getTenants();
      setTenants(Array.isArray(data) ? data : data.tenants || MOCK_TENANTS);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load tenants. Showing demo data.');
      setTenants(MOCK_TENANTS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTenants(); }, []);

  const filtered = useMemo(() => {
    return tenants.filter((t) => {
      const q = search.toLowerCase();
      const matchSearch = !q || String(t.name).toLowerCase().includes(q) || String(t.id).toLowerCase().includes(q);
      const matchType = !filterType || t.type === filterType;
      const matchStatus = !filterStatus || t.status === filterStatus;
      return matchSearch && matchType && matchStatus;
    });
  }, [tenants, search, filterType, filterStatus]);

  const SelectFilter = ({ value, onChange, options, placeholder }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="form-control" style={{ width: 'auto', minWidth: 130 }}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
  );

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle={`${filtered.length} tenant${filtered.length !== 1 ? 's' : ''} in the platform`}
        breadcrumbs={[{ label: 'Dashboard', path: '/' }, { label: 'Tenants' }]}
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/tenants/create')}>
            <Building size={15} /> Create Tenant
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
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SlidersHorizontal size={15} color="var(--text-tertiary)" />
            <SelectFilter value={filterType} onChange={setFilterType} options={['DSA', 'INTERNAL']} placeholder="All Types" />
            <SelectFilter value={filterStatus} onChange={setFilterStatus} options={STATUS_OPTIONS} placeholder="All Status" />
            {(search || filterType || filterStatus) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterType(''); setFilterStatus(''); }}>
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
            title="No tenants found"
            description="Try adjusting your search or filters, or create a new tenant."
            action={<button className="btn btn-primary btn-sm" onClick={() => navigate('/tenants/create')}><Building size={14} /> Create Tenant</button>}
          />
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Tenant ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '6px', background: 'var(--primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}>
                        <Building size={16} />
                      </div>
                      <div>
                        <p style={{ fontWeight: 500, fontSize: 14 }}>{t.name}</p>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t.id}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t.type}</td>
                  <td><Badge type="status" value={t.status} /></td>
                  <td style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{formatDate(t.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-icon" title="View" onClick={() => navigate(`/tenants/${t.id}`)} disabled>
                        <Eye size={15} color="var(--text-secondary)" style={{ opacity: 0.5 }} />
                      </button>
                      <button className="btn btn-ghost btn-icon" title="Edit (coming soon)" disabled>
                        <Edit size={15} color="var(--text-secondary)" style={{ opacity: 0.5 }} />
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

export default TenantsListPage;
