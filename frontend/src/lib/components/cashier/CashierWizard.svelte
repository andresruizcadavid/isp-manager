<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { billingApi } from '$lib/api/billing.api.js';
  import {
    CreditCard, X, Loader2, Check, ChevronRight, Camera, ImageUp,
    Calendar, FileText, DollarSign, ArrowLeft, Wifi
  } from 'lucide-svelte';

  export let client = null;

  const dispatch = createEventDispatcher();

  let step = 1;
  let saving = false;
  let errorText = '';
  let successText = '';

  let year = new Date().getFullYear();
  let monthsData = null;
  let monthsLoading = false;
  let selectedMonths = [];

  let generationResult = null;
  let generating = false;

  let payMethod = 'CASH';
  let payAmount = '';
  let payNotes = '';
  let payDate = new Date().toISOString().slice(0, 10);

  let evidenceFile = null;
  let evidencePreview = null;
  let evidenceDescription = '';
  let evidenceUploaded = false;
  let uploadedPaymentId = null;

  onMount(() => {
    monthsLoading = true;
    loadMonths();
  });

  let monthlyFee = 0;
  $: monthlyFee = monthsData?.client?.monthlyFee || client?.plan?.monthlyPrice || 0;

  $: hasPlan = monthlyFee > 0;
  $: noPlanReason = !monthsData?.client?.planName ? 'no tiene un plan asignado' : 'el plan no tiene precio configurado';

  $: selectedDetail = monthsData?.months?.filter(m => selectedMonths.includes(m.month)) || [];

  $: totalSelected = selectedDetail.reduce((sum, m) => {
    return sum + (m.invoice ? (m.invoice.balanceDue || m.invoice.total) : m.amount);
  }, 0);
  $: totalDueText = `$${(totalSelected / 100).toLocaleString('es-CO')}`;

  async function loadMonths() {
    monthsLoading = true;
    errorText = '';
    try {
      const res = await billingApi.getMonths(client.id, year);
      monthsData = res;
    } catch (e) {
      errorText = e.message || 'Error al cargar meses';
    } finally {
      monthsLoading = false;
    }
  }

  function toggleMonth(m) {
    if (m.status === 'paid' || m.status === 'cancelled') return;
    if (selectedMonths.includes(m.month)) {
      selectedMonths = selectedMonths.filter(x => x !== m.month);
    } else {
      selectedMonths = [...selectedMonths, m.month].sort();
    }
  }

  async function confirmMonths() {
    if (selectedMonths.length === 0) { errorText = 'Selecciona al menos un mes'; return; }
    generating = true;
    errorText = '';
    try {
      const res = await billingApi.generateInvoices(client.id, selectedMonths.map(m => ({ year, month: m })));
      generationResult = res;
      await loadMonths();
      step = 2;
    } catch (e) {
      errorText = e.message || 'Error al generar facturas';
    } finally {
      generating = false;
    }
  }

  async function submitPayment() {
    if (!payAmount || Number(payAmount) <= 0) { errorText = 'Ingresa un monto válido'; return; }
    if (!generationResult?.invoices?.length) { errorText = 'No hay facturas para pagar'; return; }
    saving = true;
    errorText = '';
    try {
      const invoiceIds = generationResult.invoices.map(r => r.invoice.id);
      const res = await billingApi.bulkPayment({
        invoiceIds,
        amount: Number(payAmount),
        paymentMethod: payMethod,
        notes: payNotes || undefined,
        paymentDate: payDate || undefined
      });
      uploadedPaymentId = res?.payments?.[0]?.id;
      step = 4;
    } catch (e) {
      errorText = e.message || 'Error al registrar pago';
    } finally {
      saving = false;
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    evidenceFile = file;
    const reader = new FileReader();
    reader.onload = (ev) => { evidencePreview = ev.target.result; };
    reader.readAsDataURL(file);
  }

  async function uploadEvidence() {
    if (!evidenceFile || !uploadedPaymentId) return;
    saving = true;
    errorText = '';
    try {
      const res = await billingApi.uploadEvidence(uploadedPaymentId, evidenceFile, evidenceDescription);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Error al subir comprobante');
      }
      evidenceUploaded = true;
    } catch (e) {
      errorText = e.message || 'Error al subir comprobante';
    } finally {
      saving = false;
    }
  }

  function skipEvidence() { evidenceUploaded = true; }

  function finish() { dispatch('done'); }

  function reset() {
    step = 1; selectedMonths = []; generationResult = null;
    payAmount = ''; payMethod = 'CASH'; payNotes = ''; payDate = new Date().toISOString().slice(0, 10);
    evidenceFile = null; evidencePreview = null; evidenceDescription = '';
    evidenceUploaded = false; uploadedPaymentId = null; errorText = ''; successText = '';
  }

  function resetAndClose() { reset(); dispatch('close'); }

  function fmtMoney(cents) {
    if (cents == null) return '$0';
    return `$${(cents / 100).toLocaleString('es-CO')}`;
  }

  const statusBadge = {
    no_invoice: { cls: 'bg-slate-100 text-slate-500', label: 'Disponible' },
    pending: { cls: 'bg-amber-50 text-amber-700 border border-amber-200', label: 'Pendiente' },
    paid: { cls: 'bg-green-50 text-green-700 border border-green-200', label: 'Pagado' },
    overdue: { cls: 'bg-red-50 text-red-700 border border-red-200', label: 'Vencido' },
    cancelled: { cls: 'bg-slate-100 text-slate-400', label: 'Cancelado' },
  };
