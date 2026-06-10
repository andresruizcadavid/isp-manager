<script>
  import { onMount } from 'svelte';
  import { CreditCard, Loader2, AlertCircle, CheckCircle2, XCircle } from 'lucide-svelte';
  import { portalApi } from '$lib/api/portal.api.js';

  let payments = [];
  let loading = true;
  let error = '';

  onMount(async () => { try { payments = await portalApi.getPayments(); } catch (e) { error = e.message; } finally { loading = false; } });

  function fmtCOP(c) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((c||0)/100); }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : ''; }
</script>

<svelte:head><title>Historial de Pagos — Mi Portal</title></svelte:head>

<div class="mb-6"><h1 class="text-xl font-bold text-text-primary">Historial de Pagos</h1><p class="text-sm text-text-secondary">Todos tus pagos registrados</p></div>

{#if loading}<div class="flex items-center justify-center py-20"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}<div class="card p-8 text-center"><AlertCircle size={24} class="mx-auto mb-3 text-red-500" /><p class="text-text-secondary">{error}</p></div>
{:else if payments.length === 0}<div class="card p-8 text-center"><CreditCard size={32} class="mx-auto mb-3 text-text-muted" /><p class="text-text-secondary">No hay pagos registrados.</p></div>
{:else}
  <div class="card p-0 divide-y divide-slate-100">
    {#each payments as p}
      <div class="flex items-center justify-between px-5 py-4">
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-full {p.status === 'COMPLETED' ? 'bg-emerald-100' : 'bg-red-100'} flex items-center justify-center flex-shrink-0 mt-0.5">
            {#if p.status === 'COMPLETED'}<CheckCircle2 size={16} class="text-emerald-600" />{:else}<XCircle size={16} class="text-red-500" />{/if}
          </div>
          <div>
            <p class="text-sm font-medium text-text-primary">{fmtCOP(p.amount)}</p>
            <p class="text-xs text-text-muted">{p.method}{#if p.invoice} · {p.invoice.invoiceNumber}{/if}</p>
          </div>
        </div>
        <div class="text-right">
          <span class="text-xs font-medium px-1.5 py-0.5 rounded {p.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">{p.status === 'COMPLETED' ? 'Pagado' : p.status}</span>
          <p class="text-[10px] text-text-muted mt-1">{fmtDate(p.createdAt)}</p>
        </div>
      </div>
    {/each}
  </div>
{/if}
