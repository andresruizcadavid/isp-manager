<script>
  import { onMount } from 'svelte';
  import { dashboardApi } from '$lib/api/dashboard.api.js';
  import {
    Users, CheckCircle2, FileText, AlertCircle,
    Router, Package, RefreshCw, BarChart3, Wallet, Calendar,
    TrendingUp, Wifi, Radio, Server, Boxes, Wrench, AlarmClock
  } from 'lucide-svelte';

  const fmtCop = (c) => '$' + Math.round((c || 0) / 100).toLocaleString('es-CO');

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
    <h1 class="page-title">
      Dashboard
    </h1>
    <p class="page-subtitle">
      Resumen de actividad — internet-online
    </p>
  </div>
  <div class="flex items-center gap-2">
    <button on:click={load} disabled={loading}
            class="inline-flex items-center gap-1.5 min-h-[44px] sm:h-9 px-3 sm:px-3.5 rounded-lg
                   bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50
                   active:scale-95 text-[15px] sm:text-sm text-slate-700 transition
                   disabled:opacity-50">
      <RefreshCw size={16} class="sm:w-3.5 sm:h-3.5 {loading ? 'animate-spin' : ''}" />
      <span class="hidden xs:inline">Actualizar</span>
    </button>
    <span class="hidden sm:inline-flex items-center gap-1.5 sm:h-9 px-3 rounded-lg
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
<div class="flex sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-4 mb-4 sm:mb-6
            overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 pb-2 sm:pb-0
            scrollbar-thin">

  <div class="kpi-tile shrink-0 min-w-[150px] sm:min-w-0">
    <div class="icon-square-blue"><Users size={16} class="sm:w-3.5 sm:h-3.5" /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Clientes</div>
      <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.totalClients)}</div>
      <div class="kpi-sub">Total registrados</div>
    </div>
  </div>

  <div class="kpi-tile shrink-0 min-w-[150px] sm:min-w-0">
    <div class="icon-square-green"><CheckCircle2 size={16} class="sm:w-3.5 sm:h-3.5" /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Activos</div>
      <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.activeClients)}</div>
      <div class="kpi-sub">Servicios prestando</div>
    </div>
  </div>

  <!-- Financial KPIs: only when the API sends them (hidden for TECHNICIAN) -->
  {#if stats?.financials !== false}
    <div class="kpi-tile shrink-0 min-w-[150px] sm:min-w-0">
      <div class="icon-square-amber"><FileText size={16} class="sm:w-3.5 sm:h-3.5" /></div>
      <div class="kpi-tile-text">
        <div class="kpi-label">Facturas</div>
        <div class="kpi-value">{loading ? '–' : fmtNum(stats?.kpis.pendingInvoices)}</div>
        <div class="kpi-sub">Pendientes de cobro</div>
      </div>
    </div>

    <div class="kpi-tile shrink-0 min-w-[150px] sm:min-w-0">
      <div class="icon-square-rose"><Wallet size={16} class="sm:w-3.5 sm:h-3.5" /></div>
      <div class="kpi-tile-text">
        <div class="kpi-label">Cobranza</div>
        <div class="kpi-value">{loading ? '–' : fmtMoney(stats?.kpis.pendingAmount)}</div>
        <div class="kpi-sub">Por recaudar</div>
      </div>
    </div>
  {/if}

  <div class="kpi-tile shrink-0 min-w-[150px] sm:min-w-0">
    <div class="icon-square-cyan"><Router size={16} class="sm:w-3.5 sm:h-3.5" /></div>
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
  <div class="card p-3 sm:p-4">
    <div class="flex items-center gap-3 mb-3 sm:mb-4">
      <div class="icon-square-green"><Users size={16} class="sm:w-3.5 sm:h-3.5" /></div>
      <div>
        <h3 class="text-sm sm:text-[13px] font-semibold text-slate-900">Clientes por Estado</h3>
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
  <div class="card p-3 sm:p-4">
    <div class="flex items-center gap-3 mb-3 sm:mb-4">
      <div class="icon-square-purple"><Package size={16} class="sm:w-3.5 sm:h-3.5" /></div>
      <div>
        <h3 class="text-sm sm:text-[13px] font-semibold text-slate-900">Clientes por Plan</h3>
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

  <!-- Facturas por Estado: only when the API sends financials (hidden for TECHNICIAN) -->
  {#if stats?.financials !== false}
  <div class="card p-3 sm:p-4">
    <div class="flex items-center gap-3 mb-3 sm:mb-4">
      <div class="icon-square-amber"><BarChart3 size={16} class="sm:w-3.5 sm:h-3.5" /></div>
      <div>
        <h3 class="text-sm sm:text-[13px] font-semibold text-slate-900">Facturas por Estado</h3>
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
  {/if}
</div>

<!-- ══════════ FINANZAS (solo admin/operador) ══════════ -->
{#if stats?.financials !== false}
  <!-- MRR + recaudo del mes + tasa de cobro -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 sm:mb-6">
    <div class="card p-4">
      <div class="flex items-center gap-2.5 mb-2">
        <div class="icon-square-green"><TrendingUp size={15} /></div>
        <h3 class="text-[13px] font-semibold text-slate-900">Ingreso recurrente (MRR)</h3>
      </div>
      <div class="text-2xl font-bold text-slate-900 tabular-nums">{loading ? '–' : fmtMoney(stats?.finance?.mrr)}</div>
      <p class="text-xs text-slate-500 mt-0.5">Esperado/mes de clientes activos de pago</p>
    </div>
    <div class="card p-4">
      <div class="flex items-center gap-2.5 mb-2">
        <div class="icon-square-blue"><Wallet size={15} /></div>
        <h3 class="text-[13px] font-semibold text-slate-900">Recaudo del mes</h3>
      </div>
      <div class="text-2xl font-bold text-slate-900 tabular-nums">{loading ? '–' : fmtMoney(stats?.kpis?.paidThisMonth)}</div>
      {#if stats?.finance?.collectionRate !== null && stats?.finance?.collectionRate !== undefined}
        <div class="mt-2">
          <div class="flex justify-between text-[11px] text-slate-500 mb-1">
            <span>Tasa de recaudo</span><span class="font-semibold {stats.finance.collectionRate >= 80 ? 'text-emerald-600' : stats.finance.collectionRate >= 50 ? 'text-amber-600' : 'text-red-600'}">{stats.finance.collectionRate}%</span>
          </div>
          <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full rounded-full {stats.finance.collectionRate >= 80 ? 'bg-emerald-500' : stats.finance.collectionRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}" style="width:{Math.min(stats.finance.collectionRate,100)}%"></div>
          </div>
        </div>
      {/if}
    </div>
    <div class="card p-4">
      <div class="flex items-center gap-2.5 mb-2">
        <div class="icon-square-rose"><AlertCircle size={15} /></div>
        <h3 class="text-[13px] font-semibold text-slate-900">Cartera vencida</h3>
      </div>
      <div class="text-2xl font-bold text-red-600 tabular-nums">{loading ? '–' : fmtMoney(stats?.finance?.overdueTotal)}</div>
      <p class="text-xs text-slate-500 mt-0.5">Total en mora (facturas vencidas)</p>
    </div>
  </div>

  <!-- Aging de cartera + Top deudores -->
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 sm:mb-6">
    <div class="card p-4">
      <h3 class="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2"><AlarmClock size={15} class="text-amber-500" /> Antigüedad de la mora</h3>
      {#if stats?.finance?.aging}
        {@const ag = stats.finance.aging}
        {@const buckets = [['1–30 días', ag.d0_30, 'bg-amber-400'], ['31–60 días', ag.d31_60, 'bg-orange-500'], ['61–90 días', ag.d61_90, 'bg-red-500'], ['+90 días', ag.d90, 'bg-red-700']]}
        <div class="space-y-2">
          {#each buckets as [label, b, color]}
            <div class="flex items-center justify-between text-xs">
              <span class="inline-flex items-center gap-2"><span class="w-2 h-2 rounded-full {color}"></span>{label}</span>
              <span class="tabular-nums"><span class="text-slate-400">{b.count} fact ·</span> <span class="font-semibold text-slate-900">{fmtMoney(b.amount)}</span></span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <div class="card p-4">
      <h3 class="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2"><Users size={15} class="text-red-500" /> Top deudores</h3>
      {#if stats?.finance?.topDebtors?.length}
        <ul class="divide-y divide-slate-100">
          {#each stats.finance.topDebtors as d, i}
            <li class="flex items-center justify-between py-1.5">
              <a href="/clients/{d.id}" class="text-xs text-slate-700 hover:text-brand-700 inline-flex items-center gap-2 min-w-0">
                <span class="text-slate-400 w-4">{i + 1}.</span>
                <span class="truncate font-medium">{d.name}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded {d.technology === 'WIRELESS' ? 'bg-cyan-50 text-cyan-700' : 'bg-blue-50 text-blue-700'}">{d.technology === 'WIRELESS' ? 'Inalámbrico' : 'Fibra'}</span>
              </a>
              <span class="text-xs font-semibold text-red-600 tabular-nums">{fmtMoney(d.debt)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-xs text-slate-400 py-4 text-center">Sin deudores 🎉</p>
      {/if}
    </div>
  </div>
{/if}

<!-- ══════════ OPERACIÓN / RED (todos los roles) ══════════ -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 sm:mb-6">
  <!-- Estado de routers -->
  <div class="card p-4">
    <h3 class="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2"><Server size={15} class="text-cyan-600" /> Estado de routers</h3>
    {#if stats?.routersHealth?.length}
      <ul class="space-y-2">
        {#each stats.routersHealth as r}
          {@const ok = r.status === 'ONLINE'}
          {@const warn = r.status === 'DEGRADED'}
          <li class="flex items-center justify-between text-xs">
            <span class="inline-flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full {ok ? 'bg-emerald-500' : warn ? 'bg-amber-500' : r.status === 'OFFLINE' ? 'bg-red-500' : 'bg-slate-300'}"></span>
              <span class="truncate font-medium text-slate-800">{r.name}</span>
            </span>
            <span class="text-slate-400 tabular-nums">{r.accounts} cuentas · <span class="{ok ? 'text-emerald-600' : warn ? 'text-amber-600' : 'text-red-600'}">{r.status}</span></span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-xs text-slate-400 py-2">Sin routers.</p>
    {/if}
  </div>

  <!-- Clientes por tecnología -->
  <div class="card p-4">
    <h3 class="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2"><Radio size={15} class="text-violet-600" /> Por tecnología</h3>
    {#if stats?.byTechnology?.length}
      {@const total = stats.byTechnology.reduce((s, t) => s + t.count, 0)}
      <div class="space-y-3">
        {#each stats.byTechnology as t}
          {@const pct = total ? Math.round((t.count / total) * 100) : 0}
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="inline-flex items-center gap-1.5 font-medium text-slate-700">
                {#if t.technology === 'WIRELESS'}<Radio size={12} class="text-cyan-600" /> Inalámbrico{:else}<Wifi size={12} class="text-blue-600" /> Fibra óptica{/if}
              </span>
              <span class="tabular-nums text-slate-500">{t.count} · {pct}%</span>
            </div>
            <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div class="h-full rounded-full {t.technology === 'WIRELESS' ? 'bg-cyan-500' : 'bg-blue-500'}" style="width:{pct}%"></div></div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Tareas de campo / operación -->
  <div class="card p-4">
    <h3 class="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2"><Wrench size={15} class="text-slate-600" /> Operación</h3>
    <ul class="space-y-2.5 text-xs">
      <li class="flex items-center justify-between"><span class="text-slate-600 inline-flex items-center gap-1.5"><AlertCircle size={13} class="text-amber-500" /> Suspendidos</span><span class="font-semibold tabular-nums">{stats?.kpis?.suspendedClients ?? 0}</span></li>
      <li class="flex items-center justify-between"><span class="text-slate-600 inline-flex items-center gap-1.5"><Wrench size={13} class="text-blue-500" /> Instalaciones pendientes</span><span class="font-semibold tabular-nums">{stats?.kpis?.pendingInstalls ?? 0}</span></li>
      <li class="flex items-center justify-between"><span class="text-slate-600 inline-flex items-center gap-1.5"><Server size={13} class="text-red-500" /> Routers con problema</span><span class="font-semibold tabular-nums {(stats?.kpis?.routersDown ?? 0) > 0 ? 'text-red-600' : ''}">{stats?.kpis?.routersDown ?? 0}</span></li>
      {#if stats?.inventory}
        <li class="flex items-center justify-between"><span class="text-slate-600 inline-flex items-center gap-1.5"><Boxes size={13} class="text-emerald-500" /> Equipos en bodega</span><span class="font-semibold tabular-nums">{stats.inventory.IN_STOCK ?? 0}</span></li>
      {/if}
    </ul>
  </div>
</div>
