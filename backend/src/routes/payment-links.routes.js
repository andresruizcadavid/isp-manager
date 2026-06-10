import { Router } from 'express';
import { prisma } from '../config/database.js';

const router = Router();

const LINK_STATUSES = ['pending', 'paid', 'expired', 'cancelled'];
const ATTEMPT_STATUSES = ['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED'];

// ── Helpers ────────────────────────────────────────────────────────────
function pagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  return { skip: (page - 1) * limit, take: limit, page, limit };
}

function dateFilter(start, end) {
  const f = {};
  if (start) f.gte = new Date(start);
  if (end)   f.lte = new Date(end);
  return Object.keys(f).length ? f : undefined;
}

// ── 1. Links de Pago ──────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { status, q, clientId, dateFrom, dateTo } = req.query;
    const { skip, take, page, limit } = pagination(req.query);

    const where = {};
    if (status && LINK_STATUSES.includes(status)) where.status = status;
    if (clientId) where.clientId = clientId;
    const df = dateFilter(dateFrom, dateTo);
    if (df) where.createdAt = df;
    if (q) {
      where.OR = [
        { reference: { contains: q } },
        { client: { name: { contains: q, mode: 'insensitive' } } },
        { client: { documentNumber: { contains: q } } },
        { invoice: { invoiceNumber: { contains: q } } }
      ];
    }

    const [links, total] = await Promise.all([
      prisma.paymentLink.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true, email: true, documentNumber: true, documentType: true } },
          invoice: { select: { id: true, invoiceNumber: true, total: true, status: true, dueDate: true } },
          paymentAttempt: { select: { id: true, status: true, checkoutUrl: true, externalId: true, createdAt: true } }
        }
      }),
      prisma.paymentLink.count({ where })
    ]);

    const summary = await prisma.paymentLink.groupBy({ by: ['status'], _count: true });

    res.json({
      success: true,
      data: { links, total, page, pages: Math.ceil(total / limit), summary }
    });
  } catch (e) { next(e); }
});

// ── 2. Payment Attempts ──────────────────────────────────────────────
router.get('/attempts', async (req, res, next) => {
  try {
    const { status, q, clientId, dateFrom, dateTo } = req.query;
    const { skip, take, page, limit } = pagination(req.query);

    const where = {};
    if (status && ATTEMPT_STATUSES.includes(status)) where.status = status;
    if (clientId) where.clientId = clientId;
    const df = dateFilter(dateFrom, dateTo);
    if (df) where.createdAt = df;
    if (q) {
      where.OR = [
        { reference: { contains: q } },
        { invoice: { invoiceNumber: { contains: q } } },
        { client: { name: { contains: q, mode: 'insensitive' } } }
      ];
    }

    const [attempts, total] = await Promise.all([
      prisma.paymentAttempt.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: {
          invoice: { select: { id: true, invoiceNumber: true, total: true, status: true } },
          client: { select: { id: true, name: true, email: true, documentNumber: true, documentType: true } }
        }
      }),
      prisma.paymentAttempt.count({ where })
    ]);

    const summary = await prisma.paymentAttempt.groupBy({ by: ['status'], _count: true });

    res.json({
      success: true,
      data: { attempts, total, page, pages: Math.ceil(total / limit), summary }
    });
  } catch (e) { next(e); }
});

// ── 3. Attempt detail (with webhookPayload) ──────────────────────────
router.get('/attempts/:id', async (req, res, next) => {
  try {
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { id: req.params.id },
      include: {
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' } } } },
        client: { select: { id: true, name: true, email: true, documentNumber: true, documentType: true, phone: true } }
      }
    });
    if (!attempt) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Intento no encontrado' } });
    }
    res.json({ success: true, data: attempt });
  } catch (e) { next(e); }
});

