import { api, getRaw } from './client.js';
export const invoicesApi = {
  getAll:         (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/invoices${q ? '?' + q : ''}`);
  },
  // Returns the full envelope { data, meta } — use when you need pagination total.
  getPage:        (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return getRaw(`/invoices${q ? '?' + q : ''}`);
  },
  getOne:         (id)     => api.get(`/invoices/${id}`),
  create:         (data)   => api.post('/invoices', data),
  generateMonthly: ()      => api.post('/invoices/generate-monthly'),
  send:           (id, opts) => api.post(`/invoices/${id}/send`, { channels: opts.channels, sendPdf: opts.sendPdf ?? true, sendPaymentLink: opts.sendPaymentLink ?? false }),
  markPaid:       (id)      => api.post(`/invoices/${id}/mark-paid`),
};
