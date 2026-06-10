import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { invoiceService } from '../services/invoice.service.js';
import { notificationService } from '../services/notification.service.js';
import { renderEmailTemplate, EMAIL_PRESETS } from '../services/email-base.template.js';

class InvoicesController {
  getInvoices = asyncHandler(async (req, res) => {
    const {
      page = 1,
      limit = 10,
      search,
      sortBy: rawSortBy = 'createdAt',
      sortOrder: rawSortOrder = 'desc',
      status,
      clientId,
      dueDateFrom,
      dueDateTo,
      amountMin,
      amountMax
    } = req.query;
    const skip = (page - 1) * limit;

    // Whitelist sortBy/sortOrder so the caller can't inject arbitrary
    // Prisma field names (which would either 500 or leak existence info).
    const ALLOWED_SORT = new Set(['createdAt', 'dueDate', 'issueDate', 'total', 'amount', 'invoiceNumber', 'status']);
    const sortBy    = ALLOWED_SORT.has(rawSortBy) ? rawSortBy : 'createdAt';
    const sortOrder = rawSortOrder === 'asc' ? 'asc' : 'desc';

    const where = {
      ...(status && { status }),
      ...(clientId && { clientId }),
      ...(dueDateFrom && dueDateTo && {
        dueDate: {
          gte: new Date(dueDateFrom),
          lte: new Date(dueDateTo)
        }
      }),
      ...(amountMin && amountMax && {
        amount: {
          gte: Number(amountMin) * 100,
          lte: Number(amountMax) * 100
        }
      }),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { client: { name: { contains: search, mode: 'insensitive' } } },
          { client: { documentNumber: { contains: search, mode: 'insensitive' } } }
        ]
      })
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip: Number(skip),
        take: Number(limit),
        orderBy: { [sortBy]: sortOrder },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              documentNumber: true,
              email: true,
              phone: true
            }
          },
          items: true,
          payments: {
            select: {
              id: true,
              amount: true,
              method: true,
              status: true,
              createdAt: true
            }
          }
        }
      }),
      prisma.invoice.count({ where })
    ]);

    res.json({
      success: true,
      data: invoices,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  getInvoice = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        client: { include: { plan: true, zone: { select: { id: true, name: true } } } },
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          include: {
            evidencePhotos: {
              select: {
                id: true,
                fileUrl: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
                createdAt: true
              }
            },
            createdBy: { select: { id: true, name: true, email: true } }
          }
        }
      }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    res.json({
      success: true,
      data: invoice
    });
  });

  createInvoice = asyncHandler(async (req, res) => {
    const invoiceData = req.body;
    const userId = req.user.id;

    // Verify client exists
    const client = await prisma.client.findUnique({
      where: { id: invoiceData.clientId }
    });

    if (!client) {
      throw new AppError('Cliente no encontrado', 404, 'CLIENT_NOT_FOUND');
    }

    // Generate invoice number
    const invoiceNumber = await invoiceService.generateInvoiceNumber();

    const amountInCents = Math.round(invoiceData.amount * 100);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        clientId: invoiceData.clientId,
        amount: amountInCents,
        total: amountInCents,
        balanceDue: amountInCents,
        status: 'PENDING',
        dueDate: new Date(invoiceData.dueDate),
        issueDate: new Date(),
        ...(invoiceData.periodStart && { periodStart: new Date(invoiceData.periodStart) }),
        ...(invoiceData.periodEnd && { periodEnd: new Date(invoiceData.periodEnd) }),
        items: invoiceData.description ? {
          create: {
            description: invoiceData.description,
            quantity: 1,
            price: amountInCents,
            total: amountInCents
          }
        } : undefined
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
        items: true
      }
    });

    res.status(201).json({
      success: true,
      data: invoice,
      message: 'Factura creada exitosamente'
    });
  });

  updateInvoice = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    // Check if invoice exists
    const existingInvoice = await prisma.invoice.findUnique({
      where: { id }
    });

    if (!existingInvoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    // Don't allow updates if invoice is paid
    if (existingInvoice.status === 'PAID') {
      throw new AppError('No se puede modificar una factura pagada', 400, 'INVOICE_ALREADY_PAID');
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...(updateData.amount && { amount: updateData.amount * 100 }),
        ...(updateData.dueDate && { dueDate: new Date(updateData.dueDate) }),
        ...(updateData.periodStart && { periodStart: new Date(updateData.periodStart) }),
        ...(updateData.periodEnd && { periodEnd: new Date(updateData.periodEnd) })
      },
      include: {
        client: true,
        plan: true
      }
    });

    res.json({
      success: true,
      data: invoice,
      message: 'Factura actualizada exitosamente'
    });
  });

  deleteInvoice = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Check if invoice exists
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        _count: {
          select: { payments: true }
        }
      }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    // Don't allow deletion if invoice has payments
    if (invoice._count.payments > 0) {
      throw new AppError('No se puede eliminar una factura con pagos asociados', 400, 'INVOICE_HAS_PAYMENTS');
    }

    await prisma.invoice.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Factura eliminada exitosamente'
    });
  });

  cancelInvoice = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    if (invoice.status === 'CANCELLED') {
      throw new AppError('La factura ya está cancelada', 400, 'INVOICE_ALREADY_CANCELLED');
    }

    if (invoice.status === 'PAID') {
      throw new AppError('No se puede cancelar una factura pagada', 400, 'CANNOT_CANCEL_PAID_INVOICE');
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        client: true,
        plan: true
      }
    });

    res.json({
      success: true,
      data: updatedInvoice,
      message: 'Factura cancelada exitosamente'
    });
  });

  markAsPaid = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { paymentMethod, amount, notes } = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        payments: true
      }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    if (invoice.status === 'PAID') {
      throw new AppError('La factura ya está pagada', 400, 'INVOICE_ALREADY_PAID');
    }

    if (invoice.status === 'CANCELLED') {
      throw new AppError('No se puede pagar una factura cancelada', 400, 'CANNOT_PAY_CANCELLED_INVOICE');
    }

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        invoiceId: id,
        clientId: invoice.clientId,
        amount: amount * 100, // Convert to cents
        method: paymentMethod,
        status: 'COMPLETED',
        notes: notes || null,
        createdByUserId: req.user?.id,
        createdByUserName: req.user?.name
      }
    });

    // Update invoice status
    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: { status: 'PAID' },
      include: {
        client: true,
        plan: true,
        payments: true
      }
    });

    // Send payment confirmation
    await notificationService.sendPaymentConfirmation(updatedInvoice, payment);

    res.json({
      success: true,
      data: { invoice: updatedInvoice, payment },
      message: 'Pago registrado exitosamente'
    });
  });

  bulkGenerateInvoices = asyncHandler(async (req, res) => {
    const { clientIds, planId, amount, dueDate, periodStart, periodEnd } = req.body;
    const userId = req.user.id;

    // Verify plan exists
    const plan = await prisma.plan.findUnique({
      where: { id: planId }
    });

    if (!plan) {
      throw new AppError('Plan no encontrado', 404, 'PLAN_NOT_FOUND');
    }

    // Get clients
    const clients = await prisma.client.findMany({
      where: { id: { in: clientIds } }
    });

    if (clients.length === 0) {
      throw new AppError('No se encontraron clientes válidos', 404, 'NO_VALID_CLIENTS');
    }

    // Generate invoices
    const invoices = [];
    for (const client of clients) {
      try {
        const invoiceNumber = await invoiceService.generateInvoiceNumber();
        
        const invoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            clientId: client.id,
            planId,
            amount: amount * 100,
            dueDate: new Date(dueDate),
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            createdBy: userId
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
                id: true,
                name: true,
                price: true
              }
            }
          }
        });

        invoices.push(invoice);

        // Send notification (async, don't wait)
        notificationService.sendInvoiceNotification(invoice).catch(console.error);
      } catch (error) {
        console.error(`Failed to create invoice for client ${client.id}:`, error);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        created: invoices.length,
        invoices
      },
      message: `${invoices.length} facturas creadas exitosamente`
    });
  });

  bulkCancelInvoices = asyncHandler(async (req, res) => {
    const { invoiceIds } = req.body;

    // Get invoices that can be cancelled
    const invoices = await prisma.invoice.findMany({
      where: {
        id: { in: invoiceIds },
        status: { in: ['PENDING', 'OVERDUE'] }
      }
    });

    if (invoices.length === 0) {
      throw new AppError('No hay facturas elegibles para cancelación', 400, 'NO_CANCELLABLE_INVOICES');
    }

    // Cancel invoices
    const result = await prisma.invoice.updateMany({
      where: {
        id: { in: invoices.map(inv => inv.id) }
      },
      data: { status: 'CANCELLED' }
    });

    res.json({
      success: true,
      data: {
        cancelled: result.count,
        requested: invoiceIds.length
      },
      message: `${result.count} facturas canceladas exitosamente`
    });
  });

  // Aggregate KPIs across the FULL filtered set (not the current page).
  // Accepts the same query params as getInvoices so the frontend can fetch
  // both endpoints with the same filter object and the KPI numbers always
  // match what the operator can see by paging through the list.
  //
  // Calls reduce to ~5 prisma queries that run in parallel.
  getInvoiceStats = asyncHandler(async (req, res) => {
    const { search, status, clientId, dueDateFrom, dueDateTo, amountMin, amountMax } = req.query;

    const where = {
      ...(status   && { status }),
      ...(clientId && { clientId }),
      ...(dueDateFrom && dueDateTo && {
        dueDate: { gte: new Date(dueDateFrom), lte: new Date(dueDateTo) }
      }),
      ...(amountMin && amountMax && {
        amount: { gte: Number(amountMin) * 100, lte: Number(amountMax) * 100 }
      }),
      ...(search && {
        OR: [
          { invoiceNumber:   { contains: search, mode: 'insensitive' } },
          { client: { name:           { contains: search, mode: 'insensitive' } } },
          { client: { documentNumber: { contains: search, mode: 'insensitive' } } }
        ]
      })
    };

    const now = new Date();

    // Two queries: one groupBy (respects the user-supplied `where`,
    // including any operator status filter) + one overdue-by-date
    // sub-aggregate. Per-status counts/sums are derived from byStatus so
    // a `?status=PAID` filter cleanly reports "pending: 0" instead of
    // ignoring the filter.
    const [total, byStatus, overdueAgg] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { total: true, balanceDue: true }
      }),
      prisma.invoice.aggregate({
        where: { ...where, status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }, dueDate: { lt: now } },
        _sum:  { balanceDue: true }
      })
    ]);

    const counts = Object.fromEntries(byStatus.map(b => [b.status, b._count]));
    const sumsTotal      = Object.fromEntries(byStatus.map(b => [b.status, b._sum.total      || 0]));
    const sumsBalanceDue = Object.fromEntries(byStatus.map(b => [b.status, b._sum.balanceDue || 0]));

    const pending = (counts.PENDING || 0) + (counts.PARTIAL || 0);
    const paid    = counts.PAID || 0;
    const outstandingAmount =
      (sumsBalanceDue.PENDING || 0) +
      (sumsBalanceDue.PARTIAL || 0) +
      (sumsBalanceDue.OVERDUE || 0);
    const paidAmount = sumsTotal.PAID || 0;

    res.json({
      success: true,
      data: {
        total,
        byStatus,
        pending,
        paid,
        outstandingAmount,
        overdueAmount: overdueAgg._sum.balanceDue || 0,
        paidAmount,
        collectionRate: (paidAmount + outstandingAmount) > 0
          ? Math.round((paidAmount / (paidAmount + outstandingAmount)) * 100)
          : 0
      }
    });
  });

  getOverdueInvoices = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      status: { in: ['PENDING', 'OVERDUE'] },
      dueDate: { lt: new Date() }
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: { dueDate: 'asc' },
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
              id: true,
              name: true,
              price: true
            }
          }
        }
      }),
      prisma.invoice.count({ where })
    ]);

    res.json({
      success: true,
      data: invoices,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  getInvoicesByMonth = asyncHandler(async (req, res) => {
    const currentYear = new Date().getFullYear();
    
    const invoicesByMonth = await prisma.$queryRaw`
      SELECT 
        EXTRACT(MONTH FROM "createdAt") as month,
        COUNT(*) as count,
        COALESCE(SUM("amount"), 0) as total
      FROM "invoices" 
      WHERE EXTRACT(YEAR FROM "createdAt") = ${currentYear}
      GROUP BY EXTRACT(MONTH FROM "createdAt")
      ORDER BY month
    `;

    res.json({
      success: true,
      data: invoicesByMonth
    });
  });

  getInvoicesByPlan = asyncHandler(async (req, res) => {
    const invoicesByPlan = await prisma.invoice.groupBy({
      by: ['planId'],
      _count: true,
      _sum: { amount: true }
    });

    // Get plan details
    const planIds = invoicesByPlan.map(item => item.planId);
    const plans = await prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true, price: true }
    });

    const result = invoicesByPlan.map(item => {
      const plan = plans.find(p => p.id === item.planId);
      return {
        planId: item.planId,
        planName: plan?.name || 'Unknown',
        planPrice: plan?.price || 0,
        invoiceCount: item._count,
        totalAmount: item._sum.amount || 0
      };
    });

    res.json({
      success: true,
      data: result
    });
  });

  exportToExcel = asyncHandler(async (req, res) => {
    // This would require a library like xlsx or exceljs
    // For now, return a placeholder response
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Exportación a Excel no implementada aún'
      }
    });
  });

  exportToPDF = asyncHandler(async (req, res) => {
    // This would require a PDF generation library
    // For now, return a placeholder response
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Exportación a PDF no implementada aún'
      }
    });
  });

  generateInvoicePDF = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        plan: true,
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

    // Generate PDF using PDFKit or similar
    const pdfBuffer = await invoiceService.generateInvoicePDF(invoice);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${invoice.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  });

  sendPaymentReminders = asyncHandler(async (req, res) => {
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: new Date() }
      },
      include: {
        client: true
      }
    });

    let sentCount = 0;
    for (const invoice of overdueInvoices) {
      try {
        await notificationService.sendPaymentReminder(invoice);
        sentCount++;
      } catch (error) {
        console.error(`Failed to send reminder for invoice ${invoice.id}:`, error);
      }
    }

    res.json({
      success: true,
      data: {
        sent: sentCount,
        total: overdueInvoices.length
      },
      message: `${sentCount} recordatorios enviados exitosamente`
    });
  });

  sendSingleReminder = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    await notificationService.sendPaymentReminder(invoice);

    res.json({
      success: true,
      message: 'Recordatorio enviado exitosamente'
    });
  });

  sendInvoice = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { channels, sendPdf, sendPaymentLink } = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    const results = [];

    // Generate Wompi payment link if requested
    let paymentLinkUrl = null;
    if (sendPaymentLink) {
      try {
        const { default: wompiService } = await import('../services/wompi.service.js');
        const checkout = await wompiService.createCheckout(invoice);
        paymentLinkUrl = checkout.checkoutUrl || checkout.url;
      } catch (e) {
        results.push({ action: 'payment_link', channel: 'wompi', status: 'failed', error: e.message });
      }
    }

    // Build company info for templates
    const company = {
      name: env.COMPANY_NAME,
      nit: env.COMPANY_NIT,
      city: env.COMPANY_CITY,
      address: env.COMPANY_ADDRESS,
      phone: env.COMPANY_PHONE,
      email: env.COMPANY_EMAIL
    };

    for (const ch of channels) {
      try {
        if (ch === 'email') {
          if (!invoice.client?.email) {
            results.push({ action: 'send', channel: 'email', status: 'failed', error: 'Cliente sin email registrado' });
            continue;
          }

          // Send invoice notification via reusable template
          await notificationService.sendEmail({
            to: invoice.client.email,
            subject: `Factura ${invoice.invoiceNumber} - ${env.COMPANY_NAME}`,
            template: 'invoice',
            data: { invoice, client: invoice.client, company }
          });

          await notificationService.logNotification(
            invoice.clientId, 'GENERAL_ANNOUNCEMENT', 'EMAIL',
            `Factura ${invoice.invoiceNumber} enviada por email`
          );

          results.push({ action: 'send', channel: 'email', status: 'sent' });

          // Send separate email with PDF attachment if requested
          if (sendPdf) {
            try {
              const pdfBuffer = await invoiceService.generateInvoicePDF(invoice);
              const { transporter, from } = await notificationService.getTransporter();

              // Build HTML content with branded template
              const built = notificationService.buildEmailTemplate('invoice', { invoice, client: invoice.client, company });
              const subject = `PDF adjunto - Factura ${invoice.invoiceNumber}`;
              const html = renderEmailTemplate({
                icon: EMAIL_PRESETS.invoice?.icon || '📄',
                title: built.title || subject,
                body: `Adjuntamos el PDF de la factura ${invoice.invoiceNumber}.`,
                fields: built.fields || [],
                companyName: from.fromName,
                companyDomain: from.fromEmail?.split('@')[1]
              });

              await transporter.sendMail({
                from: `"${from.fromName}" <${from.fromEmail}>`,
                to: invoice.client.email,
                subject,
                text: `Adjuntamos el PDF de la factura ${invoice.invoiceNumber}.`,
                html,
                attachments: [{ filename: `factura-${invoice.invoiceNumber}.pdf`, content: pdfBuffer }]
              });
            } catch (pdfErr) {
              results.push({ action: 'send_pdf', channel: 'email', status: 'failed', error: pdfErr.message });
            }
          }

          // Send payment link email if requested
          if (paymentLinkUrl) {
            await notificationService.sendEmailRaw({
              to: invoice.client.email,
              subject: `Link de Pago - Factura ${invoice.invoiceNumber}`,
              body: `Estimado(a) ${invoice.client.name || 'cliente'},\n\nPuede realizar el pago de su factura ${invoice.invoiceNumber} por $${(invoice.amount / 100).toLocaleString('es-CO')} COP a través del siguiente enlace de pago seguro:\n\n${paymentLinkUrl}`,
              cta: { text: 'Pagar Ahora', url: paymentLinkUrl },
              preset: 'invoice'
            });

            await notificationService.logNotification(
              invoice.clientId, 'GENERAL_ANNOUNCEMENT', 'EMAIL',
              `Link de pago factura ${invoice.invoiceNumber} enviado`
            );
          }
        } else if (ch === 'whatsapp') {
          if (!invoice.client?.phone) {
            results.push({ action: 'send', channel: 'whatsapp', status: 'failed', error: 'Cliente sin teléfono registrado' });
            continue;
          }

          const amountFormatted = `$${(invoice.amount / 100).toLocaleString('es-CO')} COP`;
          const dueFormatted = invoice.dueDate
            ? new Date(invoice.dueDate).toLocaleDateString('es-CO')
            : '—';

          let msg = `📄 *Factura ${invoice.invoiceNumber}* - ${env.COMPANY_NAME}\n\n`;
          msg += `💰 *Valor:* ${amountFormatted}\n`;
          msg += `📅 *Vence:* ${dueFormatted}\n`;
          msg += `📋 *Estado:* ${invoice.status === 'PAID' ? '✅ Pagada' : invoice.status === 'OVERDUE' ? '⚠️ Vencida' : '⏳ Pendiente'}\n\n`;
          if (paymentLinkUrl) {
            msg += `🔗 *Link de pago:* ${paymentLinkUrl}\n\n`;
          }

          await notificationService.sendWhatsApp({ to: invoice.client.phone, message: msg });

          await notificationService.logNotification(
            invoice.clientId, 'GENERAL_ANNOUNCEMENT', 'WHATSAPP',
            `Factura ${invoice.invoiceNumber} enviada por WhatsApp`
          );

          results.push({ action: 'send', channel: 'whatsapp', status: 'sent' });
        }
      } catch (e) {
        results.push({ action: 'send', channel: ch, status: 'failed', error: e.message });
      }
    }

    const allOk = results.every(r => r.status === 'sent');
    res.status(allOk ? 200 : 207).json({
      success: allOk,
      data: { results, paymentLinkUrl: paymentLinkUrl || null },
      message: allOk
        ? `Factura enviada correctamente por ${channels.join(' y ')}`
        : `Algunos envíos fallaron (${results.filter(r => r.status === 'failed').length} de ${results.length})`
    });
  });
}

export const invoiceController = new InvoicesController();
