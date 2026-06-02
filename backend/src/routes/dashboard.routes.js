import { Router } from 'express';
import { prisma } from '../config/database.js';
const router = Router();

router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalClients,
      clientsByStatus,
      clientsByPlanRaw,
      totalInvoices,
      invoicesByStatus,
      pendingAggregate,
      paidThisMonthAggregate,
      totalRouters,
      activePlans,
    ] = await Promise.all([
      prisma.client.count(),
      prisma.client.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.client.groupBy({ by: ['planId'], _count: { _all: true } }),
      prisma.invoice.count(),
      prisma.invoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { total: true } }),
      prisma.invoice.aggregate({
        where: { status: { in: ['PENDING', 'OVERDUE'] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.router.count(),
      prisma.plan.count({ where: { isActive: true } }),
    ]);

    // Resolve plan names for the byPlan breakdown
    const planIds = clientsByPlanRaw.map(p => p.planId).filter(Boolean);
    const plans = planIds.length
      ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } })
      : [];
    const planNameById = Object.fromEntries(plans.map(p => [p.id, p.name]));
    const clientsByPlan = clientsByPlanRaw.map(p => ({
      planId: p.planId,
      name: p.planId ? (planNameById[p.planId] || '(plan eliminado)') : '(sin plan)',
      count: p._count._all,
    }));

    res.json({
      success: true,
      data: {
        kpis: {
          totalClients,
          activeClients:  clientsByStatus.find(s => s.status === 'ACTIVE')?._count._all ?? 0,
          totalInvoices,
          pendingInvoices: pendingAggregate._count._all,
          pendingAmount:   pendingAggregate._sum.total || 0,           // cents
          paidThisMonth:   paidThisMonthAggregate._sum.amount || 0,    // cents
          totalRouters,
          activePlans,
        },
        clientsByStatus: clientsByStatus.map(s => ({ status: s.status, count: s._count._all })),
        clientsByPlan,
        invoicesByStatus: invoicesByStatus.map(s => ({
          status: s.status,
          count:  s._count._all,
          total:  s._sum.total || 0,
        })),
      },
    });
  } catch (e) {
    console.error('GET /dashboard/stats failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
