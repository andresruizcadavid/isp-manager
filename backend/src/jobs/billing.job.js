import cron from 'node-cron';
import { invoiceService } from '../services/invoice.service.js';
import { notificationService } from '../services/notification.service.js';
import { prisma } from '../config/database.js';
import { getValue } from '../services/system-config.service.js';

class BillingJob {
  constructor() {
    this.isRunning = false;
    this.setupSchedules();
  }

  setupSchedules() {
    // ═══════════════════════════════════════════════════════════
    // NOTIFICACIONES AUTOMÁTICAS DESHABILITADAS por solicitud del
    // operador (2026-06-09). No se envían recordatorios ni avisos
    // a clientes con facturas pendientes hasta nuevo aviso.
    // ═══════════════════════════════════════════════════════════
    // Para re-activar: descomentar las líneas marcadas con [NOTIF]
    // ═══════════════════════════════════════════════════════════

    // Generate invoices according to the ACTIVE billing cycle. Runs DAILY at
    // 2:00 AM but only generates once the cycle's collectionStart has arrived
    // (idempotent — see invoiceService.generateInvoicesForActiveCycle). This
    // replaces the old fixed "1st of the month" schedule so invoicing always
    // follows the operator-configured ciclo de cobro.
    // [NOTIF] Genera facturas Y envía notificación al cliente
    // cron.schedule('0 2 * * *', async () => {
    //   console.log('🔄 Revisando ciclo de cobro para generación automática de facturas...');
    //   await this.generateMonthlyInvoices();
    // });

    // Mark overdue invoices - Run daily at 1:00 AM
    // [NOTIF] Marca vencidas Y envía recordatorio
    // cron.schedule('0 1 * * *', async () => {
    //   console.log('🔄 Starting overdue invoices marking job...');
    //   await this.markOverdueInvoices();
    // });

    // Send payment reminders - Run daily at 9:00 AM and 6:00 PM
    // [NOTIF] Envía recordatorios de pago
    // cron.schedule('0 9 * * *', async () => {
    //   console.log('🔄 Starting morning payment reminders job...');
    //   await this.sendPaymentReminders();
    // });
    // cron.schedule('0 18 * * *', async () => {
    //   console.log('🔄 Starting evening payment reminders job...');
    //   await this.sendPaymentReminders();
    // });

    // Clean up old sessions - Run daily at 3:00 AM
    cron.schedule('0 3 * * *', async () => {
      console.log('🔄 Starting session cleanup job...');
      await this.cleanupOldSessions();
    });

    // Generación AUTOMÁTICA de facturas — corre a diario 04:00 pero solo actúa
    // si el operador la activó (SystemConfig `auto_invoice_generation`) y hoy es
    // el día configurado. Genera el mes en curso (idempotente, fechas a mediodía
    // UTC). NO suspende ni notifica — solo crea las facturas del período.
    cron.schedule('0 4 * * *', async () => {
      try {
        const cfg = await getValue('auto_invoice_generation');
        if (!cfg?.enabled) return;
        const now = new Date();
        if (now.getDate() !== (cfg.dayOfMonth || 1)) return;
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const issueDate = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
        const dueDate   = new Date(Date.UTC(year, month, 0, 12, 0, 0));
        console.log(`🧾 [auto-gen] Generando facturas de ${year}-${String(month).padStart(2, '0')}…`);
        const r = await invoiceService.generateMonthlyInvoices(new Date(year, month - 1, 1), { year, month, issueDate, dueDate });
        console.log(`🧾 [auto-gen] creadas=${r.successful.length} de ${r.total} (idempotente).`);
      } catch (e) {
        console.error('[auto-gen] error:', e.message);
      }
    });

    // Generate reports - Run monthly on last day at 11:00 PM
    // [NOTIF] Envía resumen mensual por email a admins
    // cron.schedule('0 23 * * *', async () => {
    //   const today = new Date();
    //   const tomorrow = new Date(today);
    //   tomorrow.setDate(tomorrow.getDate() + 1);
    //   if (tomorrow.getDate() === 1) {
    //     console.log('🔄 Starting monthly reports generation job...');
    //     await this.generateMonthlyReports();
    //   }
    // });

    // Send daily consolidated report to admins — runs at 8:00
    // [NOTIF] Envía reporte diario por email a admins
    // cron.schedule('0 8 * * *', async () => {
    //   console.log('🔄 Starting daily consolidated report email...');
    //   await this.sendDailyConsolidatedReport();
    // });

    console.log('📅 Billing jobs scheduled (notificaciones a clientes DESHABILITADAS)');
  }

