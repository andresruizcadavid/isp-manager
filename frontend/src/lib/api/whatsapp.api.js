import { api } from './client.js';

export const whatsappApi = {
  get:    ()                                => api.get('/whatsapp'),
  save:   (data)                            => api.put('/whatsapp', data),
  test:   ({ token, phoneId, recipient, templateName, language }) =>
            api.post('/whatsapp/test', { token, phoneId, recipient, templateName, language })
};
