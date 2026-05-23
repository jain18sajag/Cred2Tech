import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, ChevronDown, ChevronUp, X, Check, Settings,
  RefreshCw, Trash2, UserPlus, Edit2, Shield
} from 'lucide-react';
import { getUsers, createUser } from '../api/userService';
import { getRoles } from '../api/roleService';
import { getPayoutConfig, savePayoutConfig } from '../api/subDsaPayoutService';
import { getTenantLenders } from '../api/tenantLenderService';

// ── Styles ───────────────────────────────────────────────────────────────────
const inputStyle = {
  padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8,
  fontSize: 14, background: '#fff', width: '100%', boxSizing: 'border-box'
};
const labelStyle = { fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', marginBottom: 4, display: 'block' };
const btnPrimary = { padding: '9px 20px', background: '#4F46E5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const btnOutline = { padding: '9px 20px', background: '#fff', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, cursor: 'pointer' };
const sectionTitle = { fontSize: 12, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 };

const ROLE_BADGE_MAP = {
  DSA_ADMIN: { label: 'Admin', color: '#1D4ED8', bg: '#EFF6FF' },
  DSA_MEMBER: { label: 'Member', color: '#059669', bg: '#ECFDF5' },
  SUB_DSA: { label: 'Sub-DSA Partner', color: '#7C3AED', bg: '#EDE9FE' },
};

function RoleBadge({ roleName }) {
  const meta = ROLE_BADGE_MAP[roleName] || { label: roleName, color: '#6B7280', bg: '#F3F4F6' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, color: meta.color, background: meta.bg }}>
      {meta.label}
    </span>
  );
}

