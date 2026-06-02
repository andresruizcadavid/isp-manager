import cron from 'node-cron';
import { notificationService } from '../services/notification.service.js';
import { mikrotikService } from '../services/mikrotik.service.js';
import { prisma } from '../config/database.js';

class OverdueJob {
  constructor() {
    this.isRunning = false;
    this.setupSchedules();
  }

  setupSchedules() {
    // Suspension check disabled per requirement — suspension is manual only.
    // cron.schedule('0 8 * * *', async () => {
    //   console.log('🔄 Starting suspension check job...');
    //   await this.checkSuspensions();
    // });

    // Check for reactivations - Run daily at 10:00 AM
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

  async checkSuspensions() {
    if (this.isRunning) {
      console.log('⚠️ Suspension check already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Get clients with overdue invoices older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const overdueClients = await prisma.invoice.groupBy({
        by: ['clientId'],
        where: {
          status: { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: thirtyDaysAgo }
        }
      });

      let suspendedCount = 0;
      let failedCount = 0;

      for (const clientGroup of overdueClients) {
        try {
          const client = await prisma.client.findUnique({
            where: { id: clientGroup.clientId },
            include: { plan: true }
          });

          if (client && client.status === 'ACTIVE') {
            // Suspend client service
            await this.suspendClient(client);
            suspendedCount++;
          }
        } catch (error) {
          console.error(`Error suspending client ${clientGroup.clientId}:`, error);
          failedCount++;
        }
      }

      console.log(`✅ Suspension check completed:`, {
        suspended: suspendedCount,
        failed: failedCount,
        total: overdueClients.length,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error in suspension check:', error);
    } finally {
      this.isRunning = false;
    }
  }

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

  async suspendClient(client) {
    try {
      // Update client status in database
      await prisma.client.update({
        where: { id: client.id },
        data: { status: 'SUSPENDED' }
      });

      // Suspend in Mikrotik if configured
      if (client.mikrotikId) {
        try {
          await mikrotikService.suspendClient(client.mikrotikId);
        } catch (mikrotikError) {
          console.error(`Failed to suspend client ${client.id} in Mikrotik:`, mikrotikError);
        }
      }

      // Send suspension notification
      await notificationService.sendServiceSuspension(client);

      // Log the suspension
      await this.logSuspension(client.id, 'AUTOMATIC', 'Over 30 days overdue');

      console.log(`🔒 Client ${client.name} (ID: ${client.id}) suspended automatically`);

    } catch (error) {
      console.error(`Error suspending client ${client.id}:`, error);
      throw error;
    }
  }

  async reactivateClient(client) {
    try {
      // Update client status in database
      await prisma.client.update({
        where: { id: client.id },
        data: { status: 'ACTIVE' }
      });

      // Reactivate in Mikrotik if configured
      if (client.mikrotikId) {
        try {
          await mikrotikService.activateClient(client.mikrotikId);
        } catch (mikrotikError) {
          console.error(`Failed to reactivate client ${client.id} in Mikrotik:`, mikrotikError);
        }
      }

      // Send reactivation notification
      await notificationService.sendServiceActivation(client);

      // Log the reactivation
      await this.logReactivation(client.id, 'AUTOMATIC', 'All invoices paid');

      console.log(`✅ Client ${client.name} (ID: ${client.id}) reactivated automatically`);

    } catch (error) {
      console.error(`Error reactivating client ${client.id}:`, error);
      throw error;
    }
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

  // Manual trigger methods for testing/admin purposes
  async triggerSuspensionCheck() {
    console.log('🔧 Manually triggering suspension check...');
    await this.checkSuspensions();
  }

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
    const now = new Date();
    const nextRuns = {
      suspensionCheck: this.getNextCronRun('0 8 * * *'),
      reactivationCheck: this.getNextCronRun('0 10 * * *'),
      finalWarnings: this.getNextCronRun('0 18 * * *'),
      cleanup: this.getNextCronRun('0 2 * * 0')
    };

    return nextRuns;
  }

  getNextCronRun(cronExpression) {
    const now = new Date();
    const nextRun = new Date(now);
    
    if (cronExpression === '0 8 * * *') {
      nextRun.setDate(nextRun.getDate() + 1);
      nextRun.setHours(8, 0, 0, 0);
    } else if (cronExpression === '0 10 * * *') {
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
