<script>
  import { onMount } from 'svelte';
  import { invoicesApi } from '$lib/api/invoices.api.js';
  import {
    Search, FileText, Eye, AlertCircle,
    Wallet, Clock, CheckCircle2, AlertTriangle
  } from 'lucide-svelte';

  let invoices = [];
  let total = 0;
  let loading = true;
  let error = '';

  let q = '';
  let status = '';
  let page = 1;
  const pageSize = 20;
  let searchTimer;

  async function load() {
    loading = true; error = '';
    try {
      const params = { page, limit: pageSize };
      if (q.trim()) params.search = q.trim();
      if (status)   params.status = status;
      const res = await invoicesApi.getPage(params);
      invoices = res?.data ?? [];
      total    = res?.meta?.total ?? invoices.length;
    } catch (e) {
      error = e.message || 'Error al cargar facturas';
    } finally { loading = false; }
  }
  onMount(load);

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 300);
  }
  function onStatusChange() { page = 1; load(); }

  $: totalPages = Math.max(1, Math.ceil(total / pageSize));
  function setPage(p) { if (p < 1 || p > totalPages || p === page) return; page = p; load(); }

  // KPIs derived from current page
  $: kpiTotal      = total;
  $: kpiPending    = invoices.filter(i => i.status === 'PENDING').length;
  $: kpiPaid       = invoices.filter(i => i.status === 'PAID').length;
  $: kpiPendingAmt = invoices.filter(i => i.status === 'PENDING' || i.status === 'OVERDUE').reduce((s,i) => s + (i.total || 0), 0);

  function fmtMoney(cents) {
    if (cents == null) return '—';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  }
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  const STATUS_PT = { DRAFT:'Borrador', PENDING:'Pendiente', PAID:'Pagada', OVERDUE:'Vencida', CANCELLED:'Cancelada', REFUNDED:'Reembolsada' };
  const STATUS_CLS = { PAID:'badge-green', PENDING:'badge-yellow', OVERDUE:'badge-red', CANCELLED:'badge-gray', DRAFT:'badge-gray', REFUNDED:'badge-blue' };
</script>

<svelte:head><title>Facturas — ISP Manager</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Facturas</h1>
    <p class="page-subtitle">{total} {total === 1 ? 'factura' : 'facturas'} en el sistema</p>
  </div>
</div>

<!-- KPI strip -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  <div class="kpi-tile">
    <div class="icon-square-blue"><FileText size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Total</div>
      <div class="kpi-value">{kpiTotal}</div>
      <div class="kpi-sub">Facturas en sistema</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-amber"><Clock size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Pendientes (página)</div>
      <div class="kpi-value">{kpiPending}</div>
      <div class="kpi-sub">Por cobrar</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-green"><CheckCircle2 size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Pagadas (página)</div>
      <div class="kpi-value">{kpiPaid}</div>
      <div class="kpi-sub">Este conjunto</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-rose"><Wallet size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Cobranza (página)</div>
      <div class="kpi-value">{fmtMoney(kpiPendingAmt)}</div>
      <div class="kpi-sub">Pendiente + vencida</div>
    </div>
  </div>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

<div class="card mb-5">
  <div class="p-4 flex items-center gap-3 flex-wrap">
    <div class="relative flex-1 min-w-[220px] max-w-sm">
      <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input class="input-search" placeholder="Número, cliente, cédula..." bind:value={q} on:input={onSearchInput} />
    </div>
    <select class="select w-auto min-w-[160px]" bind:value={status} on:change={onStatusChange}>
      <option value="">Todos los estados</option>
      <option value="PENDING">Pendiente</option>
      <option value="PAID">Pagada</option>
      <option value="OVERDUE">Vencida</option>
      <option value="CANCELLED">Cancelada</option>
      <option value="REFUNDED">Reembolsada</option>
      <option value="DRAFT">Borrador</option>
    </select>
    {#if q || status}
      <button class="btn-ghost text-xs" on:click={() => { q=''; status=''; page=1; load(); }}>Limpiar</button>
    {/if}
  </div>
</div>

<div class="card overflow-hidden">
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          <th>Número</th>
          <th>Cliente</th>
          <th>Emisión</th>
          <th>Vencimiento</th>
          <th class="text-right">Subtotal</th>
          <th class="text-right">Total</th>
          <th>Estado</th>
          <th>Pagada</th>
          <th class="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="9" class="py-16 text-center">
            <div class="flex items-center justify-center gap-2">
              <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-slate-500 text-sm">Cargando facturas...</span>
            </div>
          </td></tr>
        {:else if invoices.length === 0}
          <tr><td colspan="9" class="py-20 text-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <FileText size={28} class="text-slate-400" />
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-700">
                  {q || status ? 'Ninguna factura coincide con los filtros' : 'Aún no hay facturas'}
                </p>
              </div>
            </div>
          </td></tr>
        {:else}
          {#each invoices as inv}
            <tr>
              <td class="font-mono text-xs text-slate-700">{inv.number}</td>
              <td>
                <a href="/clients/{inv.client?.id}" class="font-medium text-slate-900 hover:text-brand-800 transition-colors">
                  {inv.client?.name ?? '—'}
                </a>
                {#if inv.client?.documentNumber}
                  <div class="text-xs text-slate-400 mt-0.5">{inv.client.documentNumber}</div>
                {/if}
              </td>
              <td class="text-slate-600">{fmtDate(inv.issueDate)}</td>
              <td class="text-slate-600">{fmtDate(inv.dueDate)}</td>
              <td class="text-right font-mono text-xs text-slate-600">{fmtMoney(inv.amount)}</td>
              <td class="text-right font-mono text-xs font-semibold">{fmtMoney(inv.total)}</td>
              <td><span class="{STATUS_CLS[inv.status] || 'badge-gray'}">{STATUS_PT[inv.status] || inv.status}</span></td>
              <td class="text-slate-600 text-xs">{fmtDate(inv.paidDate)}</td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <a href="/invoices/{inv.id}" class="btn-icon" title="Ver">
                    <Eye size={14} />
                  </a>
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40">
    <span class="text-xs text-slate-500">
      Mostrando {invoices.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
    </span>
    <div class="flex items-center gap-1">
      <button class="btn-ghost text-xs py-1" disabled={page <= 1} on:click={() => setPage(page - 1)}>← Anterior</button>
      <span class="px-3 py-1 bg-brand-800 text-white text-xs rounded-md font-medium">{page} / {totalPages}</span>
      <button class="btn-ghost text-xs py-1" disabled={page >= totalPages} on:click={() => setPage(page + 1)}>Siguiente →</button>
    </div>
  </div>
</div>
