import { api } from './client.js';

export const notificationsApi = {
  // Templates
  listTemplates:   ()         => api.get('/notifications/templates'),
  createTemplate:  (data)     => api.post('/notifications/templates', data),
  updateTemplate:  (id, data) => api.put(`/notifications/templates/${id}`, data),
  removeTemplate:  (id)       => api.delete(`/notifications/templates/${id}`),
  previewTemplate: (data)     => api.post('/notifications/templates/preview', data),

  // Campaigns
  listCampaigns:   ()         => api.get('/notifications/campaigns'),
  getCampaign:     (id)       => api.get(`/notifications/campaigns/${id}`),
  diagnoseCampaign:(id)       => api.get(`/notifications/campaigns/${id}/diagnose`),
  previewAudience: (audience) => api.post('/notifications/campaigns/preview-audience', audience),
  previewClients:  (audience) => api.post('/notifications/campaigns/preview-clients',  audience),
  createCampaign:  (data)     => api.post('/notifications/campaigns', data),
  updateCampaign:  (id, data) => api.put(`/notifications/campaigns/${id}`, data),
  launchCampaign:  (id)       => api.post(`/notifications/campaigns/${id}/launch`),
  testCampaign:    (data)     => api.post('/notifications/campaigns/test', data),
  retryCampaign:   (id)       => api.post(`/notifications/campaigns/${id}/retry`),
  removeCampaign:  (id)       => api.delete(`/notifications/campaigns/${id}`),

  // History
  listHistory:     (params)   => {
    const q = new URLSearchParams(params || {}).toString();
    return api.get(`/notifications/history${q ? '?' + q : ''}`);
  },
  removeHistory:   (id)       => api.delete(`/notifications/history/${id}`),
  clearHistory:    (params)   => {
    const q = new URLSearchParams(params || {}).toString();
    return api.delete(`/notifications/history${q ? '?' + q : ''}`);
  }
};
