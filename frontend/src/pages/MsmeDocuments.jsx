import React from 'react';
import { useNavigate } from 'react-router-dom';

const MsmeDocuments = () => {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '32px', textAlign: 'center', marginTop: '100px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1E293B', marginBottom: '16px' }}>My Documents</h2>
      <p style={{ color: '#64748B', marginBottom: '24px' }}>A centralized vault for all your uploaded financial documents will be available here soon.</p>
      <button 
        onClick={() => navigate('/msme/dashboard')}
        style={{
          background: '#8b5cf6', color: '#fff', border: 'none', padding: '10px 24px', 
          borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'
        }}
      >
        Return to Dashboard
      </button>
    </div>
  );
};

export default MsmeDocuments;
