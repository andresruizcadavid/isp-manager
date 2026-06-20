import cron from 'node-cron';
import { notificationService } from '../services/notification.service.js';
// IMPORTANT: do NOT import the legacy `mikrotikService` proxy — it throws
// at first use ("deprecado"). Use the per-router factory instead so the
// suspension goes to the router actually assigned to the client's zone.
import { getMikrotikServiceForClient } from '../services/mikrotik.service.js';
import { prisma } from '../config/database.js';
// Removed SystemConfig imports — the auto-suspend keys they served were
// deleted along with the bulk suspension code (manual suspension only).

class OverdueJob {
  constructor() {
    this.isRunning = false;
    this.setupSchedules();
  }

  setupSchedules() {
    // POLICY: NO AUTO-SUSPENSIONS. Per the operator's standing directive,
    // suspending a client's service is a MANUAL action only — never on a
    // schedule, never gated by a flag that could be flipped by accident.
    // We deliberately do NOT register an auto-suspend cron here. The
    // `suspendClient` method below still exists because it's invoked from
    // the UI ("Suspender" button on /clients/[id]); it must never be
    // wired to a cron in this file.

    // Auto-reactivation IS allowed: when a customer pays, restoring service
    // promptly is desirable and reversible. The scheduled check looks for
    // SUSPENDED clients whose invoices are now all paid and reactivates them.
    cron.schedule('0 10 * * *', async () => {
      console.log('🔄 Starting reactivation check job...');
      await this.checkReactivations();
    });

    // Send final warnings - Run daily at 6:00 PM
    cron.schedule('0 18 * * *', async () => {
      console.log('🔄 Starting final warnings job...');
      await this.sendFinalWarnings();
    });

    // Clean up old notification logs - Run weekly on Sunday at 2:00 AM
    cron.schedule('0 2 * * 0', async () => {
      console.log('🔄 Starting notification logs cleanup job...');
      await this.cleanupNotificationLogs();
    });

    console.log('📅 Overdue jobs scheduled successfully');
  }

  // NOTE: a previous version had `checkSuspensions()` and `suspendClient()`
  // that bulk-suspended overdue clients on a schedule. They were removed
  // per operator policy: suspension is a manual action only and lives in
  // `clientController.suspendService` (POST /clients/:id/suspend). Do NOT
  // restore them without an explicit policy change.

