// Telegram bot configuration endpoints (Monitor de Red → Configuración).
//
// One active row at a time — same model as smtp_configs. The settings page
// reads/writes the row and can fire a test message before saving.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../server.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { sendTest } from '../services/telegram.service.js';

const router = Router();

// Polling param domains mirror the option lists on the settings page. Kept
// permissive (any positive int) so the UI can grow without a schema change.
const configSchema = z.object({
  botToken:         z.string().min(20, 'Token inválido'),
  chatId:           z.string().min(1, 'chat_id requerido'),
  isActive:         z.boolean().default(true),
  alertOnDown:      z.boolean().default(true),
  alertOnRecovery:  z.boolean().default(true),
  probeIntervalSec: z.number().int().min(1).max(3600).default(30),
  probeTimeoutSec:  z.number().int().min(1).max(60).default(5),
  probeDownCount:   z.number().int().min(1).max(20).default(2)
});

router.get('/', async (_req, res) => {
  const cfg = await prisma.telegramConfig.findFirst({
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ success: true, data: cfg });
});

router.put('/', validateBody(configSchema), async (req, res) => {
  try {
    // Upsert by "single row" pattern: if any row exists, update it; else create.
    const existing = await prisma.telegramConfig.findFirst();
    const data = req.body;

    let saved;
    if (existing) {
      saved = await prisma.telegramConfig.update({ where: { id: existing.id }, data });
    } else {
      saved = await prisma.telegramConfig.create({ data });
    }
    res.json({ success: true, data: saved });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.post('/test', async (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (!botToken || !chatId) {
    return res.status(400).json({ success: false, error: 'botToken y chatId requeridos' });
  }
  const result = await sendTest({ botToken, chatId });
  // Persist test result on the active row so the UI shows the last status.
  const existing = await prisma.telegramConfig.findFirst();
  if (existing) {
    await prisma.telegramConfig.update({
      where: { id: existing.id },
      data: {
        lastTestedAt:   new Date(),
        lastTestResult: result.ok ? 'success' : `error: ${result.error}`
      }
    });
  }
  if (!result.ok) return res.status(502).json({ success: false, error: result.error });
  res.json({ success: true });
});

export default router;
