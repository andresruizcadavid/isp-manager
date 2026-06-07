<script>
  // BulkBillModal — pick months × selected clients → POST /clients/bulk-bill.
  // The backend is idempotent (UNIQUE(clientId, year, month)), so the
  // operator can re-run the same selection without worrying about duplicates.

  import { createEventDispatcher } from 'svelte';
  import {
    Loader2, CheckCircle2, AlertCircle, AlertTriangle, X,
    Receipt, ChevronLeft, ChevronRight, ArrowRight
  } from 'lucide-svelte';
  import { api } from '$lib/api/client.js';

  /** Full client objects (id, name). */
  export let clients = [];

  const dispatch = createEventDispatcher();

  // ── State ────────────────────────────────────────────────────────────
  const now = new Date();
  let year  = now.getFullYear();
  // Selected (year, month) pairs as a Set of "Y-M" strings for O(1) lookup.
  let selectedKey = new Set();
  let submitting  = false;
  let step        = 'pick';     // pick | running | done | error
  let resultData  = null;
  let errorMsg    = '';

  const MONTH_NAMES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  $: selectedMonths = [...selectedKey].map(k => {
    const [y, m] = k.split('-').map(Number);
    return { year: y, month: m };
  }).sort((a, b) => (a.year - b.year) || (a.month - b.month));

  function toggleMonth(y, m) {
    const k = `${y}-${m}`;
    if (selectedKey.has(k)) selectedKey.delete(k);
    else                    selectedKey.add(k);
    selectedKey = new Set(selectedKey);
  }
  function isSelected(y, m) { return selectedKey.has(`${y}-${m}`); }

  $: canSubmit = !submitting && selectedKey.size > 0 && clients.length > 0;
  $: estimatedInvoiceCount = clients.length * selectedKey.size;

  function close() { dispatch('close'); }

  async function submit() {
    submitting = true;
    errorMsg = '';
    step = 'running';
    try {
      resultData = await api.post('/clients/bulk-bill', {
        clientIds: clients.map(c => c.id),
        months:    selectedMonths
      });
      step = 'done';
    } catch (e) {
      errorMsg = e.message || 'Error al generar facturas';
      step = 'error';
    } finally {
      submitting = false;
    }
  }

  function finish() {
    dispatch('done', { summary: resultData?.summary, results: resultData?.results });
  }

  function fmtCop(c) {
    if (c == null) return '—';
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format((c || 0) / 100);
  }

  function rowStatusBadge(status) {
    switch (status) {
      case 'ok':          return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'creadas' };
      case 'allReused':   return { cls: 'bg-slate-100 text-slate-600 border-slate-200',     label: 'ya existían' };
      case 'mixed':       return { cls: 'bg-blue-50 text-blue-700 border-blue-200',         label: 'mixto' };
      case 'paidSkipped': return { cls: 'bg-violet-50 text-violet-700 border-violet-200',   label: 'ya pagado' };
      case 'failed':      return { cls: 'bg-red-50 text-red-700 border-red-200',            label: 'falló' };
      default:            return { cls: 'bg-slate-100 text-slate-600 border-slate-200',     label: status || '—' };
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4
            bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
     on:click|self={close}
     role="dialog" aria-label="Cobro masivo">

  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 sm:my-0
              max-h-[95vh] flex flex-col overflow-hidden">

    <!-- Header -->
    <div class="flex items-start sm:items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 flex-shrink-0">
      <div class="min-w-0">
        <h3 class="font-semibold text-text-primary text-base flex items-center gap-2">
          <Receipt size={18} class="text-brand-600" />
          Cobro masivo
        </h3>
        <p class="text-xs text-text-muted mt-0.5 leading-tight">
          {clients.length} cliente{clients.length === 1 ? '' : 's'} · {selectedKey.size} mes{selectedKey.size === 1 ? '' : 'es'} seleccionado{selectedKey.size === 1 ? '' : 's'}
          {#if estimatedInvoiceCount > 0}· {estimatedInvoiceCount} factura{estimatedInvoiceCount === 1 ? '' : 's'} estimada{estimatedInvoiceCount === 1 ? '' : 's'}{/if}
        </p>
      </div>
      <button class="btn-icon" on:click={close} disabled={submitting}>
        <X size={16} />
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">

      {#if step === 'pick'}
        <!-- Year navigator -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <button type="button" class="btn-ghost" on:click={() => year -= 1}>
            <ChevronLeft size={14} /> {year - 1}
          </button>
          <span class="text-sm font-bold text-text-primary tabular-nums">{year}</span>
          <button type="button" class="btn-ghost" on:click={() => year += 1}>
            {year + 1} <ChevronRight size={14} />
          </button>
        </div>

        <!-- Months grid -->
        <div class="px-5 py-4">
          <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {#each MONTH_NAMES as name, i}
              {@const m = i + 1}
              {@const sel = isSelected(year, m)}
              <button type="button"
                      on:click={() => toggleMonth(year, m)}
                      class="px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all
                             {sel ? 'border-brand-600 bg-brand-50 text-brand-800 shadow-sm'
                                  : 'border-slate-200 text-text-secondary hover:border-slate-300'}">
                <div class="flex items-center justify-between gap-1">
                  <span>{name}</span>
                  {#if sel}<CheckCircle2 size={14} class="text-brand-600" />{/if}
                </div>
                <div class="text-[10px] text-text-muted mt-0.5 tabular-nums">{year}</div>
              </button>
            {/each}
          </div>
        </div>

        <!-- Selected summary -->
        {#if selectedKey.size > 0}
          <div class="px-5 py-3 border-t border-slate-100 bg-slate-50/40">
            <div class="text-xs text-text-muted uppercase tracking-wider font-semibold mb-1.5">Selección</div>
            <div class="flex items-center gap-1.5 flex-wrap">
              {#each selectedMonths as { year: y, month: m }}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-100 text-brand-800 text-xs font-medium">
                  {MONTH_NAMES[m - 1]} {y}
                  <button type="button" on:click={() => toggleMonth(y, m)}
                          class="hover:bg-brand-200 rounded-full p-0.5">
                    <X size={10} />
                  </button>
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Affected clients summary -->
        <div class="px-5 py-3 border-t border-slate-100">
          <div class="text-xs text-text-muted uppercase tracking-wider font-semibold mb-1.5">
            Clientes afectados ({clients.length})
          </div>
          <div class="max-h-32 overflow-y-auto text-xs text-text-secondary">
            {#each clients.slice(0, 20) as c}
              <div class="py-0.5 truncate">· {c.name}</div>
            {/each}
            {#if clients.length > 20}
              <div class="text-text-muted pt-1">… y {clients.length - 20} más</div>
            {/if}
          </div>
        </div>

        <div class="px-5 py-3 border-t border-slate-100 bg-amber-50/40 flex items-start gap-2">
          <AlertTriangle size={14} class="text-amber-600 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-amber-900">
            Las facturas se crean (o se reutilizan si ya existen). Meses con pago confirmado se omiten. Clientes sin plan asignado fallarán.
          </p>
        </div>

      {:else if step === 'running'}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={32} class="animate-spin text-brand-600" />
          <p class="text-sm text-text-secondary">
            Generando facturas para {clients.length} cliente{clients.length === 1 ? '' : 's'} × {selectedKey.size} mes{selectedKey.size === 1 ? '' : 'es'}…
          </p>
        </div>

      {:else if step === 'done'}
        <div class="p-5">
          <div class="flex items-start gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 size={24} class="text-emerald-600" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-base font-semibold text-text-primary">Cobro masivo aplicado</h4>
              <p class="text-xs text-text-muted">
                {resultData?.summary?.invoicesCreated || 0} factura{(resultData?.summary?.invoicesCreated || 0) === 1 ? '' : 's'} nueva{(resultData?.summary?.invoicesCreated || 0) === 1 ? '' : 's'} ·
                {resultData?.summary?.invoicesReused || 0} reutilizada{(resultData?.summary?.invoicesReused || 0) === 1 ? '' : 's'} ·
                Total: <strong class="font-mono tabular-nums">{fmtCop(resultData?.summary?.totalAmount)}</strong>
              </p>
            </div>
            <a href="/invoices" class="text-xs text-brand-700 hover:underline font-medium whitespace-nowrap">
              Ver facturas →
            </a>
          </div>

          <div class="mt-3 border border-slate-200 rounded-lg max-h-[40vh] overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 text-text-secondary uppercase tracking-wider text-[10px] font-semibold sticky top-0">
                <tr>
                  <th class="text-left px-3 py-2">Cliente</th>
                  <th class="text-left px-2 py-2">Resultado</th>
                  <th class="text-right px-2 py-2">Creadas</th>
                  <th class="text-right px-2 py-2">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                {#each (resultData?.results || []) as r}
                  {@const b = rowStatusBadge(r.status)}
                  <tr>
                    <td class="px-3 py-1.5 font-medium text-text-primary truncate max-w-[200px]" title={r.clientName}>{r.clientName || r.clientId}</td>
                    <td class="px-2 py-1.5">
                      <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium {b.cls}">{b.label}</span>
                      {#if r.reason}<div class="text-[10px] text-red-600 mt-0.5">{r.reason}</div>{/if}
                    </td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{r.totalCreated || 0}</td>
                    <td class="px-2 py-1.5 text-right tabular-nums font-mono">{fmtCop(r.totalAmount)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

      {:else if step === 'error'}
        <div class="p-5">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle size={24} class="text-red-600" />
            </div>
            <h4 class="text-base font-semibold text-text-primary">No se pudo aplicar</h4>
          </div>
          <p class="text-sm text-text-secondary">{errorMsg}</p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
      {#if step === 'pick'}
        <button class="btn-secondary" on:click={close}>Cancelar</button>
        <button class="btn-primary" disabled={!canSubmit} on:click={submit}>
          <Receipt size={14} />
          Generar {estimatedInvoiceCount} factura{estimatedInvoiceCount === 1 ? '' : 's'}
          <ArrowRight size={14} />
        </button>
      {:else if step === 'running'}
        <button class="btn-secondary" disabled>En progreso…</button>
      {:else if step === 'done'}
        <button class="btn-primary" on:click={finish}>Listo</button>
      {:else if step === 'error'}
        <button class="btn-secondary" on:click={close}>Cerrar</button>
        <button class="btn-primary" on:click={() => step = 'pick'}>Reintentar</button>
      {/if}
    </div>
  </div>
</div>
