// Backup schedule CRUD + nextRunAt helper. Used by the cron tick to
// decide which routers are due for a backup right now.

import { prisma } from '../config/database.js';
import { CronExpressionParser } from 'cron-parser';

/** Compute next run from a 5-field POSIX cron string. */
export function computeNextRun(cronExpression, from = new Date()) {
  try {
    return CronExpressionParser.parse(cronExpression, { currentDate: from }).next().toDate();
  } catch {
    return null;
  }
}

export async function getSchedule(routerId) {
  return prisma.routerBackupSchedule.findUnique({ where: { routerId } });
}

export async function listSchedules() {
  return prisma.routerBackupSchedule.findMany({
    include: { router: { select: { id: true, name: true } } }
  });
}

export async function upsertSchedule(routerId, patch) {
  const cronExpression  = patch.cronExpression || '0 3 * * *';
  const isActive        = patch.isActive ?? true;
  const retentionCount  = Math.max(1, Math.min(365, patch.retentionCount ?? 30));
  const nextRunAt       = isActive ? computeNextRun(cronExpression) : null;

  return prisma.routerBackupSchedule.upsert({
    where:  { routerId },
    update: { cronExpression, isActive, retentionCount, nextRunAt },
    create: { routerId, cronExpression, isActive, retentionCount, nextRunAt }
  });
}

export async function deleteSchedule(routerId) {
  return prisma.routerBackupSchedule.delete({ where: { routerId } }).catch(() => null);
}

/** Schedules whose nextRunAt has passed and that aren't currently running. */
export async function dueSchedules(now = new Date()) {
  return prisma.routerBackupSchedule.findMany({
    where: {
      isActive:  true,
      nextRunAt: { lte: now }
    }
  });
}
