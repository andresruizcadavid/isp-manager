import { Router } from 'express';
import { prisma } from '../config/database.js';
const router = Router();

const OPEN = ['PENDING', 'OVERDUE', 'PARTIAL'];

router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const isTech = req.user?.role === 'TECHNICIAN';

    const [
      totalClients,
      clientsByStatus,
      clientsByPlanRaw,
      clientsByTech,
      totalInvoices,
      invoicesByStatus,
      pendingAggregate,
      paidThisMonthAggregate,
      totalRouters,
      activePlans,
      pendingInstalls,
      routers,
    ] = await Promise.all([
      prisma.client.count(),
      prisma.client.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.client.groupBy({ by: ['planId'], _count: { _all: true } }),
      prisma.client.groupBy({ by: ['connectionType'], _count: { _all: true } }),
      prisma.invoice.count(),
      prisma.invoice.groupBy({ by: ['status'], _count: { _all: true }, _sum: { total: true } }),
      // Deuda por cobrar (definición ÚNICA, = Facturas/Planilla): SALDO
      // pendiente (balanceDue) de facturas abiertas, todos los períodos.
      prisma.invoice.aggregate({ where: { status: { in: OPEN }, balanceDue: { gt: 0 } }, _sum: { balanceDue: true }, _count: { _all: true } }),
      prisma.payment.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.router.count(),
      prisma.plan.count({ where: { isActive: true } }),
      prisma.client.count({ where: { status: 'ACTIVE', installationDate: null } }),
      prisma.router.findMany({
        select: { id: true, name: true, status: true, location: true, _count: { select: { mikrotikAccounts: true } } },
        orderBy: { name: 'asc' }
      }),
    ]);

    // Plan-name breakdown
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

    // Technology mix (Fibra vs Inalámbrico)
    const byTechnology = clientsByTech.map(t => ({ technology: t.connectionType || 'FIBER', count: t._count._all }));

    // Router health + load (operational — for everyone)
    const routersHealth = routers.map(r => ({
      id: r.id, name: r.name, status: r.status, location: r.location, accounts: r._count.mikrotikAccounts
    }));
    const routersDown = routersHealth.filter(r => ['OFFLINE', 'DEGRADED'].includes(r.status)).length;

    // Inventory snapshot (best-effort — module may be empty)
    let inventory = null;
    try {
      const inv = await prisma.inventoryItem.groupBy({ by: ['status'], _count: { _all: true } });
      inventory = inv.reduce((a, i) => ({ ...a, [i.status]: i._count._all }), {});
    } catch { inventory = null; }

    const data = {
      financials: !isTech,
      kpis: {
        totalClients,
        activeClients:   clientsByStatus.find(s => s.status === 'ACTIVE')?._count._all ?? 0,
        suspendedClients: clientsByStatus.find(s => s.status === 'SUSPENDED')?._count._all ?? 0,
        totalRouters,
        routersDown,
        activePlans,
        pendingInstalls,
      },
      clientsByStatus: clientsByStatus.map(s => ({ status: s.status, count: s._count._all })),
      clientsByPlan,
      byTechnology,
      routersHealth,
      inventory,
    };

    // ── Financial block — ADMIN/OPERATOR only ───────────────────────
    if (!isTech) {
      // MRR: monthly recurring revenue from ACTIVE clients on a paid plan.
      const activePaid = await prisma.client.findMany({
        where: { status: 'ACTIVE', plan: { isFree: false } },
        select: { monthlyFee: true, plan: { select: { price: true, monthlyPrice: true } } }
      });
      const mrr = activePaid.reduce((sum, c) =>
        sum + (c.monthlyFee && c.monthlyFee > 0 ? c.monthlyFee : (c.plan?.monthlyPrice || c.plan?.price || 0)), 0);

      // Overdue aging buckets (only invoices past due date with balance).
      const overdue = await prisma.invoice.findMany({
        where: { status: { in: OPEN }, balanceDue: { gt: 0 }, dueDate: { lt: now } },
        select: { balanceDue: true, total: true, amount: true, dueDate: true }
      });
      const aging = { d0_30: { count: 0, amount: 0 }, d31_60: { count: 0, amount: 0 }, d61_90: { count: 0, amount: 0 }, d90: { count: 0, amount: 0 } };
      for (const inv of overdue) {
        const days = Math.floor((now - new Date(inv.dueDate)) / 86400000);
        const amt = inv.balanceDue > 0 ? inv.balanceDue : (inv.total ?? inv.amount ?? 0);
        const b = days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90';
        aging[b].count++; aging[b].amount += amt;
      }
      const overdueTotal = overdue.reduce((s, i) => s + (i.balanceDue > 0 ? i.balanceDue : (i.total ?? i.amount ?? 0)), 0);

      // Top debtors (clients with the largest open balance).
      const debtorClients = await prisma.client.findMany({
        where: { invoices: { some: { status: { in: OPEN }, balanceDue: { gt: 0 } } } },
        select: {
          id: true, name: true, connectionType: true,
          invoices: { where: { status: { in: OPEN }, balanceDue: { gt: 0 } }, select: { balanceDue: true } }
        }
      });
      const topDebtors = debtorClients
        .map(c => ({ id: c.id, name: c.name, technology: c.connectionType, debt: c.invoices.reduce((s, i) => s + (i.balanceDue || 0), 0) }))
        .filter(c => c.debt > 0)
        .sort((a, b) => b.debt - a.debt)
        .slice(0, 5);

      // Growth: new clients this month vs previous month.
      const [newThisMonth, newPrevMonth] = await Promise.all([
        prisma.client.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.client.count({ where: { createdAt: { gte: startOfPrevMonth, lt: startOfMonth } } }),
      ]);

      const paidThisMonth = paidThisMonthAggregate._sum.amount || 0;
      data.kpis.totalInvoices    = totalInvoices;
      data.kpis.pendingInvoices  = pendingAggregate._count._all;
      data.kpis.pendingAmount    = pendingAggregate._sum.balanceDue || 0;
      data.kpis.paidThisMonth    = paidThisMonth;
      data.kpis.mrr              = mrr;
      data.invoicesByStatus = invoicesByStatus.map(s => ({ status: s.status, count: s._count._all, total: s._sum.total || 0 }));
      data.finance = {
        mrr,
        paidThisMonth,
        collectionRate: mrr > 0 ? Math.round((paidThisMonth / mrr) * 100) : null,
        overdueTotal,
        aging,
        topDebtors,
        growth: { newThisMonth, newPrevMonth, delta: newThisMonth - newPrevMonth },
      };
    } else {
      data.invoicesByStatus = [];
    }

    res.json({ success: true, data });
  } catch (e) {
    console.error('GET /dashboard/stats failed:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
