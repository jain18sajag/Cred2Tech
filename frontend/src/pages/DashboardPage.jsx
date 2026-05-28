import React, { Suspense, lazy } from 'react';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const DsaDashboard       = lazy(() => import('./DsaDashboard'));
const PlatformDashboard  = lazy(() => import('./PlatformDashboard'));

const DSA_ROLES = ['DSA_ADMIN', 'DSA_MEMBER', 'SUB_DSA'];
const PLATFORM_ROLES = ['SUPER_ADMIN'];

export default function DashboardPage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <LoadingSpinner />
      </div>
    );
  }

  const role = user.role;

  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <LoadingSpinner />
      </div>
    }>
      {PLATFORM_ROLES.includes(role) && <PlatformDashboard />}
      {DSA_ROLES.includes(role) && <DsaDashboard />}
      {!PLATFORM_ROLES.includes(role) && !DSA_ROLES.includes(role) && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>No dashboard configured</div>
          <div>Your role ({role}) does not have a default dashboard. Contact your administrator.</div>
        </div>
      )}
    </Suspense>
  );
}
