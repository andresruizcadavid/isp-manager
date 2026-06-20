// Payments controller — five live methods after the "Pagos Recibidos" +
// "Registrar Pago" UI removal.
//
//   • createPayment          — POST /payments
//   • syncInvoiceStatuses    — POST /invoices/sync-status (data-repair tool)
//   • wompiWebhook           — POST /webhooks/wompi (public, no auth)
//   • getWompiCheckout       — GET  /payments/wompi/checkout/:invoiceId
//   • backfillMissingPayments— POST /payments/backfill (data-repair tool)
//
// All other former methods (list, detail, update, delete, refund, stats,
// exports, reconcile, consolidated report) were removed along with the
// UI surfaces that consumed them. Wompi async confirmations still drive
// Payment + Invoice updates through wompi.service.

import { prisma } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { wompiService } from '../services/wompi.service.js';
import { notificationService } from '../services/notification.service.js';

class PaymentsController {

  createPayment = asyncHandler(async (req, res) => {
    const { invoiceId, amount, paymentMethod, notes } = req.body;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true, payments: true }
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
    // Use `total` (amount + tax − discount), NOT `amount`, so the balance math
    // is correct on invoices with IVA/descuento. This matches the canonical
    // logic in wompi.service.updateInvoiceStatus and avoids under-collecting.
    const invoiceTotal = invoice.total ?? invoice.amount;
    if (previousPaid + amountCents > invoiceTotal) {
      throw new AppError('El monto del pago excede el saldo de la factura', 400, 'PAYMENT_EXCEEDS_INVOICE');
    }

    const newTotalPaid = previousPaid + amountCents;
    const remaining    = Math.max(0, invoiceTotal - newTotalPaid);
    const newStatus    = remaining === 0 ? 'PAID' : 'PARTIAL';

    // Atomic: create payment + sync invoice status + balanceDue.
    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId,
          clientId: invoice.clientId,
          amount: amountCents,
          method: paymentMethod,
          status: 'COMPLETED',
          notes: notes || null,
          createdByUserId:   req.user?.id,
          createdByUserName: req.user?.name
        },
        include: { invoice: { include: { client: true } } }
      }),
      prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status:     newStatus,
          balanceDue: remaining,
          ...(newStatus === 'PAID' && { paidDate: new Date() })
        }
      })
    ]);

    // Notification is best-effort; don't fail the request if it errors.
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
      // Compare against `total` (amount + tax − discount) to stay consistent
      // with the manual-payment and Wompi paths.
      const invTotal = inv.total ?? inv.amount;
      const remaining = Math.max(0, invTotal - paid);
      let nextStatus = inv.status;
      if (paid >= invTotal) nextStatus = 'PAID';
      else if (paid > 0)    nextStatus = 'PARTIAL';

      const needsUpdate = inv.status !== nextStatus || (inv.balanceDue ?? 0) !== remaining;
      if (needsUpdate) {
        updates.push(prisma.invoice.update({
          where: { id: inv.id },
          data: {
            status:     nextStatus,
            balanceDue: remaining,
            ...(nextStatus === 'PAID' && !inv.paidDate && { paidDate: new Date() })
          }
        }));
      }
    }

    if (updates.length) await prisma.$transaction(updates);

    res.json({
      success: true,
      data: { scanned: candidates.length, updated: updates.length },
      message: `Sincronización completada. ${updates.length} factura(s) actualizada(s) de ${candidates.length} revisada(s).`
    });
  });

  wompiWebhook = asyncHandler(async (req, res) => {
    // Wompi sends the signature INSIDE the body (`signature.checksum`),
    // not as an HTTP header. See wompi.service.verifyWebhookSignature for
    // the full spec.
    const isValid = wompiService.verifyWebhookSignature(req.body);
    if (!isValid) {
      console.warn('[wompi] webhook rejected: invalid signature', {
        event: req.body?.event,
        ref:   req.body?.data?.transaction?.reference
      });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Firma inválida' }
      });
    }

    const { event } = req.body;
    try {
      if (event === 'transaction.updated') {
        await wompiService.handleTransactionUpdate(req.body);
      } else if (event) {
        await wompiService.handleWebhookEvent(event, req.body.data);
      }
    } catch (e) {
      console.error('[wompi] webhook handler failed:', e.message);
      // ACK 200 anyway: Wompi retries on non-2xx; signature was OK.
    }

    res.json({ success: true, message: 'Webhook procesado' });
  });

  getWompiCheckout = asyncHandler(async (req, res) => {
    const { invoiceId } = req.params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true } }
      }
    });
    if (!invoice) {
      throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    }
    if (invoice.status === 'PAID') {
      throw new AppError('La factura ya está pagada', 400, 'INVOICE_ALREADY_PAID');
    }

    const result = await wompiService.createCheckout(invoice);
    res.json({ success: true, data: { redirectUrl: result.checkoutUrl } });
  });

  backfillMissingPayments = asyncHandler(async (req, res) => {
    // Find PAID invoices WITHOUT any Payment records — legacy data fix.
    const candidates = await prisma.invoice.findMany({
      where: { status: 'PAID', payments: { none: {} } },
      include: { client: true }
    });

    const created = [];
    for (const inv of candidates) {
      const p = await prisma.payment.create({
        data: {
          invoiceId: inv.id,
          clientId:  inv.clientId,
          amount:    inv.total,
          method:    'OTHER',
          status:    'COMPLETED',
          notes:     'Backfill — pago importado desde estado de factura PAID sin registro en payments',
          createdByUserId:   req.user?.id,
          createdByUserName: req.user?.name || 'system',
          createdAt: inv.paidDate || inv.updatedAt
        }
      });
      created.push(p);
    }

    res.json({
      success: true,
      data: { scanned: candidates.length, created: created.length },
      message: `Backfill completado. ${created.length} registro(s) de pago creado(s) de ${candidates.length} factura(s) PAID sin pagos.`
    });
  });
}

export const paymentController = new PaymentsController();
