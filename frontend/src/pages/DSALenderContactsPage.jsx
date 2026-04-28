import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Plus, Edit2, Trash2, X, ChevronDown, ChevronUp, Mail, Phone, User, Building, Shield } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import {
  getTenantLenders, createTenantLender, updateTenantLender, deleteTenantLender,
  createTenantLenderContact, updateTenantLenderContact, deleteTenantLenderContact,
} from '../api/tenantLenderService';
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

// ── Modal: Add / Edit Lender ──────────────────────────────────────────────────
function LenderModal({ isOpen, onClose, onSave, initial }) {
  const [lenderName, setLenderName] = useState('');
  const [isActive, setIsActive]     = useState(true);
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLenderName(initial?.lender_name || '');
      setIsActive(initial?.is_active !== false);
    }
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!lenderName.trim()) { toast.error('Lender name is required'); return; }
    setSaving(true);
    try {
      await onSave({ lender_name: lenderName, is_active: isActive });
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save lender');
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay}>
      <div style={modalBox}>
        <div style={modalHeader}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {initial ? 'Edit Lender' : 'Add New Lender'}
          </h3>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>LENDER NAME *</label>
            <input value={lenderName} onChange={e => setLenderName(e.target.value)}
              placeholder="e.g. HDFC Bank, Axis Bank, ICICI Bank"
              style={inputStyle} onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="lender-active" checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="lender-active" style={{ fontSize: 14, cursor: 'pointer', color: 'var(--text-primary)' }}>
              Active (appears in Send to Lender dropdown)
            </label>
          </div>
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnOutline}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : (initial ? 'Update Lender' : 'Add Lender')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Add / Edit Contact ─────────────────────────────────────────────────
function ContactModal({ isOpen, onClose, onSave, initial, tenantLenderId }) {
  const [form, setForm] = useState({
    product_type: '', contact_name: '', contact_email: '', contact_mobile: '', is_primary: true
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setForm({
        product_type:   initial?.product_type   || '',
        contact_name:   initial?.contact_name   || '',
        contact_email:  initial?.contact_email  || '',
        contact_mobile: initial?.contact_mobile || '',
        is_primary:     initial?.is_primary !== false,
      });
    }
  }, [isOpen, initial]);

  if (!isOpen) return null;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.product_type)  { toast.error('Product type is required'); return; }
    if (!form.contact_name)  { toast.error('Contact name is required'); return; }
    if (!form.contact_email) { toast.error('Contact email is required'); return; }
    setSaving(true);
    try {
      await onSave({ ...form, tenant_lender_id: tenantLenderId });
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save contact');
    } finally { setSaving(false); }
  };

  return (
    <div style={overlay}>
      <div style={{ ...modalBox, maxWidth: 520 }}>
        <div style={modalHeader}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {initial ? 'Edit Contact' : 'Add Contact'}
          </h3>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>PRODUCT TYPE *</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PRODUCT_TYPES.map(pt => (
                <button key={pt} onClick={() => set('product_type', pt)}
                  style={{
                    padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                    border: `2px solid ${form.product_type === pt ? '#4F46E5' : 'var(--border)'}`,
                    background: form.product_type === pt ? '#4F46E5' : 'var(--bg-elevated)',
                    color: form.product_type === pt ? '#fff' : 'var(--text-primary)',
                    transition: 'all 0.15s',
                  }}>
                  {pt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>CONTACT NAME *</label>
            <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)}
              placeholder="e.g. Suresh Nair" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>EMAIL ADDRESS *</label>
            <input value={form.contact_email} onChange={e => set('contact_email', e.target.value)}
              type="email" placeholder="e.g. suresh.nair@hdfc.com" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>MOBILE (optional — for SMS alerts)</label>
            <input value={form.contact_mobile} onChange={e => set('contact_mobile', e.target.value)}
              type="tel" placeholder="e.g. 9820001122" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" id="is-primary" checked={form.is_primary}
              onChange={e => set('is_primary', e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }} />
            <label htmlFor="is-primary" style={{ fontSize: 14, cursor: 'pointer' }}>Primary contact for this product</label>
          </div>
        </div>
        <div style={modalFooter}>
          <button onClick={onClose} style={btnOutline}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving...' : (initial ? 'Update Contact' : 'Add Contact')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function DSALenderContactsPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole('DSA_ADMIN');

  const [lenders, setLenders]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState({});

  // Modals
  const [lenderModal, setLenderModal]   = useState({ open: false, initial: null });
  const [contactModal, setContactModal] = useState({ open: false, initial: null, lenderId: null });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTenantLenders();
      setLenders(data);
    } catch (e) {
      toast.error('Failed to load lender contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = id => setExpanded(e => ({ ...e, [id]: !e[id] }));

  // ── Lender actions ──
  const handleSaveLender = async (payload) => {
    if (lenderModal.initial) {
      await updateTenantLender(lenderModal.initial.id, payload);
      toast.success('Lender updated');
    } else {
      await createTenantLender(payload);
      toast.success('Lender added');
    }
    await load();
  };

  const handleDeleteLender = async (lender) => {
    if (!window.confirm(`Deactivate "${lender.lender_name}"? Existing contacts will still be available.`)) return;
    try {
      await deleteTenantLender(lender.id);
      toast.success('Lender deactivated');
      await load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  // ── Contact actions ──
  const handleSaveContact = async (payload) => {
    if (contactModal.initial) {
      await updateTenantLenderContact(contactModal.initial.id, payload);
      toast.success('Contact updated');
    } else {
      await createTenantLenderContact(payload);
      toast.success('Contact added');
    }
    await load();
  };

  const handleDeleteContact = async (contact) => {
    if (!window.confirm(`Delete contact "${contact.contact_name}"?`)) return;
    try {
      await deleteTenantLenderContact(contact.id);
      toast.success('Contact removed');
      await load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 60 }}>
      <PageHeader
        title="Lender Contact Directory"
        subtitle="Configure lender contacts for proposal email routing. Each contact receives proposal emails when you click 'Send to Lender'."
        actions={isAdmin && (
          <button
            onClick={() => setLenderModal({ open: true, initial: null })}
            style={btnPrimary}
          >
            <Plus size={16} /> Add Lender
          </button>
        )}
      />

      {/* Role note for non-admin */}
      {!isAdmin && (
        <div style={{
          background: '#EBF8FF', border: '1px solid #BEE3F8', borderRadius: 10,
          padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, color: '#2B6CB0',
        }}>
          <Shield size={16} />
          <span>You are viewing lender contacts in <strong>read-only mode</strong>. Contact your DSA Admin to add or edit entries.</span>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <LoadingSpinner size={36} />
        </div>
      ) : lenders.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 40px', background: 'var(--bg-primary)',
          borderRadius: 16, border: '2px dashed var(--border)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏦</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No lenders configured yet</h3>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: 24 }}>
            Add your lender contacts to enable one-click proposal email dispatch from the ESR screen.
          </p>
          {isAdmin && (
            <button onClick={() => setLenderModal({ open: true, initial: null })} style={btnPrimary}>
              <Plus size={16} /> Add First Lender
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {lenders.map(lender => (
            <div key={lender.id} style={{
              background: 'var(--bg-primary)',
              border: `1px solid ${lender.is_active ? 'var(--border)' : '#FED7D7'}`,
              borderLeft: `4px solid ${lender.is_active ? 'var(--primary)' : '#FC8181'}`,
              borderRadius: 12, overflow: 'hidden',
              opacity: lender.is_active ? 1 : 0.75,
            }}>
              {/* Lender header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', cursor: 'pointer',
                background: expanded[lender.id] ? 'var(--bg-elevated)' : 'transparent',
              }}
                onClick={() => toggleExpand(lender.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Building size={18} color="var(--primary)" />
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{lender.lender_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {lender.contacts?.length || 0} contact(s)
                      {!lender.is_active && <span style={{ color: '#C53030', marginLeft: 8 }}>· Inactive</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isAdmin && (
                    <>
                      <button onClick={e => { e.stopPropagation(); setLenderModal({ open: true, initial: lender }); }}
                        title="Edit lender" style={iconBtnSmall}>
                        <Edit2 size={14} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleDeleteLender(lender); }}
                        title="Deactivate lender" style={{ ...iconBtnSmall, color: '#C53030' }}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                  {expanded[lender.id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {/* Contacts accordion */}
              {expanded[lender.id] && (
                <div style={{ padding: '0 20px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Contacts by Product
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => setContactModal({ open: true, initial: null, lenderId: lender.id })}
                        style={{ ...btnOutline, fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Plus size={13} /> Add Contact
                      </button>
                    )}
                  </div>

                  {(!lender.contacts || lender.contacts.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                      No contacts configured for this lender.
                      {isAdmin && ' Click "Add Contact" to set up product-level routing.'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {lender.contacts.map(c => (
                        <div key={c.id} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '12px 16px', borderRadius: 8,
                          background: c.is_primary ? '#F7FAFF' : 'var(--bg-elevated)',
                          border: `1px solid ${c.is_primary ? '#BEE3F8' : 'var(--border)'}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            <ProductBadge type={c.product_type} />
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <User size={13} color="var(--text-tertiary)" />
                                <span style={{ fontSize: 13, fontWeight: 600 }}>{c.contact_name}</span>
                                {c.is_primary && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: '#276749', background: '#F0FFF4', padding: '1px 6px', borderRadius: 4, border: '1px solid #9AE6B4' }}>PRIMARY</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
                                <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <Mail size={11} /> {c.contact_email}
                                </span>
                                {c.contact_mobile && (
                                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Phone size={11} /> {c.contact_mobile}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          {isAdmin && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => setContactModal({ open: true, initial: c, lenderId: lender.id })}
                                style={iconBtnSmall} title="Edit contact">
                                <Edit2 size={13} />
                              </button>
                              <button onClick={() => handleDeleteContact(c)}
                                style={{ ...iconBtnSmall, color: '#C53030' }} title="Delete contact">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <LenderModal
        isOpen={lenderModal.open}
        onClose={() => setLenderModal({ open: false, initial: null })}
        onSave={handleSaveLender}
        initial={lenderModal.initial}
      />
      <ContactModal
        isOpen={contactModal.open}
        onClose={() => setContactModal({ open: false, initial: null, lenderId: null })}
        onSave={handleSaveContact}
        initial={contactModal.initial}
        tenantLenderId={contactModal.lenderId}
      />
    </div>
  );
}

// ── Shared Styles ─────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
  zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center',
};
const modalBox = {
  background: 'var(--bg-primary)', width: '94%', maxWidth: 480, borderRadius: 14,
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
};
const modalHeader = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '18px 24px', borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};
const modalFooter = {
  display: 'flex', justifyContent: 'flex-end', gap: 10,
  padding: '14px 24px', borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};
const labelStyle = {
  display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6,
};
const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14,
  border: '1px solid var(--border)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};
const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 700,
  background: 'var(--primary)', color: '#fff', border: 'none', cursor: 'pointer',
};
const btnOutline = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  background: 'transparent', color: 'var(--text-primary)',
  border: '1px solid var(--border)', cursor: 'pointer',
};
const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
  padding: 4, borderRadius: 4,
};
const iconBtnSmall = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
  padding: '4px 6px', borderRadius: 4, transition: 'color 0.15s',
};
