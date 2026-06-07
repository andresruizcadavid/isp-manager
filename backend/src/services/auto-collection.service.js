// Automatic collection campaign — runs during an active CollectionWindow.
//
// Stateless stop-on-pay: every tick re-queries the debtor set from the
// invoice table. A client who paid since the last tick simply no longer
// appears, so no "in-campaign" flag is needed and the system can't get
// stuck.
//
// Dedup per (client, window) via NotificationLog with campaignId set to
// the window id. We send only if there's no recent (within
// `sendFrequencyHours`) successful row for this client+campaign.
//
// Channel fan-out: each channel in `window.channels` is logged
// independently, so partial failure on one channel doesn't block the
// others.

import { prisma } from '../config/database.js';
import { findActiveNow } from './collection-window.service.js';
import { notificationService } from './notification.service.js';
import * as whatsapp from './whatsapp.service.js';
import * as telegram from './telegram.service.js';

const STATUS_SENT   = 'sent';
const STATUS_FAILED = 'failed';

function fmtMoney(cents) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(cents / 100);
}
function fmtDate(d) {
  if (!d) return '—';
  const x = new Date(d);
  return x.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}
function renderTemplate(tpl, ctx) {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => (ctx[key] ?? `{${key}}`));
}

/**
 * Run one tick of the collection campaign.
 *
 *   • If `windowId` is provided, use that window (validates isActive
 *     unless force=true).
 *   • Otherwise, look up the active-now window. No-op if none.
 *
 * Returns { windowId, sweptDebtors, sentByChannel, skippedRecent, failed }.
 */
export async function runCollectionTick({ windowId = null, force = false } = {}) {
  const window = windowId
    ? await prisma.collectionWindow.findUnique({ where: { id: windowId } })
    : await findActiveNow();

  if (!window) return { windowId: null, sweptDebtors: 0, sentByChannel: {}, skippedRecent: 0, failed: 0, reason: 'no_active_window' };
  if (!force && !window.isActive) {
    return { windowId: window.id, sweptDebtors: 0, sentByChannel: {}, skippedRecent: 0, failed: 0, reason: 'inactive' };
  }

  // 1. Debtors — stateless query against Invoice. Clients become debtors
  //    by having ≥1 invoice with status in window.targetStatuses AND
  //    balanceDue > 0. They stop being debtors the moment they pay.
  const debtors = await prisma.client.findMany({
    where: {
      invoices: {
        some: {
          status: { in: window.targetStatuses },
          balanceDue: { gt: 0 }
        }
      }
    },
    include: {
      invoices: {
        where: {
          status: { in: window.targetStatuses },
          balanceDue: { gt: 0 }
        },
        select: { id: true, total: true, balanceDue: true, dueDate: true, periodYear: true, periodMonth: true },
        orderBy: [{ dueDate: 'asc' }]
      }
    }
  });

  // 2. Frequency gate — pull recent successful sends for these clients
  //    in this window, in one query, so the per-client loop is just
  //    a Map lookup.
  const cutoff = new Date(Date.now() - window.sendFrequencyHours * 3600 * 1000);
  const recent = await prisma.notificationLog.findMany({
    where: {
      campaignId: window.id,
      clientId:   { in: debtors.map(d => d.id) },
      status:     STATUS_SENT,
      createdAt:  { gte: cutoff }
    },
    select: { clientId: true, channel: true }
  });
  // key: `${clientId}|${channel}`
  const recentSet = new Set(recent.map(r => `${r.clientId}|${r.channel}`));

  // 3. Per-debtor, per-channel dispatch.
  const sentByChannel = {};
  let skippedRecent = 0;
  let failedCount   = 0;

  for (const client of debtors) {
    const totalDebt = client.invoices.reduce((s, i) => s + (i.balanceDue || 0), 0);
    const earliestDue = client.invoices[0]?.dueDate;
    const ctx = {
      name:    (client.name || '').split(/\s+/)[0] || client.name || 'Estimado cliente',
      amount:  fmtMoney(totalDebt),
      dueDate: fmtDate(earliestDue),
      invoiceCount: String(client.invoices.length)
    };
    const message = renderTemplate(window.messageTemplate, ctx);

    for (const channel of window.channels) {
      if (recentSet.has(`${client.id}|${channel}`)) { skippedRecent++; continue; }

      let dispatch = { ok: false, error: 'unknown_channel' };
      try {
        if (channel === 'EMAIL') {
          if (!client.email) { dispatch = { ok: false, error: 'no_email' }; }
          else {
            await notificationService.sendEmailRaw({
              to: client.email,
              subject: `Recordatorio de pago — ${ctx.amount}`,
              body: message,
              preset: 'payment_reminder',
              title: 'Recordatorio de pago'
            });
            dispatch = { ok: true };
          }
        } else if (channel === 'WHATSAPP') {
          if (!client.phone) { dispatch = { ok: false, error: 'no_phone' }; }
          else {
            const r = await whatsapp.sendText(client.phone, message);
            dispatch = r?.ok ? { ok: true, id: r.id } : { ok: false, error: r?.error || 'unknown' };
          }
        } else if (channel === 'TELEGRAM') {
          const r = await telegram.sendMessage(
            `<b>Recordatorio de cobro</b>\nCliente: ${client.name}\n${message}`,
            { parseMode: 'HTML' }
          );
          dispatch = r?.ok ? { ok: true } : { ok: false, error: r?.error || 'unknown' };
        }
      } catch (e) {
        dispatch = { ok: false, error: e.message };
      }

      // Log every attempt — success drives the frequency gate, failures
      // give the operator visibility in /clients/[id] history + metrics.
      await prisma.notificationLog.create({
        data: {
          clientId:   client.id,
          campaignId: window.id,
          type:       'PAYMENT_REMINDER',
          channel,
          recipient:  channel === 'EMAIL' ? (client.email || 'unknown')
                    : channel === 'WHATSAPP' ? (client.phone || 'unknown')
                    : 'telegram-bot',
          content:    message,
          status:     dispatch.ok ? STATUS_SENT : STATUS_FAILED,
          error:      dispatch.ok ? null : (dispatch.error || 'unknown'),
          sentAt:     dispatch.ok ? new Date() : null
        }
      }).catch(err => console.error('[auto-collection] log failed:', err.message));

      if (dispatch.ok) {
        sentByChannel[channel] = (sentByChannel[channel] || 0) + 1;
      } else {
        failedCount++;
      }
    }
  }

  return {
    windowId: window.id,
    sweptDebtors: debtors.length,
    sentByChannel,
    skippedRecent,
    failed: failedCount
  };
}
