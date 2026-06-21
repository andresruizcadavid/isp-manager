import { api } from './client.js';

/**
 * @typedef {import('$lib/types').NotificationTemplate} NotificationTemplate
 * @typedef {import('$lib/types').NotificationCampaign} NotificationCampaign
 * @typedef {import('$lib/types').NotificationSetting} NotificationSetting
 */

export const notificationsApi = {
  // Templates
  /** @returns {Promise<NotificationTemplate[]>} */
  listTemplates:   ()         => api.get('/notifications/templates'),
  /** @param {any} data @returns {Promise<NotificationTemplate>} */
  createTemplate:  (data)     => api.post('/notifications/templates', data),
  /** @param {string} id @param {any} data @returns {Promise<NotificationTemplate>} */
  updateTemplate:  (id, data) => api.put(`/notifications/templates/${id}`, data),
  /** @param {string} id */
  removeTemplate:  (id)       => api.delete(`/notifications/templates/${id}`),
  /** @param {any} data */
  previewTemplate: (data)     => api.post('/notifications/templates/preview', data),

  // Campaigns
  /** @returns {Promise<NotificationCampaign[]>} */
  listCampaigns:   ()         => api.get('/notifications/campaigns'),
  /** @param {string} id @returns {Promise<NotificationCampaign>} */
  getCampaign:     (id)       => api.get(`/notifications/campaigns/${id}`),
  /** @param {string} id */
  diagnoseCampaign:(id)       => api.get(`/notifications/campaigns/${id}/diagnose`),
  /** @param {any} audience */
  previewAudience: (audience) => api.post('/notifications/campaigns/preview-audience', audience),
  /** @param {any} audience */
  previewClients:  (audience) => api.post('/notifications/campaigns/preview-clients',  audience),
  /** @param {any} data @returns {Promise<NotificationCampaign>} */
  createCampaign:  (data)     => api.post('/notifications/campaigns', data),
  /** @param {string} id @param {any} data @returns {Promise<NotificationCampaign>} */
  updateCampaign:  (id, data) => api.put(`/notifications/campaigns/${id}`, data),
  /** @param {string} id */
  launchCampaign:  (id)       => api.post(`/notifications/campaigns/${id}/launch`),
  /** @param {any} data */
  testCampaign:    (data)     => api.post('/notifications/campaigns/test', data),
  /** @param {string} id */
  retryCampaign:   (id)       => api.post(`/notifications/campaigns/${id}/retry`),
  /** @param {string} id */
  removeCampaign:  (id)       => api.delete(`/notifications/campaigns/${id}`),

  // Settings (periodicidad / on-off de notificaciones a clientes)
  /** @returns {Promise<NotificationSetting[]>} */
  listSettings:    ()           => api.get('/notifications/settings'),
  /** @param {string} type @param {any} data */
  updateSetting:   (type, data) => api.put(`/notifications/settings/${type}`, data),

  // History
  /** @param {Record<string, any>} [params] */
  listHistory:     (params)   => {
    const q = new URLSearchParams(params || {}).toString();
    return api.get(`/notifications/history${q ? '?' + q : ''}`);
  },
  /** @param {string} id */
  removeHistory:   (id)       => api.delete(`/notifications/history/${id}`),
  /** @param {Record<string, any>} [params] */
  clearHistory:    (params)   => {
    const q = new URLSearchParams(params || {}).toString();
    return api.delete(`/notifications/history${q ? '?' + q : ''}`);
  }
};
