import { api, getRaw } from './client.js';

export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard'),
  dashboardMetrics: () => api.get('/reports/dashboard/metrics'),
  
  // Financial
  revenue: (params) => api.get('/reports/financial/revenue?' + new URLSearchParams(params)),
  collections: (params) => api.get('/reports/financial/collections?' + new URLSearchParams(params)),
  aging: () => api.get('/reports/financial/aging'),
  
  // Clients
  clientsOverview: (params) => api.get('/reports/clients/overview?' + new URLSearchParams(params)),
  clientsByPlan: (params) => api.get('/reports/clients/by-plan?' + new URLSearchParams(params)),
  churn: (params) => api.get('/reports/clients/churn?' + new URLSearchParams(params)),
  
  // Invoices
  invoicesSummary: (params) => api.get('/reports/invoices/summary?' + new URLSearchParams(params)),
  overdueInvoices: () => api.get('/reports/invoices/overdue'),
  
  // Payments
  paymentsSummary: (params) => api.get('/reports/payments/summary?' + new URLSearchParams(params)),
  paymentsByMethod: (params) => api.get('/reports/payments/by-method?' + new URLSearchParams(params)),
  
  // Network
  networkTraffic: (params) => api.get('/reports/network/traffic?' + new URLSearchParams(params)),
  interfaces: () => api.get('/reports/network/interfaces'),
  
  // KPIs
  kpi: () => api.get('/reports/analytics/kpi'),
  trends: (params) => api.get('/reports/analytics/trends?' + new URLSearchParams(params)),
  
  // Export
  exportExcel: (reportType, params) => getRaw(`/reports/export/excel?reportType=${reportType}&${new URLSearchParams(params)}`),
  exportPDF: (reportType, params) => getRaw(`/reports/export/pdf?reportType=${reportType}&${new URLSearchParams(params)}`),
};