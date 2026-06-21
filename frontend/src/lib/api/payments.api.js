import { api } from './client.js';

export const paymentsApi = {
  /** @param {string} invoiceId */
  getWompiCheckout: (invoiceId) => api.get(`/payments/wompi/checkout/${invoiceId}`),
};
