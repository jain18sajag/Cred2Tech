import api from './axiosInstance';

export const getTenants = async () => {
  const response = await api.get('/tenants');
  return response.data;
};

export const createTenant = async (tenantData) => {
  const response = await api.post('/tenants', tenantData);
  return response.data;
};

export const updateTenantStatus = async (id, status) => {
  const response = await api.patch(`/tenants/${id}/status`, { status });
  return response.data;
};
