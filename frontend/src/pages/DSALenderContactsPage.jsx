import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { 
  Plus, Edit2, Trash2, ChevronDown, ChevronUp, AlertCircle, Briefcase, Lock, Check, X
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  getTenantLenders, createTenantLender, updateTenantLender, deleteTenantLender,
  createTenantLenderContact, updateTenantLenderContact, deleteTenantLenderContact,
  getPlatformLenders
} from '../api/tenantLenderService';
import {
  getCommissionRules, createCommissionRule, updateCommissionRule, 
  deleteCommissionRule
} from '../api/commissionService';
import { useAuth } from '../context/AuthContext';

const PRODUCT_TYPES = ['LAP', 'HL', 'WC', 'TL', 'BL', 'ML'];

const PT_COLORS = {
  LAP: { bg: '#EBF8FF', text: '#2B6CB0', border: '#BEE3F8' },
  HL:  { bg: '#F0FFF4', text: '#276749', border: '#9AE6B4' },
  WC:  { bg: '#FAF5FF', text: '#553C9A', border: '#D6BCFA' },
  TL:  { bg: '#FFFBEB', text: '#744210', border: '#F6E05E' },
  BL:  { bg: '#FFF5F5', text: '#C53030', border: '#FEB2B2' },
  ML:  { bg: '#EDF2F7', text: '#2D3748', border: '#CBD5E0' },
};

function ProductBadge({ type }) {
  const c = PT_COLORS[type] || PT_COLORS.ML;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    }}>{type}</span>
  );
}

// ── Modal: Add/Edit Lender ──────────────────────────────────────────────────
function LenderModal({ isOpen, onClose, onSave, platformLenders = [], initialData = null }) {
  const [lenderName, setLenderName] = useState('');
  const [platformLenderId, setPlatformLenderId] = useState('');
  const [isEsrEnabled, setIsEsrEnabled] = useState(false);
  const [maxCapAmount, setMaxCapAmount] = useState('');
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLenderName(initialData?.lender_name || '');
      setPlatformLenderId(initialData?.platform_lender_id || '');
      setIsEsrEnabled(initialData?.is_esr_enabled || false);
      setMaxCapAmount(initialData?.max_cap_amount || '');
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!lenderName.trim()) { toast.error('Lender name is required'); return; }
    setSaving(true);
    try {
      await onSave({ 
        lender_name: lenderName, 
        platform_lender_id: null,
        is_esr_enabled: false,
        max_cap_amount: maxCapAmount,
        is_active: true 
      });
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save lender');
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={modalHeader}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{initialData ? 'Edit Lender Settings' : 'Add New Lender'}</h3>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={labelStyle}>LENDER NAME *</label>
            <input value={lenderName} onChange={e => setLenderName(e.target.value)}
              placeholder="e.g. HDFC Bank, Axis Bank, ICICI Bank"
              style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>

          <div>
            <label style={labelStyle}>UPPER CAP (₹) - Global for Lender</label>
            <input type="number" value={maxCapAmount} onChange={e => setMaxCapAmount(e.target.value)}
              placeholder="No limit"
              style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleSave()} />
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Maximum total payout allowed across all products for this lender.</div>
          </div>


        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnOutline}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : initialData ? 'Save Changes' : 'Add Lender'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Add/Edit Contact ─────────────────────────────────────────────────
