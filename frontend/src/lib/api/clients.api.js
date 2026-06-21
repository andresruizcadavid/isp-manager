import { api, getRaw } from './client.js';

/**
 * @typedef {import('$lib/types').Client} Client
 * @typedef {import('$lib/types').PageMeta} PageMeta
 */

export const clientsApi = {
  /** @param {Record<string, any>} [params] @returns {Promise<Client[]>} */
  getAll:   (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/clients${q ? '?' + q : ''}`);
  },
  /** @param {Record<string, any>} [params] @returns {Promise<{ data: Client[], meta: PageMeta }>} */
  getPage:  (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return getRaw(`/clients${q ? '?' + q : ''}`);
  },
  /** @param {string} id @returns {Promise<Client>} */
  getOne:   (id)       => api.get(`/clients/${id}`),
  /** @param {any} data @returns {Promise<Client>} */
  create:   (data)     => api.post('/clients', data),
  /** @param {string} id @param {any} data @returns {Promise<Client>} */
  update:   (id, data) => api.put(`/clients/${id}`, data),
  /** @param {string} id */
  remove:   (id)       => api.delete(`/clients/${id}`),
  /** @param {string} id */
  suspend:  (id)       => api.post(`/clients/${id}/suspend`),
  /** @param {string} id */
  activate: (id)       => api.post(`/clients/${id}/activate`),
  nextPppoeNumber: ()  => api.get('/clients/next-pppoe-number'),
  /** @param {string} id */
  notifications: (id)  => api.get(`/clients/${id}/notifications`),
  /** @param {string} id @param {any} data */
  notify:   (id, data) => api.post(`/clients/${id}/notify`, data),
};
