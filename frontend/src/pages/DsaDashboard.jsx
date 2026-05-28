import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getDsaSummary, getDsaWallet, getDsaRecentCases, getDsaStageSummary
} from '../api/dashboardService';
import {
  Target, Search, CheckCircle2, Coins, RefreshCw, UserPlus, Users,
  List, BadgeDollarSign, TrendingUp, TrendingDown, Minus, Wallet
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 60_000;

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'mtd',   label: 'Month to Date' },
  { key: 'ytd',   label: 'Year to Date' },
];

const STAGE_ORDER = [
  'Lead Created', 'Data Pulled', 'Eligibility Report Generated',
  'Lead Sent to Lender', 'Under Process', 'Sanctioned Undisbursed',
  'Partly Disbursed', 'Closed', 'Closed Leads',
];

const STAGE_COLORS = {
  LEAD_CREATED:       '#4F46E5',
  DATA_COLLECTION:    '#0284C7',
  INCOME_REVIEWED:    '#0284C7',
  ESR_GENERATED:      '#059669',
  LEAD_SENT_TO_LENDER:'#F59E0B',
  IN_REVIEW:          '#F59E0B',
  APPROVED:           '#10B981',
  PARTLY_DISBURSED:   '#6366F1',
  DISBURSED:          '#10B981',
  CLOSED:             '#94A3B8',
  REJECTED:           '#EF4444',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

function TrendBadge({ count, pct }) {
  const up = count > 0;
  const down = count < 0;
  if (count === 0) return <span style={{ fontSize: 12, color: '#94A3B8' }}>— vs prev period</span>;
  return (
    <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 3,
      color: up ? '#10B981' : '#EF4444' }}>
      {up ? <TrendingUp size={13}/> : <TrendingDown size={13}/>}
      {up ? '+' : ''}{count} vs prev period
    </span>
  );
}

function StageBadge({ stage }) {
  const color = STAGE_COLORS[stage] || '#94A3B8';
  const label = stage?.replace(/_/g, ' ') || '—';
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: `${color}18`, color, border: `1px solid ${color}30`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, iconBg, title, count, amount, trend_count, trend_pct, loading }) {
  return (
    <div className="card" style={{ padding: 24, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: iconBg, flexShrink: 0,
        }}>
          <Icon size={20} />
        </div>
      </div>
      {loading ? (
        <div className="skeleton" style={{ height: 36, width: 80, marginBottom: 8 }} />
      ) : (
        <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {count}
        </div>
      )}
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 6 }}>{title}</div>
      {amount !== undefined && !loading && (
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          {fmt(amount)}
        </div>
      )}
      {!loading && <TrendBadge count={trend_count ?? 0} pct={trend_pct ?? 0} />}
    </div>
  );
}

// ─── Quick Action Button ───────────────────────────────────────────────────────
function QuickBtn({ label, icon: Icon, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '13px 18px', borderRadius: 10, cursor: 'pointer',
        border: '1.5px solid var(--border)', background: 'var(--bg-surface)',
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 500,
        color: 'var(--text-primary)', textAlign: 'left', transition: 'all 0.15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = `${color}08`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
    >
      {Icon && <Icon size={16} color={color} />}
      {label}
    </button>
  );
}

