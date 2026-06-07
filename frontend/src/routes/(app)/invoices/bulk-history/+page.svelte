<script>
  import { onMount } from 'svelte';
  // We use getRaw because the response carries both `data` and `meta`
  // (cursor + hasMore). The regular `api.get` unwraps `data` and drops
  // `meta`, which we need for the "Cargar más" button.
  import { getRaw } from '$lib/api/client.js';
  import {
    ArrowLeft, Loader2, Zap, ChevronDown, ChevronRight,
    CheckCircle2, AlertCircle, Wallet, Wifi, PauseCircle, RefreshCw
  } from 'lucide-svelte';

  let loading = true;
  let rows    = [];
  let meta    = { hasMore: false, nextCursor: null };
  let error   = '';
  let expandedId = null;       // id of the row whose results table is open

  async function load(reset = true) {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams({ limit: '25', type: 'BULK_PLAN_CHANGE' });
      if (!reset && meta.nextCursor) params.set('cursor', meta.nextCursor);
      const env = await getRaw(`/clients/bulk-history?${params}`);
      const incoming = env?.data ?? [];
      rows = reset ? incoming : [...rows, ...incoming];
      meta = env?.meta ?? { hasMore: false, nextCursor: null };
    } catch (e) {
      error = e.message || 'No se pudo cargar el historial';
    } finally {
      loading = false;
    }
  }

  onMount(() => load(true));

  function fmtDateTime(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  function toggle(id) {
    expandedId = expandedId === id ? null : id;
  }

  // Tiny per-row helpers to surface key payload fields without verbose code.
  function planIdOf(row) { return row?.payload?.planId || '—'; }
  function flags(row) {
    const p = row?.payload || {};
    const out = [];
    if (p.syncMikrotik === false) out.push('sin sync');
    if (p.resetMonthlyFee)        out.push('reset fee');
    if (p.includeSuspended)       out.push('incl. suspendidos');
    return out;
  }
  function statusBadge(status) {
    switch (status) {
      case 'ok':      return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'OK' };
      case 'noop':    return { cls: 'bg-slate-100 text-slate-600 border-slate-200',     label: 'noop' };
      case 'skipped': return { cls: 'bg-amber-50 text-amber-700 border-amber-200',      label: 'skipped' };
      case 'failed':  return { cls: 'bg-red-50 text-red-700 border-red-200',            label: 'failed' };
      default:        return { cls: 'bg-slate-100 text-slate-600 border-slate-200',     label: status || '—' };
    }
  }
</script>

<svelte:head><title>Historial de cambios masivos — ISP Manager</title></svelte:head>

