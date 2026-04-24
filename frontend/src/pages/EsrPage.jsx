import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { caseService } from '../api/caseService';
import { toast } from 'react-hot-toast';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { CheckCircle, XCircle, RefreshCw, ChevronLeft } from 'lucide-react';

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

// Extracted Schemes Panel Component
const SchemeDiagnosticsPanel = ({ evaluations }) => {
  const [open, setOpen] = useState(false);
  if (!evaluations || evaluations.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <button 
        className="btn btn-ghost" 
        onClick={() => setOpen(!open)}
        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
      >
        {open ? 'Hide Diagnostics ↑' : 'View Scheme Diagnostics ↓'}
      </button>
      {open && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 12 }}>
          {evaluations.map((ev, i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i === evaluations.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>{ev.scheme_name}</strong>
                <span style={{ color: ev.is_eligible ? 'var(--success)' : 'var(--error)' }}>
                  {ev.is_eligible ? 'Eligible' : 'Ineligible'}
                </span>
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: 11, marginBottom: 6 }}>
                LTV: {ev.applicable_ltv_percent ? `${(ev.applicable_ltv_percent * 100).toFixed(0)}%` : '—'} ({ev.applicable_ltv_key})
                <br/>Method Matched: {ev.income_method_matched ? 'Yes' : 'No'}
              </div>
              {ev.failure_reasons && ev.failure_reasons.length > 0 && (
                <ul style={{ color: 'var(--error)', paddingLeft: 16, margin: '4px 0' }}>
                  {ev.failure_reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                </ul>
              )}
              {ev.warnings && ev.warnings.length > 0 && (
                <ul style={{ color: '#D97706', paddingLeft: 16, margin: '4px 0' }}>
                  {ev.warnings.map((w, wi) => <li key={wi}>{w}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function EsrPage() {
  const { id: caseId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [esr, setEsr]               = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await caseService.getESR(caseId);
      setEsr(result);
    } catch (e) {
      // ESR not yet generated — normal on first load
      if (e.response?.status === 404) {
        setEsr(null);
      } else {
        toast.error('Failed to load ESR');
      }
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      const result = await caseService.generateESR(caseId);
      // After generation, fetch the persisted report
      await load();
      toast.success(`ESR generated! ${result.eligible_count} lender(s) eligible.`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to generate ESR');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <LoadingSpinner size={40} />
    </div>
  );

  const lenders = esr?.raw_payload?.lenders || [];
  const eligibleLenders   = lenders.filter(l => l.is_eligible);
  const ineligibleLenders = lenders.filter(l => !l.is_eligible);

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
              ? `Generated ${new Date(esr.generated_at).toLocaleString('en-IN')} · ${eligibleLenders.length} eligible of ${lenders.length} lenders`
              : 'Run the eligibility engine to see matching lenders'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={() => navigate(`/cases/${caseId}/bureau-obligations`)}>
            <ChevronLeft size={16} /> Back
          </button>
          <button className="btn btn-secondary" onClick={handleGenerate} disabled={generating} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} className={generating ? 'spin' : ''} />
            {generating ? 'Generating...' : (esr ? 'Regenerate ESR' : 'Generate ESR')}
          </button>
        </div>
      </div>

      {/* Snapshot summary (if ESR exists) */}
      {esr && (
        <div className="card" style={{ marginBottom: 24, padding: 0 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg,#EBF4FF,transparent)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>📋 Input Snapshot</h3>
          </div>
          <div style={{ padding: '16px 24px', display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            {[
              { label: 'Combined Annual Income', value: fmt(esr.combined_income) },
              { label: 'Property Value',          value: fmt(esr.property_value) },
              { label: 'Primary CIBIL',           value: esr.primary_cibil_score || '—' },
              { label: 'Lowest CIBIL',            value: esr.lowest_cibil_score || '—' },
              { label: 'Total EMI / Month',        value: fmt(esr.total_emi_per_month) }
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{value || '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No ESR yet placeholder */}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {eligibleLenders.map(lender => (
              <div key={lender.lender_id} className="card" style={{ borderTop: '3px solid var(--success)', position: 'relative' }}>
                <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{lender.lender_name}</h3>
                      <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{lender.product_display_name || lender.product_type} · {lender.best_scheme_name}</p>
                    </div>
                    <span style={{ background: '#F0FFF4', color: 'var(--success)', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: '1px solid #9AE6B4' }}>✓ ELIGIBLE</span>
                  </div>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                    {[
                      { label: 'Loan Amount',   value: formatDynamicCurrency(lender.final_eligible_loan_amount), color: 'var(--success)' },
                      { 
                        label: 'ROI',  
                        value: lender.roi_min ? `${lender.roi_min}% p.a.` + (lender.roi_max ? ` - ${lender.roi_max}% p.a.` : '') : '—', 
                        color: 'var(--text-primary)' 
                      },
                      { label: 'LTV', value: lender.applicable_ltv_percent ? `${(lender.applicable_ltv_percent * 100).toFixed(0)}%` : '—', color: 'var(--text-primary)' },
                      { label: 'Max Tenure', value: formatDynamicTenure(lender.max_tenure_months), color: 'var(--text-primary)' }
                    ].map(({ label, value, color }) => value && (
                      <div key={label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  <SchemeDiagnosticsPanel evaluations={lender.scheme_evaluations} />

                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '10px', fontWeight: 700, marginTop: 12 }}
                    onClick={() => {
                      toast.success(`Lender selected: ${lender.lender_name}`);
                      navigate('/customers');
                    }}
                  >
                    Select {lender.lender_name} →
                  </button>
                </div>
              </div>
            ))}
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
              <div key={lender.lender_id} className="card" style={{ borderTop: '3px solid var(--border)', opacity: 0.75 }}>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-secondary)' }}>{lender.lender_name}</h3>
                    <span style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)' }}>✕ INELIGIBLE</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5 }}>{lender.product_display_name || lender.product_type}</p>
                  
                  {lender.ineligibility_reason && (
                    <div style={{ marginTop: 10, padding: '8px 10px', background: '#FFF5F5', borderRadius: 6, fontSize: 11, color: 'var(--error)', border: '1px solid #FED7D7' }}>
                      ❌ {lender.ineligibility_reason}
                    </div>
                  )}

                  <SchemeDiagnosticsPanel evaluations={lender.scheme_evaluations} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
