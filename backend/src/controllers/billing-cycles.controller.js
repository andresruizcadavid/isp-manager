import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import {
  listCycles, getCycle, findActive, createCycle, updateCycle,
  activateCycle, closeCycle, deleteCycle, classifyClients
} from '../services/billing-cycle.service.js';

export const billingCyclesController = {
  list: asyncHandler(async (_req, res) => {
    const rows = await listCycles();
    const active = await findActive();
    res.json({ success: true, data: rows, meta: { activeCycleId: active?.id || null } });
  }),

  get: asyncHandler(async (req, res) => {
    const row = await getCycle(req.params.id);
    if (!row) throw new AppError('Ciclo no encontrado', 404, 'CYCLE_NOT_FOUND');
    res.json({ success: true, data: row });
  }),

  active: asyncHandler(async (_req, res) => {
    const row = await findActive();
    res.json({ success: true, data: row });
  }),

  create: asyncHandler(async (req, res) => {
    try {
      const row = await createCycle(req.body, req.user?.id || null);
      res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (String(e.message).includes('Unique constraint')) {
        throw new AppError('Ya existe un ciclo para ese mes/año', 409, 'CYCLE_DUPLICATE');
      }
      throw e;
    }
  }),

  update: asyncHandler(async (req, res) => {
    const row = await updateCycle(req.params.id, req.body);
    res.json({ success: true, data: row });
  }),

  activate: asyncHandler(async (req, res) => {
    const row = await activateCycle(req.params.id);
    res.json({ success: true, data: row });
  }),

  close: asyncHandler(async (req, res) => {
    const row = await closeCycle(req.params.id);
    res.json({ success: true, data: row });
  }),

  delete: asyncHandler(async (req, res) => {
    await deleteCycle(req.params.id);
    res.json({ success: true });
  }),

  impact: asyncHandler(async (req, res) => {
    // Default: solo totales + buckets ligeros. ?details=true devuelve los
    // arrays completos con id+name por bucket.
    const c = await classifyClients(req.params.id);
    if (!c) throw new AppError('Ciclo no encontrado', 404, 'CYCLE_NOT_FOUND');
    const wantDetails = req.query.details === 'true' || req.query.details === '1';
    if (!wantDetails) {
      const { buckets, ...lean } = c;
      return res.json({ success: true, data: lean });
    }
    res.json({ success: true, data: c });
  })
};
