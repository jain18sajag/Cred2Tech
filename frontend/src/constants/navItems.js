import {
  LayoutDashboard,
  Users,
  UserPlus,
  GitBranch,
  User,
  Settings,
  Building,
  BarChart,
  Briefcase,
  Activity
} from 'lucide-react';

export const NAV_ITEMS = [
  // SUPER_ADMIN Views
  {
    id: 'analytics',
    label: 'Platform Analytics',
    path: '/',
    icon: BarChart,
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'tenants',
    label: 'Tenant Management',
    path: '/tenants',
    icon: Building,
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'internal-team',
    label: 'Cred2Tech Team',
    path: '/users',
    icon: Users,
    roles: ['SUPER_ADMIN'],
  },

  {
    id: 'admin-pricing',
    label: 'API Pricing',
    path: '/admin/pricing',
    icon: Settings,
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'admin-wallets',
    label: 'Tenant Wallets',
    path: '/admin/wallets',
    icon: Briefcase,
    roles: ['SUPER_ADMIN'],
  },
  {
    id: 'admin-api-logs',
    label: 'API Observability',
    path: '/admin/logs',
    icon: Activity,
    roles: ['SUPER_ADMIN'],
  },

  // DSA_ADMIN Views
  {
    id: 'dsa-dashboard',
    label: 'Dashboard',
    path: '/',
    icon: LayoutDashboard,
    roles: ['DSA_ADMIN'],
  },
  {
    id: 'dsa-team',
    label: 'Team Management',
    path: '/users',
    icon: Users,
    roles: ['DSA_ADMIN'],
  },
  {
    id: 'dsa-hierarchy',
    label: 'Hierarchy Management',
    path: '/hierarchy',
    icon: GitBranch,
    roles: ['DSA_ADMIN'],
  },
  {
    id: 'dsa-pipeline',
    label: 'Pipeline & Customers',
    path: '/customers',
    icon: Briefcase,
    roles: ['DSA_ADMIN', 'DSA_MEMBER'],
  },
  {
    id: 'dsa-create-user',
    label: 'Create User',
    path: '/users/create',
    icon: UserPlus,
    roles: ['DSA_ADMIN'],
  },

  // DSA_MEMBER / Shared Views
  {
    id: 'profile',
    label: 'My Profile',
    path: '/profile',
    icon: User,
    roles: ['SUPER_ADMIN', 'DSA_ADMIN', 'DSA_MEMBER', 'CRED2TECH_MEMBER'],
  },
  {
    id: 'my-manager',
    label: 'My Manager',
    path: '/manager',
    icon: Users,
    roles: ['DSA_MEMBER'],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    roles: ['SUPER_ADMIN'],
    disabled: true,
    badge: 'Soon',
  },
];
