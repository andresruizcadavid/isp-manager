<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { paymentLinksApi } from '$lib/api/payment-links.api.js';
  import { Loader2, ArrowLeft, ExternalLink, CheckCircle, XCircle, Clock, RotateCw, Link2, Mail, Eye, CreditCard } from 'lucide-svelte';

  /** @type {any} */
  let link = null;
  let loading = true;
  let error = '';
  let resending = false;

  /** @param {number} [c] */
  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format((c||0)/100); }
  /** @param {string|Date|null|undefined} d */
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; }
  /** @param {string|Date|null|undefined} d */
  function fmtISO(d) { return d ? new Date(d).toISOString() : '—'; }

  async function load() {
    loading = true; error = '';
    try {
      link = await paymentLinksApi.getOne($page.params.id);
    } catch (/** @type {any} */ e) { error = e.message; }
    finally { loading = false; }
  }

  async function handleResend() {
    resending = true;
    try {
      const result = await paymentLinksApi.resend($page.params.id);
      if (result.checkoutUrl) window.open(result.checkoutUrl, '_blank');
    } catch (/** @type {any} */ e) { alert(e.message); }
    finally { resending = false; }
  }

  onMount(load);
</script>

<svelte:head><title>{link ? `Link ${link.reference}` : 'Cargando…'} — ISP Manager</title></svelte:head>

<button type="button" on:click={() => goto('/payment-links')} class="btn-ghost btn-sm mb-3 flex items-center gap-1.5">
  <ArrowLeft size={14} /> Volver a Trazabilidad Wompi
</button>

