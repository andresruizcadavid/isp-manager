import { api, getRaw } from './client.js';
export const clientsApi = {
  getAll:   (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/clients${q ? '?' + q : ''}`);
  },
  getPage:  (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return getRaw(`/clients${q ? '?' + q : ''}`);
  },
  getOne:   (id)       => api.get(`/clients/${id}`),
  create:   (data)     => api.post('/clients', data),
  update:   (id, data) => api.put(`/clients/${id}`, data),
  remove:   (id)       => api.delete(`/clients/${id}`),
  suspend:  (id)       => api.post(`/clients/${id}/suspend`),
  activate: (id)       => api.post(`/clients/${id}/activate`),
  nextPppoeNumber: ()  => api.get('/clients/next-pppoe-number'),
  notifications: (id)  => api.get(`/clients/${id}/notifications`),
  notify:   (id, data) => api.post(`/clients/${id}/notify`, data),
};
