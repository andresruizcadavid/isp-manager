import { api } from './client.js';

export const whatsappApi = {
  get:    ()                                => api.get('/whatsapp'),
  // `data` may include templateMap: { PAYMENT_REMINDER, PAYMENT_CONFIRMATION,
  // SERVICE_SUSPENSION, SERVICE_ACTIVATION } → approved Meta template names.
  save:   (data)                            => api.put('/whatsapp', data),
  test:   ({ token, phoneId, recipient, templateName, language }) =>
            api.post('/whatsapp/test', { token, phoneId, recipient, templateName, language })
};
