// Auto-collection cron — once per hour (minute 5 to avoid colliding with
// the hourly :00 housekeeping). Looks for an active CollectionWindow at
// `now` and runs one tick of the campaign against current debtors.
//
// Stateless / idempotent: a tick that finds no active window is a no-op,
// and `runCollectionTick` itself respects per-client sendFrequencyHours
// to avoid double-sending.

import cron from 'node-cron';
import { runCollectionTick } from '../services/auto-collection.service.js';

class AutoCollectionJob {
  constructor() {
    this.isRunning = false;
    this.setupSchedules();
  }

  setupSchedules() {
    cron.schedule('5 * * * *', async () => {
      if (this.isRunning) return; // overlap guard
      this.isRunning = true;
      try {
        const r = await runCollectionTick();
        if (r.windowId) {
          console.log('🔔 auto-collection tick:', r);
        }
      } catch (e) {
        console.error('❌ auto-collection tick failed:', e.message);
      } finally {
        this.isRunning = false;
      }
    });
    console.log('📅 Auto-collection job scheduled (hourly @ :05)');
  }
}

export const autoCollectionJob = new AutoCollectionJob();