// ── Payout Config Form for SubDSA ────────────────────────────────────────────
function SubDsaPayoutSetup({ userId, lenders }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [defaultRate, setDefaultRate] = useState(30);
  const [payoutTrigger, setPayoutTrigger] = useState('ON_DSA_RECEIPT');
  const [tdsApplicable, setTdsApplicable] = useState(true);
  const [overrides, setOverrides] = useState([]);
  const [slabs, setSlabs] = useState([]);
  const [schemes, setSchemes] = useState([]);

  // MTD summary (preview)
  const [mtd] = useState({ cases: 4, dsa_earned: 240000, sub_dsa_share: 72000 });

  useEffect(() => {
    setLoading(true);
    getPayoutConfig(userId)
      .then(cfg => {
        if (cfg) {
          setDefaultRate(cfg.default_payout_rate || 30);
          setPayoutTrigger(cfg.payout_trigger || 'ON_DSA_RECEIPT');
          setTdsApplicable(cfg.tds_applicable !== false);
          setOverrides((cfg.overrides || []).map(o => ({ ...o, products: o.products || '' })));
          setSlabs(cfg.case_count_slabs || []);
          setSchemes((cfg.special_schemes || []).map(s => ({
            ...s,
            valid_from: s.valid_from ? s.valid_from.split('T')[0] : '',
            valid_to: s.valid_to ? s.valid_to.split('T')[0] : ''
          })));
        }
        setConfig(cfg);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePayoutConfig(userId, {
        default_payout_rate: defaultRate,
        payout_trigger: payoutTrigger,
        tds_applicable: tdsApplicable,
        overrides,
        slabs,
        schemes
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      alert(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addOverride = () => setOverrides(prev => [...prev, { tenant_lender_id: '', products: '', override_rate: '', effective_from: '' }]);
  const addSlab = () => setSlabs(prev => [...prev, { from_cases: '', to_cases: '', payout_per_case: '' }]);
  const addScheme = () => setSchemes(prev => [...prev, { scheme_name: '', basis: 'Cases', valid_from: '', valid_to: '', bonus_per_case: '', bonus_percent: '', min_case_count: '', is_active: true }]);

  if (loading) {
    return <div style={{ padding: 20, color: '#6B7280', fontSize: 13 }}>Loading configuration...</div>;
  }

  return (
    <div style={{ padding: '0 20px 20px', borderTop: '2px solid #EEF2FF' }}>
      {/* Info banner */}
      <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#166534', marginTop: 16, marginBottom: 20 }}>
        ℹ️ Volume overrides and per-case slabs are calculated <strong>independently</strong> each month and the totals are added together.
      </div>

      {/* Header configs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div>
          <label style={labelStyle}>DEFAULT PAYOUT RATE *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number" min={0} max={100} step={0.5}
              value={defaultRate}
              onChange={e => setDefaultRate(parseFloat(e.target.value))}
              style={{ ...inputStyle, width: 80 }}
            />
            <span style={{ fontSize: 13, color: '#6B7280' }}>% of DSA commission</span>
          </div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Applied to all lenders unless overridden below</div>
        </div>
        <div>
          <label style={labelStyle}>PAYOUT TRIGGER</label>
          <select value={payoutTrigger} onChange={e => setPayoutTrigger(e.target.value)} style={inputStyle}>
            <option value="ON_DSA_RECEIPT">On DSA receipt from lender</option>
            <option value="ON_DISBURSEMENT">On disbursement</option>
            <option value="MANUAL">Manual trigger</option>
          </select>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>When sub-DSA receives their share</div>
        </div>
        <div>
          <label style={labelStyle}>TDS APPLICABLE</label>
          <select value={tdsApplicable ? 'yes' : 'no'} onChange={e => setTdsApplicable(e.target.value === 'yes')} style={inputStyle}>
            <option value="yes">Yes — deduct TDS before payout</option>
            <option value="no">No — gross payout</option>
          </select>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>TDS at applicable rate (Sec 194H)</div>
        </div>
      </div>

      {/* Per-Lender Volume Rate Overrides */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Per-Lender Volume Rate Overrides</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>Optional — leave rate blank to use default · products covered is editable</div>
          </div>
          <button onClick={addOverride} style={{ ...btnOutline, fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Add Lender
          </button>
        </div>
        {overrides.length === 0 ? (
          <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
            No lender overrides — default rate applies to all lenders. Click "Add Lender" to override.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 36px', gap: 8, marginBottom: 6 }}>
              <div style={sectionTitle}>Lender</div>
              <div style={sectionTitle}>Products Covered</div>
              <div style={sectionTitle}>Override Rate</div>
              <div style={sectionTitle}>Effective From</div>
              <div />
            </div>
            {overrides.map((ov, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 36px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <select
                  value={ov.tenant_lender_id}
                  onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, tenant_lender_id: e.target.value } : o))}
                  style={inputStyle}
                >
                  <option value="">— Select Lender —</option>
                  {lenders.map(l => <option key={l.id} value={l.id}>{l.lender_name}</option>)}
                </select>
                <input
                  placeholder="e.g. LAP, Business Loan"
                  value={ov.products}
                  onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, products: e.target.value } : o))}
                  style={inputStyle}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number" placeholder="e.g. 40" min={0} max={100}
                    value={ov.override_rate}
                    onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, override_rate: e.target.value } : o))}
                    style={{ ...inputStyle, width: 80 }}
                  />
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>%</span>
                </div>
                <input
                  type="date"
                  value={ov.effective_from || ''}
                  onChange={e => setOverrides(prev => prev.map((o, j) => j === i ? { ...o, effective_from: e.target.value } : o))}
                  style={inputStyle}
                />
                <button onClick={() => setOverrides(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, cursor: 'pointer', padding: '7px', display: 'flex', alignItems: 'center' }}>
                  <X size={13} color="#DC2626" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Per-Case Payout Slabs */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Per-Case Payout Slabs</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>Monthly case count — flat ₹ per case · Stacks cumulatively with the volume rate override above</div>
          </div>
          <button onClick={addSlab} style={{ ...btnOutline, fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Add Slab
          </button>
        </div>
        {slabs.length === 0 ? (
          <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
            No slabs configured. Click "Add Slab" to define case-count incentive tiers.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 36px', gap: 8, marginBottom: 6 }}>
              <div style={sectionTitle}>From (Cases)</div>
              <div style={sectionTitle}>To (Cases)</div>
              <div style={sectionTitle}>Payout Per Case (₹)</div>
              <div />
            </div>
            {slabs.map((slab, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr 36px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <input type="number" min={1} value={slab.from_cases} placeholder="1"
                  onChange={e => setSlabs(prev => prev.map((s, j) => j === i ? { ...s, from_cases: e.target.value } : s))}
                  style={inputStyle} />
                <input type="number" min={1} value={slab.to_cases || ''} placeholder="∞"
                  onChange={e => setSlabs(prev => prev.map((s, j) => j === i ? { ...s, to_cases: e.target.value } : s))}
                  style={inputStyle} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: '#6B7280' }}>₹</span>
                  <input type="number" min={0} value={slab.payout_per_case} placeholder="2000"
                    onChange={e => setSlabs(prev => prev.map((s, j) => j === i ? { ...s, payout_per_case: e.target.value } : s))}
                    style={inputStyle} />
                </div>
                <button onClick={() => setSlabs(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, cursor: 'pointer', padding: '7px', display: 'flex', alignItems: 'center' }}>
                  <X size={13} color="#DC2626" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ⭐ Special Payout Schemes */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>⭐ Special Payout Schemes</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>Active schemes stack with regular slabs. Promotional / time-bound bonuses.</div>
          </div>
          <button onClick={addScheme} style={{ ...btnOutline, fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} /> Add Scheme
          </button>
        </div>
        {schemes.length === 0 ? (
          <div style={{ padding: '16px', background: '#F9FAFB', borderRadius: 8, fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
            No special schemes. Click "Add Scheme" to create a time-limited bonus rule.
          </div>
        ) : (
          schemes.map((sc, i) => (
            <div key={i} style={{ background: '#FAFAFA', border: '1px solid #E5E7EB', borderRadius: 10, padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 36px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input placeholder="Scheme Name e.g. Q1FY26 Activation Bonus"
                  value={sc.scheme_name}
                  onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, scheme_name: e.target.value } : s))}
                  style={inputStyle} />
                <select value={sc.basis} onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, basis: e.target.value } : s))} style={inputStyle}>
                  <option value="Cases">Cases</option>
                  <option value="Volume">Volume</option>
                </select>
                <input type="date" value={sc.valid_from}
                  onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, valid_from: e.target.value } : s))}
                  style={inputStyle} placeholder="Valid From" />
                <input type="date" value={sc.valid_to}
                  onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, valid_to: e.target.value } : s))}
                  style={inputStyle} placeholder="Valid To" />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>₹</span>
                  <input type="number" placeholder="Bonus/case"
                    value={sc.bonus_per_case}
                    onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, bonus_per_case: e.target.value } : s))}
                    style={inputStyle} />
                </div>
                <button onClick={() => setSchemes(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, cursor: 'pointer', padding: '7px', display: 'flex', alignItems: 'center' }}>
                  <X size={13} color="#DC2626" />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center' }}>
                <div>
                  <label style={{ fontSize: 11, color: '#9CA3AF' }}>Lender (optional)</label>
                  <select value={sc.tenant_lender_id || ''} onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, tenant_lender_id: e.target.value } : s))} style={inputStyle}>
                    <option value="">All Lenders</option>
                    {lenders.map(l => <option key={l.id} value={l.id}>{l.lender_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#9CA3AF' }}>Products (optional)</label>
                  <input placeholder="e.g. LAP, Business Loan" value={sc.products || ''}
                    onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, products: e.target.value } : s))}
                    style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#9CA3AF' }}>Min Cases Required</label>
                  <input type="number" min={1} placeholder="e.g. 3" value={sc.min_case_count || ''}
                    onChange={e => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, min_case_count: e.target.value } : s))}
                    style={inputStyle} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>Active</label>
                  <div
                    onClick={() => setSchemes(prev => prev.map((s, j) => j === i ? { ...s, is_active: !s.is_active } : s))}
                    style={{ width: 44, height: 24, borderRadius: 12, padding: 2, cursor: 'pointer', background: sc.is_active ? '#4F46E5' : '#E5E7EB', transition: 'all 0.2s' }}>
                    <div style={{ width: 20, height: 20, background: '#fff', borderRadius: '50%', transform: sc.is_active ? 'translateX(20px)' : 'translateX(0)', transition: 'all 0.2s' }} />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MTD Widget */}
      <div style={{ background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)', border: '1px solid #6EE7B7', borderRadius: 12, padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#065F46', textTransform: 'uppercase', marginBottom: 4 }}>Cases (MTD)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{mtd.cases}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#065F46', textTransform: 'uppercase', marginBottom: 4 }}>DSA Earned (MTD)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#059669' }}>₹{(mtd.dsa_earned / 1e5).toFixed(1)}L</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#065F46', textTransform: 'uppercase', marginBottom: 4 }}>Sub-DSA Share ({defaultRate}%)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1D4ED8' }}>₹{Math.round(mtd.dsa_earned * defaultRate / 100).toLocaleString('en-IN')}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#065F46', textTransform: 'uppercase', marginBottom: 4 }}>Payout Status</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#DC2626' }}>Pending</div>
        </div>
      </div>

      {/* Save button */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={handleSave} disabled={saving}
          style={{ ...btnPrimary, display: 'flex', alignItems: 'center', gap: 8, opacity: saving ? 0.7 : 1 }}>
          {saving ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Payout Config'}
        </button>
      </div>
    </div>
  );
}

// ── Add Member Form ──────────────────────────────────────────────────────────
function AddMemberForm({ roles, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: '', email: '', mobile: '', password: '', role_id: '', hierarchy_level: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name || !form.email || !form.password || !form.role_id) {
      alert('Name, Email, Password, and Role are required.');
      return;
    }
    setSaving(true);
    try {
      await createUser(form);
      onSuccess();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Add New Team Member</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} color="#6B7280" /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelStyle}>Full Name *</label>
          <input placeholder="Enter full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Mobile Number *</label>
          <input placeholder="10-digit mobile" value={form.mobile} onChange={e => setForm(p => ({ ...p, mobile: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email Address</label>
          <input type="email" placeholder="Work email (optional)" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Grade / Role *</label>
          <select value={form.role_id} onChange={e => setForm(p => ({ ...p, role_id: e.target.value }))} style={inputStyle}>
            <option value="">— Select grade —</option>
            {(roles || []).filter(r => ['DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'].includes(r.name)).map(r => (
              <option key={r.id} value={r.id}>{r.name === 'SUB_DSA' ? 'Partner (Sub-DSA)' : r.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Password *</label>
          <input type="password" placeholder="Set initial password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} style={inputStyle} />
        </div>
        {!['SUB_DSA'].includes(roles?.find(r => r.id === parseInt(form.role_id))?.name) && (
          <div>
            <label style={labelStyle}>Hierarchy Level</label>
            <select value={form.hierarchy_level} onChange={e => setForm(p => ({ ...p, hierarchy_level: e.target.value }))} style={inputStyle}>
              <option value="">— Select Level —</option>
              {['L1', 'L2', 'L3', 'L4', 'L5'].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button onClick={onClose} style={btnOutline}>Cancel</button>
        <button onClick={handleSubmit} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Creating...' : 'Create Member'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function DsaTeamManagementPage() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [lenders, setLenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedSubDsa, setExpandedSubDsa] = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [usersData, rolesData, lendersData] = await Promise.all([
        getUsers(),
        getRoles(),
        getTenantLenders()
      ]);
      setUsers(Array.isArray(usersData) ? usersData : []);
      setRoles(Array.isArray(rolesData) ? rolesData : []);
      setLenders(Array.isArray(lendersData) ? lendersData.filter(l => l.is_active) : []);
    } catch (e) {
      console.error('Failed to load team data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const employees = users.filter(u => ['DSA_ADMIN', 'DSA_MEMBER'].includes(u.role?.name));
  const subDsaUsers = users.filter(u => u.role?.name === 'SUB_DSA');

  const toggleSubDsa = (id) => setExpandedSubDsa(prev => ({ ...prev, [id]: !prev[id] }));

  if (loading) {
    return (
      <div style={{ padding: '60px', textAlign: 'center', color: '#9CA3AF' }}>
        <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
        <div>Loading team...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>Team Management</div>
          <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Employees & partners — Grades L1–L5, Admin, Partner</div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ ...btnPrimary, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <UserPlus size={15} /> Add Member
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <AddMemberForm
          roles={roles}
          onClose={() => setShowAddForm(false)}
          onSuccess={() => { setShowAddForm(false); fetchAll(); }}
        />
      )}

      {/* ── Employees Section ── */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '14px 20px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={16} color="#4F46E5" />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Employees ({employees.length})</div>
        </div>
        {employees.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No employees found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#FAFAFA' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Name</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Email</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Mobile</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Role</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Level</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '10px 16px', fontSize: 14, fontWeight: 600, color: '#111827' }}>{u.name}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: '#6B7280' }}>{u.email || '—'}</td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: '#6B7280' }}>{u.mobile || '—'}</td>
                  <td style={{ padding: '10px 16px' }}><RoleBadge roleName={u.role?.name} /></td>
                  <td style={{ padding: '10px 16px', fontSize: 13, color: '#6B7280' }}>{u.hierarchy_level || '—'}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: u.status === 'ACTIVE' ? '#059669' : '#DC2626' }}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── SubDSA Partners Section ── */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', background: '#F5F3FF', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🤝</span>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#5B21B6' }}>Sub-DSA Partners ({subDsaUsers.length})</div>
          <div style={{ fontSize: 12, color: '#7C3AED', marginLeft: 4 }}>Click a partner to configure their payout structure</div>
        </div>

        {subDsaUsers.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🤝</div>
            No SubDSA partners yet. Click "Add Member" and select "Partner (Sub-DSA)" to add one.
          </div>
        ) : (
          subDsaUsers.map(u => (
            <div key={u.id} style={{ borderTop: '1px solid #F3F4F6' }}>
              {/* Row */}
              <div
                onClick={() => toggleSubDsa(u.id)}
                style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', background: expandedSubDsa[u.id] ? '#FAFAFA' : '#fff' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: '#EDE9FE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#7C3AED' }}>
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{u.name}</div>
                    <div style={{ fontSize: 12, color: '#6B7280' }}>{u.email || u.mobile || '—'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <RoleBadge roleName="SUB_DSA" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7C3AED', fontWeight: 600 }}>
                    <Settings size={14} />
                    {expandedSubDsa[u.id] ? 'Hide' : 'Configure'} Payout
                  </div>
                  {expandedSubDsa[u.id] ? <ChevronUp size={16} color="#7C3AED" /> : <ChevronDown size={16} color="#7C3AED" />}
                </div>
              </div>

              {/* Payout Config Expanded */}
              {expandedSubDsa[u.id] && (
                <div style={{ background: '#FAFAFA' }}>
                  <div style={{ padding: '14px 20px 8px', fontSize: 11, fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    ⚙️ Sub-DSA Payout Setup — {u.name}
                  </div>
                  <SubDsaPayoutSetup userId={u.id} lenders={lenders} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
