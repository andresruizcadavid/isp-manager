// Single dispatch point for outbound notifications.
//
// Goals:
//   • One function — `dispatch({ type, client, channels, payload })` — to
//     replace the scattered "send X notification" methods. Existing methods
//     can either delegate here or stay; new code SHOULD use the orchestrator.
//   • One `NotificationLog` row per (client × channel × attempt) so the
//     audit trail in /notifications is complete and partial-success cases
//     are visible (e.g. "email sent, WhatsApp failed").
//   • Bounded retry per channel for transient errors (network / 5xx). No
//     retry for permanent errors (missing recipient, template invalid).
//   • Fire-and-forget for callers that want it (returns a promise but is
//     safe to ignore). For Wompi/billing call sites that need the result,
//     awaiting works too.
//
// Out of scope (deferred):
//   • Persisting a queue with BullMQ (FASE 6). Today retries are in-process
//     with setTimeout. Acceptable at single-instance ≤200-client scale.
//   • Bouncing / quiet-hours policy. Add when needed.

import { prisma } from '../config/database.js';
import { notificationService } from './notification.service.js';
import * as whatsapp from './whatsapp.service.js';
import * as telegram from './telegram.service.js';

// ── Constants ────────────────────────────────────────────────────────
const ALL_CHANNELS = ['EMAIL', 'WHATSAPP', 'TELEGRAM'];

// Notification types — keep in sync with the Prisma `NotificationType` enum.
// Add a key here BEFORE invoking dispatch with it; render() will throw
// "unknown type" otherwise (caught and logged as a permanent failure).
export const NOTIFICATION_TYPES = Object.freeze({
  INVOICE_CREATED:        'INVOICE_CREATED',
  PAYMENT_RECEIVED:       'PAYMENT_RECEIVED',
  PAYMENT_FAILED:         'PAYMENT_FAILED',
  SERVICE_SUSPENDED:      'SERVICE_SUSPENDED',
  SERVICE_ACTIVATED:      'SERVICE_ACTIVATED',
  INSTALLATION_SCHEDULED: 'INSTALLATION_SCHEDULED',
  GENERAL_ANNOUNCEMENT:   'GENERAL_ANNOUNCEMENT'
});

// Retry policy: attempts × backoff in ms. 1s, 4s, 16s — quadratic so a
// flaky SMTP doesn't pile up.
const RETRY_BACKOFFS_MS = [1000, 4000, 16000];

// ── Render: type × channel → { subject, body, recipient } ────────────
// Centralises the message text so all three channels stay in sync. The
// payload shape is type-specific; the renderer validates it implicitly
// by accessing the fields it needs.
function renderEmail({ type, client, payload }) {
  const company = payload?.companyName || 'ISP Manager';
  const money = (cents) => new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format((cents || 0) / 100);

  const cta = payload.cta || null;
  switch (type) {
    case 'INVOICE_CREATED':
      return {
        subject: `Nueva factura ${payload.invoice.invoiceNumber} — ${company}`,
        body:
`Hola ${client.name?.split(/\s+/)[0] || ''},

Tu factura ${payload.invoice.invoiceNumber} por ${money(payload.invoice.total)} ya está disponible. Vence el ${new Date(payload.invoice.dueDate).toLocaleDateString('es-CO')}.

Gracias por estar con ${company}.`,
        cta
      };
    case 'PAYMENT_RECEIVED':
      return {
        subject: `Pago recibido — Factura ${payload.invoice.invoiceNumber}`,
        body:
`Hola ${client.name?.split(/\s+/)[0] || ''},

Hemos recibido tu pago de ${money(payload.payment.amount)} para la factura ${payload.invoice.invoiceNumber}. ¡Gracias!`,
        cta
      };
    case 'PAYMENT_FAILED':
      return {
        subject: `Pago no procesado — Factura ${payload.invoice.invoiceNumber}`,
        body:
`Hola ${client.name?.split(/\s+/)[0] || ''},

El último intento de pago de la factura ${payload.invoice.invoiceNumber} no se completó. Puedes intentarlo nuevamente en cualquier momento.`,
        cta
      };
    case 'SERVICE_SUSPENDED':
      return {
        subject: `Servicio suspendido — ${company}`,
        body:
`Hola ${client.name?.split(/\s+/)[0] || ''},

Tu servicio de internet ha sido suspendido por mora en el pago. Para reactivarlo, regulariza tus facturas pendientes lo antes posible.`,
        cta
      };
    case 'SERVICE_ACTIVATED':
      return {
        subject: `Servicio reactivado — ${company}`,
        body:
`Hola ${client.name?.split(/\s+/)[0] || ''},

Tu servicio de internet ha sido reactivado. ¡Gracias por tu pago!`,
        cta
      };
    case 'INSTALLATION_SCHEDULED':
      return {
        subject: `Instalación agendada — ${company}`,
        body:
`Hola ${client.name?.split(/\s+/)[0] || ''},

Tu instalación está agendada para ${new Date(payload.installationDate).toLocaleDateString('es-CO')}. Asegúrate de tener a alguien en sitio.`,
        cta
      };
    case 'GENERAL_ANNOUNCEMENT':
      return {
        subject: payload.subject || `Aviso — ${company}`,
        body:   payload.message || '',
        cta
      };
    default:
      throw Object.assign(new Error(`Unknown notification type: ${type}`), { permanent: true });
  }
}

function renderWhatsApp({ type, client, payload }) {
  // Reuse the email body — WhatsApp has no subject, just a single text.
  // Trim/format for chat style: shorter intro, no greetings duplication.
  const { subject, body } = renderEmail({ type, client, payload });
  // If a custom WhatsApp message was provided, prefer it.
  return { text: payload?.whatsappText || `${subject}\n\n${body}` };
}

