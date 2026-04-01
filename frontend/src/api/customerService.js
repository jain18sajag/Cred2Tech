import axiosInstance from './axiosInstance';

export const customerService = {
  checkExistingByPan: async (pan) => {
    try {
      const response = await axiosInstance.get(`/customers/check-existing-by-pan?pan=${pan}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  },

  createOrAttach: async (data) => {
    const response = await axiosInstance.post('/customers/create-or-attach', data);
    return response.data;
  }
};
