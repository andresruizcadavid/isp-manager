<script>
  import { onMount } from 'svelte';
  import {
    ExternalLink, Search, Loader2, Link2, Filter, ChevronLeft, ChevronRight,
    CheckCircle, XCircle, Clock, AlertTriangle, Eye, RotateCw, Activity,
    ShoppingBag, AlertOctagon, FileText
  } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { paymentLinksApi } from '$lib/api/payment-links.api.js';

  let tab = 'links';

  // ── Links tab ───────────────────────────────────────────
  /** @type {any[]} */
  let links = [];
  let total = 0;
  let page = 1;
  let pages = 1;
  let loading = true;
  let error = '';
  let statusFilter = '';
  let searchQ = '';
  /** @type {any[]} */
  let summary = [];
  /** @type {Record<string, boolean>} */
  let resending = {};

  const STATUS_OPTIONS = [
    { value: '', label: 'Todos' },
    { value: 'pending', label: 'Pendientes' },
    { value: 'paid', label: 'Pagados' },
    { value: 'expired', label: 'Expirados' },
    { value: 'cancelled', label: 'Cancelados' }
  ];

  /** @param {number} [c] */
  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((c||0)/100); }
  /** @param {string|Date|null|undefined} d */
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : ''; }
  /** @param {string|Date|null|undefined} d */
  function fmtDateShort(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : '—'; }
  /** @param {string} s */
  function statusIcon(s) { if (s === 'paid') return CheckCircle; if (s === 'expired' || s === 'cancelled') return XCircle; return Clock; }
  /** @param {string} s */
  function statusClass(s) { if (s === 'paid') return 'bg-emerald-100 text-emerald-700'; if (s === 'expired') return 'bg-slate-100 text-slate-600'; if (s === 'cancelled') return 'bg-red-100 text-red-700'; return 'bg-amber-100 text-amber-700'; }
  /** @param {string} s */
  function statusLabel(s) { return (/** @type {Record<string,string>} */ ({ paid:'Pagado', pending:'Pendiente', expired:'Expirado', cancelled:'Cancelado' }))[s] || s; }

  async function loadLinks() {
    loading = true; error = '';
    try {
      const data = await paymentLinksApi.getAll({
        page, limit: 50, status: statusFilter || undefined, q: searchQ.trim() || undefined
      });
      links = data.links; total = data.total; page = data.page; pages = data.pages; summary = data.summary || [];
    } catch (/** @type {any} */ e) { error = e.message; links = []; }
    finally { loading = false; }
  }

  /** @param {string} st */
  function summaryCount(st) { const s = summary.find(s => s.status === st); return s ? s._count : 0; }
  function goPrev() { if (page > 1) { page--; loadLinks(); } }
  function goNext() { if (page < pages) { page++; loadLinks(); } }
  function applyFilter() { page = 1; loadLinks(); }

  /** @param {string} id */
  async function handleResend(id) {
    resending[id] = true;
    try {
      const result = await paymentLinksApi.resend(id);
      if (result.checkoutUrl) window.open(result.checkoutUrl, '_blank');
    } catch (/** @type {any} */ e) { alert(e.message); }
    finally { resending[id] = false; }
  }

  // ── Attempts tab ────────────────────────────────────────
  /** @type {any[]} */
  let attempts = [];
  let attemptsTotal = 0;
  let attemptsPage = 1;
  let attemptsPages = 1;
  let attemptsLoading = false;
  let attemptsError = '';
  let attemptsStatusFilter = '';
  let attemptsQ = '';
  /** @type {any[]} */
  let attemptsSummary = [];

  const ATTEMPT_STATUS_OPTIONS = [
    { value: '', label: 'Todos' },
    { value: 'PENDING', label: 'Pendientes' },
    { value: 'COMPLETED', label: 'Completados' },
    { value: 'FAILED', label: 'Fallidos' },
    { value: 'EXPIRED', label: 'Expirados' }
  ];

  /** @param {string} s */
  function attemptClass(s) {
    if (s === 'COMPLETED') return 'bg-emerald-100 text-emerald-700';
    if (s === 'FAILED') return 'bg-red-100 text-red-700';
    if (s === 'EXPIRED') return 'bg-slate-100 text-slate-600';
    return 'bg-amber-100 text-amber-700';
  }
  /** @param {string} s */
  function attemptLabel(s) {
    return (/** @type {Record<string,string>} */ ({ PENDING:'Pendiente', COMPLETED:'Completado', FAILED:'Fallido', EXPIRED:'Expirado' }))[s] || s;
  }
  /** @param {string} s */
  function attemptIcon(s) {
    if (s === 'COMPLETED') return CheckCircle;
    if (s === 'FAILED' || s === 'EXPIRED') return XCircle;
    return Clock;
  }
  /** @param {string} st */
  function attemptsSummaryCount(st) {
    const s = attemptsSummary.find(s => s.status === st);
    return s ? s._count : 0;
  }

  async function loadAttempts() {
    attemptsLoading = true; attemptsError = '';
    try {
      const data = await paymentLinksApi.getAttempts({
        page: attemptsPage, limit: 50, status: attemptsStatusFilter || undefined, q: attemptsQ.trim() || undefined
      });
      attempts = data.attempts; attemptsTotal = data.total; attemptsPage = data.page; attemptsPages = data.pages;
      attemptsSummary = data.summary || [];
    } catch (/** @type {any} */ e) { attemptsError = e.message; attempts = []; }
    finally { attemptsLoading = false; }
  }

  function attGoPrev() { if (attemptsPage > 1) { attemptsPage--; loadAttempts(); } }
  function attGoNext() { if (attemptsPage < attemptsPages) { attemptsPage++; loadAttempts(); } }
  function attApplyFilter() { attemptsPage = 1; loadAttempts(); }

  // ── Conciliation tab ────────────────────────────────────
  /** @type {any[]} */
  let conciliationItems = [];
  let conciliationCounts = { expiredNoPayment: 0, orphanPayments: 0, attemptNoPayment: 0 };
  let conciliationLoading = false;
  let conciliationError = '';
  let conciliationTypeFilter = 'all';

  const CONCIL_TYPES = [
    { value: 'all', label: 'Todos' },
    { value: 'link_expirado_sin_pago', label: 'Links expirados sin pago' },
    { value: 'pago_huertfano_sin_link', label: 'Pagos huérfanos sin link' },
    { value: 'attempt_completado_sin_payment', label: 'Attempts sin Payment' }
  ];

  /** @param {string} type */
  function concilIcon(type) {
    if (type === 'link_expirado_sin_pago') return Clock;
    if (type === 'pago_huertfano_sin_link') return AlertOctagon;
    return AlertTriangle;
  }

  /** @param {string} type */
  function concilClass(type) {
    if (type === 'link_expirado_sin_pago') return 'bg-amber-50 border-amber-200';
    if (type === 'pago_huertfano_sin_link') return 'bg-red-50 border-red-200';
    return 'bg-orange-50 border-orange-200';
  }

  /** @param {string} type */
  function concilLabel(type) {
    if (type === 'link_expirado_sin_pago') return 'Link expirado — sin pago';
    if (type === 'pago_huertfano_sin_link') return 'Pago huérfano — sin link asociado';
    if (type === 'attempt_completado_sin_payment') return 'Attempt completado — sin Payment creado';
    return type;
  }

  async function loadConciliation() {
    conciliationLoading = true; conciliationError = '';
    try {
      const data = await paymentLinksApi.getConciliation();
      conciliationItems = data.items || [];
      conciliationCounts = data.counts || { expiredNoPayment: 0, orphanPayments: 0, attemptNoPayment: 0 };
    } catch (/** @type {any} */ e) { conciliationError = e.message; conciliationItems = []; }
    finally { conciliationLoading = false; }
  }

  $: filteredConciliation = conciliationTypeFilter === 'all'
    ? conciliationItems
    : conciliationItems.filter(i => i.type === conciliationTypeFilter);

  // ── Init ────────────────────────────────────────────────
  onMount(() => { loadLinks(); });
