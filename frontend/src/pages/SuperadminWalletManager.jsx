import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Briefcase, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react';
import FormField from '../components/ui/FormField';
import api from '../api/axiosInstance';

const SuperadminWalletManager = () => {
   const [wallets, setWallets] = useState([]);
   const [loading, setLoading] = useState(true);
   const [page, setPage] = useState(1);
   const [totalPages, setTotalPages] = useState(1);

   const [modal, setModal] = useState({ isOpen: false, type: null, tenant: null, credits: '', remarks: '', loading: false });

   useEffect(() => { fetchWallets(); }, [page]);

   const fetchWallets = async () => {
      try {
         setLoading(true);
         const res = await api.get(`/admin/wallet/tenants/wallets?page=${page}&limit=50`);
         setWallets(res.data.tenants || []);
         setTotalPages(res.data.totalPages || 1);
      } catch (err) { toast.error("Failed to load wallets"); }
      finally { setLoading(false); }
   };

   const handleAction = async () => {
      if (!modal.credits || modal.credits <= 0) return toast.error("Enter valid positive credits");
      try {
         setModal(prev => ({ ...prev, loading: true }));
         const endpoint = `/admin/wallet/tenants/${modal.tenant.tenant_id}/wallet/${modal.type === 'TOPUP' ? 'topup' : 'deduct'}`;
         await api.post(endpoint, {
            credits: parseInt(modal.credits, 10),
            remarks: modal.remarks
         });

         toast.success(`Successfully ${modal.type === 'TOPUP' ? 'added' : 'deducted'} credits!`);
         setModal({ isOpen: false, type: null, tenant: null, credits: '', remarks: '', loading: false });
         fetchWallets();
      } catch (err) {
         toast.error(err.response?.data?.error || err.message);
         setModal(prev => ({ ...prev, loading: false }));
      }
   };

   if (loading) return <div>Loading...</div>;

   return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <Briefcase size={28} color="var(--primary)" />
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>DSA Wallets Management</h1>
         </div>

         <div className="card" style={{ padding: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
               <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                     <th style={{ padding: '12px 16px' }}>DSA Name</th>
                     <th style={{ padding: '12px 16px' }}>Wallet Balance</th>
                     <th style={{ padding: '12px 16px' }}>Total Pings</th>
                     <th style={{ padding: '12px 16px' }}>Last Activity</th>
                     <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
                  </tr>
               </thead>
               <tbody>
                  {wallets.map(t => (
                     <tr key={t.tenant_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '16px', fontWeight: 600 }}>{t.tenant_name}</td>
                        <td style={{ padding: '16px' }}>
                           <span style={{ fontSize: 18, fontWeight: 700, color: t.wallet_balance > 0 ? 'var(--success)' : 'var(--error)' }}>
                              {t.wallet_balance.toLocaleString()}
                           </span>
                        </td>
                        <td style={{ padding: '16px' }}>{t.total_usage}</td>
                        <td style={{ padding: '16px', color: 'var(--text-tertiary)', fontSize: 13 }}>
                           {t.last_transaction_date ? new Date(t.last_transaction_date).toLocaleString() : 'Never'}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>
                           <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button onClick={() => setModal({ isOpen: true, type: 'DEDUCT', tenant: t, credits: '', remarks: '' })} className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }}><ArrowDownRight size={14} /> Deduct</button>
                              <button onClick={() => setModal({ isOpen: true, type: 'TOPUP', tenant: t, credits: '', remarks: '' })} className="btn btn-secondary btn-sm" style={{ color: 'var(--success)' }}><ArrowUpRight size={14} /> Top-Up</button>
                           </div>
                        </td>
                     </tr>
                  ))}
                  {wallets.length === 0 && (
                     <tr><td colSpan="5" style={{ textAlign: 'center', padding: 24 }}>No DSA found</td></tr>
                  )}
               </tbody>
            </table>

            {totalPages > 1 && (
               <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
                  <button className="btn btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>← Prev</button>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Page {page} of {totalPages}</span>
                  <button className="btn btn-ghost btn-sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next →</button>
               </div>
            )}
         </div>

         {modal.isOpen && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               <div style={{ background: 'var(--bg-base)', padding: 32, borderRadius: 12, width: '100%', maxWidth: 440, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
                  <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                     {modal.type === 'TOPUP' ? 'Top-Up Credits' : 'Deduct Credits'}
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
                     Target DSA: <strong>{modal.tenant.tenant_name}</strong> (Current: {modal.tenant.wallet_balance})
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                     <FormField label="CREDITS AMOUNT" name="credits">
                        <input type="number" min="1" autoFocus className="form-control" value={modal.credits} onChange={e => setModal(prev => ({ ...prev, credits: e.target.value }))} />
                     </FormField>
                     <FormField label="REMARKS (Audit Reason)" name="remarks">
                        <input type="text" className="form-control" value={modal.remarks} onChange={e => setModal(prev => ({ ...prev, remarks: e.target.value }))} placeholder="E.g. Invoice #124 or Manual Correction" />
                     </FormField>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                     <button type="button" className="btn btn-ghost" onClick={() => setModal({ isOpen: false })} disabled={modal.loading}>Cancel</button>
                     <button type="button" className="btn btn-primary" onClick={handleAction} disabled={modal.loading || !modal.credits}>
                        {modal.loading ? 'Confirming...' : 'Confirm Action'}
                     </button>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
};

export default SuperadminWalletManager;
