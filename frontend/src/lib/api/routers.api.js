import { api } from './client.js';

/** @typedef {import('$lib/types').Router} Router */

export const routersApi = {
  /** @returns {Promise<Router[]>} */
  getAll:        ()         => api.get('/mikrotik/routers'),
  /** @param {number} id @returns {Promise<Router>} */
  getOne:        (id)       => api.get(`/mikrotik/routers/${id}`),
  /** @param {any} data @returns {Promise<Router>} */
  create:        (data)     => api.post('/mikrotik/routers', data),
  /** @param {number} id @param {any} data @returns {Promise<Router>} */
  update:        (id, data) => api.put(`/mikrotik/routers/${id}`, data),
  /** @param {number} id */
  remove:        (id)       => api.delete(`/mikrotik/routers/${id}`),
  /** @param {number} id */
  sync:          (id)       => api.post(`/mikrotik/routers/${id}/sync`),
  /** @param {number} id */
  testConn:      (id)       => api.post(`/mikrotik/routers/${id}/test`),
  /** @param {number} id */
  testRoutes:    (id)       => api.post(`/mikrotik/routers/${id}/test-routes`),
  /** @param {any} creds */
  testCredentials: (creds)  => api.post('/mikrotik/routers/test', creds),
  /** @param {number} id */
  availableIps:  (id)       => api.get(`/mikrotik/routers/${id}/available-ips`),
  /** @param {number} id @param {string} username */
  pppSecretLookup: (id, username) => api.get(`/mikrotik/routers/${id}/ppp-secret-lookup?username=${encodeURIComponent(username)}`),
  /** @param {number} id */
  pppoeProfiles:        (id)       => api.get(`/mikrotik/routers/${id}/profiles`),
  /** @param {number} id */
  pppProfiles:          (id)       => api.get(`/mikrotik/routers/${id}/ppp-profiles`),
  /** @param {number} id */
  orphanPppProfiles:    (id)       => api.get(`/mikrotik/routers/${id}/ppp-profiles/orphans`),
  /** @param {number} id @param {any} data */
  createPppProfile:     (id, data) => api.post(`/mikrotik/routers/${id}/ppp-profiles`, data),
  /** @param {number} id @param {string} name */
  deletePppProfile:     (id, name) => api.delete(`/mikrotik/routers/${id}/ppp-profiles/${encodeURIComponent(name)}`),
  /** @param {number} id */
  importPppoeClients:   (id)       => api.post(`/mikrotik/routers/${id}/import-pppoe-clients`),
  /** @param {number} id */
  preview:       (id)       => api.get(`/mikrotik/routers/${id}/pppoe-preview`),
  /** @param {number} id @param {any} data */
  import:        (id, data) => api.post(`/mikrotik/routers/${id}/import`, data),
};
