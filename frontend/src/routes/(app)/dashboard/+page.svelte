<script>
  import { onMount } from 'svelte';
  import { dashboardApi } from '$lib/api/dashboard.api.js';
  import {
    Users, CheckCircle2, FileText, AlertCircle,
    Router, Package, RefreshCw, BarChart3, Wallet, Calendar
  } from 'lucide-svelte';

  let stats = null;
  let loading = true;
  let error = '';

  async function load() {
    loading = true; error = '';
    try {
      stats = await dashboardApi.getStats();
    } catch (e) {
      error = e.message || 'Error cargando estadísticas';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  const fmtMoney = (cents) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((cents || 0) / 100);
  const fmtNum = (n) =>
    new Intl.NumberFormat('es-CO').format(n || 0);

  // Status pretty names
  const STATUS_PT = {
    ACTIVE: 'Activos', SUSPENDED: 'Suspendidos', INACTIVE: 'Inactivos', PENDING: 'Pendientes'
  };
  const INVOICE_STATUS_PT = {
    PAID: 'Pagadas', PENDING: 'Pendientes', OVERDUE: 'Vencidas',
    CANCELLED: 'Canceladas', DRAFT: 'Borradores', REFUNDED: 'Reembolsadas'
  };

  // Color cycles for bars
  const STATUS_COLOR = {
    ACTIVE: '#10b981', SUSPENDED: '#f59e0b', INACTIVE: '#94a3b8', PENDING: '#3b82f6'
  };
  const INVOICE_COLOR = {
    PAID: '#10b981', PENDING: '#f59e0b', OVERDUE: '#ef4444',
    CANCELLED: '#94a3b8', DRAFT: '#cbd5e1', REFUNDED: '#a855f7'
  };
  const PLAN_COLORS = ['#1e3a8a', '#7c3aed', '#0891b2', '#16a34a', '#ea580c', '#db2777'];

  // Derived bars (with safe defaults when stats null)
  $: byStatus = (stats?.clientsByStatus ?? []).slice().sort((a,b) => b.count - a.count);
  $: byPlan   = (stats?.clientsByPlan   ?? []).slice().sort((a,b) => b.count - a.count);
  $: byInvoice = (stats?.invoicesByStatus ?? []).slice().sort((a,b) => b.count - a.count);

  $: maxStatus  = Math.max(1, ...byStatus.map(b => b.count));
  $: maxPlan    = Math.max(1, ...byPlan.map(b => b.count));
  $: maxInvoice = Math.max(1, ...byInvoice.map(b => b.count));
</script>

<svelte:head><title>Dashboard — ISP Manager</title></svelte:head>

<!-- Header (mobile: stacked + compact) -->
<div class="flex flex-wrap items-start justify-between gap-3 mb-4 sm:mb-6">
  <div class="min-w-0">
    <h1 class="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 tracking-tight">
      Dashboard
    </h1>
    <p class="hidden sm:block text-sm text-slate-500 mt-1">
      Resumen de actividad — internet-online
    </p>
  </div>
  <div class="flex items-center gap-2">
    <button on:click={load} disabled={loading}
            class="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
                   bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50
                   active:scale-95 text-sm text-slate-700 transition
                   disabled:opacity-50">
      <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
      <span class="hidden xs:inline">Actualizar</span>
    </button>
    <span class="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
                 bg-white border border-slate-200 text-sm text-slate-500">
      <Calendar size={14} /> Esta semana
    </span>
  </div>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

<!-- KPI: horizontal scroll on < sm, grid on sm+ -->
<div class="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6
            overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 pb-2 sm:pb-0">

  <div class="kpi-tile shrink-0 min-w-[180px] sm:min-w-0">
    <div class="icon-square-blue"><Users size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Clientes</div>
      <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.totalClients)}</div>
      <div class="kpi-sub">Total registrados</div>
    </div>
  </div>

  <div class="kpi-tile shrink-0 min-w-[180px] sm:min-w-0">
    <div class="icon-square-green"><CheckCircle2 size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Activos</div>
      <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.activeClients)}</div>
      <div class="kpi-sub">Servicios prestando</div>
    </div>
  </div>

  <div class="kpi-tile shrink-0 min-w-[180px] sm:min-w-0">
    <div class="icon-square-amber"><FileText size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Facturas</div>
      <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.pendingInvoices)}</div>
      <div class="kpi-sub">Pendientes de cobro</div>
    </div>
  </div>

  <div class="kpi-tile shrink-0 min-w-[180px] sm:min-w-0">
    <div class="icon-square-rose"><Wallet size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Cobranza</div>
      <div class="kpi-value">{loading ? '–' : fmtMoney(stats?.kpis.pendingAmount)}</div>
      <div class="kpi-sub">Por recaudar</div>
    </div>
  </div>

  <div class="kpi-tile shrink-0 min-w-[180px] sm:min-w-0">
    <div class="icon-square-cyan"><Router size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Routers</div>
      <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.totalRouters)}</div>
      <div class="kpi-sub">Configurados</div>
    </div>
  </div>

