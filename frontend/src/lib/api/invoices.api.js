import { api, getRaw } from './client.js';

/**
 * @typedef {import('$lib/types').Invoice} Invoice
 * @typedef {import('$lib/types').PageMeta} PageMeta
 */

export const invoicesApi = {
  /** @param {Record<string, any>} [params] @returns {Promise<Invoice[]>} */
  getAll:         (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/invoices${q ? '?' + q : ''}`);
  },
  // Returns the full envelope { data, meta } — use when you need pagination total.
  /** @param {Record<string, any>} [params] @returns {Promise<{ data: Invoice[], meta: PageMeta }>} */
  getPage:        (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return getRaw(`/invoices${q ? '?' + q : ''}`);
  },
  /** @param {string} id @returns {Promise<Invoice>} */
  getOne:         (id)     => api.get(`/invoices/${id}`),
  /** @param {any} data @returns {Promise<Invoice>} */
  create:         (data)   => api.post('/invoices', data),
  /** @param {string} id @param {any} data @returns {Promise<Invoice>} */
  update:         (id, data) => api.put(`/invoices/${id}`, data),
  /** @param {string} id */
  remove:         (id)     => api.delete(`/invoices/${id}`),
  generateMonthly: ()      => api.post('/invoices/generate-monthly'),
  /** @param {string} id @param {{ channels?: string[], sendPdf?: boolean, sendPaymentLink?: boolean }} opts */
  send:           (id, opts) => api.post(`/invoices/${id}/send`, { channels: opts.channels, sendPdf: opts.sendPdf ?? true, sendPaymentLink: opts.sendPaymentLink ?? false }),
  /** Generate a Wompi payment link only (no send). Returns { checkoutUrl, id }. @param {string} id */
  paymentLink:    (id)      => api.post(`/invoices/${id}/payment-link`, {}),
  /** Enviar recordatorio de pago de una factura (email/WhatsApp según config). @param {string} id */
  sendReminder:   (id)      => api.post(`/invoices/${id}/send-reminder`, {}),
  /** @param {string} id */
  markPaid:       (id)      => api.post(`/invoices/${id}/mark-paid`),
};