  async generateMonthlyInvoices() {
    if (this.isRunning) {
      console.log('⚠️ Monthly invoice generation already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // Cycle-driven: only generates when there is an active cycle whose
      // collectionStart has arrived. issueDate/dueDate come from the cycle.
      const out = await invoiceService.generateInvoicesForActiveCycle();
      if (!out.ran) {
        console.log(
          out.reason === 'no_active_cycle'
            ? 'ℹ️ No hay ciclo de cobro activo — no se generan facturas automáticamente.'
            : `ℹ️ El ciclo ${out.cycle?.year}-${String(out.cycle?.month).padStart(2, '0')} aún no inicia cobro (collectionStart en el futuro). Sin generación hoy.`
        );
        return;
      }
      const results = out.results;
      console.log(`📅 Ciclo de cobro ${out.cycle.year}-${String(out.cycle.month).padStart(2, '0')} — generación automática de facturas`);

      console.log(`✅ Monthly invoice generation completed:`, {
        successful: results.successful.length,
        failed: results.failed.length,
        total: results.total,
        duration: `${Date.now() - startTime}ms`
      });

      // Send notifications for successful invoices
      for (const result of results.successful) {
        try {
          const invoice = await prisma.invoice.findUnique({
            where: { id: result.invoiceId },
            include: {
              client: true,
              plan: true
            }
          });

          if (invoice) {
            await notificationService.sendInvoiceNotification(invoice);
          }
        } catch (error) {
          console.error(`Error sending notification for invoice ${result.invoiceId}:`, error);
        }
      }

      // Log failed invoices for review
      if (results.failed.length > 0) {
        console.log('❌ Failed invoices:', results.failed);
      }

    } catch (error) {
      console.error('❌ Error in monthly invoice generation:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async markOverdueInvoices() {
    if (this.isRunning) {
      console.log('⚠️ Overdue invoices marking already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const result = await invoiceService.markInvoicesAsOverdue();
      
      console.log(`✅ Overdue invoices marking completed:`, {
        markedCount: result.count,
        duration: `${Date.now() - startTime}ms`
      });

      // Send notifications for newly overdue invoices
      if (result.count > 0) {
        const overdueInvoices = await invoiceService.getOverdueInvoices();
        
        for (const invoice of overdueInvoices) {
          try {
            await notificationService.sendPaymentReminder(invoice);
          } catch (error) {
            console.error(`Error sending overdue reminder for invoice ${invoice.id}:`, error);
          }
        }
      }

    } catch (error) {
      console.error('❌ Error marking overdue invoices:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async sendPaymentReminders() {
    if (this.isRunning) {
      console.log('⚠️ Payment reminders already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const overdueInvoices = await invoiceService.getOverdueInvoices();
      let sentCount = 0;
      let failedCount = 0;

      for (const invoice of overdueInvoices) {
        try {
          const success = await notificationService.sendPaymentReminder(invoice);
          if (success) {
            sentCount++;
          } else {
            failedCount++;
          }
        } catch (error) {
          console.error(`Error sending reminder for invoice ${invoice.id}:`, error);
          failedCount++;
        }
      }

      console.log(`✅ Payment reminders completed:`, {
        sent: sentCount,
        failed: failedCount,
        total: overdueInvoices.length,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error sending payment reminders:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async cleanupOldSessions() {
    const startTime = Date.now();

    try {
      // Delete sessions older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await prisma.session.deleteMany({
        where: {
          expiresAt: {
            lt: thirtyDaysAgo
          }
        }
      });

      console.log(`✅ Session cleanup completed:`, {
        deletedCount: result.count,
        duration: `${Date.now() - startTime}ms`
      });

    } catch (error) {
      console.error('❌ Error cleaning up old sessions:', error);
    }
  }

  async generateMonthlyReports() {
    if (this.isRunning) {
      console.log('⚠️ Monthly reports generation already running, skipping...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      lastMonth.setDate(1);
      
      const lastMonthEnd = new Date(lastMonth);
      lastMonthEnd.setMonth(lastMonthEnd.getMonth() + 1);
      lastMonthEnd.setDate(0);

      // Generate various reports
      const reports = await Promise.allSettled([
        this.generateRevenueReport(lastMonth, lastMonthEnd),
        this.generateClientReport(lastMonth, lastMonthEnd),
        this.generatePaymentReport(lastMonth, lastMonthEnd)
      ]);

      console.log(`✅ Monthly reports generation completed:`, {
        successful: reports.filter(r => r.status === 'fulfilled').length,
        failed: reports.filter(r => r.status === 'rejected').length,
        duration: `${Date.now() - startTime}ms`
      });

      // Send summary to admin
      await this.sendMonthlySummary(lastMonth, lastMonthEnd);

    } catch (error) {
      console.error('❌ Error generating monthly reports:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async generateRevenueReport(startDate, endDate) {
    const revenue = await prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      _sum: { amount: true },
      _count: true
    });

    const pending = await prisma.invoice.aggregate({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      _sum: { amount: true },
      _count: true
    });

    return {
      period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      revenue: revenue._sum.amount || 0,
      revenueCount: revenue._count,
      pending: pending._sum.amount || 0,
      pendingCount: pending._count
    };
  }

  async generateClientReport(startDate, endDate) {
    const [newClients, totalClients, activeClients] = await Promise.all([
      prisma.client.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        }
      }),
      prisma.client.count(),
      prisma.client.count({
        where: { status: 'ACTIVE' }
      })
    ]);

    const churnedClients = await prisma.client.count({
      where: {
        status: 'INACTIVE',
        updatedAt: {
          gte: startDate,
          lte: endDate
        }
      }
    });

    return {
      period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      newClients,
      totalClients,
      activeClients,
      churnedClients,
      churnRate: totalClients > 0 ? (churnedClients / totalClients) * 100 : 0
    };
  }

  async generatePaymentReport(startDate, endDate) {
    const payments = await prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: startDate,
          lte: endDate
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    const totalPayments = await prisma.payment.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: startDate,
          lte: endDate
        }
      },
      _sum: { amount: true },
      _count: true
    });

    return {
      period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      totalAmount: totalPayments._sum.amount || 0,
      totalCount: totalPayments._count,
      byMethod: payments
    };
  }

  async sendMonthlySummary(startDate, endDate) {
    try {
      // Get admin users
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN' }
      });

      if (adminUsers.length === 0) {
        console.log('No admin users found to send monthly summary');
        return;
      }

      // Generate summary data
      const [revenueReport, clientReport, paymentReport] = await Promise.all([
        this.generateRevenueReport(startDate, endDate),
        this.generateClientReport(startDate, endDate),
        this.generatePaymentReport(startDate, endDate)
      ]);

      const summary = {
        period: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        revenue: revenueReport,
        clients: clientReport,
        payments: paymentReport
      };

      // Send email to each admin
      for (const admin of adminUsers) {
        try {
          await notificationService.sendEmail({
            to: admin.email,
            subject: `Resumen Mensual - ${startDate.toLocaleDateString()}`,
            template: 'monthly_summary',
            data: {
              admin,
              summary,
              company: {
                name: process.env.COMPANY_NAME || 'Mi ISP',
                city: process.env.COMPANY_CITY || 'Jamundí'
              }
            }
          });

          console.log(`✅ Monthly summary sent to ${admin.email}`);
        } catch (error) {
          console.error(`Error sending monthly summary to ${admin.email}:`, error);
        }
      }

    } catch (error) {
      console.error('Error sending monthly summary:', error);
    }
  }

  async sendDailyConsolidatedReport() {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [payments, totalAgg, byMethod] = await Promise.all([
        prisma.payment.findMany({
          where: {
            status: 'COMPLETED',
            createdAt: { gte: yesterday, lt: today }
          },
          include: {
            invoice: { select: { invoiceNumber: true } },
            client: { select: { name: true } }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.payment.aggregate({
          where: {
            status: 'COMPLETED',
            createdAt: { gte: yesterday, lt: today }
          },
          _sum: { amount: true },
          _count: true
        }),
        prisma.payment.groupBy({
          by: ['method'],
          where: {
            status: 'COMPLETED',
            createdAt: { gte: yesterday, lt: today }
          },
          _count: true,
          _sum: { amount: true }
        })
      ]);

      if (payments.length === 0) {
        console.log('No payments yesterday, skipping daily report');
        return;
      }

      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN' }
      });

      if (adminUsers.length === 0) {
        console.log('No admin users found to send daily report');
        return;
      }

      const dateStr = yesterday.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
      const totalCop = `$${((totalAgg._sum.amount || 0) / 100).toLocaleString('es-CO')} COP`;
      const methodSummary = byMethod.map(m =>
        `• ${m.method}: ${m._count} pagos — $${((m._sum.amount || 0) / 100).toLocaleString('es-CO')}`
      ).join('\n');

      const paymentList = payments.map((p, i) =>
        `${i + 1}. ${p.client?.name || '—'} — Factura ${p.invoice?.invoiceNumber || '—'} — $${(p.amount / 100).toLocaleString('es-CO')} — ${p.method}`
      ).join('\n');

      const body = `Resumen de pagos del ${dateStr}

Total recaudado: ${totalCop}
Cantidad de pagos: ${totalAgg._count}

Desglose por método:
${methodSummary}

Detalle de pagos:
${paymentList}`;

      for (const admin of adminUsers) {
        try {
          await notificationService.sendEmailRaw({
            to: admin.email,
            subject: `📊 Reporte diario de pagos — ${dateStr}`,
            body,
            preset: 'general_announcement',
            title: `Reporte Diario — ${dateStr}`
          });
          console.log(`✅ Daily report sent to ${admin.email}`);
        } catch (error) {
          console.error(`Error sending daily report to ${admin.email}:`, error);
        }
      }
    } catch (error) {
      console.error('Error sending daily consolidated report:', error);
    }
  }

  // Manual trigger methods for testing/admin purposes
  async triggerMonthlyInvoices() {
    console.log('🔧 Manually triggering monthly invoice generation...');
    await this.generateMonthlyInvoices();
  }

  async triggerOverdueMarking() {
    console.log('🔧 Manually triggering overdue invoices marking...');
    await this.markOverdueInvoices();
  }

  async triggerPaymentReminders() {
    console.log('🔧 Manually triggering payment reminders...');
    await this.sendPaymentReminders();
  }

  async triggerMonthlyReports() {
    console.log('🔧 Manually triggering monthly reports...');
    await this.generateMonthlyReports();
  }

  async triggerDailyConsolidatedReport() {
    console.log('🔧 Manually triggering daily consolidated report...');
    await this.sendDailyConsolidatedReport();
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
      monthlyInvoices: this.getNextCronRun('0 2 1 * *'),
      overdueMarking: this.getNextCronRun('0 1 * * *'),
      morningReminders: this.getNextCronRun('0 9 * * *'),
      eveningReminders: this.getNextCronRun('0 18 * * *'),
      sessionCleanup: this.getNextCronRun('0 3 * * *')
    };

    return nextRuns;
  }

  getNextCronRun(cronExpression) {
    // This is a simplified implementation
    // In production, you might want to use a proper cron parser
    const now = new Date();
    const nextRun = new Date(now);
    
    // Simple logic for common cron patterns
    if (cronExpression === '0 2 1 * *') {
      // First day of next month at 2 AM
      nextRun.setMonth(nextRun.getMonth() + 1);
      nextRun.setDate(1);
      nextRun.setHours(2, 0, 0, 0);
    } else if (cronExpression.includes('* * *')) {
      // Daily jobs
      nextRun.setDate(nextRun.getDate() + 1);
      const hour = parseInt(cronExpression.split(' ')[1]);
      nextRun.setHours(hour, 0, 0, 0);
    }

    return nextRun;
  }
}

// Create and export singleton instance
export const billingJob = new BillingJob();
