import {
  LayoutDashboard,
  Users,
  UserPlus,
  GitBranch,
  User,
  Settings,
} from 'lucide-react';

// Each nav item: which roles can see it
export const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    path: '/',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'DSA', 'EMPLOYEE', 'PARTNER', 'MSME'],
  },
  {
    id: 'profile',
    label: 'My Profile',
    path: '/profile',
    icon: User,
    roles: ['ADMIN', 'DSA', 'EMPLOYEE', 'PARTNER', 'MSME'],
  },
  {
    id: 'users',
    label: 'Users',
    path: '/users',
    icon: Users,
    roles: ['ADMIN', 'DSA', 'EMPLOYEE'],
  },
  {
    id: 'create-user',
    label: 'Create User',
    path: '/users/create',
    icon: UserPlus,
    roles: ['ADMIN', 'DSA', 'EMPLOYEE'],
  },
  {
    id: 'hierarchy',
    label: 'Hierarchy',
    path: '/hierarchy',
    icon: GitBranch,
    roles: ['ADMIN', 'DSA', 'EMPLOYEE'],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: Settings,
    roles: ['ADMIN'],
    disabled: true,
    badge: 'Soon',
  },
];
