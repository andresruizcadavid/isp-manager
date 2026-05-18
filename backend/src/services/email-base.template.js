/**
 * Base HTML email template — shared by every email the system sends so they
 * all have a consistent, professional look. Table-based for max compatibility
 * with Gmail, Outlook, Apple Mail and mobile clients (no flexbox/grid).
 *
 * Usage:
 *   import { renderEmailTemplate } from './email-base.template.js';
 *   const html = renderEmailTemplate({
 *     icon: '💳',
 *     title: 'Tu factura está lista',
 *     body: 'Hola Juan,\n\nTu factura del mes...',
 *     fields: [{ label: 'Plan', value: 'Premium' }],
 *     companyName: 'Internet Online',
 *     companyDomain: 'internetonline.co',
 *   });
 */

import { env } from '../config/env.js';

// Suggested icon+title preset per email type. Pages can override or extend.
export const EMAIL_PRESETS = {
  invoice:              { icon: '💳', title: 'Tu factura está lista' },
  reminder:             { icon: '⏰', title: 'Recuerda pagar antes de vencer' },
  service_suspended:    { icon: '⛔', title: 'Tu servicio ha sido suspendido' },
  service_activated:    { icon: '✅', title: 'Tu servicio está activo' },
  payment_received:     { icon: '✅', title: 'Pago registrado correctamente' },
  welcome:              { icon: '🎉', title: 'Bienvenido' },
  general_announcement: { icon: '📣', title: 'Aviso importante' },
  smtp_test:            { icon: '✅', title: 'Configuración SMTP exitosa' }
};

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert plain-text (with \n line breaks) into paragraph + <br> HTML so the
// operator-authored template body still reads naturally inside the card.
function bodyToHtml(body) {
  if (!body) return '';
  const paragraphs = String(body).split(/\n{2,}/);
  return paragraphs
    .map(p => `<p style="margin:0 0 14px;color:#475569;font-size:15px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * @param {object}   opts
 * @param {string}   [opts.icon]          Emoji or single-char icon shown in the header.
 * @param {string}   opts.title           Title text shown under the icon.
 * @param {string}   opts.body            Plain-text body (newlines turned into <br>/paragraphs).
 * @param {Array}    [opts.fields]        Optional list of {label, value, link?} bullets after the body.
 * @param {string}   [opts.companyName]   Footer company name (defaults to env.COMPANY_NAME).
 * @param {string}   [opts.companyDomain] Footer domain (defaults to internetonline.co fallback).
 * @returns {string} Full HTML document ready for nodemailer's `html` field.
 */
export function renderEmailTemplate({
  icon = '📣',
  title,
  body,
  fields = [],
  companyName,
  companyDomain
}) {
  const safeTitle  = escapeHtml(title || 'Aviso');
  const safeFields = (Array.isArray(fields) ? fields : []).map(f => ({
    label: escapeHtml(f?.label ?? ''),
    value: escapeHtml(f?.value ?? ''),
    link:  f?.link ? String(f.link) : null,
    isEmail: typeof f?.value === 'string' && /^[^\s@]+@[^\s@]+$/.test(f.value)
  }));

  const name   = companyName   || env.COMPANY_NAME   || 'ISP Manager';
  const domain = companyDomain || env.COMPANY_EMAIL?.split('@')[1] || 'internetonline.co';
  const year   = new Date().getFullYear();

  const fieldsHtml = safeFields.length === 0 ? '' : `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;width:100%;border-collapse:collapse;">
      ${safeFields.map(f => `
        <tr>
          <td style="padding:6px 0;color:#1e293b;font-size:14px;">
            <strong style="color:#0f172a;">${f.label}:</strong>
            ${
              f.link
                ? `<a href="${f.link}" style="color:#2C4EC7;text-decoration:none;">${f.value}</a>`
                : f.isEmail
                  ? `<a href="mailto:${f.value}" style="color:#2C4EC7;text-decoration:none;">${f.value}</a>`
                  : `<span>${f.value}</span>`
            }
          </td>
        </tr>
      `).join('')}
    </table>
  `;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">

          <!-- HEADER (gradient blue + icon + title) -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a8a,#3b82f6);padding:40px 32px;text-align:center;">
              <div style="font-size:48px;line-height:1;margin:0 0 12px;">${icon}</div>
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.01em;line-height:1.3;">
                ${safeTitle}
              </h1>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:32px;color:#0f172a;">
              ${bodyToHtml(body)}
              ${fieldsHtml}
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">
                © ${year} ${escapeHtml(name)} · ${escapeHtml(domain)}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