function ContactModal({ isOpen, onClose, onSave, lender, initialData = null }) {
  const [formData, setFormData] = useState({
    product_type: 'ALL',
    contact_name: '',
    contact_email: '',
    contact_mobile: '',
    dsa_code: '',
    is_primary: false
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialData) setFormData(initialData);
      else setFormData({ product_type: 'ALL', contact_name: '', contact_email: '', contact_mobile: '', dsa_code: '', is_primary: false });
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!formData.contact_name.trim()) return toast.error('Name is required');
    if (!formData.contact_email.trim()) return toast.error('Email is required');
    if (!formData.product_type) return toast.error('Product type is required');

    setSaving(true);
    try {
      await onSave(lender, formData);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={modalHeader}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {initialData ? 'Edit Contact' : 'Add Contact'} — {lender?.lender_name}
          </h3>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Product Type *</label>
              <select style={inputStyle} value={formData.product_type} onChange={e => setFormData({...formData, product_type: e.target.value})}>
                <option value="ALL">ALL (Fallback/General)</option>
                {PRODUCT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>DSA Code</label>
              <input style={inputStyle} value={formData.dsa_code || ''} onChange={e => setFormData({...formData, dsa_code: e.target.value})} placeholder="e.g. DSA-1234" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Contact Name *</label>
            <input style={inputStyle} value={formData.contact_name} onChange={e => setFormData({...formData, contact_name: e.target.value})} placeholder="e.g. Suresh Nair" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Email *</label>
              <input style={inputStyle} value={formData.contact_email} onChange={e => setFormData({...formData, contact_email: e.target.value})} placeholder="suresh@bank.com" />
            </div>
            <div>
              <label style={labelStyle}>Mobile</label>
              <input style={inputStyle} value={formData.contact_mobile || ''} onChange={e => setFormData({...formData, contact_mobile: e.target.value})} placeholder="9820000000" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={formData.is_primary} onChange={e => setFormData({...formData, is_primary: e.target.checked})} style={{ width: 16, height: 16 }} />
            Mark as Primary Contact for {formData.product_type}
          </label>
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnOutline}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? 'Saving...' : 'Save Contact'}</button>
        </div>
      </div>
    </div>
  );
}

