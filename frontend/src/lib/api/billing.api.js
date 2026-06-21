import { api } from './client.js';

/**
 * @typedef {import('$lib/types').Invoice} Invoice
 */

export const billingApi = {
  /** @param {string} clientId @param {number} [year] */
  getMonths: (clientId, year) => {
    const q = year ? `?year=${year}` : '';
    return api.get(`/clients/${clientId}/billing-months${q}`);
  },

  /** @param {string} clientId @param {Array<{ year: number, month: number }>} months */
  generateInvoices: (clientId, months) => {
    return api.post(`/clients/${clientId}/generate-invoices`, { months });
  },

  /** @param {{ invoiceIds: string[], amount: number, paymentMethod: string, notes?: string, paymentDate?: string }} data */
  bulkPayment: (data) => {
    return api.post('/payments/bulk-payment', data);
  },

  /** @param {string} paymentId @param {File} file @param {string} [description] @returns {Promise<Response>} */
  uploadEvidence: (paymentId, file, description) => {
    const formData = new FormData();
    formData.append('file', file);
    if (description) formData.append('description', description);
    return fetch(`/api/v1/payments/${paymentId}/evidence`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
  }
};
