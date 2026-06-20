import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';

const router = Router();

// ── Image upload (same pattern as evidence photos) ──────────────────
const inventoryDir = path.resolve(env.UPLOADS_PATH, 'inventory');
fs.mkdirSync(inventoryDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, inventoryDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}_${crypto.randomBytes(10).toString('hex')}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(ALLOWED_MIME.has(file.mimetype) ? null : new Error('INVALID_MIME'), ALLOWED_MIME.has(file.mimetype))
});

// ── Role gate ───────────────────────────────────────────────────────
// READS open to operational tier (technicians look up stock / what a client
// has). WRITES on the CATALOG are admin-only; assigning items to a client is
// operational (field work). Enforced per-route below.
const isAdminTier = (req) => ['ADMIN', 'OPERATOR'].includes(req.user?.role);
const requireAdminWrite = (req, res, next) => isAdminTier(req) ? next() : requireAdmin(req, res, next);

// ════════════════════════════════════════════════════════════
// PRODUCTS (catalog)
// ════════════════════════════════════════════════════════════
router.get('/products', async (req, res) => {
  try {
    const products = await prisma.inventoryProduct.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } }
    });
    res.json({ success: true, data: products });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

const productSchema = z.object({
  name:        z.string().min(2, 'El nombre es obligatorio'),
  category:    z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imageUrl:    z.string().optional().nullable(),
  isActive:    z.boolean().optional()
});

router.post('/products', requireAdminWrite, validateBody(productSchema), async (req, res) => {
  try {
    const product = await prisma.inventoryProduct.create({ data: req.body });
    res.status(201).json({ success: true, data: product });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.put('/products/:id', requireAdminWrite, validateBody(productSchema.partial()), async (req, res) => {
  try {
    const product = await prisma.inventoryProduct.update({ where: { id: req.params.id }, data: req.body });
    res.json({ success: true, data: product });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/products/:id', requireAdminWrite, async (req, res) => {
  try {
    const count = await prisma.inventoryItem.count({ where: { productId: req.params.id } });
    if (count > 0) {
      return res.status(409).json({ success: false, error: `No se puede eliminar: hay ${count} unidad(es) de este producto. Desactívalo en su lugar.` });
    }
    await prisma.inventoryProduct.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.json({ success: true });
    res.status(400).json({ success: false, error: e.message });
  }
});

// Image upload for a product — returns the stored URL the form then saves.
router.post('/products/upload-image', requireAdminWrite, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió imagen' });
    res.json({ success: true, data: { imageUrl: `/uploads/inventory/${path.basename(req.file.path)}` } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// ITEMS (physical units, with serial — assignable to clients)
// ════════════════════════════════════════════════════════════
const ITEM_INCLUDE = {
  product: { select: { id: true, name: true, category: true, imageUrl: true } },
  client:  { select: { id: true, name: true } }
};

// Items for a specific client (used by the client detail panel).
router.get('/items', async (req, res) => {
  try {
    const where = {};
    if (req.query.clientId) where.clientId = String(req.query.clientId);
    if (req.query.status)   where.status   = String(req.query.status);
    if (req.query.unassigned === 'true') where.clientId = null;
    const items = await prisma.inventoryItem.findMany({
      where, include: ITEM_INCLUDE, orderBy: { assignedAt: 'desc' }
    });
    res.json({ success: true, data: items });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

const itemSchema = z.object({
  productId: z.string().min(1, 'Selecciona un producto'),
  serial:    z.string().trim().optional().nullable(),
  clientId:  z.string().optional().nullable(),
  status:    z.enum(['IN_STOCK', 'ASSIGNED', 'RETURNED', 'FAULTY']).optional(),
  notes:     z.string().optional().nullable()
});

// Assigning/creating an item is operational (technicians do it on site).
router.post('/items', validateBody(itemSchema), async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.serial === '') data.serial = null;
    // Default status follows assignment: with a client → ASSIGNED, else IN_STOCK.
    if (!data.status) data.status = data.clientId ? 'ASSIGNED' : 'IN_STOCK';
    const item = await prisma.inventoryItem.create({ data, include: ITEM_INCLUDE });
    res.status(201).json({ success: true, data: item });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ success: false, error: 'Ese serial ya está registrado en otro equipo.' });
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put('/items/:id', validateBody(itemSchema.partial()), async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.serial === '') data.serial = null;
    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data, include: ITEM_INCLUDE });
    res.json({ success: true, data: item });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ success: false, error: 'Ese serial ya está registrado en otro equipo.' });
    res.status(400).json({ success: false, error: e.message });
  }
});

// Unassign (return to stock) — keeps history of the unit, just frees the client.
router.post('/items/:id/unassign', async (req, res) => {
  try {
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: { clientId: null, status: 'RETURNED' },
      include: ITEM_INCLUDE
    });
    res.json({ success: true, data: item });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/items/:id', async (req, res) => {
  try {
    await prisma.inventoryItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.json({ success: true });
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