export default function DSALenderContactsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('DSA_ADMIN');

  const [lenders, setLenders]   = useState([]);
  const [platformLenders, setPlatformLenders] = useState([]);
  const [commissionRules, setCommissionRules] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState({});

  const [lenderModal, setLenderModal] = useState({ open: false, initialData: null });
  const [contactModal, setContactModal] = useState({ open: false, lender: null, initialData: null });

  // For inline editing states
  const [ruleEdits, setRuleEdits] = useState({}); // { `${lenderId}_${product}`: ruleConfig }
  const [activeProductTabs, setActiveProductTabs] = useState({}); // { lenderId: 'LAP' }

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [lendersData, rulesData, platformData] = await Promise.all([
        getTenantLenders(),
        getCommissionRules(),
        getPlatformLenders()
      ]);
      setLenders(lendersData);
      setCommissionRules(rulesData);
      setPlatformLenders(platformData);
      
      // Initialize states
      const initialActiveTabs = {};
      lendersData.forEach(l => {
        if (!activeProductTabs[l.id]) {
          const firstProductRule = rulesData.find(r => r.tenant_lender_id === l.id);
          initialActiveTabs[l.id] = firstProductRule ? firstProductRule.product_type : PRODUCT_TYPES[0];
        } else {
          initialActiveTabs[l.id] = activeProductTabs[l.id];
        }
      });
      setActiveProductTabs(initialActiveTabs);
    } catch (e) {
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [activeProductTabs]);

  useEffect(() => { load(); }, []);

  const toggleExpand = id => setExpanded(e => ({ ...e, [id]: !e[id] }));

  // ── Lender actions ──
  const handleAddLender = async (payload) => {
    if (lenderModal.initialData) {
      await updateTenantLender(lenderModal.initialData.id, payload);
      toast.success('Lender settings updated');
    } else {
      await createTenantLender(payload);
      toast.success('Lender added');
    }
    await load();
  };

  // ── Contact actions ──
  const handleSaveContact = async (lender, payload) => {
    if (payload.id) {
      await updateTenantLenderContact(payload.id, payload);
      toast.success('Contact updated');
    } else {
      await createTenantLenderContact({
        tenant_lender_id: lender.tenant_lender_id || undefined,
        platform_lender_id: lender.platform_lender_id || undefined,
        ...payload
      });
      toast.success('Contact added');
    }
    await load();
  };
  
  const handleDeleteContact = async (id) => {
    if (!window.confirm('Delete this contact?')) return;
    try {
      await deleteTenantLenderContact(id);
      toast.success('Contact deleted');
      await load();
    } catch(e) {
      toast.error(e.response?.data?.error || 'Failed to delete');
    }
  };

  // ── Rule actions ──
  const getRuleForLenderProduct = (lenderId, productType) => {
    return commissionRules.find(r => r.tenant_lender_id === lenderId && r.product_type === productType);
  };

  const getActiveRuleState = (lenderId, productType) => {
    const editKey = `${lenderId}_${productType}`;
    if (ruleEdits[editKey]) return ruleEdits[editKey];
    
    const existing = getRuleForLenderProduct(lenderId, productType);
    if (existing) return existing;
    
    return {
      payout_basis: 'NET_DISBURSED',
      commission_type: 'HYBRID',
      max_cap_amount: '',
      volume_slabs: [],
      case_count_slabs: [],
      special_schemes: []
    };
  };

  const updateRuleEdit = (lenderId, productType, updates) => {
    const editKey = `${lenderId}_${productType}`;
    const currentState = getActiveRuleState(lenderId, productType);
    setRuleEdits(prev => ({ ...prev, [editKey]: { ...currentState, ...updates } }));
  };

  const handleSaveRule = async (lenderId, productType) => {
    const editKey = `${lenderId}_${productType}`;
    const stateToSave = ruleEdits[editKey];
    if (!stateToSave) return;

    try {
      const existing = getRuleForLenderProduct(lenderId, productType);
      const payload = {
        tenant_lender_id: lenderId,
        product_type: productType,
        payout_basis: stateToSave.payout_basis,
        commission_type: stateToSave.commission_type || 'HYBRID',
        max_cap_amount: stateToSave.max_cap_amount ? parseFloat(stateToSave.max_cap_amount) : null,
        is_active: true,
        volume_slabs: stateToSave.volume_slabs || [],
        case_count_slabs: stateToSave.case_count_slabs || [],
        special_schemes: stateToSave.special_schemes || []
      };

      if (existing) {
        await updateCommissionRule(existing.id, payload);
        toast.success(`${productType} rules updated`);
      } else {
        await createCommissionRule(payload);
        toast.success(`${productType} rules saved`);
      }
      
      setRuleEdits(prev => { const n = {...prev}; delete n[editKey]; return n; });
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save rules');
    }
  };

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', paddingBottom: 60 }}>
      <PageHeader
        title="Lender Configuration"
        subtitle="Manage lender contacts & payout slabs"
      />

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16
      }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Lender Configuration</h2>
        {isAdmin && (
          <button onClick={() => setLenderModal({ open: true })} style={{ ...btnPrimary, background: '#6366F1' }}>
            <Plus size={16} /> Add Lender
          </button>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
        Contact details & commission rules per lender — configured per product
      </div>

      <div style={{
        background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8,
        padding: '12px 16px', marginBottom: 24, display: 'flex', gap: 10,
        fontSize: 13, color: '#4F46E5', lineHeight: 1.5
      }}>
        <Lock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>DSA Admin only.</strong> Commission rules <strong>must be explicitly configured per lender-product combination.</strong> Lender name cannot be edited once added. Subvention is recorded at the time of disbursement entry.
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <LoadingSpinner size={36} />
        </div>
      ) : lenders.length === 0 ? (
        <div style={emptyCard}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏦</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No lenders configured yet</h3>
          {isAdmin && (
            <button onClick={() => setLenderModal({ open: true })} style={btnPrimary}>
              <Plus size={16} /> Add First Lender
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {lenders.map(lender => {
            const isExpanded = expanded[lender.id];
            const activeProduct = activeProductTabs[lender.id] || PRODUCT_TYPES[0];
            const ruleState = getActiveRuleState(lender.id, activeProduct);
            const isEditingRule = !!ruleEdits[`${lender.id}_${activeProduct}`];
            
            const configuredProductsCount = PRODUCT_TYPES.filter(pt => getRuleForLenderProduct(lender.id, pt)).length;

            return (
              <div key={lender.id} style={{
                background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
                boxShadow: isExpanded ? '0 10px 25px -5px rgba(0,0,0,0.05)' : '0 1px 2px 0 rgba(0,0,0,0.05)',
                overflow: 'hidden', transition: 'all 0.2s'
              }}>
                {/* Header */}
                <div style={{
                  padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', background: isExpanded ? '#F9FAFB' : '#fff'
                }} onClick={() => toggleExpand(lender.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, background: '#1E3A8A', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16
                    }}>
                      {lender.lender_name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{lender.lender_name}</div>
                        {lender.platform_lender_id ? (
                          lender.is_esr_enabled ? (
                            <span style={{ fontSize: 10, fontWeight: 700, background: '#D1FAE5', color: '#065F46', padding: '2px 8px', borderRadius: 10 }}>ESR ENABLED</span>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 700, background: '#F3F4F6', color: '#374151', padding: '2px 8px', borderRadius: 10 }}>LINKED</span>
                          )
                        ) : (
                          <span style={{ fontSize: 10, fontWeight: 700, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 10 }}>MANUAL LENDER</span>
                        )}
                      </div>
                      {!lender.platform_lender_id && (
                         <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>
                           Not evaluated in ESR until linked.
                         </div>
                      )}
                      <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                        LAP · HL · Working Capital · Term Loan
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#10B981' }}>Active</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#4B5563' }}>{configuredProductsCount} products configured</span>
                    {isAdmin && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setLenderModal({ open: true, initialData: lender });
                        }}
                        style={{
                          background: '#fff', color: '#4B5563', border: '1px solid #D1D5DB', borderRadius: 20,
                          padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6
                        }}
                      >
                        <Edit2 size={14} /> Edit Settings
                      </button>
                    )}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setContactModal({ open: true, lender, initialData: null });
                      }}
                      style={{
                        background: '#6366F1', color: 'white', border: 'none', borderRadius: 20,
                        padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 6
                      }}
                    >
                      <Plus size={14} /> Add Contact
                    </button>
                    {isExpanded ? <ChevronUp size={20} color="#9CA3AF" /> : <ChevronDown size={20} color="#9CA3AF" />}
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #E5E7EB' }}>
                    {/* Contact Details Section */}
                    <div style={{ padding: '24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={sectionTitle}>CONTACT PERSONS ({lender.contacts?.length || 0})</div>
                        <button onClick={() => setContactModal({ open: true, lender, initialData: null })}
                          style={{ background: 'none', border: 'none', color: '#6366F1', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Plus size={14} /> Add Contact
                        </button>
                      </div>

                      {(!lender.contacts || lender.contacts.length === 0) ? (
                        <div style={{ padding: '20px', background: '#F9FAFB', borderRadius: 8, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
                          No contacts configured yet. Add one to send proposals to this lender.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {lender.contacts.map(c => (
                            <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid #E5E7EB', borderRadius: 8, background: '#fff' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {c.contact_name}
                                    {c.is_primary && <span style={{ fontSize: 10, padding: '2px 6px', background: '#FEF3C7', color: '#92400E', borderRadius: 10, fontWeight: 700 }}>PRIMARY</span>}
                                  </div>
                                  <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{c.contact_email} {c.contact_mobile ? `· ${c.contact_mobile}` : ''}</div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div style={{ textAlign: 'right' }}>
                                  <ProductBadge type={c.product_type} />
                                  {c.dsa_code && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>DSA Code: {c.dsa_code}</div>}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <button onClick={() => setContactModal({ open: true, lender, initialData: c })} style={iconBtn}><Edit2 size={16} /></button>
                                  <button onClick={() => handleDeleteContact(c.id)} style={{...iconBtn, color: '#EF4444'}}><Trash2 size={16} /></button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ height: 1, background: '#E5E7EB' }} />

                    {/* Commission Rules Section */}
                    <div style={{ padding: '24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Briefcase size={16} color="#4B5563" />
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#4F46E5' }}>Commission Rules</span>
                          <span style={{ fontSize: 12, color: '#6B7280' }}>Configured per product · Slabs are monthly (reset each month)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                          <span style={{ color: '#4B5563' }}>Payout on:</span>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input type="radio" checked={ruleState.payout_basis === 'NET_DISBURSED'} 
                              onChange={() => updateRuleEdit(lender.id, activeProduct, { payout_basis: 'NET_DISBURSED' })}/>
                            Net Disbursed
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input type="radio" checked={ruleState.payout_basis === 'GROSS_SANCTIONED'} 
                              onChange={() => updateRuleEdit(lender.id, activeProduct, { payout_basis: 'GROSS_SANCTIONED' })}/>
                            Gross Sanctioned
                          </label>
                        </div>
                        
                      </div>

                      {/* Product Tabs */}
                      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid #E5E7EB', paddingBottom: 16 }}>
                        {PRODUCT_TYPES.map(pt => {
                          const isConfigured = !!getRuleForLenderProduct(lender.id, pt);
                          const isActive = activeProduct === pt;
                          return (
                            <button key={pt} onClick={() => setActiveProductTabs({...activeProductTabs, [lender.id]: pt})} style={{
                              padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                              border: isActive ? 'none' : '1px solid #E5E7EB',
                              background: isActive ? '#6366F1' : '#fff',
                              color: isActive ? '#fff' : '#4B5563',
                              display: 'flex', alignItems: 'center', gap: 6
                            }}>
                              {pt} 
                              {isConfigured ? <Check size={12} color={isActive ? '#A7F3D0' : '#10B981'} /> : <span style={{ fontSize: 10, color: isActive ? '#C7D2FE' : '#9CA3AF' }}>Not set</span>}
                            </button>
                          );
                        })}
                      </div>

                      {/* Slabs Grids */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
                        {/* Volume Slabs */}
                        <div>
                          <div style={slabHeader}>VOLUME-BASED SLABS (MONTHLY DISBURSEMENT)</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 40px', gap: 12, marginBottom: 8, fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
                            <div>FROM (₹ CR)</div>
                            <div>TO (₹ CR)</div>
                            <div>RATE (%)</div>
                            <div></div>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {ruleState.volume_slabs.map((slab, idx) => (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 40px', gap: 12, alignItems: 'center' }}>
                                <input type="number" value={slab.from_amount} 
                                  onChange={e => {
                                    const newSlabs = [...ruleState.volume_slabs];
                                    newSlabs[idx].from_amount = e.target.value;
                                    updateRuleEdit(lender.id, activeProduct, { volume_slabs: newSlabs });
                                  }} style={slabInput} />
                                <input type="number" value={slab.to_amount || ''} placeholder="∞"
                                  onChange={e => {
                                    const newSlabs = [...ruleState.volume_slabs];
                                    newSlabs[idx].to_amount = e.target.value;
                                    updateRuleEdit(lender.id, activeProduct, { volume_slabs: newSlabs });
                                  }} style={slabInput} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <input type="number" step="0.01" value={slab.percent_rate} 
                                    onChange={e => {
                                      const newSlabs = [...ruleState.volume_slabs];
                                      newSlabs[idx].percent_rate = e.target.value;
                                      updateRuleEdit(lender.id, activeProduct, { volume_slabs: newSlabs });
                                    }} style={slabInput} />
                                  <span style={{ fontSize: 13, color: '#6B7280' }}>%</span>
                                </div>
                                <button onClick={() => {
                                  const newSlabs = ruleState.volume_slabs.filter((_, i) => i !== idx);
                                  updateRuleEdit(lender.id, activeProduct, { volume_slabs: newSlabs });
                                }} style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#EF4444' }}>
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                            <button onClick={() => {
                              const newSlabs = [...ruleState.volume_slabs, { from_amount: 0, to_amount: '', percent_rate: 0 }];
                              updateRuleEdit(lender.id, activeProduct, { volume_slabs: newSlabs });
                            }} style={{ background: 'none', border: 'none', color: '#4F46E5', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, width: 'fit-content', marginTop: 4 }}>
                              <Plus size={14} /> Add Slab
                            </button>
                          </div>
                        </div>

                        {/* Cases Slabs */}
                        <div>
                          <div style={slabHeader}>CASES-BASED SLABS (MONTHLY CASE COUNT)</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 40px', gap: 12, marginBottom: 8, fontSize: 11, fontWeight: 600, color: '#6B7280' }}>
                            <div>FROM (CASES)</div>
                            <div>TO (CASES)</div>
                            <div>PAYOUT PER CASE (₹)</div>
                            <div></div>
                          </div>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {ruleState.case_count_slabs.map((slab, idx) => (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 40px', gap: 12, alignItems: 'center' }}>
                                <input type="number" value={slab.from_cases} 
                                  onChange={e => {
                                    const newSlabs = [...ruleState.case_count_slabs];
                                    newSlabs[idx].from_cases = e.target.value;
                                    updateRuleEdit(lender.id, activeProduct, { case_count_slabs: newSlabs });
                                  }} style={slabInput} />
                                <input type="number" value={slab.to_cases || ''} placeholder="∞"
                                  onChange={e => {
                                    const newSlabs = [...ruleState.case_count_slabs];
                                    newSlabs[idx].to_cases = e.target.value;
                                    updateRuleEdit(lender.id, activeProduct, { case_count_slabs: newSlabs });
                                  }} style={slabInput} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 13, color: '#6B7280' }}>₹</span>
                                  <input type="number" value={slab.payout_per_case} 
                                    onChange={e => {
                                      const newSlabs = [...ruleState.case_count_slabs];
                                      newSlabs[idx].payout_per_case = e.target.value;
                                      updateRuleEdit(lender.id, activeProduct, { case_count_slabs: newSlabs });
                                    }} style={slabInput} />
                                </div>
                                <button onClick={() => {
                                  const newSlabs = ruleState.case_count_slabs.filter((_, i) => i !== idx);
                                  updateRuleEdit(lender.id, activeProduct, { case_count_slabs: newSlabs });
                                }} style={{ background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#EF4444' }}>
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                            <button onClick={() => {
                              const newSlabs = [...ruleState.case_count_slabs, { from_cases: 0, to_cases: '', payout_per_case: 0 }];
                              updateRuleEdit(lender.id, activeProduct, { case_count_slabs: newSlabs });
                            }} style={{ background: 'none', border: 'none', color: '#4F46E5', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, width: 'fit-content', marginTop: 4 }}>
                              <Plus size={14} /> Add Slab
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Info Note */}
                      <div style={{
                        background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8,
                        padding: '12px 16px', marginTop: 24, display: 'flex', gap: 10,
                        fontSize: 13, color: '#4F46E5', lineHeight: 1.5
                      }}>
                        <span style={{ fontSize: 16 }}>📌</span>
                        <div>
                          <strong>Both slabs are calculated independently each month and the totals are added together.</strong> Volume-based is on net disbursed amount (as set above). Cases-based is per number of cases disbursed in the calendar month.
                        </div>
                      </div>

                      {/* Save Button Container */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                        <button 
                          onClick={() => handleSaveRule(lender.id, activeProduct)}
                          disabled={!isEditingRule}
                          style={{
                            ...btnPrimary, background: '#6366F1', opacity: isEditingRule ? 1 : 0.5,
                            borderRadius: 20, padding: '8px 24px'
                          }}
                        >
                          Save {activeProduct} Rules
                        </button>
                      </div>

                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <LenderModal
        isOpen={lenderModal.open}
        onClose={() => setLenderModal({ open: false, initialData: null })}
        onSave={handleAddLender}
        platformLenders={platformLenders}
        initialData={lenderModal.initialData}
      />
      <ContactModal
        isOpen={contactModal.open}
        onClose={() => setContactModal({ open: false, lender: null, initialData: null })}
        onSave={handleSaveContact}
        lender={contactModal.lender}
        initialData={contactModal.initialData}
      />
    </div>
  );
}

// ── Shared Styles ─────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)', zIndex: 9999, 
  display: 'flex', justifyContent: 'center', alignItems: 'center',
};
const modalBox = {
  background: '#fff', width: '94%', maxWidth: 480, borderRadius: 16,
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden',
};
const modalHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '20px 24px', borderBottom: '1px solid #E5E7EB',
};
const modalFooter = {
  display: 'flex', justifyContent: 'flex-end', gap: 12,
  padding: '16px 24px', borderTop: '1px solid #E5E7EB',
  background: '#F9FAFB',
};
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 700, color: '#4B5563',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
};
const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 8, fontSize: 14,
  border: '1px solid #D1D5DB', background: '#fff',
  color: '#111827', outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};
const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 16px', borderRadius: 20, fontSize: 14, fontWeight: 600,
  background: '#6366F1', color: '#fff', border: 'none', cursor: 'pointer',
};
const btnOutline = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 16px', borderRadius: 20, fontSize: 14, fontWeight: 600,
  background: '#fff', color: '#374151',
  border: '1px solid #D1D5DB', cursor: 'pointer',
};
const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#9CA3AF', display: 'flex', alignItems: 'center',
  padding: 6, borderRadius: 8, transition: 'background 0.2s',
};

const emptyCard = {
  textAlign: 'center', padding: '80px 40px', background: '#fff',
  borderRadius: 16, border: '2px dashed #D1D5DB',
};
const sectionTitle = {
  fontSize: 12, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em'
};
const inputLabel = {
  display: 'block', fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', marginBottom: 6
};
const slabHeader = {
  fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 16
};
const slabInput = {
  width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #D1D5DB',
  fontSize: 13, textAlign: 'center'
};