{#if loading}
  <div class="flex items-center justify-center py-24"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}
  <div class="card p-8 text-center"><p class="text-red-500">{error}</p></div>
{:else if link}
  <!-- Header -->
  <div class="card p-5 mb-4">
    <div class="flex items-start justify-between flex-wrap gap-3">
      <div>
        <h1 class="text-xl font-semibold text-text-primary flex items-center gap-2">
          <Link2 size={20} /> Link <span class="font-mono text-brand-600">{link.reference}</span>
        </h1>
        <p class="text-sm text-text-muted mt-0.5">
          Creado {fmtDate(link.createdAt)} &middot; {link.client?.name || 'Cliente desconocido'}
        </p>
      </div>
      <div class="flex items-center gap-2">
        {#if link.status !== 'paid'}
          <button type="button" on:click={handleResend} disabled={resending} class="btn-secondary btn-sm flex items-center gap-1.5">
            {#if resending}<Loader2 size={14} class="animate-spin" />{/if}
            <RotateCw size={14} /> Reenviar
          </button>
        {/if}
        {#if link.checkoutUrl}
          <a href={link.checkoutUrl} target="_blank" class="btn-primary btn-sm flex items-center gap-1.5">
            <ExternalLink size={14} /> Abrir checkout
          </a>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <!-- Info card -->
    <div class="card p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Información del Link</h2>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-text-muted">Referencia</dt><dd class="font-mono text-text-primary">{link.reference}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Monto</dt><dd class="font-medium text-text-primary">{fmtCOP(link.amountInCents)}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Moneda</dt><dd class="text-text-primary">{link.currency || 'COP'}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Estado</dt>
          <dd>
            <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {link.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : link.status === 'expired' ? 'bg-slate-100 text-slate-600' : link.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
              {{ paid:'Pagado', pending:'Pendiente', expired:'Expirado', cancelled:'Cancelado' }[link.status] || link.status}
            </span>
          </dd>
        </div>
        <div class="flex justify-between"><dt class="text-text-muted">Enlace de pago</dt>
          <dd>{#if link.checkoutUrl}<a href={link.checkoutUrl} target="_blank" class="text-brand-600 hover:underline text-xs">{link.checkoutUrl}</a>{:else}—{/if}</dd>
        </div>
      </dl>
    </div>

    <!-- Timeline -->
    <div class="card p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Línea de tiempo</h2>
      <div class="space-y-3">
        <div class="flex items-start gap-3">
          <div class="w-2 h-2 rounded-full mt-1.5 bg-brand-500 shrink-0" />
          <div><p class="text-sm text-text-primary">Creado</p><p class="text-xs text-text-muted">{fmtDate(link.createdAt)}</p></div>
        </div>
        {#if link.sentAt}
          <div class="flex items-start gap-3">
            <div class="w-2 h-2 rounded-full mt-1.5 bg-blue-500 shrink-0" />
            <div class="flex items-center gap-1.5"><Mail size={14} class="text-blue-500" /><div><p class="text-sm text-text-primary">Enviado al cliente</p><p class="text-xs text-text-muted">{fmtDate(link.sentAt)}</p></div></div>
          </div>
        {/if}
        {#if link.openedAt}
          <div class="flex items-start gap-3">
            <div class="w-2 h-2 rounded-full mt-1.5 bg-indigo-500 shrink-0" />
            <div class="flex items-center gap-1.5"><Eye size={14} class="text-indigo-500" /><div><p class="text-sm text-text-primary">Abierto por el cliente</p><p class="text-xs text-text-muted">{fmtDate(link.openedAt)}</p></div></div>
          </div>
        {/if}
        {#if link.paidAt}
          <div class="flex items-start gap-3">
            <div class="w-2 h-2 rounded-full mt-1.5 bg-emerald-500 shrink-0" />
            <div class="flex items-center gap-1.5"><CreditCard size={14} class="text-emerald-500" /><div><p class="text-sm text-text-primary">Pagado</p><p class="text-xs text-text-muted">{fmtDate(link.paidAt)}</p></div></div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
    <!-- Client info -->
    <div class="card p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Cliente</h2>
      {#if link.client}
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-text-muted">Nombre</dt><dd class="text-text-primary">{link.client.name || '—'}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Documento</dt><dd class="text-text-primary">{link.client.documentType || ''} {link.client.documentNumber || ''}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Email</dt><dd class="text-text-primary">{link.client.email || '—'}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Teléfono</dt><dd class="text-text-primary">{link.client.phone || '—'}</dd></div>
        </dl>
      {:else}<p class="text-sm text-text-muted">Sin datos</p>{/if}
    </div>

    <!-- Invoice info -->
    <div class="card p-5">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Factura</h2>
      {#if link.invoice}
        <dl class="space-y-2 text-sm">
          <div class="flex justify-between"><dt class="text-text-muted">Número</dt><dd><a href="/invoices/{link.invoice.id}" class="text-brand-600 hover:underline">{link.invoice.invoiceNumber}</a></dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Total</dt><dd class="font-medium">{fmtCOP(link.invoice.total)}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Estado</dt><dd class="text-text-primary">{link.invoice.status}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Vencimiento</dt><dd class="text-text-primary">{link.invoice.dueDate ? fmtDate(link.invoice.dueDate) : '—'}</dd></div>
          <div class="flex justify-between"><dt class="text-text-muted">Pagos asociados</dt><dd class="text-text-primary">{(link.invoice.payments || []).length}</dd></div>
        </dl>
        {#if link.invoice.payments?.length}
          <div class="mt-3 border-t border-slate-100 pt-3">
            <p class="text-xs font-semibold text-text-muted mb-2">Pagos registrados</p>
            {#each link.invoice.payments as p}
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
  </div>

  <!-- PaymentAttempt detail -->
  {#if link.paymentAttempt}
    <div class="card p-5 mb-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">PaymentAttempt asociado</h2>
      <div class="overflow-x-auto">
        <table class="data-table w-full text-sm">
          <thead>
            <tr>
              <th class="text-left">Campo</th>
              <th class="text-left">Valor</th>
            </tr>
          </thead>
          <tbody>
            <tr><td class="font-medium text-text-muted">ID</td><td class="font-mono text-xs">{link.paymentAttempt.id}</td></tr>
            <tr><td class="font-medium text-text-muted">External ID</td><td class="font-mono text-xs">{link.paymentAttempt.externalId || '—'}</td></tr>
            <tr><td class="font-medium text-text-muted">Referencia</td><td class="font-mono text-xs">{link.paymentAttempt.reference || '—'}</td></tr>
            <tr><td class="font-medium text-text-muted">Estado</td>
              <td>
                <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {link.paymentAttempt.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : link.paymentAttempt.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
                  {{ PENDING:'Pendiente', COMPLETED:'Completado', FAILED:'Fallido', EXPIRED:'Expirado' }[link.paymentAttempt.status] || link.paymentAttempt.status}
                </span>
              </td>
            </tr>
            <tr><td class="font-medium text-text-muted">Checkout URL</td><td class="text-xs break-all">{#if link.paymentAttempt.checkoutUrl}<a href={link.paymentAttempt.checkoutUrl} target="_blank" class="text-brand-600 hover:underline">{link.paymentAttempt.checkoutUrl}</a>{:else}—{/if}</td></tr>
            <tr><td class="font-medium text-text-muted">Creado</td><td class="text-xs">{fmtDate(link.paymentAttempt.createdAt)}</td></tr>
            <tr><td class="font-medium text-text-muted">Actualizado</td><td class="text-xs">{fmtDate(link.paymentAttempt.updatedAt)}</td></tr>
          </tbody>
        </table>
      </div>

      {#if link.paymentAttempt.webhookPayload}
        <details class="mt-3">
          <summary class="text-sm text-brand-600 cursor-pointer hover:underline">Ver webhookPayload</summary>
          <pre class="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-mono overflow-auto max-h-96">{JSON.stringify(link.paymentAttempt.webhookPayload, null, 2)}</pre>
        </details>
      {/if}
    </div>
  {/if}

  <!-- Campaign info -->
  {#if link.campaign}
    <div class="card p-5 mb-4">
      <h2 class="text-sm font-semibold uppercase tracking-wider text-text-muted mb-3">Campaña de notificación</h2>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between"><dt class="text-text-muted">ID</dt><dd class="font-mono text-xs">{link.campaign.id}</dd></div>
        <div class="flex justify-between"><dt class="text-text-muted">Nombre</dt><dd class="text-text-primary">{link.campaign.name || '—'}</dd></div>
      </dl>
    </div>
  {/if}
{/if}
