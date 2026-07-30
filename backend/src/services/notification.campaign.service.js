import { notificationService } from './notification.service.js';
import { paymentLinkService } from './payment-link.service.js';
import { prisma } from '../config/database.js';

// Throttle preventivo entre envíos de una campaña (ms). Configurable por env.
const CAMPAIGN_SEND_DELAY_MS = Number(process.env.CAMPAIGN_SEND_DELAY_MS) || 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Variable substitution. Supports {{name}}, {{plan}}, {{balance}}, {{email}},
 * {{phone}}, {{zone}}, {{ip}}, {{dueDate}}, {{amount}}, {{paymentLink}}.
 * Any unknown placeholder renders as an empty string so we don't leak
 * `{{foo}}` literals to end users.
 */
function renderTemplate(body, vars) {
  return String(body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

const fmtMoney = (cents) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format((cents || 0) / 100);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '';

function clientVars(client, overrides = {}) {
  // Oldest pending invoice for {{dueDate}} / {{amount}}
  const pending = (client.invoices || []).filter(i => ['PENDING', 'OVERDUE', 'PARTIAL'].includes(i.status));
  const oldest = pending.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  return {
    name:        client.name || '',
    email:       client.email || '',
    phone:       client.phone || '',
    plan:        client.plan?.name || '',
    zone:        client.zone?.name || '',
    ip:          client.mikrotikAccount?.remoteAddress || '',
    balance:     fmtMoney(client.balance),
    dueDate:     oldest ? fmtDate(oldest.dueDate) : '',
    amount:      oldest ? fmtMoney(oldest.balanceDue || oldest.total || oldest.amount) : '',
    paymentLink: overrides.paymentLinkUrl || ''
  };
}

const OPEN_STATUSES = ['PENDING', 'OVERDUE', 'PARTIAL'];

/**
 * Construye el `where` de Prisma para la audiencia de una campaña. ÚNICA fuente
 * de verdad — la usan tanto el conteo/preview (rutas) como el envío real
 * (resolveAudience) para que no se desincronicen.
 *
 * Filtro: {
 *   clientIds?, zoneId?, planId?, status? (estado del CLIENTE),
 *   debt?: 'open'|'overdue'|'none',   // deuda: con deuda / vencida / al día
 *   debtYear?, debtMonth?,            // restringe la deuda a un período (ej. jul 2026)
 *   overdue?  // compat viejo → debt:'overdue'
 * }
 */
export function buildAudienceWhere(filter) {
  /** @type {Record<string, any>} */
  const where = {};
  // La selección explícita manda: si el operador marcó clientes puntuales,
  // se envía SOLO a esos.
  if (filter?.clientIds?.length) where.id = { in: filter.clientIds };
  if (filter?.zoneId)  where.zoneId  = Number(filter.zoneId);
  if (filter?.planId)  where.planId  = filter.planId;
  if (filter?.status)  where.status  = filter.status;

  const debt = filter?.debt || (filter?.overdue ? 'overdue' : undefined);
  if (debt) {
    const hasPeriod = filter?.debtYear && filter?.debtMonth;
    /** @type {Record<string, any>} */
    const inv = { status: { in: OPEN_STATUSES }, balanceDue: { gt: 0 } };
    if (hasPeriod) { inv.periodYear = Number(filter.debtYear); inv.periodMonth = Number(filter.debtMonth); }
    if (debt === 'overdue') inv.dueDate = { lt: new Date() };   // vencida = abierta + ya venció

    if (debt === 'none') {
      // Al día = sin NINGUNA factura abierta (en el período si se indicó).
      const none = { status: { in: OPEN_STATUSES }, balanceDue: { gt: 0 } };
      if (hasPeriod) { none.periodYear = Number(filter.debtYear); none.periodMonth = Number(filter.debtMonth); }
      where.invoices = { none };
    } else {
      where.invoices = { some: inv };
    }
  }
  return where;
}

/**
 * Resolve campaign audience from the JSON filter saved on the campaign.
 */
async function resolveAudience(filter) {
  const where = buildAudienceWhere(filter);
  return prisma.client.findMany({
    where,
    include: {
      plan: { select: { name: true } },
      zone: { select: { name: true } },
      mikrotikAccount: { select: { remoteAddress: true } },
      invoices: {
        where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
        select: { id: true, status: true, total: true, amount: true, balanceDue: true, dueDate: true }
      }
    }
  });
}

/** Load a single client with everything sendToClient needs (same includes as
 *  resolveAudience). Used by the single-client sends: campaign test + the
 *  manual "Enviar notificación" on the client page. */
export async function loadClientForSend(clientId) {
  return prisma.client.findUnique({
    where: { id: clientId },
    include: {
      plan: { select: { name: true } },
      zone: { select: { name: true } },
      mikrotikAccount: { select: { remoteAddress: true } },
      invoices: {
        where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
        select: { id: true, status: true, total: true, amount: true, balanceDue: true, dueDate: true }
      }
    }
  });
}

/**
 * Per-client send shared by the campaign runner, the campaign test send, and
 * the manual single-client send. Generates the payment link when requested,
 * renders the template, sends on each channel and writes one NotificationLog
 * per channel. Returns { sent, failed }.
 *
 * `client` must be loaded with plan/zone/mikrotikAccount/invoices (see
 * resolveAudience / loadClientForSend). `campaignId` is null for single sends
 * (test / manual) so they don't pollute a campaign's counters.
 */
export async function sendToClient({
  client, template, channel, generatePaymentLinks = false,
  campaignId = null, type = 'GENERAL_ANNOUNCEMENT'
}) {
  const channels = channel === 'BOTH' ? ['EMAIL', 'WHATSAPP'] : [channel];

  // Generate payment link from the oldest open invoice when requested.
  let paymentLinkUrl = '';
  let paymentLinkId = null;
  if (generatePaymentLinks) {
    const pending = (client.invoices || []).filter(i => ['PENDING', 'OVERDUE', 'PARTIAL'].includes(i.status));
    const oldest = pending.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
    if (oldest) {
      try {
        const link = await paymentLinkService.createForInvoice(oldest.id);
        paymentLinkUrl = link.checkoutUrl;
        paymentLinkId = link.id;
      } catch (e) {
        console.error(`[sendToClient ${client.id}] failed to create payment link: ${e.message}`);
      }
    }
  }

  const vars = clientVars(client, { paymentLinkUrl });
  const subject = renderTemplate(template.subject || '', vars);
  const body    = renderTemplate(template.body, vars);

  let sent = 0, failed = 0, skipped = 0;
  for (const ch of channels) {
    const recipient = ch === 'EMAIL' ? (client.email || '') : (client.phone || '');
    if (!recipient) {
      // Sin contacto para el canal ≠ error de envío. Se registra como
      // "skipped" (omitido) para NO inflar el conteo rojo de errores ni el
      // reintento. Es un dato faltante del cliente, no una falla del sistema.
      await prisma.notificationLog.create({
        data: {
          clientId: client.id, campaignId, type, channel: ch, recipient: '',
          subject: ch === 'EMAIL' ? subject : null, content: body,
          status: 'skipped',
          error: ch === 'EMAIL' ? 'Cliente sin email' : 'Cliente sin teléfono'
        }
      }).catch(() => {});
      skipped++;
      continue;
    }
    try {
      if (ch === 'EMAIL') {
        const cta = paymentLinkUrl ? { text: 'Pagar ahora', url: paymentLinkUrl } : undefined;
        await notificationService.sendEmailRaw({
          to: recipient, subject, body, cta, preset: template.preset || undefined
        });
      } else {
        await notificationService.sendWhatsApp({ to: recipient, message: body });
      }
      if (paymentLinkId && ch === 'EMAIL') {
        await prisma.paymentLink.update({
          where: { id: paymentLinkId }, data: { sentAt: new Date() }
        }).catch(e => console.error(`[sendToClient ${client.id}] failed to update sentAt: ${e.message}`));
      }
      await prisma.notificationLog.create({
        data: {
          clientId: client.id, campaignId, type, channel: ch, recipient,
          subject: ch === 'EMAIL' ? subject : null, content: body,
          status: 'sent', sentAt: new Date()
        }
      });
      sent++;
    } catch (e) {
      await prisma.notificationLog.create({
        data: {
          clientId: client.id, campaignId, type, channel: ch, recipient,
          subject: ch === 'EMAIL' ? subject : null, content: body,
          status: 'failed', error: e.message?.slice(0, 500)
        }
      }).catch(logErr => console.error(`[sendToClient ${client.id}] could not write failed log:`, logErr.message));
      failed++;
    }
  }
  return { sent, failed, skipped };
}

/**
 * Write a "system-level" failure log when runCampaign crashes BEFORE or
 * BETWEEN deliveries — so the operator sees the reason in the History tab
 * instead of an empty list with a "failed" campaign and zero context.
 */
async function logSystemFailure(campaignId, stage, error) {
  const errMsg = `[${stage}] ${error?.message || error || 'desconocido'}`;
  console.error(`[campaign ${campaignId}] SYSTEM FAILURE at ${stage}:`, error);
  try {
    await prisma.notificationLog.create({
      data: {
        campaignId,
        clientId: null,
        type: 'GENERAL_ANNOUNCEMENT',
        channel: 'EMAIL',
        recipient: '',
        subject: `[Error de sistema] ${stage}`,
        content: errMsg.slice(0, 2000),
        status: 'failed',
        error: errMsg.slice(0, 500)
      }
    });
  } catch (logErr) {
    console.error(`[campaign ${campaignId}] could not write system failure log:`, logErr.message);
  }
}

/**
 * Run a campaign end-to-end. Sets status running → completed, writes one
 * NotificationLog per delivery attempt, updates counters as it goes.
 * Resilient: a single delivery failure doesn't abort the batch.
 */
export async function runCampaign(campaignId) {
  console.log(`[campaign ${campaignId}] runCampaign() ENTRY`);

  let campaign;
  try {
    campaign = await prisma.notificationCampaign.findUnique({
      where: { id: campaignId },
      include: { template: true }
    });
  } catch (e) {
    await logSystemFailure(campaignId, 'load-campaign', e);
    await prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: { status: 'failed', finishedAt: new Date() }
    }).catch(() => {});
    throw e;
  }

  if (!campaign) {
    await logSystemFailure(campaignId, 'load-campaign', new Error('Campaign row not found'));
    throw new Error(`Campaign ${campaignId} not found`);
  }
  if (!campaign.template) {
    await logSystemFailure(campaignId, 'load-template', new Error('La campaña no tiene plantilla asociada (templateId null o plantilla eliminada).'));
    await prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: { status: 'failed', finishedAt: new Date() }
    }).catch(() => {});
    return;
  }

  let audienceFilter = {};
  try {
    audienceFilter = campaign.audienceJson ? JSON.parse(campaign.audienceJson) : {};
  } catch (e) {
    await logSystemFailure(campaignId, 'parse-audience', e);
    await prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: { status: 'failed', finishedAt: new Date() }
    }).catch(() => {});
    return;
  }

  let audience = [];
  try {
    audience = await resolveAudience(audienceFilter);
  } catch (e) {
    await logSystemFailure(campaignId, 'resolve-audience', e);
    await prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: { status: 'failed', finishedAt: new Date() }
    }).catch(() => {});
    return;
  }

  const channels = campaign.channel === 'BOTH'
    ? ['EMAIL', 'WHATSAPP']
    : [campaign.channel];
  const total = audience.length * channels.length;

  console.log(
    `[campaign ${campaignId}] start name="${campaign.name}" ` +
    `template="${campaign.template.name}" (id=${campaign.template.id}, channel=${campaign.template.channel}) ` +
    `channels=[${channels.join(',')}] audience=${audience.length} totalDeliveries=${total} ` +
    `audienceFilter=${JSON.stringify(audienceFilter)}`
  );

  if (audience.length > 0) {
    console.log(
      `[campaign ${campaignId}] audience preview: ` +
      audience.slice(0, 5).map(c => `${c.name}<${c.email || 'NO EMAIL'}>`).join(', ') +
      (audience.length > 5 ? ` ...+${audience.length - 5} more` : '')
    );
  }

  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: 'running',
      totalCount: total,
      sentCount: 0,
      failedCount: 0,
      startedAt: new Date()
    }
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let idx = 0; idx < audience.length; idx++) {
    const client = audience[idx];
    const r = await sendToClient({
      client,
      template: campaign.template,
      channel: campaign.channel,
      generatePaymentLinks: campaign.generatePaymentLinks,
      campaignId
    });
    sent    += r.sent;
    failed  += r.failed;
    skipped += (r.skipped || 0);

    // Update counters after each client so the UI poll sees live progress.
    // failedCount = SOLO errores reales (los omitidos no cuentan como error).
    await prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: { sentCount: sent, failedCount: failed }
    }).catch(() => {});

    // Throttle preventivo entre clientes para no chocar límites del proveedor
    // (Brevo). Barato hoy (26 clientes) y protege cuando crezca la base.
    if (idx < audience.length - 1) await sleep(CAMPAIGN_SEND_DELAY_MS);
  }

  // Estado final más fino:
  //   • empty_audience → 0 destinatarios
  //   • skipped        → nada se envió, solo omitidos (sin email/teléfono)
  //   • failed         → todo lo INTENTADO falló por error real (0 enviados)
  //   • completed_with_errors → algunos enviados y algunos con error
  //   • completed      → todos los intentados OK (puede haber omitidos)
  let finalStatus;
  if (total === 0)                          finalStatus = 'empty_audience';
  else if (sent === 0 && failed === 0 && skipped > 0) finalStatus = 'skipped';
  else if (sent === 0 && failed > 0)        finalStatus = 'failed';
  else if (failed > 0)                      finalStatus = 'completed_with_errors';
  else                                      finalStatus = 'completed';

  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: finalStatus,
      sentCount: sent,
      failedCount: failed,
      finishedAt: new Date()
    }
  });

  console.log(`[campaign ${campaignId}] done status=${finalStatus} sent=${sent} failed=${failed} skipped=${skipped} total=${total}`);
  return { total, sent, failed, skipped, status: finalStatus };
}

