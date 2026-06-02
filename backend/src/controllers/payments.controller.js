import { prisma } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { wompiService } from '../services/wompi.service.js';
import { notificationService } from '../services/notification.service.js';

class PaymentsController {
  getPayments = asyncHandler(async (req, res) => {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      sortBy = 'createdAt', 
      sortOrder = 'desc',
      status,
      paymentMethod,
      invoiceId,
      dateFrom,
      dateTo,
      amountMin,
      amountMax
    } = req.query;
    const skip = (page - 1) * limit;

    const where = {
      ...(status && { status }),
      ...(paymentMethod && { paymentMethod }),
      ...(invoiceId && { invoiceId }),
      ...(dateFrom && dateTo && {
        createdAt: {
          gte: new Date(dateFrom),
          lte: new Date(dateTo)
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
          { transactionId: { contains: search, mode: 'insensitive' } },
          { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
          { invoice: { client: { name: { contains: search, mode: 'insensitive' } } } }
        ]
      })
    };

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              amount: true,
              dueDate: true,
              status: true,
              client: {
                select: {
                  id: true,
                  name: true,
                  documentNumber: true,
                  email: true
                }
              }
            }
          }
        }
      }),
      prisma.payment.count({ where })
    ]);

    res.json({
      success: true,
      data: payments,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  });

  getPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: {
            client: true,
            plan: true
          }
        }
      }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    res.json({
      success: true,
      data: payment
    });
  });

  createPayment = asyncHandler(async (req, res) => {
    const { invoiceId, amount, paymentMethod, notes } = req.body;

    // Check if invoice exists
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
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

    const amountCents = Math.round(amount * 100);
    const previousPaid = invoice.payments.reduce(
      (sum, p) => sum + (p.status === 'COMPLETED' ? p.amount : 0),
      0
    );

    if (previousPaid + amountCents > invoice.amount) {
      throw new AppError('El monto del pago excede el saldo de la factura', 400, 'PAYMENT_EXCEEDS_INVOICE');
    }

    const newTotalPaid = previousPaid + amountCents;
    const remaining = Math.max(0, invoice.amount - newTotalPaid);
    const newStatus = remaining === 0 ? 'PAID' : 'PARTIAL';

    // Atomic: create payment + sync invoice status + balanceDue
    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId,
          clientId: invoice.clientId,
          amount: amountCents,
          method: paymentMethod,
          status: 'COMPLETED',
          notes: notes || null,
          createdByUserId: req.user?.id,
          createdByUserName: req.user?.name
        },
        include: {
          invoice: { include: { client: true } }
        }
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: newStatus,
          balanceDue: remaining,
          ...(newStatus === 'PAID' && { paidDate: new Date() })
        }
      })
    ]);

    // Send notification (best-effort, outside transaction)
    try {
      await notificationService.sendPaymentConfirmation(invoice, payment);
    } catch (e) {
      console.warn('sendPaymentConfirmation failed:', e?.message);
    }

    res.status(201).json({
      success: true,
      data: payment,
      message: newStatus === 'PAID'
        ? 'Pago registrado y factura marcada como PAGADA'
        : `Pago parcial registrado. Saldo restante: ${(remaining / 100).toLocaleString('es-CO')}`
    });
  });

  // POST /api/v1/invoices/sync-status — repair invoices whose status
  // doesn't match their actual payment totals. Runs idempotently.
  syncInvoiceStatuses = asyncHandler(async (req, res) => {
    const candidates = await prisma.invoice.findMany({
      where: { status: { in: ['DRAFT', 'PENDING', 'OVERDUE', 'PARTIAL'] } },
      include: { payments: true }
    });

    const updates = [];
    for (const inv of candidates) {
      const paid = inv.payments.reduce(
        (sum, p) => sum + (p.status === 'COMPLETED' ? p.amount : 0),
        0
      );
      const remaining = Math.max(0, inv.amount - paid);
      let nextStatus = inv.status;
      if (paid >= inv.amount) nextStatus = 'PAID';
      else if (paid > 0)      nextStatus = 'PARTIAL';

      const needsUpdate = inv.status !== nextStatus || (inv.balanceDue ?? 0) !== remaining;
      if (needsUpdate) {
        updates.push(prisma.invoice.update({
          where: { id: inv.id },
          data: {
            status: nextStatus,
            balanceDue: remaining,
            ...(nextStatus === 'PAID' && !inv.paidDate && { paidDate: new Date() })
          }
        }));
      }
    }

    if (updates.length) await prisma.$transaction(updates);

    res.json({
      success: true,
      data: {
        scanned: candidates.length,
        updated: updates.length
      },
      message: `Sincronización completada. ${updates.length} factura(s) actualizada(s) de ${candidates.length} revisada(s).`
    });
  });

  updatePayment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: true
      }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    // Don't allow updates if payment is completed
    if (payment.status === 'COMPLETED') {
      throw new AppError('No se puede modificar un pago completado', 400, 'PAYMENT_ALREADY_COMPLETED');
    }

    const updatedPayment = await prisma.payment.update({
      where: { id },
      data: {
        ...(updateData.amount && { amount: updateData.amount * 100 }),
        ...(updateData.paymentMethod && { paymentMethod: updateData.paymentMethod })
      },
      include: {
        invoice: {
          include: {
            client: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: updatedPayment,
      message: 'Pago actualizado exitosamente'
    });
  });

  deletePayment = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: true
      }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status === 'COMPLETED') {
      throw new AppError('No se puede eliminar un pago completado', 400, 'CANNOT_DELETE_COMPLETED_PAYMENT');
    }

    await prisma.payment.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Pago eliminado exitosamente'
    });
  });

  confirmPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: {
            client: true,
            payments: true
          }
        }
      }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status === 'COMPLETED') {
      throw new AppError('El pago ya está confirmado', 400, 'PAYMENT_ALREADY_CONFIRMED');
    }

    const updatedPayment = await prisma.payment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        paidAt: new Date()
      },
      include: {
        invoice: {
          include: {
            client: true,
            plan: true
          }
        }
      }
    });

    // Check if invoice is now fully paid
    const totalPaid = payment.invoice.payments.reduce((sum, p) => {
      return sum + (p.id === id ? updatedPayment.amount : (p.status === 'COMPLETED' ? p.amount : 0));
    }, 0);

    const remaining = Math.max(0, payment.invoice.amount - totalPaid);

    await prisma.invoice.update({
      where: { id: payment.invoiceId },
      data: {
        status: remaining === 0 ? 'PAID' : 'PARTIAL',
        balanceDue: remaining,
        ...(remaining === 0 && { paidDate: new Date() })
      }
    });

    // Send payment confirmation
    await notificationService.sendPaymentConfirmation(payment.invoice, updatedPayment);

    res.json({
      success: true,
      data: updatedPayment,
      message: 'Pago confirmado exitosamente'
    });
  });

  failPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status === 'FAILED') {
      throw new AppError('El pago ya está marcado como fallido', 400, 'PAYMENT_ALREADY_FAILED');
    }

    const updatedPayment = await prisma.payment.update({
      where: { id },
      data: { status: 'FAILED' }
    });

    res.json({
      success: true,
      data: updatedPayment,
      message: 'Pago marcado como fallido'
    });
  });

  refundPayment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason, amount } = req.body;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: {
            payments: true
          }
        }
      }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    if (payment.status !== 'COMPLETED') {
      throw new AppError('Solo se pueden reembolsar pagos completados', 400, 'ONLY_COMPLETED_PAYMENTS_REFUNDABLE');
    }

    const refundAmount = amount ? amount * 100 : payment.amount;

    if (refundAmount > payment.amount) {
      throw new AppError('El monto de reembolso no puede exceder el monto del pago', 400, 'REFUND_EXCEEDS_PAYMENT');
    }

    // Create refund payment
    const refundPayment = await prisma.payment.create({
      data: {
        invoiceId: payment.invoiceId,
        amount: -refundAmount, // Negative amount for refunds
        paymentMethod: payment.paymentMethod,
        status: 'REFUNDED',
        paidAt: new Date(),
        transactionId: `REFUND-${payment.transactionId || payment.id}`
      }
    });

    // Update original payment status
    await prisma.payment.update({
      where: { id },
      data: { status: 'REFUNDED' }
    });

    // Check if invoice is still fully paid
    const totalPaid = payment.invoice.payments.reduce((sum, p) => {
      if (p.id === id) return sum; // Exclude original payment
      if (p.status === 'COMPLETED') return sum + p.amount;
      return sum;
    }, 0);

    if (totalPaid < payment.invoice.amount) {
      await prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: 'PENDING' }
      });
    }

    res.json({
      success: true,
      data: refundPayment,
      message: 'Reembolso procesado exitosamente'
    });
  });

  wompiWebhook = asyncHandler(async (req, res) => {
    const signature = req.headers['x-wompi-signature'];
    
    if (!signature) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'Firma requerida'
        }
      });
    }

    // Verify webhook signature
    const isValid = await wompiService.verifyWebhookSignature(req.body, signature);
    
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Firma inválida'
        }
      });
    }

    const { event, data } = req.body;

    if (event === 'transaction.updated') {
      await wompiService.handleTransactionUpdate(data);
    }

    res.json({
      success: true,
      message: 'Webhook procesado'
    });
  });

  getWompiCheckout = asyncHandler(async (req, res) => {
    const { invoiceId } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }

    if (invoice.status === 'PAID') {
      throw new AppError('La factura ya está pagada', 400, 'INVOICE_ALREADY_PAID');
    }

    const checkoutData = await wompiService.createCheckout(invoice);

    res.json({
      success: true,
      data: checkoutData
    });
  });

  getPaymentStats = asyncHandler(async (req, res) => {
    const [total, byStatus, byMethod, completedAgg] = await Promise.all([
      prisma.payment.count(),
      prisma.payment.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true }
      }),
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: { status: 'COMPLETED' },
        _count: true,
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true
      })
    ]);

    const completedCount = byStatus.find(s => s.status === 'COMPLETED')?._count || 0;
    const pendingCount   = byStatus.find(s => s.status === 'PENDING')?._count   || 0;
    const completedSum   = completedAgg._sum.amount || 0;

    res.json({
      success: true,
      data: {
        total,
        completedCount,
        pendingCount,
        completedAmount: completedSum,
        byStatus,
        byMethod
      }
    });
  });

  getPaymentsByMethod = asyncHandler(async (req, res) => {
    const { dateFrom, dateTo } = req.query;

    const where = {
      status: 'COMPLETED',
      ...(dateFrom && dateTo && {
        paidAt: {
          gte: new Date(dateFrom),
          lte: new Date(dateTo)
        }
      })
    };

    const paymentsByMethod = await prisma.payment.groupBy({
      by: ['paymentMethod'],
      where,
      _count: true,
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: paymentsByMethod
    });
  });

  getPaymentsByMonth = asyncHandler(async (req, res) => {
    const currentYear = new Date().getFullYear();
    
    const paymentsByMonth = await prisma.$queryRaw`
      SELECT 
        EXTRACT(MONTH FROM "paidAt") as month,
        COUNT(*) as count,
        COALESCE(SUM("amount"), 0) as total
      FROM "payments" 
      WHERE 
        EXTRACT(YEAR FROM "paidAt") = ${currentYear}
        AND status = 'COMPLETED'
      GROUP BY EXTRACT(MONTH FROM "paidAt")
      ORDER BY month
    `;

    res.json({
      success: true,
      data: paymentsByMonth
    });
  });

  getDailyPayments = asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const dailyPayments = await prisma.$queryRaw`
      SELECT 
        DATE("paidAt") as date,
        COUNT(*) as count,
        COALESCE(SUM("amount"), 0) as total
      FROM "payments" 
      WHERE 
        "paidAt" >= ${startDate}
        AND status = 'COMPLETED'
      GROUP BY DATE("paidAt")
      ORDER BY date DESC
    `;

    res.json({
      success: true,
      data: dailyPayments
    });
  });

  exportToExcel = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Exportación a Excel no implementada aún'
      }
    });
  });

  exportToPDF = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Exportación a PDF no implementada aún'
      }
    });
  });

  reconcilePayments = asyncHandler(async (req, res) => {
    // This would integrate with external payment systems
    // to reconcile payments with bank records
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reconciliación no implementada aún'
      }
    });
  });

  backfillMissingPayments = asyncHandler(async (req, res) => {
    // Find all PAID invoices WITHOUT any Payment records
    const candidates = await prisma.invoice.findMany({
      where: {
        status: 'PAID',
        payments: { none: {} }
      },
      include: { client: true }
    });

    const created = [];
    for (const inv of candidates) {
      const p = await prisma.payment.create({
        data: {
          invoiceId: inv.id,
          clientId: inv.clientId,
          amount: inv.total,
          method: 'OTHER',
          status: 'COMPLETED',
          notes: 'Backfill — pago importado desde estado de factura PAID sin registro en payments',
          createdByUserId: req.user?.id,
          createdByUserName: req.user?.name || 'system',
          createdAt: inv.paidDate || inv.updatedAt
        }
      });
      created.push(p);
    }

    res.json({
      success: true,
      data: {
        scanned: candidates.length,
        created: created.length
      },
      message: `Backfill completado. ${created.length} registro(s) de pago creado(s) de ${candidates.length} factura(s) PAID sin pagos.`
    });
  });

  getConsolidatedReport = asyncHandler(async (req, res) => {
    const { dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      throw new AppError('dateFrom y dateTo son requeridos (formato YYYY-MM-DD)', 400, 'MISSING_DATES');
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const [payments, byMethod, totalAgg] = await Promise.all([
      prisma.payment.findMany({
        where: {
          createdAt: { gte: from, lte: to }
        },
        include: {
          invoice: { select: { invoiceNumber: true } },
          client: { select: { name: true, documentNumber: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: {
          status: 'COMPLETED',
          createdAt: { gte: from, lte: to }
        },
        _count: true,
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: { gte: from, lte: to }
        },
        _sum: { amount: true },
        _count: true
      })
    ]);

    const format = req.query.format;

    if (format === 'csv') {
      const header = 'ID,Factura,Cliente,Documento,Monto,Metodo,Estado,Fecha,Creado por\n';
      const rows = payments.map(p =>
        `"${p.id.slice(-8)}","${p.invoice?.number || ''}","${p.client?.name || ''}","${p.client?.documentNumber || ''}",${(p.amount / 100).toFixed(2)},${p.method},${p.status},${p.createdAt?.toISOString().split('T')[0] || ''},"${p.createdByUserName || ''}"`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reporte-pagos-${dateFrom}-${dateTo}.csv"`);
      return res.send('\uFEFF' + header + rows);
    }

    res.json({
      success: true,
      data: {
        period: { from: dateFrom, to: dateTo },
        summary: {
          totalPayments: totalAgg._count,
          totalAmount: totalAgg._sum.amount || 0,
          byMethod
        },
        payments
      }
    });
  });

  getReconciliationReport = asyncHandler(async (req, res) => {
    const { dateFrom, dateTo } = req.query;

    const where = {
      ...(dateFrom && dateTo && {
        createdAt: {
          gte: new Date(dateFrom),
          lte: new Date(dateTo)
        }
      })
    };

    const [payments, totalAmount, byMethod] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
              client: {
                select: {
                  name: true,
                  documentNumber: true
                }
              }
            }
          }
        }
      }),
      prisma.payment.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { amount: true }
      }),
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: { ...where, status: 'COMPLETED' },
        _count: true,
        _sum: { amount: true }
      })
    ]);

    res.json({
      success: true,
      data: {
        payments,
        totalAmount: totalAmount._sum.amount || 0,
        byMethod
      }
    });
  });
}

export const paymentController = new PaymentsController();
