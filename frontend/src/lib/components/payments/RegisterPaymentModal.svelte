<script>
  /**
   * RegisterPaymentModal — modal único de "Registrar pago" para el admin.
   *
   * Reemplaza al antiguo CashierWizard (grilla de meses) y a los modales
   * locales de /clients y /invoices/[id]. El flujo normal es pagar facturas
   * YA generadas (el cron las crea cada mes); generar la factura de un mes
   * suelto es una acción secundaria colapsada ("avanzado").
   *
   * Props:
   *   client            { id, name }      — cliente al que se le registra el pago
   *   invoices          Invoice[]         — facturas del cliente (se filtran las pagables)
   *   preselectInvoiceId string|null      — si viene, arranca con esa factura marcada
   *
   * Eventos: `done` (pago registrado, refrescar), `close` (cancelar).
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import { billingApi } from '$lib/api/billing.api.js';
  import {
    X, CreditCard, Loader2, FileText, Camera, Upload, AlertCircle,
    ChevronDown, Plus, Check
  } from 'lucide-svelte';

  export let client = null;
  export let invoices = [];
  export let preselectInvoiceId = null;

  const dispatch = createEventDispatcher();

  const PAYABLE = ['PENDING', 'OVERDUE', 'PARTIAL'];

  let selected = [];        // ids de facturas marcadas
  let amountTouched = false; // si el operador editó el monto a mano
  let payAmount = '';
  let payMethod = 'CASH';
  let payNotes = '';
  let payDate = new Date().toISOString().slice(0, 10);
  let saving = false;
  let errorText = '';

  // Evidencia opcional (misma UX que el modal anterior)
  let payFile = null;
  let payFilePreview = null;
  let payFileError = '';
  const EVIDENCE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
  const EVIDENCE_BYTES = 8 * 1024 * 1024;

  // Acción secundaria: generar factura de un mes suelto
  let genOpen = false;
  let genYear = new Date().getFullYear();
  let monthsData = null;
  let monthsLoading = false;
  let genBusyMonth = null;

  const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  $: payable = (invoices || []).filter(i => PAYABLE.includes(i.status));

  function balanceOf(inv) {
    return inv.balanceDue > 0 ? inv.balanceDue : (inv.amount ?? inv.total ?? 0);
  }

  $: selectedInvoices = payable.filter(i => selected.includes(i.id));
  $: totalSelected = selectedInvoices.reduce((sum, i) => sum + balanceOf(i), 0);

  // Sincroniza el monto sugerido con la selección, salvo que el operador lo
  // haya tocado manualmente (pagos parciales).
  $: if (!amountTouched) payAmount = totalSelected > 0 ? String(Math.round(totalSelected / 100)) : '';

  onMount(() => {
    if (preselectInvoiceId && payable.some(i => i.id === preselectInvoiceId)) {
      selected = [preselectInvoiceId];
    } else {
      selected = payable.map(i => i.id);
    }
  });

  function toggle(id) {
    selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
  }

  function fmtMoney(cents) {
    if (cents == null) return '$0';
    return `$${(cents / 100).toLocaleString('es-CO')}`;
  }

  function periodLabel(inv) {
    if (inv.periodMonth) return `${MONTHS_ES[inv.periodMonth - 1]} ${inv.periodYear || ''}`.trim();
    if (inv.dueDate) return new Date(inv.dueDate).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
    return '';
  }

  const STATUS_BADGE = {
    OVERDUE: 'bg-red-50 text-red-700 ring-1 ring-red-100',
    PENDING: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
    PARTIAL: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
  };
  const STATUS_LABEL = { OVERDUE: 'Vencida', PENDING: 'Pendiente', PARTIAL: 'Parcial' };

  function onFile(e) {
    payFileError = '';
    const file = e.target?.files?.[0] || null;
    if (!file) { clearFile(); return; }
    if (!EVIDENCE_MIME.includes(file.type)) {
      payFileError = 'Tipo no permitido. Usa JPG / PNG / WebP / HEIC / PDF.';
      e.target.value = ''; return;
    }
    if (file.size > EVIDENCE_BYTES) {
      payFileError = `Archivo muy grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 8 MB.`;
      e.target.value = ''; return;
    }
    payFile = file;
    if (payFilePreview?.startsWith('blob:')) URL.revokeObjectURL(payFilePreview);
    payFilePreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
  }
  function clearFile() {
    if (payFilePreview?.startsWith('blob:')) URL.revokeObjectURL(payFilePreview);
    payFile = null; payFilePreview = null; payFileError = '';
  }

  async function submit() {
    errorText = '';
    if (selected.length === 0) { errorText = 'Selecciona al menos una factura'; return; }
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { errorText = 'Ingresa un monto válido'; return; }
    saving = true;
    try {
      const res = await billingApi.bulkPayment({
        invoiceIds: selected,
        amount: amt,
        paymentMethod: payMethod,
        notes: payNotes || undefined,
        paymentDate: payDate || undefined,
      });
      // Subida de evidencia best-effort: si falla no revierte el pago.
      const paymentId = res?.payments?.[0]?.id;
      if (payFile && paymentId) {
        try {
          const up = await billingApi.uploadEvidence(paymentId, payFile);
          if (!up.ok) console.warn('Evidence upload failed:', up.status);
        } catch (e) { console.warn('Evidence upload failed:', e?.message); }
      }
      dispatch('done');
    } catch (e) {
      errorText = e.message || 'Error al registrar pago';
    } finally {
      saving = false;
    }
  }

  // ── Generar factura de un mes (acción secundaria) ──
  async function toggleGen() {
    genOpen = !genOpen;
    if (genOpen && !monthsData) await loadMonths();
  }
  async function loadMonths() {
    monthsLoading = true;
    errorText = '';
    try {
      monthsData = await billingApi.getMonths(client.id, genYear);
    } catch (e) {
      errorText = e.message || 'No se pudieron cargar los meses';
    } finally {
      monthsLoading = false;
    }
  }
  async function generateMonth(m) {
    if (m.invoice) return; // ya tiene factura
    genBusyMonth = m.month;
    errorText = '';
    try {
      const res = await billingApi.generateInvoices(client.id, [{ year: genYear, month: m.month }]);
      const created = res?.invoices?.[0]?.invoice;
      if (created) {
        // La inyectamos en la lista y la marcamos para cobrar de una vez.
        invoices = [...invoices, created];
        selected = [...selected, created.id];
      }
      await loadMonths();
    } catch (e) {
      errorText = e.message || 'No se pudo generar la factura';
    } finally {
      genBusyMonth = null;
    }
  }

  function close() { dispatch('close'); }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50" on:click|self={close}>
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
      <h2 class="text-lg font-semibold text-slate-900">
        Registrar pago{#if client?.name} — <span class="text-slate-600 font-medium">{client.name}</span>{/if}
      </h2>
      <button on:click={close} class="text-slate-400 hover:text-slate-600 p-1"><X size={20} /></button>
    </div>

    <div class="p-5 space-y-4">
      {#if errorText}
        <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{errorText}</div>
      {/if}

      <!-- Facturas pendientes -->
      {#if payable.length === 0}
        <div class="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-4 py-3 text-sm">
          Este cliente no tiene facturas pendientes. Usa <strong>Generar factura</strong> para crear una.
        </div>
      {:else}
        <div>
          <div class="label !mb-2">Facturas pendientes</div>
          <div class="space-y-1.5">
            {#each payable as inv (inv.id)}
              <label class="flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors
                            {selected.includes(inv.id)
                              ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-200'
                              : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'}">
                <input type="checkbox" checked={selected.includes(inv.id)}
                       on:change={() => toggle(inv.id)}
                       class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs text-slate-600">#{inv.invoiceNumber || inv.number || inv.id?.slice(-6)}</span>
                    <span class="badge {STATUS_BADGE[inv.status] || 'bg-slate-100 text-slate-600'}">
                      {STATUS_LABEL[inv.status] || inv.status}
                    </span>
                  </div>
                  <div class="text-xs text-slate-500 mt-0.5">
                    {periodLabel(inv)}{#if inv.dueDate} · vence {new Date(inv.dueDate).toLocaleDateString('es-CO')}{/if}
                  </div>
                </div>
                <div class="text-sm font-mono font-medium text-slate-900 tabular-nums shrink-0">{fmtMoney(balanceOf(inv))}</div>
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Monto / método / fecha / nota -->
      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2">
          <label for="rp-amount" class="label">Monto a registrar (COP)</label>
          <input id="rp-amount" type="number" min="1" class="input" placeholder="0"
                 bind:value={payAmount} on:input={() => amountTouched = true} />
          {#if totalSelected > 0}
            <p class="text-xs text-slate-500 mt-1">
              Saldo seleccionado: <strong class="text-slate-700">{fmtMoney(totalSelected)}</strong>
              {#if amountTouched && Number(payAmount) * 100 !== totalSelected}
                <button type="button" class="text-brand-700 hover:underline ml-1"
                        on:click={() => { amountTouched = false; }}>usar total</button>
              {/if}
            </p>
          {/if}
        </div>
        <div>
          <label for="rp-method" class="label">Método</label>
          <select id="rp-method" class="select" bind:value={payMethod}>
            <option value="CASH">Efectivo</option>
            <option value="BANK_TRANSFER">Transferencia bancaria</option>
            <option value="NEQUI">Nequi</option>
            <option value="BANCOLOMBIA">Bancolombia</option>
            <option value="WOMPI">Wompi</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>
        <div>
          <label for="rp-date" class="label">Fecha de pago</label>
          <input id="rp-date" type="date" class="input" bind:value={payDate} />
        </div>
        <div class="col-span-2">
          <label for="rp-notes" class="label">Referencia / nota (opcional)</label>
          <input id="rp-notes" type="text" class="input" bind:value={payNotes}
                 placeholder="N° de consignación, referencia…" />
        </div>
      </div>

      <!-- Comprobante opcional -->
      <div>
        <div class="label flex items-center gap-1.5 !mb-2">
          <FileText size={13} /> Comprobante <span class="text-text-muted font-normal">(opcional)</span>
        </div>
        {#if payFilePreview}
          <div class="relative rounded-lg border border-slate-200 overflow-hidden">
            <img src={payFilePreview} alt="Vista previa del comprobante" class="w-full max-h-52 object-contain bg-slate-50" />
            <button type="button" on:click={clearFile} title="Quitar"
                    class="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-white shadow-md border border-slate-200
                           flex items-center justify-center hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition">
              <X size={14} />
            </button>
          </div>
        {:else if payFile}
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
            <FileText size={16} class="text-slate-500 flex-shrink-0" />
            <div class="flex-1 min-w-0">
              <div class="text-xs font-medium text-text-primary truncate">{payFile.name}</div>
              <div class="text-[11px] text-text-muted tabular-nums">{(payFile.size / 1024).toFixed(1)} KB</div>
            </div>
            <button type="button" on:click={clearFile} class="btn-icon"><X size={14} /></button>
          </div>
        {:else}
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200
                          hover:border-brand-300 hover:bg-brand-50/30 cursor-pointer transition-colors text-xs font-medium text-text-primary">
              <Camera size={14} class="text-brand-600" /> <span>Tomar foto</span>
              <input type="file" accept="image/*" capture="environment" on:change={onFile} class="hidden" />
            </label>
            <label class="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200
                          hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors text-xs font-medium text-text-primary">
              <Upload size={14} class="text-slate-500" /> <span>Subir archivo</span>
              <input type="file" accept="image/*,application/pdf" on:change={onFile} class="hidden" />
            </label>
          </div>
        {/if}
        {#if payFileError}
          <div class="mt-1.5 text-xs text-red-600 flex items-center gap-1.5"><AlertCircle size={12} /> {payFileError}</div>
        {/if}
      </div>

      <!-- Acción secundaria: generar factura de un mes -->
      <div class="border-t border-slate-100 pt-3">
        <button type="button" on:click={toggleGen}
                class="inline-flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 font-medium">
          <ChevronDown size={15} class="transition-transform {genOpen ? 'rotate-180' : ''}" />
          Generar factura de otro mes <span class="text-text-muted font-normal">(avanzado)</span>
        </button>

        {#if genOpen}
          <div class="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div class="flex items-center gap-2 mb-2">
              <button type="button" on:click={() => { genYear--; loadMonths(); }}
                      class="px-2 py-0.5 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50">&larr;</button>
              <span class="text-sm font-semibold text-slate-700 tabular-nums">{genYear}</span>
              <button type="button" on:click={() => { genYear++; loadMonths(); }}
                      class="px-2 py-0.5 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50">&rarr;</button>
            </div>
            {#if monthsLoading}
              <div class="flex justify-center py-4"><Loader2 size={18} class="animate-spin text-brand-600" /></div>
            {:else if monthsData}
              <div class="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {#each monthsData.months || [] as m}
                  {@const has = !!m.invoice}
                  <button type="button" disabled={has || genBusyMonth === m.month}
                          on:click={() => generateMonth(m)}
                          class="flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-xs transition-colors
                                 {has ? 'border-slate-200 bg-white text-slate-400 cursor-default'
                                      : 'border-slate-200 bg-white hover:border-brand-400 hover:bg-brand-50 text-slate-700'}">
                    <span class="font-medium">{MONTHS_ES[m.month - 1]}</span>
                    {#if genBusyMonth === m.month}
                      <Loader2 size={12} class="animate-spin text-brand-600" />
                    {:else if has}
                      <Check size={12} class="text-emerald-600" />
                    {:else}
                      <Plus size={12} class="text-brand-600" />
                    {/if}
                  </button>
                {/each}
              </div>
              <p class="text-[11px] text-text-muted mt-2">
                Los meses con ✓ ya tienen factura. Al generar una, se agrega arriba lista para cobrar.
              </p>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between gap-3 px-5 py-4 border-t border-slate-200 bg-slate-50 sticky bottom-0">
      <div class="text-sm text-slate-600">
        {selected.length} factura{selected.length === 1 ? '' : 's'} · <strong class="text-slate-900">{fmtMoney(totalSelected)}</strong>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" on:click={close} class="btn-secondary" disabled={saving}>Cancelar</button>
        <button type="button" on:click={submit} class="btn-primary" disabled={saving || selected.length === 0}>
          {#if saving}
            <Loader2 size={15} class="animate-spin" /> Registrando…
          {:else}
            <CreditCard size={15} /> Registrar pago
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>
