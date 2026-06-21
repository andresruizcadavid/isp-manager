import { api, getRaw } from './client.js';

/** @typedef {Record<string, any>} Params */

export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard'),
  dashboardMetrics: () => api.get('/reports/dashboard/metrics'),

  // Financial
  /** @param {Params} params */
  revenue: (params) => api.get('/reports/financial/revenue?' + new URLSearchParams(params)),
  /** @param {Params} params */
  collections: (params) => api.get('/reports/financial/collections?' + new URLSearchParams(params)),
  aging: () => api.get('/reports/financial/aging'),

  // Clients
  /** @param {Params} params */
  clientsOverview: (params) => api.get('/reports/clients/overview?' + new URLSearchParams(params)),
  /** @param {Params} params */
  clientsByPlan: (params) => api.get('/reports/clients/by-plan?' + new URLSearchParams(params)),
  /** @param {Params} params */
  churn: (params) => api.get('/reports/clients/churn?' + new URLSearchParams(params)),

  // Invoices
  /** @param {Params} params */
  invoicesSummary: (params) => api.get('/reports/invoices/summary?' + new URLSearchParams(params)),
  overdueInvoices: () => api.get('/reports/invoices/overdue'),

  // Network
  /** @param {Params} params */
  networkTraffic: (params) => api.get('/reports/network/traffic?' + new URLSearchParams(params)),
  interfaces: () => api.get('/reports/network/interfaces'),

  // KPIs
  kpi: () => api.get('/reports/analytics/kpi'),
  /** @param {Params} params */
  trends: (params) => api.get('/reports/analytics/trends?' + new URLSearchParams(params)),

  // Export
  /** @param {string} reportType @param {Params} params */
  exportExcel: (reportType, params) => getRaw(`/reports/export/excel?reportType=${reportType}&${new URLSearchParams(params)}`),
  /** @param {string} reportType @param {Params} params */
  exportPDF: (reportType, params) => getRaw(`/reports/export/pdf?reportType=${reportType}&${new URLSearchParams(params)}`),
};
