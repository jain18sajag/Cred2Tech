import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { caseService } from '../api/caseService';
import { toast } from 'react-hot-toast';
import { Search, ChevronDown, AlertTriangle, Plus, MoreHorizontal, FileSpreadsheet, Upload } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';

import CustomerTypeModal from '../components/customers/CustomerTypeModal';
import BulkUploadModal from '../components/customers/BulkUploadModal';

const STAGE_MAPPING = {
  'All': 'All',
  'Lead Created': 'LEAD_CREATED',
  'Lead Sent': 'LEAD_SENT_TO_LENDER',
  'Data Pulled': 'DATA_COLLECTION',
  'Login Done': 'ESR_GENERATED',
  'Sanctioned': 'APPROVED',
  'Part Disbursed': 'PARTLY_DISBURSED',
  'Disbursed': 'DISBURSED',
  'Closed': 'CLOSED',
  'Rejected': 'REJECTED'
};

const STAGE_COLORS = {
  'LEAD_CREATED': { bg: '#FEF3C7', text: '#92400E' },
  'DATA_COLLECTION': { bg: '#E0F2FE', text: '#0369A1' },
  'LEAD_SENT_TO_LENDER': { bg: '#F3E8FF', text: '#6B21A8' },
  'ESR_GENERATED': { bg: '#FFEDD5', text: '#C2410C' },
  'APPROVED': { bg: '#D1FAE5', text: '#065F46' },
  'DISBURSED': { bg: '#DCFCE7', text: '#166534' },
  'PARTLY_DISBURSED': { bg: '#D1FAE5', text: '#065F46' },
  'CLOSED': { bg: '#F3F4F6', text: '#374151' },
  'REJECTED': { bg: '#FEE2E2', text: '#991B1B' },
  'DRAFT': { bg: '#F3F4F6', text: '#6B7280' }
};

const STAGE_LABELS = {
  'LEAD_CREATED': 'Lead Created',
  'DATA_COLLECTION': 'Data Pulled',
  'LEAD_SENT_TO_LENDER': 'Lead Sent',
  'ESR_GENERATED': 'Login Done',
  'APPROVED': 'Sanctioned',
  'DISBURSED': 'Disbursed',
  'PARTLY_DISBURSED': 'Partly Disbursed',
  'CLOSED': 'Closed',
  'REJECTED': 'Rejected',
  'DRAFT': 'Draft'
};

const ENTITY_TYPES = ['All Entity Types', 'Partnership', 'Pvt Ltd', 'LLP', 'Proprietorship', 'Public Ltd'];
const ALERT_TYPES = ['All Alerts', 'PDD_PENDING'];
const SORT_OPTIONS = [
  { label: 'Newest First', by: 'lead_date', order: 'desc' },
  { label: 'Oldest First', by: 'lead_date', order: 'asc' },
  { label: 'Name A-Z', by: 'name', order: 'asc' },
  { label: 'CIBIL (High-Low)', by: 'cibil_score', order: 'desc' },
  { label: 'Amount (High-Low)', by: 'loan_amount', order: 'desc' }
];

