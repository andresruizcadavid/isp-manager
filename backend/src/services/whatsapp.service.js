// WhatsApp Cloud API (Meta) integration.
//
// Patterned after Meta's "Jasper's Market" sample
// (https://github.com/fbsamples/whatsapp-business-jaspers-market) — same
// request shape, same webhook handling, no FB SDK dependency (axios is
// enough for ~5 REST calls).
//
// Conversation window rules:
//   - When a client has messaged us in the last 24h we can send free text.
//   - Outside that window Meta requires an approved TEMPLATE.
// We don't track inbound timestamps yet, so we default to template for
// every outbound and fall back to text only if explicitly requested
// (via { force:'text' }).
//
// Reads the single active WhatsAppConfig row on each send (cheap, infrequent)
// so the operator can rotate token/phone-id without restarting the API.
import axios from 'axios';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

let warnedNoConfig = false;
const API_VERSION = process.env.WHATSAPP_VERSION || env.WHATSAPP_VERSION || 'v18.0';
const BASE = `https://graph.facebook.com/${API_VERSION}`;

async function loadActive() {
  return prisma.whatsAppConfig.findFirst({ where: { isActive: true } });
}

// Strip a phone number to E.164-without-plus form (e.g. "573001234567").
// WhatsApp Cloud API rejects "+", spaces, dashes.
//
// Colombian default: numbers are stored inconsistently (with "+57", with a
// bare "57", or just the 10-digit mobile starting with 3). WhatsApp needs the
// full international digits, so a bare 10-digit mobile gets "57" prepended —
// otherwise "3157729890" is sent verbatim and reaches the wrong number / is
// rejected. Anything already carrying a country code is left untouched.
const CO_COUNTRY_CODE = '57';
function normalizeRecipient(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[^\d]/g, '');
  if (!s) return null;
  if (s.length === 10 && s.startsWith('3')) s = CO_COUNTRY_CODE + s;
  return s;
}

async function postMessage(cfg, body) {
  const url = `${BASE}/${cfg.phoneId}/messages`;
  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10_000
    });
    return { ok: true, data: res.data };
  } catch (e) {
    // Meta returns { error: { message, type, code, error_data } } on 400/401
    const meta = e?.response?.data?.error;
    const msg = meta?.message || e.message;
    return { ok: false, error: msg, code: meta?.code, details: meta };
  }
}

// ── Public API ─────────────────────────────────────────────

/**
 * Send a free-text WhatsApp message. ONLY works if the recipient is inside
 * the 24h customer-service window (they messaged us first). Outside that
 * window Meta will reject with code 131047.
 */
export async function sendText(toRaw, text) {
  const cfg = await loadActive();
  if (!cfg) {
    if (!warnedNoConfig) { console.warn('[whatsapp] no active config — outbound disabled'); warnedNoConfig = true; }
    return { ok: false, error: 'no_active_config' };
  }
  warnedNoConfig = false;
  const to = normalizeRecipient(toRaw);
  if (!to) return { ok: false, error: 'invalid_recipient' };

  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text, preview_url: false }
  });
}

/**
 * Send a template message. The only reliable way to reach a client OUTSIDE
 * the 24h window. `templateName` must be the exact name of an approved
 * template in WhatsApp Manager. `bodyParameters` are positional values for
 * the {{1}}, {{2}}... placeholders inside the template body.
 */
export async function sendTemplate(toRaw, templateName, bodyParameters = [], opts = {}) {
  const cfg = await loadActive();
  if (!cfg) return { ok: false, error: 'no_active_config' };
  const to = normalizeRecipient(toRaw);
  if (!to) return { ok: false, error: 'invalid_recipient' };

  const language = opts.language || cfg.defaultLanguage || 'es_CO';
  const components = [];
  if (bodyParameters.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParameters.map(v => ({ type: 'text', text: String(v) }))
    });
  }
  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length ? { components } : {})
    }
  });
}

/**
 * Mark an inbound message as read. Useful when our webhook receives a
 * customer message — keeps their UI honest.
 */
export async function markAsRead(messageId) {
  const cfg = await loadActive();
  if (!cfg || !messageId) return { ok: false };
  return postMessage(cfg, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  });
}

/**
 * Send the canonical "hello_world" template that Meta provisions for every
 * new account. Used by the settings page to validate the credentials
 * end-to-end without needing the operator to have approved a custom
 * template first.
 */
export async function sendTest({ token, phoneId, recipient, templateName = 'hello_world', language = 'en_US' }) {
  const to = normalizeRecipient(recipient);
  if (!to) return { ok: false, error: 'Número inválido' };
  const url = `${BASE}/${phoneId}/messages`;
  try {
    const res = await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: language } }
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 10_000
    });
    return { ok: true, data: res.data };
  } catch (e) {
    const meta = e?.response?.data?.error;
    return { ok: false, error: meta?.message || e.message, code: meta?.code };
  }
}

// ── Webhook helpers ────────────────────────────────────────

/**
 * Webhook verification (Meta calls GET with hub.challenge during setup).
 * The verify token comes from WhatsAppConfig.businessAccountId fallback or
 * a dedicated field if you add one — for now we use a hardcoded one set
 * via env so Meta's setup can be done before the DB row exists.
 */
export function verifyWebhook(query, expectedToken) {
  if (query['hub.mode'] !== 'subscribe') return null;
  if (query['hub.verify_token'] !== expectedToken) return null;
  return query['hub.challenge'];
}

/**
 * Process an incoming webhook payload. Updates NotificationLog for status
 * callbacks (sent/delivered/read/failed) so the Historial reflects reality.
 * Inbound messages are stored as logs with type=INCOMING for future
 * threaded conversation UI.
 */
export async function handleWebhook(body) {
  if (body?.object !== 'whatsapp_business_account') return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      // Status updates: { id, status, recipient_id, timestamp }
      for (const s of value.statuses || []) {
        try {
          await prisma.notificationLog.updateMany({
            where: { externalId: s.id },
            data: { status: mapStatus(s.status) }
          });
        } catch {}
      }
      // Inbound messages
      for (const m of value.messages || []) {
        try {
          await prisma.notificationLog.create({
            data: {
              clientId: null,    // we'd need to look up by phone — leave for later
              campaignId: null,
              type: 'INCOMING',
              channel: 'WHATSAPP',
              recipient: m.from,
              subject: null,
              content: extractInboundText(m),
              status: 'received',
              sentAt: new Date()
            }
          }).catch(() => {});
          // Mark as read (best effort)
          markAsRead(m.id).catch(() => {});
        } catch {}
      }
    }
  }
}

function mapStatus(metaStatus) {
  switch (metaStatus) {
    case 'sent':      return 'sent';
    case 'delivered': return 'delivered';
    case 'read':      return 'read';
    case 'failed':    return 'failed';
    default:          return metaStatus;
  }
}

function extractInboundText(m) {
  if (m.type === 'text') return m.text?.body || '';
  if (m.type === 'button') return `[botón] ${m.button?.text || ''}`;
  if (m.type === 'interactive') return `[interactivo] ${JSON.stringify(m.interactive)}`;
  return `[${m.type}]`;
}
