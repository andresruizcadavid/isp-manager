<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { paymentLinksApi } from '$lib/api/payment-links.api.js';
  import { Loader2, ArrowLeft, ShoppingBag, CheckCircle, XCircle, Clock, CreditCard } from 'lucide-svelte';

  /** @type {any} */
  let attempt = null;
  let loading = true;
  let error = '';

  /** @param {number} [c] */
  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format((c||0)/100); }
  /** @param {string|Date|null|undefined} d */
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; }

  async function load() {
    loading = true; error = '';
    try {
      attempt = await paymentLinksApi.getAttempt($page.params.id);
    } catch (/** @type {any} */ e) { error = e.message; }
    finally { loading = false; }
  }

  onMount(load);
</script>

<svelte:head><title>{attempt ? `Attempt ${attempt.reference || attempt.id?.slice(0,8)}` : 'Cargando…'} — ISP Manager</title></svelte:head>

<button type="button" on:click={() => goto('/payment-links')} class="btn-ghost btn-sm mb-3 flex items-center gap-1.5">
  <ArrowLeft size={14} /> Volver a Trazabilidad Wompi
</button>

{#if loading}
  <div class="flex items-center justify-center py-24"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}
  <div class="card p-8 text-center"><p class="text-red-500">{error}</p></div>
{:else if attempt}
  <div class="card p-5 mb-4">
    <div class="flex items-start justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-xl font-semibold text-text-primary flex items-center gap-2">
          <ShoppingBag size={20} /> PaymentAttempt <span class="font-mono text-brand-600">{attempt.reference || attempt.id?.slice(0,8)}</span>
        </h1>
        <p class="text-sm text-text-muted mt-0.5">Creado {fmtDate(attempt.createdAt)}</p>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <div class="card p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Detalle del intento</h2>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-text-muted">ID</dt><dd class="font-mono text-xs text-text-primary">{attempt.id}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">External ID</dt><dd class="font-mono text-xs text-text-primary">{attempt.externalId || '—'}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Referencia</dt><dd class="font-mono text-xs text-text-primary">{attempt.reference || '—'}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Monto</dt><dd class="font-medium text-text-primary">{fmtCOP(attempt.amount)}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Moneda</dt><dd class="text-text-primary">{attempt.currency || 'COP'}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Estado</dt>
          <dd>
            <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {attempt.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : attempt.status === 'FAILED' ? 'bg-red-100 text-red-700' : attempt.status === 'EXPIRED' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}">
              {{ PENDING:'Pendiente', COMPLETED:'Completado', FAILED:'Fallido', EXPIRED:'Expirado' }[attempt.status] || attempt.status}
            </span>
          </dd>
        </div>
        <div class="flex justify-between"><dt class="text-text-muted">Checkout URL</dt><dd class="text-xs break-all">{#if attempt.checkoutUrl}<a href={attempt.checkoutUrl} target="_blank" class="text-brand-600 hover:underline">{attempt.checkoutUrl}</a>{:else}—{/if}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Creado</dt><dd class="text-xs">{fmtDate(attempt.createdAt)}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Actualizado</dt><dd class="text-xs">{fmtDate(attempt.updatedAt)}</dd></div>
      </dl>
    </div>

    <div class="card p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Cliente</h2>
      {#if attempt.client}
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-text-muted">Nombre</dt><dd class="text-text-primary">{attempt.client.name || '—'}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Documento</dt><dd class="text-text-primary">{attempt.client.documentType || ''} {attempt.client.documentNumber || ''}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Email</dt><dd class="text-text-primary">{attempt.client.email || '—'}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Teléfono</dt><dd class="text-text-primary">{attempt.client.phone || '—'}</dd></div>
        </dl>
      {:else}<p class="text-sm text-text-muted">Sin datos</p>{/if}
    </div>
  </div>

  <div class="card p-5 mb-4">
    <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Factura</h2>
    {#if attempt.invoice}
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-text-muted">Número</dt><dd><a href="/invoices/{attempt.invoice.id}" class="text-brand-600 hover:underline">{attempt.invoice.invoiceNumber}</a></dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Total</dt><dd class="font-medium">{fmtCOP(attempt.invoice.total)}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Estado</dt><dd class="text-text-primary">{attempt.invoice.status}</dd></div>
      </dl>
      {#if attempt.invoice.payments?.length}
        <div class="mt-3 border-t border-slate-100 pt-3">
          <p class="text-xs font-semibold text-text-muted mb-2">Pagos registrados</p>
          {#each attempt.invoice.payments as p}
            <div class="flex items-center justify-between text-xs py-1">
              <span class="text-text-muted font-mono">{p.transactionId || p.id?.slice(0,8)}</span>
              <span class="text-text-primary font-medium">{fmtCOP(p.amount)}</span>
              <span class="{p.status === 'COMPLETED' ? 'text-emerald-600' : 'text-amber-600'}">{p.status}</span>
              <span class="text-text-muted">{fmtDate(p.createdAt)}</span>
            </div>
          {/each}
        </div>
      {/if}
    {:else}<p class="text-sm text-text-muted">Sin factura asociada</p>{/if}
  </div>

  {#if attempt.webhookPayload}
    <div class="card p-5 mb-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">WebhookPayload (Wompi)</h2>
      <details>
        <summary class="text-sm text-brand-600 cursor-pointer hover:underline">Ver payload JSON completo</summary>
        <pre class="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono overflow-auto max-h-96">{JSON.stringify(attempt.webhookPayload, null, 2)}</pre>
      </details>
    </div>
  {/if}
{/if}
