// Bulk-bill — generate (or reuse) invoices for many clients × many months
// in a single operator action. Wraps `billing.service.generateInvoices`
// per client and tolerates per-client failures so one bad row doesn't
// poison the whole batch.
//
// Anti-duplication is guaranteed by the schema:
//   @@unique([clientId, periodYear, periodMonth]) on Invoice
// `generateInvoices` reads first; if a row exists it returns it as
// `action: 'reused'`. The operator sees how many were truly created vs
// already in the system. PAID months raise MONTH_ALREADY_PAID (skipped
// here, not failed — the operator can't pay something already paid).

import { billingService } from './billing.service.js';

const STATUS_OK     = 'ok';       // invoice created
const STATUS_REUSED = 'reused';   // matching invoice already existed (still PENDING/PARTIAL/OVERDUE)
const STATUS_PAID   = 'paid';     // month already paid — silently skipped
const STATUS_FAILED = 'failed';   // any other error (no plan, validation, etc.)

/**
 * @param {object} opts
 * @param {string[]} opts.clientIds                    Explicit list.
 * @param {{year:number, month:number}[]} opts.months  At least 1.
 * @param {string|null} [opts.currentUserId]           For audit only.
 * @returns {{
 *   results: Array<{
 *     clientId, clientName, status,
 *     invoices?: Array<{ year, month, status, invoiceId?, total?, action? }>,
 *     totalCreated?, totalReused?, totalAmount?, reason?
 *   }>,
 *   summary: { total, ok, allReused, mixed, paidSkipped, failed,
 *              invoicesCreated, invoicesReused, totalAmount }
 * }}
 */
export async function bulkBill({ clientIds, months, currentUserId = null }) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    throw new Error('clientIds requerido');
  }
  if (!Array.isArray(months) || months.length === 0) {
    throw new Error('months requerido');
  }

  const results = [];

  for (const clientId of clientIds) {
    const out = { clientId, status: null, invoices: [] };
    let totalCreated = 0;
    let totalReused  = 0;
    let totalAmount  = 0;
    let anyError     = null;

    for (const { year, month } of months) {
      try {
        // generateInvoices throws on per-month conditions (PAID, no plan,
        // cancelled). We catch each and continue so the per-client output
        // shows which months landed and which didn't.
        const r = await billingService.generateInvoices(clientId, [{ year, month }], currentUserId);
        const first = r.invoices[0];
        if (!out.clientName) out.clientName = r.client?.name;
        if (first?.action === 'created') totalCreated++;
        if (first?.action === 'reused')  totalReused++;
        totalAmount += first?.invoice?.total || 0;
        out.invoices.push({
          year, month,
          status:    first?.action === 'created' ? STATUS_OK : STATUS_REUSED,
          action:    first?.action,
          invoiceId: first?.invoice?.id || null,
          total:     first?.invoice?.total || 0
        });
      } catch (e) {
        // MONTH_ALREADY_PAID is a soft skip, not a failure.
        const code = e?.code || e?.errorCode;
        if (code === 'MONTH_ALREADY_PAID') {
          out.invoices.push({
            year, month,
            status:  STATUS_PAID,
            reason:  e.message
          });
          continue;
        }
        // First real error per client wins; we tag the row failed but
        // keep iterating so the operator sees the full per-month picture.
        anyError = anyError || (e?.message || 'Error desconocido');
        out.invoices.push({
          year, month,
          status: STATUS_FAILED,
          reason: e?.message || 'Error desconocido'
        });
      }
    }

    if (anyError) {
      out.status = STATUS_FAILED;
      out.reason = anyError;
    } else if (totalCreated > 0 && totalReused > 0) {
      out.status = 'mixed';
    } else if (totalCreated > 0) {
      out.status = STATUS_OK;
    } else if (totalReused > 0) {
      out.status = 'allReused';
    } else {
      // All months were already paid — soft success.
      out.status = 'paidSkipped';
    }
    out.totalCreated = totalCreated;
    out.totalReused  = totalReused;
    out.totalAmount  = totalAmount;

    results.push(out);
  }

  const summary = {
    total:            results.length,
    ok:               results.filter(r => r.status === STATUS_OK).length,
    allReused:        results.filter(r => r.status === 'allReused').length,
    mixed:            results.filter(r => r.status === 'mixed').length,
    paidSkipped:      results.filter(r => r.status === 'paidSkipped').length,
    failed:           results.filter(r => r.status === STATUS_FAILED).length,
    invoicesCreated:  results.reduce((s, r) => s + (r.totalCreated || 0), 0),
    invoicesReused:   results.reduce((s, r) => s + (r.totalReused  || 0), 0),
    totalAmount:      results.reduce((s, r) => s + (r.totalAmount  || 0), 0)
  };

  return { results, summary };
}
