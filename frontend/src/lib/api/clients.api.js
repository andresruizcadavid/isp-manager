import { api, getRaw } from './client.js';

/**
 * @typedef {import('$lib/types').Client} Client
 * @typedef {import('$lib/types').PageMeta} PageMeta
 */

export const clientsApi = {
  /** @param {Record<string, any>} [params] @returns {Promise<Client[]>} */
  getAll:   (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/clients${q ? '?' + q : ''}`);
  },
  /** @param {Record<string, any>} [params] @returns {Promise<{ data: Client[], meta: PageMeta }>} */
  getPage:  (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return getRaw(`/clients${q ? '?' + q : ''}`);
  },
  /** @param {string} id @returns {Promise<Client>} */
  getOne:   (id)       => api.get(`/clients/${id}`),
  /** @param {any} data @returns {Promise<Client>} */
  create:   (data)     => api.post('/clients', data),
  /** @param {string} id @param {any} data @returns {Promise<Client>} */
  update:   (id, data) => api.put(`/clients/${id}`, data),
  /** @param {string} id @param {{reasonCategory?:string, reasonNote?:string}} [reason] */
  remove:   (id, reason) => api.delete(`/clients/${id}`, reason || undefined),
  /** Archive of deleted clients (returns { data, meta }). @param {Record<string,any>} [params] */
  archive:  (params = {}) => {
    // Drop empty/undefined so they don't serialize as the literal "undefined".
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    );
    const q = new URLSearchParams(clean).toString();
    return getRaw(`/clients/archive${q ? '?' + q : ''}`);
  },
  /** @param {string} id */
  archiveEntry: (id) => api.get(`/clients/archive/${id}`),
  /** @param {string} id */
  suspend:  (id)       => api.post(`/clients/${id}/suspend`),
  /** @param {string} id */
  activate: (id)       => api.post(`/clients/${id}/activate`),
  /** Poner en aviso (recordatorio de pago) — no corta servicio. @param {string} id @param {{recurrence?:string}} [body] */
  aviso:      (id, body = {}) => api.post(`/clients/${id}/aviso`, body),
  /** Quitar del aviso. @param {string} id */
  avisoClear: (id)     => api.post(`/clients/${id}/aviso/clear`),
  /** #4: reconciliar estado (SUSPENDED/ACTIVE) con la lista de corte del router. */
  syncCollectionStatus: () => api.post('/clients/sync-collection-status', {}),
  nextPppoeNumber: ()  => api.get('/clients/next-pppoe-number'),
  /** Spreadsheet view: all clients with per-month invoice status for a year. @param {number} [year] */
  getSheet: (year)     => api.get(`/clients/sheet${year ? '?year=' + year : ''}`),
  /** Act on one month cell of the planilla. @param {string} id @param {{year:number,month:number,action:'pay'|'bill'|'unbill'|'unpay',method?:string,amount?:number}} body */
  sheetCell: (id, body) => api.post(`/clients/${id}/sheet-cell`, body),
  /** Conciliar cambio de precio: actualiza monthlyFee, crea/asigna plan y re-liquida facturas abiertas. @param {string} id @param {{newFeeCents:number, planAction?:'none'|'attach'|'create', planId?:string, newPlanName?:string, invoiceIds?:string[]}} body */
  reprice: (id, body) => api.post(`/clients/${id}/reprice`, body),
  /** Registrar/limpiar el envío del mensaje de cobro. @param {string} id @param {{channel:string|null, sentAt?:string}} body */
  setReminder: (id, body) => api.post(`/clients/${id}/collection-reminder`, body),
  /** Generar enlace de actualización de datos (envía por los canales elegidos). @param {string} id @param {{sendChannels:string[], notifyChannels?:string[]}} body */
  requestUpdate: (id, body) => api.post(`/clients/${id}/update-tokens`, body),
  /** @param {string} id */
  notifications: (id)  => api.get(`/clients/${id}/notifications`),
  /** @param {string} id @param {any} data */
  notify:   (id, data) => api.post(`/clients/${id}/notify`, data),
};
