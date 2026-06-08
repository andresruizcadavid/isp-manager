import { api } from './client.js';

export const paymentsApi = {
  getWompiCheckout: (invoiceId) => api.get(`/payments/wompi/checkout/${invoiceId}`),
};
