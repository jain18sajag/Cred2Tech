import api from './axiosInstance';

// ─── DSA Dashboard API ────────────────────────────────────────────────────────
export const getDsaSummary        = async (period, opts = {}) => {
  const res = await api.get('/dashboard/dsa/summary', { params: { period, ...opts } });
  return res.data;
};

export const getDsaWallet         = async () => {
  const res = await api.get('/dashboard/dsa/wallet');
  return res.data;
};

export const getDsaRecentCases    = async (period, opts = {}) => {
  const res = await api.get('/dashboard/dsa/cases', { params: { period, ...opts } });
  return res.data;
};

export const getDsaStageSummary   = async (period, opts = {}) => {
  const res = await api.get('/dashboard/dsa/stage-summary', { params: { period, ...opts } });
  return res.data;
};

// ─── Platform Dashboard API ───────────────────────────────────────────────────
export const getPlatformSummary   = async (period, opts = {}) => {
  const res = await api.get('/dashboard/platform/summary', { params: { period, ...opts } });
  return res.data;
};

export const getPlatformApiUsage  = async (period, opts = {}) => {
  const res = await api.get('/dashboard/platform/api-usage', { params: { period, ...opts } });
  return res.data;
};

export const getPlatformFunnel    = async (period, opts = {}) => {
  const res = await api.get('/dashboard/platform/funnel', { params: { period, ...opts } });
  return res.data;
};

export const getTopDsas           = async (period, opts = {}) => {
  const res = await api.get('/dashboard/platform/top-dsas', { params: { period, ...opts } });
  return res.data;
};

export const getTopLenders        = async (period, opts = {}) => {
  const res = await api.get('/dashboard/platform/top-lenders', { params: { period, ...opts } });
  return res.data;
};
