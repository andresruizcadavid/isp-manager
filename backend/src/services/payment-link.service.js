import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { wompiService } from './wompi.service.js';
import { AppError } from '../middleware/error.middleware.js';

function generateReference(clientId) {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `PL-${clientId.slice(0, 6)}-${ts}-${rand}`;
}

class PaymentLinkService {

  // ── Create a single payment link for an invoice ──────────────────
  async createForInvoice(invoiceId, { expiresInDays = 30, redirectUrl } = {}) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true }
    });
    if (!invoice) throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    if (invoice.status === 'PAID') throw new AppError('La factura ya está pagada', 400, 'ALREADY_PAID');

    const reference = generateReference(invoice.clientId);
    const amountInCents = invoice.balanceDue > 0 ? invoice.balanceDue : invoice.total;

    // Call Wompi to create the payment link
    const checkout = await wompiService.createCheckout(invoice, { redirectUrl });

    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);

    const paymentLink = await prisma.paymentLink.create({
      data: {
        clientId: invoice.clientId,
        invoiceId: invoice.id,
        reference,
        amountInCents,
        currency: 'COP',
        checkoutUrl: checkout.checkoutUrl,
        wompiLinkId: checkout.wompiLinkId || null,
        status: 'pending',
        expiresAt,
        paymentAttemptId: checkout.paymentAttemptId || null
      }
    });

    return paymentLink;
  }

  // ── Create payment links in bulk ──────────────────────────────
  async createBulk(invoiceIds, { expiresInDays = 30 } = {}) {
    const results = [];
    for (const id of invoiceIds) {
      try {
        const link = await this.createForInvoice(id, { expiresInDays });
        results.push({ invoiceId: id, ok: true, paymentLinkId: link.id, checkoutUrl: link.checkoutUrl });
      } catch (e) {
        results.push({ invoiceId: id, ok: false, error: e.message });
      }
    }
    return results;
  }

  // ── Get links for a client ──────────────────────────────────────
  async getByClient(clientId) {
    return prisma.paymentLink.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      include: { invoice: { select: { id: true, invoiceNumber: true, total: true, status: true, dueDate: true } } }
    });
  }

  // ── Get link by id (for the notification UI) ──────────────────
  async getById(id) {
    return prisma.paymentLink.findUnique({
      where: { id },
      include: { client: { select: { id: true, name: true, email: true } }, invoice: true }
    });
  }
}

export const paymentLinkService = new PaymentLinkService();
