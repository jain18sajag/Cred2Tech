import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseService } from '../api/caseService';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  CheckCircle, XCircle, RefreshCw, ChevronLeft, Calculator,
  Send, Clock, CheckCircle2, AlertCircle, X, Mail, Phone
} from 'lucide-react';
import { sendCaseToLender, sendCaseToOtherLender, getTenantLenders } from '../api/tenantLenderService';
import { useAuth } from '../context/AuthContext';
import api from '../api/axiosInstance';

// ─── Send Confirmation Modal ───────────────────────────────────────────────────
function SendConfirmationModal({ isOpen, onClose, result }) {
  if (!isOpen || !result) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-primary)', width: '94%', maxWidth: 520, borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ background: 'linear-gradient(135deg,#F0FFF4,#EBF8FF)', padding: '24px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>✅</div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: '#276749', margin: 0 }}>Lead Successfully Sent!</h3>
          <p style={{ color: '#4A5568', fontSize: 13, marginTop: 6 }}>The proposal has been dispatched to the lender contact.</p>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Email preview */}
          <div style={{ border: '1px solid #BEE3F8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: '#EBF8FF', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail size={14} color='#2B6CB0' />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#2B6CB0' }}>EMAIL SENT</span>
            </div>
            <div style={{ padding: '12px 16px', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>To:</span>
                <span style={{ fontWeight: 600 }}>{result.to}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>Contact:</span>
                <span style={{ fontWeight: 600 }}>{result.contact_name}</span>
              </div>
              <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>Subject:</strong>
                {result.subject}
              </div>
              <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, maxHeight: 80, overflow: 'hidden' }}>
                {(result.body_preview || '').slice(0, 200)}…
              </div>
            </div>
          </div>
          {/* SMS preview */}
          {result.sms?.smsSent && (
            <div style={{ border: '1px solid #C6F6D5', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ background: '#F0FFF4', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Phone size={14} color='#276749' />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#276749' }}>SMS SENT</span>
              </div>
              <div style={{ padding: '12px 16px', fontSize: 12 }}>
                <div style={{ marginBottom: 4 }}>Sent to: <strong>{result.sms.to}</strong></div>
                <div style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: 11, lineHeight: 1.6 }}>{result.sms.message}</div>
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 22px', borderRadius: 8, fontWeight: 700, fontSize: 14, background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Send to Other Lender Modal ───────────────────────────────────────────────
function SendToOtherLenderModal({ isOpen, onClose, caseId, caseProductType, onSuccess }) {
  const [lenders, setLenders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLender, setSelectedLender] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [sending, setSending] = useState(false);
  const [manualLender, setManualLender] = useState({
    lender_name: '',
    contact_name: '',
    contact_email: '',
    contact_mobile: '',
    dsa_code: ''
  });

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setSelectedLender(null); setSelectedContact(null);
      setManualLender({ lender_name: '', contact_name: '', contact_email: '', contact_mobile: '', dsa_code: '' });
      getTenantLenders().then(d => setLenders(d.filter(l => l.is_active && l.contacts?.length > 0))).catch(() => toast.error('Failed to load lenders')).finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSend = async () => {
    const isManualMode = lenders.length === 0;
    if (isManualMode) {
      if (!manualLender.lender_name.trim()) { toast.error('Enter lender name'); return; }
      if (!manualLender.contact_name.trim()) { toast.error('Enter contact name'); return; }
      if (!manualLender.contact_email.trim()) { toast.error('Enter contact email'); return; }
    } else if (!selectedContact) {
      toast.error('Select a contact first');
      return;
    }
    setSending(true);
    try {
      const payload = isManualMode
        ? {
            scheme_id: null,
            other_lender: {
              ...manualLender,
              product_type: caseProductType || 'ALL'
            }
          }
        : {
            tenant_lender_id: selectedLender.id,
            lender_id: selectedLender.platform_lender_id || null,
            scheme_id: null,
          };
      const r = await caseService.createProposal(caseId, payload);
      const result = r.proposal;
      toast.success(`Proposal draft created for ${isManualMode ? manualLender.lender_name : selectedLender.lender_name}`);
      window.location.href = `/cases/${caseId}/proposals/${result.id}`;
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to create proposal');
    } finally { setSending(false); }
  };

  const contacts = selectedLender?.contacts || [];
  const filteredContacts = contacts.filter(c =>
    !caseProductType || c.product_type === caseProductType || c.product_type === 'ALL'
  );
  const canSend = lenders.length === 0
    ? Boolean(manualLender.lender_name.trim() && manualLender.contact_name.trim() && manualLender.contact_email.trim())
    : Boolean(selectedContact);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-primary)', width: '94%', maxWidth: 480, borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Send to Other Lender</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px' }}>
          {!loading && lenders.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                Enter lender details to create an Other Lender proposal.
              </div>
              <input value={manualLender.lender_name} onChange={e => setManualLender({ ...manualLender, lender_name: e.target.value })} placeholder="Lender name *" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} />
              <input value={manualLender.contact_name} onChange={e => setManualLender({ ...manualLender, contact_name: e.target.value })} placeholder="Contact name *" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} />
              <input value={manualLender.contact_email} onChange={e => setManualLender({ ...manualLender, contact_email: e.target.value })} placeholder="Contact email *" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} />
              <input value={manualLender.contact_mobile} onChange={e => setManualLender({ ...manualLender, contact_mobile: e.target.value })} placeholder="Mobile (optional)" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} />
              <input value={manualLender.dsa_code} onChange={e => setManualLender({ ...manualLender, dsa_code: e.target.value })} placeholder="DSA code (optional)" style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} />
            </div>
          )}
          {loading ? <div style={{ textAlign: 'center', padding: 30 }}><LoadingSpinner size={30} /></div> : lenders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)' }}>
              No configured lenders found. <a href='/settings/lender-contacts' style={{ color: 'var(--primary)' }}>Add contacts →</a>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>Select Lender</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
                  {lenders.map(l => (
                    <button key={l.id} onClick={() => { setSelectedLender(l); setSelectedContact(null); }}
                      style={{
                        padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                        border: `2px solid ${selectedLender?.id === l.id ? 'var(--primary)' : 'var(--border)'}`,
                        background: selectedLender?.id === l.id ? '#EEF2FF' : 'var(--bg-elevated)', color: 'var(--text-primary)'
                      }}>
                      🏦 {l.lender_name} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>· {l.contacts.length} contact(s)</span>
                    </button>
                  ))}
                </div>
              </div>
              {selectedLender && (
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>Select Contact</label>
                  {filteredContacts.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 13, color: 'var(--error)', background: '#FFF5F5', borderRadius: 8, border: '1px solid #FED7D7' }}>
                      No contacts configured for product {caseProductType}. Configure one in Lender Contacts.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                      {filteredContacts.map(c => (
                        <button key={c.id} onClick={() => setSelectedContact(c)}
                          style={{
                            padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: 'pointer', fontSize: 13,
                            border: `2px solid ${selectedContact?.id === c.id ? '#276749' : 'var(--border)'}`,
                            background: selectedContact?.id === c.id ? '#F0FFF4' : 'var(--bg-elevated)', color: 'var(--text-primary)'
                          }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 600 }}>{c.contact_name} <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>({c.product_type})</span></div>
                            {c.dsa_code && <div style={{ fontSize: 10, fontWeight: 700, color: '#4A5568', background: '#EDF2F7', padding: '2px 6px', borderRadius: 6 }}>{c.dsa_code}</div>}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{c.contact_email}{c.contact_mobile ? ` · ${c.contact_mobile}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--bg-elevated)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Cancel</button>
          <button onClick={handleSend} disabled={!canSend || sending}
            style={{ padding: '9px 20px', borderRadius: 8, fontWeight: 700, fontSize: 14, background: canSend ? 'var(--primary)' : 'var(--border)', color: '#fff', border: 'none', cursor: canSend ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> {sending ? 'Sending...' : 'Send Proposal'}
          </button>
        </div>
      </div>
    </div>
  );
}

const fmt = (n) => n != null ? `₹${Number(n).toLocaleString('en-IN')}` : null;

const formatDynamicCurrency = (n) => {
  if (n === null || n === undefined) return '—';
  const num = Number(n);
  if (num >= 10000000) return `₹${(num / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}Cr`;
  if (num >= 100000) return `₹${(num / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`;
  return `₹${num.toLocaleString('en-IN')}`;
};

const formatDynamicTenure = (months) => {
  if (months === null || months === undefined) return '—';
  const m = Number(months);
  if (m % 12 === 0) return `${m / 12} Years`;
  return `${(m / 12).toFixed(1)} Years`;
};

const fmtPct = (v) => v != null ? `${(Number(v) * 100).toFixed(1)}%` : '—';
const fmtPct2 = (v) => v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—';
const formatExactCurrency = (n, fractionDigits = 3) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return `₹${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  })}`;
};


const firstPresent = (...values) => values.find(v => v !== null && v !== undefined && v !== '');
const policyRateToFraction = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1 ? numeric / 100 : numeric;
};
const formatPolicyPercentRange = (min, max) => {
  const hasMin = min !== null && min !== undefined && min !== '';
  const hasMax = max !== null && max !== undefined && max !== '';
  if (!hasMin && !hasMax) return 'Not Configured';
  if (hasMin && hasMax) {
    const minText = fmtPct2(min);
    const maxText = fmtPct2(max);
    return Number(min) === Number(max) ? minText : `${minText} - ${maxText}`;
  }
  return hasMin ? `From ${fmtPct2(min)}` : `Up to ${fmtPct2(max)}`;
};

const getDscrBreakdown = (ev) => (
  ev?.dscr_breakdown ||
  ev?.dscrBreakdown ||
  ev?.foir_breakdown?.dscr_breakdown ||
  ev?.foirBreakdown?.dscrBreakdown ||
  ev?.calculation_breakdown?.dscr ||
  null
);

const isDscrEvaluation = (ev) => {
  const name = String(ev?.scheme_name || ev?.best_scheme_name || '').toUpperCase();
  return name.includes('DSCR') || Boolean(getDscrBreakdown(ev));
};

const normalizeSchemeName = (value) => String(value || '').trim().toUpperCase();

const namesMatch = (left, right) => {
  const a = normalizeSchemeName(left);
  const b = normalizeSchemeName(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
};

const getSchemeKey = (ev, index = 0) => (
  ev?.scheme_id || ev?.id || `${normalizeSchemeName(ev?.scheme_name || ev?.best_scheme_name)}-${index}`
);

const getOrderedEvaluationsForView = (evaluations = [], selectedSchemeName = '') => {
  const list = Array.isArray(evaluations) ? evaluations.filter(Boolean) : [];
  const seen = new Set();
  const unique = [];

  list.forEach((ev, index) => {
    const key = getSchemeKey(ev, index);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(ev);
  });

  const selectedName = normalizeSchemeName(selectedSchemeName);

  return unique.sort((a, b) => {
    // DSCR must remain visible first in View Calculation.
    // Previously selected/winning scheme (for example Net Worth) was sorted before DSCR,
    // so DSCR was hidden behind the horizontal tab list.
    const aDscr = isDscrEvaluation(a);
    const bDscr = isDscrEvaluation(b);
    if (aDscr !== bDscr) return aDscr ? -1 : 1;

    const aSelected = selectedName && namesMatch(a?.scheme_name || a?.best_scheme_name, selectedName);
    const bSelected = selectedName && namesMatch(b?.scheme_name || b?.best_scheme_name, selectedName);
    if (aSelected !== bSelected) return aSelected ? -1 : 1;

    const aEligible = Boolean(a?.is_eligible);
    const bEligible = Boolean(b?.is_eligible);
    if (aEligible !== bEligible) return aEligible ? -1 : 1;

    return 0;
  });
};

const getDscrMetric = (breakdown, camelKey, snakeKey, fallbackValue = null) => (
  firstPresent(breakdown?.[camelKey], breakdown?.[snakeKey], fallbackValue)
);

const isHdfcLender = (lender) => {
  const text = [
    lender?.lender_name,
    lender?.lenderName,
    lender?.lender_code,
    lender?.lenderCode,
    lender?.code,
    lender?.name
  ].filter(Boolean).join(' ').toUpperCase();
  return text.includes('HDFC');
};

const isUnsupportedHdfcLapMethod = (ev) => {
  const text = normalizeSchemeName(ev?.scheme_name || ev?.best_scheme_name || ev?.method_name || ev?.methodType);
  return text === 'LIP' || (text.includes('LOW') && text.includes('LTV')) || text.includes('NET WORTH') || text === 'NWM';
};

const extractEvaluationList = (evaluations, lender) => {
  const sources = [
    evaluations,
    lender?.scheme_evaluations,
    lender?.schemeEvaluations,
    lender?.evaluations,
    lender?.raw_payload?.scheme_evaluations,
    lender?.rawPayload?.schemeEvaluations,
    lender?.raw_payload?.lenders?.[0]?.scheme_evaluations,
    lender?.rawPayload?.lenders?.[0]?.schemeEvaluations
  ];

  const flat = [];
  sources.forEach(src => {
    if (Array.isArray(src)) flat.push(...src.filter(Boolean));
  });

  // Some APIs store the winning scheme directly on lender. Keep it as a fallback evaluation.
  if (lender?.best_scheme_name && !flat.some(e => namesMatch(e?.scheme_name, lender.best_scheme_name))) {
    flat.push({
      scheme_name: lender.best_scheme_name,
      is_eligible: lender.is_eligible,
      final_eligible_loan_amount: lender.final_eligible_loan_amount,
      eligible_loan_amount: lender.eligible_loan_amount,
      monthly_income_used: lender.monthly_income_used,
      foir_breakdown: lender.foir_breakdown,
      dscr_breakdown: lender.dscr_breakdown || lender.foir_breakdown?.dscr_breakdown,
      applicable_ltv_percent: lender.applicable_ltv_percent,
      applicable_ltv_key: lender.applicable_ltv_key,
      max_loan_by_ltv: lender.max_loan_by_ltv,
      ltv_based_eligible_loan_amount: lender.ltv_based_eligible_loan_amount,
      foir_based_eligible_loan_amount: lender.foir_based_eligible_loan_amount,
      maximum_eligible_emi: lender.maximum_eligible_emi,
      max_eligible_emi: lender.max_eligible_emi,
      proposed_emi: lender.proposed_emi,
      foir_allowed_percent: lender.foir_allowed_percent,
      foir_actual_percent: lender.foir_actual_percent
    });
  }

  return flat;
};

const buildDscrPlaceholderEvaluation = (lender) => {
  const dscrBreakdown = getDscrBreakdown(lender) || {};
  const hasDscrData = Object.keys(dscrBreakdown).length > 0;
  const finalLoan = hasDscrData ? firstPresent(
    lender?.dscr_eligible_loan_amount,
    lender?.dscrEligibleLoanAmount,
    lender?.final_eligible_loan_amount,
    lender?.eligible_loan_amount
  ) : 0;

  return {
    scheme_id: 'hdfc-dscr-placeholder',
    scheme_name: 'DSCR',
    is_eligible: Boolean(lender?.is_eligible && finalLoan),
    income_method_matched: false,
    monthly_income_used: firstPresent(
      lender?.monthly_income_used,
      dscrBreakdown?.monthlyEquivalentIncome,
      dscrBreakdown?.monthly_equivalent_income,
      dscrBreakdown?.annualIncome ? Number(dscrBreakdown.annualIncome) / 12 : null,
      0
    ),
    primary_monthly_income_used: firstPresent(
      dscrBreakdown?.monthlyEquivalentIncome,
      dscrBreakdown?.monthly_equivalent_income,
      0
    ),
    foir_breakdown: {
      skip_foir_check: true,
      dscr_breakdown: dscrBreakdown
    },
    dscr_breakdown: dscrBreakdown,
    final_eligible_loan_amount: finalLoan || 0,
    eligible_loan_amount: finalLoan || 0,
    foir_based_eligible_loan_amount: hasDscrData ? firstPresent(
      lender?.foir_based_eligible_loan_amount,
      lender?.foirBasedEligibleLoanAmount,
      finalLoan,
      0
    ) : 0,
    max_loan_by_ltv: hasDscrData ? (lender?.max_loan_by_ltv || null) : null,
    ltv_based_eligible_loan_amount: hasDscrData ? (lender?.ltv_based_eligible_loan_amount || lender?.max_loan_by_ltv || null) : null,
    applicable_ltv_percent: lender?.applicable_ltv_percent || null,
    applicable_ltv_key: lender?.applicable_ltv_key || null,
    max_eligible_emi: firstPresent(
      dscrBreakdown?.maxProposedMonthlyEmi,
      dscrBreakdown?.max_proposed_monthly_emi,
      lender?.max_eligible_emi,
      null
    ),
    maximum_eligible_emi: firstPresent(
      dscrBreakdown?.maxProposedMonthlyEmi,
      dscrBreakdown?.max_proposed_monthly_emi,
      lender?.maximum_eligible_emi,
      null
    ),
    proposed_emi: lender?.proposed_emi || null,
    foir_allowed_percent: null,
    foir_actual_percent: null,
    failure_reasons: hasDscrData ? [] : ['DSCR evaluation was not returned in scheme_evaluations. Run HDFC DSCR parameter script and regenerate ESR.'],
    warnings: hasDscrData ? [] : ['Frontend placeholder shown because HDFC DSCR scheme is missing from API response.']
  };
};

const normalizeEvaluationsForView = (evaluations, lender) => {
  const list = extractEvaluationList(evaluations, lender);

  // HDFC LAP policy does not contain LIP, Low LTV, or Net Worth Method.
  // Hide those legacy DB schemes for HDFC only; ICICI and other lenders are unaffected.
  const lenderScopedList = isHdfcLender(lender)
    ? list.filter(ev => !isUnsupportedHdfcLapMethod(ev))
    : list;

  // Do not create a fake HDFC DSCR row on the frontend. A placeholder produced
  // ₹0 / blank LTV cards and made the user think DSCR was calculated. DSCR must
  // come from backend scheme_evaluations with dscr_breakdown.
  return lenderScopedList;
};

// ─── Proposal status badge config ─────────────────────────────────────────────
const PROPOSAL_STATUS = {
  draft: { label: 'Draft', color: '#718096', bg: '#EDF2F7', icon: Clock },
  submitted: { label: 'Submitted', color: '#2B6CB0', bg: '#EBF8FF', icon: Send },
  accepted: { label: 'Accepted', color: '#276749', bg: '#F0FFF4', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: '#C53030', bg: '#FFF5F5', icon: XCircle },
  query_raised: { label: 'Query', color: '#C05621', bg: '#FFFBEB', icon: AlertCircle },
  resent: { label: 'Resent', color: '#6B46C1', bg: '#FAF5FF', icon: Send },
};

function ProposalBadge({ status }) {
  const cfg = PROPOSAL_STATUS[status] || PROPOSAL_STATUS.draft;
  const Icon = cfg.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}30`
    }}>
      <Icon size={10} /> {cfg.label}
    </span>
  );
}

// ─── Calculation Breakdown Panel ──────────────────────────────────────────────
const CalcBreakdownPanel = ({ evaluations, lender, monthlyIncome, selectedSchemeName, propertyValue, requestedLoanAmount }) => {
  const [open, setOpen] = useState(false);

  const orderedEvaluations = useMemo(
    () => getOrderedEvaluationsForView(normalizeEvaluationsForView(evaluations, lender), selectedSchemeName),
    [evaluations, lender, selectedSchemeName]
  );

  const getPreferredIndex = useCallback(() => {
    if (!orderedEvaluations || orderedEvaluations.length === 0) return 0;

    const dscrIndex = orderedEvaluations.findIndex(isDscrEvaluation);
    if (dscrIndex >= 0) return dscrIndex;

    if (selectedSchemeName) {
      const bySelected = orderedEvaluations.findIndex(e => namesMatch(e?.scheme_name || e?.best_scheme_name, selectedSchemeName));
      if (bySelected >= 0) return bySelected;
    }

    const eligibleIndex = orderedEvaluations.findIndex(e => e.is_eligible);
    if (eligibleIndex >= 0) return eligibleIndex;

    return 0;
  }, [orderedEvaluations, selectedSchemeName]);

  const [activeScheme, setActiveScheme] = useState(0);

  useEffect(() => {
    setActiveScheme(getPreferredIndex());
  }, [getPreferredIndex]);

  if (!orderedEvaluations || orderedEvaluations.length === 0) return null;

  const hasRealDscrEvaluation = orderedEvaluations.some(isDscrEvaluation);

  const safeActiveScheme = Math.min(activeScheme, orderedEvaluations.length - 1);
  const ev = orderedEvaluations[safeActiveScheme] || orderedEvaluations[getPreferredIndex()] || orderedEvaluations[0];
  const dscrBreakdown = getDscrBreakdown(ev);
  const isDscrScheme = isDscrEvaluation(ev);

  const dscrActual = getDscrMetric(dscrBreakdown, 'actualDscrRatio', 'actual_dscr_ratio', ev?.dscr_actual_ratio);
  const dscrMinimum = getDscrMetric(dscrBreakdown, 'minRatio', 'min_ratio', ev?.dscr_min_ratio);
  const dscrAnnualIncome = getDscrMetric(dscrBreakdown, 'annualIncome', 'annual_income', ev?.annual_income);
  const dscrExistingAnnualObligations = getDscrMetric(dscrBreakdown, 'existingAnnualObligations', 'existing_annual_obligations', ev?.existing_annual_obligations);
  const dscrMaxAnnualEmi = getDscrMetric(dscrBreakdown, 'maxProposedAnnualEmi', 'max_proposed_annual_emi', ev?.max_proposed_annual_emi);
  const dscrMaxMonthlyEmi = getDscrMetric(dscrBreakdown, 'maxProposedMonthlyEmi', 'max_proposed_monthly_emi', ev?.maximum_eligible_emi ?? ev?.max_eligible_emi);
  const dscrFinalAnnualDebtService = getDscrMetric(dscrBreakdown, 'finalAnnualDebtService', 'final_annual_debt_service', null);

  const schemeMonthlyIncome = ev?.monthly_income_used ?? ev?.foir_breakdown?.composed_income ?? (dscrAnnualIncome ? Number(dscrAnnualIncome) / 12 : monthlyIncome);
  const methodName = normalizeSchemeName(ev?.scheme_name || ev?.best_scheme_name || '');
  const isGrpScheme = methodName.includes('GRP') || methodName.includes('GROSS RECEIPT');
  const isManualScheme = methodName.includes('LOW LTV') || methodName.includes('LIP') || methodName.includes('MANUAL');
  const failureReasons = Array.isArray(ev?.failure_reasons) ? ev.failure_reasons : [];
  const isPrimaryApplicantNotSalaried = failureReasons.some(reason => String(reason).includes('PRIMARY_APPLICANT_NOT_SALARIED'))
    || ev?.reason_code === 'PRIMARY_APPLICANT_NOT_SALARIED';
  const netObligations = firstPresent(ev?.foir_breakdown?.net_obligations, 0);
  const eligibleEmi = firstPresent(ev?.maximum_eligible_emi, ev?.max_eligible_emi, ev?.foir_breakdown?.maximum_eligible_emi);
  const incomeBasedLoan = firstPresent(ev?.foir_based_eligible_loan_amount, ev?.dscr_eligible_loan_amount);
  const ltvBasedLoan = firstPresent(ev?.ltv_based_eligible_loan_amount, ev?.max_loan_by_ltv);
  const effectivePropertyValue = firstPresent(ev?.property_value, propertyValue);
  const productCap = firstPresent(ev?.product_cap, ev?.max_loan_amount);
  const requestedCap = firstPresent(ev?.requested_loan_cap, requestedLoanAmount);
  const incomeBreakdown = Array.isArray(ev?.eligible_income_breakdown) ? ev.eligible_income_breakdown : [];
  const coApplicantSalaryRow = incomeBreakdown.find(row => /CO-APPLICANT.*SALARY/i.test(String(row?.type || row?.source || '')));
  const coApplicantSalaryIncluded = firstPresent(coApplicantSalaryRow?.eligible_monthly, coApplicantSalaryRow?.amount, 0);
  const primaryMonthlyIncome = firstPresent(ev?.primary_monthly_income_used, ev?.foir_breakdown?.primary_composed_income, Number(schemeMonthlyIncome || 0) - Number(coApplicantSalaryIncluded || 0));
  const underwritingRoi = firstPresent(ev?.underwriting_roi_used, ev?.roi_max, ev?.roi_min);
  const finalTenureMonths = firstPresent(ev?.final_tenure_used, ev?.max_tenure_months);
  const roiRange = formatPolicyPercentRange(
    policyRateToFraction(ev?.roi_min),
    policyRateToFraction(ev?.roi_max)
  );
  const processingFeeRange = formatPolicyPercentRange(ev?.pf_min, ev?.pf_max);
  const actualLtv = firstPresent(
    ev?.actual_final_ltv_percent,
    Number(ev?.final_eligible_loan_amount) > 0 && Number(effectivePropertyValue) > 0
      ? Number(ev.final_eligible_loan_amount) / Number(effectivePropertyValue)
      : null
  );
  const coreCandidates = [incomeBasedLoan, ltvBasedLoan]
    .filter(value => value !== null && value !== undefined && Number(value) > 0)
    .map(Number);
  const coreMinimum = coreCandidates.length ? Math.min(...coreCandidates) : Infinity;
  const finalCandidates = [
    ['FOIR/Income', incomeBasedLoan],
    ['LTV', ltvBasedLoan],
    ['Product Cap', Number(productCap) > 0 && Number(productCap) < coreMinimum ? productCap : null],
    ['Requested Cap', Number(requestedCap) > 0 && Number(requestedCap) < coreMinimum ? requestedCap : null]
  ].filter(([, value]) => value !== null && value !== undefined && Number(value) > 0);
  const finalCandidateText = finalCandidates.map(([, value]) => formatExactCurrency(value, 0)).join(', ');

  const steps = [
    {
      label: 'Final Loan Amount',
      value: isPrimaryApplicantNotSalaried ? 'Not Eligible' : (ev.final_eligible_loan_amount != null ? formatDynamicCurrency(ev.final_eligible_loan_amount) : '—'),
      icon: '✅', color: ev.is_eligible ? '#276749' : '#C53030', bg: ev.is_eligible ? '#F0FFF4' : '#FFF5F5',
      note: ev.is_eligible ? 'Final method-specific eligible amount' : 'Failed eligibility', highlight: true
    },
    {
      label: 'Tenure',
      value: isPrimaryApplicantNotSalaried ? 'Not Applicable' : (finalTenureMonths != null ? `${finalTenureMonths} Months` : '—'),
      icon: '📅', color: '#2B6CB0', bg: '#EBF8FF',
      note: 'Final eligible tenure'
    },
    {
      label: 'ROI',
      value: isPrimaryApplicantNotSalaried ? 'Not Applicable' : (underwritingRoi != null ? `${Number(underwritingRoi).toFixed(2)}%` : '—'),
      icon: '📈', color: '#744210', bg: '#FFFBF0',
      note: `Policy range: ${roiRange}`
    },
    {
      label: 'PF', value: processingFeeRange,
      icon: '🧾', color: '#805AD5', bg: '#FAF5FF',
      note: 'Lender and method policy range'
    },
    {
      label: 'Monthly Income',
      value: isPrimaryApplicantNotSalaried ? 'Not Calculated' : `${formatDynamicCurrency(schemeMonthlyIncome)}/month`,
      icon: '💰', color: '#2B6CB0', bg: '#EBF8FF',
      note: 'Method-specific eligible monthly income'
    },
    {
      label: 'Actual FOIR',
      value: isPrimaryApplicantNotSalaried || !(Number(schemeMonthlyIncome) > 0) || ev.foir_actual_percent == null ? 'N/A' : fmtPct2(ev.foir_actual_percent),
      icon: '📉', color: '#276749', bg: '#F0FFF4',
      note: '(Obligations + proposed EMI) ÷ monthly income'
    },
    {
      label: 'Actual LTV',
      value: isPrimaryApplicantNotSalaried || actualLtv == null ? 'N/A' : fmtPct2(actualLtv),
      icon: '📐', color: '#553C9A', bg: '#FAF5FF',
      note: 'Final Eligible Loan Amount ÷ Property Value'
    }
  ];

  return (
    <div style={{ marginTop: 12 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 10px',
        background: 'var(--bg-elevated)', color: 'var(--primary)', border: '1px solid var(--primary)',
        borderRadius: 6, cursor: 'pointer', fontWeight: 600
      }}>
        <Calculator size={12} />
        {open ? 'Hide Calculation ↑' : 'View Calculation ↓'}
      </button>

      {open && (
        <div style={{ marginTop: 10, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {orderedEvaluations.length > 1 && (
            <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
              {orderedEvaluations.map((e, i) => (
                <button key={i} onClick={() => setActiveScheme(i)} style={{
                  flex: '0 0 auto', padding: '8px 12px', fontSize: 11, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: safeActiveScheme === i ? 'var(--primary)' : 'transparent',
                  color: safeActiveScheme === i ? '#fff' : 'var(--text-secondary)',
                }}>
                  {isDscrEvaluation(e) ? `DSCR · ${e.scheme_name}` : e.scheme_name}
                  <span style={{
                    marginLeft: 6, fontSize: 9, padding: '2px 6px', borderRadius: 10,
                    background: e.is_eligible ? '#9AE6B4' : '#FED7D7',
                    color: e.is_eligible ? '#22543D' : '#C53030'
                  }}>
                    {e.is_eligible ? '✓' : '✕'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {isHdfcLender(lender) && !hasRealDscrEvaluation && (
            <div style={{ margin: '10px 14px 0', padding: '9px 11px', background: '#FFFBEB', border: '1px solid #F6AD55', borderRadius: 8, fontSize: 11, color: '#92400E' }}>
              ⚠️ HDFC DSCR was not returned by backend. Run the HDFC DSCR parameter update and regenerate ESR; frontend will not show fake ₹0 DSCR values.
            </div>
          )}

          <div style={{ padding: '14px 14px 8px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {steps.map((step, i) => (
                <div key={i} style={{
                  background: step.highlight
                    ? (ev.is_eligible ? 'linear-gradient(135deg, #E6FFFA 0%, #C6F6D5 100%)' : 'linear-gradient(135deg, #FFF5F5 0%, #FED7D7 100%)')
                    : step.bg,
                  borderRadius: step.highlight ? 12 : 8,
                  padding: step.highlight ? '16px 18px' : '10px 12px',
                  border: step.highlight ? `3px solid ${step.color}` : '1px solid transparent',
                  gridColumn: step.highlight ? 'span 2' : 'span 1',
                  boxShadow: step.highlight ? `0 8px 20px ${ev.is_eligible ? 'rgba(39, 103, 73, 0.22)' : 'rgba(197, 48, 48, 0.18)'}` : 'none',
                }}>
                  <div style={{ fontSize: step.highlight ? 12 : 10, color: step.highlight ? step.color : '#718096', fontWeight: step.highlight ? 800 : 600, marginBottom: step.highlight ? 5 : 2, letterSpacing: step.highlight ? '0.03em' : 'normal' }}>
                    {step.icon} {step.label}
                  </div>
                  <div style={{ fontSize: step.highlight ? 26 : 15, fontWeight: 900, color: step.color, lineHeight: step.highlight ? 1.15 : 'normal' }}>
                    {step.value}
                  </div>
                  <div style={{ fontSize: step.highlight ? 11 : 10, color: step.highlight ? '#4A5568' : '#718096', marginTop: step.highlight ? 7 : 4, fontStyle: 'italic', fontWeight: step.highlight ? 600 : 400 }}>
                    {step.note}
                  </div>
                </div>
              ))}
            </div>

            {isDscrScheme && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: '#F7FAFC', borderRadius: 8, border: '1px solid #CBD5E0', fontSize: 11 }}>
                <div style={{ fontWeight: 800, color: '#2D3748', marginBottom: 6 }}>📌 DSCR Calculation Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#4A5568' }}>
                  <div>Annual Income: <strong>{dscrAnnualIncome != null ? formatDynamicCurrency(dscrAnnualIncome) : '—'}</strong></div>
                  <div>Minimum DSCR: <strong>{dscrMinimum != null ? `${Number(dscrMinimum).toFixed(2)}x` : '—'}</strong></div>
                  <div>Existing Annual Obligations: <strong>{dscrExistingAnnualObligations != null ? formatDynamicCurrency(dscrExistingAnnualObligations) : '—'}</strong></div>
                  <div>Max Annual EMI: <strong>{dscrMaxAnnualEmi != null ? formatDynamicCurrency(dscrMaxAnnualEmi) : '—'}</strong></div>
                  <div>Max Monthly EMI: <strong>{dscrMaxMonthlyEmi != null ? formatDynamicCurrency(Math.max(0, Number(dscrMaxMonthlyEmi))) : '—'}</strong></div>
                  <div>Actual DSCR: <strong>{dscrActual != null ? `${Number(dscrActual).toFixed(2)}x` : '—'}</strong></div>
                </div>
              </div>
            )}

            <div style={{
              marginTop: 10, padding: '8px 12px', background: '#1A202C', borderRadius: 8,
              fontSize: 10, color: '#A0AEC0', fontFamily: 'monospace', lineHeight: 1.8, wordBreak: 'break-word', whiteSpace: 'normal'
            }}>
              <div style={{ color: '#68D391', fontWeight: 700, marginBottom: 4 }}>📐 Calculation Trace</div>
              {isPrimaryApplicantNotSalaried ? (
                <>
                  <div style={{ color: '#FC8181', fontWeight: 700 }}>Salaried Method: Not Eligible</div>
                  <div>Primary applicant employment type is not SALARIED.</div>
                  <div>Salaried income, FOIR, EMI capacity, LTV and loan eligibility calculations were skipped.</div>
                  <div>A salaried co-applicant does not activate the standalone Salaried method.</div>
                </>
              ) : isDscrScheme ? (
                <>
                  <div>DSCR = Annual Income / (Existing Annual Obligations + Proposed Annual EMI)</div>
                  <div>Annual Income = {dscrAnnualIncome != null ? formatDynamicCurrency(dscrAnnualIncome) : '—'}</div>
                  <div>Existing Annual Obligations = {dscrExistingAnnualObligations != null ? formatDynamicCurrency(dscrExistingAnnualObligations) : '—'}</div>
                  <div>Max Annual EMI = {dscrMaxAnnualEmi != null ? formatDynamicCurrency(dscrMaxAnnualEmi) : '—'}</div>
                  <div>Max Monthly EMI = {dscrMaxMonthlyEmi != null ? formatDynamicCurrency(Math.max(0, Number(dscrMaxMonthlyEmi))) : (ev.max_eligible_emi != null ? formatDynamicCurrency(Math.max(0, ev.max_eligible_emi)) : '—')}</div>
                  <div>Final Annual Debt Service = {dscrFinalAnnualDebtService != null ? formatDynamicCurrency(dscrFinalAnnualDebtService) : '—'}</div>
                </>
              ) : isGrpScheme ? (
                <>
                  <div>GRP-Based Loan Eligibility = Gross Receipts × Lender Multiplier − Exposure</div>
                  <div>Direct GRP Eligibility = {incomeBasedLoan != null ? formatExactCurrency(incomeBasedLoan, 0) : '—'}</div>
                </>
              ) : isManualScheme ? (
                <>
                  <div>This method uses the approved manual/policy eligibility amount.</div>
                  <div>Manual Loan Eligibility = {incomeBasedLoan != null ? formatExactCurrency(incomeBasedLoan, 0) : '—'}</div>
                </>
              ) : (
                <>
                  {methodName.includes('GST') && coApplicantSalaryIncluded > 0 ? (
                    <>
                      <div>Eligible Monthly Income = GST Income + Co-applicant Net Salary</div>
                      <div>= {formatExactCurrency(primaryMonthlyIncome)} + {formatExactCurrency(coApplicantSalaryIncluded)}</div>
                      <div>= {formatExactCurrency(schemeMonthlyIncome)}</div>
                    </>
                  ) : methodName.includes('NET PROFIT') || methodName.includes('NPM') ? (
                    <>
                      <div>Eligible Monthly Income = NPM Income{coApplicantSalaryIncluded > 0 ? ' + Co-applicant Net Salary' : ''}</div>
                      <div>= {formatExactCurrency(primaryMonthlyIncome)}{coApplicantSalaryIncluded > 0 ? ` + ${formatExactCurrency(coApplicantSalaryIncluded)}` : ''}</div>
                      <div>= {formatExactCurrency(schemeMonthlyIncome)}</div>
                    </>
                  ) : (
                    <div>Eligible Monthly Income = {formatExactCurrency(schemeMonthlyIncome)}</div>
                  )}
                  <div style={{ marginTop: 4 }}>Eligible EMI Capacity = (Eligible Income × FOIR) − Obligations</div>
                  <div>= ({formatExactCurrency(schemeMonthlyIncome)} × {fmtPct2(ev.foir_allowed_percent)}) − {formatExactCurrency(netObligations)}</div>
                  <div>= {eligibleEmi != null ? formatExactCurrency(Math.max(0, Number(eligibleEmi))) : '—'}</div>
                  <div style={{ marginTop: 4 }}>FOIR-Based Loan Eligibility = Reverse EMI at {underwritingRoi != null ? `${Number(underwritingRoi).toFixed(2)}%` : '—'} for {finalTenureMonths ?? '—'} months</div>
                  <div>= {incomeBasedLoan != null ? formatExactCurrency(incomeBasedLoan, 0) : '—'}</div>
                </>
              )}
              {!isPrimaryApplicantNotSalaried && ltvBasedLoan != null && (
                <>
                  <div style={{ marginTop: 4 }}>LTV-Based Loan Eligibility = Property Value × Applicable LTV</div>
                  <div>= {formatExactCurrency(effectivePropertyValue, 0)} × {fmtPct2(ev.applicable_ltv_percent)}</div>
                  <div>= {formatExactCurrency(ltvBasedLoan, 0)}</div>
                </>
              )}
              {isPrimaryApplicantNotSalaried ? (
                <div style={{ color: '#FC8181', marginTop: 4 }}>Final Eligible Loan Amount = Not Eligible</div>
              ) : (
                <>
                  <div style={{ color: '#68D391', marginTop: 4 }}>Final Eligible Loan = MIN({finalCandidateText || 'available policy limits'})</div>
                  <div style={{ color: '#68D391' }}>= {ev.final_eligible_loan_amount != null ? formatExactCurrency(ev.final_eligible_loan_amount, 0) : '—'}</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Scheme Diagnostics ───────────────────────────────────────────────────────
const SchemeDiagnosticsPanel = ({ evaluations, lender }) => {
  const [open, setOpen] = useState(false);

  const normalizedEvaluations = useMemo(() => {
    const list = normalizeEvaluationsForView(evaluations, lender);
    return getOrderedEvaluationsForView(list, lender?.best_scheme_name || lender?.bestSchemeName || '');
  }, [evaluations, lender]);

  if (!normalizedEvaluations || normalizedEvaluations.length === 0) return null;

  const renderDscrDiagnostics = (ev) => {
    const dscrBreakdown = getDscrBreakdown(ev) || {};
    const dscrMinimum = getDscrMetric(dscrBreakdown, 'minRatio', 'min_ratio', ev?.dscr_min_ratio);
    const dscrActual = getDscrMetric(dscrBreakdown, 'actualDscrRatio', 'actual_dscr_ratio', ev?.dscr_actual_ratio);
    const annualIncome = getDscrMetric(dscrBreakdown, 'annualIncome', 'annual_income', ev?.annual_income);
    const existingAnnualObligations = getDscrMetric(dscrBreakdown, 'existingAnnualObligations', 'existing_annual_obligations', ev?.existing_annual_obligations);
    const maxAnnualEmi = getDscrMetric(dscrBreakdown, 'maxProposedAnnualEmi', 'max_proposed_annual_emi', ev?.max_proposed_annual_emi);
    const maxMonthlyEmi = getDscrMetric(dscrBreakdown, 'maxProposedMonthlyEmi', 'max_proposed_monthly_emi', ev?.maximum_eligible_emi ?? ev?.max_eligible_emi);
    const dscrEligibleLoan = firstPresent(
      ev?.dscr_eligible_loan_amount,
      ev?.dscrEligibleLoanAmount,
      ev?.foir_based_eligible_loan_amount,
      ev?.final_eligible_loan_amount,
      ev?.eligible_loan_amount
    );

    return (
      <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: '#F7FAFC', border: '1px solid #CBD5E0' }}>
        <div style={{ fontWeight: 700, color: '#2D3748', marginBottom: 6 }}>DSCR Diagnostics</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
          <div>DSCR Required: <strong>{dscrMinimum != null ? `${Number(dscrMinimum).toFixed(2)}x` : '—'}</strong></div>
          <div>DSCR Actual: <strong>{dscrActual != null ? `${Number(dscrActual).toFixed(2)}x` : '—'}</strong></div>
          <div>Annual Income: <strong>{annualIncome != null ? formatDynamicCurrency(annualIncome) : '—'}</strong></div>
          <div>Existing Annual Obligation: <strong>{existingAnnualObligations != null ? formatDynamicCurrency(existingAnnualObligations) : '—'}</strong></div>
          <div>Max Annual EMI: <strong>{maxAnnualEmi != null ? formatDynamicCurrency(maxAnnualEmi) : '—'}</strong></div>
          <div>Max Monthly EMI: <strong>{maxMonthlyEmi != null ? formatDynamicCurrency(Math.max(0, Number(maxMonthlyEmi))) : '—'}</strong></div>
          <div style={{ gridColumn: '1 / -1' }}>DSCR Eligible Loan: <strong>{dscrEligibleLoan != null ? formatDynamicCurrency(dscrEligibleLoan) : '—'}</strong></div>
        </div>
        {!Object.keys(dscrBreakdown).length && (
          <div style={{ marginTop: 6, color: '#D97706', fontSize: 11 }}>
            DSCR breakdown is not present in this ESR response. Regenerate ESR after running HDFC DSCR config script.
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-ghost" onClick={() => setOpen(!open)}
        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}>
        {open ? 'Hide Diagnostics ↑' : 'View Scheme Diagnostics ↓'}
      </button>
      {open && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12 }}>
          {normalizedEvaluations.map((ev, i) => {
            const isDscr = isDscrEvaluation(ev);
            return (
              <div key={getSchemeKey(ev, i)} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i === normalizedEvaluations.length - 1 ? 'none' : '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{isDscr ? `DSCR · ${ev.scheme_name || 'DSCR'}` : ev.scheme_name}</strong>
                  <span style={{ color: ev.is_eligible ? 'var(--success)' : 'var(--error)' }}>
                    {ev.is_eligible ? 'Eligible' : 'Ineligible'}
                  </span>
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginBottom: 6 }}>
                  LTV: {ev.applicable_ltv_percent ? `${(ev.applicable_ltv_percent * 100).toFixed(0)}%` : '—'} ({ev.applicable_ltv_key || '—'})
                  <br />Method Matched: {ev.income_method_matched ? 'Yes' : 'No'}
                  {isDscr && <><br />Method Type: DSCR</>}
                </div>
                {isDscr && renderDscrDiagnostics(ev)}
                {ev.failure_reasons?.length > 0 && (
                  <ul style={{ color: 'var(--error)', paddingLeft: 16, margin: '4px 0' }}>
                    {ev.failure_reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                  </ul>
                )}
                {ev.warnings?.length > 0 && (
                  <ul style={{ color: '#D97706', paddingLeft: 16, margin: '4px 0' }}>
                    {ev.warnings.map((w, wi) => <li key={wi}>{w}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── Lender Action Button (multi-proposal aware) ───────────────────────────────
function LenderActions({ lender, caseId, proposals, onProposalCreated, onSendToLender, onSendToOtherLender, onSendToCred2TechTeam }) {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isMsme = hasRole('MSME_CUSTOMER');
  const [creating, setCreating] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [sending, setSending] = useState(false);

  // Find existing proposals for this lender
  const lenderProposals = proposals.filter(p => String(p.lender_id) === String(lender.lender_id));
  const latestProposal = lenderProposals[lenderProposals.length - 1] || null;

  // Find the most recent submitted proposal from any other lender for clone
  const otherSubmitted = proposals.find(p =>
    String(p.lender_id) !== String(lender.lender_id) && p.proposal_status === 'submitted'
  ) || proposals.find(p => String(p.lender_id) !== String(lender.lender_id));


  const handlePrepare = async () => {
    // If there are proposals from other lenders, ask to clone
    if (otherSubmitted && lenderProposals.length === 0) {
      setShowCloneDialog(true);
      return;
    }
    await doCreate(null);
  };

  const doCreate = async (cloneSourceId) => {
    try {
      setCreating(true);
      let result;
      if (cloneSourceId) {
        result = await caseService.cloneProposal(caseId, cloneSourceId, {
          new_lender_id: lender.lender_id,
          new_scheme_id: lender.scheme_evaluations?.[0]?.scheme_id || null,
        });
        result = result.proposal;
      } else {
        const r = await caseService.createProposal(caseId, {
          lender_id: lender.lender_id,
          scheme_id: lender.scheme_evaluations?.find(s => s.is_eligible)?.scheme_id || null,
        });
        result = r.proposal;
      }
      onProposalCreated();
      toast.success(`Proposal created: ${result.proposal_number}`);
      navigate(`/cases/${caseId}/proposals/${result.id}`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to create proposal');
    } finally {
      setCreating(false);
      setShowCloneDialog(false);
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      {/* Clone dialog */}
      {showCloneDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-primary)', width: '90%', maxWidth: 440, borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#EBF8FF', color: '#2B6CB0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                  📋
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Reuse Existing Proposal?</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>For {lender.lender_name}</p>
                </div>
              </div>
              <button onClick={() => setShowCloneDialog(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                <X size={20} />
              </button>
            </div>
            
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5, background: 'var(--bg-elevated)', padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
              A proposal was already prepared (<strong>#{otherSubmitted?.proposal_number}</strong>). 
              Would you like to reuse its data and documents for this new proposal?
            </div>
            
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowCloneDialog(false); doCreate(null); }}
                disabled={creating}
                style={{
                  padding: '10px 18px', fontSize: 13, fontWeight: 600,
                  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer'
                }}>
                No, Start Fresh
              </button>
              <button
                onClick={() => doCreate(otherSubmitted.id)}
                disabled={creating}
                style={{
                  padding: '10px 18px', fontSize: 13, fontWeight: 600,
                  background: '#2B6CB0', color: '#fff', border: 'none',
                  borderRadius: 8, cursor: 'pointer'
                }}>
                {creating ? 'Cloning...' : '✅ Yes, Clone Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Existing proposal badges + view button */}
      {lenderProposals.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {lenderProposals.map(p => (
            <ProposalBadge key={p.id} status={p.lender_submission_status || p.proposal_status} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {latestProposal ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
            <button
              onClick={() => navigate(`/cases/${caseId}/proposals/${latestProposal.id}`)}
              style={{
                flex: 1, padding: '10px', fontSize: 13, fontWeight: 700,
                background: '#EDF2F7', color: '#2D3748', border: '1px solid #CBD5E0',
                borderRadius: 8, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
              }}>
              <span>👀</span> View Active Proposal
            </button>
            <button
              onClick={() => setShowCloneDialog(true)}
              disabled={creating}
              style={{
                padding: '10px 14px', fontSize: 13, fontWeight: 600,
                background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer'
              }}>
              {creating ? '...' : 'Create New'}
            </button>
          </div>
        ) : (
          <>
            <button
              className="btn btn-primary"
              style={{
                flex: 1, padding: '10px', fontWeight: 700,
                background: 'linear-gradient(135deg,#2B6CB0,#553C9A)'
              }}
              onClick={handlePrepare}
              disabled={creating}
            >
              {creating ? 'Preparing...' : '📋 Prepare Proposal →'}
            </button>
            <button
              onClick={onSendToOtherLender}
              title="Prepare proposal for a different lender contact"
              style={{
                padding: '9px 12px', fontWeight: 700, fontSize: 11, borderRadius: 8,
                background: 'transparent', color: '#553C9A', border: '1px solid #553C9A',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap'
              }}
            >
              🔄 Other Lender
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main EsrPage ─────────────────────────────────────────────────────────────
export default function EsrPage() {
  const { id: caseId } = useParams();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isMsme = hasRole('MSME_CUSTOMER');
  const [sendConfirmResult, setSendConfirmResult] = useState(null);
  const [showOtherLenderModal, setShowOtherLenderModal] = useState(false);
  const [submittingToTeam, setSubmittingToTeam] = useState(false);

  const handleSendToCred2TechTeam = async () => {
    try {
      setSubmittingToTeam(true);
      await api.post(`/msme/case/submit`, { caseId });
      toast.success('Case submitted to Cred2Tech Team successfully!');
      navigate('/msme/dashboard');
    } catch(err) {
      toast.error('Failed to submit case to team');
    } finally {
      setSubmittingToTeam(false);
    }
  };

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [esr, setEsr] = useState(null);
  const [proposals, setProposals] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [esrResult, proposalsResult] = await Promise.allSettled([
        caseService.getESR(caseId),
        caseService.listProposals(caseId),
      ]);
      if (esrResult.status === 'fulfilled') setEsr(esrResult.value);
      else if (esrResult.reason?.response?.status !== 404) toast.error('Failed to load ESR');
      if (proposalsResult.status === 'fulfilled') setProposals(proposalsResult.value.proposals || []);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    try {
      setGenerating(true);
      const result = esr
        ? await caseService.recalculateESR(caseId)
        : await caseService.generateESR(caseId);
      await load();
      const eligibleCount = result.eligible_count ?? result.eligible_lenders_count ?? (result.lenders || []).filter(l => l.is_eligible).length;
      toast.success(`ESR ${esr ? 'regenerated' : 'generated'}! ${eligibleCount} lender(s) eligible.`);
    } catch (e) {
      toast.error(e.response?.data?.error || `Failed to ${esr ? 'regenerate' : 'generate'} ESR`);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <LoadingSpinner size={40} />
    </div>
  );

  const lenders = esr?.lenders || [];
  const eligibleLenders = lenders.filter(l => l.is_eligible);
  const ineligibleLenders = lenders.filter(l => !l.is_eligible);

  // Use snapshot data for income summary if available, else fallback to main fields
  const monthlyIncome = esr?.input_snapshot?.selected_monthly_income
    || (esr?.combined_income ? esr.combined_income / 12 : null);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
            Eligibility Summary Report
          </h1>
          <p style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
            {esr
              ? `Generated ${new Date(esr.generated_at).toLocaleString('en-IN')} · ${eligibleLenders.length} eligible of ${lenders.length} lenders · ${proposals.length} proposal(s)`
              : 'Run the eligibility engine to see matching lenders'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={() => navigate(`/cases/${caseId}/bureau-obligations`)}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="btn btn-secondary" onClick={handleGenerate} disabled={generating}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={generating ? 'spin' : ''} />
            {generating ? 'Generating...' : (esr ? 'Regenerate ESR' : 'Generate ESR')}
          </button>
          {esr && !isMsme && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowOtherLenderModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={14} /> Other Lender
            </button>
          )}
        </div>
      </div>

      {/* Snapshot summary */}
      {esr && (
        <div className="card" style={{ marginBottom: 24, padding: 0 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg,#EBF4FF,transparent)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>📋 Input Snapshot</h3>
          </div>
          <div style={{ padding: '16px 24px', display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {[
              { label: 'Combined Annual Income', value: fmt(esr.combined_income) },
              { label: 'Property Value', value: fmt(esr.property_value) },
              { label: 'Primary CIBIL', value: esr.primary_cibil_score || '—' },
              { label: 'Lowest CIBIL', value: esr.lowest_cibil_score || '—' },
              { label: 'Total EMI / Month', value: fmt(esr.total_emi_per_month) }
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{value || '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No ESR yet */}
      {!esr && !generating && (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No ESR generated yet</h3>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: 24 }}>Click <strong>Generate ESR</strong> to run the eligibility engine against all active lenders.</p>
          <button className="btn btn-primary btn-lg" onClick={handleGenerate} disabled={generating} style={{ padding: '14px 36px' }}>
            {generating ? 'Generating...' : '⚡ Generate Eligibility Report'}
          </button>
        </div>
      )}

      {/* Eligible Lenders */}
      {eligibleLenders.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <CheckCircle size={18} color="var(--success)" />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--success)' }}>Eligible Lenders ({eligibleLenders.length})</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {eligibleLenders.map(lender => (
              <div key={lender.lender_id} className="card" style={{ borderTop: '3px solid var(--success)', position: 'relative' }}>
                <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{lender.lender_name}</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                        {lender.product_display_name || lender.product_type} · {lender.best_scheme_name}
                      </p>
                    </div>
                    <span style={{
                      background: '#F0FFF4', color: 'var(--success)', padding: '4px 10px',
                      borderRadius: 20, fontSize: 11, fontWeight: 700, border: '1px solid #9AE6B4'
                    }}>✓ ELIGIBLE</span>
                  </div>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 4 }}>
                    {[
                      { label: 'Loan Amount', value: formatDynamicCurrency(lender.eligible_amount), color: 'var(--success)' },
                      { label: 'ROI', value: lender.roi ? `${lender.roi}% p.a.` : '—', color: 'var(--text-primary)' },
                      { label: 'LTV', value: lender.ltv ? `${(lender.ltv * 100).toFixed(0)}%` : '—', color: 'var(--text-primary)' },
                      { label: 'Max Tenure', value: formatDynamicTenure(lender.tenure_months), color: 'var(--text-primary)' }
                    ].map(({ label, value, color }) => value && (
                      <div key={label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <CalcBreakdownPanel evaluations={lender.scheme_evaluations} lender={lender} monthlyIncome={monthlyIncome} selectedSchemeName={lender.best_scheme_name} propertyValue={esr.property_value} requestedLoanAmount={esr.requested_loan_amount} />
                  <SchemeDiagnosticsPanel evaluations={lender.scheme_evaluations} lender={lender} />

                  {/* Proposal Actions */}
                  <LenderActions
                    lender={lender}
                    caseId={caseId}
                    proposals={proposals}
                    onProposalCreated={load}
                    onSendToLender={setSendConfirmResult}
                    onSendToOtherLender={() => setShowOtherLenderModal(true)}
                    onSendToCred2TechTeam={handleSendToCred2TechTeam}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {esr && eligibleLenders.length === 0 && ineligibleLenders.length > 0 && !isMsme && (
        <div className="card" style={{ marginBottom: 24, padding: '18px 22px', borderLeft: '4px solid #553C9A' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>No eligible lender found</h3>
              <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
                You can still create a proposal and send this case to another lender.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowOtherLenderModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={14} /> Send to Other Lender
            </button>
          </div>
        </div>
      )}

      {/* Ineligible Lenders */}
      {ineligibleLenders.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <XCircle size={18} color="var(--text-tertiary)" />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-secondary)' }}>Not Eligible ({ineligibleLenders.length})</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {ineligibleLenders.map(lender => (
              <div key={lender.lender_id} className="card" style={{ borderTop: '3px solid var(--border)', opacity: 0.85 }}>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-secondary)' }}>{lender.lender_name}</h3>
                    <span style={{
                      background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', padding: '3px 8px',
                      borderRadius: 20, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)'
                    }}>✕ INELIGIBLE</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
                    {lender.product_display_name || lender.product_type}
                  </p>
                  {lender.remarks && (
                    <div style={{
                      marginTop: 10, padding: '8px 10px', background: '#FFF5F5', borderRadius: 6,
                      fontSize: 11, color: 'var(--error)', border: '1px solid #FED7D7'
                    }}>
                      ❌ {lender.remarks}
                    </div>
                  )}
                  <CalcBreakdownPanel evaluations={lender.scheme_evaluations} lender={lender} monthlyIncome={monthlyIncome} selectedSchemeName={lender.best_scheme_name} propertyValue={esr.property_value} requestedLoanAmount={esr.requested_loan_amount} />
                  <SchemeDiagnosticsPanel evaluations={lender.scheme_evaluations} lender={lender} />

                  {/* Proposal Actions (Manual Override) */}
                  <LenderActions
                    lender={lender}
                    caseId={caseId}
                    proposals={proposals}
                    onProposalCreated={load}
                    onSendToLender={setSendConfirmResult}
                    onSendToOtherLender={() => setShowOtherLenderModal(true)}
                    onSendToCred2TechTeam={handleSendToCred2TechTeam}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      <SendConfirmationModal
        isOpen={!!sendConfirmResult}
        onClose={() => setSendConfirmResult(null)}
        result={sendConfirmResult}
      />
      <SendToOtherLenderModal
        isOpen={showOtherLenderModal}
        onClose={() => setShowOtherLenderModal(false)}
        caseId={caseId}
        caseProductType={esr?.input_snapshot?.product_type}
        onSuccess={r => { setShowOtherLenderModal(false); setSendConfirmResult(r); }}
      />
    </div>
  );
}
