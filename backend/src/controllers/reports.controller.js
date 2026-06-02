import { prisma } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/error.middleware.js';
import { mikrotikService } from '../services/mikrotik.service.js';

class ReportsController {
  getDashboardOverview = asyncHandler(async (req, res) => {
    const [
      totalClients,
      activeClients,
      totalInvoices,
      overdueInvoices,
      monthlyRevenue,
      totalRevenue
    ] = await Promise.all([
      prisma.client.count(),
      prisma.client.count({ where: { status: 'ACTIVE' } }),
      prisma.invoice.count(),
      prisma.invoice.count({
        where: {
          status: { in: ['PENDING', 'OVERDUE'] },
          dueDate: { lt: new Date() }
        }
      }),
      this.getMonthlyRevenue(),
      prisma.invoice.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true }
      })
    ]);

    const overdueAmount = await prisma.invoice.aggregate({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: new Date() }
      },
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: {
        clients: {
          total: totalClients,
          active: activeClients,
          growthRate: await this.getClientGrowthRate()
        },
        invoices: {
          total: totalInvoices,
          overdue: overdueInvoices,
          overdueAmount: overdueAmount._sum.amount || 0
        },
        revenue: {
          monthly: monthlyRevenue,
          total: totalRevenue._sum.amount || 0,
          growthRate: await this.getRevenueGrowthRate()
        }
      }
    });
  });

  getDashboardMetrics = asyncHandler(async (req, res) => {
    const metrics = await Promise.all([
      this.getNewClientsThisMonth(),
      this.getChurnRate(),
      this.getAverageRevenuePerClient(),
      this.getCollectionRate(),
      this.getNetworkUtilization()
    ]);

    res.json({
      success: true,
      data: {
        newClientsThisMonth: metrics[0],
        churnRate: metrics[1],
        averageRevenuePerClient: metrics[2],
        collectionRate: metrics[3],
        networkUtilization: metrics[4]
      }
    });
  });

  getRecentActivity = asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;

    const [recentClients, recentInvoices, recentPayments] = await Promise.all([
      prisma.client.findMany({
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          createdAt: true,
          plan: {
            select: { name: true }
          }
        }
      }),
      prisma.invoice.findMany({
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          client: {
            select: { name: true }
          },
          plan: {
            select: { name: true }
          }
        }
      }),
      prisma.payment.findMany({
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
              client: {
                select: { name: true }
              }
            }
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        recentClients,
        recentInvoices,
        recentPayments
      }
    });
  });

  getRevenueReport = asyncHandler(async (req, res) => {
    const { startDate, endDate, groupBy = 'month', includePending = true, includeOverdue = true } = req.query;

    const where = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      },
      ...(includePending && includeOverdue ? {} : {
        status: {
          ...(includePending && { in: ['PAID', 'PENDING'] }),
          ...(includeOverdue && { in: ['PAID', 'OVERDUE'] })
        }
      })
    };

    let revenueData;
    
    if (groupBy === 'day') {
      revenueData = await prisma.$queryRaw`
        SELECT 
          DATE("createdAt") as date,
          COUNT(*) as count,
          COALESCE(SUM("amount"), 0) as revenue
        FROM "invoices" 
        WHERE "createdAt" >= ${new Date(startDate)} AND "createdAt" <= ${new Date(endDate)}
        GROUP BY DATE("createdAt")
        ORDER BY date
      `;
    } else if (groupBy === 'week') {
      revenueData = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('week', "createdAt") as date,
          COUNT(*) as count,
          COALESCE(SUM("amount"), 0) as revenue
        FROM "invoices" 
        WHERE "createdAt" >= ${new Date(startDate)} AND "createdAt" <= ${new Date(endDate)}
        GROUP BY DATE_TRUNC('week', "createdAt")
        ORDER BY date
      `;
    } else if (groupBy === 'month') {
      revenueData = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "createdAt") as date,
          COUNT(*) as count,
          COALESCE(SUM("amount"), 0) as revenue
        FROM "invoices" 
        WHERE "createdAt" >= ${new Date(startDate)} AND "createdAt" <= ${new Date(endDate)}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY date
      `;
    } else {
      revenueData = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('year', "createdAt") as date,
          COUNT(*) as count,
          COALESCE(SUM("amount"), 0) as revenue
        FROM "invoices" 
        WHERE "createdAt" >= ${new Date(startDate)} AND "createdAt" <= ${new Date(endDate)}
        GROUP BY DATE_TRUNC('year', "createdAt")
        ORDER BY date
      `;
    }

    res.json({
      success: true,
      data: revenueData
    });
  });

  getExpensesReport = asyncHandler(async (req, res) => {
    // This would integrate with expense tracking
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reporte de gastos no implementado aún'
      }
    });
  });

  getProfitReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const revenue = await prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _sum: { amount: true }
    });

    // This would subtract expenses when implemented
    const profit = revenue._sum.amount || 0;

    res.json({
      success: true,
      data: {
        revenue: revenue._sum.amount || 0,
        expenses: 0, // To be implemented
        profit,
        profitMargin: revenue._sum.amount > 0 ? (profit / revenue._sum.amount) * 100 : 0
      }
    });
  });

  getCollectionsReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const collections = await prisma.payment.findMany({
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            client: {
              select: { name: true }
            }
          }
        }
      }
    });

    const summary = await prisma.payment.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _sum: { amount: true },
      _count: true
    });

    res.json({
      success: true,
      data: {
        collections,
        summary: {
          totalCollected: summary._sum.amount || 0,
          totalTransactions: summary._count
        }
      }
    });
  });

  getAgingReport = asyncHandler(async (req, res) => {
    const now = new Date();
    const ranges = [
      { name: '0-30 días', start: 0, end: 30 },
      { name: '31-60 días', start: 31, end: 60 },
      { name: '61-90 días', start: 61, end: 90 },
      { name: '90+ días', start: 91, end: 365 }
    ];

    const agingData = await Promise.all(
      ranges.map(async (range) => {
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - range.end);
        
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() - range.start + 1);

        const data = await prisma.invoice.aggregate({
          where: {
            status: { in: ['PENDING', 'OVERDUE'] },
            dueDate: {
              gte: startDate,
              lt: endDate
            }
          },
          _sum: { amount: true },
          _count: true
        });

        return {
          range: range.name,
          count: data._count,
          amount: data._sum.amount || 0
        };
      })
    );

    res.json({
      success: true,
      data: agingData
    });
  });

  getPaymentMethodsReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const paymentMethods = await prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: paymentMethods
    });
  });

  getClientsOverview = asyncHandler(async (req, res) => {
    const { status, planId, city, startDate, endDate } = req.query;

    const where = {
      ...(status && { status }),
      ...(planId && { planId }),
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(startDate && endDate && {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      })
    };

    const [total, byStatus, byPlan, byCity] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
      prisma.client.groupBy({
        by: ['planId'],
        where,
        _count: true
      }),
      prisma.client.groupBy({
        by: ['city'],
        where,
        _count: true
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        byStatus,
        byPlan,
        byCity
      }
    });
  });

  getClientChurnReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const churnedClients = await prisma.client.findMany({
      where: {
        status: 'INACTIVE',
        updatedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      include: {
        plan: {
          select: { name: true }
        }
      }
    });

    const churnByPlan = await prisma.client.groupBy({
      by: ['planId'],
      where: {
        status: 'INACTIVE',
        updatedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true
    });

    res.json({
      success: true,
      data: {
        churnedClients,
        churnByPlan,
        totalChurned: churnedClients.length
      }
    });
  });

  getClientAcquisitionReport = asyncHandler(async (req, res) => {
    const { startDate, endDate, groupBy = 'month' } = req.query;

    let acquisitionData;
    
    if (groupBy === 'day') {
      acquisitionData = await prisma.$queryRaw`
        SELECT 
          DATE("createdAt") as date,
          COUNT(*) as acquisitions
        FROM "clients" 
        WHERE "createdAt" >= ${new Date(startDate)} AND "createdAt" <= ${new Date(endDate)}
        GROUP BY DATE("createdAt")
        ORDER BY date
      `;
    } else {
      acquisitionData = await prisma.$queryRaw`
        SELECT 
          DATE_TRUNC('month', "createdAt") as date,
          COUNT(*) as acquisitions
        FROM "clients" 
        WHERE "createdAt" >= ${new Date(startDate)} AND "createdAt" <= ${new Date(endDate)}
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY date
      `;
    }

    res.json({
      success: true,
      data: acquisitionData
    });
  });

  getClientsByPlanReport = asyncHandler(async (req, res) => {
    const clientsByPlan = await prisma.client.groupBy({
      by: ['planId'],
      _count: true
    });

    const planIds = clientsByPlan.map(item => item.planId);
    const plans = await prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true, price: true }
    });

    const result = clientsByPlan.map(item => {
      const plan = plans.find(p => p.id === item.planId);
      return {
        planId: item.planId,
        planName: plan?.name || 'Unknown',
        planPrice: plan?.price || 0,
        clientCount: item._count
      };
    });

    res.json({
      success: true,
      data: result
    });
  });

  getClientsByCityReport = asyncHandler(async (req, res) => {
    const clientsByCity = await prisma.client.groupBy({
      by: ['city'],
      _count: true
    });

    res.json({
      success: true,
      data: clientsByCity
    });
  });

  getClientLifetimeValueReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    // This is a complex calculation that would need more sophisticated queries
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reporte de LTV no implementado aún'
      }
    });
  });

  getServiceUsageReport = asyncHandler(async (req, res) => {
    const { startDate, endDate, clientId, interfaceName } = req.query;

    try {
      const usageData = await mikrotikService.getTrafficReport({
        startDate,
        endDate,
        clientId,
        interfaceName
      });

      res.json({
        success: true,
        data: usageData
      });
    } catch (error) {
      res.json({
        success: false,
        error: {
          code: 'MIKROTIK_ERROR',
          message: 'No se pudo obtener datos de uso de Mikrotik'
        }
      });
    }
  });

  getBandwidthReport = asyncHandler(async (req, res) => {
    const { startDate, endDate, interfaceName } = req.query;

    try {
      const bandwidthData = await mikrotikService.getBandwidthReport({
        startDate,
        endDate,
        interfaceName
      });

      res.json({
        success: true,
        data: bandwidthData
      });
    } catch (error) {
      res.json({
        success: false,
        error: {
          code: 'MIKROTIK_ERROR',
          message: 'No se pudo obtener datos de ancho de banda'
        }
      });
    }
  });

  getServiceUptimeReport = asyncHandler(async (req, res) => {
    // This would track service uptime over time
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reporte de uptime no implementado aún'
      }
    });
  });

  getSupportTicketsReport = asyncHandler(async (req, res) => {
    // This would integrate with a support ticket system
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reporte de tickets de soporte no implementado aún'
      }
    });
  });

  getNetworkTrafficReport = asyncHandler(async (req, res) => {
    const { startDate, endDate, interfaceName } = req.query;

    try {
      const trafficData = await mikrotikService.getNetworkTrafficReport({
        startDate,
        endDate,
        interfaceName
      });

      res.json({
        success: true,
        data: trafficData
      });
    } catch (error) {
      res.json({
        success: false,
        error: {
          code: 'MIKROTIK_ERROR',
          message: 'No se pudo obtener datos de tráfico de red'
        }
      });
    }
  });

  getNetworkInterfacesReport = asyncHandler(async (req, res) => {
    try {
      const interfaces = await mikrotikService.getInterfaces();

      res.json({
        success: true,
        data: interfaces
      });
    } catch (error) {
      res.json({
        success: false,
        error: {
          code: 'MIKROTIK_ERROR',
          message: 'No se pudo obtener información de interfaces'
        }
      });
    }
  });

  getDhcpReport = asyncHandler(async (req, res) => {
    try {
      const [leases, networks] = await Promise.all([
        mikrotikService.getDhcpLeases(),
        mikrotikService.getDhcpNetworks()
      ]);

      res.json({
        success: true,
        data: {
          leases,
          networks
        }
      });
    } catch (error) {
      res.json({
        success: false,
        error: {
          code: 'MIKROTIK_ERROR',
          message: 'No se pudo obtener información DHCP'
        }
      });
    }
  });

  getFirewallReport = asyncHandler(async (req, res) => {
    try {
      const rules = await mikrotikService.getFirewallRules();

      res.json({
        success: true,
        data: rules
      });
    } catch (error) {
      res.json({
        success: false,
        error: {
          code: 'MIKROTIK_ERROR',
          message: 'No se pudo obtener reglas de firewall'
        }
      });
    }
  });

  getInvoicesSummaryReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const summary = await prisma.invoice.aggregate({
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _sum: { amount: true },
      _count: true
    });

    const byStatus = await prisma.invoice.groupBy({
      by: ['status'],
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalAmount: summary._sum.amount || 0,
          totalCount: summary._count
        },
        byStatus
      }
    });
  });

  getOverdueInvoicesReport = asyncHandler(async (req, res) => {
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: new Date() }
      },
      include: {
        client: {
          select: {
            name: true,
            email: true,
            phone: true
          }
        },
        plan: {
          select: {
            name: true
          }
        }
      },
      orderBy: { dueDate: 'asc' }
    });

    res.json({
      success: true,
      data: overdueInvoices
    });
  });

  getInvoicesByStatusReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const byStatus = await prisma.invoice.groupBy({
      by: ['status'],
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: byStatus
    });
  });

  getInvoicesByPlanReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const byPlan = await prisma.invoice.groupBy({
      by: ['planId'],
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    const planIds = byPlan.map(item => item.planId);
    const plans = await prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true, price: true }
    });

    const result = byPlan.map(item => {
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

  getPaymentsSummaryReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const summary = await prisma.payment.aggregate({
      where: {
        paidAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _sum: { amount: true },
      _count: true
    });

    const byStatus = await prisma.payment.groupBy({
      by: ['status'],
      where: {
        paidAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalAmount: summary._sum.amount || 0,
          totalCount: summary._count
        },
        byStatus
      }
    });
  });

  getPaymentsByMethodReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const byMethod = await prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      _count: true,
      _sum: { amount: true }
    });

    res.json({
      success: true,
      data: byMethod
    });
  });

  getPaymentsReconciliationReport = asyncHandler(async (req, res) => {
    // This would integrate with bank reconciliation
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reporte de conciliación no implementado aún'
      }
    });
  });

  getPaymentFailuresReport = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    const failedPayments = await prisma.payment.findMany({
      where: {
        status: 'FAILED',
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate)
        }
      },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            client: {
              select: { name: true }
            }
          }
        }
      }
    });

    res.json({
      success: true,
      data: failedPayments
    });
  });

  generateCustomReport = asyncHandler(async (req, res) => {
    // Custom report generation based on user-defined parameters
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Generación de reportes personalizados no implementada aún'
      }
    });
  });

  getCustomReportTemplates = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Plantillas de reportes personalizadas no implementadas aún'
      }
    });
  });

  createCustomReportTemplate = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Creación de plantillas de reportes personalizadas no implementada aún'
      }
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

  exportToCSV = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Exportación a CSV no implementada aún'
      }
    });
  });

  getScheduledReports = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reportes programados no implementados aún'
      }
    });
  });

  createScheduledReport = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Creación de reportes programados no implementada aún'
      }
    });
  });

  updateScheduledReport = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Actualización de reportes programados no implementada aún'
      }
    });
  });

  deleteScheduledReport = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Eliminación de reportes programados no implementada aún'
      }
    });
  });

  getTrendsAnalysis = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Análisis de tendencias no implementado aún'
      }
    });
  });

  getPredictiveAnalytics = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Análisis predictivo no implementado aún'
      }
    });
  });

  getKPIReport = asyncHandler(async (req, res) => {
    res.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Reporte KPI no implementado aún'
      }
    });
  });

  // Helper methods
  async getMonthlyRevenue() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const revenue = await prisma.invoice.aggregate({
      where: {
        status: 'PAID',
        createdAt: { gte: startOfMonth }
      },
      _sum: { amount: true }
    });

    return revenue._sum.amount || 0;
  }

  async getClientGrowthRate() {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const lastMonth = new Date(thisMonth);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const [thisMonthClients, lastMonthClients] = await Promise.all([
      prisma.client.count({
        where: { createdAt: { gte: thisMonth } }
      }),
      prisma.client.count({
        where: {
          createdAt: { gte: lastMonth, lt: thisMonth }
        }
      })
    ]);

    if (lastMonthClients === 0) return 0;
    return ((thisMonthClients - lastMonthClients) / lastMonthClients) * 100;
  }

  async getRevenueGrowthRate() {
    const thisMonth = new Date();
    thisMonth.setDate(1);
    thisMonth.setHours(0, 0, 0, 0);

    const lastMonth = new Date(thisMonth);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const [thisMonthRevenue, lastMonthRevenue] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          status: 'PAID',
          createdAt: { gte: thisMonth }
        },
        _sum: { amount: true }
      }),
      prisma.invoice.aggregate({
        where: {
          status: 'PAID',
          createdAt: { gte: lastMonth, lt: thisMonth }
        },
        _sum: { amount: true }
      })
    ]);

    const thisRevenue = thisMonthRevenue._sum.amount || 0;
    const lastRevenue = lastMonthRevenue._sum.amount || 0;

    if (lastRevenue === 0) return 0;
    return ((thisRevenue - lastRevenue) / lastRevenue) * 100;
  }

  async getNewClientsThisMonth() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return await prisma.client.count({
      where: { createdAt: { gte: startOfMonth } }
    });
  }

  async getChurnRate() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [churnedClients, totalClients] = await Promise.all([
      prisma.client.count({
        where: {
          status: 'INACTIVE',
          updatedAt: { gte: thirtyDaysAgo }
        }
      }),
      prisma.client.count()
    ]);

    return totalClients > 0 ? (churnedClients / totalClients) * 100 : 0;
  }

  async getAverageRevenuePerClient() {
    const [totalRevenue, activeClients] = await Promise.all([
      prisma.invoice.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true }
      }),
      prisma.client.count({ where: { status: 'ACTIVE' } })
    ]);

    return activeClients > 0 ? (totalRevenue._sum.amount || 0) / activeClients : 0;
  }

  async getCollectionRate() {
    const [totalInvoiced, totalPaid] = await Promise.all([
      prisma.invoice.aggregate({
        _sum: { amount: true }
      }),
      prisma.invoice.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true }
      })
    ]);

    const invoiced = totalInvoiced._sum.amount || 0;
    const paid = totalPaid._sum.amount || 0;

    return invoiced > 0 ? (paid / invoiced) * 100 : 0;
  }

  async getNetworkUtilization() {
    try {
      const resources = await mikrotikService.getSystemResources();
      return resources.cpu || 0;
    } catch (error) {
      return 0;
    }
  }
}

export const reportController = new ReportsController();
