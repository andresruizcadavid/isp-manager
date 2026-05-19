// WhatsApp Cloud API config & webhook endpoints.
//
// Two flavours of routes here, mounted under /api/v1/whatsapp:
//   • Auth'd (admin):  GET / PUT /  →  one-row config (token, phoneId, etc.)
//                      POST /test    →  fire a test template to a phone
//   • Public webhook:  GET  /webhook → Meta's hub.challenge handshake
//                      POST /webhook → status callbacks + inbound messages
//
// The webhook MUST be public (no Authorization header) because Meta calls
// it from the outside. We protect it instead with hub.verify_token check
// and signature verification.
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../server.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { sendTest, verifyWebhook, handleWebhook } from '../services/whatsapp.service.js';

// Two routers exported separately:
//   default       → admin CRUD/test (mount behind authMiddleware+requireAdmin)
//   webhookRouter → Meta callbacks (mount PUBLIC, no auth)
const router = Router();
export const webhookRouter = Router();

const configSchema = z.object({
  token:             z.string().min(20, 'Token inválido'),
  phoneId:           z.string().min(5, 'phoneId requerido'),
  businessAccountId: z.string().nullish(),
  displayName:       z.string().nullish(),
  defaultLanguage:   z.string().default('es_CO'),
  isActive:          z.boolean().default(true)
});

// ── Config CRUD (admin) ────────────────────────────────────
router.get('/', async (_req, res) => {
  const cfg = await prisma.whatsAppConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
  res.json({ success: true, data: cfg });
});

router.put('/', validateBody(configSchema), async (req, res) => {
  try {
    const existing = await prisma.whatsAppConfig.findFirst();
    const data = req.body;
    const saved = existing
      ? await prisma.whatsAppConfig.update({ where: { id: existing.id }, data })
      : await prisma.whatsAppConfig.create({ data });
    res.json({ success: true, data: saved });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Test send ──────────────────────────────────────────────
// Body: { token, phoneId, recipient, templateName?, language? }
// Defaults to Meta's built-in "hello_world" template (en_US) which exists
// for every fresh account and lets the operator verify creds without
// approving anything.
router.post('/test', async (req, res) => {
  const { token, phoneId, recipient, templateName, language } = req.body || {};
  if (!token || !phoneId || !recipient) {
    return res.status(400).json({ success: false, error: 'token, phoneId y recipient requeridos' });
  }
  const result = await sendTest({ token, phoneId, recipient, templateName, language });

  // Persist test result on the active row so the UI shows last status.
  const existing = await prisma.whatsAppConfig.findFirst();
  if (existing) {
    await prisma.whatsAppConfig.update({
      where: { id: existing.id },
      data: {
        lastTestedAt:   new Date(),
        lastTestResult: result.ok ? 'success' : `error: ${result.error}`
      }
    });
  }
  if (!result.ok) {
    return res.status(502).json({ success: false, error: result.error, code: result.code });
  }
  res.json({ success: true, data: result.data });
});

// ── Webhook (public, no auth) ──────────────────────────────
// Meta calls this with ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// during setup. We expect the verify token in env WHATSAPP_VERIFY_TOKEN
// (operator sets it once, and pastes the same value into Meta's UI).
webhookRouter.get('/', async (req, res) => {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || '';
  if (!expected) return res.sendStatus(403);
  const challenge = verifyWebhook(req.query, expected);
  if (challenge === null) return res.sendStatus(403);
  res.status(200).send(challenge);
});

webhookRouter.post('/', async (req, res) => {
  // ACK immediately so Meta doesn't retry; process in background.
  res.sendStatus(200);
  try {
    await handleWebhook(req.body);
  } catch (e) {
    console.error('[whatsapp.webhook]', e.message);
  }
});

export default router;
