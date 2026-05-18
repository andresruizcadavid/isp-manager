<script>
  import { onMount } from 'svelte';
  import { reportsApi } from '$lib/api/reports.api.js';
  import {
    BarChart2, TrendingUp, Users, DollarSign, FileText,
    Calendar, Download, AlertCircle, Loader2
  } from 'lucide-svelte';

  let loading = true;
  let error = '';
  let activeTab = 'dashboard';
  
  let dateFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  let dateTo = new Date().toISOString().split('T')[0];
  let groupBy = 'month';

  let dashboard = null;
  let revenue = null;
  let clients = null;
  let invoices = null;

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { id: 'revenue', label: 'Ingresos', icon: DollarSign },
    { id: 'clients', label: 'Clientes', icon: Users },
    { id: 'invoices', label: 'Facturas', icon: FileText },
  ];

  async function loadDashboard() {
    try { dashboard = await reportsApi.dashboard(); } catch (e) { console.error(e); }
  }
  async function loadRevenue() {
    try { revenue = await reportsApi.revenue({ dateFrom, dateTo, groupBy }); } catch (e) { console.error(e); }
  }
  async function loadClients() {
    try { clients = await reportsApi.clientsOverview({ dateFrom, dateTo, groupBy }); } catch (e) { console.error(e); }
  }
  async function loadInvoices() {
    try { invoices = await reportsApi.invoicesSummary({ dateFrom, dateTo, groupBy }); } catch (e) { console.error(e); }
  }

  async function load() {
    loading = true; error = '';
    try {
      await Promise.all([loadDashboard(), loadRevenue(), loadClients(), loadInvoices()]);
    } catch (e) {
      error = e.message || 'Error al cargar reportes';
    } finally { loading = false; }
  }
  onMount(load);

  function fmtMoney(cents) {
    if (cents == null || cents === undefined) return '—';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  }
  function fmtNumber(n) {
    if (n == null || n === undefined) return '—';
    return new Intl.NumberFormat('es-CO').format(n);
  }
</script>

<svelte:head><title>Reportes — ISP Manager</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Reportes</h1>
    <p class="page-subtitle">Estadísticas y análisis del sistema</p>
  </div>
  <div class="flex items-center gap-2">
    <div class="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1">
      <Calendar size={14} class="text-slate-400" />
      <input type="date" bind:value={dateFrom} class="text-xs border-none outline-none bg-transparent" />
      <span class="text-slate-400">-</span>
      <input type="date" bind:value={dateTo} class="text-xs border-none outline-none bg-transparent" />
    </div>
    <button class="btn-secondary text-xs" on:click={load}>
      <Loader2 size={14} />
      Actualizar
    </button>
  </div>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

<div class="card mb-4">
  <div class="flex items-center gap-1 overflow-x-auto">
    {#each tabs as tab}
      <button
        class="px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap
               {activeTab === tab.id
                 ? 'bg-brand-600 text-white'
                 : 'text-slate-600 hover:bg-slate-100'}"
        on:click={() => activeTab = tab.id}
      >
        <svelte:component this={tab.icon} size={14} class="inline mr-1.5" />
        {tab.label}
      </button>
    {/each}
  </div>
</div>

{#if loading}
  <div class="card py-20 text-center">
    <div class="flex items-center justify-center gap-2">
      <div class="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
      <span class="text-slate-500">Cargando reportes...</span>
    </div>
  </div>
{:else}
  {#if activeTab === 'dashboard' && dashboard}
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="kpi-tile">
        <div><div class="kpi-label">Clientes Activos</div><div class="kpi-value">{fmtNumber(dashboard.clients?.active)}</div></div>
        <div class="icon-square-blue"><Users size={18} /></div>
      </div>
      <div class="kpi-tile">
        <div><div class="kpi-label">Facturas Pendientes</div><div class="kpi-value">{fmtNumber(dashboard.invoices?.pending)}</div></div>
        <div class="icon-square-amber"><FileText size={18} /></div>
      </div>
      <div class="kpi-tile">
        <div><div class="kpi-label">Ingresos Mes</div><div class="kpi-value">{fmtMoney(dashboard.revenue?.month)}</div></div>
        <div class="icon-square-green"><DollarSign size={18} /></div>
      </div>
      <div class="kpi-tile">
        <div><div class="kpi-label">Crecimiento</div><div class="kpi-value">{dashboard.clients?.growth || 0}%</div></div>
        <div class="icon-square-rose"><TrendingUp size={18} /></div>
      </div>
    </div>
  {/if}

  {#if activeTab === 'revenue' && revenue}
    <div class="card">
      <h3 class="text-lg font-semibold text-slate-800 mb-4">Reporte de Ingresos</h3>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>Período</th><th class="text-right">Ingresos</th><th class="text-right">Facturas</th></tr></thead>
          <tbody>
            {#each revenue.data || [] as r}
              <tr>
                <td class="font-medium text-slate-700">{r.period}</td>
                <td class="text-right font-mono text-sm">{fmtMoney(r.revenue)}</td>
                <td class="text-right">{fmtNumber(r.invoices)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if activeTab === 'clients' && clients}
    <div class="card">
      <h3 class="text-lg font-semibold text-slate-800 mb-4">Reporte de Clientes</h3>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="p-4 bg-slate-50 rounded-lg">
          <div class="text-xs text-slate-500">Total Clientes</div>
          <div class="text-2xl font-bold text-slate-800">{fmtNumber(clients.total)}</div>
        </div>
        <div class="p-4 bg-green-50 rounded-lg">
          <div class="text-xs text-green-600">Activos</div>
          <div class="text-2xl font-bold text-green-700">{fmtNumber(clients.active)}</div>
        </div>
        <div class="p-4 bg-amber-50 rounded-lg">
          <div class="text-xs text-amber-600">Suspendidos</div>
          <div class="text-2xl font-bold text-amber-700">{fmtNumber(clients.suspended)}</div>
        </div>
        <div class="p-4 bg-slate-50 rounded-lg">
          <div class="text-xs text-slate-500">Nuevos (período)</div>
          <div class="text-2xl font-bold text-slate-800">{fmtNumber(clients.new)}</div>
        </div>
      </div>
    </div>
  {/if}

  {#if activeTab === 'invoices' && invoices}
    <div class="card">
      <h3 class="text-lg font-semibold text-slate-800 mb-4">Resumen de Facturas</h3>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="p-4 bg-slate-50 rounded-lg">
          <div class="text-xs text-slate-500">Total Emitidas</div>
          <div class="text-2xl font-bold text-slate-800">{fmtNumber(invoices.total)}</div>
        </div>
        <div class="p-4 bg-green-50 rounded-lg">
          <div class="text-xs text-green-600">Pagadas</div>
          <div class="text-2xl font-bold text-green-700">{fmtNumber(invoices.paid)}</div>
        </div>
        <div class="p-4 bg-amber-50 rounded-lg">
          <div class="text-xs text-amber-600">Pendientes</div>
          <div class="text-2xl font-bold text-amber-700">{fmtNumber(invoices.pending)}</div>
        </div>
        <div class="p-4 bg-red-50 rounded-lg">
          <div class="text-xs text-red-600">Vencidas</div>
          <div class="text-2xl font-bold text-red-700">{fmtNumber(invoices.overdue)}</div>
        </div>
      </div>
    </div>
  {/if}
{/if}