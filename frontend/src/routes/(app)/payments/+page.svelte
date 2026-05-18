<script>
  import { onMount } from 'svelte';
  import { paymentsApi } from '$lib/api/payments.api.js';
  import {
    Search, CreditCard, Eye, AlertCircle,
    DollarSign, Clock, CheckCircle2, XCircle, RefreshCw
  } from 'lucide-svelte';

  let payments = [];
  let total = 0;
  let loading = true;
  let error = '';

  let q = '';
  let status = '';
  let method = '';
  let page = 1;
  const pageSize = 20;
  let searchTimer;

  async function load() {
    loading = true; error = '';
    try {
      const params = { page, limit: pageSize };
      if (q.trim()) params.search = q.trim();
      if (status) params.status = status;
      if (method) params.paymentMethod = method;
      const res = await paymentsApi.getAll(params);
      payments = res?.data ?? [];
      total = res?.meta?.total ?? payments.length;
    } catch (e) {
      error = e.message || 'Error al cargar pagos';
    } finally { loading = false; }
  }
  onMount(load);

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 300);
  }

  $: totalPages = Math.max(1, Math.ceil(total / pageSize));
  function setPage(p) { if (p < 1 || p > totalPages || p === page) return; page = p; load(); }

  $: kpiTotal = total;
  $: kpiCompleted = payments.filter(p => p.status === 'COMPLETED').length;
  $: kpiPending = payments.filter(p => p.status === 'PENDING').length;
  $: kpiAmount = payments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + (p.amount || 0), 0);

  function fmtMoney(cents) {
    if (cents == null) return '—';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  }
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  const STATUS_PT = { PENDING:'Pendiente', COMPLETED:'Completado', FAILED:'Fallido', REFUNDED:'Reembolsado', CANCELLED:'Cancelado' };
  const STATUS_CLS = { COMPLETED:'badge-green', PENDING:'badge-yellow', FAILED:'badge-red', REFUNDED:'badge-blue', CANCELLED:'badge-gray' };
  const METHOD_PT = { CASH:'Efectivo', BANK_TRANSFER:'Transferencia', WOMPI:'Wompi', NEQUI:'Nequi', BANCOLOMBIA:'Bancolombia', CREDIT_CARD:'Tarjeta', OTHER:'Otro' };
</script>

<svelte:head><title>Pagos — ISP Manager</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Pagos Recibidos</h1>
    <p class="page-subtitle">{total} {total === 1 ? 'pago' : 'pagos'} registrados</p>
  </div>
</div>

<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  <div class="kpi-tile">
    <div class="icon-square-blue"><CreditCard size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Total</div>
      <div class="kpi-value">{kpiTotal}</div>
      <div class="kpi-sub">Pagos registrados</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-green"><CheckCircle2 size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Completados</div>
      <div class="kpi-value">{kpiCompleted}</div>
      <div class="kpi-sub">En esta página</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-amber"><Clock size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Pendientes</div>
      <div class="kpi-value">{kpiPending}</div>
      <div class="kpi-sub">Por procesar</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-rose"><DollarSign size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Ingresos (página)</div>
      <div class="kpi-value">{fmtMoney(kpiAmount)}</div>
      <div class="kpi-sub">Total completado</div>
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
      <input class="input-search" placeholder="Buscar por cliente, factura..." bind:value={q} on:input={onSearchInput} />
    </div>
    <select class="select w-auto min-w-[140px]" bind:value={status} on:change={() => { page = 1; load(); }}>
      <option value="">Todos los estados</option>
      <option value="COMPLETED">Completado</option>
      <option value="PENDING">Pendiente</option>
      <option value="FAILED">Fallido</option>
      <option value="REFUNDED">Reembolsado</option>
    </select>
    <select class="select w-auto min-w-[140px]" bind:value={method} on:change={() => { page = 1; load(); }}>
      <option value="">Todos los métodos</option>
      <option value="CASH">Efectivo</option>
      <option value="BANK_TRANSFER">Transferencia</option>
      <option value="WOMPI">Wompi</option>
      <option value="NEQUI">Nequi</option>
      <option value="BANCOLOMBIA">Bancolombia</option>
    </select>
    {#if q || status || method}
      <button class="btn-ghost text-xs" on:click={() => { q=''; status=''; method=''; page=1; load(); }}>Limpiar</button>
    {/if}
  </div>
</div>

<div class="card overflow-hidden">
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Factura</th>
          <th>Cliente</th>
          <th>Monto</th>
          <th>Método</th>
          <th>Estado</th>
          <th>Fecha</th>
          <th>Transacción</th>
          <th class="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="9" class="py-16 text-center">
            <div class="flex items-center justify-center gap-2">
              <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-slate-500 text-sm">Cargando pagos...</span>
            </div>
          </td></tr>
        {:else if payments.length === 0}
          <tr><td colspan="9" class="py-20 text-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <CreditCard size={28} class="text-slate-400" />
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-700">
                  {q || status || method ? 'Ningún pago coincide con los filtros' : 'Aún no hay pagos registrados'}
                </p>
              </div>
            </div>
          </td></tr>
        {:else}
          {#each payments as pay}
            <tr>
              <td class="font-mono text-xs text-slate-500">#{pay.id.slice(-8)}</td>
              <td class="font-mono text-xs text-slate-700">{pay.invoice?.number || '—'}</td>
              <td>
                <a href="/clients/{pay.client?.id}" class="font-medium text-slate-900 hover:text-brand-800 transition-colors">
                  {pay.client?.name ?? '—'}
                </a>
              </td>
              <td class="text-right font-mono text-xs font-semibold text-slate-900">{fmtMoney(pay.amount)}</td>
              <td class="text-slate-600 text-xs">{METHOD_PT[pay.method] || pay.method}</td>
              <td><span class="{STATUS_CLS[pay.status] || 'badge-gray'}">{STATUS_PT[pay.status] || pay.status}</span></td>
              <td class="text-slate-600 text-xs">{fmtDate(pay.createdAt)}</td>
              <td class="font-mono text-xs text-slate-500">{pay.transactionId?.slice(0,12) || pay.externalId?.slice(0,12) || '—'}</td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <a href="/invoices/{pay.invoiceId}" class="btn-icon" title="Ver Factura">
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
      Mostrando {payments.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
    </span>
    <div class="flex items-center gap-1">
      <button class="btn-ghost text-xs py-1" disabled={page <= 1} on:click={() => setPage(page - 1)}>← Anterior</button>
      <span class="px-3 py-1 bg-brand-800 text-white text-xs rounded-md font-medium">{page} / {totalPages}</span>
      <button class="btn-ghost text-xs py-1" disabled={page >= totalPages} on:click={() => setPage(page + 1)}>Siguiente →</button>
    </div>
  </div>
</div>