import React, { useState, useEffect } from 'react';
import api from '../api/axiosInstance';
import toast from 'react-hot-toast';
import { Loader2, Users, Building, ArrowRight, Activity, CalendarDays, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';

const AdminMsmeCasesPage = () => {
  const [cases, setCases] = useState([]);
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);

  // Allocation Modal State
  const [showModal, setShowModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [selectedUser, setSelectedUser] = useState('');

  useEffect(() => {
    fetchCases();
    fetchTargets();
  }, []);

  const fetchCases = async () => {
    try {
      const res = await api.get('/admin/msme-cases');
      setCases(res.data);
    } catch (err) {
      toast.error('Failed to load MSME cases');
    } finally {
      setLoading(false);
    }
  };

  const fetchTargets = async () => {
    try {
      const res = await api.get('/admin/msme-cases/allocation-targets');
      setTargets(res.data);
    } catch (err) {
      console.error('Failed to fetch allocation targets', err);
    }
  };

  const openAllocateModal = (c) => {
    setSelectedCase(c);
    setSelectedTenant('');
    setSelectedUser('');
    setShowModal(true);
  };

  const handleAllocate = async () => {
    if (!selectedTenant || !selectedUser) {
      toast.error('Please select a DSA and a user');
      return;
    }
    setAllocating(true);
    try {
      await api.post(`/admin/msme-cases/${selectedCase.id}/allocate`, {
        dsa_tenant_id: selectedTenant,
        dsa_user_id: selectedUser
      });
      toast.success('Case successfully allocated to DSA');
      setShowModal(false);
      fetchCases();
    } catch (err) {
      toast.error('Failed to allocate case');
    } finally {
      setAllocating(false);
    }
  };

  const availableUsers = targets.find(t => t.id === parseInt(selectedTenant))?.users || [];

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-indigo-500 w-10 h-10" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-500" />
            Direct MSME Leads
          </h1>
          <p className="text-slate-500 text-sm mt-1">Manage and allocate self-onboarded MSME customers to DSA partners.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Business</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Requested Loan</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Payment</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Allocation</th>
              <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {cases.length === 0 && (
              <tr><td colSpan="6" className="px-6 py-10 text-center text-slate-500">No Direct MSME cases found.</td></tr>
            )}
            {cases.map(c => (
              <tr key={c.id} className="hover:bg-slate-50 transition">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-bold text-slate-800">{c.customer?.business_name || 'N/A'}</div>
                  <div className="text-xs text-slate-500">PAN: {c.customer?.business_pan}</div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" /> {format(new Date(c.created_at), 'MMM dd, yyyy')}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-semibold text-slate-800">
                    {c.loan_amount ? `₹${c.loan_amount.toLocaleString()}` : 'Not Specified'}
                  </div>
                  <div className="text-xs text-slate-500">{c.product_type}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    c.stage === 'LEAD_CREATED' ? 'bg-amber-100 text-amber-800' :
                    c.stage === 'ESR_GENERATED' ? 'bg-indigo-100 text-indigo-800' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {c.stage}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {c.case_payment ? (
                    <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded">Paid</span>
                  ) : (
                    <span className="text-xs font-semibold text-slate-400">Pending</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {c.assigned_dsa_tenant_id ? (
                    <div>
                      <div className="text-sm font-bold text-slate-800">{c.assigned_dsa_user?.name}</div>
                      <div className="text-xs text-slate-500">Allocated on {c.allocated_at ? format(new Date(c.allocated_at), 'MMM dd') : ''}</div>
                    </div>
                  ) : (
                    <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">Unallocated</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  {c.stage === 'LEAD_CREATED' && !c.assigned_dsa_tenant_id && (
                    <button
                      onClick={() => openAllocateModal(c)}
                      className="text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                    >
                      Allocate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-bold text-slate-800">Allocate Case to DSA</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Select DSA Partner</label>
                <select 
                  value={selectedTenant} 
                  onChange={(e) => { setSelectedTenant(e.target.value); setSelectedUser(''); }}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Select DSA --</option>
                  {targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {selectedTenant && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Select DSA Agent</label>
                  <select 
                    value={selectedUser} 
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Select User --</option>
                    {availableUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role.name})</option>)}
                  </select>
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAllocate}
                  disabled={allocating || !selectedTenant || !selectedUser}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 flex justify-center items-center"
                >
                  {allocating ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Confirm Allocation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminMsmeCasesPage;
