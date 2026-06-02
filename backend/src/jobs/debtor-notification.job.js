import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { notificationService } from '../services/notification.service.js';

class DebtorNotificationJob {
  constructor() {
    this.isRunning = false;
    this.setupSchedules();
  }

  setupSchedules() {
    // Run daily at 10:00 — only active from day 25 to end of month
    cron.schedule('0 10 * * *', async () => {
      const today = new Date();
      const day = today.getDate();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

      if (day < 25) {
        console.log(`📅 Debtor notification: day ${day} < 25, skipping (active from day 25 to ${lastDay})`);
        return;
      }

      console.log(`🔄 Starting debtor notifications (day ${day}/${lastDay})...`);
      await this.sendDebtorNotifications();
    });

    // Also run at 18:00 for extra reach during the window
    cron.schedule('0 18 * * *', async () => {
      const today = new Date();
      const day = today.getDate();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

      if (day < 25) return;

      console.log(`🔄 Starting debtor notifications evening run (day ${day}/${lastDay})...`);
      await this.sendDebtorNotifications();
    });

    console.log('📅 Debtor notification job scheduled (active day 25–EOM)');
  }

  async sendDebtorNotifications() {
    if (this.isRunning) {
      console.log('⚠️ Debtor notifications already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          status: { in: ['PENDING', 'OVERDUE'] }
        },
        include: {
          client: true,
          plan: true
        },
        orderBy: { clientId: 'asc' }
      });

      // Deduplicate by client — send one notification per client
      const seenClients = new Set();
      const uniqueDebtors = [];
      for (const inv of overdueInvoices) {
        if (!seenClients.has(inv.clientId)) {
          seenClients.add(inv.clientId);
          uniqueDebtors.push(inv);
        }
      }

      let sentCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const invoice of uniqueDebtors) {
        try {
          // Check if already notified today
          const alreadyNotified = await prisma.notificationLog.findFirst({
            where: {
              clientId: invoice.clientId,
              type: 'PAYMENT_REMINDER',
              createdAt: { gte: today }
            }
          });

          if (alreadyNotified) {
            skippedCount++;
            continue;
          }

          const success = await notificationService.sendPaymentReminder(invoice);
          if (success) {
            sentCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error(`Error notifying debtor ${invoice.clientId}:`, error);
          failedCount++;
        }
      }

      console.log(`✅ Debtor notifications completed:`, {
        sent: sentCount,
        skipped: skippedCount,
        failed: failedCount,
        totalUnique: uniqueDebtors.length,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error in debtor notifications:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Manual trigger for testing
  async triggerDebtorNotifications() {
    console.log('🔧 Manually triggering debtor notifications...');
    await this.sendDebtorNotifications();
  }
}

export const debtorNotificationJob = new DebtorNotificationJob();
