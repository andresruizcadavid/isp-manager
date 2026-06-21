import { api } from './client.js';

export const wompiApi = {
  get:    ()              => api.get('/wompi-config'),
  /** @param {any} data */
  create: (data)          => api.post('/wompi-config', data),
  /** @param {string} id @param {any} data */
  update: (id, data)      => api.put(`/wompi-config/${id}`, data),
  /** @param {any} data */
  test:   (data)          => api.post('/wompi-config/test', data),
};
