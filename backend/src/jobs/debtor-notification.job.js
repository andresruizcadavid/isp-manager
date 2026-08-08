import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { notificationService } from '../services/notification.service.js';

class DebtorNotificationJob {
  constructor() {
    this.isRunning = false;
    this.setupSchedules();
  }

  setupSchedules() {
    // ═══════════════════════════════════════════════════════════
    // NOTIFICACIONES AUTOMÁTICAS DESHABILITADAS por solicitud del
    // operador (2026-06-09). No se envían recordatorios a deudores
    // hasta nuevo aviso.
    // ═══════════════════════════════════════════════════════════
    // Para re-activar: descomentar los cron.schedule de abajo
    // ═══════════════════════════════════════════════════════════

    // [NOTIF] Recordatorios a deudores — deshabilitados
    /*
    cron.schedule('0 10 * * *', async () => {
      if (process.env.REMINDERS_ENABLED !== 'true') {
        console.log('⏸️ Debtor reminders disabled (REMINDERS_ENABLED!=true), skipping');
        return;
      }
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

    cron.schedule('0 18 * * *', async () => {
      if (process.env.REMINDERS_ENABLED !== 'true') return;
      const today = new Date();
      const day = today.getDate();
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      if (day < 25) return;
      console.log(`🔄 Starting debtor notifications evening run (day ${day}/${lastDay})...`);
      await this.sendDebtorNotifications();
    });
    */

    console.log('📅 Debtor notification jobs — DESHABILITADOS');
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

          const success = await notificationService.sendPaymentReminder(invoice, 'DEBTOR');
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
