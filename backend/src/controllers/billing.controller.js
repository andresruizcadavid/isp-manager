import { prisma } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { billingService } from '../services/billing.service.js';
import { invoiceService } from '../services/invoice.service.js';

class BillingController {
  getBillingMonths = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const result = await billingService.getBillingMonths(id, year);
    res.json({ success: true, data: result });
  });

  generateInvoices = asyncHandler(async (req, res) => {
    const { id: clientId } = req.params;
    const { months } = req.body;
    const userId = req.user?.id;

    if (!months || !Array.isArray(months) || months.length === 0) {
      throw new AppError('Debe seleccionar al menos un mes', 400, 'INVALID_MONTHS');
    }

    for (const m of months) {
      if (!m.year || !m.month || m.month < 1 || m.month > 12) {
        throw new AppError('Formato de mes inválido', 400, 'INVALID_MONTH_FORMAT');
      }
    }

    const result = await billingService.generateInvoices(clientId, months, userId);
    res.json({ success: true, data: result });
  });

  registerPayment = asyncHandler(async (req, res) => {
    const { invoiceIds, amount, paymentMethod, notes, paymentDate } = req.body;

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      throw new AppError('Debe seleccionar al menos una factura', 400, 'INVALID_INVOICES');
    }

    if (!amount || amount <= 0) {
      throw new AppError('Monto inválido', 400, 'INVALID_AMOUNT');
    }

    if (!paymentMethod) {
      throw new AppError('Método de pago requerido', 400, 'INVALID_PAYMENT_METHOD');
    }

    // Get clientId from first invoice
    const firstInvoice = await prisma.invoice.findUnique({ where: { id: invoiceIds[0] } });
    if (!firstInvoice) throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');

    const amountCents = Math.round(amount * 100);
    const result = await billingService.registerPayment(
      firstInvoice.clientId,
      invoiceIds,
      amountCents,
      paymentMethod,
      notes,
      paymentDate,
      req.user?.id,
      req.user?.name
    );

    res.status(201).json({
      success: true,
      data: result,
      message: 'Pago registrado exitosamente'
    });
  });

  uploadPaymentEvidence = asyncHandler(async (req, res) => {
    const { id: paymentId } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: true }
    });

    if (!payment) {
      throw new AppError('Pago no encontrado', 404, 'PAYMENT_NOT_FOUND');
    }

    if (!req.file) {
      throw new AppError('Debe adjuntar una imagen', 400, 'NO_FILE');
    }

    const evidence = await prisma.clientEvidencePhoto.create({
      data: {
        clientId: payment.clientId,
        paymentId: payment.id,
        type: 'payment',
        description: req.body.description || `Comprobante de pago - Factura ${payment.invoice.invoiceNumber}`,
        fileUrl: `/uploads/evidence/${req.file.filename}`,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      }
    });

    res.status(201).json({
      success: true,
      data: evidence,
      message: 'Comprobante adjuntado'
    });
  });
}

export const billingController = new BillingController();
