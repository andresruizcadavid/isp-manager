import { api } from './client.js';

export const billingApi = {
  getMonths: (clientId, year) => {
    const q = year ? `?year=${year}` : '';
    return api.get(`/clients/${clientId}/billing-months${q}`);
  },

  generateInvoices: (clientId, months) => {
    return api.post(`/clients/${clientId}/generate-invoices`, { months });
  },

  bulkPayment: (data) => {
    return api.post('/payments/bulk-payment', data);
  },

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
