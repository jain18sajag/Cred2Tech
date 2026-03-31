import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import AppLayout from '../layouts/AppLayout';
import ProtectedRoute from './ProtectedRoute';
import LoadingSpinner from '../components/ui/LoadingSpinner';

// Lazy-load pages for better performance
const LoginPage = lazy(() => import('../pages/LoginPage'));
const DashboardPage = lazy(() => import('../pages/DashboardPage'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const UsersListPage = lazy(() => import('../pages/UsersListPage'));
const UserDetailPage = lazy(() => import('../pages/UserDetailPage'));
const CreateUserPage = lazy(() => import('../pages/CreateUserPage'));
const CreateTenantPage = lazy(() => import('../pages/CreateTenantPage'));
const TenantsListPage = lazy(() => import('../pages/TenantsListPage'));
const EditUserPage = lazy(() => import('../pages/EditUserPage'));
const HierarchyPage = lazy(() => import('../pages/HierarchyPage'));
const UnauthorizedPage = lazy(() => import('../pages/UnauthorizedPage'));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'));
const DSARegisterPage = lazy(() => import('../pages/DSARegisterPage'));

const PageLoader = () => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <LoadingSpinner size={40} fullPage />
  </div>
);

const AppRouter = () => (
  <BrowserRouter>
    <AuthProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register-dsa" element={<DSARegisterPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/users" element={<UsersListPage />} />
            <Route
              path="/users/create"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN', 'DSA_ADMIN', 'CRED2TECH_MEMBER']}>
                  <CreateUserPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/tenants/create"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <CreateTenantPage />
                </ProtectedRoute>
              }
            />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/users/:id/edit" element={<EditUserPage />} />
            <Route
              path="/tenants"
              element={
                <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                  <TenantsListPage />
                </ProtectedRoute>
              }
            />
            <Route path="/hierarchy" element={<HierarchyPage />} />
          </Route>

          {/* Fallbacks */}
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  </BrowserRouter>
);

export default AppRouter;
