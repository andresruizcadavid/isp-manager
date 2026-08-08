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

// PaymentLink solo tiene el escalar `paymentAttemptId` (no relación) → adjunta
// el PaymentAttempt correspondiente por join manual, mutando cada link.
async function attachAttempts(links) {
  const ids = [...new Set(links.map(l => l.paymentAttemptId).filter(Boolean))];
  if (!ids.length) { for (const l of links) l.paymentAttempt = null; return links; }
  const atts = await prisma.paymentAttempt.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, checkoutUrl: true, externalId: true, createdAt: true }
  });
  const map = new Map(atts.map(a => [a.id, a]));
  for (const l of links) l.paymentAttempt = l.paymentAttemptId ? (map.get(l.paymentAttemptId) || null) : null;
  return links;
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
          invoice: { select: { id: true, invoiceNumber: true, total: true, status: true, dueDate: true } }
        }
      }),
      prisma.paymentLink.count({ where })
    ]);

    // PaymentLink no tiene relación `paymentAttempt` (solo el escalar
    // paymentAttemptId) → join manual para no romper con include inválido.
    await attachAttempts(links);

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
    const cli = { select: { id: true, name: true, email: true, documentType: true, documentNumber: true } };
    const inv = { select: { id: true, invoiceNumber: true, total: true, balanceDue: true, status: true } };

    // (A) Links expirados/cancelados con la factura AÚN sin pago completado.
    const expiredLinks = await prisma.paymentLink.findMany({
      where: { status: { in: ['expired', 'cancelled'] } },
      include: { client: cli, invoice: inv }
    });
    const expiredNoPayment = [];
    for (const link of expiredLinks) {
      if (!link.invoice) continue;
      const cnt = await prisma.payment.count({ where: { invoiceId: link.invoice.id, status: 'COMPLETED' } });
      if (cnt === 0) expiredNoPayment.push({
        type: 'link_expirado_sin_pago', reference: link.reference, client: link.client, invoice: link.invoice,
        amountInCents: link.amountInCents, linkStatus: link.status, attemptStatus: null,
        linkId: link.id, attemptId: link.paymentAttemptId || null, linkCreatedAt: link.createdAt, reconcilable: false
      });
    }

    // (B) Pagos WOMPI cuya factura NO tiene ningún PaymentLink (pago manual sin link).
    const wompiPayments = await prisma.payment.findMany({
      where: { method: 'WOMPI', status: 'COMPLETED' },
      include: { invoice: inv, client: cli }, orderBy: { createdAt: 'desc' }, take: 200
    });
    const orphanPayments = [];
    for (const pay of wompiPayments) {
      const linkCnt = await prisma.paymentLink.count({ where: { invoiceId: pay.invoiceId } });
      if (linkCnt === 0) orphanPayments.push({
        type: 'pago_huerfano_sin_link', reference: pay.transactionId || pay.id, client: pay.client, invoice: pay.invoice,
        amountInCents: pay.amount, linkStatus: null, attemptStatus: 'COMPLETED',
        linkId: null, attemptId: null, linkCreatedAt: pay.createdAt, reconcilable: false
      });
    }

    // (C) Intentos COMPLETADOS sin Payment WOMPI → el dinero entró pero no se
    //     registró el pago ni se marcó la factura. CONCILIABLE (acción 1-clic).
    const completedAttempts = await prisma.paymentAttempt.findMany({
      where: { status: 'COMPLETED' },
      include: { invoice: inv, client: cli }, orderBy: { createdAt: 'desc' }, take: 200
    });
    const attemptNoPayment = [];
    for (const att of completedAttempts) {
      const pay = await prisma.payment.findFirst({ where: { invoiceId: att.invoiceId, method: 'WOMPI', status: 'COMPLETED' } });
      if (!pay) attemptNoPayment.push({
        type: 'attempt_completado_sin_payment', reference: att.reference, client: att.client, invoice: att.invoice,
        amountInCents: att.amount, linkStatus: null, attemptStatus: att.status,
        linkId: null, attemptId: att.id, linkCreatedAt: att.createdAt, reconcilable: true
      });
    }

    const items = [...expiredNoPayment, ...orphanPayments, ...attemptNoPayment];
    items.sort((a, b) => new Date(b.linkCreatedAt || 0).getTime() - new Date(a.linkCreatedAt || 0).getTime());

    res.json({
      success: true,
      data: {
        items,
        counts: {
          expiredNoPayment: expiredNoPayment.length,
          orphanPayments: orphanPayments.length,
          attemptNoPayment: attemptNoPayment.length
        }
      }
    });
  } catch (e) { next(e); }
});

