import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseService } from '../api/caseService';
import { toast } from 'react-hot-toast';
import { 
  ArrowLeft, 
  ExternalLink, 
  FileText, 
  Zap, 
  UserCheck, 
  RefreshCw, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Download
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { useAuth } from '../context/AuthContext';

const STAGE_COLORS = {
  'LEAD_CREATED': { bg: '#F3F4F6', text: '#374151' },
  'DATA_COLLECTION': { bg: '#E0F2FE', text: '#0369A1' },
  'LEAD_SENT_TO_LENDER': { bg: '#F3E8FF', text: '#6B21A8' },
  'ESR_GENERATED': { bg: '#FFEDD5', text: '#C2410C' },
  'APPROVED': { bg: '#DCFCE7', text: '#166534' },
  'DISBURSED': { bg: '#DCFCE7', text: '#166534' },
  'PARTLY_DISBURSED': { bg: '#DCFCE7', text: '#166534' },
  'CLOSED': { bg: '#F3F4F6', text: '#374151' },
  'REJECTED': { bg: '#FEE2E2', text: '#991B1B' },
  'DRAFT': { bg: '#F3F4F6', text: '#6B7280' }
};

const STAGE_LABELS = {
  'LEAD_CREATED': 'Lead Created',
  'DATA_COLLECTION': 'Data Pulled',
  'LEAD_SENT_TO_LENDER': 'Lead Sent to Lender',
  'ESR_GENERATED': 'Login Done',
  'APPROVED': 'Sanctioned',
  'DISBURSED': 'Disbursed',
  'PARTLY_DISBURSED': 'Partly Disbursed',
  'CLOSED': 'Closed',
  'REJECTED': 'Rejected',
  'DRAFT': 'Draft'
};

const STAGE_OPTIONS = [
  { id: 'LEAD_CREATED', label: 'Lead Created' },
  { id: 'LEAD_SENT_TO_LENDER', label: 'Lead Sent' },
  { id: 'ESR_GENERATED', label: 'Login Done' },
  { id: 'APPROVED', label: 'Sanctioned' },
  { id: 'PARTLY_DISBURSED', label: 'Partly Disbursed' },
  { id: 'DISBURSED', label: 'Fully Disbursed' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'REJECTED', label: 'Rejected' }
];

const STAGE_STEPS = [
  { id: 'LEAD_CREATED', label: 'Lead Created' },
  { id: 'LEAD_SENT_TO_LENDER', label: 'Lead Sent' },
  { id: 'ESR_GENERATED', label: 'Login Done' },
  { id: 'APPROVED', label: 'Sanctioned' },
  { id: 'DISBURSED', label: 'Disbursed' },
  { id: 'CLOSED', label: 'Closed' }
];

export default function CaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Overview');
  const [showStageModal, setShowStageModal] = useState(false);
  const [selectedStage, setSelectedStage] = useState('');
  const [disbursementSummary, setDisbursementSummary] = useState(null);
  
  const { hasRole } = useAuth();
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackConfirmation, setRollbackConfirmation] = useState(false);
  
  // Sanction Form State
  const [sanctionForm, setSanctionForm] = useState({
    loan_account_number: '',
    sanction_date: new Date().toISOString().split('T')[0],
    sanctioned_amount: '',
    confirmed_roi: '',
    processing_fee: '',
    remarks: '',
    lender_name: '',
    product_type: ''
  });

  // Disbursement Form State
  const [disbursementForm, setDisbursementForm] = useState({
    amount: '',
    disbursement_date: new Date().toISOString().split('T')[0],
    next_disbursement_due_date: '',
    remarks: '',
    pdd_pending: false,
    pdd_documents: [{ document_name: '', due_date: '' }]
  });

  const fetchDisbursementSummary = useCallback(async () => {
    try {
      const data = await caseService.getDisbursementSummary(id);
      setDisbursementSummary(data);
      if (data.sanction) {
        setSanctionForm({
          loan_account_number: data.sanction.loan_account_number || '',
          sanction_date: data.sanction.sanction_date?.split('T')[0] || '',
          sanctioned_amount: data.sanction.sanction_amount || data.summary.sanctioned_amount || '',
          confirmed_roi: data.sanction.confirmed_roi || '',
          processing_fee: data.sanction.processing_fee || '',
          remarks: data.sanction.remarks || '',
          lender_name: data.sanction.lender_name || '',
          product_type: data.sanction.product_type || ''
        });
      }
    } catch (err) {
      console.log('No disbursement data yet or error fetching');
    }
  }, [id]);

  const fetchCase = useCallback(async () => {
    try {
      setLoading(true);
      const data = await caseService.getCaseById(id);
      setCaseData(data);
    } catch (error) {
      toast.error('Failed to load case details');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCase();
  }, [fetchCase]);

  const handleFetchBureau = async () => {
    try {
      const primaryApplicant = caseData.applicants.find(a => a.type === 'PRIMARY');
      if (!primaryApplicant) return toast.error('Primary applicant not found');
      
      toast.loading('Fetching bureau score...', { id: 'bureau' });
      // Bureau API would go here, for now mock success
      setTimeout(async () => {
        await fetchCase();
        toast.success('Bureau score updated successfully', { id: 'bureau' });
      }, 1500);
    } catch (error) {
      toast.error('Failed to fetch bureau score', { id: 'bureau' });
    }
  };

  const handlePullGst = async () => {
    toast.success('GST data pull initiated');
  };

  const handleUpdateStage = async () => {
    if (!selectedStage) return toast.error('Please select a stage');

    const STAGE_ORDER = {
      'DRAFT': 1, 'LEAD_CREATED': 2, 'DATA_COLLECTION': 3, 'INCOME_REVIEWED': 4,
      'ESR_GENERATED': 5, 'LEAD_SENT_TO_LENDER': 6, 'IN_REVIEW': 7,
      'APPROVED': 8, 'PARTLY_DISBURSED': 9, 'DISBURSED': 10, 'CLOSED': 11, 'REJECTED': 11
    };

    const isBackward = STAGE_ORDER[selectedStage] < STAGE_ORDER[caseData.stage];

    try {
      // 0. Handle Rollback
      if (isBackward) {
        if (!hasRole('DSA_ADMIN')) {
          return toast.error('Only DSA Admin can rollback financial stages.');
        }
        if (!rollbackReason) return toast.error('Rollback reason is required.');
        if (!rollbackConfirmation) return toast.error('Please confirm the rollback action.');

        await caseService.rollbackCaseStage(id, {
          target_stage: selectedStage,
          reason: rollbackReason,
          confirmation: rollbackConfirmation
        });
        toast.success(`Stage rolled back to ${STAGE_LABELS[selectedStage]}`);
      }
      // 1. Handle Sanctioning (APPROVED)
      else if (selectedStage === 'APPROVED') {
        await caseService.sanctionCase(id, sanctionForm);
        toast.success('Case sanctioned successfully');
      } 
      // 2. Handle Disbursement (PARTLY_DISBURSED or DISBURSED)
      else if (['PARTLY_DISBURSED', 'DISBURSED'].includes(selectedStage)) {
        // If no sanction exists yet, create it first
        if (!disbursementSummary?.sanction) {
          await caseService.sanctionCase(id, sanctionForm);
        }
        
        const payload = {
            ...disbursementForm,
            pdd_tasks: disbursementForm.pdd_pending ? disbursementForm.pdd_documents : []
        };
        const idempotencyKey = `manual_${id}_${Date.now()}`;
        await caseService.recordDisbursement(id, payload, idempotencyKey);
        toast.success(`Disbursement recorded: ${selectedStage === 'DISBURSED' ? 'Full' : 'Partial'}`);
      }
      // 3. Regular Stage Update
      else {
        await caseService.updateCaseStage(id, selectedStage);
        toast.success(`Stage updated to ${STAGE_LABELS[selectedStage]}`);
      }

      setShowStageModal(false);
      fetchCase();
      fetchDisbursementSummary();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update stage');
    }
  };

  useEffect(() => {
    fetchCase();
    fetchDisbursementSummary();
  }, [fetchCase, fetchDisbursementSummary]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading case workspace...</div>;
  if (!caseData) return <div style={{ padding: 40, textAlign: 'center' }}>Case not found</div>;

  const primaryApplicant = caseData.applicants?.find(a => a.is_primary) || {};
  const coBorrowers = caseData.applicants?.filter(a => !a.is_primary) || [];
  const stageConfig = STAGE_COLORS[caseData.stage] || STAGE_COLORS['DRAFT'];

  const STAGE_ORDER = {
    'DRAFT': 1, 'LEAD_CREATED': 2, 'DATA_COLLECTION': 3, 'INCOME_REVIEWED': 4,
    'ESR_GENERATED': 5, 'LEAD_SENT_TO_LENDER': 6, 'IN_REVIEW': 7,
    'APPROVED': 8, 'PARTLY_DISBURSED': 9, 'DISBURSED': 10, 'CLOSED': 11, 'REJECTED': 11
  };
  const isBackward = selectedStage && STAGE_ORDER[selectedStage] < STAGE_ORDER[caseData.stage];
  const isFinancialRollback = isBackward && STAGE_ORDER[caseData.stage] >= STAGE_ORDER['APPROVED'];

  // Stage progress calculation
  const currentStepIndex = STAGE_STEPS.findIndex(s => s.id === caseData.stage);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px 60px', fontFamily: "'Manrope', sans-serif" }}>
      
      {/* 1. HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: '#8898AA', marginBottom: 4 }}>
            ← <span style={{ cursor: 'pointer', color: 'var(--orange)' }} onClick={() => navigate('/customers')}>Customer List</span> / 
            <span style={{ cursor: 'pointer', color: 'var(--orange)' }} onClick={() => navigate('/customers')}> All Cases</span>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0A2540', margin: 0 }}>
            CASE-{caseData.id} — {caseData.customer_name || caseData.customer?.business_name}
          </h2>
          <p style={{ color: '#425466', fontSize: 13, marginTop: 4 }}>
            {caseData.lender_name || 'Unassigned'} · {caseData.product_type || 'N/A'} · ₹{caseData.loan_amount ? (caseData.loan_amount / 100000).toFixed(1) : '0'} Lakhs
          </p>
        </div>
        
        {/* 5. ACTION BUTTONS (Top Right) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" style={btnOutlineStyle} onClick={handlePullGst}>🔌 Pull GST Reports</button>
          <button className="btn btn-outline" style={btnOutlineStyle} onClick={handleFetchBureau}>🔍 Fetch Bureau Score</button>
          <button className="btn btn-outline" style={btnOutlineStyle} onClick={() => navigate(`/cases/${id}/income-summary`)}>✏️ Manual Income</button>
          <button className="btn btn-outline" style={btnOutlineStyle} onClick={() => navigate(`/cases/${id}/esr`)}>📊 Generate ESR</button>
          <button className="btn btn-grad" style={btnGradStyle} onClick={() => setShowStageModal(true)}>📋 Update Stage</button>
        </div>
      </div>

      {caseData.parent_case_id && (
        <div style={{
          padding: '12px 16px', background: '#F0F9FF', border: '1px solid #BAE6FD',
          borderRadius: 8, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0369A1' }}>
              Lender Specific Case
            </div>
            <div style={{ fontSize: 12, color: '#0284C7', marginTop: 2 }}>
              This is a cloned snapshot for <strong>{caseData.lender_name}</strong>. The original source case is <a href={`/cases/${caseData.parent_case_id}`} style={{ fontWeight: 600, color: '#0369A1', textDecoration: 'underline' }}>CASE-{caseData.parent_case_id}</a>.
            </div>
          </div>
        </div>
      )}

      {/* 4. DATA PULL STATUS (Reports pulled card) */}
      <div style={{ 
        background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', 
        marginBottom: 16, borderLeft: '3px solid #635BFF', padding: 20
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', margin: 0 }}>📎 Reports & Data Pulled</h3>
          <span style={{ 
            background: '#DCFCE7', color: '#166534', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 
          }}>
            { (caseData.data_pull_status?.bureau_fetched ? 1 : 0) + 
              (caseData.data_pull_status?.gst_fetched ? 1 : 0) + 
              (caseData.data_pull_status?.itr_fetched ? 1 : 0) } Available
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ background: '#F0FFF4', border: '1px solid #9AE6B4', borderRadius: 8, padding: 12, cursor: 'pointer' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>📊</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#276749' }}>Bureau Report</div>
            <div style={{ fontSize: 11, color: '#8898AA', marginTop: 2 }}>
              {caseData.data_pull_status?.bureau_fetched ? 'Pulled' : 'Pending'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 6, fontWeight: 600 }}>View Details ↗</div>
          </div>
          <div style={{ background: '#EBF8FF', border: '1px solid #90CDF4', borderRadius: 8, padding: 12, cursor: 'pointer' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>🔌</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#2A69AC' }}>GST Analysis</div>
            <div style={{ fontSize: 11, color: '#8898AA', marginTop: 2 }}>
              {caseData.data_pull_status?.gst_fetched ? 'Fetched' : 'Pending'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 6, fontWeight: 600 }}>View Results ↗</div>
          </div>
          <div style={{ background: '#FAF5FF', border: '1px solid #D6BCFA', borderRadius: 8, padding: 12, cursor: 'pointer' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>📄</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#553C9A' }}>ITR Analytics</div>
            <div style={{ fontSize: 11, color: '#8898AA', marginTop: 2 }}>
              {caseData.data_pull_status?.itr_fetched ? 'Fetched' : 'Pending'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--orange)', marginTop: 6, fontWeight: 600 }}>View Details ↗</div>
          </div>
        </div>
      </div>

      {/* Case Progress (Timeline Bar) */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 12px 0' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#425466', textTransform: 'uppercase', letterSpacing: '.5px', margin: 0 }}>Case Progress</p>
          <span style={{ 
            background: stageConfig.bg, color: stageConfig.text, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700 
          }}>
            {STAGE_LABELS[caseData.stage]}
          </span>
        </div>
        
        {/* Stage Track Bar */}
        <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0 28px', overflowX: 'auto', paddingBottom: 4 }}>
          {STAGE_STEPS.map((step, idx) => {
            const isDone = STAGE_STEPS.findIndex(s => s.id === caseData.stage) >= idx;
            const isCurrent = caseData.stage === step.id;
            
            return (
              <React.Fragment key={step.id}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
                  <div style={{ 
                    width: 30, height: 30, borderRadius: '50%', 
                    border: isCurrent ? '2px solid #635BFF' : '2px solid rgba(60,66,87,.12)',
                    background: isDone ? (isCurrent ? '#635BFF' : '#1DC683') : '#fff',
                    color: isDone ? '#fff' : '#8898AA',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
                    boxShadow: isCurrent ? '0 0 0 4px rgba(99,91,255,0.18)' : 'none'
                  }}>
                    {isDone && !isCurrent ? '✓' : idx + 1}
                  </div>
                  <div style={{ 
                    fontSize: 11, fontWeight: 600, textAlign: 'center', marginTop: 5,
                    color: isCurrent ? '#635BFF' : (isDone ? '#1DC683' : '#8898AA')
                  }}>
                    {step.label}
                  </div>
                </div>
                {idx < STAGE_STEPS.length - 1 && (
                  <div style={{ 
                    width: 50, height: 2, 
                    background: STAGE_STEPS.findIndex(s => s.id === caseData.stage) > idx ? '#1DC683' : 'rgba(60,66,87,.12)', 
                    margin: '0 2px 18px 2px' 
                  }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: '#8898AA' }}>
          ⚡ Case can be marked <strong>Rejected</strong> at any stage — rejection auto-closes the case.
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(60,66,87,.12)', marginBottom: 20, gap: 4 }}>
        {['Overview', 'Co-Borrowers', 'Documents', 'Sanction & Disbursement', 'Activity Log'].map(tab => (
          <div 
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{ 
              padding: '9px 16px', fontSize: 13, fontWeight: activeTab === tab ? 600 : 500,
              color: activeTab === tab ? '#635BFF' : '#8898AA',
              cursor: 'pointer', borderBottom: `2px solid ${activeTab === tab ? '#635BFF' : 'transparent'}`,
              marginBottom: -1, transition: '.15s', borderRadius: '6px 6px 0 0'
            }}
          >
            {tab}
          </div>
        ))}
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'Overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          
          {/* 2. ENTITY METADATA SECTION (Case Details) */}
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', margin: 0 }}>Case Details</h3>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <DataRow label="Industry" value={caseData.customer?.industry || 'N/A'} />
                <DataRow label="Entity Type" value={caseData.entity_type || caseData.customer?.entity_type || 'N/A'} />
                <DataRow label="Business Vintage" value={caseData.customer?.business_vintage ? `${caseData.customer.business_vintage} Years` : 'N/A'} />
                <DataRow label="CIBIL Score" value={caseData.cibil_score || 'Pending'} valueColor={caseData.cibil_score >= 700 ? '#1DC683' : '#FF7043'} />
                <DataRow label="Lender" value={caseData.lender_name || 'Not Selected'} />
                <DataRow label="Loan Amount" value={caseData.loan_amount ? `₹${(caseData.loan_amount / 100000).toFixed(1)} Lakhs` : '₹0'} />
                <DataRow label="DSA Notes" value={caseData.dsa_notes || '—'} />
              </div>
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', margin: 0 }}>Property & Collateral</h3>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                <DataRow label="Property Type" value={caseData.property?.property_type || 'N/A'} />
                <DataRow label="Occupancy" value={caseData.property?.occupancy_status || 'N/A'} />
                <DataRow label="Property Value" value={caseData.property?.market_value ? `₹${caseData.property.market_value.toLocaleString('en-IN')}` : 'N/A'} />
                <DataRow label="Location" value={caseData.property?.address || 'N/A'} />
                <DataRow label="LTV Ratio" value={caseData.property?.market_value ? `${((caseData.loan_amount / caseData.property.market_value) * 100).toFixed(1)}%` : '—'} />
              </div>
              <div style={{ background: 'rgba(99,91,255,.08)', border: '1px solid rgba(0,113,227,.2)', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#635BFF', lineHeight: 1.5 }}>
                💡 Property value entered by DSA. Lender will conduct independent property valuation during underwriting.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. CO-BORROWERS SECTION (Table) */}
      {activeTab === 'Co-Borrowers' && (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: '#F6F9FC' }}>
              <tr>
                <th style={thStyle}>Name / Entity</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>PAN</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>CIBIL</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {caseData.applicants?.map(app => (
                <tr key={app.id} style={{ borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#0A2540' }}>{app.name || 'Unnamed Applicant'}</div>
                    <div style={{ fontSize: 11, color: '#8898AA' }}>{app.type}</div>
                  </td>
                  <td style={tdStyle}>{app.type === 'PRIMARY' ? 'Primary Borrower' : 'Co-Borrower / Guarantor'}</td>
                  <td style={tdStyle}>{app.pan_number || '—'}</td>
                  <td style={tdStyle}>
                    {app.bureau_fetched ? 
                      <span style={{ color: '#1DC683', fontSize: 11, fontWeight: 600 }}>✓ Bureau Fetched</span> : 
                      <span style={{ color: '#8898AA', fontSize: 11 }}>Pending Pull</span>
                    }
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: app.cibil_score >= 700 ? '#1DC683' : '#FF7043' }}>
                    {app.cibil_score || '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button className="btn-ghost" style={{ color: '#635BFF', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Documents' && (
        <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)', padding: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {['PAN Card', 'Aadhaar Card', 'GST Returns (12M)', 'Bank Statements (6M)', 'ITR (3 Years)', 'Udyam Certificate'].map(doc => (
              <div key={doc} style={{ 
                background: '#F6F9FC', border: '1.5px solid rgba(60,66,87,0.12)', borderRadius: 12, padding: 14, 
                display: 'flex', flexDirection: 'column', gap: 6
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0A2540' }}>{doc}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#8898AA' }}>Pending Upload</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'Sanction & Disbursement' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
               <div style={{ fontSize: 11, color: '#8898AA', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>Sanctioned Amount</div>
               <div style={{ fontSize: 24, fontWeight: 800, color: '#0A2540' }}>₹{(disbursementSummary?.summary?.sanctioned_amount || 0).toLocaleString('en-IN')}</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
               <div style={{ fontSize: 11, color: '#8898AA', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>Total Disbursed</div>
               <div style={{ fontSize: 24, fontWeight: 800, color: '#166534' }}>₹{(disbursementSummary?.summary?.total_disbursed_amount || 0).toLocaleString('en-IN')}</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
               <div style={{ fontSize: 11, color: '#8898AA', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>Remaining Balance</div>
               <div style={{ fontSize: 24, fontWeight: 800, color: '#C2410C' }}>₹{(disbursementSummary?.summary?.remaining_disbursement_amount || 0).toLocaleString('en-IN')}</div>
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', margin: 0 }}>Disbursement History</h3>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
               <thead style={{ background: '#F6F9FC' }}>
                  <tr>
                    <th style={thStyle}>Tranche</th>
                    <th style={thStyle}>Amount</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Next Due</th>
                    <th style={thStyle}>Status</th>
                  </tr>
               </thead>
               <tbody>
                  {disbursementSummary?.disbursements?.length > 0 ? disbursementSummary.disbursements.map(d => (
                    <tr key={d.id} style={{ borderBottom: '1px solid rgba(60,66,87,0.06)' }}>
                      <td style={tdStyle}>Tranche #{d.tranche_number}</td>
                      <td style={tdStyle}>₹{parseFloat(d.amount).toLocaleString('en-IN')}</td>
                      <td style={tdStyle}>{d.disbursement_date?.split('T')[0]}</td>
                      <td style={tdStyle}>{d.next_disbursement_due_date?.split('T')[0] || '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '4px 8px', borderRadius: 4, background: '#DCFCE7', color: '#166534', fontSize: 11, fontWeight: 600 }}>{d.status}</span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="5" style={{ padding: 40, textAlign: 'center', color: '#8898AA', fontSize: 13 }}>No disbursements recorded yet.</td>
                    </tr>
                  )}
               </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. ACTIVITY SECTION (Timeline + Stage History) */}
      {activeTab === 'Activity Log' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', margin: 0 }}>System Activity Log</h3>
            </div>
            <div style={{ padding: 20 }}>
              {caseData.activity_logs?.length > 0 ? (
                caseData.activity_logs.map(log => (
                  <div key={log.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#635BFF', marginTop: 5, flexShrink: 0 }}></div>
                    <div>
                      <div style={{ fontSize: 13, color: '#0A2540' }}><strong>{log.activity_type}</strong>: {log.description}</div>
                      <div style={{ fontSize: 11, color: '#8898AA', marginTop: 2 }}>
                        {formatDistanceToNow(parseISO(log.created_at), { addSuffix: true })} · User ID: {log.performed_by_user_id || 'System'}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: 20, color: '#8898AA', fontSize: 13 }}>No activity recorded yet.</div>
              )}
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(50,50,93,0.1)', border: '1px solid rgba(60,66,87,0.1)' }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0A2540', margin: 0 }}>Stage Transition History</h3>
            </div>
            <div style={{ padding: 20 }}>
              {caseData.stage_history?.length > 0 ? (
                caseData.stage_history.map(history => (
                  <div key={history.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#1DC683', marginTop: 5, flexShrink: 0 }}></div>
                    <div>
                      <div style={{ fontSize: 13, color: '#0A2540' }}>
                        Transitioned from <strong>{history.old_stage}</strong> to <strong>{history.new_stage}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: '#8898AA', marginTop: 2 }}>
                        {formatDistanceToNow(parseISO(history.changed_at), { addSuffix: true })} · Updated by User: {history.changed_by || 'System'}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: 20, color: '#8898AA', fontSize: 13 }}>No stage history found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── UPDATE STAGE MODAL ── */}
      {showStageModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
          <div style={{ background: '#fff', borderRadius: 20, width: 560, maxHeight: '90vh', boxShadow: '0 24px 60px rgba(0,0,0,0.18)', overflowY: 'auto' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(60,66,87,.12)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0A2540', margin: 0 }}>📋 Update Case Stage</h3>
              <span style={{ cursor: 'pointer', color: '#8898AA', fontSize: 24, lineHeight: 1 }} onClick={() => setShowStageModal(false)}>×</span>
            </div>
            
            <div style={{ padding: 24 }}>
              <div style={{ background: 'rgba(99,91,255,.08)', border: '1px solid rgba(0,113,227,.2)', borderRadius: 10, padding: '12px 16px', fontSize: 12, color: '#635BFF', marginBottom: 20 }}>
                Current stage: <strong>{STAGE_LABELS[caseData.stage]}</strong> · CASE-{caseData.id}
              </div>
              
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#425466', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>
                  Select New Stage
                </label>
                <select 
                  value={selectedStage}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedStage(val);
                    if (val === 'DISBURSED' && disbursementSummary?.summary?.remaining_disbursement_amount) {
                      setDisbursementForm(prev => ({ ...prev, amount: disbursementSummary.summary.remaining_disbursement_amount }));
                    }
                  }}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid rgba(60,66,87,0.12)', fontSize: 14, outline: 'none', background: '#F6F9FC' }}
                >
                  <option value="">— Choose Stage —</option>
                  {STAGE_OPTIONS.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>

              {/* Rollback Warning Modal Section */}
              {isBackward && (
                <div style={{ marginBottom: 24, padding: 20, background: '#FEF2F2', borderRadius: 12, border: '1px solid #FCA5A5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <AlertCircle color="#DC2626" size={20} />
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#991B1B' }}>Backward Stage Rollback</h4>
                  </div>
                  {!hasRole('DSA_ADMIN') ? (
                    <div style={{ fontSize: 13, color: '#B91C1C', fontWeight: 600 }}>
                      Only DSA Admin can perform a backward stage rollback. Please contact your administrator.
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: 12, color: '#991B1B', margin: '0 0 16px 0', lineHeight: 1.5 }}>
                        You are moving the case backwards. This is a sensitive operation. 
                        {isFinancialRollback && ' Depending on the target stage, active disbursements and PDD tasks will be CANCELLED, and the Case Sanction may be archived and removed.'}
                      </p>
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>Rollback Reason *</label>
                        <textarea 
                          value={rollbackReason}
                          onChange={(e) => setRollbackReason(e.target.value)}
                          placeholder="Explain why this case is being rolled back..."
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #FCA5A5', fontSize: 13, outline: 'none', minHeight: 60 }}
                        />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                        <input 
                          type="checkbox" 
                          checked={rollbackConfirmation}
                          onChange={(e) => setRollbackConfirmation(e.target.checked)}
                          style={{ marginTop: 2 }}
                        />
                        <span style={{ fontSize: 12, color: '#991B1B', fontWeight: 600 }}>
                          I confirm that I understand the financial and audit implications of rolling back this case.
                        </span>
                      </label>
                    </>
                  )}
                </div>
              )}

              {/* Sanction Details Form (Shown for APPROVED, PARTLY_DISBURSED, DISBURSED if not already locked) */}
              {!isBackward && ['APPROVED', 'PARTLY_DISBURSED', 'DISBURSED'].includes(selectedStage) && (
                <div style={{ marginBottom: 24, padding: 20, background: '#F8FAFC', borderRadius: 12, border: '1px solid #E2E8F0' }}>
                  <h4 style={{ margin: '0 0 16px 0', fontSize: 13, fontWeight: 700, color: '#475569' }}>Loan Sanction Details</h4>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Lender Name</label>
                      <input 
                        type="text" 
                        value={sanctionForm.lender_name}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, lender_name: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Product Type</label>
                      <input 
                        type="text" 
                        value={sanctionForm.product_type}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, product_type: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Loan Account Number</label>
                      <input 
                        type="text" 
                        value={sanctionForm.loan_account_number}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, loan_account_number: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Sanctioned Amount (₹)</label>
                      <input 
                        type="number" 
                        value={sanctionForm.sanctioned_amount}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, sanctioned_amount: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Sanction Date</label>
                      <input 
                        type="date" 
                        value={sanctionForm.sanction_date}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, sanction_date: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Confirmed ROI (%)</label>
                      <input 
                        type="number" 
                        step="0.01"
                        value={sanctionForm.confirmed_roi}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, confirmed_roi: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#64748B', marginBottom: 4 }}>Processing Fee (₹)</label>
                      <input 
                        type="number" 
                        value={sanctionForm.processing_fee}
                        disabled={disbursementSummary?.summary?.is_locked}
                        onChange={(e) => setSanctionForm({...sanctionForm, processing_fee: e.target.value})}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #CBD5E1' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Disbursement Details Form (Shown for PARTLY_DISBURSED, DISBURSED) */}
              {!isBackward && ['PARTLY_DISBURSED', 'DISBURSED'].includes(selectedStage) && (
                <div style={{ marginBottom: 24, padding: '24px 20px', background: '#fff', borderRadius: 16, border: '1px solid #FFEDD5', boxShadow: '0 4px 12px rgba(251, 146, 60, 0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                     <span style={{ fontSize: 20 }}>🏗️</span>
                     <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#C2410C' }}>
                        {selectedStage === 'PARTLY_DISBURSED' ? 'Part Disbursement Details' : 'Final Disbursement Details'}
                     </h4>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div style={{ gridColumn: 'span 2' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9A3412', textTransform: 'uppercase' }}>Amount Being Disbursed Now (₹) *</label>
                          <span style={{ fontSize: 11, color: '#EA580C', fontWeight: 600 }}>
                             Remaining: ₹{(disbursementSummary?.summary?.remaining_disbursement_amount || sanctionForm.sanctioned_amount || 0).toLocaleString('en-IN')}
                          </span>
                       </div>
                       <input 
                        type="number" 
                        value={disbursementForm.amount}
                        readOnly={selectedStage === 'DISBURSED'}
                        onChange={(e) => setDisbursementForm({...disbursementForm, amount: e.target.value})}
                        placeholder="e.g. 6000000"
                        style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid #FED7AA', fontSize: 15, fontWeight: 600, outline: 'none' }}
                      />
                      <div style={{ fontSize: 11, color: '#9A3412', marginTop: 4 }}>
                         Must be {selectedStage === 'PARTLY_DISBURSED' ? 'less than' : 'equal to'} remaining sanctioned amount
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9A3412', marginBottom: 6 }}>Disbursement Date</label>
                      <input 
                        type="date" 
                        value={disbursementForm.disbursement_date}
                        onChange={(e) => setDisbursementForm({...disbursementForm, disbursement_date: e.target.value})}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #FED7AA' }}
                      />
                    </div>

                    {selectedStage === 'PARTLY_DISBURSED' && (
                      <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9A3412', marginBottom: 6 }}>Next Disbursement Due Date</label>
                        <input 
                          type="date" 
                          value={disbursementForm.next_disbursement_due_date}
                          onChange={(e) => setDisbursementForm({...disbursementForm, next_disbursement_due_date: e.target.value})}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #FED7AA' }}
                        />
                        <div style={{ fontSize: 10, color: '#C2410C', marginTop: 4 }}>Expected date for the remaining balance</div>
                      </div>
                    )}

                    <div style={{ gridColumn: 'span 2', marginTop: 8 }}>
                       <div style={{ background: '#FFF7ED', border: '1px solid #FFD8A8', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ fontSize: 16, marginTop: 2 }}>💡</div>
                          <div style={{ fontSize: 12, color: '#9A3412', lineHeight: 1.5 }}>
                             This case will automatically appear in the <strong>Part Disbursement</strong> module with the pending balance and next due date.
                          </div>
                       </div>
                    </div>
                  </div>

                  {/* PDD Section */}
                  <div style={{ marginTop: 24, padding: 20, background: '#fff', border: '1.5px dashed #E2E8F0', borderRadius: 16 }}>
                     <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <span style={{ fontSize: 18 }}>📋</span>
                        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#475569' }}>Post-Disbursement Documents (PDD)</h4>
                     </div>
                     <p style={{ fontSize: 12, color: '#64748B', margin: '0 0 16px 0' }}>Are there any Post-Disbursement Documents pending from this customer?</p>
                     
                     <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                           <input type="radio" checked={disbursementForm.pdd_pending} onChange={() => setDisbursementForm({...disbursementForm, pdd_pending: true})} /> Yes
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                           <input type="radio" checked={!disbursementForm.pdd_pending} onChange={() => setDisbursementForm({...disbursementForm, pdd_pending: false})} /> No
                        </label>
                     </div>

                     {disbursementForm.pdd_pending && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                           {disbursementForm.pdd_documents.map((pdd, idx) => (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 40px', gap: 10 }}>
                                 <input 
                                    type="text" 
                                    placeholder="Document Name (e.g. Original RC)" 
                                    value={pdd.document_name}
                                    onChange={(e) => {
                                       const newDocs = [...disbursementForm.pdd_documents];
                                       newDocs[idx].document_name = e.target.value;
                                       setDisbursementForm({...disbursementForm, pdd_documents: newDocs});
                                    }}
                                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                                 />
                                 <input 
                                    type="date" 
                                    value={pdd.due_date}
                                    onChange={(e) => {
                                       const newDocs = [...disbursementForm.pdd_documents];
                                       newDocs[idx].due_date = e.target.value;
                                       setDisbursementForm({...disbursementForm, pdd_documents: newDocs});
                                    }}
                                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }}
                                 />
                                 <button 
                                    onClick={() => {
                                       const newDocs = disbursementForm.pdd_documents.filter((_, i) => i !== idx);
                                       setDisbursementForm({...disbursementForm, pdd_documents: newDocs});
                                    }}
                                    style={{ border: 'none', background: 'none', color: '#EF4444', cursor: 'pointer' }}
                                 >
                                    ×
                                 </button>
                              </div>
                           ))}
                           <button 
                              onClick={() => setDisbursementForm({...disbursementForm, pdd_documents: [...disbursementForm.pdd_documents, { document_name: '', due_date: '' }]})}
                              style={{ padding: '6px', fontSize: 11, color: '#635BFF', background: 'none', border: '1px dashed #635BFF', borderRadius: 6, cursor: 'pointer' }}
                           >
                              + Add Another Document
                           </button>
                        </div>
                     )}
                  </div>
                </div>
              )}

              {/* Rejection / Closure Remarks */}
              {['REJECTED', 'CLOSED'].includes(selectedStage) && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#425466', marginBottom: 6 }}>
                    {selectedStage === 'REJECTED' ? 'Rejection Reason' : 'Closure Remarks'}
                  </label>
                  <textarea 
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid rgba(60,66,87,0.12)', fontSize: 14, minHeight: 80 }}
                    placeholder="Enter details..."
                  />
                </div>
              )}
            </div>
            
            <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(60,66,87,.12)', display: 'flex', justifyContent: 'flex-end', gap: 12, background: '#F6F9FC', position: 'sticky', bottom: 0 }}>
              <button className="btn btn-ghost" onClick={() => setShowStageModal(false)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                onClick={handleUpdateStage}
                disabled={!selectedStage || (isBackward && (!hasRole('DSA_ADMIN') || !rollbackConfirmation || !rollbackReason))}
              >
                Confirm Update
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Helper Components
function DataRow({ label, value, valueColor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 8, borderBottom: '1px solid rgba(60,66,87,0.12)' }}>
      <span style={{ color: '#8898AA' }}>{label}</span>
      <strong style={{ color: valueColor || '#0A2540' }}>{value}</strong>
    </div>
  );
}

// Helper Styles
const btnOutlineStyle = {
  background: '#fff', border: '1.5px solid rgba(60,66,87,0.12)', color: '#0A2540',
  padding: '8px 16px', borderRadius: 980, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: '.15s'
};

const btnGradStyle = {
  background: 'linear-gradient(135deg,#635BFF,#7C3AED)', color: '#fff', border: 'none',
  padding: '8px 16px', borderRadius: 980, fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: '.15s',
  boxShadow: '0 2px 8px rgba(99,91,255,0.28)'
};

const thStyle = {
  padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, 
  textTransform: 'uppercase', letterSpacing: '.5px', color: '#8898AA', borderBottom: '1px solid rgba(60,66,87,0.12)'
};

const tdStyle = {
  padding: '12px 14px', fontSize: 13, color: '#0A2540'
};
