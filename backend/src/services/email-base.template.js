/**
 * Base HTML email template — shared by every email the system sends so they
 * all read as ONE brand: Internet Online. Table-based, inline-styled, no SVG /
 * flexbox / grid, for maximum compatibility with Gmail, Outlook, Apple Mail
 * and mobile clients. Visual tokens come from ../config/brand.js (lifted from
 * the live site internetonline.co).
 *
 * Usage:
 *   import { renderEmailTemplate } from './email-base.template.js';
 *   const html = renderEmailTemplate({
 *     icon: '💳',
 *     title: 'Tu factura está lista',
 *     body: 'Hola Juan,\n\nTu factura del mes...',
 *     fields: [{ label: 'Plan', value: 'Premium' }],
 *     cta: { text: 'Pagar ahora', url: 'https://...' },
 *   });
 */

import { BRAND } from '../config/brand.js';

const C = BRAND.colors;

// Suggested icon+title preset per email type — copy aligned with brand tone
// (cercano, claro, humano). Pages can override or extend.
export const EMAIL_PRESETS = {
  invoice:              { icon: '🧾', title: 'Tu factura ya está lista' },
  reminder:             { icon: '⏰', title: 'Recuerda pagar tu internet' },
  service_suspended:    { icon: '⛔', title: 'Tu servicio está suspendido' },
  service_activated:    { icon: '✅', title: '¡Tu internet está activo!' },
  payment_received:     { icon: '✅', title: '¡Recibimos tu pago!' },
  welcome:              { icon: '🎉', title: '¡Bienvenido a Internet Online!' },
  general_announcement: { icon: '📣', title: 'Tenemos un aviso para ti' },
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
// Turn any http(s) URL in the (already-escaped) text into a clickable,
// brand-colored link so payment links pasted in the body are tappable in
// every mail client — not just the ones that auto-linkify (the CTA button is
// separate and always rendered when a `cta` is provided).
function linkify(escaped) {
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target="_blank" style="color:${C.navy};font-weight:600;text-decoration:underline;word-break:break-all;">${url}</a>`
  );
}

function bodyToHtml(body) {
  if (!body) return '';
  const paragraphs = String(body).split(/\n{2,}/);
  return paragraphs
    .map(p => `<p style="margin:0 0 14px;color:${C.text};font-size:15px;line-height:1.65;">${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * @param {object}   opts
 * @param {string}   [opts.icon]          Emoji or single-char icon shown above the title.
 * @param {string}   opts.title           Title text.
 * @param {string}   opts.body            Plain-text body (newlines → <br>/paragraphs).
 * @param {Array}    [opts.fields]        Optional list of {label, value, link?} rows after the body.
 * @param {object}   [opts.cta]           Optional call-to-action button { text, url }.
 * @param {string}   [opts.companyName]   (legacy, optional) overrides footer brand name.
 * @param {string}   [opts.companyDomain] (legacy, optional) overrides footer domain.
 * @returns {string} Full HTML document ready for nodemailer's `html` field.
 */
export function renderEmailTemplate({
  icon = '📣',
  title,
  body,
  fields = [],
  cta,
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

  const name   = companyName || BRAND.name;
  const domain = companyDomain || BRAND.web;
  const year   = new Date().getFullYear();

  // Field rows rendered as a soft navy-tinted "summary" card.
  const fieldsHtml = safeFields.length === 0 ? '' : `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" width="100%"
           style="margin:22px 0 0;width:100%;border-collapse:separate;background:${C.navyLight};border:1px solid ${C.border};border-radius:12px;">
      ${safeFields.map((f, i) => `
        <tr>
          <td style="padding:11px 18px;${i ? `border-top:1px solid ${C.border};` : ''}color:${C.text};font-size:14px;line-height:1.5;">
            <span style="color:${C.textMuted};">${f.label}</span><br>
            <strong style="color:${C.navy};font-size:15px;">${
              f.link
                ? `<a href="${f.link}" style="color:${C.navy};text-decoration:none;">${f.value}</a>`
                : f.isEmail
                  ? `<a href="mailto:${f.value}" style="color:${C.navy};text-decoration:none;">${f.value}</a>`
                  : f.value
            }</strong>
          </td>
        </tr>
      `).join('')}
    </table>
  `;

  const ctaHtml = cta && cta.text && cta.url ? `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" align="center" style="margin:26px auto 6px;">
      <tr>
        <td align="center" bgcolor="${C.gold}" style="border-radius:10px;background:${C.gold};box-shadow:0 4px 12px rgba(253,185,19,0.35);">
          <a href="${escapeHtml(cta.url)}" target="_blank"
             style="display:inline-block;padding:15px 44px;font-size:16px;font-weight:800;color:${C.navyDeep};text-decoration:none;border-radius:10px;letter-spacing:0.01em;font-family:${BRAND.fontStack};">
            ${escapeHtml(cta.text)} &rarr;
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:4px 0 0;text-align:center;color:${C.textFaint};font-size:12px;">Pago 100% seguro</p>
  ` : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};font-family:${BRAND.fontStack};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safeTitle} · ${escapeHtml(BRAND.tagline)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;background:${C.surface};border-radius:18px;overflow:hidden;border:1px solid ${C.border};box-shadow:0 6px 28px rgba(15,37,92,0.10);">

          <!-- ░░ BRAND HEADER ░░ -->
          <tr>
            <td style="background:${C.navy};background:linear-gradient(135deg,${C.navyDeep} 0%,${C.navy} 60%,${C.navyHover} 100%);padding:34px 32px 30px;text-align:center;">
              <!-- "Internet" pill -->
              <span style="display:inline-block;background:${C.white};color:${C.navy};font-weight:700;font-style:italic;font-size:13px;line-height:1;padding:6px 16px;border-radius:999px;letter-spacing:0.3px;">Internet</span>
              <!-- "Online" wordmark -->
              <div style="font-size:40px;font-weight:800;color:${C.gold};letter-spacing:-1.5px;line-height:1;margin-top:8px;">Online</div>
              <!-- tagline -->
              <div style="font-size:13px;font-style:italic;color:#DCE5F7;margin-top:10px;letter-spacing:0.2px;">${escapeHtml(BRAND.tagline)}</div>
            </td>
          </tr>
          <!-- gold accent rule -->
          <tr><td style="height:4px;background:${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- ░░ TITLE ░░ -->
          <tr>
            <td style="padding:30px 32px 0;text-align:center;">
              <div style="font-size:42px;line-height:1;margin:0 0 10px;">${icon}</div>
              <h1 style="margin:0;color:${C.navy};font-size:23px;font-weight:800;letter-spacing:-0.01em;line-height:1.3;">
                ${safeTitle}
              </h1>
            </td>
          </tr>

          <!-- ░░ BODY ░░ -->
          <tr>
            <td style="padding:20px 32px 32px;color:${C.text};">
              ${bodyToHtml(body)}
              ${fieldsHtml}
              ${ctaHtml}
            </td>
          </tr>

          <!-- ░░ FOOTER ░░ -->
          <tr>
            <td style="padding:24px 32px 26px;background:${C.navyLight};border-top:1px solid ${C.border};text-align:center;">
              <p style="margin:0 0 10px;color:${C.navy};font-size:14px;font-weight:700;font-style:italic;">${escapeHtml(BRAND.tagline)}</p>
              <p style="margin:0 0 6px;color:${C.textMuted};font-size:13px;line-height:1.7;">
                <a href="mailto:${BRAND.email}" style="color:${C.navy};text-decoration:none;font-weight:600;">${BRAND.email}</a>
                &nbsp;·&nbsp;
                <a href="tel:+${BRAND.phoneRaw}" style="color:${C.navy};text-decoration:none;font-weight:600;">${BRAND.phone}</a>
              </p>
              <p style="margin:0 0 12px;color:${C.textMuted};font-size:13px;">
                <a href="${BRAND.webUrl}" style="color:${C.navy};text-decoration:none;font-weight:600;">${BRAND.web}</a>
              </p>
              <p style="margin:0 0 4px;color:${C.textFaint};font-size:12px;line-height:1.5;">
                Fibra óptica de alta calidad para tu hogar en ${escapeHtml(BRAND.areas)}.
              </p>
              <p style="margin:0;color:${C.textFaint};font-size:11px;">
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
