import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery } from '../middleware/validate.middleware.js';
import { renderEmailTemplate, EMAIL_PRESETS } from '../services/email-base.template.js';
import { runCampaign, retryFailed, sendToClient, loadClientForSend } from '../services/notification.campaign.service.js';

const router = Router();

// Sample data used ONLY to render the live preview in the template editor, so
// the operator sees the real branded layout (same renderEmailTemplate the
// system sends) with placeholder values instead of {{vars}}.
const PREVIEW_SAMPLE = {
  name: 'Andrés Gómez', plan: 'Plan Full 100MB', amount: '$65.000 COP',
  dueDate: '15/06/2026', balance: '$65.000 COP', zone: 'San Vicente',
  ip: '10.20.30.40', invoiceNumber: 'INV-0042',
  email: 'cliente@correo.com', phone: '+57 300 000 0000'
};
const fillSampleVars = (str) =>
  String(str || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => PREVIEW_SAMPLE[k] ?? '');

const CHANNEL = z.enum(['EMAIL', 'WHATSAPP', 'BOTH']);
const CHANNEL_SINGLE = z.enum(['EMAIL', 'WHATSAPP']);

const PRESET_ENUM = z.enum([
  'invoice', 'reminder', 'service_suspended', 'service_activated',
  'payment_received', 'welcome', 'general_announcement'
]);

const templateSchema = z.object({
  name:    z.string().min(2),
  channel: CHANNEL_SINGLE,
  subject: z.string().nullish(),
  body:    z.string().min(1, 'El cuerpo del mensaje es obligatorio'),
  // Visual preset that drives the email header icon + title. Optional —
  // null/undefined falls back to 'general_announcement' (📣) at render time.
  preset:  z.union([PRESET_ENUM, z.null(), z.literal('')]).optional()
                                     .transform(v => (v === '' ? null : v ?? null)),
  isActive: z.boolean().optional()
});

const audienceSchema = z.object({
  zoneId:  z.union([z.number(), z.string()]).optional(),
  planId:  z.string().optional(),
  status:  z.enum(['ACTIVE', 'SUSPENDED', 'PENDING', 'INACTIVE']).optional(),
  overdue: z.boolean().optional(),
  // Explicit recipient selection from the UI checkboxes. When present it is
  // authoritative: the campaign goes ONLY to these clients (the zone/plan/
  // status filters were just used to build the candidate list). Omitted =
  // "todos los que coinciden con los filtros".
  clientIds: z.array(z.string().min(1)).optional()
});

const campaignSchema = z.object({
  name:       z.string().min(2),
  templateId: z.string().min(1, 'Selecciona una plantilla'),
  channel:    CHANNEL,
  generatePaymentLinks: z.boolean().optional().default(false),
  // 'draft' just persists the configuration (no send); 'launch' runs it now.
  mode:       z.enum(['draft', 'launch']).optional().default('launch'),
  audience:   audienceSchema.optional()
});

// Single-client send (campaign test from the modal + manual send from the
// client page). Reuses sendToClient — logged with campaignId=null so it never
// touches a campaign's counters.
const singleSendSchema = z.object({
  clientId:   z.string().min(1, 'Falta el cliente'),
  templateId: z.string().min(1, 'Selecciona una plantilla'),
  channel:    CHANNEL,
  generatePaymentLinks: z.boolean().optional().default(false)
});

// Build the Prisma `where` for an audience filter. Single source of truth for
// /campaigns (preflight), /campaigns/:id/launch and the diagnose re-resolve.
function audienceWhere(audience) {
  const where = {};
  if (audience?.clientIds?.length) where.id = { in: audience.clientIds };
  if (audience?.zoneId)  where.zoneId  = Number(audience.zoneId);
  if (audience?.planId)  where.planId  = audience.planId;
  if (audience?.status)  where.status  = audience.status;
  if (audience?.overdue) where.invoices = { some: { status: 'OVERDUE' } };
  return where;
}