<!-- Header -->
<div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
      <Zap size={20} class="text-brand-600" />
      Historial de cambios masivos
    </h1>
    <p class="text-sm text-text-muted mt-0.5">
      Auditoría de asignaciones de plan masivas. Más recientes primero.
    </p>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary" on:click={() => load(true)} disabled={loading}>
      {#if loading}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
      Recargar
    </button>
    <a href="/invoices" class="btn-secondary">
      <ArrowLeft size={14} /> Volver a Facturas
    </a>
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
    <AlertCircle size={14} /> {error}
  </div>
{/if}

<div class="card">
  {#if loading && rows.length === 0}
    <div class="p-10 flex items-center justify-center gap-2 text-text-secondary">
      <Loader2 size={18} class="animate-spin" />
      Cargando historial…
    </div>
  {:else if rows.length === 0}
    <div class="p-12 text-center">
      <div class="w-14 h-14 rounded-2xl bg-slate-100 mx-auto mb-3 flex items-center justify-center">
        <Zap size={24} class="text-slate-400" />
      </div>
      <p class="text-sm font-semibold text-text-primary">Aún no hay cambios masivos</p>
      <p class="text-xs text-text-muted mt-1">
        Cuando uses el botón "Cambiar plan…" desde la lista de clientes, cada operación quedará registrada aquí.
      </p>
      <a href="/invoices" class="btn-secondary inline-flex mt-4">
        <ArrowLeft size={14} /> Ir a Facturas
      </a>
    </div>
  {:else}
    <div class="divide-y divide-slate-100">
      {#each rows as row (row.id)}
        {@const isOpen = expandedId === row.id}
        {@const okPct = row.totalCount > 0 ? Math.round((row.okCount / row.totalCount) * 100) : 0}
        <div>
          <!-- Row header -->
          <button type="button" on:click={() => toggle(row.id)}
                  class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors">
            {#if isOpen}<ChevronDown size={14} class="text-text-muted" />{:else}<ChevronRight size={14} class="text-text-muted" />{/if}

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-text-primary">
                  Cambio de plan a <span class="font-mono">{planIdOf(row)}</span>
                </span>
                {#each flags(row) as f}
                  <span class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">{f}</span>
                {/each}
              </div>
              <div class="text-xs text-text-muted mt-0.5">
                {fmtDateTime(row.createdAt)} · {row.operator?.name || 'sin operador'}
                {#if row.operator?.email} · <span class="font-mono">{row.operator.email}</span>{/if}
              </div>
            </div>

            <!-- Counts -->
            <div class="flex items-center gap-2 flex-shrink-0">
              <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-xs">
                <span class="text-text-muted">total</span>
                <strong class="tabular-nums">{row.totalCount}</strong>
              </span>
              <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
                <CheckCircle2 size={11} />
                <strong class="tabular-nums">{row.okCount}</strong>
              </span>
              {#if row.failedCount > 0}
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertCircle size={11} />
                  <strong class="tabular-nums">{row.failedCount}</strong>
                </span>
              {/if}
              <span class="text-[11px] text-text-muted hidden sm:inline tabular-nums">{okPct}%</span>
            </div>
          </button>

          <!-- Expanded body -->
          {#if isOpen}
            <div class="px-4 pb-4 pt-1 bg-slate-50/50 border-t border-slate-100">
              <table class="w-full text-xs">
                <thead class="text-text-secondary uppercase tracking-wider text-[10px] font-semibold">
                  <tr>
                    <th class="text-left py-1.5 pr-2">Cliente</th>
                    <th class="text-left py-1.5 px-2">Estado</th>
                    <th class="text-left py-1.5 px-2">Cambios</th>
                    <th class="text-left py-1.5 pl-2">MikroTik</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  {#each (row.results || []) as r}
                    {@const b = statusBadge(r.status)}
                    {@const mkSync = r.mikrotikSync || {}}
                    <tr>
                      <td class="py-1.5 pr-2 font-medium text-text-primary truncate max-w-[260px]" title={r.name}>{r.name || r.clientId}</td>
                      <td class="py-1.5 px-2">
                        <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium {b.cls}">{b.label}</span>
                      </td>
                      <td class="py-1.5 px-2 text-text-secondary">
                        {#if r.changes?.planId}
                          plan → <span class="font-mono">{r.changes.planId}</span>
                        {:else if r.status === 'noop'}
                          <span class="text-text-muted">sin cambios</span>
                        {:else if r.reason}
                          <span class="text-red-600">{r.reason}</span>
                        {:else}
                          <span class="text-text-muted">—</span>
                        {/if}
                      </td>
                      <td class="py-1.5 pl-2">
                        {#if mkSync.status === 'ok'}
                          <span class="inline-flex items-center gap-1 text-emerald-700"><Wifi size={11} /> sync ok</span>
                        {:else if mkSync.status === 'skipped'}
                          <span class="text-text-muted">skipped · {mkSync.reason}</span>
                        {:else if mkSync.status === 'failed'}
                          <span class="inline-flex items-center gap-1 text-red-600"><AlertCircle size={11} /> {mkSync.reason || 'failed'}</span>
                        {:else}
                          <span class="text-text-muted">—</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if meta.hasMore}
      <div class="p-3 text-center border-t border-slate-100">
        <button class="btn-secondary" on:click={() => load(false)} disabled={loading}>
          {#if loading}<Loader2 size={14} class="animate-spin" />{/if}
          Cargar más
        </button>
      </div>
    {/if}
  {/if}
</div>
