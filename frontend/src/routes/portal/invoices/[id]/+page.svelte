<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { ArrowLeft, ExternalLink, Loader2, AlertCircle, CreditCard, CheckCircle } from 'lucide-svelte';
  import { portalApi } from '$lib/api/portal.api.js';

  /** @type {any} */
  let inv = null;
  let loading = true;
  let error = '';
  let paying = false;
  let polling = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;

  onMount(async () => { try { inv = await portalApi.getInvoice($page.params.id); } catch (/** @type {any} */ e) { error = e.message; } finally { loading = false; } });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });

  /** @param {number} [c] */
  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((c||0)/100); }
  /** @param {string|Date|null|undefined} d */
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : ''; }

  async function handlePay() {
    paying = true;
    try {
      const r = await portalApi.payInvoice($page.params.id);
      window.open(r.checkoutUrl, '_blank');
      startPolling();
    }
    catch (/** @type {any} */ e) { alert(e.message); }
    finally { paying = false; }
  }

  function startPolling() {
    polling = true;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // ~5 min at 3s interval
    pollTimer = setInterval(async () => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollTimer);
        pollTimer = null;
        polling = false;
        return;
      }
      try {
        const s = await portalApi.getInvoiceStatus($page.params.id);
        if (s.status === 'PAID') {
          clearInterval(pollTimer);
          pollTimer = null;
          polling = false;
          inv = { ...inv, status: s.status, balanceDue: s.balanceDue, paidDate: s.paidDate };
          // Re-fetch full invoice to refresh payments list
          inv = await portalApi.getInvoice($page.params.id);
        }
      } catch (/** @type {any} */ e) { /* ignore transient polling errors */ }
    }, 3000);
  }
</script>

<svelte:head><title>Factura — Mi Portal</title></svelte:head>

<a href="/portal/invoices" class="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary mb-4"><ArrowLeft size={14} /> Volver</a>

{#if loading}<div class="flex items-center justify-center py-20"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}<div class="card p-8 text-center"><AlertCircle size={24} class="mx-auto mb-3 text-red-500" /><p class="text-text-secondary">{error}</p></div>
{:else if inv}
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between">
        <div><h1 class="font-semibold text-text-primary">{inv.invoiceNumber}</h1><p class="text-xs text-text-muted">Emitida: {fmtDate(inv.issueDate)}</p></div>
        <span class="text-xs font-medium px-2 py-1 rounded {inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : inv.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
          {inv.status === 'PAID' ? 'Pagada' : inv.status === 'PENDING' ? 'Pendiente' : inv.status}
        </span>
      </div>
    </div>
    <div class="card-body">
      {#if inv.items?.length > 0}
        <h3 class="text-sm font-medium text-text-primary mb-2">Detalle</h3>
        <div class="divide-y divide-slate-100 mb-4">
          {#each inv.items as item}
            <div class="flex items-center justify-between py-2">
              <span class="text-sm text-text-primary">{item.description}{item.quantity > 1 ? ` (×${item.quantity})` : ''}</span>
              <span class="text-sm font-medium text-text-primary">{fmtCOP(item.total)}</span>
            </div>
          {/each}
        </div>
      {/if}
      <div class="border-t border-slate-100 pt-3 space-y-1">
        <div class="flex justify-between text-sm"><span class="text-text-muted">Subtotal</span><span class="text-text-primary">{fmtCOP(inv.amount)}</span></div>
        {#if inv.tax > 0}<div class="flex justify-between text-sm"><span class="text-text-muted">IVA</span><span class="text-text-primary">{fmtCOP(inv.tax)}</span></div>{/if}
        {#if inv.discount > 0}<div class="flex justify-between text-sm"><span class="text-text-muted">Descuento</span><span class="text-emerald-600">-{fmtCOP(inv.discount)}</span></div>{/if}
        <div class="flex justify-between text-sm font-bold pt-2 border-t border-slate-200"><span class="text-text-primary">Total</span><span class="text-text-primary">{fmtCOP(inv.total)}</span></div>
        {#if inv.balanceDue > 0 && inv.balanceDue !== inv.total}<div class="flex justify-between text-sm font-semibold text-amber-600"><span>Saldo pendiente</span><span>{fmtCOP(inv.balanceDue)}</span></div>{/if}
      </div>
      <div class="mt-2 text-xs text-text-muted"><p>Vence: {fmtDate(inv.dueDate)}</p>{#if inv.paidDate}<p>Pagada: {fmtDate(inv.paidDate)}</p>{/if}</div>
    </div>
    {#if inv.status !== 'PAID' && inv.status !== 'CANCELLED'}
      <div class="card-footer flex justify-end items-center gap-3">
        {#if polling}
          <span class="text-xs text-brand-600 flex items-center gap-1.5"><Loader2 size={12} class="animate-spin" /> Esperando confirmación de pago…</span>
        {/if}
          <button on:click={handlePay} disabled={paying || polling} class="btn-primary flex items-center gap-2 px-6 py-2.5">
            {#if paying}<Loader2 size={14} class="animate-spin" />{:else}<ExternalLink size={14} />{/if} Pagar ahora
          </button>
      </div>
    {:else if inv.status === 'PAID'}
      <div class="card-footer flex justify-center">
        <span class="flex items-center gap-2 text-emerald-600 text-sm font-medium"><CheckCircle size={16} /> Factura pagada</span>
      </div>
    {/if}
  </div>

  {#if inv.payments?.length > 0}
    <div class="card mt-4">
      <div class="card-header"><h2 class="font-semibold text-text-primary flex items-center gap-2"><CreditCard size={14} /> Pagos aplicados</h2></div>
      <div class="card-body p-0 divide-y divide-slate-100">
        {#each inv.payments as p}
          <div class="flex items-center justify-between px-5 py-3">
            <div><span class="text-sm font-medium text-text-primary">{fmtCOP(p.amount)}</span><span class="text-xs text-text-muted ml-2">{p.method}</span></div>
            <span class="text-xs text-text-muted">{fmtDate(p.createdAt)}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}
