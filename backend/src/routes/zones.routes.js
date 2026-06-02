import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { validateBody } from '../middleware/validate.middleware.js';

const router = Router();

const zoneSchema = z.object({
  name:        z.string().min(1, 'Nombre requerido'),
  description: z.string().nullish(),
  color:       z.string().nullish(),
  routerId:    z.union([z.number().int().positive(), z.null()]).optional()
});

// Map the validated body to Prisma's `data` shape. We use the relation
// syntax `router: { connect | disconnect }` (canonical for relations) rather
// than setting the FK column directly, so renames of the FK don't break us.
function toPrismaData(body) {
  const { name, description, color, routerId } = body;
  const data = {};
  if (name        !== undefined) data.name        = name;
  if (description !== undefined) data.description = description ?? null;
  if (color       !== undefined) data.color       = color ?? null;
  if (routerId    !== undefined) {
    data.router = routerId == null
      ? { disconnect: true }
      : { connect: { id: routerId } };
  }
  return data;
}

// Translate Prisma errors into actionable messages. The "Unknown argument"
// case usually means the generated client is stale — flag it explicitly so
// the operator knows to run `prisma generate`.
function prismaErrorMessage(e) {
  const m = e?.message || '';
  if (/Unknown argument `?routerId`?|Unknown argument `?router`?/.test(m)) {
    return 'Cliente Prisma desactualizado. Ejecuta `npx prisma migrate dev && npx prisma generate` en el backend.';
  }
  if (/Foreign key constraint|P2003/.test(m)) {
    return 'El router seleccionado no existe o fue eliminado.';
  }
  if (/Unique constraint|P2002/.test(m)) {
    return 'Ya existe una zona con ese nombre.';
  }
  return 'No se pudo guardar la zona. Verifica el router seleccionado e inténtalo de nuevo.';
}

// GET all zones (with client count). Use ?withRouter=true to only return
// zones that already have a router assigned (used by the new-client wizard).
router.get('/', async (req, res) => {
  try {
    const where = req.query.withRouter === 'true' ? { routerId: { not: null } } : {};
    const zones = await prisma.zone.findMany({
      where,
      include: {
        _count: { select: { clients: true } },
        router: {
          select: {
            id:     true,
            name:   true,
            status: true,
            // Routes ordered by priority so the UI can pull routes[0].ip as
            // the primary uplink without sorting client-side.
            routes: {
              select:  { id: true, ip: true, priority: true, status: true },
              orderBy: { priority: 'asc' }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });
    res.json({
      success: true,
      data: zones.map(z => ({ ...z, clientCount: z._count.clients }))
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST create zone
router.post('/', validateBody(zoneSchema), async (req, res) => {
  try {
    if (req.body.routerId != null) {
      const r = await prisma.router.findUnique({ where: { id: req.body.routerId } });
      if (!r) {
        return res.status(400).json({
          success: false,
          error: 'El router seleccionado no existe.'
        });
      }
    }
    const zone = await prisma.zone.create({
      data: toPrismaData(req.body),
      include: { router: {
          select: {
            id:     true,
            name:   true,
            status: true,
            // Routes ordered by priority so the UI can pull routes[0].ip as
            // the primary uplink without sorting client-side.
            routes: {
              select:  { id: true, ip: true, priority: true, status: true },
              orderBy: { priority: 'asc' }
            }
          }
        } }
    });
    res.status(201).json({ success: true, data: zone });
  } catch (e) {
    console.error('[zones.create] failed:', e);
    res.status(400).json({ success: false, error: prismaErrorMessage(e) });
  }
});

// PUT update zone
router.put('/:id', validateBody(zoneSchema.partial()), async (req, res) => {
  try {
    if (req.body.routerId != null) {
      const r = await prisma.router.findUnique({ where: { id: req.body.routerId } });
      if (!r) {
        return res.status(400).json({
          success: false,
          error: 'El router seleccionado no existe.'
        });
      }
    }
    const zone = await prisma.zone.update({
      where: { id: Number(req.params.id) },
      data: toPrismaData(req.body),
      include: { router: {
          select: {
            id:     true,
            name:   true,
            status: true,
            // Routes ordered by priority so the UI can pull routes[0].ip as
            // the primary uplink without sorting client-side.
            routes: {
              select:  { id: true, ip: true, priority: true, status: true },
              orderBy: { priority: 'asc' }
            }
          }
        } }
    });
    res.json({ success: true, data: zone });
  } catch (e) {
    console.error('[zones.update] failed:', e);
    res.status(400).json({ success: false, error: prismaErrorMessage(e) });
  }
});

// DELETE zone
router.delete('/:id', async (req, res) => {
  try {
    await prisma.zone.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