</div>

<!-- Charts row: 1 col mobile, 1 col tablet, 3 col desktop -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 sm:mb-6">

  <!-- Clientes por Estado -->
  <div class="card p-4">
    <div class="flex items-center gap-3 mb-4">
      <div class="icon-square-green"><Users size={16} /></div>
      <div>
        <h3 class="text-sm font-semibold text-slate-900">Clientes por Estado</h3>
        <p class="text-xs text-slate-500">{stats?.kpis.totalClients ?? 0} usuarios totales</p>
      </div>
    </div>
    {#if loading}
      <div class="text-center text-xs text-slate-400 py-8">Cargando…</div>
    {:else if byStatus.length === 0}
      <div class="text-center text-xs text-slate-400 py-8">Sin datos</div>
    {:else}
      <div class="space-y-3">
        {#each byStatus as b}
          <div>
            <div class="flex items-center justify-between text-sm mb-1.5">
              <span class="text-slate-700">{STATUS_PT[b.status] ?? b.status}</span>
              <span class="text-slate-900 font-medium tabular-nums">{b.count}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: {(b.count / maxStatus) * 100}%; background: {STATUS_COLOR[b.status] ?? '#64748b'};"></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Clientes por Plan -->
  <div class="card p-4">
    <div class="flex items-center gap-3 mb-4">
      <div class="icon-square-purple"><Package size={16} /></div>
      <div>
        <h3 class="text-sm font-semibold text-slate-900">Clientes por Plan</h3>
        <p class="text-xs text-slate-500">Distribución del catálogo</p>
      </div>
    </div>
    {#if loading}
      <div class="text-center text-xs text-slate-400 py-8">Cargando…</div>
    {:else if byPlan.length === 0}
      <div class="text-center text-xs text-slate-400 py-8">Sin datos</div>
    {:else}
      <div class="space-y-3">
        {#each byPlan as b, i}
          <div>
            <div class="flex items-center justify-between text-sm mb-1.5">
              <span class="text-slate-700 truncate pr-2">{b.name}</span>
              <span class="text-slate-900 font-medium tabular-nums flex-shrink-0">{b.count}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: {(b.count / maxPlan) * 100}%; background: {PLAN_COLORS[i % PLAN_COLORS.length]};"></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Facturas por Estado -->
  <div class="card p-4">
    <div class="flex items-center gap-3 mb-4">
      <div class="icon-square-amber"><BarChart3 size={16} /></div>
      <div>
        <h3 class="text-sm font-semibold text-slate-900">Facturas por Estado</h3>
        <p class="text-xs text-slate-500">{stats?.kpis.totalInvoices ?? 0} facturas en total</p>
      </div>
    </div>
    {#if loading}
      <div class="text-center text-xs text-slate-400 py-8">Cargando…</div>
    {:else if byInvoice.length === 0}
      <div class="text-center text-xs text-slate-400 py-8">Sin datos</div>
    {:else}
      <div class="space-y-3">
        {#each byInvoice as b}
          <div>
            <div class="flex items-center justify-between text-sm mb-1.5">
              <span class="text-slate-700">{INVOICE_STATUS_PT[b.status] ?? b.status}</span>
              <div class="flex items-center gap-3">
                <span class="text-xs text-slate-400 tabular-nums">{fmtMoney(b.total)}</span>
                <span class="text-slate-900 font-medium tabular-nums">{b.count}</span>
              </div>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: {(b.count / maxInvoice) * 100}%; background: {INVOICE_COLOR[b.status] ?? '#64748b'};"></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Wide footer card: cobranza del mes -->
<div class="card p-4">
  <div class="flex items-center gap-3 mb-4">
    <div class="icon-square-blue"><Wallet size={16} /></div>
    <div>
      <h3 class="text-sm font-semibold text-slate-900">Cobranza del mes</h3>
      <p class="text-xs text-slate-500">Recaudo de pagos completados desde el día 1</p>
    </div>
  </div>
  <div class="flex items-baseline gap-3 flex-wrap">
    <span class="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums tracking-tight">
      {loading ? '–' : fmtMoney(stats?.kpis.paidThisMonth)}
    </span>
    <span class="text-xs sm:text-sm text-slate-400">recaudados este mes</span>
  </div>
</div>
