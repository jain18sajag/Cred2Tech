// Role definitions with display names and styling
export const ROLES = {
  ADMIN: {
    name: 'Admin',
    color: 'var(--role-admin)',
    bg: 'var(--role-admin-bg)',
    description: 'Platform super administrator with full access',
  },
  DSA: {
    name: 'DSA',
    color: 'var(--role-dsa)',
    bg: 'var(--role-dsa-bg)',
    description: 'Direct Selling Agent administrator',
  },
  EMPLOYEE: {
    name: 'Employee',
    color: 'var(--role-employee)',
    bg: 'var(--role-employee-bg)',
    description: 'Field employee within a DSA hierarchy',
  },
  PARTNER: {
    name: 'Partner',
    color: 'var(--role-partner)',
    bg: 'var(--role-partner-bg)',
    description: 'External business partner',
  },
  MSME: {
    name: 'MSME',
    color: 'var(--role-msme)',
    bg: 'var(--role-msme-bg)',
    description: 'Micro, Small & Medium Enterprise client',
  },
};

// Role options for the Create User form (role_id mapped to internal name)
export const ROLE_OPTIONS = [
  { label: 'Admin', value: 'ADMIN' },
  { label: 'DSA', value: 'DSA' },
  { label: 'Employee', value: 'EMPLOYEE' },
  { label: 'Partner', value: 'PARTNER' },
  { label: 'MSME', value: 'MSME' },
];

// Hierarchy levels used by employees
export const HIERARCHY_LEVELS = ['L1', 'L2', 'L3', 'L4'];

// User status options
export const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE'];
