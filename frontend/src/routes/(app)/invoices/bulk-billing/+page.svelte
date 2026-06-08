<script>
  // Finanzas-driven mass billing — pick a year/month, get all eligible
  // clients (ACTIVE + has plan), exclude per-row, fire POST /clients/bulk-bill.
  //
  // Complements the "Cobro masivo" modal in /clients which is selection-
  // driven from the client list. This page is month-driven — typical
  // monthly close: "all active customers × Junio 2026".

  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { clientsApi } from '$lib/api/clients.api.js';
  import {
    ArrowLeft, ChevronLeft, ChevronRight, Loader2, Receipt, CheckCircle2,
    AlertCircle, Search, RefreshCw, AlertTriangle
  } from 'lucide-svelte';

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let loading = false;
  let submitting = false;
  let clients = [];          // { id, name, planName, monthlyFee, hasInvoiceForPeriod }
  let excluded = new Set();
  let resultData = null;
  let error = '';
  let q = '';

  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function fmtCop(c) {
    if (c == null) return '—';
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits: 0 }).format((c || 0) / 100);
  }

  async function loadEligible() {
    loading = true; error = ''; resultData = null;
    try {
      // Fetch up to 500 active clients with a plan. The bulk-bill endpoint
      // accepts up to 500 client IDs in one call so we align caps here.
      const res = await clientsApi.getPage({ status: 'ACTIVE', page: 1, limit: 500 });
      const all = res?.data || [];
      // Each client row already includes `pendingInvoices` for unpaid months,
      // but we need to know whether THIS year+month already has an invoice
      // regardless of status. Take a defensive read: if ANY pendingInvoices
      // matches (year, month), mark it; otherwise we don't know about PAID
      // invoices for that period — the backend will return them as 'reused'.
      clients = all
        // Free-plan clients (trueque) never get billed — exclude entirely.
        .filter(c => !c.plan?.isFree)
        .filter(c => c.planId || c.monthlyFee > 0)
        .map(c => {
          const eff = (c.monthlyFee && c.monthlyFee > 0) ? c.monthlyFee : (c.plan?.monthlyPrice || c.plan?.price || 0);
          const matches = (c.pendingInvoices || []).find(i => i.periodYear === year && i.periodMonth === month);
          return {
            id: c.id,
            name: c.name,
            planName: c.plan?.name || '—',
            monthlyFee: eff,
            hasPendingForPeriod: !!matches
          };
        });
      excluded = new Set();
    } catch (e) {
      error = e.message || 'No se pudieron cargar los clientes';
    } finally {
      loading = false;
    }
  }
  onMount(loadEligible);

  $: filtered = q.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    : clients;

  $: selectedCount = clients.length - excluded.size;
  $: estimatedTotal = clients.reduce((s, c) => excluded.has(c.id) ? s : s + (c.monthlyFee || 0), 0);
  $: clientsWithoutFee = clients.filter(c => !c.monthlyFee || c.monthlyFee <= 0).length;

  function toggle(id) {
    if (excluded.has(id)) excluded.delete(id);
    else                  excluded.add(id);
    excluded = new Set(excluded);
  }
  function excludeAll()  { excluded = new Set(clients.map(c => c.id)); }
  function includeAll()  { excluded = new Set(); }
  function shiftMonth(d) {
    let m = month + d, y = year;
    if (m < 1)  { m = 12; y -= 1; }
    if (m > 12) { m = 1;  y += 1; }
    month = m; year = y;
    loadEligible();
  }

  async function submit() {
    if (selectedCount === 0) return;
    submitting = true;
    error = '';
    try {
      const clientIds = clients.filter(c => !excluded.has(c.id)).map(c => c.id);
      resultData = await api.post('/clients/bulk-bill', {
        clientIds,
        months: [{ year, month }]
      });
    } catch (e) {
      error = e.message || 'No se pudo generar';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>Cobro masivo — ISP Manager</title></svelte:head>

<div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
      <Receipt size={20} class="text-brand-600" />
      Cobro masivo por mes
    </h1>
    <p class="text-sm text-text-muted mt-0.5">
      Genera (o reutiliza) facturas para todos los clientes activos del mes seleccionado.
    </p>
  </div>
  <div class="flex items-center gap-2">
    <a href="/invoices/bulk-history" class="btn-secondary">Historial</a>
    <a href="/invoices" class="btn-secondary">
      <ArrowLeft size={14} /> Facturas
    </a>
  </div>
</div>

<!-- Month / year selector -->
<div class="card mb-4">
  <div class="card-body flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-2">
      <button class="btn-ghost" on:click={() => shiftMonth(-1)} disabled={loading}>
        <ChevronLeft size={14} />
      </button>
      <div class="text-lg font-bold text-text-primary tabular-nums min-w-[180px] text-center">
        {MONTH_NAMES[month - 1]} {year}
      </div>
      <button class="btn-ghost" on:click={() => shiftMonth(1)} disabled={loading}>
        <ChevronRight size={14} />
      </button>
    </div>
    <button class="btn-secondary" on:click={loadEligible} disabled={loading}>
      {#if loading}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
      Recargar
    </button>
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
    <AlertCircle size={14} /> {error}
  </div>
{/if}

{#if clientsWithoutFee > 0}
  <div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-2 text-sm">
    <AlertTriangle size={14} class="text-amber-600 flex-shrink-0 mt-0.5" />
    <div class="text-amber-900">
      Hay <strong>{clientsWithoutFee}</strong> cliente(s) en el listado sin tarifa configurada
      (sin <code class="font-mono text-xs">monthlyFee</code> ni <code class="font-mono text-xs">plan.monthlyPrice</code>).
      Sus facturas fallarán con <em>NO_MONTHLY_FEE</em>; ajusta el plan o la tarifa antes de continuar.
    </div>
  </div>
{/if}

{#if resultData}
  <!-- Result panel -->
  <div class="card mb-4">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <CheckCircle2 size={16} class="text-emerald-600" />
        <h2 class="font-semibold text-text-primary text-base">Resultado</h2>
      </div>
    </div>
    <div class="card-body">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div class="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Creadas</div>
          <div class="text-base font-bold text-emerald-700 tabular-nums">{resultData.summary.invoicesCreated || 0}</div>
        </div>
        <div class="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">Reutilizadas</div>
          <div class="text-base font-bold text-slate-700 tabular-nums">{resultData.summary.invoicesReused || 0}</div>
        </div>
        <div class="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-violet-700 font-semibold">Ya pagadas</div>
          <div class="text-base font-bold text-violet-700 tabular-nums">{resultData.summary.paidSkipped || 0}</div>
        </div>
        <div class="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <div class="text-[10px] uppercase tracking-wider text-red-700 font-semibold">Fallidas</div>
          <div class="text-base font-bold text-red-700 tabular-nums">{resultData.summary.failed || 0}</div>
        </div>
      </div>
      <div class="text-sm text-text-secondary">
        Total facturado: <strong class="font-mono tabular-nums">{fmtCop(resultData.summary.totalAmount)}</strong>
      </div>
      {#if (resultData.summary.failed || 0) > 0}
        <div class="mt-3 border border-red-200 rounded-lg max-h-[200px] overflow-y-auto">
          <div class="px-3 py-2 bg-red-50 text-xs font-semibold text-red-900">Clientes con error</div>
          <div class="divide-y divide-red-100 text-xs">
            {#each resultData.results.filter(r => r.status === 'failed') as r}
              <div class="px-3 py-1.5">
                <div class="font-medium text-text-primary">{r.clientName || r.clientId}</div>
                <div class="text-text-muted">{r.reason}</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
      <div class="mt-3 flex items-center gap-2">
        <button class="btn-secondary" on:click={() => { resultData = null; loadEligible(); }}>Cerrar resultado</button>
        <a href="/invoices/bulk-history" class="text-xs text-brand-700 hover:underline ml-2">Ver historial completo →</a>
      </div>
    </div>
  </div>
{/if}

<!-- Selection summary -->
<div class="card mb-4">
  <div class="card-body flex items-center gap-3 flex-wrap">
    <div class="flex-1 min-w-0">
      <div class="text-xs uppercase tracking-wider text-text-muted font-semibold">Selección actual</div>
      <div class="text-2xl font-bold text-text-primary tabular-nums">{selectedCount}<span class="text-base font-normal text-text-muted"> / {clients.length} clientes</span></div>
    </div>
    <div>
      <div class="text-xs uppercase tracking-wider text-text-muted font-semibold">Total estimado</div>
      <div class="text-2xl font-bold text-brand-700 tabular-nums">{fmtCop(estimatedTotal)}</div>
    </div>
    <div class="flex items-center gap-2 ml-auto">
      <button class="btn-secondary" on:click={includeAll} disabled={loading || excluded.size === 0}>Incluir todos</button>
      <button class="btn-secondary" on:click={excludeAll} disabled={loading || excluded.size === clients.length}>Excluir todos</button>
      <button class="btn-primary" on:click={submit} disabled={submitting || selectedCount === 0 || loading}>
        {#if submitting}<Loader2 size={14} class="animate-spin" />{:else}<Receipt size={14} />{/if}
        Generar facturas
      </button>
    </div>
  </div>
</div>

<!-- Eligible clients table -->
<div class="card">
  <div class="card-header">
    <div class="flex items-center justify-between gap-2 w-full">
      <h2 class="font-semibold text-text-primary text-sm">Clientes elegibles ({clients.length})</h2>
      <div class="relative">
        <Search size={12} class="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" bind:value={q} placeholder="Buscar…"
               class="text-xs rounded-md border border-slate-200 bg-white pl-7 pr-2 py-1 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20" />
      </div>
    </div>
  </div>
  {#if loading}
    <div class="p-10 flex items-center justify-center gap-2 text-text-secondary">
      <Loader2 size={18} class="animate-spin" /> Cargando…
    </div>
  {:else if filtered.length === 0}
    <div class="p-10 text-center text-sm text-text-muted">
      {q ? 'Ningún cliente coincide con la búsqueda.' : 'No hay clientes activos con tarifa configurada.'}
    </div>
  {:else}
    <div class="max-h-[600px] overflow-y-auto">
      <table class="w-full text-xs">
        <thead class="bg-slate-50 text-text-secondary uppercase tracking-wider text-[10px] font-semibold sticky top-0">
          <tr>
            <th class="px-3 py-2 w-10"></th>
            <th class="text-left px-2 py-2">Cliente</th>
            <th class="text-left px-2 py-2">Plan</th>
            <th class="text-right px-2 py-2">Mensualidad</th>
            <th class="text-center px-2 py-2">Notas</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each filtered as c}
            {@const off = excluded.has(c.id)}
            <tr class={off ? 'opacity-40' : ''}>
              <td class="px-3 py-1.5 text-center">
                <input type="checkbox" checked={!off}
                       on:change={() => toggle(c.id)}
                       class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
              </td>
              <td class="px-2 py-1.5 font-medium text-text-primary truncate max-w-[260px]" title={c.name}>{c.name}</td>
              <td class="px-2 py-1.5 text-text-secondary">{c.planName}</td>
              <td class="px-2 py-1.5 text-right tabular-nums font-mono {c.monthlyFee > 0 ? 'text-text-primary' : 'text-red-600'}">
                {fmtCop(c.monthlyFee)}
              </td>
              <td class="px-2 py-1.5 text-center">
                {#if c.hasPendingForPeriod}
                  <span class="inline-block px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-medium">
                    ya tiene factura
                  </span>
                {:else if !c.monthlyFee}
                  <span class="inline-block px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[10px] font-medium">
                    sin tarifa
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
