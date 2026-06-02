import { api } from './client.js';
export const paymentsApi = {
  getAll:  (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/payments${q ? '?' + q : ''}`);
  },
  create:  (data) => api.post('/payments', data),
  getStats: () => api.get('/payments/stats/overview'),
};
