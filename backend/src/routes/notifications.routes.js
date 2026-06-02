import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody, validateQuery } from '../middleware/validate.middleware.js';

const router = Router();

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

const campaignSchema = z.object({
  name:       z.string().min(2),
  templateId: z.string().min(1, 'Selecciona una plantilla'),
  channel:    CHANNEL,
  audience:   z.object({
    zoneId:  z.union([z.number(), z.string()]).optional(),
    planId:  z.string().optional(),
    status:  z.enum(['ACTIVE', 'SUSPENDED', 'PENDING', 'INACTIVE']).optional(),
    overdue: z.boolean().optional()
  }).optional()
});

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
          plan: { select: { name: true } }
        }
      }),
      prisma.client.count({ where })
    ]);
    res.json({ success: true, data: { clients, total, truncated: total > 200 } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// Create + launch campaign. The actual send happens in the background so the
// HTTP request returns immediately with the campaign record (status=running).
// The frontend polls /campaigns/:id to see progress.
router.post('/campaigns', validateBody(campaignSchema), async (req, res) => {
  try {
    const { name, templateId, channel, audience } = req.body;

    // Validate template exists and channel matches the template's channel
    // (when sending single-channel; "BOTH" requires the template to be EMAIL
    // or WHATSAPP and we just use it for both).
    const tpl = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
    if (!tpl) return res.status(400).json({ success: false, error: 'Plantilla no encontrada' });
    if (!tpl.isActive) return res.status(400).json({ success: false, error: 'La plantilla está inactiva' });
    if (channel !== 'BOTH' && channel !== tpl.channel) {
      return res.status(400).json({
        success: false,
        error: `La plantilla "${tpl.name}" es para ${tpl.channel}; no puedes enviarla por ${channel}.`
      });
    }

    // Pre-flight: verify the audience actually has people in it. A campaign
    // with 0 recipients silently "completes" without logs and confuses the
    // operator into thinking it failed. Reject early with a clear message.
    {
      const where = {};
      if (audience?.zoneId)  where.zoneId  = Number(audience.zoneId);
      if (audience?.planId)  where.planId  = audience.planId;
      if (audience?.status)  where.status  = audience.status;
      if (audience?.overdue) where.invoices = { some: { status: 'OVERDUE' } };
      const audienceCount = await prisma.client.count({ where });
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
        audienceJson: audience ? JSON.stringify(audience) : null,
        status: 'running',
        startedAt: new Date(),
        createdBy: req.user?.id || null
      }
    });

    // Fire and forget. Errors inside runCampaign update the campaign row
    // with status=failed and detailed logs — no rethrow needed here.
    runCampaign(created.id).catch(async (e) => {
      console.error(`[campaign ${created.id}] runner crashed:`, e);
      await prisma.notificationCampaign.update({
        where: { id: created.id },
        data: { status: 'failed', finishedAt: new Date() }
      }).catch(() => {});
    });

    res.status(202).json({ success: true, data: created });
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
