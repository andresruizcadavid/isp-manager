import { api } from './client.js';

export const whatsappApi = {
  get:    ()                                => api.get('/whatsapp'),
  // `data` may include templateMap: { PAYMENT_REMINDER, PAYMENT_CONFIRMATION,
  // SERVICE_SUSPENSION, SERVICE_ACTIVATION } → approved Meta template names.
  /** @param {any} data */
  save:   (data)                            => api.put('/whatsapp', data),
  /** @param {{ token: string, phoneId: string, recipient: string, templateName?: string, language?: string }} args */
  test:   ({ token, phoneId, recipient, templateName, language }) =>
            api.post('/whatsapp/test', { token, phoneId, recipient, templateName, language })
};
