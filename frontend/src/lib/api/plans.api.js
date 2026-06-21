import { api } from './client.js';

/** @typedef {import('$lib/types').Plan} Plan */

export const plansApi = {
  /** @returns {Promise<Plan[]>} */
  getAll:  ()         => api.get('/plans'),
  /** @param {any} data @returns {Promise<Plan>} */
  create:  (data)     => api.post('/plans', data),
  /** @param {string} id @param {any} data @returns {Promise<Plan>} */
  update:  (id, data) => api.put(`/plans/${id}`, data),
  /** @param {string} id */
  remove:  (id)       => api.delete(`/plans/${id}`),
};