// ── 4. Conciliación ──────────────────────────────────────────────────
router.get('/conciliation', async (req, res, next) => {
  try {
    // (A) Links expirados SIN Payment completo asociado
    const expiredOrphans = await prisma.paymentLink.findMany({
      where: { status: { in: ['expired', 'cancelled'] } },
      include: {
        client: { select: { id: true, name: true, email: true } },
        invoice: { select: { id: true, invoiceNumber: true, total: true, status: true } },
        paymentAttempt: { select: { id: true, status: true } }
      }
    });

    // Filter: only those without a COMPLETED payment on the invoice
    const expiredNoPayment = [];
    for (const link of expiredOrphans) {
      if (!link.invoice) continue;
      const completedPayments = await prisma.payment.count({
        where: { invoiceId: link.invoice.id, status: 'COMPLETED' }
      });
      if (completedPayments === 0) {
        expiredNoPayment.push({
          type: 'link_expirado_sin_pago',
          reference: link.reference,
          client: link.client,
          invoice: link.invoice,
          amountInCents: link.amountInCents,
          linkStatus: link.status,
          attemptStatus: link.paymentAttempt?.status || null,
          linkId: link.id,
          linkCreatedAt: link.createdAt
        });
      }
    }

    // (B) Payments WOMPI SIN PaymentLink asociado (huérfanos)
    const orphanPayments = await prisma.payment.findMany({
      where: { method: 'WOMPI', paymentLinks: { none: {} } },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true, status: true } },
        client: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    const orphanPaymentRows = orphanPayments.map(p => ({
      type: 'pago_huertfano_sin_link',
      reference: p.transactionId || p.id,
      client: p.client,
      invoice: p.invoice,
      amountInCents: p.amount,
      linkStatus: null,
      attemptStatus: 'COMPLETED',
      linkId: null,
      linkCreatedAt: null
    }));

    // (C) PaymentAttempt COMPLETED sin Payment (error conciliación)
    const completedAttempts = await prisma.paymentAttempt.findMany({
      where: { status: 'COMPLETED' },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true, status: true } },
        client: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    const attemptNoPayment = [];
    for (const att of completedAttempts) {
      const paymentExists = await prisma.payment.findFirst({
        where: { invoiceId: att.invoiceId, method: 'WOMPI' }
      });
      if (!paymentExists) {
        attemptNoPayment.push({
          type: 'attempt_completado_sin_payment',
          reference: att.reference,
          client: att.client,
          invoice: att.invoice,
          amountInCents: att.amount,
          linkStatus: null,
          attemptStatus: att.status,
          linkId: null,
          linkCreatedAt: null
        });
      }
    }

    const allItems = [...expiredNoPayment, ...orphanPaymentRows, ...attemptNoPayment];
    allItems.sort((a, b) => (b.linkCreatedAt || 0) - (a.linkCreatedAt || 0));

    res.json({
      success: true,
      data: {
        items: allItems,
        counts: {
          expiredNoPayment: expiredNoPayment.length,
          orphanPayments: orphanPaymentRows.length,
          attemptNoPayment: attemptNoPayment.length
        }
      }
    });
  } catch (e) { next(e); }
});

// ── 5. Reenviar link (regenerar si expiró) ───────────────────────────
router.post('/:id/resend', async (req, res, next) => {
  try {
    const link = await prisma.paymentLink.findUnique({
      where: { id: req.params.id },
      include: { invoice: { include: { client: true } } }
    });
    if (!link) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Link no encontrado' } });
    }
    if (link.status === 'paid') {
      return res.status(400).json({ success: false, error: { code: 'ALREADY_PAID', message: 'La factura ya está pagada' } });
    }

    const { paymentLinkService } = await import('../services/payment-link.service.js');
    const newLink = await paymentLinkService.createForInvoice(link.invoiceId);

    res.json({ success: true, data: { checkoutUrl: newLink.checkoutUrl, id: newLink.id } });
  } catch (e) { next(e); }
});

// ── 7. Detail de link ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const link = await prisma.paymentLink.findUnique({
      where: { id: req.params.id },
      include: {
        client: { select: { id: true, name: true, email: true, phone: true, documentNumber: true, documentType: true } },
        invoice: { include: { payments: { orderBy: { createdAt: 'desc' } } } },
        paymentAttempt: true,
        campaign: true
      }
    });
    if (!link) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Link de pago no encontrado' } });
    }
    res.json({ success: true, data: link });
  } catch (e) { next(e); }
});

// ── Public pixel tracker (no auth — loaded by email clients) ──
export const pixelRouter = Router({ mergeParams: false });

pixelRouter.get('/payment-links/pixel/:paymentLinkId', async (req, res) => {
  try {
    await prisma.paymentLink.update({
      where: { id: req.params.paymentLinkId },
      data: { openedAt: new Date() }
    });
  } catch (e) {
    // Silently ignore
  }
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-cache, private, max-age=0'
  });
  res.end(pixel);
});

export default router;
