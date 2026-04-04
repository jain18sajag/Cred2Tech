import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Settings, Save } from 'lucide-react';
import FormField from '../components/ui/FormField';

const SuperadminPricingPage = () => {
  const [pricing, setPricing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ credit_cost: 0, is_active: true });

  useEffect(() => {
    fetchPricing();
  }, []);

  const fetchPricing = async () => {
    try {
      const res = await fetch(`http://localhost:5000/admin/wallet/api-pricing`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await res.json();
      setPricing(data);
    } catch (err) {
      toast.error('Failed to load pricing');
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setEditForm({ credit_cost: p.default_credit_cost, is_active: p.is_active });
  };

  const handleSave = async (id) => {
    try {
      const res = await fetch(`http://localhost:5000/admin/wallet/api-pricing/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(editForm)
      });
      
      if (!res.ok) throw new Error('Failed to update');
      toast.success('Pricing updated!');
      setEditingId(null);
      fetchPricing();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Settings size={28} color="var(--primary)" />
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Global API Pricing Configuration</h1>
      </div>

      <div className="card" style={{ padding: 24 }}>
         <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
               <tr style={{ borderBottom: '2px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px 16px' }}>API Name</th>
                  <th style={{ padding: '12px 16px' }}>API Code</th>
                  <th style={{ padding: '12px 16px' }}>Default Cost</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
               </tr>
            </thead>
            <tbody>
               {pricing.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                     <td style={{ padding: '16px' }}>{p.api_name || 'System API'}</td>
                     <td style={{ padding: '16px', fontFamily: 'monospace' }}>{p.api_code}</td>
                     
                     <td style={{ padding: '16px' }}>
                        {editingId === p.id ? (
                           <input type="number" className="form-control" value={editForm.credit_cost} onChange={e => setEditForm({...editForm, credit_cost: parseInt(e.target.value)||0})} style={{ width: 100 }} />
                        ) : (
                           <span style={{ fontWeight: 600 }}>{p.default_credit_cost} Credits</span>
                        )}
                     </td>

                     <td style={{ padding: '16px' }}>
                        {editingId === p.id ? (
                           <select className="form-control" value={editForm.is_active} onChange={e => setEditForm({...editForm, is_active: e.target.value === 'true'})}>
                              <option value="true">Active</option>
                              <option value="false">Disabled</option>
                           </select>
                        ) : (
                           <span style={{ color: p.is_active ? 'var(--success)' : 'var(--error)', fontWeight: 600, fontSize: 13 }}>
                              {p.is_active ? 'ACTIVE' : 'DISABLED'}
                           </span>
                        )}
                     </td>

                     <td style={{ padding: '16px', textAlign: 'right' }}>
                        {editingId === p.id ? (
                           <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button onClick={() => setEditingId(null)} className="btn btn-ghost btn-sm">Cancel</button>
                              <button onClick={() => handleSave(p.id)} className="btn btn-primary btn-sm" style={{ display: 'flex', gap: 6 }}><Save size={14}/> Save</button>
                           </div>
                        ) : (
                           <button onClick={() => startEdit(p)} className="btn btn-secondary btn-sm">Edit Cost</button>
                        )}
                     </td>
                  </tr>
               ))}
            </tbody>
         </table>
      </div>
    </div>
  );
};

export default SuperadminPricingPage;