// Validate a template can be used for the requested channel. Returns
// { tpl } on success or { error } with a human message.
async function resolveTemplateOrError(templateId, channel) {
  const tpl = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!tpl) return { error: 'Plantilla no encontrada' };
  if (!tpl.isActive) return { error: 'La plantilla está inactiva' };
  if (channel !== 'BOTH' && channel !== tpl.channel) {
    return { error: `La plantilla "${tpl.name}" es para ${tpl.channel}; no puedes enviarla por ${channel}.` };
  }
  return { tpl };
}

// ════════════════════════════════════════════════════════════
// TEMPLATES
// ════════════════════════════════════════════════════════════

router.get('/templates', async (req, res) => {
  try {
    const items = await prisma.notificationTemplate.findMany({
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }]
    });
    res.json({ success: true, data: items });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Live branded preview for the template editor. Renders {preset, subject, body}
// with sample data through the SAME renderEmailTemplate the system uses to send,
// so "lo que ves es lo que llega". No DB writes. Mirrors sendEmail(): the header
// H1 is the preset title; the operator body is the email body; the subject is
// the inbox subject line (returned separately).
router.post('/templates/preview', (req, res) => {
  try {
    const { preset, subject, body } = req.body || {};
    const meta = (preset && EMAIL_PRESETS[preset]) || EMAIL_PRESETS.general_announcement;
    const renderedSubject = fillSampleVars(subject) || meta.title;
    const cta = (preset === 'invoice' || preset === 'reminder')
      ? { text: 'Pagar ahora', url: '#' } : undefined;
    const html = renderEmailTemplate({
      icon:  meta.icon,
      title: meta.title,
      body:  fillSampleVars(body) || 'Escribe el cuerpo del mensaje para ver la vista previa…',
      cta
    });
    res.json({ success: true, data: { html, subject: renderedSubject } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/templates', validateBody(templateSchema), async (req, res) => {
  try {
    const created = await prisma.notificationTemplate.create({ data: req.body });
    res.status(201).json({ success: true, data: created });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.put('/templates/:id', validateBody(templateSchema.partial()), async (req, res) => {
  try {
    const updated = await prisma.notificationTemplate.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json({ success: true, data: updated });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    // Hard delete — the FK from NotificationCampaign.templateId has
    // ON DELETE SET NULL, so historical campaigns keep their content
    // (subject + body live on the delivery logs) but lose the link.
    await prisma.notificationTemplate.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    // P2025 = record not found — treat as success (idempotent)
    if (e.code === 'P2025') return res.json({ success: true });
    res.status(400).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════

router.get('/campaigns', async (req, res) => {
  try {
    const items = await prisma.notificationCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { template: { select: { id: true, name: true, channel: true } } }
    });
    res.json({ success: true, data: items });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const c = await prisma.notificationCampaign.findUnique({
      where: { id: req.params.id },
      include: { template: true }
    });
    if (!c) return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    res.json({ success: true, data: c });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Audience preview — returns the COUNT of clients matched by the filter
// without persisting anything. Used by the campaign form before sending.
router.post('/campaigns/preview-audience', async (req, res) => {
  try {
    const f = req.body || {};
    const where = {};
    if (f.zoneId)  where.zoneId  = Number(f.zoneId);
    if (f.planId)  where.planId  = f.planId;
    if (f.status)  where.status  = f.status;
    if (f.overdue) where.invoices = { some: { status: 'OVERDUE' } };
    const count = await prisma.client.count({ where });
    res.json({ success: true, data: { count } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Same filter as preview-audience but returns the actual list (up to 200)
// so the operator can review WHO will receive the campaign before launching.
router.post('/campaigns/preview-clients', async (req, res) => {
  try {
    const f = req.body || {};
    const where = {};
    if (f.zoneId)  where.zoneId  = Number(f.zoneId);
    if (f.planId)  where.planId  = f.planId;
    if (f.status)  where.status  = f.status;
    if (f.overdue) where.invoices = { some: { status: 'OVERDUE' } };

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
        take: 200,
        select: {
          id: true, name: true, email: true, phone: true, status: true,
          zone: { select: { name: true } },
          plan: { select: { name: true } },
          // Oldest open invoice — EXACTLY the one the campaign runner charges
          // when "Generar links de pago" is on (same filter + same ordering as
          // notification.campaign.service clientVars/createForInvoice), so the
          // operator sees in the UI precisely what each client will be billed.
          invoices: {
            where: { status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } },
            orderBy: { dueDate: 'asc' },
            take: 1,
            select: { invoiceNumber: true, balanceDue: true, total: true, amount: true, dueDate: true, status: true }
          }
        }
      }),
      prisma.client.count({ where })
    ]);
    res.json({ success: true, data: { clients, total, truncated: total > 200 } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Fire-and-forget launch of an already-persisted campaign row. Errors inside
// runCampaign update the row with status=failed + detailed logs.
function fireCampaign(id) {
  runCampaign(id).catch(async (e) => {
    console.error(`[campaign ${id}] runner crashed:`, e);
    await prisma.notificationCampaign.update({
      where: { id },
      data: { status: 'failed', finishedAt: new Date() }
    }).catch(() => {});
  });
}

// Create a campaign. mode='draft' saves the configuration WITHOUT sending
// (status=draft); mode='launch' (default) runs it immediately in the
// background and the frontend polls /campaigns/:id for progress.
router.post('/campaigns', validateBody(campaignSchema), async (req, res) => {
  try {
    const { name, templateId, channel, generatePaymentLinks, audience, mode } = req.body;
    const isDraft = mode === 'draft';

    const { error } = await resolveTemplateOrError(templateId, channel);
    if (error) return res.status(400).json({ success: false, error });

    // Pre-flight only matters when sending now: a draft can be saved with an
    // empty/partial audience and refined later. A launch with 0 recipients
    // silently "completes" without logs, so reject it early.
    if (!isDraft) {
      const audienceCount = await prisma.client.count({ where: audienceWhere(audience) });
      if (audienceCount === 0) {
        return res.status(400).json({
          success: false,
          error: 'La audiencia está vacía: ningún cliente coincide con los filtros seleccionados. Ajusta los filtros antes de lanzar.'
        });
      }
    }

    const created = await prisma.notificationCampaign.create({
      data: {
        name,
        templateId,
        channel,
        generatePaymentLinks,
        audienceJson: audience ? JSON.stringify(audience) : null,
        status: isDraft ? 'draft' : 'running',
        startedAt: isDraft ? null : new Date(),
        createdBy: req.user?.id || null
      }
    });

    if (!isDraft) fireCampaign(created.id);

    res.status(isDraft ? 201 : 202).json({ success: true, data: created });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Update a DRAFT campaign's configuration. Sent campaigns are immutable
// history — the UI clones them into a new draft instead of editing in place.
router.put('/campaigns/:id', validateBody(campaignSchema.partial()), async (req, res) => {
  try {
    const existing = await prisma.notificationCampaign.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    if (existing.status !== 'draft') {
      return res.status(409).json({
        success: false,
        error: 'Solo puedes editar campañas en borrador. Las campañas enviadas son historial; clónala en un borrador nuevo para reutilizar su configuración.'
      });
    }

    const { name, templateId, channel, generatePaymentLinks, audience } = req.body;

    // If template or channel changes, re-validate compatibility.
    if (templateId !== undefined || channel !== undefined) {
      const tId = templateId ?? existing.templateId;
      const ch  = channel ?? existing.channel;
      if (tId) {
        const { error } = await resolveTemplateOrError(tId, ch);
        if (error) return res.status(400).json({ success: false, error });
      }
    }

    const data = {};
    if (name       !== undefined) data.name       = name;
    if (templateId !== undefined) data.templateId = templateId;
    if (channel    !== undefined) data.channel    = channel;
    if (generatePaymentLinks !== undefined) data.generatePaymentLinks = generatePaymentLinks;
    if (audience   !== undefined) data.audienceJson = audience ? JSON.stringify(audience) : null;

    const updated = await prisma.notificationCampaign.update({
      where: { id: req.params.id },
      data
    });
    res.json({ success: true, data: updated });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Launch a draft campaign. Validates template + audience, flips it to running
// and fires the background runner. Only drafts can be launched.
router.post('/campaigns/:id/launch', async (req, res) => {
  try {
    const c = await prisma.notificationCampaign.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    if (c.status === 'running') {
      return res.status(409).json({ success: false, error: 'La campaña ya está en ejecución.' });
    }
    if (c.status !== 'draft') {
      return res.status(409).json({ success: false, error: 'Solo se pueden lanzar campañas en borrador. Usa "Reenviar" para repetir una campaña ya enviada.' });
    }
    if (!c.templateId) {
      return res.status(400).json({ success: false, error: 'La campaña no tiene plantilla asociada.' });
    }
    const { error } = await resolveTemplateOrError(c.templateId, c.channel);
    if (error) return res.status(400).json({ success: false, error });

    let audience = {};
    try { audience = c.audienceJson ? JSON.parse(c.audienceJson) : {}; } catch { audience = {}; }
    const audienceCount = await prisma.client.count({ where: audienceWhere(audience) });
    if (audienceCount === 0) {
      return res.status(400).json({
        success: false,
        error: 'La audiencia está vacía: ningún cliente coincide con los filtros. Ajusta la audiencia antes de lanzar.'
      });
    }

    const updated = await prisma.notificationCampaign.update({
      where: { id: c.id },
      data: { status: 'running', startedAt: new Date(), finishedAt: null, sentCount: 0, failedCount: 0 }
    });
    fireCampaign(c.id);
    res.status(202).json({ success: true, data: updated });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Send a single test/manual delivery to ONE client using a template. Used by
// the campaign modal's "Enviar prueba" and (via the same service) the client
// page. Logged with campaignId=null so it doesn't affect campaign counters.
router.post('/campaigns/test', validateBody(singleSendSchema), async (req, res) => {
  try {
    const { clientId, templateId, channel, generatePaymentLinks } = req.body;
    const { tpl, error } = await resolveTemplateOrError(templateId, channel);
    if (error) return res.status(400).json({ success: false, error });

    const client = await loadClientForSend(clientId);
    if (!client) return res.status(404).json({ success: false, error: 'Cliente no encontrado' });

    const result = await sendToClient({
      client, template: tpl, channel, generatePaymentLinks, campaignId: null
    });
    res.json({
      success: true,
      data: { ...result, client: { id: client.id, name: client.name, email: client.email, phone: client.phone } }
    });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Diagnostic — returns everything needed to debug why a campaign behaved
// as it did: row state, parsed audience filter, re-resolved audience size,
// SMTP source in use right now, and the last 50 delivery logs for this id.
router.get('/campaigns/:id/diagnose', async (req, res) => {
  try {
    const campaign = await prisma.notificationCampaign.findUnique({
      where: { id: req.params.id },
      include: { template: { select: { id: true, name: true, channel: true, isActive: true } } }
    });
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaña no encontrada' });

    let audienceFilter = {};
    try { audienceFilter = campaign.audienceJson ? JSON.parse(campaign.audienceJson) : {}; }
    catch (e) { audienceFilter = { _parseError: e.message }; }

    // Re-resolve the audience right now (might differ from launch time if
    // clients were added/removed since).
    let currentAudienceCount = 0;
    try {
      const where = {};
      if (audienceFilter.zoneId)  where.zoneId  = Number(audienceFilter.zoneId);
      if (audienceFilter.planId)  where.planId  = audienceFilter.planId;
      if (audienceFilter.status)  where.status  = audienceFilter.status;
      if (audienceFilter.overdue) where.invoices = { some: { status: 'OVERDUE' } };
      currentAudienceCount = await prisma.client.count({ where });
    } catch { currentAudienceCount = -1; }

    // Active SMTP config (without password).
    const smtp = await prisma.smtpConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, host: true, port: true, secure: true, username: true,
        fromEmail: true, fromName: true, isVerified: true, lastTestedAt: true, lastTestResult: true
      }
    });

    // Same manual-join pattern as /history — no formal client relation.
    const rawLogs = await prisma.notificationLog.findMany({
      where: { campaignId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const cIds = [...new Set(rawLogs.map(l => l.clientId).filter(Boolean))];
    const clientNames = cIds.length === 0 ? [] : await prisma.client.findMany({
      where: { id: { in: cIds } },
      select: { id: true, name: true }
    });
    const nameById = new Map(clientNames.map(c => [c.id, c]));
    const logs = rawLogs.map(l => ({
      ...l,
      client: l.clientId ? (nameById.get(l.clientId) || null) : null
    }));

    const logSummary = {
      total: logs.length,
      sent:   logs.filter(l => l.status === 'sent').length,
      failed: logs.filter(l => l.status === 'failed').length,
      systemFailures: logs.filter(l => l.clientId === null).length
    };

    res.json({
      success: true,
      data: {
        campaign,
        audienceFilter,
        currentAudienceCount,
        smtpSource: smtp ? 'DB' : 'ENV',
        smtp,
        logs,
        logSummary
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/campaigns/:id/retry', async (req, res) => {
  try {
    const c = await prisma.notificationCampaign.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    if (c.status === 'running') {
      return res.status(409).json({ success: false, error: 'La campaña aún está en ejecución.' });
    }
    const result = await retryFailed(req.params.id);
    res.json({ success: true, data: result });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Delete a campaign. Its delivery logs survive (NotificationLog.campaign is
// onDelete: SetNull) so the send history stays auditable in the History tab.
// Running campaigns can't be deleted — the background runner still updates the
// row mid-flight; wait for it to finish (or for the stale sweep to fail it).
router.delete('/campaigns/:id', async (req, res) => {
  try {
    const c = await prisma.notificationCampaign.findUnique({ where: { id: req.params.id } });
    if (!c) return res.json({ success: true }); // already gone — idempotent
    if (c.status === 'running') {
      return res.status(409).json({ success: false, error: 'La campaña está en ejecución; espera a que termine para eliminarla.' });
    }
    await prisma.notificationCampaign.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// HISTORY (deliveries)
// ════════════════════════════════════════════════════════════

// Delete a single delivery log
router.delete('/history/:id', async (req, res) => {
  try {
    await prisma.notificationLog.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.json({ success: true });
    res.status(400).json({ success: false, error: e.message });
  }
});

// Bulk delete delivery logs — honors the same filters as GET /history.
// Without filters wipes the entire history (UI confirms aggressively).
router.delete('/history', async (req, res) => {
  try {
    const { campaignId, status, channel } = req.query;
    const where = {};
    if (campaignId) where.campaignId = campaignId;
    if (status)     where.status     = status;
    if (channel)    where.channel    = channel;
    const result = await prisma.notificationLog.deleteMany({ where });
    res.json({ success: true, data: { deleted: result.count } });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.get('/history', async (req, res) => {
  try {
    const { campaignId, status, channel, limit = 100 } = req.query;
    const where = {};
    if (campaignId) where.campaignId = campaignId;
    if (status)     where.status     = status;
    if (channel)    where.channel    = channel;
    // NotificationLog has no formal `client` Prisma relation (just a
    // String? FK column), so `include: { client }` would error. We pull
    // client names separately and join in memory — fast enough for the
    // 500-row cap and avoids a schema migration.
    const items = await prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      include: { campaign: { select: { id: true, name: true } } }
    });
    const clientIds = [...new Set(items.map(i => i.clientId).filter(Boolean))];
    const clients = clientIds.length === 0 ? [] : await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true }
    });
    const clientById = new Map(clients.map(c => [c.id, c]));
    const enriched = items.map(i => ({
      ...i,
      client: i.clientId ? (clientById.get(i.clientId) || null) : null
    }));
    res.json({ success: true, data: enriched });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;
