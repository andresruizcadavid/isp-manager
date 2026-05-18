// Network Monitor REST API.
//
// Devices: CRUD + drag-update (PATCH position) + manual probe.
// Connections: create / delete edges between devices.
// Events: list with filters (deviceId, zoneId, status, from, to) + CSV export.
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../server.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { runSweep } from '../services/network-monitor.service.js';

const router = Router();

// ── Validation ────────────────────────────────────────────
const DEVICE_TYPES = ['ROUTER', 'ANTENNA', 'SWITCH', 'ONT', 'SERVER', 'OTHER'];
// Accept any valid IPv4 — we don't enforce ranges, ISPs see anything.
const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;

const deviceCreateSchema = z.object({
  name:   z.string().min(1, 'Nombre requerido'),
  ip:     z.string().regex(ipRegex, 'IP inválida'),
  type:   z.enum(DEVICE_TYPES).default('OTHER'),
  zoneId: z.union([z.number().int().positive(), z.null()]).optional(),
  posX:   z.number().default(0),
  posY:   z.number().default(0),
  notes:  z.string().nullish()
});
const deviceUpdateSchema = deviceCreateSchema.partial();
const positionSchema = z.object({
  posX: z.number(),
  posY: z.number()
});
const connectionSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  label:    z.string().nullish()
});

// ── Devices ───────────────────────────────────────────────
router.get('/devices', async (_req, res) => {
  const devices = await prisma.networkDevice.findMany({
    include: { zone: { select: { id: true, name: true, color: true } } },
    orderBy: { createdAt: 'asc' }
  });
  res.json({ success: true, data: devices });
});

router.get('/devices/:id', async (req, res) => {
  try {
    const device = await prisma.networkDevice.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        zone: { select: { id: true, name: true, color: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 20 }
      }
    });
    res.json({ success: true, data: device });
  } catch {
    res.status(404).json({ success: false, error: 'Dispositivo no encontrado' });
  }
});

router.post('/devices', validateBody(deviceCreateSchema), async (req, res) => {
  try {
    const created = await prisma.networkDevice.create({ data: req.body });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put('/devices/:id', validateBody(deviceUpdateSchema), async (req, res) => {
  try {
    const updated = await prisma.networkDevice.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// Lightweight endpoint used by drag-end on the canvas — avoids resending the
// whole node payload on every cursor move.
router.patch('/devices/:id/position', validateBody(positionSchema), async (req, res) => {
  try {
    const updated = await prisma.networkDevice.update({
      where: { id: req.params.id },
      data: { posX: req.body.posX, posY: req.body.posY },
      select: { id: true, posX: true, posY: true }
    });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete('/devices/:id', async (req, res) => {
  try {
    await prisma.networkDevice.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Connections ───────────────────────────────────────────
router.get('/connections', async (_req, res) => {
  const conns = await prisma.networkConnection.findMany({
    orderBy: { createdAt: 'asc' }
  });
  res.json({ success: true, data: conns });
});

router.post('/connections', validateBody(connectionSchema), async (req, res) => {
  const { sourceId, targetId, label } = req.body;
  if (sourceId === targetId) {
    return res.status(400).json({ success: false, error: 'No se puede conectar un dispositivo consigo mismo.' });
  }
  try {
    const created = await prisma.networkConnection.create({
      data: { sourceId, targetId, label: label ?? null }
    });
    res.status(201).json({ success: true, data: created });
  } catch (e) {
    // Unique pair violation
    if (/Unique constraint/.test(e.message)) {
      return res.status(409).json({ success: false, error: 'Ya existe una conexión entre estos dispositivos.' });
    }
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete('/connections/:id', async (req, res) => {
  try {
    await prisma.networkConnection.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Manual probe (force a sweep now) ──────────────────────
router.post('/probe', async (_req, res) => {
  try {
    const summary = await runSweep();
    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Events (history) ──────────────────────────────────────
function buildEventWhere(q) {
  const where = {};
  if (q.deviceId) where.deviceId = String(q.deviceId);
  if (q.status)   where.status   = String(q.status);
  if (q.zoneId)   where.device   = { zoneId: Number(q.zoneId) };
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(q.from);
    if (q.to)   where.createdAt.lte = new Date(q.to);
  }
  return where;
}

router.get('/events', async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 100, 500);
  const where = buildEventWhere(req.query);
  const events = await prisma.networkEvent.findMany({
    where,
    include: {
      device: {
        select: {
          id: true, name: true, ip: true, type: true,
          zone: { select: { id: true, name: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take
  });
  res.json({ success: true, data: events });
});

router.get('/events.csv', async (req, res) => {
  const where = buildEventWhere(req.query);
  const events = await prisma.networkEvent.findMany({
    where,
    include: { device: { select: { name: true, ip: true, zone: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 5000
  });

  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'Fecha,Dispositivo,IP,Zona,Estado,Latencia (ms),Pérdida (%),Mensaje,Notificado\n';
  const rows = events.map(e => [
    new Date(e.createdAt).toISOString(),
    e.device?.name ?? '',
    e.device?.ip ?? '',
    e.device?.zone?.name ?? '',
    e.status,
    e.latency ?? '',
    e.loss ?? '',
    e.message ?? '',
    e.notified ? 'sí' : 'no'
  ].map(esc).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="network-events-${Date.now()}.csv"`);
  res.send(header + rows);
});

export default router;