// ─── Main DSA Dashboard ────────────────────────────────────────────────────────
export default function DsaDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [period, setPeriod]       = useState('mtd');
  const [summary, setSummary]     = useState(null);
  const [wallet, setWallet]       = useState(null);
  const [cases, setCases]         = useState([]);
  const [stages, setStages]       = useState({});
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [s, w, c, st] = await Promise.all([
        getDsaSummary(period),
        getDsaWallet(),
        getDsaRecentCases(period),
        getDsaStageSummary(period),
      ]);
      setSummary(s);
      setWallet(w);
      setCases(Array.isArray(c) ? c : []);
      setStages(st || {});
      setLastUpdated(new Date());
    } catch (e) {
      console.error('[DsaDashboard] fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  // Initial load
  useEffect(() => { setLoading(true); fetchAll(); }, [fetchAll]);

  // Auto-refresh every 60s
  useEffect(() => {
    intervalRef.current = setInterval(() => fetchAll(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  const dsaName = user?.name || 'DSA';
  const monthLabel = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>

      {/* ── Monthly Summary Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, #1E3A5F 0%, #2D5A9E 60%, #1B4B82 100%)',
        borderRadius: 16, padding: '22px 28px', marginBottom: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
            Monthly Summary
          </div>
          <div style={{ fontSize: 13, color: '#A8C4E4' }}>
            {dsaName} — {user?.tenant_id ? `DSA${String(user.tenant_id).padStart(3,'0')}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Period filters */}
          <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: 4 }}>
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} style={{
                padding: '5px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: period === p.key ? '#fff' : 'transparent',
                color: period === p.key ? '#1E3A5F' : '#D4E9FF',
                fontFamily: 'inherit',
              }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            style={{
              background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 8,
              padding: '7px 10px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center',
            }}
            title="Refresh dashboard"
          >
            <RefreshCw size={15} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
          </button>

          {/* Wallet */}
          <div style={{
            background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: '7px 14px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Wallet size={15} color="#7ECBF5" />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#7ECBF5' }}>
              {wallet !== null ? `${wallet.balance?.toLocaleString() ?? 0} credits` : '— credits'}
            </span>
            <span style={{ fontSize: 11, color: '#A8C4E4' }}>Rs 1 = 1 credit</span>
          </div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard
          icon={Target} iconBg="#EEF2FF"
          title="Leads Created" loading={loading}
          count={summary?.leads?.count ?? 0}
          amount={summary?.leads?.amount}
          trend_count={summary?.leads?.trend_count}
          trend_pct={summary?.leads?.trend_pct}
        />
        <KpiCard
          icon={Search} iconBg="#E0F2FE"
          title="Eligibility Checked" loading={loading}
          count={summary?.eligibility?.count ?? 0}
          trend_count={summary?.eligibility?.trend_count}
          trend_pct={summary?.eligibility?.trend_pct}
        />
        <KpiCard
          icon={CheckCircle2} iconBg="#ECFDF5"
          title="Sanctions" loading={loading}
          count={summary?.sanctions?.count ?? 0}
          amount={summary?.sanctions?.amount}
          trend_count={summary?.sanctions?.trend_count}
          trend_pct={summary?.sanctions?.trend_pct}
        />
        <KpiCard
          icon={Coins} iconBg="#FEF3C7"
          title="Disbursements" loading={loading}
          count={summary?.disbursements?.count ?? 0}
          amount={summary?.disbursements?.amount}
          trend_count={summary?.disbursements?.trend_count}
          trend_pct={summary?.disbursements?.trend_pct}
        />
      </div>

      {/* ── Cases + Quick Actions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, marginBottom: 20 }}>

        {/* Cases Table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '18px 24px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Cases — {monthLabel}</div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/customers')}>
              View All →
            </button>
          </div>

          {loading ? (
            <div style={{ padding: 24 }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 20, marginBottom: 12, borderRadius: 6 }} />)}
            </div>
          ) : cases.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Target size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontWeight: 500 }}>No cases for this period</div>
              <div style={{ fontSize: 12 }}>Create a new customer to get started</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>CASE ID</th>
                    <th>CUSTOMER</th>
                    <th>LENDER</th>
                    <th>APPLIED AMOUNT</th>
                    <th>STAGE</th>
                    <th>NEXT ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map(c => (
                    <tr key={c.case_id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/cases/${c.case_id}`)}>
                      <td style={{ fontWeight: 600, color: 'var(--primary)', fontSize: 13 }}>{c.case_ref}</td>
                      <td style={{ fontWeight: 500 }}>{c.customer_name}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{c.lender || '—'}</td>
                      <td style={{ fontWeight: 500 }}>{c.applied_amount ? fmt(c.applied_amount) : '—'}</td>
                      <td><StageBadge stage={c.stage} /></td>
                      <td>
                        {c.next_action && c.next_action !== '—' ? (
                          <button
                            className="btn btn-sm"
                            style={{
                              background: 'linear-gradient(135deg, #635BFF, #7C3AED)',
                              color: '#fff', border: 'none', borderRadius: 999, fontSize: 12,
                            }}
                            onClick={e => { e.stopPropagation(); navigate(`/cases/${c.case_id}`); }}
                          >
                            {c.next_action}
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => navigate('/customers/add')}
                style={{
                  width: '100%', padding: '11px 16px', borderRadius: 10,
                  background: 'linear-gradient(135deg, #635BFF, #7C3AED)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 8, fontWeight: 600, fontSize: 14, fontFamily: 'inherit',
                  boxShadow: '0 4px 12px rgba(99,91,255,0.3)',
                }}
              >
                <UserPlus size={16} /> Add New Customer
              </button>
              <QuickBtn label="Customer List" icon={Users} color="#0284C7" onClick={() => navigate('/customers')} />
              <QuickBtn label="All Cases" icon={List} color="#059669" onClick={() => navigate('/customers')} />
              <QuickBtn label="Commission Tracking" icon={BadgeDollarSign} color="#F59E0B" onClick={() => navigate('/financials/lender-commission')} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Stage Summary ── */}
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>
          Stage Summary — {monthLabel}
        </div>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ height: 32 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
            {STAGE_ORDER.map(label => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: 8,
                background: stages[label] > 0 ? 'var(--primary-subtle)' : 'transparent',
              }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
                <span style={{
                  minWidth: 28, height: 28, borderRadius: 99,
                  background: stages[label] > 0 ? 'var(--primary)' : 'var(--border)',
                  color: stages[label] > 0 ? '#fff' : 'var(--text-tertiary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                }}>
                  {stages[label] ?? 0}
                </span>
              </div>
            ))}
          </div>
        )}
        {lastUpdated && (
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'right' }}>
            Last updated: {lastUpdated.toLocaleTimeString('en-IN')}
          </div>
        )}
      </div>
    </div>
  );
}
