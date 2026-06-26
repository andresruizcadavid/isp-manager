<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { invoicesApi } from '$lib/api/invoices.api.js';
  import RegisterPaymentModal from '$lib/components/payments/RegisterPaymentModal.svelte';
  import {
    ArrowLeft, FileText, CreditCard, Download, Send, Loader2, Receipt,
    CheckCircle2, AlertCircle, Calendar, User, MapPin, Wifi, Image as ImageIcon,
    ExternalLink, Phone, Mail, Banknote, Eye, X,
    Copy, Check
  } from 'lucide-svelte';

  // ── State ────────────────────────────────────────────────────────────
  let loading = true;
  let error   = '';
  let success = '';
  /** @type {import('$lib/types').Invoice | null} */
  let invoice = null;

  // ── Action state ─────────────────────────────────────────────────────
  let downloading    = false;
  let sending        = false;
  let actionBusy     = false;
  let showPayModal   = false;

  // ── Send modal state ─────────────────────────────────────────────────
  let showSendModal  = false;
  /** @type {string[]} */
  let sendChannels   = [];
  let sendPdf        = true;
  let sendPaymentLink = false;
  /** @type {any} */
  let sendResults    = null;     // { results: [], paymentLinkUrl: string|null }
  let sendRunning    = false;
  let sendError      = '';
  let copied         = false;    // payment link copy feedback
  let manualLink        = '';    // "obtener link (manual)" — link to copy & share yourself
  let manualLinkLoading = false;
  let manualLinkError   = '';

  // ── Constants ────────────────────────────────────────────────────────
  /** @type {Record<string, string>} */
  const STATUS_PT = {
    DRAFT:'Borrador', PENDING:'Pendiente', PARTIAL:'Pago parcial',
    PAID:'Pagada', OVERDUE:'Vencida', CANCELLED:'Cancelada', REFUNDED:'Reembolsada'
  };
  /** @type {Record<string, string>} */
  const STATUS_CLS = {
    DRAFT:    'bg-slate-100 text-slate-600',
    PENDING:  'bg-amber-100 text-amber-700',
    PARTIAL:  'bg-blue-100 text-blue-700',
    PAID:     'bg-emerald-100 text-emerald-700',
    OVERDUE:  'bg-red-100 text-red-700',
    CANCELLED:'bg-slate-100 text-slate-500',
    REFUNDED: 'bg-violet-100 text-violet-700'
  };
  /** @type {Record<string, string>} */
  const METHOD_PT = {
    CASH:'Efectivo', BANK_TRANSFER:'Transferencia',
    WOMPI:'Wompi', NEQUI:'Nequi', BANCOLOMBIA:'Bancolombia',
    CREDIT_CARD:'Tarjeta de crédito', OTHER:'Otro'
  };
  /** @type {Record<string, string>} */
  const PAY_STATUS_CLS = {
    COMPLETED:'bg-emerald-100 text-emerald-700',
    PENDING:  'bg-amber-100 text-amber-700',
    FAILED:   'bg-red-100 text-red-700',
    REFUNDED: 'bg-violet-100 text-violet-700',
    CANCELLED:'bg-slate-100 text-slate-500'
  };
  const MONTHS_ES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  // ── Helpers ──────────────────────────────────────────────────────────
  /** @param {number|null|undefined} c */
  function fmtMoney(c) {
    if (c == null) return '—';
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(c / 100);
  }
  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
  }
  /** @param {string|Date|null|undefined} s */
  function fmtDateTime(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  /** @param {string|null|undefined} text */
  function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s)<>"']+/gi);
    return matches ? [...new Set(matches)] : [];
  }
  /** @param {any} inv */
  function periodLabel(inv) {
    if (!inv?.periodYear || !inv?.periodMonth) return null;
    return `${MONTHS_ES[inv.periodMonth - 1]} ${inv.periodYear}`;
  }
  /** @param {string|Date} date */
  function daysUntil(date) {
    const d = (new Date(date).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86_400_000;
    return Math.round(d);
  }
  /** @param {string} kind @param {string} msg */
  function showToast(kind, msg) {
    if (kind === 'error') error = msg; else success = msg;
    setTimeout(() => { error = ''; success = ''; }, 4000);
  }
  /** @param {any} p */
  function isImage(p) {
    return (p?.mimeType || '').startsWith('image/');
  }

  // ── Derived ──────────────────────────────────────────────────────────
  $: paid     = invoice ? (invoice.total - invoice.balanceDue) : 0;
  $: overdue  = invoice && invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' &&
                invoice.dueDate && new Date(invoice.dueDate) < new Date();
  $: payable  = invoice && ['PENDING','PARTIAL','OVERDUE'].includes(invoice.status);

  // ── Load ─────────────────────────────────────────────────────────────
  onMount(async () => {
    await reload();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('wompi') === 'return') {
      const ref = urlParams.get('ref') || '';
      showToast('success', ref
        ? `Pago iniciado con Wompi. Ref: ${ref.slice(-12)}. Esperando confirmación…`
        : 'Redirigido desde Wompi. Esperando confirmación del pago…');
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
  });

  async function reload() {
    loading = true;
    error = '';
    try {
      invoice = await invoicesApi.getOne($page.params.id);
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo cargar la factura';
    } finally {
      loading = false;
    }
  }

  // ── PDF download (auth-protected, so manual blob fetch) ───────────────
  async function downloadPdf() {
    const inv = invoice;
    if (!browser || !inv) return;
    downloading = true;
    try {
      const token = localStorage.getItem('isp_token');
      const res = await fetch(`/api/v1/invoices/${inv.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${inv.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'No se pudo descargar el PDF');
    } finally {
      downloading = false;
    }
  }

  // ── Send management modal ────────────────────────────────────────────
  function openSendModal() {
    sendChannels = [];
    if (invoice?.client?.email) sendChannels = ['email'];
    sendPdf = true;
    sendPaymentLink = false;
    sendResults = null;
    sendError = '';
    copied = false;
    manualLink = '';
    manualLinkError = '';
    showSendModal = true;
  }

  // Generate a Wompi payment link WITHOUT sending — operator copies & shares it.
  async function getManualLink() {
    if (!invoice) return;
    manualLinkLoading = true;
    manualLinkError = '';
    try {
      const res = await invoicesApi.paymentLink(invoice.id);
      manualLink = res?.checkoutUrl || '';
      if (!manualLink) manualLinkError = 'No se recibió el link';
    } catch (/** @type {any} */ e) {
      manualLinkError = e.message || 'No se pudo generar el link';
    } finally {
      manualLinkLoading = false;
    }
  }
  function closeSendModal() {
    if (sendRunning) return;
    showSendModal = false;
    sendResults = null;
  }
  /** @param {string} ch */
  function toggleSendChannel(ch) {
    if (sendChannels.includes(ch)) {
      sendChannels = sendChannels.filter(c => c !== ch);
    } else {
      sendChannels = [...sendChannels, ch];
    }
  }
  async function doSend() {
    const inv = invoice;
    if (!inv) return;
    if (sendChannels.length === 0) { sendError = 'Seleccione al menos un canal'; return; }
    sendRunning = true;
    sendError = '';
    sendResults = null;
    try {
      const res = await invoicesApi.send(inv.id, {
        channels: sendChannels,
        sendPdf,
        sendPaymentLink
      });
      sendResults = res;
      // Honest status: the backend returns 207 with success:false on partial
      // failure (the api client unwraps `data`, so inspect the rows directly).
      const rows   = res?.results || [];
      const failed = rows.filter((/** @type {any} */ r) => r.status === 'failed');
      if (failed.length === 0) {
        showToast('success', 'Envío completado correctamente');
      } else if (failed.length === rows.length) {
        showToast('error', 'No se pudo completar ningún envío');
      } else {
        showToast('error', `Envío parcial: ${failed.length} de ${rows.length} fallaron`);
      }
    } catch (/** @type {any} */ e) {
      sendError = e.message || 'Envío fallido';
    } finally {
      sendRunning = false;
    }
  }
  /** @param {string} url */
  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => copied = false, 2500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      copied = true;
      setTimeout(() => copied = false, 2500);
    }
  }

  // ── Mark paid manually (admin shortcut) ──────────────────────────────
  async function markAsPaid() {
    const inv = invoice;
    if (!inv) return;
    if (!confirm('Marcar la factura como pagada sin registrar un pago detallado. ¿Continuar?')) return;
    actionBusy = true;
    try {
      await invoicesApi.markPaid(inv.id);
      showToast('success', 'Factura marcada como pagada');
      await reload();
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'No se pudo marcar como pagada');
    } finally {
      actionBusy = false;
    }
  }

  // ── Registrar pago (modal único: RegisterPaymentModal) ─
  function openPayModal() {
    showPayModal = true;
  }

  async function onPayDone() {
    showPayModal = false;
    showToast('success', 'Pago registrado correctamente');
    await reload();
  }
</script>

<svelte:head>
  <title>Factura — ISP Manager</title>
</svelte:head>

<!-- Toasts -->
{#if error}
  <div class="fixed top-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 shadow-lg text-sm flex items-center gap-2">
    <AlertCircle size={16} /> {error}
  </div>
{/if}
{#if success}
  <div class="fixed top-4 right-4 z-50 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-2 shadow-lg text-sm flex items-center gap-2">
    <CheckCircle2 size={16} /> {success}
  </div>
{/if}

<!-- Breadcrumb / back -->
<div class="mb-4">
  <a href="/invoices" class="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-brand-800">
    <ArrowLeft size={14} /> Volver a Facturas
  </a>
</div>

{#if loading}
  <div class="flex items-center justify-center py-20 text-text-secondary">
    <Loader2 size={20} class="animate-spin mr-2" /> Cargando factura…
  </div>

{:else if !invoice}
  <div class="card p-10 text-center text-text-secondary">
    Factura no encontrada.
  </div>

{:else}

  <!-- ── Header ──────────────────────────────────────────────────── -->
  <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
    <div class="min-w-0">
      <div class="flex items-center gap-3 flex-wrap">
        <h1 class="page-title font-mono">{invoice.invoiceNumber}</h1>
        <span class="px-2 py-0.5 rounded-full text-xs font-medium {STATUS_CLS[invoice.status] || 'bg-slate-100 text-slate-600'}">
          {STATUS_PT[invoice.status] || invoice.status}
        </span>
        {#if overdue}
          <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            Vencida hace {Math.abs(daysUntil(invoice.dueDate))} día{Math.abs(daysUntil(invoice.dueDate)) === 1 ? '' : 's'}
          </span>
        {/if}
      </div>
      <div class="text-sm text-text-secondary mt-1 flex items-center gap-2 flex-wrap">
        {#if invoice.client?.id}
          <a href="/clients/{invoice.client.id}" class="text-brand-800 hover:underline font-medium inline-flex items-center gap-1">
            <User size={13} /> {invoice.client.name}
          </a>
        {/if}
        {#if periodLabel(invoice)}
          <span class="text-text-muted">·</span>
          <span class="inline-flex items-center gap-1"><Calendar size={13} /> {periodLabel(invoice)}</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <button class="btn-secondary" on:click={openSendModal}>
        <Send size={15} /> Enviar / Gestionar
      </button>
      {#if payable}
        <button class="btn-primary" on:click={openPayModal}>
          <CreditCard size={15} /> Registrar pago
        </button>
      {/if}
      {#if invoice.status === 'PENDING' || invoice.status === 'OVERDUE'}
        <button class="btn-ghost" on:click={markAsPaid} disabled={actionBusy} title="Marcar como pagada sin registrar pago detallado">
          <CheckCircle2 size={15} /> Marcar pagada
        </button>
      {/if}
    </div>
  </div>

  <!-- ── KPI strip ───────────────────────────────────────────────── -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    <div class="kpi-tile">
      <div class="icon-square-blue"><Receipt size={14} /></div>
      <div class="kpi-tile-text">
        <div class="kpi-label">Total facturado</div>
        <div class="kpi-value">{fmtMoney(invoice.total)}</div>
        <div class="kpi-sub">Emitida el {fmtDate(invoice.issueDate)}</div>
      </div>
    </div>
    <div class="kpi-tile">
      <div class="icon-square-green"><CheckCircle2 size={14} /></div>
      <div class="kpi-tile-text">
        <div class="kpi-label">Pagado</div>
        <div class="kpi-value text-emerald-600">{fmtMoney(paid)}</div>
        <div class="kpi-sub">{invoice.payments?.length || 0} pago{invoice.payments?.length === 1 ? '' : 's'}</div>
      </div>
    </div>
    <div class="kpi-tile">
      <div class="icon-square-rose"><CreditCard size={14} /></div>
      <div class="kpi-tile-text">
        <div class="kpi-label">Saldo pendiente</div>
        <div class="kpi-value {invoice.balanceDue > 0 ? 'text-orange-600' : 'text-emerald-600'}">{fmtMoney(invoice.balanceDue)}</div>
        <div class="kpi-sub">{invoice.balanceDue > 0 ? 'Por cobrar' : 'Saldada'}</div>
      </div>
    </div>
    <div class="kpi-tile">
      <div class="icon-square-amber"><Calendar size={14} /></div>
      <div class="kpi-tile-text">
        <div class="kpi-label">Vencimiento</div>
        <div class="kpi-value text-base {overdue ? 'text-red-600' : 'text-slate-900'}">{fmtDate(invoice.dueDate)}</div>
        <div class="kpi-sub">
          {#if invoice.status === 'PAID'}Pagada el {fmtDate(invoice.paidDate)}
          {:else if overdue}Vencida
          {:else if invoice.dueDate}En {daysUntil(invoice.dueDate)} día{daysUntil(invoice.dueDate) === 1 ? '' : 's'}
          {:else}—{/if}
        </div>
      </div>
    </div>
  </div>

  <!-- 2/3 + 1/3 layout -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

    <div class="lg:col-span-2 space-y-4">

      <!-- ── Datos generales ─────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <FileText size={16} class="text-slate-600" />
            <h2 class="font-semibold text-slate-900">Datos de la factura</h2>
          </div>
        </div>
        <div class="card-body grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div class="label !mb-1">Fecha emisión</div>
            <div class="text-sm font-medium text-slate-900">{fmtDate(invoice.issueDate)}</div>
          </div>
          <div>
            <div class="label !mb-1">Vencimiento</div>
            <div class="text-sm font-medium {overdue ? 'text-red-600' : 'text-slate-900'}">{fmtDate(invoice.dueDate)}</div>
          </div>
          <div>
            <div class="label !mb-1">Fecha de pago</div>
            <div class="text-sm font-medium text-slate-900">{fmtDate(invoice.paidDate)}</div>
          </div>
          <div>
            <div class="label !mb-1">Subtotal</div>
            <div class="text-sm font-mono text-slate-900">{fmtMoney(invoice.amount)}</div>
          </div>
          <div>
            <div class="label !mb-1">IVA</div>
            <div class="text-sm font-mono text-slate-900">{fmtMoney(invoice.tax)}</div>
          </div>
          <div>
            <div class="label !mb-1">Descuento</div>
            <div class="text-sm font-mono text-slate-900">{invoice.discount ? `− ${fmtMoney(invoice.discount)}` : fmtMoney(0)}</div>
          </div>
          {#if invoice.notes}
            <div class="col-span-2 md:col-span-3">
              <div class="label !mb-1">Notas</div>
              <div class="text-sm text-slate-700 whitespace-pre-wrap">{invoice.notes}</div>
            </div>
          {/if}
          {#if invoice.wisphubId}
            <div class="col-span-2 md:col-span-3">
              <div class="text-[11px] text-text-muted">Importada desde WispHub · id <span class="font-mono">{invoice.wisphubId}</span></div>
            </div>
          {/if}
        </div>
      </div>

      <!-- ── Items ───────────────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <Receipt size={16} class="text-slate-600" />
            <h2 class="font-semibold text-slate-900">Conceptos</h2>
            <span class="text-xs text-slate-500">({invoice.items?.length || 0})</span>
          </div>
        </div>
        {#if !invoice.items || invoice.items.length === 0}
          <div class="p-6 text-center text-sm text-text-muted">Sin conceptos detallados — la factura cobra el plan completo del cliente.</div>
        {:else}
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th class="text-right">Cantidad</th>
                  <th class="text-right">Valor unit.</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {#each invoice.items as it}
                  <tr>
                    <td class="text-slate-700">{it.description || '—'}</td>
                    <td class="text-right font-mono text-xs">{it.quantity ?? 1}</td>
                    <td class="text-right font-mono text-xs">{fmtMoney(it.unitPrice ?? it.price)}</td>
                    <td class="text-right font-mono font-medium">{fmtMoney(it.total ?? it.amount)}</td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="border-t border-slate-200">
                  <td colspan="3" class="text-right text-xs text-text-secondary py-2 pr-3">Subtotal</td>
                  <td class="text-right font-mono">{fmtMoney(invoice.amount)}</td>
                </tr>
                {#if invoice.tax > 0}
                  <tr>
                    <td colspan="3" class="text-right text-xs text-text-secondary py-1 pr-3">IVA</td>
                    <td class="text-right font-mono">{fmtMoney(invoice.tax)}</td>
                  </tr>
                {/if}
                {#if invoice.discount > 0}
                  <tr>
                    <td colspan="3" class="text-right text-xs text-text-secondary py-1 pr-3">Descuento</td>
                    <td class="text-right font-mono text-red-600">− {fmtMoney(invoice.discount)}</td>
                  </tr>
                {/if}
                <tr class="border-t border-slate-200">
                  <td colspan="3" class="text-right text-sm font-semibold text-slate-900 py-2 pr-3">Total</td>
                  <td class="text-right font-mono text-sm font-semibold">{fmtMoney(invoice.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}
      </div>

      <!-- ── Pagos asociados ─────────────────────────────────────── -->
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <CreditCard size={16} class="text-slate-600" />
            <h2 class="font-semibold text-slate-900">Pagos</h2>
            <span class="text-xs text-slate-500">({invoice.payments?.length || 0})</span>
          </div>
        </div>
        {#if !invoice.payments || invoice.payments.length === 0}
          <div class="p-6 text-center text-sm text-text-muted">Sin pagos registrados para esta factura.</div>
        {:else}
          <div class="divide-y divide-slate-100">
            {#each invoice.payments as p}
              <div class="p-4">
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-mono text-sm font-semibold tabular-nums">{fmtMoney(p.amount)}</span>
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-medium {PAY_STATUS_CLS[p.status] || 'bg-slate-100 text-slate-600'}">
                        {p.status}
                      </span>
                      <span class="text-xs text-text-muted">
                        {METHOD_PT[p.method] || p.method}
                      </span>
                    </div>
                    <div class="text-xs text-text-secondary mt-0.5">
                      {fmtDateTime(p.createdAt)}
                      {#if p.createdBy?.name}
                        · registrado por <span class="font-medium">{p.createdBy.name}</span>
                      {/if}
                      {#if p.transactionId}
                        · ref <span class="font-mono">{p.transactionId}</span>
                      {/if}
                    </div>
                  </div>
                </div>

                {#if p.notes}
                  <div class="mt-2 text-xs text-slate-700 whitespace-pre-wrap break-words">
                    {p.notes}
                  </div>
                  {#if extractUrls(p.notes).length > 0}
                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                      {#each extractUrls(p.notes) as url}
                        <a href={url} target="_blank" rel="noopener"
                           class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand-50 text-brand-800 text-[11px] hover:bg-brand-100">
                          <ExternalLink size={11} /> Ver recibo
                        </a>
                      {/each}
                    </div>
                  {/if}
                {/if}

                {#if (p.evidencePhotos?.length ?? 0) > 0}
                  <div class="mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {#each p.evidencePhotos ?? [] as ph}
                      <a href={ph.fileUrl} target="_blank" rel="noopener"
                         class="block aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-brand-300 group relative"
                         title={ph.fileName || 'Comprobante'}>
                        {#if isImage(ph)}
                          <img src={ph.fileUrl} alt={ph.fileName || 'Comprobante'} loading="lazy"
                               class="w-full h-full object-cover" />
                        {:else}
                          <div class="w-full h-full flex flex-col items-center justify-center text-text-muted">
                            <FileText size={20} />
                            <span class="text-[10px] mt-1">PDF</span>
                          </div>
                        {/if}
                        <div class="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Eye size={18} class="text-white" />
                        </div>
                      </a>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

    </div>

    <!-- ── Right column: cliente + timeline ───────────────────────── -->
    <div class="lg:col-span-1 space-y-4">

      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <User size={16} class="text-slate-600" />
            <h2 class="font-semibold text-slate-900">Cliente</h2>
          </div>
        </div>
        <div class="card-body space-y-3">
          <div>
            <div class="label !mb-1">Nombre</div>
            <a href="/clients/{invoice.client?.id}" class="text-sm font-medium text-brand-800 hover:underline">
              {invoice.client?.name || '—'}
            </a>
            {#if invoice.client?.documentNumber}
              <div class="text-xs text-text-muted mt-0.5">
                {invoice.client.documentType || 'CC'} {invoice.client.documentNumber}
              </div>
            {/if}
          </div>

          {#if invoice.client?.email}
            <div>
              <div class="label !mb-1">Email</div>
              <a href="mailto:{invoice.client.email}" class="text-sm text-text-primary hover:text-brand-800 inline-flex items-center gap-1.5">
                <Mail size={13} /> {invoice.client.email}
              </a>
            </div>
          {/if}

          {#if invoice.client?.phone}
            <div>
              <div class="label !mb-1">Teléfono</div>
              <a href="tel:{invoice.client.phone}" class="text-sm text-text-primary hover:text-brand-800 inline-flex items-center gap-1.5">
                <Phone size={13} /> {invoice.client.phone}
              </a>
            </div>
          {/if}

          {#if invoice.client?.address}
            <div>
              <div class="label !mb-1">Dirección</div>
              <div class="text-sm text-text-primary inline-flex items-start gap-1.5">
                <MapPin size={13} class="mt-0.5 text-text-muted" />
                <span>{invoice.client.address}{invoice.client.neighborhood ? `, ${invoice.client.neighborhood}` : ''}</span>
              </div>
            </div>
          {/if}

          {#if invoice.client?.plan?.name}
            <div>
              <div class="label !mb-1">Plan</div>
              <div class="text-sm font-medium text-slate-900 inline-flex items-center gap-1.5">
                <Wifi size={13} class="text-text-muted" /> {invoice.client.plan.name}
              </div>
              {#if invoice.client.plan.downloadSpeed && invoice.client.plan.uploadSpeed}
                <div class="text-xs text-text-muted mt-0.5">
                  {invoice.client.plan.downloadSpeed}↓ / {invoice.client.plan.uploadSpeed}↑ Mbps
                </div>
              {/if}
            </div>
          {/if}

          {#if invoice.client?.zone?.name}
            <div>
              <div class="label !mb-1">Zona</div>
              <div class="text-sm text-slate-700">{invoice.client.zone.name}</div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Timeline -->
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <Calendar size={16} class="text-slate-600" />
            <h2 class="font-semibold text-slate-900">Historial</h2>
          </div>
        </div>
        <div class="card-body">
          <ol class="space-y-3 text-sm">
            <li class="flex gap-2">
              <span class="w-2 h-2 rounded-full bg-slate-400 mt-1.5 flex-shrink-0"></span>
              <div>
                <div class="font-medium text-slate-900">Factura creada</div>
                <div class="text-xs text-text-muted">{fmtDateTime(invoice.createdAt)}</div>
              </div>
            </li>
            {#each (invoice.payments || []).slice().reverse() as p}
              <li class="flex gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></span>
                <div>
                  <div class="font-medium text-slate-900">Pago {fmtMoney(p.amount)} · {METHOD_PT[p.method] || p.method}</div>
                  <div class="text-xs text-text-muted">{fmtDateTime(p.createdAt)}</div>
                </div>
              </li>
            {/each}
            {#if overdue}
              <li class="flex gap-2">
                <span class="w-2 h-2 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></span>
                <div>
                  <div class="font-medium text-red-700">Vencida</div>
                  <div class="text-xs text-text-muted">{fmtDate(invoice.dueDate)}</div>
                </div>
              </li>
            {/if}
            {#if invoice.status === 'PAID'}
              <li class="flex gap-2">
                <span class="w-2 h-2 rounded-full bg-brand-600 mt-1.5 flex-shrink-0"></span>
                <div>
                  <div class="font-medium text-brand-800">Pagada totalmente</div>
                  <div class="text-xs text-text-muted">{fmtDate(invoice.paidDate)}</div>
                </div>
              </li>
            {/if}
          </ol>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Modal: Registrar pago (componente único) ─────────────── -->
  {#if showPayModal && invoice}
    <RegisterPaymentModal
      client={invoice.client}
      invoices={[invoice]}
      preselectInvoiceId={invoice.id}
      on:done={onPayDone}
      on:close={() => showPayModal = false} />
  {/if}

  <!-- ── Modal: Enviar / Gestionar factura ────────────────────────── -->
  {#if showSendModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
         on:click|self={closeSendModal}>
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div class="flex items-center gap-2">
            <Send size={16} class="text-slate-600" />
            <h3 class="font-semibold text-slate-900">Enviar / Gestionar factura</h3>
          </div>
          <button class="btn-icon" on:click={closeSendModal} disabled={sendRunning}>
            <X size={14} />
          </button>
        </div>

        <div class="p-5 space-y-5">

          <!-- Preview summary -->
          <div class="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <div class="font-medium text-slate-900">Factura {invoice.invoiceNumber}</div>
            <div class="text-text-secondary">{invoice.client?.name || '—'}</div>
            <div class="text-lg font-semibold text-slate-900">{fmtMoney(invoice.total)}</div>
            {#if invoice.client?.email}
              <div class="text-xs text-text-secondary inline-flex items-center gap-1"><Mail size={12} /> {invoice.client.email}</div>
            {/if}
            {#if invoice.client?.phone}
              <div class="text-xs text-text-secondary inline-flex items-center gap-1 ml-3"><Phone size={12} /> {invoice.client.phone}</div>
            {/if}
          </div>

          <!-- Channel selection -->
          <div>
            <div class="label !mb-2">Canales de envío</div>
            <div class="space-y-2">
              <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg border {invoice.client?.email ? 'border-slate-200 hover:border-brand-300 cursor-pointer' : 'border-slate-100 bg-slate-50 opacity-50'} transition"
                     class:border-brand-300={sendChannels.includes('email')}>
                <input type="checkbox" checked={sendChannels.includes('email')}
                       on:change={() => toggleSendChannel('email')}
                       disabled={!invoice.client?.email}
                       class="w-4 h-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" />
                <div>
                  <div class="text-sm font-medium text-slate-900">Email</div>
                  <div class="text-xs text-text-secondary">{invoice.client?.email || 'Cliente sin email'}</div>
                </div>
              </label>
              <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg border {invoice.client?.phone ? 'border-slate-200 hover:border-brand-300 cursor-pointer' : 'border-slate-100 bg-slate-50 opacity-50'} transition"
                     class:border-brand-300={sendChannels.includes('whatsapp')}>
                <input type="checkbox" checked={sendChannels.includes('whatsapp')}
                       on:change={() => toggleSendChannel('whatsapp')}
                       disabled={!invoice.client?.phone}
                       class="w-4 h-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" />
                <div>
                  <div class="text-sm font-medium text-slate-900">WhatsApp</div>
                  <div class="text-xs text-text-secondary">{invoice.client?.phone || 'Cliente sin teléfono'}</div>
                </div>
              </label>
            </div>
          </div>

          <!-- Options -->
          <div>
            <div class="label !mb-2">Opciones adicionales</div>
            <div class="space-y-2">
              <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer transition"
                     class:border-brand-300={sendPdf}>
                <input type="checkbox" bind:checked={sendPdf}
                       class="w-4 h-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" />
                <div>
                  <div class="text-sm font-medium text-slate-900">Adjuntar factura en PDF</div>
                  <div class="text-xs text-text-secondary">Incluye el PDF de la factura en el correo</div>
                </div>
              </label>
              <label class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-brand-300 cursor-pointer transition"
                     class:border-brand-300={sendPaymentLink}>
                <input type="checkbox" bind:checked={sendPaymentLink}
                       class="w-4 h-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500" />
                <div>
                  <div class="text-sm font-medium text-slate-900">Generar link de pago Wompi</div>
                  <div class="text-xs text-text-secondary">Crea un enlace de pago para que el cliente pague en línea</div>
                </div>
              </label>

              <!-- Manual: solo obtener el link para enviarlo uno mismo -->
              <div class="px-3 py-2.5 rounded-lg border border-slate-200">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-sm font-medium text-slate-900">Obtener link de pago (manual)</div>
                    <div class="text-xs text-text-secondary">Genera el enlace y cópialo para enviarlo tú mismo (ej. tu WhatsApp)</div>
                  </div>
                  <button type="button" class="btn-secondary text-xs whitespace-nowrap" on:click={getManualLink} disabled={manualLinkLoading}>
                    {#if manualLinkLoading}<Loader2 size={13} class="animate-spin" />{:else}<CreditCard size={13} />{/if}
                    {manualLinkLoading ? 'Generando…' : 'Generar link'}
                  </button>
                </div>
                {#if manualLink}
                  <div class="flex items-center gap-2 mt-2">
                    <input type="text" readonly value={manualLink}
                           class="input text-xs flex-1 font-mono bg-white"
                           on:focus={e => /** @type {HTMLInputElement} */ (e.currentTarget).select()} />
                    <button class="btn-secondary text-xs whitespace-nowrap" on:click={() => copyLink(manualLink)}>
                      {#if copied}<Check size={13} class="text-emerald-600" />{:else}<Copy size={13} />{/if}
                      {copied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                {/if}
                {#if manualLinkError}
                  <p class="text-[11px] text-red-600 mt-1.5">{manualLinkError}</p>
                {/if}
              </div>
            </div>
          </div>

          <!-- Results -->
          {#if sendResults}
            <div class="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {#each sendResults.results as r}
                <div class="flex items-center justify-between px-3 py-2 text-sm">
                  <div class="flex items-center gap-2">
                    {#if r.status === 'sent'}
                      <CheckCircle2 size={14} class="text-emerald-500" />
                    {:else}
                      <AlertCircle size={14} class="text-red-500" />
                    {/if}
                    <span class="capitalize">{r.channel} — {r.action === 'payment_link' ? 'Link de pago' : 'Envío'}</span>
                  </div>
                  <span class="text-xs {r.status === 'sent' ? 'text-emerald-600' : 'text-red-600'}">
                    {r.status === 'sent' ? 'Enviado' : r.error || 'Fallido'}
                  </span>
                </div>
              {/each}
            </div>

            {#if sendResults.paymentLinkUrl}
              <div class="rounded-lg border border-brand-200 bg-brand-50 p-3">
                <div class="text-xs font-medium text-brand-800 mb-1.5">Link de pago Wompi</div>
                <div class="flex items-center gap-2">
                  <input type="text" readonly value={sendResults.paymentLinkUrl}
                         class="input text-xs flex-1 font-mono bg-white"
                         on:focus={e => /** @type {HTMLInputElement} */ (e.currentTarget).select()} />
                  <button class="btn-secondary text-xs whitespace-nowrap" on:click={() => copyLink(sendResults.paymentLinkUrl)}>
                    {#if copied}
                      <Check size={13} class="text-emerald-600" />
                    {:else}
                      <Copy size={13} />
                    {/if}
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <p class="text-[11px] text-text-secondary mt-1.5">
                  Comparta este enlace con el cliente para que pueda pagar en línea con Wompi.
                </p>
              </div>
            {/if}
          {/if}

          {#if sendError}
            <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
              <AlertCircle size={14} /> {sendError}
            </div>
          {/if}
        </div>

        <!-- Footer actions -->
        <div class="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button class="btn-secondary text-xs" on:click={downloadPdf} disabled={downloading}>
            {#if downloading}<Loader2 size={13} class="animate-spin" />{:else}<Download size={13} />{/if}
            Descargar PDF
          </button>
          <div class="flex items-center gap-2">
            <button class="btn-secondary" on:click={closeSendModal} disabled={sendRunning}>Cerrar</button>
            {#if !sendResults}
              <button class="btn-primary" on:click={doSend} disabled={sendRunning || sendChannels.length === 0}>
                {#if sendRunning}<Loader2 size={14} class="animate-spin" />{:else}<Send size={14} />{/if}
                {sendRunning ? 'Enviando…' : 'Enviar'}
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

{/if}
