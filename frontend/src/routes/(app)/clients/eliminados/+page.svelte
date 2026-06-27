<script>
  import { onMount } from 'svelte';
  import { clientsApi } from '$lib/api/clients.api.js';
  import {
    Search, Loader2, AlertCircle, Archive, RefreshCw, Wallet, Download, X, Loader
  } from 'lucide-svelte';

  /** @type {any[]} */
  let rows = [];
  let meta = { total: 0, totalDebt: 0 };
  let loading = true;
  let error = '';
  let q = '';
  let withDebt = false;
  let exporting = false;

  /** @type {any|null} */
  let detail = null;
  let detailLoading = false;

  const REASON_LABEL = {
    NO_PAGO: 'No pagó',
    SE_RETIRO: 'Se retiró / mudó',
    CANCELACION_VOLUNTARIA: 'Cancelación voluntaria',
    OTRO: 'Otro'
  };
  const METHOD_LABEL = { CASH: 'Efectivo', BANK_TRANSFER: 'Consignación', WOMPI: 'Wompi', CREDIT_CARD: 'Tarjeta', OTHER: 'Otro' };
  const STATUS_LABEL = { PAID: 'Pagada', PENDING: 'Pendiente', OVERDUE: 'Vencida', PARTIAL: 'Parcial', CANCELLED: 'Cancelada', DRAFT: 'Borrador' };

  const fmt = (c) => '$' + Math.round((c || 0) / 100).toLocaleString('es-CO');
  const fdate = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const reasonText = (r) => r.reasonCategory ? REASON_LABEL[r.reasonCategory] || r.reasonCategory : (r.reasonNote ? '' : '—');

  let t;
  async function load() {
    loading = true; error = '';
    try {
      const res = await clientsApi.archive({ search: q || undefined, withDebt: withDebt || undefined, limit: 200 });
      rows = res.data; meta = res.meta;
    } catch (e) { error = e?.message || 'No se pudo cargar el archivo'; }
    finally { loading = false; }
  }
  function onSearch() { clearTimeout(t); t = setTimeout(load, 350); }
  onMount(load);

  async function openDetail(row) {
    detail = { ...row, _full: null }; detailLoading = true;
    try { detail = { ...(await clientsApi.archiveEntry(row.id)) }; }
    catch (e) { /* keep summary */ }
    finally { detailLoading = false; }
  }

  async function exportXlsx() {
    exporting = true;
    try {
      const XLSX = await import('xlsx');
      const header = ['Nombre', 'Documento', 'IP', 'Plan', 'Fecha baja', 'Motivo', 'Nota', 'Deuda que quedó', 'Total facturado', 'Total pagado', '# Facturas', '# Pagos', 'Eliminado por'];
      const data = rows.map(r => [
        r.name, r.documentNumber || '', r.ip || '', r.planName || '', fdate(r.deletedAt),
        REASON_LABEL[r.reasonCategory] || '', r.reasonNote || '',
        Math.round((r.outstandingDebt || 0) / 100), Math.round((r.totalInvoiced || 0) / 100),
        Math.round((r.totalPaid || 0) / 100), r.invoiceCount, r.paymentCount, r.deletedByUserName || ''
      ]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Clientes eliminados');
      XLSX.writeFile(wb, 'clientes_eliminados.xlsx');
    } finally { exporting = false; }
  }
</script>

<svelte:head><title>Clientes eliminados · ISP Manager</title></svelte:head>

<div class="p-4 sm:p-6 space-y-4">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div class="flex items-center gap-2">
      <Archive class="w-6 h-6 text-[#16357E]" />
      <div>
        <h1 class="text-xl font-bold text-gray-900">Clientes eliminados</h1>
        <p class="text-sm text-gray-500">{meta.total} registros · saldos que quedaron debiendo</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button on:click={load} class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
        <RefreshCw class="w-4 h-4" /> Actualizar
      </button>
      <button on:click={exportXlsx} disabled={exporting || !rows.length}
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#16357E] text-white px-3 py-2 text-sm hover:bg-[#0f2860] disabled:opacity-50">
        {#if exporting}<Loader2 class="w-4 h-4 animate-spin" />{:else}<Download class="w-4 h-4" />{/if} Exportar Excel
      </button>
    </div>
  </div>

  <div class="flex flex-col sm:flex-row sm:items-center gap-3">
    <div class="relative flex-1 max-w-md">
      <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input bind:value={q} on:input={onSearch} placeholder="Buscar nombre, documento, IP, correo…"
             class="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-[#16357E]/30" />
    </div>
    <label class="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
      <input type="checkbox" bind:checked={withDebt} on:change={load} class="rounded border-gray-300" /> Solo con deuda
    </label>
    <span class="inline-flex items-center gap-1.5 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm font-medium">
      <Wallet class="w-4 h-4" /> Deuda total dejada: {fmt(meta.totalDebt)}
    </span>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20 text-gray-400"><Loader2 class="w-6 h-6 animate-spin" /><span class="ml-2">Cargando…</span></div>
  {:else if error}
    <div class="flex items-center gap-2 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm"><AlertCircle class="w-5 h-5" /> {error}</div>
  {:else}
    <div class="overflow-auto border border-gray-200 rounded-lg bg-white max-h-[calc(100vh-260px)]">
      <table class="min-w-max w-full text-sm">
        <thead class="sticky top-0 bg-gray-50 text-gray-600 text-xs uppercase">
          <tr>
            <th class="text-left px-3 py-2 border-b">Cliente</th>
            <th class="text-left px-3 py-2 border-b">Documento</th>
            <th class="text-left px-3 py-2 border-b">IP</th>
            <th class="text-left px-3 py-2 border-b">Baja</th>
            <th class="text-left px-3 py-2 border-b">Motivo</th>
            <th class="text-right px-3 py-2 border-b">Deuda que quedó</th>
            <th class="text-right px-3 py-2 border-b">Facturado</th>
            <th class="text-right px-3 py-2 border-b">Pagado</th>
            <th class="text-left px-3 py-2 border-b">Eliminado por</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.id)}
            <tr class="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer" on:click={() => openDetail(r)}>
              <td class="px-3 py-2 font-medium text-gray-900">{r.name}</td>
              <td class="px-3 py-2 text-gray-600">{r.documentNumber || '—'}</td>
              <td class="px-3 py-2 text-gray-500 font-mono text-xs">{r.ip || '—'}</td>
              <td class="px-3 py-2 text-gray-600">{fdate(r.deletedAt)}</td>
              <td class="px-3 py-2 text-gray-600">
                {reasonText(r)}{#if r.reasonNote}<span class="text-gray-400"> · {r.reasonNote}</span>{/if}
              </td>
              <td class="px-3 py-2 text-right font-semibold" class:text-red-600={r.outstandingDebt > 0} class:text-gray-400={!r.outstandingDebt}>
                {r.outstandingDebt > 0 ? fmt(r.outstandingDebt) : '—'}
              </td>
              <td class="px-3 py-2 text-right text-gray-600">{fmt(r.totalInvoiced)}</td>
              <td class="px-3 py-2 text-right text-gray-600">{fmt(r.totalPaid)}</td>
              <td class="px-3 py-2 text-gray-500">{r.deletedByUserName || '—'}</td>
            </tr>
          {/each}
          {#if rows.length === 0}
            <tr><td colspan="9" class="text-center py-10 text-gray-400">Sin clientes eliminados</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Detail modal -->
{#if detail}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" on:click={() => detail = null} on:keydown={(e)=>e.key==='Escape'&&(detail=null)} role="presentation">
    <div class="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-white shadow-xl" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div>
          <h3 class="font-semibold text-gray-900">{detail.name}</h3>
          <p class="text-xs text-gray-500">Eliminado {fdate(detail.deletedAt)}{detail.deletedByUserName ? ` · por ${detail.deletedByUserName}` : ''}</p>
        </div>
        <button class="text-gray-400 hover:text-gray-700" on:click={() => detail = null}><X class="w-5 h-5" /></button>
      </div>
      <div class="flex-1 overflow-auto px-5 py-3 space-y-4 text-sm">
        <!-- snapshot -->
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div><span class="text-gray-400">Documento:</span> {detail.documentNumber || '—'}</div>
          <div><span class="text-gray-400">IP:</span> {detail.ip || '—'}</div>
          <div><span class="text-gray-400">Teléfono:</span> {detail.phone || '—'}</div>
          <div><span class="text-gray-400">Correo:</span> {detail.email || '—'}</div>
          <div><span class="text-gray-400">Plan:</span> {detail.planName || '—'}</div>
          <div><span class="text-gray-400">Mensualidad:</span> {fmt(detail.monthlyFee)}</div>
          <div><span class="text-gray-400">Motivo:</span> {reasonText(detail)}{detail.reasonNote ? ` · ${detail.reasonNote}` : ''}</div>
          <div><span class="text-gray-400">Estado previo:</span> {detail.previousStatus || '—'}</div>
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="rounded-full bg-red-50 text-red-700 px-2.5 py-1 text-xs font-medium">Deuda que quedó: {fmt(detail.outstandingDebt)}</span>
          <span class="rounded-full bg-gray-100 text-gray-700 px-2.5 py-1 text-xs">Facturado: {fmt(detail.totalInvoiced)}</span>
          <span class="rounded-full bg-green-50 text-green-700 px-2.5 py-1 text-xs">Pagado: {fmt(detail.totalPaid)}</span>
        </div>

        {#if detailLoading}
          <div class="flex items-center gap-2 text-gray-400 py-4"><Loader2 class="w-4 h-4 animate-spin" /> Cargando desglose…</div>
        {:else if detail.detail}
          <div>
            <p class="font-medium text-gray-700 mb-1">Facturas ({detail.detail.invoices?.length || 0})</p>
            <div class="overflow-auto border border-gray-100 rounded-lg">
              <table class="w-full text-xs">
                <thead class="bg-gray-50 text-gray-500"><tr><th class="text-left px-2 py-1">N°</th><th class="text-left px-2 py-1">Periodo</th><th class="text-right px-2 py-1">Monto</th><th class="text-right px-2 py-1">Saldo</th><th class="text-left px-2 py-1">Estado</th></tr></thead>
                <tbody>
                  {#each detail.detail.invoices || [] as inv}
                    <tr class="border-t border-gray-50">
                      <td class="px-2 py-1 font-mono">{inv.number}</td>
                      <td class="px-2 py-1">{inv.month ? `${String(inv.month).padStart(2,'0')}/${inv.year}` : '—'}</td>
                      <td class="px-2 py-1 text-right">{fmt(inv.amount)}</td>
                      <td class="px-2 py-1 text-right" class:text-red-600={inv.balanceDue > 0}>{fmt(inv.balanceDue)}</td>
                      <td class="px-2 py-1">{STATUS_LABEL[inv.status] || inv.status}</td>
                    </tr>
                  {/each}
                  {#if !(detail.detail.invoices || []).length}<tr><td colspan="5" class="text-center py-2 text-gray-400">Sin facturas</td></tr>{/if}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p class="font-medium text-gray-700 mb-1">Pagos ({detail.detail.payments?.length || 0})</p>
            <div class="overflow-auto border border-gray-100 rounded-lg">
              <table class="w-full text-xs">
                <thead class="bg-gray-50 text-gray-500"><tr><th class="text-left px-2 py-1">Fecha</th><th class="text-right px-2 py-1">Monto</th><th class="text-left px-2 py-1">Método</th><th class="text-left px-2 py-1">Estado</th></tr></thead>
                <tbody>
                  {#each detail.detail.payments || [] as p}
                    <tr class="border-t border-gray-50">
                      <td class="px-2 py-1">{fdate(p.date)}</td>
                      <td class="px-2 py-1 text-right">{fmt(p.amount)}</td>
                      <td class="px-2 py-1">{METHOD_LABEL[p.method] || p.method}</td>
                      <td class="px-2 py-1">{p.status}</td>
                    </tr>
                  {/each}
                  {#if !(detail.detail.payments || []).length}<tr><td colspan="4" class="text-center py-2 text-gray-400">Sin pagos</td></tr>{/if}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
