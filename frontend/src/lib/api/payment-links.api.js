import { api } from './client.js';

export const paymentLinksApi = {
  getAll: (params) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.q) q.set('q', params.q);
    if (params.clientId) q.set('clientId', params.clientId);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);
    q.set('page', String(params.page || 1));
    q.set('limit', String(params.limit || 50));
    return api.get(`/payment-links?${q}`);
  },

  getOne: (id) => api.get(`/payment-links/${id}`),

  resend: (id) => api.post(`/payment-links/${id}/resend`),

  getAttempts: (params) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.q) q.set('q', params.q);
    if (params.clientId) q.set('clientId', params.clientId);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);
    q.set('page', String(params.page || 1));
    q.set('limit', String(params.limit || 50));
    return api.get(`/payment-links/attempts?${q}`);
  },

  getAttempt: (id) => api.get(`/payment-links/attempts/${id}`),

  getConciliation: () => api.get('/payment-links/conciliation')
};
