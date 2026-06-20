import { api } from './client.js';

export const wompiApi = {
  get:    ()              => api.get('/wompi-config'),
  create: (data)          => api.post('/wompi-config', data),
  update: (id, data)      => api.put(`/wompi-config/${id}`, data),
  test:   (data)          => api.post('/wompi-config/test', data),
};
