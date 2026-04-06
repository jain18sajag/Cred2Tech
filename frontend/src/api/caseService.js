import axiosInstance from './axiosInstance';

export const caseService = {
  getAllCases: async () => {
    const response = await axiosInstance.get('/cases');
    return response.data;
  },

  getCaseById: async (id) => {
    const response = await axiosInstance.get(`/cases/${id}`);
    return response.data;
  },

  createCase: async (customer_id) => {
    const response = await axiosInstance.post('/cases/create', { customer_id });
    return response.data;
  },

  addApplicant: async (caseId, applicantData) => {
    const response = await axiosInstance.post(`/cases/${caseId}/add-applicant`, applicantData);
    return response.data;
  },

  updateProduct: async (caseId, product_type) => {
    const response = await axiosInstance.patch(`/cases/${caseId}/product`, { product_type });
    return response.data;
  },

  getCaseSummary: async (caseId) => {
    const response = await axiosInstance.get(`/cases/${caseId}/summary`);
    return response.data;
  },

  getCoBorrowers: async (caseId) => {
    const response = await axiosInstance.get(`/cases/${caseId}/co-borrowers`);
    return response.data;
  },

  getActivityLog: async (caseId) => {
    const response = await axiosInstance.get(`/cases/${caseId}/activity-log`);
    return response.data;
  }
};
