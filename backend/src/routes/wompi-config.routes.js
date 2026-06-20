import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authMiddleware, requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { wompiService as WompiSDK } from '../services/wompi.service.js';

const router = Router();

const createSchema = z.object({
  publicKey:    z.string().min(1, 'publicKey requerido'),
  privateKey:   z.string().min(1, 'privateKey requerido'),
  eventsKey:    z.string().min(1, 'eventsKey requerido'),
  integrityKey: z.string().min(1, 'integrityKey requerido'),
  environment:  z.enum(['production', 'sandbox']).optional(),
});

const updateSchema = createSchema.extend({
  publicKey:    z.string().optional(),
  privateKey:   z.string().optional(),
  eventsKey:    z.string().optional(),
  integrityKey: z.string().optional(),
});

const PUBLIC_FIELDS = {
  id: true, isActive: true, isVerified: true, environment: true,
  publicKey: true, lastTestedAt: true, lastTestResult: true,
  createdAt: true, updatedAt: true
};

// GET — current active config (without private/events/integrity keys)
router.get('/', async (req, res) => {
  try {
    const config = await prisma.wompiConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_FIELDS
    });
    res.json({ success: true, data: config || null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST — create a new active config (deactivates any previous one)
router.post('/', validateBody(createSchema), async (req, res) => {
  try {
    await prisma.wompiConfig.updateMany({
      where: { isActive: true },
      data:  { isActive: false }
    });
    const created = await prisma.wompiConfig.create({
      data: {
        publicKey:    req.body.publicKey,
        privateKey:   req.body.privateKey,
        eventsKey:    req.body.eventsKey,
        integrityKey: req.body.integrityKey,
        environment:  req.body.environment || 'production',
        isActive:     true,
        isVerified:   false,
      },
      select: { ...PUBLIC_FIELDS, privateKey: true, eventsKey: true, integrityKey: true }
    });
    WompiSDK.loadConfigFromDb().catch(e => console.warn('[wompi-config] reload failed:', e.message));
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    console.error('[wompi-config.create] failed:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT — update existing config. Empty fields keep current values.
router.put('/:id', validateBody(updateSchema), async (req, res) => {
  try {
    const existing = await prisma.wompiConfig.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ success: false, error: 'Config no encontrada' });

    const connChanged = !!(req.body.publicKey || req.body.privateKey || req.body.eventsKey || req.body.integrityKey);
    const data = { isVerified: connChanged ? false : existing.isVerified };

    if (req.body.publicKey)    data.publicKey    = req.body.publicKey;
    if (req.body.privateKey)   data.privateKey   = req.body.privateKey;
    if (req.body.eventsKey)    data.eventsKey    = req.body.eventsKey;
    if (req.body.integrityKey) data.integrityKey = req.body.integrityKey;
    if (req.body.environment)  data.environment  = req.body.environment;

    const updated = await prisma.wompiConfig.update({
      where: { id: req.params.id },
      data,
      select: { ...PUBLIC_FIELDS, privateKey: true, eventsKey: true, integrityKey: true }
    });
    WompiSDK.loadConfigFromDb().catch(e => console.warn('[wompi-config] reload failed:', e.message));
    res.json({ success: true, data: updated });
  } catch (e) {
    console.error('[wompi-config.update] failed:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /test — verify Wompi keys by calling the merchant info endpoint
router.post('/test', async (req, res) => {
  const body = req.body || {};
  try {
    let { publicKey, privateKey, eventsKey, integrityKey, configId } = body;

    if (configId && (!privateKey || privateKey.trim() === '')) {
      const existing = await prisma.wompiConfig.findUnique({ where: { id: configId } });
      if (existing) {
        privateKey   = privateKey   || existing.privateKey;
        publicKey    = publicKey    || existing.publicKey;
        eventsKey    = eventsKey    || existing.eventsKey;
        integrityKey = integrityKey || existing.integrityKey;
      }
    }

    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'privateKey requerido para probar.' });
    }

    // Test auth by creating a minimal payment link. Wompi private-key auth
    // works for POST endpoints; GET endpoints need a merchant-scoped token
    // that not all accounts have.
    //
    // CRITICAL: snapshot the live singleton before swapping in the keys under
    // test, and ALWAYS restore it afterwards. Otherwise a test would leave the
    // in-memory keys (and base URL) pointing at the candidate config — breaking
    // live checkouts and, worse, webhook signature verification (which reads
    // this.eventsKey synchronously without reloading from the DB).
    const snapshot = {
      baseURL:      WompiSDK.baseURL,
      publicKey:    WompiSDK.publicKey,
      privateKey:   WompiSDK.privateKey,
      eventsKey:    WompiSDK.eventsKey,
      integrityKey: WompiSDK.integrityKey
    };
    try {
      WompiSDK.privateKey   = privateKey;
      WompiSDK.publicKey    = publicKey  || WompiSDK.publicKey;
      WompiSDK.eventsKey    = eventsKey  || WompiSDK.eventsKey;
      WompiSDK.integrityKey = integrityKey || WompiSDK.integrityKey;
      WompiSDK.baseURL      = WompiSDK.resolveBaseURL(body.environment, privateKey);

      await WompiSDK.createRawPaymentLink({
        name: 'Prueba de configuración',
        description: 'Verificación de credenciales Wompi',
        amount_in_cents: 150000,
        currency: 'COP',
        single_use: true,
        collect_shipping: false,
      });
    } finally {
      Object.assign(WompiSDK, snapshot);
    }

    if (configId) {
      await prisma.wompiConfig.update({
        where: { id: configId },
        data: {
          isVerified: true,
          lastTestedAt: new Date(),
          lastTestResult: `Éxito · credenciales Wompi válidas`
        }
      });
    }

    res.json({
      success: true,
      data: { message: 'Configuración Wompi verificada correctamente' }
    });
  } catch (e) {
    console.error('[wompi-config.test] failed:', e.message);
    const msg = e?.response?.data?.error?.reason || e?.message || 'Error desconocido';
    if (body?.configId) {
      try {
        await prisma.wompiConfig.update({
          where: { id: body.configId },
          data: {
            isVerified: false,
            lastTestedAt: new Date(),
            lastTestResult: `Error · ${msg.slice(0, 240)}`
          }
        });
      } catch { /* ignore */ }
    }
    res.status(400).json({ success: false, error: `Error Wompi: ${msg}` });
  }
});

export default router;
