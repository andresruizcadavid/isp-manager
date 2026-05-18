import { api } from './client.js';
export const plansApi = {
  getAll:  ()         => api.get('/plans'),
  create:  (data)     => api.post('/plans', data),
  update:  (id, data) => api.put(`/plans/${id}`, data),
  remove:  (id)       => api.delete(`/plans/${id}`),
};
