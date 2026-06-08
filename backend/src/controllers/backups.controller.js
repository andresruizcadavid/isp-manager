import { asyncHandler, AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';
import { runBackup, deleteBackup, openBackupFile, rotateBackups } from '../services/backup.service.js';
import {
  listSchedules, getSchedule, upsertSchedule, deleteSchedule, computeNextRun
} from '../services/backup-schedule.service.js';

export const backupsController = {
  // GET /backups
  list: asyncHandler(async (req, res) => {
    const routerId = req.query.routerId ? Number(req.query.routerId) : null;
    const where = routerId ? { routerId } : {};
    const rows = await prisma.routerBackup.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 200,
      include: {
        router:   { select: { id: true, name: true } },
        createdBy:{ select: { id: true, name: true, email: true } }
      }
    });
    res.json({ success: true, data: rows });
  }),

  get: asyncHandler(async (req, res) => {
    const row = await prisma.routerBackup.findUnique({
      where: { id: req.params.id },
      include: { router: true }
    });
    if (!row) throw new AppError('Backup no encontrado', 404, 'BACKUP_NOT_FOUND');
    res.json({ success: true, data: row });
  }),

  // POST /backups/run/:routerId — trigger immediate backup.
  run: asyncHandler(async (req, res) => {
    const routerId = Number(req.params.routerId);
    if (!routerId) throw new AppError('routerId inválido', 400);
    // Fire-and-await: backup is sync from the operator's POV. The UI
    // shows a loader and the result row in one response.
    try {
      const row = await runBackup(routerId, { triggeredBy: 'manual', userId: req.user?.id });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(502).json({ success: false, error: { code: 'BACKUP_FAILED', message: e.message } });
    }
  }),

  // GET /backups/:id/download — stream the .rsc file.
  download: asyncHandler(async (req, res) => {
    const { stream, size, fileName } = await openBackupFile(req.params.id);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    stream.pipe(res);
  }),

  delete: asyncHandler(async (req, res) => {
    await deleteBackup(req.params.id);
    res.json({ success: true });
  }),

  // POST /backups/rotate/:routerId — manual cleanup (admin tool).
  rotate: asyncHandler(async (req, res) => {
    const count = await rotateBackups(Number(req.params.routerId));
    res.json({ success: true, data: { removed: count } });
  }),

  // ── Schedules ──────────────────────────────────────────
  listSchedules: asyncHandler(async (_req, res) => {
    const rows = await listSchedules();
    res.json({ success: true, data: rows });
  }),

  getSchedule: asyncHandler(async (req, res) => {
    const sched = await getSchedule(Number(req.params.routerId));
    res.json({ success: true, data: sched });
  }),

  upsertSchedule: asyncHandler(async (req, res) => {
    const routerId = Number(req.params.routerId);
    const patch = req.body || {};
    // Validate the cron expression by computing the next run; reject if null.
    if (patch.cronExpression && !computeNextRun(patch.cronExpression)) {
      throw new AppError('Expresión cron inválida', 400, 'INVALID_CRON');
    }
    const sched = await upsertSchedule(routerId, patch);
    res.json({ success: true, data: sched });
  }),

  deleteSchedule: asyncHandler(async (req, res) => {
    await deleteSchedule(Number(req.params.routerId));
    res.json({ success: true });
  })
};
