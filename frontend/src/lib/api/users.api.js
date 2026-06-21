import { api } from './client.js';

/** @typedef {import('$lib/types').User} User */

export const usersApi = {
  /** @returns {Promise<User[]>} */
  list:   ()         => api.get('/users'),
  /** @param {any} data @returns {Promise<User>} */
  create: (data)     => api.post('/users', data),
  /** @param {string} id @param {any} data @returns {Promise<User>} */
  update: (id, data) => api.put(`/users/${id}`, data),
  /** @param {string} id */
  remove: (id)       => api.delete(`/users/${id}`),
};