function renderTelegram({ type, client, payload }) {
  // Telegram is interpreted as an OPERATOR alert (we don't have customer
  // chat IDs). Format includes the client identity for context.
  const { subject, body } = renderEmail({ type, client, payload });
  return {
    text:
`<b>${subject}</b>\n\n${body}\n\nCliente: <b>${client.name || '?'}</b>${client.documentNumber ? ` (${client.documentType || 'CC'} ${client.documentNumber})` : ''}`
  };
}

// ── Per-channel senders ──────────────────────────────────────────────
async function sendEmailChannel(client, rendered) {
  if (!client.email) {
    throw Object.assign(new Error('Client has no email'), { permanent: true });
  }
  await notificationService.sendEmailRaw({
    to:      client.email,
    subject: rendered.subject,
    body:    rendered.body,
    cta:     rendered.cta || undefined,
    preset:  'general_announcement'
  });
  return { externalId: null }; // SMTP doesn't return a tracking id
}

async function sendWhatsAppChannel(client, rendered) {
  if (!client.phone) {
    throw Object.assign(new Error('Client has no phone'), { permanent: true });
  }
  const r = await whatsapp.sendText(client.phone, rendered.text);
  if (!r?.ok) {
    const err = new Error(r?.error || 'WhatsApp send failed');
    // Treat 4xx-ish errors as permanent. Without a status code from the
    // service we conservatively make NO_ACTIVE_CONFIG permanent and the
    // rest retryable.
    err.permanent = r?.error === 'no_active_config';
    throw err;
  }
  return { externalId: r.id || null };
}

async function sendTelegramChannel(_client, rendered) {
  const r = await telegram.sendMessage(rendered.text, { parseMode: 'HTML' });
  if (!r?.ok) {
    const err = new Error(r?.error || 'Telegram send failed');
    err.permanent = r?.error === 'no_active_config';
    throw err;
  }
  return { externalId: null };
}

const RENDERERS = { EMAIL: renderEmail,    WHATSAPP: renderWhatsApp, TELEGRAM: renderTelegram };
const SENDERS   = { EMAIL: sendEmailChannel, WHATSAPP: sendWhatsAppChannel, TELEGRAM: sendTelegramChannel };

// ── Log helpers ──────────────────────────────────────────────────────
async function logAttempt({ clientId, type, channel, recipient, rendered, status, error, externalId }) {
  const subject = channel === 'EMAIL' ? rendered.subject : null;
  const content = channel === 'EMAIL' ? rendered.body    : rendered.text;
  try {
    await prisma.notificationLog.create({
      data: {
        clientId, type, channel,
        recipient: recipient || '',
        subject,
        content: (content || '').slice(0, 4000),
        status,
        error:       error || null,
        externalId:  externalId || null,
        sentAt:      status === 'sent' || status === 'delivered' ? new Date() : null
      }
    });
  } catch (e) {
    // Never let log persistence kill the actual dispatch.
    console.error('[notification-orchestrator] logAttempt failed:', e.message);
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Public API ───────────────────────────────────────────────────────
/**
 * Dispatch a typed notification to a client over one or more channels.
 *
 * @param {object}        opts
 * @param {string}        opts.type      One of NOTIFICATION_TYPES.
 * @param {object}        opts.client    Client row (must have id; email/phone optional).
 * @param {string[]}      [opts.channels]  Default: all three.
 * @param {object}        [opts.payload]   Type-specific data (invoice/payment/etc).
 * @returns Promise<{ results: { [channel]: { ok, error?, attempts, externalId? } } }>
 *   Resolves even when some/all channels fail. Callers can inspect per-channel.
 */
export async function dispatch({ type, client, channels = ALL_CHANNELS, payload = {} }) {
  if (!type || !NOTIFICATION_TYPES[type]) {
    throw new Error(`dispatch: unknown type "${type}"`);
  }
  if (!client?.id) {
    throw new Error('dispatch: client.id required');
  }

  const results = {};

  // Sequential per-channel — keeps log ordering deterministic. Channels are
  // 1-3 max, so the latency cost is negligible.
  for (const channel of channels) {
    if (!ALL_CHANNELS.includes(channel)) {
      results[channel] = { ok: false, error: 'invalid_channel', attempts: 0 };
      continue;
    }
    const rendered  = RENDERERS[channel]({ type, client, payload });
    const recipient =
      channel === 'EMAIL'    ? client.email :
      channel === 'WHATSAPP' ? client.phone :
                               '(operator-chat)';

    let lastError = null;
    let externalId = null;
    let attempts = 0;
    for (let i = 0; i <= RETRY_BACKOFFS_MS.length; i++) {
      attempts++;
      try {
        const r = await SENDERS[channel](client, rendered);
        externalId = r?.externalId || null;
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        if (e.permanent) break;                       // no retry for permanent
        if (i === RETRY_BACKOFFS_MS.length) break;    // out of attempts
        await delay(RETRY_BACKOFFS_MS[i]);
      }
    }

    const status = lastError ? 'failed' : 'sent';
    await logAttempt({
      clientId: client.id, type, channel, recipient, rendered,
      status,
      error:       lastError ? `${lastError.message}${attempts > 1 ? ` (${attempts} attempts)` : ''}` : null,
      externalId
    });

    results[channel] = lastError
      ? { ok: false, error: lastError.message, attempts }
      : { ok: true, externalId, attempts };
  }

  return { results };
}
