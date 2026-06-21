import { api } from './client.js';

/**
 * @typedef {import('$lib/types').NetworkDevice} NetworkDevice
 * @typedef {import('$lib/types').NetworkConnection} NetworkConnection
 */

export const networkApi = {
  // Devices
  /** @returns {Promise<NetworkDevice[]>} */
  listDevices:    ()                => api.get('/network/devices'),
  /** @param {string} id @returns {Promise<NetworkDevice>} */
  getDevice:      (id)              => api.get(`/network/devices/${id}`),
  /** @param {any} data @returns {Promise<NetworkDevice>} */
  createDevice:   (data)            => api.post('/network/devices', data),
  /** @param {string} id @param {any} data @returns {Promise<NetworkDevice>} */
  updateDevice:   (id, data)        => api.put(`/network/devices/${id}`, data),
  /** @param {string} id @param {number} posX @param {number} posY */
  updatePosition: (id, posX, posY)  => api.patch(`/network/devices/${id}/position`, { posX, posY }),
  /** @param {string} id */
  removeDevice:   (id)              => api.delete(`/network/devices/${id}`),

  // Connections
  /** @returns {Promise<NetworkConnection[]>} */
  listConnections:  ()              => api.get('/network/connections'),
  /** @param {string} sourceId @param {string} targetId @param {string} [label] */
  createConnection: (sourceId, targetId, label) =>
                                       api.post('/network/connections', { sourceId, targetId, label }),
  /** @param {string} id */
  removeConnection: (id)            => api.delete(`/network/connections/${id}`),

  // Probe (manual sweep)
  probeNow:       ()                => api.post('/network/probe', {}),

  // Shared map viewports (pan+zoom per tab)
  listViews:      ()                => api.get('/network/views'),
  /** @param {string} key @param {number} posX @param {number} posY @param {number} zoom */
  saveView:       (key, posX, posY, zoom) => api.put(`/network/views/${key}`, { posX, posY, zoom }),

  // Events / history
  /** @param {Record<string, any>} [params] */
  listEvents:     (params)          => {
    const q = new URLSearchParams(params || {}).toString();
    return api.get(`/network/events${q ? '?' + q : ''}`);
  },
  /** @param {Record<string, any>} [params] */
  csvUrl:         (params)          => {
    const q = new URLSearchParams(params || {}).toString();
    return `/api/v1/network/events.csv${q ? '?' + q : ''}`;
  }
};

export const telegramApi = {
  get:    ()           => api.get('/telegram'),
  /** @param {any} data */
  save:   (data)       => api.put('/telegram', data),
  /** @param {string} botToken @param {string} chatId */
  test:   (botToken, chatId) => api.post('/telegram/test', { botToken, chatId })
};