</script>

<svelte:head><title>Trazabilidad Wompi — ISP Manager</title></svelte:head>

<div class="flex items-center justify-between mb-4">
  <div>
    <h1 class="text-xl font-semibold text-text-primary flex items-center gap-2"><Activity size={20} /> Trazabilidad Wompi</h1>
    <p class="text-sm text-text-muted mt-0.5">Auditoría completa de links de pago, intentos y conciliación</p>
  </div>
</div>

<!-- Tabs -->
<div class="card mb-4">
  <div class="flex items-center gap-1 overflow-x-auto p-1.5">
    {#each [
      { id: 'links', label: 'Links de Pago', icon: Link2 },
      { id: 'attempts', label: 'PaymentAttempts', icon: ShoppingBag },
      { id: 'conciliation', label: 'Conciliación', icon: AlertOctagon }
    ] as t}
      <button type="button" on:click={() => { tab = t.id; if (t.id === 'attempts' && attempts.length === 0 && !attemptsLoading) loadAttempts(); if (t.id === 'conciliation' && conciliationItems.length === 0 && !conciliationLoading) loadConciliation(); }}
        class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors {tab === t.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}">
        <svelte:component this={t.icon} size={14} />
        {t.label}
      </button>
    {/each}
  </div>
</div>

<!-- ════════════════════════════════════════════════════════════
     TAB 1 — LINKS DE PAGO
     ════════════════════════════════════════════════════════════ -->
{#if tab === 'links'}
  <!-- Summary cards -->
  <div class="grid grid-cols-4 gap-3 mb-4">
    {#each STATUS_OPTIONS.filter(o => o.value) as opt}
      <button type="button" on:click={() => { statusFilter = opt.value; applyFilter(); }}
        class="card p-3 text-center cursor-pointer transition-colors {statusFilter === opt.value ? 'ring-2 ring-brand-500' : ''}">
        <div class="text-2xl font-bold text-text-primary">{summaryCount(opt.value)}</div>
        <div class="text-xs text-text-muted mt-0.5">{opt.label}</div>
      </button>
    {/each}
  </div>

  <!-- Filters -->
  <div class="card p-3 mb-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-[200px]">
        <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input type="text" bind:value={searchQ} placeholder="Buscar por cliente, factura o referencia…"
          class="input pl-9" on:keydown={e => { if (e.key === 'Enter') applyFilter(); }} />
      </div>
      <select bind:value={statusFilter} on:change={applyFilter} class="input w-auto">
        {#each STATUS_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
      <button type="button" on:click={applyFilter} class="btn-primary flex items-center gap-1.5"><Filter size={14} /> Filtrar</button>
    </div>
  </div>

  <!-- Table -->
  <div class="card overflow-hidden">
    {#if loading}
      <div class="flex items-center justify-center py-16"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
    {:else if error}
      <div class="p-8 text-center"><p class="text-red-500 text-sm">{error}</p></div>
    {:else if links.length === 0}
      <div class="p-8 text-center"><p class="text-text-muted text-sm">No se encontraron links de pago</p></div>
    {:else}
      <div class="overflow-x-auto">
        <table class="data-table w-full">
          <thead>
            <tr>
              <th class="text-left">Referencia</th>
              <th class="text-left">Cliente</th>
              <th class="text-left">Factura</th>
              <th class="text-right">Monto</th>
              <th class="text-center">Estado</th>
              <th class="text-left">Enviado</th>
              <th class="text-left">Abierto</th>
              <th class="text-left">Creado</th>
              <th class="text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {#each links as link}
              <tr class="cursor-pointer hover:bg-slate-50" on:click={() => goto(`/payment-links/${link.id}`)}>
                <td class="font-mono text-xs text-text-secondary">{link.reference}</td>
                <td>
                  <div class="text-sm font-medium text-text-primary">{link.client?.name || '—'}</div>
                  <div class="text-xs text-text-muted">{link.client?.documentType || ''} {link.client?.documentNumber || ''}</div>
                </td>
                <td>
                  <a href="/invoices/{link.invoice?.id}" class="text-sm text-brand-600 hover:underline" on:click|stopPropagation>
                    {link.invoice?.invoiceNumber || '—'}
                  </a>
                </td>
                <td class="text-right font-medium text-text-primary">{fmtCOP(link.amountInCents)}</td>
                <td class="text-center">
                  <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {statusClass(link.status)}">
                    <svelte:component this={statusIcon(link.status)} size={12} />
                    {statusLabel(link.status)}
                  </span>
                </td>
                <td class="text-xs text-text-muted">{fmtDateShort(link.sentAt)}</td>
                <td class="text-xs text-text-muted">{fmtDateShort(link.openedAt)}</td>
                <td class="text-xs text-text-muted">{fmtDate(link.createdAt)}</td>
                <td class="text-center">
                  <div class="flex items-center justify-center gap-1">
                    <a href="/payment-links/{link.id}" class="btn-icon" title="Ver detalle" on:click|stopPropagation>
                      <Eye size={14} />
                    </a>
                    {#if link.status !== 'paid'}
                      <button type="button" on:click|stopPropagation={() => handleResend(link.id)} disabled={resending[link.id]} class="btn-icon" title="Reenviar link">
                        {#if resending[link.id]}
                          <Loader2 size={14} class="animate-spin" />
                        {:else}
                          <RotateCw size={14} />
                        {/if}
                      </button>
                    {/if}
                    {#if link.checkoutUrl}
                      <a href={link.checkoutUrl} target="_blank" class="btn-icon" title="Abrir checkout" on:click|stopPropagation>
                        <ExternalLink size={14} />
                      </a>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if pages > 1}
        <div class="flex items-center justify-between px-5 py-3 border-t border-slate-100">
          <span class="text-xs text-text-muted">Página {page} de {pages} ({total} resultados)</span>
          <div class="flex items-center gap-2">
            <button type="button" on:click={goPrev} disabled={page <= 1} class="btn-secondary btn-sm"><ChevronLeft size={14} /> Anterior</button>
            <button type="button" on:click={goNext} disabled={page >= pages} class="btn-secondary btn-sm">Siguiente <ChevronRight size={14} /></button>
          </div>
        </div>
      {/if}
    {/if}
  </div>

<!-- ════════════════════════════════════════════════════════════
     TAB 2 — PAYMENT ATTEMPTS
     ════════════════════════════════════════════════════════════ -->
{:else if tab === 'attempts'}
  <!-- Summary cards -->
  <div class="grid grid-cols-4 gap-3 mb-4">
    {#each ATTEMPT_STATUS_OPTIONS.filter(o => o.value) as opt}
      <button type="button" on:click={() => { attemptsStatusFilter = opt.value; attApplyFilter(); }}
        class="card p-3 text-center cursor-pointer transition-colors {attemptsStatusFilter === opt.value ? 'ring-2 ring-brand-500' : ''}">
        <div class="text-2xl font-bold text-text-primary">{attemptsSummaryCount(opt.value)}</div>
        <div class="text-xs text-text-muted mt-0.5">{opt.label}</div>
      </button>
    {/each}
  </div>

  <!-- Filters -->
  <div class="card p-3 mb-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-[200px]">
        <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input type="text" bind:value={attemptsQ} placeholder="Buscar por referencia, factura o cliente…"
          class="input pl-9" on:keydown={e => { if (e.key === 'Enter') attApplyFilter(); }} />
      </div>
      <select bind:value={attemptsStatusFilter} on:change={attApplyFilter} class="input w-auto">
        {#each ATTEMPT_STATUS_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
      <button type="button" on:click={attApplyFilter} class="btn-primary flex items-center gap-1.5"><Filter size={14} /> Filtrar</button>
    </div>
  </div>

  <!-- Table -->
  <div class="card overflow-hidden">
    {#if attemptsLoading}
      <div class="flex items-center justify-center py-16"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
    {:else if attemptsError}
      <div class="p-8 text-center"><p class="text-red-500 text-sm">{attemptsError}</p></div>
    {:else if attempts.length === 0}
      <div class="p-8 text-center"><p class="text-text-muted text-sm">No se encontraron intentos de pago</p></div>
    {:else}
      <div class="overflow-x-auto">
        <table class="data-table w-full">
          <thead>
            <tr>
              <th class="text-left">Referencia</th>
              <th class="text-left">Cliente</th>
              <th class="text-left">Factura</th>
              <th class="text-right">Monto</th>
              <th class="text-center">Estado</th>
              <th class="text-left">Creado</th>
              <th class="text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {#each attempts as att}
              <tr class="cursor-pointer hover:bg-slate-50" on:click={() => goto(`/payment-links/attempt/${att.id}`)}>
                <td class="font-mono text-xs text-text-secondary">{att.reference || att.externalId || '—'}</td>
                <td>
                  <div class="text-sm font-medium text-text-primary">{att.client?.name || '—'}</div>
                  <div class="text-xs text-text-muted">{att.client?.documentType || ''} {att.client?.documentNumber || ''}</div>
                </td>
                <td>
                  <a href="/invoices/{att.invoice?.id}" class="text-sm text-brand-600 hover:underline" on:click|stopPropagation>
                    {att.invoice?.invoiceNumber || '—'}
                  </a>
                </td>
                <td class="text-right font-medium text-text-primary">{fmtCOP(att.amount)}</td>
                <td class="text-center">
                  <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {attemptClass(att.status)}">
                    <svelte:component this={attemptIcon(att.status)} size={12} />
                    {attemptLabel(att.status)}
                  </span>
                </td>
                <td class="text-xs text-text-muted">{fmtDate(att.createdAt)}</td>
                <td class="text-center">
                  <a href="/payment-links/attempt/{att.id}" class="btn-icon" title="Ver detalle" on:click|stopPropagation>
                    <Eye size={14} />
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if attemptsPages > 1}
        <div class="flex items-center justify-between px-5 py-3 border-t border-slate-100">
          <span class="text-xs text-text-muted">Página {attemptsPage} de {attemptsPages} ({attemptsTotal} resultados)</span>
          <div class="flex items-center gap-2">
            <button type="button" on:click={attGoPrev} disabled={attemptsPage <= 1} class="btn-secondary btn-sm"><ChevronLeft size={14} /> Anterior</button>
            <button type="button" on:click={attGoNext} disabled={attemptsPage >= attemptsPages} class="btn-secondary btn-sm">Siguiente <ChevronRight size={14} /></button>
          </div>
        </div>
      {/if}
    {/if}
  </div>

<!-- ════════════════════════════════════════════════════════════
     TAB 3 — CONCILIACIÓN
     ════════════════════════════════════════════════════════════ -->
{:else if tab === 'conciliation'}
  <!-- Summary badges -->
  <div class="grid grid-cols-3 gap-3 mb-4">
    <div class="card p-3 flex items-center gap-3 border-l-4 border-amber-400">
      <Clock size={24} class="text-amber-500 shrink-0" />
      <div>
        <div class="text-2xl font-bold text-text-primary">{conciliationCounts.expiredNoPayment}</div>
        <div class="text-xs text-text-muted">Links expirados sin pago</div>
      </div>
    </div>
    <div class="card p-3 flex items-center gap-3 border-l-4 border-red-400">
      <AlertOctagon size={24} class="text-red-500 shrink-0" />
      <div>
        <div class="text-2xl font-bold text-text-primary">{conciliationCounts.orphanPayments}</div>
        <div class="text-xs text-text-muted">Pagos huérfanos sin link</div>
      </div>
    </div>
    <div class="card p-3 flex items-center gap-3 border-l-4 border-orange-400">
      <AlertTriangle size={24} class="text-orange-500 shrink-0" />
      <div>
        <div class="text-2xl font-bold text-text-primary">{conciliationCounts.attemptNoPayment}</div>
        <div class="text-xs text-text-muted">Attempts completados sin Payment</div>
      </div>
    </div>
  </div>

  <!-- Type filter -->
  <div class="card p-3 mb-4">
    <div class="flex flex-wrap items-center gap-3">
      <select bind:value={conciliationTypeFilter} class="input w-auto">
        {#each CONCIL_TYPES as t}
          <option value={t.value}>{t.label} ({t.value === 'all' ? conciliationItems.length : conciliationItems.filter(i => i.type === t.value).length})</option>
        {/each}
      </select>
      <button type="button" on:click={loadConciliation} class="btn-secondary flex items-center gap-1.5"><RotateCw size={14} /> Refrescar</button>
    </div>
  </div>

  <!-- Items -->
  <div class="card overflow-hidden">
    {#if conciliationLoading}
      <div class="flex items-center justify-center py-16"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
    {:else if conciliationError}
      <div class="p-8 text-center"><p class="text-red-500 text-sm">{conciliationError}</p></div>
    {:else if filteredConciliation.length === 0}
      <div class="p-8 text-center">
        <CheckCircle size={32} class="mx-auto text-emerald-400 mb-2" />
        <p class="text-text-muted text-sm">No se encontraron anomalías de conciliación</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="data-table w-full">
          <thead>
            <tr>
              <th class="text-left">Tipo</th>
              <th class="text-left">Referencia</th>
              <th class="text-left">Cliente</th>
              <th class="text-left">Factura</th>
              <th class="text-right">Monto</th>
              <th class="text-center">Estado Link</th>
              <th class="text-center">Estado Attempt</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredConciliation as item}
              <tr>
                <td>
                  <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {concilClass(item.type)}">
                    <svelte:component this={concilIcon(item.type)} size={12} />
                    {concilLabel(item.type)}
                  </span>
                </td>
                <td class="font-mono text-xs text-text-secondary">{item.reference || '—'}</td>
                <td>
                  <div class="text-sm font-medium text-text-primary">{item.client?.name || '—'}</div>
                  <div class="text-xs text-text-muted">{item.client?.documentType || ''} {item.client?.documentNumber || ''}</div>
                </td>
                <td>
                  <a href="/invoices/{item.invoice?.id}" class="text-sm text-brand-600 hover:underline">
                    {item.invoice?.invoiceNumber || '—'}
                  </a>
                </td>
                <td class="text-right font-medium text-text-primary">{fmtCOP(item.amountInCents)}</td>
                <td class="text-center">
                  {#if item.linkStatus}
                    <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {statusClass(item.linkStatus)}">
                      <svelte:component this={statusIcon(item.linkStatus)} size={12} />
                      {statusLabel(item.linkStatus)}
                    </span>
                  {:else}
                    <span class="text-xs text-text-muted">—</span>
                  {/if}
                </td>
                <td class="text-center">
                  {#if item.attemptStatus}
                    <span class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full {attemptClass(item.attemptStatus)}">
                      <svelte:component this={attemptIcon(item.attemptStatus)} size={12} />
                      {attemptLabel(item.attemptStatus)}
                    </span>
                  {:else}
                    <span class="text-xs text-text-muted">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}


