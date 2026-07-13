import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MsmeAuthProvider, useMsmeAuth } from '../context/MsmeAuthContext';
import { Toaster } from 'react-hot-toast';
import '../styles/msme-theme.css';

const LayoutContent = () => {
  const { user, logout } = useMsmeAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isLoginPage = location.pathname.includes('/login');

  if (isLoginPage) {
    // For login, we don't want the topbar, just render the Outlet
    return (
      <div className="msme-portal msme-bg">
        <Outlet />
      </div>
    );
  }

  const navItems = [
    { label: 'My Dashboard', path: '/msme/dashboard', icon: '🏠' },
    { label: 'Check Eligibility', path: '/msme/onboarding', icon: '✨' },
    { label: 'My Cases', path: '/msme/cases', icon: '📁' },
    { label: 'My Documents', path: '/msme/documents', icon: '📄' },
    { label: 'My Profile', path: '/msme/profile', icon: '👤' },
  ];

  return (
    <div className="msme-portal msme-bg" style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif" }}>
      {/* Dark Sidebar */}
      <aside style={{ width: '260px', background: '#0F172A', color: '#fff', display: 'flex', flexDirection: 'column' }}>
        {/* Logo Area */}
        <div style={{ padding: '24px 24px 40px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: '800', fontSize: '14px', color: '#0F172A'
          }}>
            c2t
          </div>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-.5px', margin: 0 }}>cred2tech</h3>
            <p style={{ fontSize: '11px', color: '#94A3B8', margin: 0 }}>MSME Portal</p>
          </div>
        </div>
        
        {/* Navigation Tabs */}
        <nav style={{ flex: 1, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {navItems.map((item, idx) => {
            const isActive = location.pathname.includes(item.path) && item.path !== '#';
            return (
              <div 
                key={idx}
                onClick={() => { if (item.path !== '#') navigate(item.path); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', 
                  borderRadius: '8px', cursor: 'pointer',
                  background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: isActive ? '#fff' : '#94A3B8',
                  fontWeight: isActive ? '600' : '400',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => { if(!isActive) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; } }}
                onMouseLeave={(e) => { if(!isActive) { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.background = 'transparent'; } }}
              >
                <span style={{ fontSize: '16px' }}>{item.icon}</span>
                <span style={{ fontSize: '14px' }}>{item.label}</span>
              </div>
            )
          })}
        </nav>

        {/* Bottom Profile Area */}
        <div style={{ padding: '24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
           <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff', marginBottom: '4px' }}>{user?.name || 'User'}</div>
           <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '16px' }}>+91 {user?.mobile}</div>
           <button onClick={logout} style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: '13px', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
             ← Logout
           </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        
        {/* Top Header */}
        <header style={{ height: '70px', background: '#fff', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px' }}>
          <div>
            {/* Can put page title here if needed, keeping empty as per screenshot left-side header */}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span style={{ cursor: 'pointer', fontSize: '20px' }}>🔔</span>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%', background: '#10B981',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: '700', fontSize: '14px'
            }}>
              {user?.name?.charAt(0) || 'U'}
            </div>
          </div>
        </header>

        {/* Scrollable Page Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          <Outlet />
        </div>
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
