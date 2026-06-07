<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { api } from '$lib/api/client.js';
  import { invoicesApi } from '$lib/api/invoices.api.js';
  import {
    ArrowLeft, FileText, CreditCard, Download, Send, Loader2, Receipt,
    CheckCircle2, AlertCircle, Calendar, User, MapPin, Wifi, Image as ImageIcon,
    Upload, ImageUp, ExternalLink, Phone, Mail, Banknote, Eye, X
  } from 'lucide-svelte';

  // ── State ────────────────────────────────────────────────────────────
  let loading = true;
  let error   = '';
  let success = '';
  let invoice = null;

  // ── Action state ─────────────────────────────────────────────────────
  let downloading    = false;
  let sending        = false;
  let actionBusy     = false;
  let showPayModal   = false;
  let paySubmitting  = false;
  let payError       = '';
  let payAmount      = '';
  let payMethod      = 'CASH';
  let payDate        = '';
  let payNotes       = '';
  let payFile        = null;       // single evidence file (optional)
  let payFilePreview = null;       // object URL (image only) or null for PDFs
  let payFileError   = '';         // client-side validation message

  // ── Constants ────────────────────────────────────────────────────────
  const STATUS_PT = {
    DRAFT:'Borrador', PENDING:'Pendiente', PARTIAL:'Pago parcial',
    PAID:'Pagada', OVERDUE:'Vencida', CANCELLED:'Cancelada', REFUNDED:'Reembolsada'
  };
  const STATUS_CLS = {
    DRAFT:    'bg-slate-100 text-slate-600',
    PENDING:  'bg-amber-100 text-amber-700',
    PARTIAL:  'bg-blue-100 text-blue-700',
    PAID:     'bg-emerald-100 text-emerald-700',
    OVERDUE:  'bg-red-100 text-red-700',
    CANCELLED:'bg-slate-100 text-slate-500',
    REFUNDED: 'bg-violet-100 text-violet-700'
  };
  const METHOD_PT = {
    CASH:'Efectivo', BANK_TRANSFER:'Transferencia',
    WOMPI:'Wompi', NEQUI:'Nequi', BANCOLOMBIA:'Bancolombia',
    CREDIT_CARD:'Tarjeta de crédito', OTHER:'Otro'
  };
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
  function fmtMoney(c) {
    if (c == null) return '—';
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(c / 100);
  }
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s)<>"']+/gi);
    return matches ? [...new Set(matches)] : [];
  }
  function periodLabel(inv) {
    if (!inv?.periodYear || !inv?.periodMonth) return null;
    return `${MONTHS_ES[inv.periodMonth - 1]} ${inv.periodYear}`;
  }
  function daysUntil(date) {
    const d = (new Date(date).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86_400_000;
    return Math.round(d);
  }
  function showToast(kind, msg) {
    if (kind === 'error') error = msg; else success = msg;
    setTimeout(() => { error = ''; success = ''; }, 4000);
  }
  function isImage(p) {
    return (p?.mimeType || '').startsWith('image/');
  }

  // ── Derived ──────────────────────────────────────────────────────────
  $: paid     = invoice ? (invoice.total - invoice.balanceDue) : 0;
  $: overdue  = invoice && invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' &&
                invoice.dueDate && new Date(invoice.dueDate) < new Date();
  $: payable  = invoice && ['PENDING','PARTIAL','OVERDUE'].includes(invoice.status);

  // ── Load ─────────────────────────────────────────────────────────────
  onMount(reload);

  async function reload() {
    loading = true;
    error = '';
    try {
      invoice = await invoicesApi.getOne($page.params.id);
    } catch (e) {
      error = e.message || 'No se pudo cargar la factura';
    } finally {
      loading = false;
    }
  }

  // ── PDF download (auth-protected, so manual blob fetch) ───────────────
  async function downloadPdf() {
    if (!browser || !invoice) return;
    downloading = true;
    try {
      const token = localStorage.getItem('isp_token');
      const res = await fetch(`/api/v1/invoices/${invoice.id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast('error', e.message || 'No se pudo descargar el PDF');
    } finally {
      downloading = false;
    }
  }

  // ── Send invoice (email / whatsapp) ──────────────────────────────────
  async function sendInvoice(channels) {
    sending = true;
    try {
      await invoicesApi.send(invoice.id, channels);
      showToast('success', `Factura enviada por ${channels.join(' y ')}`);
    } catch (e) {
      showToast('error', e.message || 'Envío fallido');
    } finally {
      sending = false;
    }
  }

  // ── Mark paid manually (admin shortcut) ──────────────────────────────
  async function markAsPaid() {
    if (!confirm('Marcar la factura como pagada sin registrar un pago detallado. ¿Continuar?')) return;
    actionBusy = true;
    try {
      await invoicesApi.markPaid(invoice.id);
      showToast('success', 'Factura marcada como pagada');
      await reload();
    } catch (e) {
      showToast('error', e.message || 'No se pudo marcar como pagada');
    } finally {
      actionBusy = false;
    }
  }

  // ── Registrar pago (modal local — no CashierWizard, single-invoice) ─
  function openPayModal() {
    payError = '';
    payAmount = String(Math.round((invoice?.balanceDue || invoice?.total || 0) / 100));
    payMethod = 'CASH';
    payDate   = new Date().toISOString().slice(0,10);
    payNotes  = '';
    payFile   = null;
    payFilePreview = null;
    payFileError   = '';
    showPayModal = true;
  }
  function closePayModal() {
    if (paySubmitting) return;
    if (payFilePreview && payFilePreview.startsWith('blob:')) URL.revokeObjectURL(payFilePreview);
    payFilePreview = null;
    showPayModal = false;
  }

  // Two entry points (file picker + mobile camera) write through this
  // single handler so validation + preview stay consistent.
  const ACCEPTED_EVIDENCE_MIME = ['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
  const MAX_EVIDENCE_BYTES     = 8 * 1024 * 1024;   // 8 MB
  function onPayFile(e) {
    payFileError = '';
    const file = e.target?.files?.[0] || null;
    if (!file) { payFile = null; payFilePreview = null; return; }
    if (!ACCEPTED_EVIDENCE_MIME.includes(file.type)) {
      payFileError = 'Tipo de archivo no permitido. Usa JPG / PNG / WebP / HEIC / PDF.';
      e.target.value = ''; return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      payFileError = `Archivo muy grande (${(file.size/1024/1024).toFixed(1)} MB). Máximo 8 MB.`;
      e.target.value = ''; return;
    }
    payFile = file;
    if (payFilePreview && payFilePreview.startsWith('blob:')) URL.revokeObjectURL(payFilePreview);
    payFilePreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  }
  function clearPayFile() {
    if (payFilePreview && payFilePreview.startsWith('blob:')) URL.revokeObjectURL(payFilePreview);
    payFile = null;
    payFilePreview = null;
    payFileError = '';
  }

  async function submitPayment() {
    payError = '';
    const amountCents = Math.round(Number(payAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      payError = 'Monto inválido';
      return;
    }
    paySubmitting = true;
    try {
      // 1. Create the payment via bulk-payment so we get paymentDate support.
      const res = await api.post('/payments/bulk-payment', {
        invoiceIds: [invoice.id],
        amount: amountCents,
        paymentMethod: payMethod,
        notes: payNotes || undefined,
        paymentDate: payDate ? new Date(payDate).toISOString() : undefined
      });
      // The bulk endpoint returns either { payments: [...] } or the first
      // payment depending on shape. Pull the first payment id we can find.
      const paymentId =
        res?.payments?.[0]?.id ||
        res?.payment?.id        ||
        res?.id                 ||
        null;

      // 2. Optional evidence file upload.
      if (payFile && paymentId) {
        const fd = new FormData();
        fd.append('file', payFile);
        const token = localStorage.getItem('isp_token');
        const upRes = await fetch(`/api/v1/payments/${paymentId}/evidence`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd
        });
        if (!upRes.ok) {
          // Not fatal — payment is already created. Surface a warning.
          const txt = await upRes.text().catch(() => '');
          showToast('error', `Pago registrado, pero el comprobante no se pudo adjuntar: ${txt.slice(0,120)}`);
        }
      }

      showToast('success', 'Pago registrado correctamente');
      showPayModal = false;
      await reload();
    } catch (e) {
      payError = e.message || 'No se pudo registrar el pago';
    } finally {
      paySubmitting = false;
    }
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
      <button class="btn-secondary" on:click={downloadPdf} disabled={downloading}>
        {#if downloading}<Loader2 size={15} class="animate-spin" />{:else}<Download size={15} />{/if}
        Descargar PDF
      </button>
      <button class="btn-secondary" on:click={() => sendInvoice(['email'])} disabled={sending || !invoice.client?.email}
              title={invoice.client?.email ? 'Reenviar por email' : 'El cliente no tiene email'}>
        {#if sending}<Loader2 size={15} class="animate-spin" />{:else}<Send size={15} />{/if}
        Enviar
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

                {#if p.evidencePhotos?.length > 0}
                  <div class="mt-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {#each p.evidencePhotos as ph}
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

  <!-- ── Modal: Registrar pago ─────────────────────────────────── -->
  {#if showPayModal}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
         on:click|self={closePayModal}>
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div class="flex items-center gap-2">
            <CreditCard size={16} class="text-slate-600" />
            <h3 class="font-semibold text-slate-900">Registrar pago</h3>
          </div>
          <button class="btn-icon" on:click={closePayModal} disabled={paySubmitting}>
            <X size={14} />
          </button>
        </div>

        <div class="p-5 space-y-4">
          <div class="bg-slate-50 rounded-lg p-3 text-sm">
            Factura <span class="font-mono">{invoice.invoiceNumber}</span> · saldo pendiente
            <span class="font-mono font-semibold">{fmtMoney(invoice.balanceDue || invoice.total)}</span>
          </div>

          <div>
            <label for="pay-amount" class="label">Monto a pagar (COP)</label>
            <input id="pay-amount" type="number" min="1" class="input" bind:value={payAmount} />
          </div>

          <div>
            <label for="pay-method" class="label">Método</label>
            <select id="pay-method" class="select" bind:value={payMethod}>
              <option value="CASH">Efectivo</option>
              <option value="BANK_TRANSFER">Transferencia bancaria</option>
              <option value="NEQUI">Nequi</option>
              <option value="BANCOLOMBIA">Bancolombia</option>
              <option value="WOMPI">Wompi</option>
            </select>
          </div>

          <div>
            <label for="pay-date" class="label">Fecha de pago</label>
            <input id="pay-date" type="date" class="input" bind:value={payDate} />
          </div>

          <div>
            <label for="pay-notes" class="label">Notas (opcional)</label>
            <input id="pay-notes" type="text" class="input" bind:value={payNotes}
                   placeholder="Referencia, banco, observación…" />
            <p class="text-xs text-text-muted mt-1">Si pegas una URL aquí, aparecerá como botón "Ver recibo".</p>
          </div>

          <div>
            <div class="label flex items-center gap-1.5 !mb-2">
              <Upload size={13} /> Comprobante de pago
              <span class="text-text-muted font-normal">(opcional)</span>
            </div>

            {#if payFilePreview}
              <!-- Image preview with replace / remove -->
              <div class="relative rounded-lg border border-slate-200 overflow-hidden">
                <img src={payFilePreview} alt="Vista previa del comprobante"
                     class="w-full max-h-56 object-contain bg-slate-50" />
                <button type="button" on:click={clearPayFile}
                        title="Quitar"
                        class="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white shadow-md border border-slate-200
                               flex items-center justify-center hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition">
                  <X size={14} />
                </button>
              </div>
              <div class="text-xs text-text-muted mt-1 flex items-center justify-between">
                <span class="truncate">{payFile?.name}</span>
                <span class="tabular-nums">{(payFile?.size / 1024).toFixed(1)} KB</span>
              </div>
            {:else if payFile}
              <!-- Non-image (PDF) — no preview, just file chip -->
              <div class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
                <FileText size={16} class="text-slate-500 flex-shrink-0" />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium text-text-primary truncate">{payFile.name}</div>
                  <div class="text-[11px] text-text-muted tabular-nums">{(payFile.size / 1024).toFixed(1)} KB</div>
                </div>
                <button type="button" on:click={clearPayFile} class="btn-icon">
                  <X size={14} />
                </button>
              </div>
            {:else}
              <!-- Two-button picker — camera (mobile) + file (any device) -->
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg border border-slate-200
                              hover:border-brand-300 hover:bg-brand-50/30 cursor-pointer transition-colors text-xs font-medium text-text-primary">
                  <ImageUp size={14} class="text-brand-600" />
                  <span>Tomar foto</span>
                  <input type="file" accept="image/*" capture="environment"
                         on:change={onPayFile} class="hidden" />
                </label>
                <label class="flex items-center justify-center gap-1.5 px-3 py-3 rounded-lg border border-slate-200
                              hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium text-text-primary">
                  <Upload size={14} class="text-slate-500" />
                  <span>Subir archivo</span>
                  <input type="file" accept="image/*,application/pdf"
                         on:change={onPayFile} class="hidden" />
                </label>
              </div>
              <p class="text-[11px] text-text-muted mt-1.5">
                Imagen (JPG / PNG / WebP / HEIC) o PDF. Máx. 8 MB.
              </p>
            {/if}

            {#if payFileError}
              <div class="mt-1.5 text-xs text-red-600 flex items-center gap-1.5">
                <AlertCircle size={12} /> {payFileError}
              </div>
            {/if}
          </div>

          {#if payError}
            <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
              <AlertCircle size={14} /> {payError}
            </div>
          {/if}
        </div>

        <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button class="btn-secondary" on:click={closePayModal} disabled={paySubmitting}>Cancelar</button>
          <button class="btn-primary" on:click={submitPayment} disabled={paySubmitting}>
            {#if paySubmitting}<Loader2 size={14} class="animate-spin" />{:else}<CreditCard size={14} />{/if}
            Registrar pago
          </button>
        </div>
      </div>
    </div>
  {/if}

{/if}
