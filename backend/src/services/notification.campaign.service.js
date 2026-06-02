import { notificationService } from './notification.service.js';
import { prisma } from '../config/database.js';

/**
 * Variable substitution. Supports {{name}}, {{plan}}, {{balance}}, {{email}},
 * {{phone}}, {{zone}}, {{ip}}, {{dueDate}}, {{amount}}.
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

function clientVars(client) {
  // Oldest pending invoice for {{dueDate}} / {{amount}}
  const pending = (client.invoices || []).filter(i => ['PENDING', 'OVERDUE', 'PARTIAL'].includes(i.status));
  const oldest = pending.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  return {
    name:     client.name || '',
    email:    client.email || '',
    phone:    client.phone || '',
    plan:     client.plan?.name || '',
    zone:     client.zone?.name || '',
    ip:       client.serviceIp || client.mikrotikAccount?.remoteAddress || '',
    balance:  fmtMoney(client.balance),
    dueDate:  oldest ? fmtDate(oldest.dueDate) : '',
    amount:   oldest ? fmtMoney(oldest.balanceDue || oldest.total || oldest.amount) : ''
  };
}

/**
 * Resolve campaign audience from the JSON filter saved on the campaign.
 * Filter shape: { zoneId?, status?, planId?, overdue? }
 */
async function resolveAudience(filter) {
  const where = {};
  if (filter?.zoneId)  where.zoneId  = Number(filter.zoneId);
  if (filter?.planId)  where.planId  = filter.planId;
  if (filter?.status)  where.status  = filter.status;
  if (filter?.overdue) {
    where.invoices = { some: { status: 'OVERDUE' } };
  }
  return prisma.client.findMany({
    where,
    include: {
      plan: { select: { name: true } },
      zone: { select: { name: true } },
      mikrotikAccount: { select: { remoteAddress: true } },
      invoices: {
        where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
        select: { status: true, total: true, amount: true, balanceDue: true, dueDate: true }
      }
    }
  });
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

  for (const client of audience) {
    const vars = clientVars(client);
    const subject = renderTemplate(campaign.template.subject || '', vars);
    const body    = renderTemplate(campaign.template.body, vars);

    for (const ch of channels) {
      const recipient = ch === 'EMAIL' ? (client.email || '') : (client.phone || '');
      if (!recipient) {
        await prisma.notificationLog.create({
          data: {
            clientId: client.id,
            campaignId,
            type: 'GENERAL_ANNOUNCEMENT',
            channel: ch,
            recipient: '',
            subject: ch === 'EMAIL' ? subject : null,
            content: body,
            status: 'failed',
            error: ch === 'EMAIL' ? 'Cliente sin email' : 'Cliente sin teléfono'
          }
        });
        failed++;
        continue;
      }

      try {
        console.log(`[campaign ${campaignId}] → ${ch} to ${recipient}`);
        if (ch === 'EMAIL') {
          // Pass the per-template preset so the styled header (icon + title)
          // matches the message type (invoice, reminder, etc.).
          await notificationService.sendEmailRaw({
            to: recipient,
            subject,
            body,
            preset: campaign.template.preset || undefined
          });
        } else {
          await notificationService.sendWhatsApp({ to: recipient, message: body });
        }
        await prisma.notificationLog.create({
          data: {
            clientId: client.id,
            campaignId,
            type: 'GENERAL_ANNOUNCEMENT',
            channel: ch,
            recipient,
            subject: ch === 'EMAIL' ? subject : null,
            content: body,
            status: 'sent',
            sentAt: new Date()
          }
        });
        sent++;
        console.log(`[campaign ${campaignId}]   ✓ sent (${sent + failed}/${total})`);
      } catch (e) {
        console.error(`[campaign ${campaignId}]   ✗ failed: ${e.message}`);
        await prisma.notificationLog.create({
          data: {
            clientId: client.id,
            campaignId,
            type: 'GENERAL_ANNOUNCEMENT',
            channel: ch,
            recipient,
            subject: ch === 'EMAIL' ? subject : null,
            content: body,
            status: 'failed',
            error: e.message?.slice(0, 500)
          }
        }).catch(logErr => console.error(`[campaign ${campaignId}] could not write failed log:`, logErr.message));
        failed++;
      }

      // Update counters every 10 deliveries so the UI can poll mid-run.
      if ((sent + failed) % 10 === 0) {
        await prisma.notificationCampaign.update({
          where: { id: campaignId },
          data: { sentCount: sent, failedCount: failed }
        }).catch(() => {});
      }
    }
  }

  // Final status:
  //   • empty_audience → resolved 0 recipients
  //   • failed         → all attempts errored
  //   • completed      → at least one delivery succeeded (even if some failed)
  let finalStatus = 'completed';
  if (total === 0)          finalStatus = 'empty_audience';
  else if (failed === total) finalStatus = 'failed';

  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: {
      status: finalStatus,
      sentCount: sent,
      failedCount: failed,
      finishedAt: new Date()
    }
  });

  console.log(`[campaign ${campaignId}] done status=${finalStatus} sent=${sent} failed=${failed} total=${total}`);
  return { total, sent, failed, status: finalStatus };
}

/**
 * Retry only the deliveries that previously failed for a campaign. Re-runs
 * the actual send for each failed log row and appends a new attempt log.
 */
export async function retryFailed(campaignId) {
  const failedLogs = await prisma.notificationLog.findMany({
    where: { campaignId, status: 'failed' },
    include: { client: {
      include: {
        plan: { select: { name: true } },
        zone: { select: { name: true } },
        mikrotikAccount: { select: { remoteAddress: true } },
        invoices: { where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } } }
      }
    } }
  });

  let recovered = 0;
  let stillFailed = 0;

  for (const log of failedLogs) {
    const recipient = log.recipient;
    if (!recipient) { stillFailed++; continue; }
    try {
      if (log.channel === 'EMAIL') {
        await notificationService.sendEmailRaw({
          to: recipient,
          subject: log.subject || 'Aviso',
          body: log.content
        });
      } else {
        await notificationService.sendWhatsApp({ to: recipient, message: log.content });
      }
      // Mark the original log as recovered + append a fresh "sent" entry.
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { status: 'sent', sentAt: new Date(), error: null }
      });
      recovered++;
    } catch (e) {
      await prisma.notificationLog.update({
        where: { id: log.id },
        data: { error: e.message?.slice(0, 500) }
      });
      stillFailed++;
    }
  }

  // Refresh campaign counters.
  const [sent, failed] = await Promise.all([
    prisma.notificationLog.count({ where: { campaignId, status: 'sent' } }),
    prisma.notificationLog.count({ where: { campaignId, status: 'failed' } })
  ]);
  await prisma.notificationCampaign.update({
    where: { id: campaignId },
    data: { sentCount: sent, failedCount: failed }
  });

  return { recovered, stillFailed };
}