export default function CustomersListPage() {
  const navigate = useNavigate();

  // Data states
  const [cases, setCases] = useState([]);
  const [stats, setStats] = useState({ totalCases: 0, totalCustomers: 0 });
  const [loading, setLoading] = useState(true);

  // Filter states
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [activeTab, setActiveTab] = useState('All');
  const [entityType, setEntityType] = useState('All Entity Types');
  const [lender, setLender] = useState('All Lenders');
  const [alertFilter, setAlertFilter] = useState('All Alerts');
  const [sortIndex, setSortIndex] = useState(0);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const LIMIT = 10;

  const fetchPipeline = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        search,
        stage: STAGE_MAPPING[activeTab] || 'All',
        entity_type: entityType,
        lender,
        alert: alertFilter,
        sort_by: SORT_OPTIONS[sortIndex].by,
        sort_order: SORT_OPTIONS[sortIndex].order,
        page,
        limit: LIMIT
      };

      const data = await caseService.getPipeline(params);
      setCases(data.cases);
      setStats({ totalCases: data.total_cases, totalCustomers: data.total_customers });
      setTotalPages(data.total_pages);
    } catch (error) {
      toast.error('Failed to load pipeline data');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [search, activeTab, entityType, lender, alertFilter, sortIndex, page]);

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setPage(1);
  };

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const formatCurrency = (val) => {
    if (!val) return '-';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    return `₹${val.toLocaleString('en-IN')}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateStr));
  };

  const formatRelative = (dateStr) => {
    if (!dateStr) return '-';
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true }).replace('about ', '');
  };

  const getCibilColor = (score) => {
    if (!score) return '#9CA3AF';
    if (score >= 700) return '#10B981'; // Green
    if (score >= 650) return '#F59E0B'; // Yellow
    return '#EF4444'; // Red
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>
          Customers
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0, marginBottom: 4 }}>
              My Pipeline
            </h1>
            <div style={{ fontSize: 14, color: '#6B7280' }}>
              {stats.totalCases} active cases · {stats.totalCustomers} customers
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => setIsBulkUploadModalOpen(true)}
              style={{
                background: '#fff', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 20,
                padding: '8px 16px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                cursor: 'pointer'
              }}
            >
              <Upload size={16} color="#4F46E5" /> Bulk Upload
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              style={{
                background: '#6366F1', color: 'white', border: 'none', borderRadius: 20,
                padding: '8px 16px', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                cursor: 'pointer'
              }}
            >
              <Plus size={16} /> Add Customer
            </button>
          </div>
        </div>
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 280 }}>
          <Search size={16} color="#9CA3AF" style={{ position: 'absolute', left: 12, top: 10 }} />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, Case ID, lender, PAN..."
            style={{
              width: '100%', padding: '8px 12px 8px 36px', borderRadius: 8, border: '1px solid #D1D5DB',
              fontSize: 14, outline: 'none', boxSizing: 'border-box'
            }}
          />
        </div>

        <select value={entityType} onChange={handleFilterChange(setEntityType)} style={selectStyle}>
          {ENTITY_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>

        <select value={lender} onChange={handleFilterChange(setLender)} style={selectStyle}>
          <option value="All Lenders">All Lenders</option>
          <option value="HDFC Bank">HDFC Bank</option>
          <option value="ICICI Bank">ICICI Bank</option>
          <option value="Axis Bank">Axis Bank</option>
          <option value="Kotak Mahindra">Kotak Mahindra</option>
          <option value="SBI">SBI</option>
          <option value="IDFC First">IDFC First</option>
        </select>

        <select value={alertFilter} onChange={handleFilterChange(setAlertFilter)} style={selectStyle}>
          {ALERT_TYPES.map(a => <option key={a} value={a}>{a === 'PDD_PENDING' ? 'PDD Pending' : a}</option>)}
        </select>

        <select value={sortIndex} onChange={handleFilterChange(setSortIndex)} style={selectStyle}>
          {SORT_OPTIONS.map((opt, i) => <option key={i} value={i}>Sort: {opt.label}</option>)}
        </select>
      </div>

      {/* Stage Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        {Object.keys(STAGE_MAPPING).map(tab => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              style={{
                background: isActive ? '#6366F1' : '#fff',
                color: isActive ? '#fff' : '#4B5563',
                border: `1px solid ${isActive ? '#6366F1' : '#D1D5DB'}`,
                padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap'
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 1400, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E5E7EB', color: '#6B7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
              <th style={{ padding: '16px 24px' }}>Case ID</th>
              <th style={{ padding: '16px 12px' }}>Customer</th>
              <th style={{ padding: '16px 12px' }}>Name Of Employee/Sub-dsa</th>
              <th style={{ padding: '16px 12px' }}>CIBIL</th>
              <th style={{ padding: '16px 12px' }}>Lender</th>
              <th style={{ padding: '16px 12px' }}>Product</th>
              <th style={{ padding: '16px 12px' }}>Requested Amt</th>
              <th style={{ padding: '16px 12px' }}>Sanctioned Amt</th>
              <th style={{ padding: '16px 12px' }}>Disbursed Amt</th>
              <th style={{ padding: '16px 12px' }}>Stage</th>
              <th style={{ padding: '16px 12px' }}>Alert</th>
              <th style={{ padding: '16px 12px' }}>Lead Date</th>
              <th style={{ padding: '16px 12px' }}>Updated</th>
              <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="14" style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>
                  Loading pipeline...
                </td>
              </tr>
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan="14" style={{ padding: '60px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No cases found</div>
                  <div style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>Try adjusting your filters or search term.</div>
                </td>
              </tr>
            ) : (
              cases.map((c) => {
                const stageConfig = STAGE_COLORS[c.stage] || STAGE_COLORS['DRAFT'];

                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <td style={{ padding: '16px 24px', fontWeight: 600, color: '#111827' }}>
                      CASE-{c.id}
                      {c.parent_case_id && (
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 12 }}>↳</span> From CASE-{c.parent_case_id}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '16px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#6366F1', cursor: 'pointer', textDecoration: 'underline' }}
                        onClick={() => navigate(`/customers/${c.customer_id}`)}>
                        {c.customer_name || c.customer?.business_name || '-'}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                        {[c.entity_type || c.customer?.entity_type, c.customer?.industry, c.customer?.business_vintage ? `${c.customer.business_vintage} yrs` : null].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td style={{ padding: '16px 12px', color: '#4B5563', fontSize: 13 }}>
                      {c.customer?.created_by?.name || '-'}
                    </td>
                    <td style={{ padding: '16px 12px', fontWeight: 700, color: getCibilColor(c.cibil_score) }}>
                      {c.cibil_score || '-'}
                    </td>
                    <td style={{ padding: '16px 12px', color: '#4B5563' }}>
                      {c.lender_name || '-'}
                    </td>
                    <td style={{ padding: '16px 12px', color: '#4B5563' }}>
                      {c.product_type || '-'}
                    </td>
                    <td style={{ padding: '16px 12px', fontWeight: 600, color: '#4B5563' }}>
                      {formatCurrency(c.loan_amount || c.parent_case?.loan_amount)}
                    </td>
                    <td style={{ padding: '16px 12px', fontWeight: 600, color: '#111827' }}>
                      {formatCurrency(c.sanctioned_amount || c.parent_case?.sanctioned_amount)}
                    </td>
                    <td style={{ padding: '16px 12px', fontWeight: 600, color: '#059669' }}>
                      {formatCurrency(c.total_disbursed_amount || c.parent_case?.total_disbursed_amount)}
                    </td>
                    <td style={{ padding: '16px 12px' }}>
                      <span style={{
                        background: stageConfig.bg, color: stageConfig.text,
                        padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, display: 'inline-block'
                      }}>
                        {STAGE_LABELS[c.stage] || c.stage}
                      </span>
                    </td>
                    <td style={{ padding: '16px 12px' }}>
                      {c.alert_flag === 'PDD_PENDING' ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                          <AlertTriangle size={12} /> PDD
                        </div>
                      ) : (
                        <span style={{ color: '#9CA3AF' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '16px 12px', color: '#6B7280', fontSize: 12 }}>
                      {formatDate(c.lead_date)}
                    </td>
                    <td style={{ padding: '16px 12px', color: '#6B7280', fontSize: 12 }}>
                      {formatRelative(c.updated_at)}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      {c.stage === 'DRAFT' ? (
                        <button
                          onClick={() => {
                            const path = c.customer?.category === 'SALARIED' ? '/customers/salaried/add' : '/customers/add';
                            navigate(`${path}?caseId=${c.id}`);
                          }}
                          style={{ ...actionBtn, background: '#6366F1' }}
                        >
                          Resume
                        </button>
                      ) : c.stage === 'DATA_COLLECTION' ? (
                        <button
                          onClick={() => navigate(`/cases/${c.id}/esr`)}
                          style={{ ...actionBtn, background: '#6366F1' }}
                        >
                          ESR
                        </button>
                      ) : (
                        <button
                          onClick={() => navigate(`/cases/${c.id}`)}
                          style={{ ...actionBtn, background: '#8B5CF6' }} // Purple for View
                        >
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              Showing {(page - 1) * LIMIT + 1} to {Math.min(page * LIMIT, stats.totalCases)} of {stats.totalCases} results
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={pageBtn}>Prev</button>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} style={pageBtn}>Next</button>
            </div>
          </div>
        )}
      </div>
      <CustomerTypeModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <BulkUploadModal
        isOpen={isBulkUploadModalOpen}
        onClose={() => setIsBulkUploadModalOpen(false)}
        onSuccess={() => { setIsBulkUploadModalOpen(false); fetchPipeline(); }}
      />
    </div>
  );
}

const selectStyle = {
  padding: '8px 32px 8px 12px', borderRadius: 8, border: '1px solid #D1D5DB',
  fontSize: 14, color: '#374151', background: '#fff', outline: 'none', cursor: 'pointer',
  appearance: 'none', backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239CA3AF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px top 50%', backgroundSize: '10px auto'
};

const actionBtn = {
  color: 'white', border: 'none', borderRadius: 20,
  padding: '4px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

const pageBtn = {
  padding: '6px 12px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#fff',
  fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer',
};