// ── 4b. Conciliar: crear el Payment faltante de un intento COMPLETED ──────
// Registra el Payment WOMPI, re-liquida la factura, marca el link como pagado
// y levanta la cobranza (aviso/suspensión) del cliente. Idempotente.
router.post('/conciliation/reconcile', async (req, res, next) => {
  try {
    const { attemptId } = req.body || {};
    if (!attemptId) return res.status(400).json({ success: false, error: { message: 'attemptId requerido' } });
    const att = await prisma.paymentAttempt.findUnique({ where: { id: attemptId }, include: { invoice: true } });
    if (!att) return res.status(404).json({ success: false, error: { message: 'Intento no encontrado' } });
    if (att.status !== 'COMPLETED') return res.status(400).json({ success: false, error: { message: 'El intento no está COMPLETED' } });
    if (!att.invoice) return res.status(400).json({ success: false, error: { message: 'El intento no tiene factura' } });

    const existing = await prisma.payment.findFirst({ where: { invoiceId: att.invoiceId, method: 'WOMPI', status: 'COMPLETED' } });
    if (existing) return res.json({ success: true, data: { alreadyReconciled: true, paymentId: existing.id } });

    const inv = att.invoice;
    const total = inv.total ?? inv.amount ?? 0;
    const paidAgg = await prisma.payment.aggregate({ where: { invoiceId: inv.id, status: 'COMPLETED' }, _sum: { amount: true } });
    const paid = paidAgg._sum.amount || 0;
    const payAmount = Math.min(att.amount, Math.max(0, total - paid)) || att.amount;
    const remaining = Math.max(0, total - (paid + payAmount));
    const newStatus = remaining === 0 ? 'PAID' : 'PARTIAL';

    const [payment] = await prisma.$transaction([
      prisma.payment.create({ data: {
        invoiceId: inv.id, clientId: att.clientId, amount: payAmount, method: 'WOMPI', status: 'COMPLETED',
        transactionId: att.externalId || att.reference, notes: 'Conciliado desde Trazabilidad WOMPI',
        createdByUserName: req.user?.name || 'Conciliación'
      }}),
      prisma.invoice.update({ where: { id: inv.id }, data: {
        balanceDue: remaining, status: newStatus, ...(remaining === 0 ? { paidDate: new Date() } : {})
      }})
    ]);
    await prisma.paymentLink.updateMany({ where: { paymentAttemptId: att.id }, data: { status: 'paid', paidAt: new Date() } }).catch(() => {});

    // Levantar cobranza (quita aviso; reactiva si ya no debe). Best-effort.
    let collection = null;
    try { const { liftCollectionOnPayment } = await import('../services/aviso-portal.service.js'); collection = await liftCollectionOnPayment(att.clientId); } catch { /* noop */ }

    res.json({ success: true, data: { reconciled: true, paymentId: payment.id, invoiceStatus: newStatus, amount: payAmount, collection } });
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
        campaign: true
      }
    });
    if (!link) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Link de pago no encontrado' } });
    }
    // PaymentLink no tiene relación paymentAttempt → adjuntar por join manual.
    link.paymentAttempt = link.paymentAttemptId
      ? await prisma.paymentAttempt.findUnique({ where: { id: link.paymentAttemptId } })
      : null;
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
