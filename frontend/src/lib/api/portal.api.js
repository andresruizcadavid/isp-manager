const BASE = import.meta.env.PUBLIC_API_URL || '';

/**
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @returns {Promise<any>}
 */
async function request(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(`${BASE}/api/v1/portal${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || json.error || 'Error del servidor');
  return json.data ?? json;
}

export const portalApi = {
  getDashboard:    ()                    => request('GET',    '/dashboard'),
  getInvoices:     ()                    => request('GET',    '/invoices'),
  /** @param {string} id */
  getInvoice:      (id)                  => request('GET',    `/invoices/${id}`),
  /** @param {string} id */
  payInvoice:      (id)                  => request('POST',   `/invoices/${id}/pay`),
  /** @param {string} id */
  getInvoiceStatus:(id)                  => request('GET',    `/invoices/${id}/status`),
  getPayments:     ()                    => request('GET',    '/payments'),
  getProfile:      ()                    => request('GET',    '/profile'),
};
