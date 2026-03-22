import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, AlertCircle, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { createUser } from '../api/userService';
import { useAuth } from '../context/AuthContext';
import { ROLE_OPTIONS, HIERARCHY_LEVELS } from '../constants/roles';
import { MOCK_DSA_ACCOUNTS } from '../constants/mockData';
import PageHeader from '../components/ui/PageHeader';
import FormField from '../components/ui/FormField';
import { getErrorMessage } from '../utils/helpers';

const initialForm = { name: '', email: '', mobile: '', password: '', role: '', dsa_id: '', hierarchy_level: '', manager_id: '' };

// Simple front-end role_id map
const ROLE_ID_MAP = { ADMIN: 1, DSA: 2, EMPLOYEE: 3, PARTNER: 4, MSME: 5 };

const CreateUserPage = () => {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    ...initialForm,
    // If current user is DSA or EMPLOYEE, pre-fill their dsa_id
    dsa_id: (currentUser?.role?.name === 'DSA' || currentUser?.role?.name === 'EMPLOYEE') && currentUser?.dsa_id ? String(currentUser.dsa_id) : '',
  });
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    if (errors[name]) setErrors((p) => ({ ...p, [name]: '' }));
    setApiError('');
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Full name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email format';
    if (!form.password) e.password = 'Password is required';
    else if (form.password.length < 6) e.password = 'Minimum 6 characters required';
    if (!form.role) e.role = 'Please select a role';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setIsLoading(true);
    setApiError('');
    try {
      await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        mobile: form.mobile || undefined,
        password: form.password,
        role_id: ROLE_ID_MAP[form.role],
        dsa_id: form.dsa_id ? Number(form.dsa_id) : undefined,
        hierarchy_level: form.hierarchy_level || undefined,
        manager_id: form.manager_id ? Number(form.manager_id) : undefined,
      });
      setSuccess(true);
      toast.success('User created successfully!');
      setTimeout(() => navigate('/users'), 1600);
    } catch (err) {
      setApiError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const availableRoles = ROLE_OPTIONS.filter((r) => {
    if (currentUser?.role?.name === 'ADMIN') return true;
    return ['EMPLOYEE', 'PARTNER', 'MSME'].includes(r.value);
  });

  const isDSARole = form.role === 'EMPLOYEE' || form.role === 'DSA';
  const isDSALocked = currentUser?.role?.name === 'DSA' || currentUser?.role?.name === 'EMPLOYEE';

  return (
    <div>
      <PageHeader
        title="Create User"
        subtitle="Add a new user to the platform"
        breadcrumbs={[{ label: 'Dashboard', path: '/' }, { label: 'Users', path: '/users' }, { label: 'Create User' }]}
      />

      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {success && (
          <div className="notice" style={{ background: 'var(--success-bg)', borderColor: '#6EE7B7', color: '#064E3B', marginBottom: 20 }}>
            <CheckCircle size={16} style={{ flexShrink: 0 }} />
            User created successfully! Redirecting to users list…
          </div>
        )}

        {apiError && (
          <div className="notice notice-error" style={{ marginBottom: 20 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Basic Info */}
          <div className="card card-padded" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 20 }}>
              Basic Information
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <FormField label="Full Name" name="name" value={form.name} onChange={handleChange} placeholder="e.g. John Doe" required error={errors.name} />
              <FormField label="Email Address" name="email" type="email" value={form.email} onChange={handleChange} placeholder="e.g. john@example.com" required error={errors.email} />
              <FormField label="Mobile Number" name="mobile" value={form.mobile} onChange={handleChange} placeholder="e.g. 9876543210" hint="Optional — 10-digit mobile number" />
              <FormField label="Password" name="password" type="password" value={form.password} onChange={handleChange} placeholder="Min. 6 characters" required error={errors.password} />
            </div>
          </div>

          {/* Role */}
          <div className="card card-padded" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 20 }}>
              Role & Access
            </h3>
            <FormField label="Platform Role" name="role" required error={errors.role} hint="Determines what the user can access on the platform.">
              <select name="role" value={form.role} onChange={handleChange} className={`form-control${errors.role ? ' error-input' : ''}`}>
                <option value="">Select a role…</option>
                {availableRoles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </FormField>
          </div>

          {/* Hierarchy & DSA */}
          <div className="card card-padded" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 20 }}>
              Organization & Hierarchy
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
              <FormField
                label="DSA Account ID"
                name="dsa_id"
                value={form.dsa_id}
                onChange={handleChange}
                placeholder="e.g. 1"
                disabled={isDSALocked}
                hint={isDSALocked ? 'Auto-filled from your account' : `Available DSA: ${MOCK_DSA_ACCOUNTS.map(d => `${d.name} (ID: ${d.id})`).join(', ')}`}
              />
              <FormField label="Hierarchy Level" name="hierarchy_level" error={errors.hierarchy_level} hint="Only for EMPLOYEE role users (L1, L2, L3…)">
                <select name="hierarchy_level" value={form.hierarchy_level} onChange={handleChange} className="form-control">
                  <option value="">None (root level)</option>
                  {HIERARCHY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </FormField>
              <FormField
                label="Manager ID"
                name="manager_id"
                value={form.manager_id}
                onChange={handleChange}
                placeholder="e.g. 3"
                hint="Enter the numeric user ID of the manager. Leave blank if no manager."
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/users')} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isLoading || success} style={{ minWidth: 140, justifyContent: 'center' }}>
              {isLoading ? <><div style={{ width: 15, height: 15, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Creating…</> : <><UserPlus size={15} /> Create User</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateUserPage;
