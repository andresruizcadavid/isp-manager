import { api } from './client.js';
export const zonesApi = {
  getAll:        ()         => api.get('/zones'),
  getWithRouter: ()         => api.get('/zones?withRouter=true'),
  create:        (data)     => api.post('/zones', data),
  update:        (id, data) => api.put(`/zones/${id}`, data),
  remove:        (id)       => api.delete(`/zones/${id}`),
};