</script>

<div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4" on:click|self={resetAndClose}>
  <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
      <div class="flex items-center gap-2">
        {#if step > 1}
          <button on:click={() => { step--; errorText = ''; }} class="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <ArrowLeft size={18} />
          </button>
        {/if}
        <h3 class="text-lg font-semibold text-slate-900">
          {#if step === 1}Cobrar — Seleccionar meses
          {:else if step === 2}Confirmar facturas
          {:else if step === 3}Registrar pago
          {:else}Comprobante{/if}
        </h3>
      </div>
      <button class="text-slate-400 hover:text-slate-600 p-1" on:click={resetAndClose}><X size={20} /></button>
    </div>

    {#if errorText}
      <div class="mx-5 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{errorText}</div>
    {/if}

    <div class="p-5 space-y-5">

      <!-- Step 1: Month Selection -->
      {#if step === 1}
        {#if monthsLoading}
          <div class="flex justify-center py-10"><Loader2 size={24} class="animate-spin text-sky-600" /></div>
        {:else if monthsData}
          <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
            <div class="text-xs text-slate-500 uppercase tracking-wider font-semibold">Cliente</div>
            <div class="text-sm font-medium text-slate-900">{monthsData.client?.name || client?.name}</div>
            <div class="text-xs text-slate-500 mt-1">
              {#if hasPlan}
                <span class="font-medium text-slate-700">{monthsData.client?.planName}</span>
                · {fmtMoney(monthlyFee)}/mes
              {:else}
                <span class="text-red-600 font-medium">Sin plan · {fmtMoney(monthlyFee)}/mes</span>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2 mt-2 text-xs">
              <span class="text-green-600">● {monthsData.totals?.paid || 0} pagados</span>
              <span class="text-amber-600">● {monthsData.totals?.pending || 0} pendientes</span>
              <span class="text-slate-400">● {monthsData.totals?.noInvoice || 0} disponibles</span>
            </div>
          </div>

          {#if !hasPlan}
            <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
              <span class="font-medium">⚠️</span>
              <span>Este cliente {noPlanReason}. Asigna un plan antes de generar factura.</span>
            </div>
          {/if}

          <div class="flex items-center gap-2">
            <button on:click={() => { year--; loadMonths(); }}
                    class="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50">&larr;</button>
            <span class="text-sm font-semibold text-slate-700">{year}</span>
            <button on:click={() => { year++; loadMonths(); }}
                    class="px-2 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50">&rarr;</button>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {#each monthsData.months || [] as m}
              {@const badge = statusBadge[m.status] || statusBadge.no_invoice}
              {#if m.status === 'paid' || m.status === 'cancelled'}
                <div class="rounded-xl border border-slate-200 p-3 opacity-60 cursor-not-allowed">
                  <div class="text-sm font-semibold text-slate-900">{m.label}</div>
                  <span class="inline-block text-xs px-2 py-0.5 rounded-full mt-1 {badge.cls}">{badge.label}</span>
                </div>
              {:else}
                <button on:click={() => toggleMonth(m)}
                        class="rounded-xl border p-3 text-left transition-all duration-150
                               {selectedMonths.includes(m.month)
                                 ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200'
                                 : 'border-slate-200 hover:border-sky-300 hover:bg-sky-50/50'}">
                  <div class="flex items-center justify-between">
                    <div class="text-sm font-semibold text-slate-900">{m.label}</div>
                    {#if selectedMonths.includes(m.month)}
                      <Check size={14} class="text-sky-600" />
                    {/if}
                  </div>
                  <span class="inline-block text-xs px-2 py-0.5 rounded-full mt-1 {badge.cls}">{badge.label}</span>
                  <div class="text-xs text-slate-500 mt-1">{fmtMoney(m.amount)}</div>
                </button>
              {/if}
            {/each}
          </div>

          <div class="flex items-center justify-between pt-2">
            <div class="text-sm text-slate-600">
              {selectedMonths.length} mes(es) · <strong class="text-slate-900">{totalDueText}</strong>
            </div>
            <button on:click={confirmMonths} disabled={generating || selectedMonths.length === 0 || !hasPlan} class="btn-primary">
              {#if generating}
                <Loader2 size={15} class="animate-spin" /> Generando...
              {:else}
                Continuar <ChevronRight size={15} />
              {/if}
            </button>
          </div>
        {:else if errorText}
          <div class="py-6 text-center space-y-3">
            <p class="text-sm text-red-600">{errorText}</p>
            <button on:click={loadMonths} class="btn-primary">Reintentar</button>
          </div>
        {:else}
          <div class="py-6 text-center">
            <p class="text-sm text-slate-500">No hay datos disponibles</p>
          </div>
        {/if}
      {/if}

      <!-- Step 2: Invoice Confirmation -->
      {#if step === 2 && generationResult}
        <div class="bg-sky-50 border border-sky-200 rounded-lg p-3 text-sm text-sky-800">
          <Check size={16} class="inline mr-1" />
          {generationResult.totalCreated} creada(s) · {generationResult.totalReused} reutilizada(s)
        </div>

        <div class="space-y-2">
          {#each generationResult.invoices as item}
            <div class="flex items-center justify-between bg-slate-50 rounded-lg p-3 border border-slate-100">
              <div>
                <div class="text-sm font-medium text-slate-900">#{item.invoice.number}</div>
                <div class="text-xs text-slate-500">
                  {#if item.action === 'created'}<span class="text-green-600">Nueva</span>
                  {:else}<span class="text-amber-600">Existente</span>{/if}
                  · {fmtMoney(item.invoice.total)}
                </div>
              </div>
              <span class="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">{item.invoice.status}</span>
            </div>
          {/each}
        </div>

        <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
          <div class="flex justify-between text-sm">
            <span class="text-slate-600">Total a cobrar</span>
            <span class="font-bold text-slate-900">{fmtMoney(generationResult.totalAmount)}</span>
          </div>
        </div>

        <div class="flex justify-end">
          <button on:click={() => step = 3} class="btn-primary">
            Ir a pago <ChevronRight size={15} />
          </button>
        </div>
      {/if}

      <!-- Step 3: Payment Details -->
      {#if step === 3}
        <div>
          <label for="pay-amount" class="label">Monto a pagar (COP)</label>
          <input id="pay-amount" class="input" type="number" min="1" bind:value={payAmount} placeholder="0" />
          {#if generationResult}
            <p class="text-xs text-slate-500 mt-1">Total facturado: {fmtMoney(generationResult.totalAmount)}</p>
          {/if}
        </div>
        <div>
          <label for="pay-date" class="label">Fecha de pago</label>
          <input id="pay-date" class="input" type="date" bind:value={payDate} />
        </div>
        <div>
          <label for="pay-method" class="label">Método de pago</label>
          <select id="pay-method" class="select" bind:value={payMethod}>
            <option value="CASH">Efectivo</option>
            <option value="BANK_TRANSFER">Transferencia bancaria</option>
            <option value="NEQUI">Nequi</option>
            <option value="BANCOLOMBIA">Bancolombia</option>
            <option value="WOMPI">Wompi</option>
          </select>
        </div>
        <div>
          <label for="pay-notes" class="label">Referencia / Observación (opcional)</label>
          <input id="pay-notes" class="input" type="text" bind:value={payNotes}
                 placeholder="Número de consignación, referencia..." />
        </div>
        <div class="flex items-center justify-between pt-2">
          {#if generationResult}
            <div class="text-sm text-slate-600">
              <strong class="text-slate-900">{generationResult.invoices.length}</strong> factura(s)
            </div>
          {/if}
          <button on:click={submitPayment} disabled={saving} class="btn-primary">
            {#if saving}
              <Loader2 size={15} class="animate-spin" /> Registrando...
            {:else}
              <CreditCard size={15} /> Registrar pago
            {/if}
          </button>
        </div>
      {/if}

      <!-- Step 4: Evidence -->
      {#if step === 4}
        {#if evidenceUploaded}
          <div class="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <Check size={40} class="text-green-600 mx-auto mb-3" />
            <p class="text-base font-semibold text-green-800">Pago registrado correctamente</p>
            <p class="text-xs text-green-600 mt-1">Todos los datos han sido guardados</p>
          </div>
          <button on:click={finish} class="btn-primary w-full"><Check size={15} /> Finalizar</button>
        {:else}
          <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
            <Check size={16} class="inline mr-1" /> Pago registrado
          </div>
          <p class="text-sm text-slate-600">¿Deseas adjuntar un comprobante o foto?</p>
          {#if evidencePreview}
            <div class="rounded-xl overflow-hidden border border-slate-200">
              <img src={evidencePreview} alt="Preview" class="w-full max-h-48 object-contain bg-slate-50" />
            </div>
          {/if}
          <div class="flex gap-2">
            <label class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-sky-400 text-slate-600 hover:text-sky-600 text-sm font-medium cursor-pointer transition-colors">
              <ImageUp size={18} /> Galería
              <input type="file" accept="image/*" class="hidden" on:change={handleFileSelect} />
            </label>
            <label class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-300 hover:border-sky-400 text-slate-600 hover:text-sky-600 text-sm font-medium cursor-pointer transition-colors">
              <Camera size={18} /> Cámara
              <input type="file" accept="image/*" capture="environment" class="hidden" on:change={handleFileSelect} />
            </label>
          </div>
          {#if evidenceFile}
            <div>
              <label for="evidence-desc" class="label">Descripción (opcional)</label>
              <input id="evidence-desc" class="input" type="text" bind:value={evidenceDescription} placeholder="Comprobante de pago" />
            </div>
          {/if}
          <div class="flex gap-2 pt-2">
            <button on:click={skipEvidence} class="btn-secondary flex-1" disabled={saving}>Omitir</button>
            {#if evidenceFile}
              <button on:click={uploadEvidence} disabled={saving} class="btn-primary flex-1">
                {#if saving}<Loader2 size={15} class="animate-spin" /> Subiendo...
                {:else}<ImageUp size={15} /> Guardar comprobante{/if}
              </button>
            {/if}
          </div>
        {/if}
      {/if}

    </div>
  </div>
</div>
