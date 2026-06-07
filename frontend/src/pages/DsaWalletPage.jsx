import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Wallet, History, Users, PlusCircle, IndianRupee, ArrowRightLeft, User, ShieldCheck } from 'lucide-react';
import { getWalletSummary, getWalletTransactions, getTopups, createOrder, verifyCheckout, getEmployees, allocateEmployeeCredits, revokeEmployeeCredits, cancelTopup } from '../api/dsaWalletService';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { format } from 'date-fns';

const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (document.getElementById('razorpay-checkout-js')) {
      return resolve(true);
    }
    const script = document.createElement('script');
    script.id = 'razorpay-checkout-js';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

const DsaWalletPage = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [topups, setTopups] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Top-up State
  const [topupAmount, setTopupAmount] = useState('');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Employee Modal State
  const [allocationModal, setAllocationModal] = useState({ open: false, type: 'ALLOCATE', user: null, credits: '', note: '' });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    try {
      setLoading(true);
      if (activeTab === 'overview') {
        const res = await getWalletSummary();
        setSummary(res);
      } else if (activeTab === 'transactions') {
        const res = await getWalletTransactions();
        setTransactions(res);
      } else if (activeTab === 'topups') {
        const res = await getTopups();
        setTopups(res);
      } else if (activeTab === 'employees') {
        const res = await getEmployees();
        setEmployees(res);
      }
    } catch (error) {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleTopup = async (e) => {
    e.preventDefault();
    if (!topupAmount || parseInt(topupAmount) < 100) return toast.error('Minimum amount is ₹100');

    setIsProcessingPayment(true);
    try {
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded) {
        setIsProcessingPayment(false);
        return toast.error('Failed to load Razorpay SDK. Check your connection.');
      }

      const orderRes = await createOrder(parseInt(topupAmount));
      
      const options = {
        key: orderRes.key_id,
        amount: orderRes.amount,
        currency: orderRes.currency,
        name: 'Cred2Tech Platform',
        description: 'Wallet Top-up',
        order_id: orderRes.order_id,
        handler: async function (response) {
          try {
            const verifyRes = await verifyCheckout({ ...response, topup_id: orderRes.topup_id });
            if (verifyRes.status === 'CREDITED') {
              toast.success('Wallet credited successfully!');
              setTopupAmount('');
              setActiveTab('overview');
            } else {
              toast.success('Payment received. Processing credit...');
            }
          } catch (err) {
            toast.error('Failed to verify payment');
          }
        },
        theme: { color: '#0f172a' },
        modal: {
          ondismiss: async function () {
            try {
              await cancelTopup(orderRes.topup_id);
              toast.error('Payment cancelled');
              fetchData();
            } catch (err) {
              console.error('Failed to cancel topup', err);
            }
            setIsProcessingPayment(false);
          }
        }
      };

      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (response) {
        toast.error(`Payment Failed: ${response.error.description}`);
      });
      rzp.open();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to initiate payment');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const submitEmployeeAllocation = async (e) => {
    e.preventDefault();
    const creditsNum = parseInt(allocationModal.credits);
    if (!creditsNum || creditsNum <= 0) return toast.error('Invalid amount');

    try {
      if (allocationModal.type === 'ALLOCATE') {
        await allocateEmployeeCredits(allocationModal.user.id, creditsNum, allocationModal.note);
      } else {
        await revokeEmployeeCredits(allocationModal.user.id, creditsNum, allocationModal.note);
      }
      toast.success(`Credits ${allocationModal.type.toLowerCase()}d successfully`);
      setAllocationModal({ open: false, type: 'ALLOCATE', user: null, credits: '', note: '' });
      fetchData(); // Refresh employee list
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    }
  };

  const renderTabs = () => (
    <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
      {[
        { id: 'overview', label: 'Overview', icon: Wallet },
        { id: 'add-credits', label: 'Add Credits', icon: PlusCircle },
        { id: 'employees', label: 'Employee Credits', icon: Users },
        { id: 'transactions', label: 'Transactions', icon: ArrowRightLeft },
        { id: 'topups', label: 'Top-up History', icon: History }
      ].map(tab => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          style={{
            padding: '12px 0',
            borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
            color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === tab.id ? 700 : 500,
            display: 'flex', alignItems: 'center', gap: 8, background: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', cursor: 'pointer'
          }}
        >
          <tab.icon size={18} /> {tab.label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Wallet size={28} color="var(--primary)" />
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Wallet & Credits</h1>
      </div>

      {renderTabs()}

      {loading ? <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div> : (
        <>
          {activeTab === 'overview' && summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              <div className="card" style={{ borderLeft: '4px solid var(--primary)' }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Total Available Credits</p>
                <h2 style={{ fontSize: 32, fontWeight: 800, marginTop: 8 }}>₹{summary.total_available.toLocaleString()}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Total balance owned by your DSA</p>
              </div>
              <div className="card">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Unallocated (Master Pool)</p>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: 'var(--text-primary)' }}>₹{summary.unallocated_balance.toLocaleString()}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Available to allocate</p>
              </div>
              <div className="card">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Currently Allocated</p>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: 'var(--text-secondary)' }}>₹{summary.employee_allocated.toLocaleString()}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Locked in employee wallets</p>
              </div>
              <div className="card">
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Employee Consumed</p>
                <h2 style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: 'var(--danger)' }}>₹{summary.employee_consumed.toLocaleString()}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Total spent by employees</p>
              </div>
            </div>
          )}

          {activeTab === 'add-credits' && (
            <div className="card card-padded" style={{ maxWidth: 500 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Add Credits via Razorpay</h2>
              <form onSubmit={handleTopup}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Amount (INR)</label>
                  <div style={{ position: 'relative' }}>
                    <IndianRupee size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-tertiary)' }} />
                    <input
                      type="number"
                      className="form-control"
                      style={{ paddingLeft: 36 }}
                      value={topupAmount}
                      onChange={e => setTopupAmount(e.target.value)}
                      placeholder="Enter amount (Min ₹100)"
                      min="100"
                      max="500000"
                      required
                    />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={isProcessingPayment}>
                  {isProcessingPayment ? 'Processing...' : 'Proceed to Pay'}
                </button>
              </form>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                <ShieldCheck size={16} color="var(--success)" /> Secured by Razorpay
              </div>
            </div>
          )}

          {activeTab === 'employees' && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: 16, fontWeight: 700 }}>Employee Wallet Allocation</h3>
                <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Allocate or revoke credits for your DSA team members</p>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                    <th style={{ padding: '16px 24px' }}>Employee</th>
                    <th style={{ padding: '16px 24px' }}>Role</th>
                    <th style={{ padding: '16px 24px' }}>Allocated Balance</th>
                    <th style={{ padding: '16px 24px' }}>Consumed</th>
                    <th style={{ padding: '16px 24px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => {
                    const wallet = emp.EmployeeWallet?.[0] || { allocated_balance: 0, consumed_credits: 0 };
                    return (
                      <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '16px 24px' }}>
                          <div style={{ fontWeight: 600 }}>{emp.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{emp.email}</div>
                        </td>
                        <td style={{ padding: '16px 24px' }}>
                          <Badge variant="neutral">{emp.role?.name}</Badge>
                        </td>
                        <td style={{ padding: '16px 24px', fontWeight: 700, color: 'var(--primary)' }}>
                          ₹{wallet.allocated_balance.toLocaleString()}
                        </td>
                        <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>
                          ₹{wallet.consumed_credits.toLocaleString()}
                        </td>
                        <td style={{ padding: '16px 24px', textAlign: 'right', gap: 8, display: 'flex', justifyContent: 'flex-end' }}>
                          <button className="btn btn-outline btn-xs" onClick={() => setAllocationModal({ open: true, type: 'ALLOCATE', user: emp, credits: '', note: '' })}>Allocate</button>
                          <button className="btn btn-outline btn-xs" onClick={() => setAllocationModal({ open: true, type: 'REVOKE', user: emp, credits: '', note: '' })} disabled={wallet.allocated_balance === 0}>Revoke</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="card" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                    <th style={{ padding: '16px 24px' }}>Date</th>
                    <th style={{ padding: '16px 24px' }}>Type</th>
                    <th style={{ padding: '16px 24px' }}>Reference</th>
                    <th style={{ padding: '16px 24px' }}>Amount</th>
                    <th style={{ padding: '16px 24px' }}>Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map(tx => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontSize: 13 }}>
                        {format(new Date(tx.created_at), 'dd MMM yyyy HH:mm')}
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        <Badge variant={tx.transaction_type === 'CREDIT' ? 'success' : 'neutral'}>{tx.transaction_type}</Badge>
                      </td>
                      <td style={{ padding: '16px 24px', fontSize: 13 }}>
                        <div style={{ fontWeight: 600 }}>{tx.reference_type}</div>
                        <div style={{ color: 'var(--text-tertiary)' }}>{tx.remarks}</div>
                      </td>
                      <td style={{ padding: '16px 24px', fontWeight: 700, color: tx.transaction_type === 'CREDIT' ? 'var(--success)' : 'var(--text-primary)' }}>
                        {tx.transaction_type === 'CREDIT' ? '+' : '-'}₹{tx.amount.toLocaleString()}
                      </td>
                      <td style={{ padding: '16px 24px', fontWeight: 600, color: 'var(--primary)' }}>
                        ₹{tx.balance_after.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && <tr><td colSpan="5" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No transactions found</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'topups' && (
            <div className="card" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                    <th style={{ padding: '16px 24px' }}>Date</th>
                    <th style={{ padding: '16px 24px' }}>Order ID</th>
                    <th style={{ padding: '16px 24px' }}>Amount</th>
                    <th style={{ padding: '16px 24px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {topups.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontSize: 13 }}>
                        {format(new Date(t.created_at), 'dd MMM yyyy HH:mm')}
                      </td>
                      <td style={{ padding: '16px 24px', fontSize: 13, fontFamily: 'monospace' }}>{t.razorpay_order_id}</td>
                      <td style={{ padding: '16px 24px', fontWeight: 600 }}>₹{t.amount_inr}</td>
                      <td style={{ padding: '16px 24px' }}>
                        <Badge variant={
                          t.status === 'CREDITED' ? 'success' : 
                          (t.status === 'FAILED' ? 'danger' : 
                          (t.status === 'CANCELLED' ? 'warning' : 'neutral'))
                        }>
                          {t.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                  {topups.length === 0 && <tr><td colSpan="4" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>No top-ups found</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {allocationModal.open && (
        <Modal title={`${allocationModal.type === 'ALLOCATE' ? 'Allocate' : 'Revoke'} Credits: ${allocationModal.user?.name}`} onClose={() => setAllocationModal({ open: false, type: 'ALLOCATE', user: null, credits: '', note: '' })}>
          <form onSubmit={submitEmployeeAllocation}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Credits Amount</label>
              <input type="number" className="form-control" value={allocationModal.credits} onChange={e => setAllocationModal({ ...allocationModal, credits: e.target.value })} required min="1" />
              {allocationModal.type === 'REVOKE' && <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>Maximum allowed: ₹{allocationModal.user?.EmployeeWallet?.[0]?.allocated_balance || 0}</p>}
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Note (Optional)</label>
              <input type="text" className="form-control" value={allocationModal.note} onChange={e => setAllocationModal({ ...allocationModal, note: e.target.value })} />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Confirm</button>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default DsaWalletPage;
