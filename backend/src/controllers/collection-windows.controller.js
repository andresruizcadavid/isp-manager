import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import {
  listWindows, getWindow, createWindow, updateWindow, deleteWindow,
  findActiveNow, getWindowMetrics
} from '../services/collection-window.service.js';
import { runCollectionTick } from '../services/auto-collection.service.js';

export const collectionWindowsController = {
  list: asyncHandler(async (_req, res) => {
    const rows = await listWindows();
    const active = await findActiveNow();
    res.json({ success: true, data: rows, meta: { activeWindowId: active?.id || null } });
  }),

  get: asyncHandler(async (req, res) => {
    const row = await getWindow(req.params.id);
    if (!row) throw new AppError('Ventana no encontrada', 404, 'WINDOW_NOT_FOUND');
    res.json({ success: true, data: row });
  }),

  create: asyncHandler(async (req, res) => {
    const row = await createWindow(req.body, req.user?.id || null);
    res.status(201).json({ success: true, data: row });
  }),

  update: asyncHandler(async (req, res) => {
    const row = await updateWindow(req.params.id, req.body);
    res.json({ success: true, data: row });
  }),

  remove: asyncHandler(async (req, res) => {
    await deleteWindow(req.params.id);
    res.json({ success: true });
  }),

  // Manual trigger for testing — runs ONE pass of the auto-collection
  // sweep for the given window. Production normally relies on the cron.
  runNow: asyncHandler(async (req, res) => {
    const result = await runCollectionTick({ windowId: req.params.id, force: true });
    res.json({ success: true, data: result });
  }),

  metrics: asyncHandler(async (req, res) => {
    const m = await getWindowMetrics(req.params.id);
    if (!m) throw new AppError('Ventana no encontrada', 404, 'WINDOW_NOT_FOUND');
    res.json({ success: true, data: m });
  })
};
