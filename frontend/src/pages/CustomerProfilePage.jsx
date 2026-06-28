import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { customerService } from '../api/customerService';
import { Building2, Phone, Mail, MapPin, FileText, ChevronRight, AlertTriangle, Plus, Eye } from 'lucide-react';

const STAGE_COLORS = {
  'LEAD_CREATED':       { bg: '#FEF3C7', text: '#92400E' },
  'DATA_COLLECTION':    { bg: '#E0F2FE', text: '#0369A1' },
  'LEAD_SENT_TO_LENDER':{ bg: '#F3E8FF', text: '#6B21A8' },
  'ESR_GENERATED':      { bg: '#FFEDD5', text: '#C2410C' },
  'APPROVED':           { bg: '#D1FAE5', text: '#065F46' },
  'DISBURSED':          { bg: '#DCFCE7', text: '#166534' },
  'PARTLY_DISBURSED':   { bg: '#D1FAE5', text: '#065F46' },
  'CLOSED':             { bg: '#F3F4F6', text: '#374151' },
  'REJECTED':           { bg: '#FEE2E2', text: '#991B1B' },
  'DRAFT':              { bg: '#F3F4F6', text: '#6B7280' }
};

const STAGE_LABELS = {
  'LEAD_CREATED': 'Lead Created',
  'DATA_COLLECTION': 'Data Pulled',
  'LEAD_SENT_TO_LENDER': 'Submitted',
  'ESR_GENERATED': 'ESR Generated',
  'APPROVED': 'Sanctioned',
  'DISBURSED': 'Disbursed',
  'PARTLY_DISBURSED': 'Partly Disbursed',
  'CLOSED': 'Closed',
  'REJECTED': 'Rejected',
  'DRAFT': 'Draft'
};

const TABS = ['Overview', 'Documents', 'Cases', 'Co-Borrowers'];

