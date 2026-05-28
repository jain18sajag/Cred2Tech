import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getPlatformSummary, getPlatformApiUsage, getPlatformFunnel,
  getTopDsas, getTopLenders,
} from '../api/dashboardService';
import {
  Building2, Users, Zap, Coins, RefreshCw, Download,
  TrendingUp, TrendingDown, CheckCircle2, ArrowRight,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 60_000;

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'mtd',   label: 'MTD' },
  { key: 'ytd',   label: 'YTD' },
];
const EXTENDED_PERIODS = [
  { key: 'today', label: 'Day' },
  { key: 'week',  label: 'Week' },
  { key: 'mtd',   label: 'Month' },
  { key: 'fy',    label: 'FY' },
  { key: 'life_to_date', label: 'Life to Date' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtCr(n) {
  if (!n && n !== 0) return '₹0';
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function TrendChip({ count, pct, label }) {
  if (!count && !pct) return null;
  const up = (count ?? pct) > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
      color: up ? '#10B981' : '#EF4444', marginTop: 4 }}>
      {up ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
      <span>{up ? '+' : ''}{pct ?? count}% {label || 'vs prev period'}</span>
    </div>
  );
}

function PeriodBar({ periods, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', borderRadius: 8, padding: 3 }}>
      {periods.map(p => (
        <button key={p.key} onClick={() => onChange(p.key)} style={{
          padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
          background: active === p.key ? '#fff' : 'transparent',
          color: active === p.key ? 'var(--primary)' : 'var(--text-secondary)',
          boxShadow: active === p.key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
        }}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────
function SummaryCard({ icon: Icon, iconColor, iconBg, label, value, trendPct, trendLabel, loading }) {
  return (
    <div className="card" style={{ padding: 24, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon size={20} color={iconColor} />
        </div>
      </div>
      {loading
        ? <div className="skeleton" style={{ height: 34, width: 80, marginBottom: 6 }} />
        : <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>{value}</div>
      }
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
      {!loading && <TrendChip pct={trendPct} label={trendLabel} />}
    </div>
  );
}

// ─── Funnel Bar ───────────────────────────────────────────────────────────────
const FUNNEL_COLORS = ['#10B981','#3B82F6','#F59E0B','#10B981','#EAB308'];
const FUNNEL_ICONS  = ['🌱','🔍','📋','✅','💰'];

function FunnelItem({ item, maxCount, idx }) {
  const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{FUNNEL_ICONS[idx]}</span>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: FUNNEL_COLORS[idx],
          }}>{item.label}</span>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          {item.count?.toLocaleString() ?? 0}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${pct}%`, borderRadius: 99,
          background: `linear-gradient(90deg, ${FUNNEL_COLORS[idx]}, ${FUNNEL_COLORS[idx]}99)`,
          transition: 'width 0.6s ease',
        }} />
      </div>
      {item.conversion_pct !== undefined && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
          +{item.conversion_pct}% conversion
        </div>
      )}
    </div>
  );
}

// ─── Main Platform Dashboard ───────────────────────────────────────────────────
export default function PlatformDashboard() {
  const { user } = useAuth();

  const [period, setPeriod]       = useState('mtd');
  const [summary, setSummary]     = useState(null);
  const [apiUsage, setApiUsage]   = useState(null);
  const [funnel, setFunnel]       = useState([]);
  const [topDsas, setTopDsas]     = useState([]);
  const [topLenders, setTopLenders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetchAll = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [s, a, f, d, l] = await Promise.all([
        getPlatformSummary(period),
        getPlatformApiUsage(period),
        getPlatformFunnel(period),
        getTopDsas(period),
        getTopLenders(period),
      ]);
      setSummary(s);
      setApiUsage(a);
      setFunnel(Array.isArray(f) ? f : []);
      setTopDsas(Array.isArray(d) ? d : []);
      setTopLenders(Array.isArray(l) ? l : []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('[PlatformDashboard] fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => { setLoading(true); fetchAll(); }, [fetchAll]);

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchAll(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  const monthLabel = new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Platform Dashboard</div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Operational overview — {monthLabel} ({period.toUpperCase()})
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PeriodBar periods={PERIODS} active={period} onChange={setPeriod} />
          <button
            onClick={() => fetchAll(true)} disabled={refreshing}
            style={{
              padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center',
            }}
          >
            <RefreshCw size={15} color="var(--text-secondary)"
              style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
          </button>
          <button className="btn btn-primary btn-sm" style={{
            background: 'linear-gradient(135deg, #635BFF, #7C3AED)',
            border: 'none', borderRadius: 999,
          }}>
            <Download size={14}/> MIS Reports
          </button>
        </div>
      </div>

      {/* ── Platform Summary KPIs ── */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Platform Summary
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
          <SummaryCard
            icon={Building2} iconColor="#4F46E5" iconBg="#EEF2FF"
            label="Active DSAs" loading={loading}
            value={loading ? '...' : summary?.active_dsas ?? 0}
            trendPct={summary?.active_dsas_trend_pct}
            trendLabel={`+${summary?.active_dsas_new_period ?? 0} new this period`}
          />
          <SummaryCard
            icon={Users} iconColor="#0284C7" iconBg="#E0F2FE"
            label="Active Clients / MSMEs" loading={loading}
            value={loading ? '...' : summary?.active_clients?.toLocaleString() ?? 0}
            trendPct={summary?.active_clients_trend_pct}
            trendLabel="vs prev period"
          />
          <SummaryCard
            icon={Zap} iconColor="#F59E0B" iconBg="#FEF3C7"
            label="Total API Calls" loading={loading}
            value={loading ? '...' : summary?.total_api_calls?.toLocaleString() ?? 0}
            trendPct={summary?.total_api_calls_trend_pct}
            trendLabel="vs prev period"
          />
          <SummaryCard
            icon={Coins} iconColor="#10B981" iconBg="#ECFDF5"
            label="Amount Disbursed" loading={loading}
            value={loading ? '...' : fmtCr(summary?.amount_disbursed)}
            trendPct={summary?.amount_disbursed_trend_pct}
            trendLabel="vs prev period"
          />
        </div>
      </div>

      {/* ── Extended Period Filter ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <PeriodBar periods={EXTENDED_PERIODS} active={period} onChange={setPeriod} />
      </div>

      {/* ── API Usage + Customer Funnel ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 20, marginBottom: 20 }}>

        {/* API Usage Table */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '16px 22px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={16} color="#F59E0B" /> API Usage by Type
            </div>
            <button className="btn btn-secondary btn-sm">Full Report</button>
          </div>
          {loading ? (
            <div style={{ padding: 20 }}>
              {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: 18, marginBottom: 10 }} />)}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>API TYPE</th>
                  <th style={{ textAlign: 'right' }}>CALLS ({period.toUpperCase()})</th>
                  <th style={{ textAlign: 'right' }}>SUCCESS RATE</th>
                  <th style={{ textAlign: 'right' }}>FAILED / REFUNDED</th>
                </tr>
              </thead>
              <tbody>
                {(apiUsage?.rows || []).length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>No API usage data</td></tr>
                ) : (apiUsage?.rows || []).map(r => (
                  <tr key={r.api_code}>
                    <td style={{ fontWeight: 500 }}>{r.display_name || r.api_code}</td>
                    <td style={{ textAlign: 'right' }}>{r.total?.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ color: '#10B981', fontWeight: 600 }}>{r.success_rate}%</span>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-tertiary)' }}>
                      {(r.failed + r.refunded) > 0
                        ? <span style={{ color: '#EF4444' }}>{r.failed + r.refunded} / refunded</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
                {apiUsage?.totals && (
                  <tr style={{ background: 'var(--bg-elevated)', fontWeight: 700 }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right' }}>{apiUsage.totals.total?.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', color: '#10B981' }}>{apiUsage.totals.success_rate}%</td>
                    <td style={{ textAlign: 'right', color: '#EF4444' }}>
                      {(apiUsage.totals.failed + apiUsage.totals.refunded) > 0
                        ? `${apiUsage.totals.failed + apiUsage.totals.refunded} / refunded` : '—'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Customer Funnel */}
        <div className="card" style={{ padding: 22, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} color="#10B981" /> Customer Funnel
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600, color: '#EF4444',
              background: '#FEF2F2', padding: '2px 8px', borderRadius: 99,
            }}>
              Counts only — No PII
            </span>
          </div>
          {loading ? (
            [1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 10 }} />)
          ) : funnel.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>No funnel data</div>
          ) : (
            <>
              {funnel.map((item, idx) => (
                <FunnelItem key={item.stage || idx} item={item} maxCount={funnel[0]?.count || 1} idx={idx} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Top DSAs + Top Lenders ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Top DSAs */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '16px 22px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>🏆 Top DSAs by Activity</div>
            <button className="btn btn-secondary btn-sm">View All</button>
          </div>
          {loading ? (
            <div style={{ padding: 20 }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 18, marginBottom: 12 }} />)}
            </div>
          ) : topDsas.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>No DSA data</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>DSA</th>
                  <th style={{ textAlign: 'right' }}>API CALLS</th>
                  <th style={{ textAlign: 'right' }}>APPLICATIONS</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {topDsas.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{d.dsa_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        Since {d.since ? new Date(d.since).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{d.api_calls?.toLocaleString() ?? 0}</td>
                    <td style={{ textAlign: 'right' }}>{d.applications?.toLocaleString() ?? 0}</td>
                    <td>
                      <span style={{
                        padding: '3px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600,
                        background: d.status === 'ACTIVE' ? '#ECFDF5' : '#FEF2F2',
                        color: d.status === 'ACTIVE' ? '#059669' : '#EF4444',
                      }}>
                        {d.status === 'ACTIVE' ? 'Active' : 'Low Credits'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top Lenders */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '16px 22px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>🏦 Top 5 Lenders</div>
            <button className="btn btn-secondary btn-sm">View All</button>
          </div>
          {loading ? (
            <div style={{ padding: 20 }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 18, marginBottom: 12 }} />)}
            </div>
          ) : topLenders.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>No lender data</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>LENDER</th>
                  <th style={{ textAlign: 'right' }}>APPLIED</th>
                  <th style={{ textAlign: 'right', color: '#10B981' }}>SANCTIONED</th>
                  <th style={{ textAlign: 'right', color: '#F59E0B' }}>DISBURSED</th>
                </tr>
              </thead>
              <tbody>
                {topLenders.map((l, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: ['#2563EB','#EF4444','#6366F1','#10B981','#F59E0B'][i % 5],
                        }}/>
                        {l.lender_name}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{l.applied}</td>
                    <td style={{ textAlign: 'right', color: '#10B981', fontWeight: 600 }}>{l.sanctioned}</td>
                    <td style={{ textAlign: 'right', color: '#F59E0B', fontWeight: 600 }}>{l.disbursed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Footer timestamp */}
      {lastUpdated && (
        <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'right' }}>
          Last updated: {lastUpdated.toLocaleTimeString('en-IN')} IST
          &nbsp;•&nbsp; Auto-refreshes every 60s
        </div>
      )}
    </div>
  );
}
