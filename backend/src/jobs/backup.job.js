// Backup cron — once per minute, look at active schedules whose
// nextRunAt has passed and fire a backup for each. Per-router mutex
// (in-memory Set) prevents two ticks from racing on the same router if
// a backup runs longer than 60s.

import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { runBackup } from '../services/backup.service.js';
import { dueSchedules, computeNextRun } from '../services/backup-schedule.service.js';

class BackupJob {
  constructor() {
    this.running = new Set(); // routerIds currently running
    cron.schedule('* * * * *', () => this.tick());
    console.log('📅 Backup job scheduled (every minute)');
  }

  async tick() {
    let due;
    try {
      due = await dueSchedules();
    } catch (e) {
      console.error('❌ backup tick: dueSchedules failed:', e.message);
      return;
    }
    for (const sched of due) {
      if (this.running.has(sched.routerId)) continue;
      this.running.add(sched.routerId);
      // Move nextRunAt forward FIRST so even on crash we don't loop.
      const next = computeNextRun(sched.cronExpression, new Date());
      await prisma.routerBackupSchedule.update({
        where: { id: sched.id },
        data:  { lastRunAt: new Date(), nextRunAt: next }
      }).catch(() => {});
      // Fire-and-forget; backup duration can exceed 60s, we don't want
      // to block the tick. Errors are persisted on the RouterBackup row.
      runBackup(sched.routerId, { triggeredBy: 'cron' })
        .catch(e => console.error(`❌ cron backup router ${sched.routerId} failed:`, e.message))
        .finally(() => this.running.delete(sched.routerId));
    }
  }
}

export const backupJob = new BackupJob();
