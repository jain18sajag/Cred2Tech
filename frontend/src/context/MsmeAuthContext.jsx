import React, { createContext, useState, useContext, useEffect } from 'react';
import { msmeAuthApi, msmeApi } from '../api/directMsme';
import { useNavigate } from 'react-router-dom';

const MsmeAuthContext = createContext(null);

export const MsmeAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token');
      // Simple check to ensure we don't accidentally log in a DSA user here.
      const isMsme = localStorage.getItem('roleName') === 'MSME_CUSTOMER';
      
      if (token && isMsme) {
        try {
          const res = await msmeApi.getDashboard();
          setUser(res.data.user);
        } catch (err) {
          console.error('Failed to restore MSME session:', err);
          logout();
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  const login = (userData, token) => {
    localStorage.setItem('token', token);
    localStorage.setItem('roleName', 'MSME_CUSTOMER');
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('roleName');
    setUser(null);
    navigate('/msme/login');
  };

  return (
    <MsmeAuthContext.Provider value={{ user, loading, login, logout }}>
      {!loading && children}
    </MsmeAuthContext.Provider>
  );
};

export const useMsmeAuth = () => useContext(MsmeAuthContext);