  async checkReactivations() {
    if (this.isRunning) {
      console.log('⚠️ Reactivation check already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Get suspended clients with all invoices paid
      const suspendedClients = await prisma.client.findMany({
        where: { status: 'SUSPENDED' }
      });

      let reactivatedCount = 0;
      let failedCount = 0;

      for (const client of suspendedClients) {
        try {
          // Check if all invoices are paid
          const unpaidInvoices = await prisma.invoice.count({
            where: {
              clientId: client.id,
              status: { in: ['PENDING', 'OVERDUE'] }
            }
          });

          if (unpaidInvoices === 0) {
            // Reactivate client service
            await this.reactivateClient(client);
            reactivatedCount++;
          }
        } catch (error) {
          console.error(`Error reactivating client ${client.id}:`, error);
          failedCount++;
        }
      }

      console.log(`✅ Reactivation check completed:`, {
        reactivated: reactivatedCount,
        failed: failedCount,
        total: suspendedClients.length,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error in reactivation check:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async sendFinalWarnings() {
    if (this.isRunning) {
      console.log('⚠️ Final warnings already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Get invoices overdue by 25+ days (5 days before suspension)
      const twentyFiveDaysAgo = new Date();
      twentyFiveDaysAgo.setDate(twentyFiveDaysAgo.getDate() - 25);

      const finalWarningInvoices = await prisma.invoice.findMany({
        where: {
          status: { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: twentyFiveDaysAgo }
        },
        include: {
          client: true,
          plan: true
        }
      });

      let sentCount = 0;
      let failedCount = 0;

      for (const invoice of finalWarningInvoices) {
        try {
          // Check if final warning was already sent
          const recentWarnings = await prisma.notificationLog.findMany({
            where: {
              clientId: invoice.clientId,
              type: 'PAYMENT_REMINDER',
              createdAt: {
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
              }
            }
          });

          if (recentWarnings.length === 0) {
            await this.sendFinalWarning(invoice);
            sentCount++;
          }
        } catch (error) {
          console.error(`Error sending final warning for invoice ${invoice.id}:`, error);
          failedCount++;
        }
      }

      console.log(`✅ Final warnings completed:`, {
        sent: sentCount,
        failed: failedCount,
        total: finalWarningInvoices.length,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error sending final warnings:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Auto-reactivation: when a suspended client's invoices are all paid,
  // we flip Client.status back to ACTIVE and re-enable the PPPoE secret on
  // the router. The PPPoE username and router are read from MikrotikAccount;
  // the `getMikrotikServiceForClient` factory returns `{ service, account }`
  // — destructure correctly.
  //
  // MikroTik failure is non-fatal for the DB transition: we still flip
  // Client.status so the UI is consistent, and we log the MikroTik error
  // to the NotificationLog so the operator can retry from the UI.
  async reactivateClient(client) {
    await prisma.client.update({
      where: { id: client.id },
      data:  { status: 'ACTIVE' }
    });

    const mkAccount = await prisma.mikrotikAccount.findUnique({
      where:  { clientId: client.id },
      select: { username: true }
    });

    if (mkAccount?.username) {
      try {
        const { service } = await getMikrotikServiceForClient(client.id);
        await service.reactivatePPPoE(mkAccount.username);
        console.log(`✅ Reactivated PPPoE secret "${mkAccount.username}" on router for client ${client.name}`);
      } catch (mikrotikError) {
        console.error(`[overdue] MikroTik reactivate failed for ${client.id}:`, mikrotikError.message);
        await this.logReactivation(client.id, 'AUTOMATIC',
          `DB reactivated OK; MikroTik error: ${mikrotikError.message}`);
      }
    }

    try { await notificationService.sendServiceActivation(client); }
    catch (e) { console.error('Reactivation notification failed:', e.message); }

    await this.logReactivation(client.id, 'AUTOMATIC', 'All invoices paid');
    console.log(`✅ Client ${client.name} (ID: ${client.id}) reactivated automatically`);
  }

  async sendFinalWarning(invoice) {
    const daysOverdue = Math.floor((new Date() - invoice.dueDate) / (1000 * 60 * 60 * 24));
    
    // Send email with final warning
    await notificationService.sendEmail({
      to: invoice.client.email,
      subject: `⚠️ ÚLTIMO AVISO - Suspensión Inminente - ${invoice.invoiceNumber}`,
      template: 'final_warning',
      data: {
        invoice,
        client: invoice.client,
        daysOverdue,
        suspensionDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        company: {
          name: process.env.COMPANY_NAME || 'Mi ISP',
          phone: process.env.COMPANY_PHONE || '+57 2 555 1234',
          email: process.env.COMPANY_EMAIL || 'contacto@miisp.com'
        }
      }
    });

    // Send SMS final warning
    if (invoice.client.phone) {
      await notificationService.sendSMS({
        to: invoice.client.phone,
        message: `⚠️ ${process.env.COMPANY_NAME}: ULTIMO AVISO! Su servicio sera suspendido en 5 dias por falta de pago. Factura ${invoice.invoiceNumber} vencida hace ${daysOverdue} dias. Pague ahora!`
      });
    }

    // Send WhatsApp final warning
    if (invoice.client.phone) {
      await notificationService.sendWhatsApp({
        to: invoice.client.phone,
        message: this.buildFinalWarningMessage(invoice, daysOverdue)
      });
    }

    // Log the final warning
    await notificationService.logNotification(
      invoice.clientId,
      'PAYMENT_REMINDER',
      'EMAIL',
      `Último aviso - Factura ${invoice.invoiceNumber}`
    );

    console.log(`⚠️ Final warning sent for invoice ${invoice.invoiceNumber}`);
  }

  buildFinalWarningMessage(invoice, daysOverdue) {
    return `⚠️ *${process.env.COMPANY_NAME}* - ÚLTIMO AVISO DE SUSPENSIÓN

Estimado/a ${invoice.client.name},

🚨 **ATENCIÓN:** Su servicio será suspendido en 5 días

📄 Detalles de la deuda:
• Factura: ${invoice.invoiceNumber}
• Dias vencida: ${daysOverdue} días
• Monto: $${(invoice.amount / 100).toLocaleString('es-CO')} COP
• Plan: ${invoice.plan.name}

📅 **Fecha de suspensión:** ${new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString()}

💳 **Pague inmediatamente para evitar la suspensión:**
• Transferencia bancaria
• Pago en línea (Wompi)
• Pago presencial

📞 **Contacto urgente:** ${process.env.COMPANY_PHONE}

⚠️ Si su servicio es suspendido, deberá pagar una tarifa de reconexión.

¡NO IGNORE ESTE MENSAJE!`;
  }

  async logSuspension(clientId, reason, details) {
    try {
      await prisma.notificationLog.create({
        data: {
          clientId,
          type: 'SERVICE_SUSPENSION',
          channel: 'SYSTEM',
          recipient: '—', // internal audit event, no contact recipient
          content: `Client suspended: ${reason} - ${details}`,
          status: 'SENT',
          sentAt: new Date()
        }
      });
    } catch (error) {
      console.error('Error logging suspension:', error);
    }
  }

  async logReactivation(clientId, reason, details) {
    try {
      await prisma.notificationLog.create({
        data: {
          clientId,
          type: 'SERVICE_ACTIVATION',
          channel: 'SYSTEM',
          recipient: '—', // internal audit event, no contact recipient
          content: `Client reactivated: ${reason} - ${details}`,
          status: 'SENT',
          sentAt: new Date()
        }
      });
    } catch (error) {
      console.error('Error logging reactivation:', error);
    }
  }

  async cleanupNotificationLogs() {
    const startTime = Date.now();

    try {
      // Delete notification logs older than 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const result = await prisma.notificationLog.deleteMany({
        where: {
          createdAt: {
            lt: ninetyDaysAgo
          }
        }
      });

      console.log(`✅ Notification logs cleanup completed:`, {
        deletedCount: result.count,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error cleaning up notification logs:', error);
    }
  }

  // Manual trigger methods for testing/admin purposes. NOTE:
  // `triggerSuspensionCheck` was removed alongside `checkSuspensions` —
  // bulk suspension is forbidden by policy. Per-client suspension is
  // exposed via POST /clients/:id/suspend.
  async triggerReactivationCheck() {
    console.log('🔧 Manually triggering reactivation check...');
    await this.checkReactivations();
  }

  async triggerFinalWarnings() {
    console.log('🔧 Manually triggering final warnings...');
    await this.sendFinalWarnings();
  }

  async triggerCleanup() {
    console.log('🔧 Manually triggering notification logs cleanup...');
    await this.cleanupNotificationLogs();
  }

  // Status methods
  isJobRunning() {
    return this.isRunning;
  }

  getJobStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRunTime,
      nextRun: this.getNextRunTime()
    };
  }

  getNextRunTime() {
    // Only the schedules actually registered in setupSchedules(). There is
    // intentionally NO suspensionCheck — auto-suspension was removed per the
    // operator's manual-only policy.
    const nextRuns = {
      reactivationCheck: this.getNextCronRun('0 10 * * *'),
      finalWarnings: this.getNextCronRun('0 18 * * *'),
      cleanup: this.getNextCronRun('0 2 * * 0')
    };

    return nextRuns;
  }

  getNextCronRun(cronExpression) {
    const now = new Date();
    const nextRun = new Date(now);
    
    if (cronExpression === '0 10 * * *') {
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(10, 0, 0, 0);
    } else if (cronExpression === '0 18 * * *') {
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(18, 0, 0, 0);
    } else if (cronExpression === '0 2 * * 0') {
      // Next Sunday
      const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
      nextRun.setDate(nextRun.getDate() + daysUntilSunday);
      nextRun.setHours(2, 0, 0, 0);
    }

    return nextRun;
  }

  // Analytics methods
  async getSuspensionStats(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [suspendedCount, reactivatedCount, totalOverdue] = await Promise.all([
        prisma.client.count({
          where: {
            status: 'SUSPENDED',
            updatedAt: {
              gte: startDate
            }
          }
        }),
        prisma.notificationLog.count({
          where: {
            type: 'SERVICE_ACTIVATION',
            channel: 'SYSTEM',
            createdAt: {
              gte: startDate
            }
          }
        }),
        prisma.invoice.count({
          where: {
            status: { in: ['PENDING', 'OVERDUE'] },
            dueDate: {
              lt: new Date()
            }
          }
        })
      ]);

      return {
        period: `Last ${days} days`,
        suspended: suspendedCount,
        reactivated: reactivatedCount,
        currentlyOverdue: totalOverdue,
        suspensionRate: totalOverdue > 0 ? (suspendedCount / totalOverdue) * 100 : 0
      };
    } catch (error) {
      console.error('Error getting suspension stats:', error);
      throw error;
    }
  }

  async getOverdueAging() {
    try {
      const ranges = [
        { name: '1-15 días', start: 1, end: 15 },
        { name: '16-30 días', start: 16, end: 30 },
        { name: '31-60 días', start: 31, end: 60 },
        { name: '60+ días', start: 61, end: 365 }
      ];

      const now = new Date();
      const agingData = await Promise.all(
        ranges.map(async (range) => {
          const startDate = new Date(now);
          startDate.setDate(startDate.getDate() - range.end);
          
          const endDate = new Date(now);
          endDate.setDate(endDate.getDate() - range.start + 1);

          const data = await prisma.invoice.groupBy({
            by: ['clientId'],
            where: {
              status: { in: ['PENDING', 'OVERDUE'] },
              dueDate: {
                gte: startDate,
                lt: endDate
              }
            }
          });

          const totalAmount = await prisma.invoice.aggregate({
            where: {
              status: { in: ['PENDING', 'OVERDUE'] },
              dueDate: {
                gte: startDate,
                lt: endDate
              }
            },
            _sum: { amount: true }
          });

          return {
            range: range.name,
            clientCount: data.length,
            totalAmount: totalAmount._sum.amount || 0
          };
        })
      );

      return agingData;
    } catch (error) {
      console.error('Error getting overdue aging:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
export const overdueJob = new OverdueJob();
