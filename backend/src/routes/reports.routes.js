import { Router } from 'express';
import { reportController } from '../controllers/reports.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validateQuery, validateParams, commonSchemas } from '../middleware/validate.middleware.js';
import { z } from 'zod';

const router = Router();

// All report routes require authentication
router.use(authMiddleware);

// Validation schemas
const dateRangeSchema = commonSchemas.dateRange.extend({
  groupBy: z.enum(['day', 'week', 'month', 'year']).default('month'),
  format: z.enum(['json', 'csv', 'excel', 'pdf']).default('json')
});

const financialReportSchema = dateRangeSchema.extend({
  includePending: z.boolean().default(true),
  includeOverdue: z.boolean().default(true)
});

const clientReportSchema = dateRangeSchema.extend({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE', 'PENDING_INSTALLATION']).optional(),
  planId: z.string().optional(),
  city: z.string().optional()
});

const trafficReportSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  interfaceName: z.string().optional(),
  groupBy: z.enum(['hour', 'day', 'week', 'month']).default('day'),
  clientId: z.string().optional()
});

// Dashboard overview
router.get('/dashboard', reportController.getDashboardOverview);
router.get('/dashboard/overview', reportController.getDashboardOverview);
router.get('/dashboard/metrics', reportController.getDashboardMetrics);
router.get('/dashboard/recent-activity', reportController.getRecentActivity);

// Financial reports
router.get('/financial/revenue', validateQuery(financialReportSchema), reportController.getRevenueReport);
router.get('/financial/expenses', validateQuery(dateRangeSchema), reportController.getExpensesReport);
router.get('/financial/profit', validateQuery(financialReportSchema), reportController.getProfitReport);
router.get('/financial/collections', validateQuery(dateRangeSchema), reportController.getCollectionsReport);
router.get('/financial/aging', reportController.getAgingReport);
router.get('/financial/payment-methods', validateQuery(dateRangeSchema), reportController.getPaymentMethodsReport);

// Client reports
router.get('/clients/overview', validateQuery(clientReportSchema), reportController.getClientsOverview);
router.get('/clients/churn', validateQuery(dateRangeSchema), reportController.getClientChurnReport);
router.get('/clients/acquisition', validateQuery(dateRangeSchema), reportController.getClientAcquisitionReport);
router.get('/clients/by-plan', validateQuery(clientReportSchema), reportController.getClientsByPlanReport);
router.get('/clients/by-city', validateQuery(clientReportSchema), reportController.getClientsByCityReport);
router.get('/clients/lifetime-value', validateQuery(dateRangeSchema), reportController.getClientLifetimeValueReport);

// Service reports
router.get('/service/usage', validateQuery(trafficReportSchema), reportController.getServiceUsageReport);
router.get('/service/bandwidth', validateQuery(trafficReportSchema), reportController.getBandwidthReport);
router.get('/service/uptime', validateQuery(dateRangeSchema), reportController.getServiceUptimeReport);
router.get('/service/support-tickets', validateQuery(dateRangeSchema), reportController.getSupportTicketsReport);

// Network reports
router.get('/network/traffic', validateQuery(trafficReportSchema), reportController.getNetworkTrafficReport);
router.get('/network/interfaces', reportController.getNetworkInterfacesReport);
router.get('/network/dhcp', reportController.getDhcpReport);
router.get('/network/firewall', validateQuery(dateRangeSchema), reportController.getFirewallReport);

// Invoice reports
router.get('/invoices/summary', validateQuery(dateRangeSchema), reportController.getInvoicesSummaryReport);
router.get('/invoices/overdue', reportController.getOverdueInvoicesReport);
router.get('/invoices/by-status', validateQuery(dateRangeSchema), reportController.getInvoicesByStatusReport);
router.get('/invoices/by-plan', validateQuery(dateRangeSchema), reportController.getInvoicesByPlanReport);

// Custom reports
router.post('/custom/generate', reportController.generateCustomReport);
router.get('/custom/templates', reportController.getCustomReportTemplates);
router.post('/custom/templates', reportController.createCustomReportTemplate);

// Export functionality
router.get('/export/excel', validateQuery(z.object({
  reportType: z.string(),
  ...dateRangeSchema.shape
})), reportController.exportToExcel);
router.get('/export/pdf', validateQuery(z.object({
  reportType: z.string(),
  ...dateRangeSchema.shape
})), reportController.exportToPDF);
router.get('/export/csv', validateQuery(z.object({
  reportType: z.string(),
  ...dateRangeSchema.shape
})), reportController.exportToCSV);

// Scheduled reports
router.get('/scheduled', reportController.getScheduledReports);
router.post('/scheduled', reportController.createScheduledReport);
router.put('/scheduled/:id', validateParams(z.object({ id: z.string() })), reportController.updateScheduledReport);
router.delete('/scheduled/:id', validateParams(z.object({ id: z.string() })), reportController.deleteScheduledReport);

// Analytics and insights
router.get('/analytics/trends', validateQuery(dateRangeSchema), reportController.getTrendsAnalysis);
router.get('/analytics/predictions', reportController.getPredictiveAnalytics);
router.get('/analytics/kpi', reportController.getKPIReport);

export default router;
