import { api } from './client.js';

export const networkApi = {
  // Devices
  listDevices:    ()                => api.get('/network/devices'),
  getDevice:      (id)              => api.get(`/network/devices/${id}`),
  createDevice:   (data)            => api.post('/network/devices', data),
  updateDevice:   (id, data)        => api.put(`/network/devices/${id}`, data),
  updatePosition: (id, posX, posY)  => api.patch(`/network/devices/${id}/position`, { posX, posY }),
  removeDevice:   (id)              => api.delete(`/network/devices/${id}`),

  // Connections
  listConnections:  ()              => api.get('/network/connections'),
  createConnection: (sourceId, targetId, label) =>
                                       api.post('/network/connections', { sourceId, targetId, label }),
  removeConnection: (id)            => api.delete(`/network/connections/${id}`),

  // Probe (manual sweep)
  probeNow:       ()                => api.post('/network/probe', {}),

  // Events / history
  listEvents:     (params)          => {
    const q = new URLSearchParams(params || {}).toString();
    return api.get(`/network/events${q ? '?' + q : ''}`);
  },
  csvUrl:         (params)          => {
    const q = new URLSearchParams(params || {}).toString();
    return `/api/v1/network/events.csv${q ? '?' + q : ''}`;
  }
};

export const telegramApi = {
  get:    ()           => api.get('/telegram'),
  save:   (data)       => api.put('/telegram', data),
  test:   (botToken, chatId) => api.post('/telegram/test', { botToken, chatId })
};
