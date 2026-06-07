import axiosInstance from './axiosInstance';

export const getWalletSummary = async () => {
  const response = await axiosInstance.get('/wallet/summary');
  return response.data;
};

export const getWalletTransactions = async () => {
  const response = await axiosInstance.get('/wallet/transactions');
  return response.data;
};

export const getTopups = async () => {
  const response = await axiosInstance.get('/wallet/topups');
  return response.data;
};

export const createOrder = async (amountInr) => {
  const response = await axiosInstance.post('/wallet/topups/create-order', { amount_inr: amountInr });
  return response.data;
};

export const verifyCheckout = async (payload) => {
  const response = await axiosInstance.post('/wallet/topups/verify-checkout', payload);
  return response.data;
};

export const getEmployees = async () => {
  const response = await axiosInstance.get('/wallet/employees');
  return response.data;
};

export const allocateEmployeeCredits = async (userId, credits, note) => {
  const response = await axiosInstance.post(`/wallet/employees/${userId}/allocate`, { credits, note });
  return response.data;
};

export const revokeEmployeeCredits = async (userId, credits, note) => {
  const response = await axiosInstance.post(`/wallet/employees/${userId}/revoke`, { credits, note });
  return response.data;
};

export const getEmployeeTransactions = async (userId) => {
  const response = await axiosInstance.get(`/wallet/employees/${userId}/transactions`);
  return response.data;
};

export const cancelTopup = async (topupId) => {
  const response = await axiosInstance.post(`/wallet/topups/${topupId}/cancel`);
  return response.data;
};
