<script>
  import { onMount } from 'svelte';
  import { FileText, Loader2, AlertCircle, ExternalLink } from 'lucide-svelte';
  import { portalApi } from '$lib/api/portal.api.js';

  /** @type {any[]} */
  let invoices = [];
  let loading = true;
  let error = '';
  /** @type {Record<string, boolean>} */
  let paying = {};

  onMount(async () => { try { invoices = await portalApi.getInvoices(); } catch (/** @type {any} */ e) { error = e.message; } finally { loading = false; } });

  /** @param {number} [c] */
  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((c||0)/100); }
  /** @param {string|Date|null|undefined} d */
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : ''; }

  /** @type {Record<string, string>} */
  const badge = { PAID:'bg-emerald-100 text-emerald-700', PENDING:'bg-amber-100 text-amber-700', OVERDUE:'bg-red-100 text-red-700', PARTIAL:'bg-blue-100 text-blue-700', CANCELLED:'bg-slate-100 text-slate-500' };
  /** @type {Record<string, string>} */
  const label = { PAID:'Pagada', PENDING:'Pendiente', OVERDUE:'Vencida', PARTIAL:'Parcial', CANCELLED:'Anulada' };

  /** @param {string} id */
  async function handlePay(id) {
    paying = {...paying, [id]: true};
    try { const r = await portalApi.payInvoice(id); window.open(r.checkoutUrl, '_blank'); }
    catch (/** @type {any} */ e) { alert(e.message); }
    finally { paying = {...paying, [id]: false}; }
  }
</script>

<svelte:head><title>Facturas — Mi Portal</title></svelte:head>

<div class="mb-6"><h1 class="text-xl font-bold text-text-primary">Mis Facturas</h1><p class="text-sm text-text-secondary">Historial de facturación</p></div>

{#if loading}<div class="flex items-center justify-center py-20"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}<div class="card p-8 text-center"><AlertCircle size={24} class="mx-auto mb-3 text-red-500" /><p class="text-text-secondary">{error}</p></div>
{:else if invoices.length === 0}<div class="card p-8 text-center"><FileText size={32} class="mx-auto mb-3 text-text-muted" /><p class="text-text-secondary">No hay facturas registradas.</p></div>
{:else}
  <div class="space-y-3">
    {#each invoices as inv}
      <div class="card p-4 sm:p-5">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-semibold text-text-primary">{inv.invoiceNumber}</span>
              <span class="text-[10px] font-medium px-1.5 py-0.5 rounded {badge[inv.status]}">{label[inv.status]}</span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-muted">
              <span>Vence: {fmtDate(inv.dueDate)}</span>
              {#if inv.periodYear && inv.periodMonth}<span>Período: {inv.periodMonth}/{inv.periodYear}</span>{/if}
              {#if inv.balanceDue > 0 && inv.balanceDue !== inv.total}<span class="text-amber-600 font-medium">Saldo: {fmtCOP(inv.balanceDue)}</span>{/if}
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            {#if inv.status !== 'PAID' && inv.status !== 'CANCELLED'}
              <button on:click={() => handlePay(inv.id)} disabled={paying[inv.id]} class="btn-primary text-xs px-4 py-2 flex items-center gap-1.5">
                {#if paying[inv.id]}<Loader2 size={12} class="animate-spin" />{:else}<ExternalLink size={12} />{/if} Pagar
              </button>
            {/if}
            <a href="/portal/invoices/{inv.id}" class="btn-ghost text-xs px-3 py-2">Detalle</a>
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}
