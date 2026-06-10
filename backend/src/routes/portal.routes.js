import { Router } from 'express';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { clientAuthMiddleware } from '../middleware/client-auth.middleware.js';
import { paymentLinkService } from '../services/payment-link.service.js';

const router = Router();

// All portal routes require client authentication
router.use(clientAuthMiddleware);

// GET /api/v1/portal/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const clientId = req.client.id;

    const [invoices, pendingInvoices, lastPayment, plan] = await Promise.all([
      prisma.invoice.findMany({
        where: { clientId },
        orderBy: { issueDate: 'desc' },
        take: 5,
        select: { id: true, invoiceNumber: true, total: true, balanceDue: true, status: true, dueDate: true, paidDate: true, periodYear: true, periodMonth: true }
      }),
      prisma.invoice.count({
        where: { clientId, status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] } }
      }),
      prisma.payment.findFirst({
        where: { clientId, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        select: { amount: true, createdAt: true, method: true }
      }),
      req.client.planId ? prisma.plan.findUnique({ where: { id: req.client.planId } }) : null
    ]);

    const totalDue = invoices
      .filter(i => i.status === 'PENDING' || i.status === 'OVERDUE' || i.status === 'PARTIAL')
      .reduce((sum, i) => sum + (i.balanceDue > 0 ? i.balanceDue : i.total), 0);

    res.json({
      success: true,
      data: {
        client: {
          name: req.client.name,
          email: req.client.email,
          phone: req.client.phone,
          address: req.client.address,
          status: req.client.status,
          memberSince: req.client.createdAt
        },
        plan: plan ? { name: plan.name, downloadSpeed: plan.downloadSpeed, uploadSpeed: plan.uploadSpeed, monthlyPrice: plan.monthlyPrice } : null,
        summary: {
          pendingInvoices,
          totalDue,
          lastPayment: lastPayment ? { amount: lastPayment.amount, date: lastPayment.createdAt, method: lastPayment.method } : null
        },
        recentInvoices: invoices
      }
    });
  } catch (e) { next(e); }
});

// GET /api/v1/portal/invoices
router.get('/invoices', async (req, res, next) => {
  try {
    const clientId = req.client.id;
    const invoices = await prisma.invoice.findMany({
      where: { clientId },
      orderBy: { issueDate: 'desc' },
      include: {
        payments: { select: { id: true, amount: true, status: true, method: true, createdAt: true } },
        items: true
      }
    });
    res.json({ success: true, data: invoices });
  } catch (e) { next(e); }
});

// GET /api/v1/portal/invoices/:id
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, clientId: req.client.id },
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        items: true
      }
    });
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Factura no encontrada' } });
    }
    res.json({ success: true, data: invoice });
  } catch (e) { next(e); }
});

// GET /api/v1/portal/invoices/:id/status — lightweight status check for polling
router.get('/invoices/:id/status', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, clientId: req.client.id },
      select: { id: true, status: true, balanceDue: true, paidDate: true }
    });
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Factura no encontrada' } });
    }
    res.json({ success: true, data: invoice });
  } catch (e) { next(e); }
});

// POST /api/v1/portal/invoices/:id/pay — generate payment link for an invoice
router.post('/invoices/:id/pay', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: { id: req.params.id, clientId: req.client.id }
    });
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Factura no encontrada' } });
    }
    if (invoice.status === 'PAID') {
      return res.status(400).json({ success: false, error: { code: 'ALREADY_PAID', message: 'La factura ya está pagada' } });
    }

    const redirectUrl = `${env.FRONTEND_URL}/portal/invoices/${invoice.id}?wompi_attempt=poll`;
    const link = await paymentLinkService.createForInvoice(invoice.id, { redirectUrl });
    res.json({ success: true, data: { checkoutUrl: link.checkoutUrl } });
  } catch (e) { next(e); }
});

// GET /api/v1/portal/payments
router.get('/payments', async (req, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { clientId: req.client.id },
      orderBy: { createdAt: 'desc' },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true } }
      }
    });
    res.json({ success: true, data: payments });
  } catch (e) { next(e); }
});

// GET /api/v1/portal/profile
router.get('/profile', async (req, res) => {
  const { client, clientUser } = req;
  res.json({
    success: true,
    data: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      address: client.address,
      neighborhood: client.neighborhood,
      city: client.city,
      documentType: client.documentType,
      documentNumber: client.documentNumber,
      status: client.status,
      planId: client.planId,
      monthlyFee: client.monthlyFee,
      balance: client.balance,
      memberSince: client.createdAt,
      hasPassword: !!clientUser.passwordHash
    }
  });
});

export default router;
