import PDFDocument from 'pdfkit';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { prisma } from '../server.js';

class InvoiceService {
  async generateInvoiceNumber() {
    try {
      // Get the last invoice number
      const lastInvoice = await prisma.invoice.findFirst({
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true }
      });

      let nextNumber = 1;
      
      if (lastInvoice && lastInvoice.invoiceNumber) {
        // Extract numeric part from invoice number (e.g., "INV-0001" -> 1)
        const numericPart = lastInvoice.invoiceNumber.match(/\d+/);
        if (numericPart) {
          nextNumber = parseInt(numericPart[0]) + 1;
        }
      }

      // Format with leading zeros (e.g., "INV-0001")
      return `INV-${nextNumber.toString().padStart(4, '0')}`;
    } catch (error) {
      console.error('Error generating invoice number:', error);
      // Fallback to timestamp-based number
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

  async calculateInvoiceAmount(clientId, planId, periodStart, periodEnd) {
    try {
      // Get plan details
      const plan = await prisma.plan.findUnique({
        where: { id: planId }
      });

      if (!plan) {
        throw new AppError('Plan no encontrado', 404, 'PLAN_NOT_FOUND');
      }

      // Calculate days in period
      const daysInPeriod = Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24));
      
      // Calculate daily rate
      const dailyRate = plan.price / plan.duration;
      
      // Calculate total amount
      const totalAmount = Math.round(dailyRate * daysInPeriod);

      return totalAmount;
    } catch (error) {
      console.error('Error calculating invoice amount:', error);
      throw error;
    }
  }

  async generateMonthlyInvoices(targetDate = new Date()) {
    try {
      // Get the first day of the month
      const firstDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
      
      // Get the last day of the month
      const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);

      // Get all active clients
      const activeClients = await prisma.client.findMany({
        where: { 
          status: 'ACTIVE',
          installationDate: { 
            lte: lastDay 
          }
        },
        include: { 
          plan: true 
        }
      });

      const results = {
        successful: [],
        failed: [],
        total: activeClients.length
      };

      const creatorId = await this.getSystemUserId();

      for (const client of activeClients) {
        try {
          // Check if invoice already exists for this period
          const existingInvoice = await prisma.invoice.findFirst({
            where: {
              clientId: client.id,
              periodStart: firstDay,
              periodEnd: lastDay
            }
          });

          if (existingInvoice) {
            results.failed.push({
              clientId: client.id,
              reason: 'Invoice already exists for this period',
              invoiceId: existingInvoice.id
            });
            continue;
          }

          // Calculate invoice amount
          const amount = await this.calculateInvoiceAmount(
            client.id,
            client.planId,
            firstDay,
            lastDay
          );

          // Generate invoice number
          const invoiceNumber = await this.generateInvoiceNumber();

          // Create invoice
          const invoice = await prisma.invoice.create({
            data: {
              invoiceNumber,
              clientId: client.id,
              planId: client.planId,
              amount,
              dueDate: new Date(lastDay.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days after period end
              periodStart: firstDay,
              periodEnd: lastDay,
              createdBy: creatorId
            },
            include: {
              client: true,
              plan: true,
              creator: {
                select: { name: true }
              }
            }
          });

          results.successful.push({
            clientId: client.id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            amount
          });

        } catch (error) {
          console.error(`Error generating invoice for client ${client.id}:`, error);
          results.failed.push({
            clientId: client.id,
            reason: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error generating monthly invoices:', error);
      throw new AppError('Error generando facturas mensuales', 500, 'MONTHLY_INVOICES_ERROR');
    }
  }

  async generateProRatedInvoice(clientId, planId, startDate, endDate) {
    try {
      // Validate dates
      if (startDate >= endDate) {
        throw new AppError('La fecha de inicio debe ser anterior a la fecha de fin', 400, 'INVALID_DATE_RANGE');
      }

      // Get client and plan
      const [client, plan] = await Promise.all([
        prisma.client.findUnique({ where: { id: clientId } }),
        prisma.plan.findUnique({ where: { id: planId } })
      ]);

      if (!client) {
        throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
      }

      if (!plan) {
        throw new AppError('Plan no encontrado', 404, 'PLAN_NOT_FOUND');
      }

      // Calculate amount
      const amount = await this.calculateInvoiceAmount(clientId, planId, startDate, endDate);

      // Generate invoice number
      const invoiceNumber = await this.generateInvoiceNumber();

      // Get creator ID
      const creatorId = await this.getSystemUserId();

      // Create invoice
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          clientId,
          planId,
          amount,
          dueDate: new Date(endDate.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days after period end
          periodStart: startDate,
          periodEnd: endDate,
          createdBy: creatorId
        },
        include: {
          client: true,
          plan: true,
          creator: {
            select: { name: true }
          }
        }
      });

      return invoice;
    } catch (error) {
      console.error('Error generating pro-rated invoice:', error);
      throw error;
    }
  }

  async getSystemUserId() {
    try {
      // Try to find a system user or create one
      let systemUser = await prisma.user.findFirst({
        where: { email: 'system@miisp.com' }
      });

      if (!systemUser) {
        systemUser = await prisma.user.create({
          data: {
            email: 'system@miisp.com',
            name: 'System',
            password: 'system_password_hash', // This should be properly hashed
            role: 'ADMIN'
          }
        });
      }

      return systemUser.id;
    } catch (error) {
      console.error('Error getting system user ID:', error);
      // Fallback to first admin user
      const adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN' }
      });
      return adminUser?.id || null;
    }
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

  async getOverdueInvoices() {
    try {
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          status: { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true
            }
          },
          plan: {
            select: {
              name: true,
              price: true
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

  async duplicateInvoice(invoiceId, newPeriodStart, newPeriodEnd) {
    try {
      // Get original invoice
      const originalInvoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          client: true,
          plan: true
        }
      });

      if (!originalInvoice) {
        throw new AppError('Factura original no encontrada', 404, 'INVOICE_NOT_FOUND');
      }

      // Validate new period
      if (newPeriodStart >= newPeriodEnd) {
        throw new AppError('El período de facturación es inválido', 400, 'INVALID_PERIOD');
      }

      // Check if invoice already exists for new period
      const existingInvoice = await prisma.invoice.findFirst({
        where: {
          clientId: originalInvoice.clientId,
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd
        }
      });

      if (existingInvoice) {
        throw new AppError('Ya existe una factura para este período', 409, 'INVOICE_EXISTS_FOR_PERIOD');
      }

      // Calculate new amount
      const newAmount = await this.calculateInvoiceAmount(
        originalInvoice.clientId,
        originalInvoice.planId,
        newPeriodStart,
        newPeriodEnd
      );

      // Generate new invoice number
      const newInvoiceNumber = await this.generateInvoiceNumber();

      // Get creator ID
      const creatorId = await this.getSystemUserId();

      // Create duplicate invoice
      const newInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber: newInvoiceNumber,
          clientId: originalInvoice.clientId,
          planId: originalInvoice.planId,
          amount: newAmount,
          dueDate: new Date(newPeriodEnd.getTime() + 15 * 24 * 60 * 60 * 1000),
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd,
          createdBy: creatorId
        },
        include: {
          client: true,
          plan: true,
          creator: {
            select: { name: true }
          }
        }
      });

      return newInvoice;
    } catch (error) {
      console.error('Error duplicating invoice:', error);
      throw error;
    }
  }

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
