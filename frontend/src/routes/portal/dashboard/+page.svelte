<script>
  import { onMount } from 'svelte';
  import { CreditCard, FileText, Wifi, Loader2, AlertCircle, ArrowRight, Calendar } from 'lucide-svelte';
  import { portalApi } from '$lib/api/portal.api.js';

  let data = null;
  let loading = true;
  let error = '';

  onMount(async () => {
    try { data = await portalApi.getDashboard(); }
    catch (/** @type {any} */ e) { error = e.message; }
    finally { loading = false; }
  });

  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((c||0)/100); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : ''; }

  const badge = { PAID:'bg-emerald-100 text-emerald-700', PENDING:'bg-amber-100 text-amber-700', OVERDUE:'bg-red-100 text-red-700', PARTIAL:'bg-blue-100 text-blue-700' };
</script>

<svelte:head><title>Dashboard — Mi Portal</title></svelte:head>

{#if loading}<div class="flex items-center justify-center py-20"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}<div class="card p-8 text-center"><AlertCircle size={24} class="mx-auto mb-3 text-red-500" /><p class="text-text-secondary">{error}</p></div>
{:else if data}
  <div class="mb-6"><h1 class="text-xl font-bold text-text-primary">¡Hola, {data.client.name?.split(/\s+/)[0] || ''}!</h1><p class="text-sm text-text-secondary">Bienvenido a tu portal de cliente</p></div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <div class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-text-muted uppercase tracking-wider">Estado</span>
        <div class="w-8 h-8 rounded-lg bg-{data.client.status === 'ACTIVE' ? 'emerald' : 'amber'}-100 flex items-center justify-center">
          <Wifi size={16} class="text-{data.client.status === 'ACTIVE' ? 'emerald' : 'amber'}-600" />
        </div>
      </div>
      <p class="text-lg font-bold text-text-primary">{data.client.status === 'ACTIVE' ? 'Activo' : data.client.status}</p>
      {#if data.plan}<p class="text-xs text-text-muted mt-1">{data.plan.name} — {data.plan.downloadSpeed} Mbps</p>{/if}
    </div>
    <div class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-text-muted uppercase tracking-wider">Pendientes</span>
        <div class="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center"><FileText size={16} class="text-amber-600" /></div>
      </div>
      <p class="text-lg font-bold text-text-primary">{data.summary.pendingInvoices}</p>
    </div>
    <div class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-text-muted uppercase tracking-wider">Saldo Pendiente</span>
        <div class="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center"><CreditCard size={16} class="text-red-600" /></div>
      </div>
      <p class="text-lg font-bold text-text-primary">{fmtCOP(data.summary.totalDue)}</p>
    </div>
    <div class="card p-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-text-muted uppercase tracking-wider">Último Pago</span>
        <div class="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center"><Calendar size={16} class="text-emerald-600" /></div>
      </div>
      {#if data.summary.lastPayment}
        <p class="text-lg font-bold text-text-primary">{fmtCOP(data.summary.lastPayment.amount)}</p>
        <p class="text-xs text-text-muted mt-1">{fmtDate(data.summary.lastPayment.date)}</p>
      {:else}<p class="text-sm text-text-muted">Sin pagos aún</p>{/if}
    </div>
  </div>

  <div class="card">
    <div class="card-header flex items-center justify-between">
      <h2 class="font-semibold text-text-primary">Facturas Recientes</h2>
      <a href="/portal/invoices" class="text-xs text-brand-600 hover:underline flex items-center gap-1">Ver todas <ArrowRight size={12} /></a>
    </div>
    <div class="card-body p-0">
      {#if data.recentInvoices.length === 0}
        <p class="text-sm text-text-muted p-5">No hay facturas registradas.</p>
      {:else}
        <div class="divide-y divide-slate-100">
          {#each data.recentInvoices as inv}
            <a href="/portal/invoices/{inv.id}" class="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition">
              <div><p class="text-sm font-medium text-text-primary">{inv.invoiceNumber}</p><p class="text-xs text-text-muted">{fmtDate(inv.dueDate)}</p></div>
              <div class="text-right">
                <p class="text-sm font-semibold text-text-primary">{fmtCOP(inv.balanceDue > 0 ? inv.balanceDue : inv.total)}</p>
                <span class="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded {badge[inv.status] || 'bg-slate-100 text-slate-600'}">{inv.status === 'PAID' ? 'Pagada' : inv.status === 'PENDING' ? 'Pendiente' : inv.status === 'OVERDUE' ? 'Vencida' : inv.status}</span>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
