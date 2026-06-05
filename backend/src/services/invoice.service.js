import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../config/database.js';

class InvoiceService {
  async generateInvoiceNumber() {
    try {
      // Field is `invoiceNumber` after the rename; `@map("number")` keeps
      // the DB column the same so this is purely a Prisma-side change.
      const lastInvoice = await prisma.invoice.findFirst({
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true }
      });

      let nextNumber = 1;

      if (lastInvoice?.invoiceNumber) {
        const numericPart = lastInvoice.invoiceNumber.match(/\d+/);
        if (numericPart) {
          nextNumber = parseInt(numericPart[0], 10) + 1;
        }
      }

      return `INV-${String(nextNumber).padStart(4, '0')}`;
    } catch (error) {
      console.error('Error generating invoice number:', error);
      return `INV-${Date.now()}`;
    }
  }

  async generateInvoicePDF(invoice) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
          const pdfData = Buffer.concat(buffers);
          resolve(pdfData);
        });

        // Add content to PDF
        this.addInvoiceContent(doc, invoice);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  addInvoiceContent(doc, invoice) {
    const { client, plan, creator } = invoice;

    // Header
    doc.fontSize(20).text('FACTURA', { align: 'center' });
    doc.moveDown();

    // Company info
    doc.fontSize(12).text(`${env.COMPANY_NAME}`, { align: 'center' });
    doc.text(`NIT: ${env.COMPANY_NIT}`, { align: 'center' });
    doc.text(`${env.COMPANY_CITY}`, { align: 'center' });
    doc.text(`${env.COMPANY_ADDRESS}`, { align: 'center' });
    doc.text(`Tel: ${env.COMPANY_PHONE}`, { align: 'center' });
    doc.text(`Email: ${env.COMPANY_EMAIL}`, { align: 'center' });
    doc.moveDown();

    // Invoice details
    doc.fontSize(14).text(`Número de Factura: ${invoice.invoiceNumber}`);
    doc.fontSize(12).text(`Fecha de Emisión: ${invoice.createdAt.toLocaleDateString()}`);
    doc.text(`Fecha de Vencimiento: ${invoice.dueDate.toLocaleDateString()}`);
    doc.moveDown();

    // Client info
    doc.fontSize(14).text('Datos del Cliente:', { underline: true });
    doc.fontSize(12).text(`Nombre: ${client.name}`);
    doc.text(`Documento: ${client.documentType} ${client.documentNumber}`);
    doc.text(`Email: ${client.email}`);
    doc.text(`Teléfono: ${client.phone}`);
    doc.text(`Dirección: ${client.address}`);
    doc.text(`Ciudad: ${client.city}`);
    doc.moveDown();

    // Service details
    doc.fontSize(14).text('Detalles del Servicio:', { underline: true });
    doc.fontSize(12).text(`Plan: ${plan.name}`);
    doc.text(`Velocidad: ${plan.speedDown}Mbps / ${plan.speedUp}Mbps`);
    if (plan.dataLimit) {
      doc.text(`Límite de datos: ${plan.dataLimit}GB/mes`);
    } else {
      doc.text('Límite de datos: Ilimitado');
    }
    doc.text(`Período: ${invoice.periodStart.toLocaleDateString()} - ${invoice.periodEnd.toLocaleDateString()}`);
    doc.moveDown();

    // Amount
    doc.fontSize(14).text('Valor a Pagar:', { underline: true });
    doc.fontSize(16).text(`$${(invoice.amount / 100).toLocaleString('es-CO')} COP`, { align: 'right' });
    doc.moveDown();

    // Payment methods
    doc.fontSize(12).text('Métodos de Pago:');
    doc.text('• Transferencia bancaria');
    doc.text('• Pago en línea (Wompi)');
    doc.text('• Pago presencial en nuestras oficinas');
    doc.moveDown();

    // Notes
    doc.fontSize(10).text('Notas:', { underline: true });
    doc.text('• El pago debe realizarse antes de la fecha de vencimiento para evitar suspensiones.');
    doc.text('• Los pagos realizados después de la fecha de vencimiento pueden generar cargos adicionales.');
    doc.text('• Para cualquier consulta, contactar al teléfono de atención al cliente.');
    doc.moveDown();

    // Footer
    doc.fontSize(10).text(`Factura generada por: ${creator.name}`, { align: 'center' });
    doc.text(`Generada el: ${new Date().toLocaleString()}`, { align: 'center' });
  }

  // REMOVED: calculateInvoiceAmount, generateProRatedInvoice,
  // duplicateInvoiceForPeriod, getSystemUserId.
  //
  // All four were broken against the current schema:
  //   • calculateInvoiceAmount divided plan.price by plan.duration (Plan
  //     has no `duration` field — returned NaN).
  //   • generateProRatedInvoice / duplicateInvoiceForPeriod wrote
  //     Invoice.planId / periodStart / periodEnd / createdBy / creator —
  //     none of those exist on the Invoice model (canonical billing
  //     period is periodYear + periodMonth).
  //   • getSystemUserId created a User with a hardcoded string in the
  //     password column ('system_password_hash', NOT a bcrypt hash) and
  //     ADMIN role — a latent privilege-escalation footgun.
  //
  // None of them had any external caller (only invoked each other), so
  // deletion is safe. If pro-rated billing is needed again, write a fresh
  // implementation against periodYear/periodMonth and InvoiceItem rows.

  // Generate one Invoice row per active client for the month of `targetDate`.
  //
  // Schema alignment (kept in sync with prisma/schema.prisma):
  //   • Invoice has NO planId / periodStart / periodEnd / createdBy. The
  //     billing period is identified by `(periodYear, periodMonth)` with a
  //     composite UNIQUE constraint → idempotency is enforced at the DB
  //     level via `upsert`, so re-running the job is a no-op.
  //   • The amount comes from (in order of precedence):
  //       1. client.monthlyFee  — per-client override (cents)
  //       2. plan.monthlyPrice  — frontend-facing price (cents)
  //       3. plan.price         — legacy single field (cents)
  //
  // Clients with NULL installationDate are eligible (legacy / imported
  // rows). Only `installationDate > lastDay` is excluded (future contracts).
  //
  // Note: `tax` and `discount` are zero today. When IVA is enabled we can
  // extend this to compute them from the plan/client. `total` is always
  // `amount + tax - discount` so the dashboards stay consistent.
  async generateMonthlyInvoices(targetDate = new Date()) {
    try {
      const year  = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1; // 1-12
      const firstDay = new Date(year, month - 1, 1);
      const lastDay  = new Date(year, month, 0, 23, 59, 59, 999);

      const activeClients = await prisma.client.findMany({
        where: {
          status: 'ACTIVE',
          // Eligible: never-set installationDate OR installed on/before lastDay.
          OR: [
            { installationDate: null },
            { installationDate: { lte: lastDay } }
          ]
        },
        include: { plan: true }
      });

      const results = { successful: [], failed: [], total: activeClients.length };

      for (const client of activeClients) {
        try {
          if (!client.planId || !client.plan) {
            results.failed.push({ clientId: client.id, reason: 'Client has no plan assigned' });
            continue;
          }

          const amount = client.monthlyFee && client.monthlyFee > 0
            ? client.monthlyFee
            : (client.plan.monthlyPrice || client.plan.price || 0);
          if (!amount || amount < 0) {
            results.failed.push({ clientId: client.id, reason: 'Computed amount is zero/negative' });
            continue;
          }
          const total = amount; // tax=0, discount=0 (see comment above)

          // Idempotency: UNIQUE(clientId, periodYear, periodMonth) means
          // re-running the same month upserts the existing row instead of
          // duplicating. We use a constant `where` to leverage the index.
          const existing = await prisma.invoice.findUnique({
            where: {
              clientId_periodYear_periodMonth: {
                clientId: client.id, periodYear: year, periodMonth: month
              }
            }
          });
          if (existing) {
            results.failed.push({
              clientId: client.id,
              reason: 'Invoice already exists for this period',
              invoiceId: existing.id
            });
            continue;
          }

          const invoiceNumber = await this.generateInvoiceNumber();
          // Due date: 15 days after the period ends (configurable later).
          const dueDate = new Date(lastDay.getTime() + 15 * 24 * 60 * 60 * 1000);

          const invoice = await prisma.invoice.create({
            data: {
              invoiceNumber,
              clientId:    client.id,
              amount, tax: 0, discount: 0, total,
              balanceDue:  total,
              status:      'PENDING',
              issueDate:   firstDay,
              dueDate,
              periodYear:  year,
              periodMonth: month,
              items: {
                create: [{
                  description: `${client.plan.name} — ${this._monthLabel(month)} ${year}`,
                  quantity:    1,
                  // InvoiceItem schema uses `price` (per-unit). Total is the
                  // line total = price * quantity for this simple item.
                  price:       amount,
                  total:       amount
                }]
              }
            },
            include: { client: true, items: true }
          });

          results.successful.push({
            clientId: client.id, invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber, amount
          });
        } catch (error) {
          console.error(`Error generating invoice for client ${client.id}:`, error);
          results.failed.push({ clientId: client.id, reason: error.message });
        }
      }

      return results;
    } catch (error) {
      console.error('Error generating monthly invoices:', error);
      throw new AppError('Error generando facturas mensuales', 500, 'MONTHLY_INVOICES_ERROR');
    }
  }

  _monthLabel(month) {
    return ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
            'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month - 1] || '';
  }

  async updateInvoiceStatus(invoiceId, status) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId }
      });

      if (!invoice) {
        throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
      }

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status },
        include: {
          client: true,
          plan: true
        }
      });

      return updatedInvoice;
    } catch (error) {
      console.error('Error updating invoice status:', error);
      throw error;
    }
  }

  // Invoice has no direct `plan` relation in the schema — the plan lives on
  // the Client. We include `client.plan` so downstream notifications can
  // still show plan info without an extra round-trip.
  async getOverdueInvoices() {
    try {
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          status:  { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        },
        include: {
          client: {
            select: {
              id: true, name: true, email: true, phone: true,
              plan: { select: { name: true, price: true, monthlyPrice: true } }
            }
          }
        },
        orderBy: { dueDate: 'asc' }
      });
      return overdueInvoices;
    } catch (error) {
      console.error('Error getting overdue invoices:', error);
      throw new AppError('Error obteniendo facturas vencidas', 500, 'OVERDUE_INVOICES_ERROR');
    }
  }

  async markInvoicesAsOverdue() {
    try {
      const result = await prisma.invoice.updateMany({
        where: {
          status: 'PENDING',
          dueDate: { lt: new Date() }
        },
        data: { status: 'OVERDUE' }
      });

      return result;
    } catch (error) {
      console.error('Error marking invoices as overdue:', error);
      throw new AppError('Error marcando facturas como vencidas', 500, 'MARK_OVERDUE_ERROR');
    }
  }

  async getInvoiceSummary(filters = {}) {
    try {
      const where = {
        ...(filters.dateFrom && filters.dateTo && {
          createdAt: {
            gte: new Date(filters.dateFrom),
            lte: new Date(filters.dateTo)
          }
        }),
        ...(filters.status && { status: filters.status }),
        ...(filters.clientId && { clientId: filters.clientId })
      };

      const [total, summary, byStatus, byPlan] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.aggregate({
          where,
          _sum: { amount: true },
          _count: true
        }),
        prisma.invoice.groupBy({
          by: ['status'],
          where,
          _count: true,
          _sum: { amount: true }
        }),
        prisma.invoice.groupBy({
          by: ['planId'],
          where,
          _count: true,
          _sum: { amount: true }
        })
      ]);

      // Get plan details
      const planIds = byPlan.map(item => item.planId);
      const plans = await prisma.plan.findMany({
        where: { id: { in: planIds } },
        select: { id: true, name: true }
      });

      const planDetails = byPlan.map(item => {
        const plan = plans.find(p => p.id === item.planId);
        return {
          planId: item.planId,
          planName: plan?.name || 'Unknown',
          count: item._count,
          amount: item._sum.amount || 0
        };
      });

      return {
        total,
        summary: {
          count: summary._count,
          amount: summary._sum.amount || 0
        },
        byStatus,
        byPlan: planDetails
      };
    } catch (error) {
      console.error('Error getting invoice summary:', error);
      throw new AppError('Error obteniendo resumen de facturas', 500, 'INVOICE_SUMMARY_ERROR');
    }
  }

  async validateInvoiceData(invoiceData) {
    const errors = [];

    // Validate required fields
    if (!invoiceData.clientId) {
      errors.push('El ID del cliente es requerido');
    }

    if (!invoiceData.planId) {
      errors.push('El ID del plan es requerido');
    }

    if (!invoiceData.amount || invoiceData.amount <= 0) {
      errors.push('El monto debe ser mayor a 0');
    }

    if (!invoiceData.dueDate) {
      errors.push('La fecha de vencimiento es requerida');
    }

    if (!invoiceData.periodStart) {
      errors.push('La fecha de inicio del período es requerida');
    }

    if (!invoiceData.periodEnd) {
      errors.push('La fecha de fin del período es requerida');
    }

    // Validate date logic
    if (invoiceData.periodStart && invoiceData.periodEnd) {
      const startDate = new Date(invoiceData.periodStart);
      const endDate = new Date(invoiceData.periodEnd);

      if (startDate >= endDate) {
        errors.push('La fecha de inicio debe ser anterior a la fecha de fin');
      }

      if (invoiceData.dueDate) {
        const dueDate = new Date(invoiceData.dueDate);
        if (dueDate <= endDate) {
          errors.push('La fecha de vencimiento debe ser posterior a la fecha de fin del período');
        }
      }
    }

    // Validate client exists
    if (invoiceData.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: invoiceData.clientId }
      });

      if (!client) {
        errors.push('El cliente especificado no existe');
      }
    }

    // Validate plan exists
    if (invoiceData.planId) {
      const plan = await prisma.plan.findUnique({
        where: { id: invoiceData.planId }
      });

      if (!plan) {
        errors.push('El plan especificado no existe');
      }
    }

    return errors;
  }

  // REMOVED: duplicateInvoice — relied on calculateInvoiceAmount and
  // getSystemUserId and wrote planId/periodStart/periodEnd/createdBy/creator
  // (none of which exist on the Invoice model). Had no external callers.


  async getInvoiceTimeline(invoiceId) {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          payments: {
            orderBy: { createdAt: 'desc' }
          },
          client: {
            select: {
              id: true,
              name: true
            }
          },
          creator: {
            select: {
              id: true,
              name: true
            }
          }
        }
      });

      if (!invoice) {
        throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
      }

      const timeline = [
        {
          type: 'created',
          date: invoice.createdAt,
          description: `Factura creada por ${invoice.creator.name}`,
          user: invoice.creator.name
        }
      ];

      // Add payment events
      invoice.payments.forEach(payment => {
        timeline.push({
          type: 'payment',
          date: payment.createdAt,
          description: `Pago de $${(payment.amount / 100).toLocaleString('es-CO')} via ${payment.paymentMethod}`,
          status: payment.status,
          user: 'System'
        });

        if (payment.paidAt) {
          timeline.push({
            type: 'payment_confirmed',
            date: payment.paidAt,
            description: 'Pago confirmado',
            user: 'System'
          });
        }
      });

      // Add status change events
      if (invoice.status === 'PAID') {
        const lastPayment = invoice.payments
          .filter(p => p.status === 'COMPLETED')
          .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0];

        if (lastPayment && lastPayment.paidAt) {
          timeline.push({
            type: 'status_change',
            date: lastPayment.paidAt,
            description: 'Factura marcada como pagada',
            user: 'System'
          });
        }
      }

      return timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
      console.error('Error getting invoice timeline:', error);
      throw error;
    }
  }
}

export const invoiceService = new InvoiceService();