/**
 * Reintenta las entregas fallidas Y omitidas de una campaña, de forma robusta:
 *   • Re-carga cada cliente para usar su email/teléfono ACTUALES (así un
 *     "Cliente sin email" se recupera si después le cargaste el correo).
 *   • Vuelve a pasar por sendToClient → REGENERA el payment link + el botón
 *     "Pagar ahora" y re-renderiza la plantilla (no reenvía contenido crudo).
 *   • Ignora los logs de "error de sistema" (clientId null): no son reintentables.
 *   • Marca los logs viejos como 'superseded' para no duplicar el conteo.
 */
export async function retryFailed(campaignId) {
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
    include: { template: true }
  });
  if (!campaign) throw new Error('Campaña no encontrada');
  if (!campaign.template) throw new Error('La campaña no tiene plantilla asociada; no se puede reintentar.');

  // Logs reintentables: fallidos u omitidos, con cliente asociado (excluye
  // los logs de error de sistema, que tienen clientId null).
  const logs = await prisma.notificationLog.findMany({
    where: { campaignId, status: { in: ['failed', 'skipped'] }, clientId: { not: null } },
    select: { id: true, clientId: true }
  });
  const clientIds = [...new Set(logs.map((l) => l.clientId).filter(Boolean))];
  if (!clientIds.length) return { recovered: 0, stillFailed: 0, skipped: 0, retriedClients: 0 };

  // Retira del conteo los intentos previos de esos clientes (se re-emiten).
  await prisma.notificationLog.updateMany({
    where: { id: { in: logs.map((l) => l.id) } },
    data: { status: 'superseded' }
  });

  let recovered = 0, stillFailed = 0, skipped = 0;
  for (const cid of clientIds) {
    const client = await loadClientForSend(cid);
    if (!client) { stillFailed++; continue; }
    const r = await sendToClient({
      client,
      template: campaign.template,
      channel: campaign.channel,
      generatePaymentLinks: campaign.generatePaymentLinks,
      campaignId
    });
    recovered   += r.sent;
    stillFailed += r.failed;
    skipped     += (r.skipped || 0);
    await sleep(CAMPAIGN_SEND_DELAY_MS);
  }

  // Recalcula contadores + estado. 'skipped'/'superseded' no cuentan como error.
  const [sent, failed, skippedNow] = await Promise.all([
    prisma.notificationLog.count({ where: { campaignId, status: 'sent' } }),
    prisma.notificationLog.count({ where: { campaignId, status: 'failed' } }),
    prisma.notificationLog.count({ where: { campaignId, status: 'skipped' } })
  ]);
  let status = campaign.status;
  const attempted = sent + failed + skippedNow;
  if (attempted > 0) {
    if (sent === 0 && failed === 0 && skippedNow > 0) status = 'skipped';
    else if (sent === 0 && failed > 0)                status = 'failed';
    else if (failed > 0)                              status = 'completed_with_errors';
    else                                              status = 'completed';
  }
  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: { sentCount: sent, failedCount: failed, status }
  });

  return { recovered, stillFailed, skipped, retriedClients: clientIds.length, status };
}
