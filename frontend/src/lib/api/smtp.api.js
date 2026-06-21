import { api } from './client.js';

export const smtpApi = {
  get:    ()         => api.get('/smtp'),
  /** @param {any} data */
  create: (data)     => api.post('/smtp', data),
  /** @param {string} id @param {any} data */
  update: (id, data) => api.put(`/smtp/${id}`, data),
  /** @param {any} data */
  test:   (data)     => api.post('/smtp/test', data),
};

// Same presets used in the original hotspot-system module.
// NOTE: HostGator (and any cPanel-based hosting) gives each customer their
// OWN mail.<their-domain> server — there's no shared "mail.hostgator.com".
// We leave host blank so the operator types their real server, and only
// preset the port + SSL flag that cPanel recommends.
export const SMTP_PRESETS = [
  { name: 'HostGator (cPanel)',host: '',                                   port: 465, secure: true  },
  { name: 'Gmail',             host: 'smtp.gmail.com',                     port: 587, secure: false },
  { name: 'Outlook/Office 365',host: 'smtp.office365.com',                 port: 587, secure: false },
  { name: 'Yahoo',             host: 'smtp.mail.yahoo.com',                port: 587, secure: false },
  { name: 'Zoho',              host: 'smtp.zoho.com',                      port: 587, secure: false },
  { name: 'SendGrid',          host: 'smtp.sendgrid.net',                  port: 587, secure: false },
  { name: 'Mailgun',           host: 'smtp.mailgun.org',                   port: 587, secure: false },
  { name: 'Amazon SES',        host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false },
  { name: 'Personalizado',     host: '',                                   port: 587, secure: false }
];
