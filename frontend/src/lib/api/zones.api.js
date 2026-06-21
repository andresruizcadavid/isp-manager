import { api } from './client.js';

/** @typedef {import('$lib/types').Zone} Zone */

export const zonesApi = {
  /** @returns {Promise<Zone[]>} */
  getAll:        ()         => api.get('/zones'),
  /** @returns {Promise<Zone[]>} */
  getWithRouter: ()         => api.get('/zones?withRouter=true'),
  /** @param {any} data @returns {Promise<Zone>} */
  create:        (data)     => api.post('/zones', data),
  /** @param {number} id @param {any} data @returns {Promise<Zone>} */
  update:        (id, data) => api.put(`/zones/${id}`, data),
  /** @param {number} id */
  remove:        (id)       => api.delete(`/zones/${id}`),
};
