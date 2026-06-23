import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { MsmeAuthProvider, useMsmeAuth } from '../context/MsmeAuthContext';
import { Toaster } from 'react-hot-toast';
import '../styles/msme-theme.css';

const LayoutContent = () => {
  const { user, logout } = useMsmeAuth();
  const location = useLocation();

  const isLoginPage = location.pathname.includes('/login');

  if (isLoginPage) {
    // For login, we don't want the topbar, just render the Outlet
    return (
      <div className="msme-portal msme-bg">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="msme-portal msme-bg" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ 
        background: 'rgba(255,255,255,.95)', 
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 28px',
        height: '60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px', background: '#1D1D1F',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: '800', fontSize: '12px', color: '#fff'
          }}>
            c2t
          </div>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: '700', letterSpacing: '-.2px', margin: 0 }}>Cred2Tech</h3>
            <p style={{ fontSize: '11px', color: 'var(--light)', margin: 0 }}>MSME Portal</p>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {user && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', fontWeight: '600' }}>{user.name}</div>
              <button onClick={logout} className="btn-ghost" style={{ fontSize: '11px' }}>Logout</button>
            </div>
          )}
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%', background: 'var(--grad)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: '600', fontSize: '12px'
          }}>
            {user?.name?.charAt(0) || 'U'}
          </div>
        </div>
      </header>

      <main className="msme-container" style={{ flex: 1, width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
};

const MsmeLayout = () => {
  return (
    <MsmeAuthProvider>
      <LayoutContent />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            fontFamily: 'Inter, sans-serif',
            fontSize: 14,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          },
        }}
      />
    </MsmeAuthProvider>
  );
};

export default MsmeLayout;