const CustomerProfilePage = () => {
  const { customer_id } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Overview');

  useEffect(() => {
    customerService.getCustomerProfile(customer_id)
      .then(setProfile)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [customer_id]);

  const formatCurrency = (val) => {
    if (!val) return '—';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    return `₹${val.toLocaleString('en-IN')}`;
  };

  const formatDate = (d) => {
    if (!d) return '—';
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
  };

  const getCibilColor = (score) => {
    if (!score) return '#9CA3AF';
    if (score >= 700) return '#10B981';
    if (score >= 650) return '#F59E0B';
    return '#EF4444';
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
      <div style={{ width: 36, height: 36, border: '3px solid #E5E7EB', borderTopColor: '#6366F1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!profile) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Customer not found.</div>
  );

  // Breadcrumbs and header
  const primaryBureau = profile.bureau_summary?.find(b => b.applicant_type === 'PRIMARY');

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>

      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, color: '#4B5563' }}>Customer Profile</span>
        <ChevronRight size={14} />
        <span
          style={{ cursor: 'pointer', color: '#6366F1' }}
          onClick={() => navigate('/customers')}
        >
          Pipeline
        </span>
        <ChevronRight size={14} />
        <span>Documents</span>
        <ChevronRight size={14} />
        <span>Cases</span>
        <ChevronRight size={14} />
        <span>Financials</span>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#111827', margin: 0, marginBottom: 6 }}>
              {profile.customer_name}
            </h1>
            <div style={{ fontSize: 13, color: '#6B7280', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {profile.gstin && (
                <span>GSTIN: <strong>{profile.gstin}</strong></span>
              )}
              {profile.business_pan && (
                <span>PAN: <strong>{profile.business_pan}</strong></span>
              )}
              {profile.industry && <span>{profile.industry}</span>}
              {profile.entity_type && <span>{profile.entity_type}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => navigate('/customers/add')}
              style={{
                background: '#fff', color: '#374151', border: '1px solid #D1D5DB',
                borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6
              }}
            >
              <Plus size={14} /> New Case
            </button>
            <button
              onClick={() => navigate('/customers')}
              style={{
                background: '#6366F1', color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer'
              }}
            >
              View All Cases
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #E5E7EB', marginBottom: 24, display: 'flex', gap: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px', fontSize: 14, fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === tab ? '#6366F1' : '#6B7280',
              borderBottom: activeTab === tab ? '2px solid #6366F1' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.15s'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── TAB: Overview ───────────────────────────────────── */}
      {activeTab === 'Overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>

          {/* Business Details */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 20, margin: '0 0 20px 0' }}>
              Business Details
            </h3>
            {[
              ['Entity Type', profile.entity_type],
              ['Industry', profile.industry],
              ['Vintage', profile.business_vintage ? `${profile.business_vintage} years` : null],
              ['Address', [profile.principal_address, profile.principal_city, profile.principal_state, profile.principal_pincode].filter(Boolean).join(', ') || null],
              ['Email', profile.business_email],
              ['Mobile', profile.business_mobile],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 13, color: '#6B7280', minWidth: 90 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: value ? 600 : 400, color: value ? '#111827' : '#9CA3AF', textAlign: 'right', maxWidth: 180 }}>
                  {value || '—'}
                </span>
              </div>
            ))}
          </div>

          {/* Income Summary */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 20px 0' }}>Income Summary</h3>
            {[
              ['GST Turnover (Avg 12M)', profile.income_summary?.gst_turnover_avg_12m],
              ['ITR Net Income (FY24)', profile.income_summary?.itr_net_income],
              ['Bank Avg Monthly Cr.', profile.income_summary?.bank_avg_monthly_credit],
              ['FOIR (Est.)', profile.income_summary?.foir],
              ['Last Updated', profile.income_summary?.last_updated ? formatDate(profile.income_summary.last_updated) : null],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: value ? 600 : 400, color: value ? '#111827' : '#9CA3AF' }}>{value || '—'}</span>
              </div>
            ))}
          </div>

          {/* Property & Collateral */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 20px 0' }}>Property & Collateral</h3>
            {(() => {
              const latestCase = profile.cases?.[0];
              return [
                ['Property Type', latestCase?.property_type],
                ['Location', latestCase?.location],
                ['Market Value', latestCase?.property_value ? formatCurrency(latestCase.property_value) : null],
                ['Ownership', latestCase?.ownership_type],
                ['Encumbrance', latestCase?.encumbrance],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                  <span style={{ fontSize: 13, color: '#6B7280' }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: value ? 600 : 400, color: value ? '#111827' : '#9CA3AF' }}>
                    {value || '—'}
                  </span>
                </div>
              ));
            })()}
          </div>

          {/* Bureau Summary — full width */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', padding: 24, gridColumn: '1 / -1' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 20px 0' }}>Bureau Summary</h3>
            {profile.bureau_summary?.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#6B7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {['Applicant', 'Role', 'CIBIL Score', 'Active Loans', 'Total EMI / Mo', 'Overdue'].map(h => (
                      <th key={h} style={{ padding: '8px 16px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profile.bureau_summary.map((b, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#111827' }}>{b.name}</td>
                      <td style={{ padding: '12px 16px', color: '#6B7280' }}>
                        {b.applicant_type === 'PRIMARY' ? 'Primary Director' : 'Co-Director'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontWeight: 700, fontSize: 14,
                          color: getCibilColor(b.cibil_score),
                          background: b.cibil_score ? (b.cibil_score >= 700 ? '#DCFCE7' : b.cibil_score >= 650 ? '#FEF3C7' : '#FEE2E2') : '#F3F4F6',
                          padding: '2px 10px', borderRadius: 6
                        }}>
                          {b.cibil_score || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#374151' }}>{b.active_loan_count ?? '—'}</td>
                      <td style={{ padding: '12px 16px', color: '#374151' }}>
                        {b.emi_obligations_total ? `₹${b.emi_obligations_total.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ color: b.overdue_amount ? '#EF4444' : '#10B981', fontWeight: 600 }}>
                          {b.overdue_amount ? `₹${b.overdue_amount.toLocaleString('en-IN')}` : 'Nil'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ color: '#9CA3AF', fontSize: 13, padding: '12px 0' }}>
                No bureau data available yet. Run a bureau check to populate this section.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Documents ──────────────────────────────────── */}
      {activeTab === 'Documents' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Document Checklist</h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#10B981', background: '#DCFCE7', padding: '3px 10px', borderRadius: 6 }}>
                {profile.documents?.length || 0} Received
              </span>
              <button style={{ background: 'none', border: '1px dashed #D1D5DB', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: '#6B7280', cursor: 'pointer' }}>
                + Add Custom
              </button>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#6B7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {['Document', 'Applicant', 'Status', 'Uploaded On', 'Action'].map(h => (
                  <th key={h} style={{ padding: '10px 24px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.documents?.length > 0 ? profile.documents.map(doc => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '12px 24px', color: '#374151' }}>
                    {doc.document_type?.replace(/_/g, ' ')}
                  </td>
                  <td style={{ padding: '12px 24px', color: '#6B7280' }}>
                    {profile.customer_name}
                  </td>
                  <td style={{ padding: '12px 24px' }}>
                    <span style={{ color: '#10B981', fontWeight: 600, fontSize: 12 }}>✓ Received</span>
                  </td>
                  <td style={{ padding: '12px 24px', color: '#6B7280' }}>
                    {formatDate(doc.created_at)}
                  </td>
                  <td style={{ padding: '12px 24px' }}>
                    <button
                      onClick={() => navigate(`/api/documents/${doc.id}/view`)}
                      style={{
                        background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6,
                        padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
                    No documents uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB: Cases ──────────────────────────────────────── */}
      {activeTab === 'Cases' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>All Cases</h3>
            <button
              onClick={() => navigate('/customers/add')}
              style={{
                background: '#6366F1', color: '#fff', border: 'none', borderRadius: 8,
                padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5
              }}
            >
              <Plus size={14} /> New Case
            </button>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#6B7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {['Case ID', 'Lender', 'Product', 'Amount', 'Stage', 'Last Updated', 'Action'].map(h => (
                  <th key={h} style={{ padding: '10px 24px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.cases?.length > 0 ? profile.cases.map(c => {
                const stageConfig = STAGE_COLORS[c.stage] || STAGE_COLORS['DRAFT'];
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '14px 24px', fontWeight: 700, color: '#6366F1', cursor: 'pointer' }}
                        onClick={() => navigate(`/cases/${c.id}`)}>
                      CASE-{c.id}
                    </td>
                    <td style={{ padding: '14px 24px', color: '#374151' }}>{c.lender_name || '—'}</td>
                    <td style={{ padding: '14px 24px', color: '#374151' }}>{c.product_type || '—'}</td>
                    <td style={{ padding: '14px 24px', fontWeight: 600, color: '#111827' }}>
                      {formatCurrency(c.sanctioned_amount || c.loan_amount || c.parent_case?.sanctioned_amount || c.parent_case?.loan_amount)}
                    </td>
                    <td style={{ padding: '14px 24px' }}>
                      <span style={{
                        background: stageConfig.bg, color: stageConfig.text,
                        padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 700
                      }}>
                        {STAGE_LABELS[c.stage] || c.stage}
                      </span>
                    </td>
                    <td style={{ padding: '14px 24px', color: '#6B7280' }}>{formatDate(c.updated_at)}</td>
                    <td style={{ padding: '14px 24px' }}>
                      <button
                        onClick={() => navigate(`/cases/${c.id}`)}
                        style={{
                          background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6,
                          padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: '#374151', fontWeight: 600
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
                    No cases found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB: Co-Borrowers ───────────────────────────────── */}
      {activeTab === 'Co-Borrowers' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #E5E7EB' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Co-Applicants / Directors</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#6B7280', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {['Name', 'Relationship', 'PAN', 'Mobile', 'CIBIL', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 24px', textAlign: 'left', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profile.bureau_summary?.length > 0 ? profile.bureau_summary.map((b, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '14px 24px', fontWeight: 600, color: '#111827' }}>{b.name}</td>
                  <td style={{ padding: '14px 24px', color: '#6B7280' }}>
                    {b.applicant_type === 'PRIMARY' ? 'Primary Director' : 'Co-Director / Spouse'}
                  </td>
                  <td style={{ padding: '14px 24px', color: '#6B7280', fontFamily: 'monospace' }}>
                    {b.pan_masked || '—'}
                  </td>
                  <td style={{ padding: '14px 24px', color: '#374151' }}>{b.mobile || '—'}</td>
                  <td style={{ padding: '14px 24px' }}>
                    {b.cibil_score ? (
                      <span style={{
                        fontWeight: 700,
                        color: getCibilColor(b.cibil_score),
                        background: b.cibil_score >= 700 ? '#DCFCE7' : b.cibil_score >= 650 ? '#FEF3C7' : '#FEE2E2',
                        padding: '2px 10px', borderRadius: 6
                      }}>
                        {b.cibil_score}
                      </span>
                    ) : <span style={{ color: '#9CA3AF' }}>—</span>}
                  </td>
                  <td style={{ padding: '14px 24px' }}>
                    <span style={{ color: b.bureau_fetched ? '#10B981' : '#F59E0B', fontWeight: 600 }}>
                      {b.bureau_fetched ? 'Active' : 'Pending'}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
                    No co-applicants / directors found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CustomerProfilePage;
