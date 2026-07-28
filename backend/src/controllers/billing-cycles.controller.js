import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import {
  listCycles, getCycle, findActive, createCycle, updateCycle,
  activateCycle, closeCycle, deleteCycle, classifyClients,
  getRule, saveRule, ensureCyclesFromRule
} from '../services/billing-cycle.service.js';
import { invoiceService } from '../services/invoice.service.js';

export const billingCyclesController = {
  list: asyncHandler(async (_req, res) => {
    const rows = await listCycles();
    const active = await findActive();
    res.json({ success: true, data: rows, meta: { activeCycleId: active?.id || null } });
  }),

  // ── Regla de ciclo recurrente ──────────────────────────────────────
  getRule: asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await getRule() });
  }),

  saveRule: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await saveRule(req.body) });
  }),

  // Materializa la regla en ciclos concretos (mes actual + próximos). No pisa
  // ciclos existentes. Idempotente: se puede llamar en cada carga de la página.
  ensureFromRule: asyncHandler(async (req, res) => {
    const monthsAhead = Number(req.body?.monthsAhead);
    const result = await ensureCyclesFromRule({
      monthsAhead: Number.isInteger(monthsAhead) ? Math.min(Math.max(monthsAhead, 0), 12) : 1,
      createdById: req.user?.id || null
    });
    res.json({ success: true, data: result });
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

  // Manual trigger: generate the invoices for this cycle on demand. Same
  // idempotent path the daily scheduler uses (clients with an invoice already
  // for the period are skipped). Lets the operator emit early or re-run safely.
  generateInvoices: asyncHandler(async (req, res) => {
    const cycle = await getCycle(req.params.id);
    if (!cycle) throw new AppError('Ciclo no encontrado', 404, 'CYCLE_NOT_FOUND');

    const results = await invoiceService.generateInvoicesForCycle(cycle);
    const skipped = results.failed.filter(f => /already exists/i.test(f.reason || '')).length;
    res.json({
      success: true,
      data: {
        period:  { year: cycle.year, month: cycle.month },
        created: results.successful.length,
        skipped,                                   // ya tenían factura del período
        failed:  results.failed.length - skipped,  // sin plan / monto inválido / error
        total:   results.total,
        details: results
      }
    });
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
