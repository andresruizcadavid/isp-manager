<script>
  // BulkPlanChangeModal — 3-step flow over a single dialog.
  //
  //   1. Plan picker          → operator chooses target plan
  //   2. Diff preview         → shows each selected client + intended change
  //   3. Options + confirm    → opt-in toggles + phrase confirmation if N > 10
  //
  // Calls POST /clients/bulk-change-plan and surfaces the per-client result.
  // Emits `done` (with summary) when the operator dismisses the success view
  // so the parent can refresh its list.

  import { createEventDispatcher, onMount } from 'svelte';
  import {
    Loader2, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, X,
    AlertTriangle, Zap, Wallet, Wifi, PauseCircle
  } from 'lucide-svelte';
  import { api } from '$lib/api/client.js';

  /** Array of full client objects (with .id, .name, .plan, .mikrotikAccount, .monthlyFee, .status). */
  export let clients = [];
  /** Plans list (id, name, monthlyPrice, mikrotikProfile, downloadSpeed, uploadSpeed). */
  export let plans = [];

  const dispatch = createEventDispatcher();

  // ── Step machine ─────────────────────────────────────────────────────
  let step = 'pick';                         // pick → preview → confirm → running → done | error
  let selectedPlanId = '';
  let syncMikrotik     = true;
  let resetMonthlyFee  = false;
  let includeSuspended = false;
  let phrase           = '';
  let submitting       = false;
  let resultData       = null;
  let errorMessage     = '';

  // Per-client exclusion: operator can untick a row from the preview.
  let excluded = new Set();

  // ── Derived ──────────────────────────────────────────────────────────
  $: targetPlan = plans.find(p => p.id === selectedPlanId) || null;
  $: selectedClients = clients.filter(c => !excluded.has(c.id));

  $: diff = selectedClients.map(c => {
    const currentPlanId = c.planId || c.plan?.id || null;
    const currentProfile = c.mikrotikAccount?.profileName || null;
    const isSamePlan = currentPlanId === selectedPlanId;
    const willResetFee = resetMonthlyFee && (c.monthlyFee || 0) > 0;
    return {
      id: c.id,
      name: c.name,
      currentPlanName:    c.plan?.name || null,
      targetPlanName:     targetPlan?.name || null,
      currentProfile,
      targetProfile:      targetPlan?.mikrotikProfile || null,
      hasMikrotik:        Boolean(c.mikrotikAccount),
      status:             c.status,
      monthlyFee:         c.monthlyFee || 0,
      isSamePlan,
      willResetFee,
      isNoop:             isSamePlan && !willResetFee && !syncMikrotik,
      isSuspended:        c.status === 'SUSPENDED'
    };
  });

  $: noopCount     = diff.filter(d => d.isNoop).length;
  $: realCount     = diff.length - noopCount;
  $: overrideCount = diff.filter(d => d.monthlyFee > 0).length;
  $: suspendedCount = diff.filter(d => d.isSuspended).length;
  $: noProfileWarning = syncMikrotik && targetPlan && !targetPlan.mikrotikProfile;

  $: needsPhrase    = realCount > 10;
  $: phraseValid    = !needsPhrase || phrase.trim().toUpperCase() === 'CAMBIAR';
  $: canSubmit      = !!targetPlan && !noProfileWarning && selectedClients.length > 0 && phraseValid;

  function close() { dispatch('close'); }

  function toggleExclude(id) {
    if (excluded.has(id)) excluded.delete(id);
    else                  excluded.add(id);
    excluded = new Set(excluded); // trigger reactivity
  }

  async function submit() {
    submitting = true;
    errorMessage = '';
    step = 'running';
    try {
      const data = await api.post('/clients/bulk-change-plan', {
        clientIds:        selectedClients.map(c => c.id),
        planId:           selectedPlanId,
        syncMikrotik,
        resetMonthlyFee,
        includeSuspended
      });
      resultData = data;
      step = 'done';
    } catch (e) {
      errorMessage = e.message || 'Error al aplicar cambios';
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
</script>

<div class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4
            bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
     on:click|self={close}
     role="dialog" aria-label="Cambiar plan masivo">

  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 sm:my-0
              max-h-[95vh] flex flex-col overflow-hidden">

    <!-- Header -->
    <div class="flex items-start sm:items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 flex-shrink-0">
      <div class="min-w-0">
        <h3 class="font-semibold text-text-primary text-base flex items-center gap-2">
          <Zap size={18} class="text-brand-600" />
          Cambiar plan masivo
        </h3>
        <p class="text-xs text-text-muted mt-0.5 leading-tight">
          {clients.length} cliente{clients.length === 1 ? '' : 's'} seleccionado{clients.length === 1 ? '' : 's'}
          {#if excluded.size > 0}· {excluded.size} excluido{excluded.size === 1 ? '' : 's'} de la operación{/if}
        </p>
      </div>
      <button class="btn-icon" on:click={close} disabled={submitting}>
        <X size={16} />
      </button>
    </div>

    <!-- Body — depends on step -->
    <div class="flex-1 overflow-y-auto">

      {#if step === 'pick' || step === 'preview' || step === 'confirm'}
        <!-- Plan picker (always visible at top across all 3 form steps) -->
        <div class="px-5 py-4 border-b border-slate-100">
          <label for="bulk-plan" class="label">Plan destino</label>
          <select id="bulk-plan" bind:value={selectedPlanId}
                  class="select font-medium">
            <option value="">— Selecciona un plan —</option>
            {#each plans as p}
              {@const profileTag = p.mikrotikProfile ? ` · ${p.mikrotikProfile}` : ' · ⚠ sin perfil'}
              {@const speedTag   = p.downloadSpeed ? ` · ${Math.round(p.downloadSpeed/1000)}/${Math.round((p.uploadSpeed||p.downloadSpeed)/1000)}Mbps` : ''}
              <option value={p.id}>{p.name}{speedTag} · {fmtCop(p.monthlyPrice || p.price)}{profileTag}</option>
            {/each}
          </select>
          {#if targetPlan}
            <div class="mt-2 flex items-center gap-2 text-xs">
              {#if targetPlan.mikrotikProfile}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={11} /> Perfil MikroTik: <span class="font-mono font-semibold">{targetPlan.mikrotikProfile}</span>
                </span>
              {:else}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertTriangle size={11} /> El plan no tiene perfil MikroTik. Configúralo en /plans antes de sincronizar.
                </span>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Diff preview (always visible once a plan is picked) -->
        {#if targetPlan}
          <div class="px-5 py-4 border-b border-slate-100">
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-semibold text-text-primary">Impacto</h4>
              <div class="text-xs text-text-muted">
                {realCount} cambio{realCount === 1 ? '' : 's'}
                {#if noopCount > 0}· {noopCount} sin cambio{/if}
              </div>
            </div>

            <div class="border border-slate-200 rounded-lg max-h-[40vh] overflow-y-auto">
              <table class="w-full text-xs">
                <thead class="bg-slate-50 text-text-secondary uppercase tracking-wider text-[10px] font-semibold">
                  <tr>
                    <th class="text-left px-3 py-2 w-8"></th>
                    <th class="text-left px-2 py-2">Cliente</th>
                    <th class="text-left px-2 py-2">Plan actual → destino</th>
                    <th class="text-left px-2 py-2">Notas</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  {#each diff as d}
                    <tr class={excluded.has(d.id) ? 'opacity-40 line-through' : ''}>
                      <td class="px-3 py-2">
                        <input type="checkbox" checked={!excluded.has(d.id)}
                               on:change={() => toggleExclude(d.id)}
                               class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
                      </td>
                      <td class="px-2 py-2 font-medium text-text-primary truncate max-w-[200px]" title={d.name}>{d.name}</td>
                      <td class="px-2 py-2 text-text-secondary">
                        <span class="text-slate-500">{d.currentPlanName || '—'}</span>
                        <ArrowRight size={10} class="inline mx-1 text-slate-400" />
                        <span class="font-medium {d.isSamePlan ? 'text-slate-500' : 'text-brand-700'}">{d.targetPlanName}</span>
                      </td>
                      <td class="px-2 py-2">
                        <div class="flex items-center gap-1 flex-wrap">
                          {#if d.isNoop}
                            <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-medium">noop</span>
                          {/if}
                          {#if d.isSuspended}
                            <span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-medium inline-flex items-center gap-0.5">
                              <PauseCircle size={9} /> suspendido
                            </span>
                          {/if}
                          {#if d.monthlyFee > 0}
                            <span class="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-medium inline-flex items-center gap-0.5"
                                  title="Tarifa personalizada {fmtCop(d.monthlyFee)}">
                              <Wallet size={9} /> override
                            </span>
                          {/if}
                          {#if syncMikrotik && d.hasMikrotik && d.currentProfile !== d.targetProfile && d.targetProfile}
                            <span class="px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-200 text-[10px] font-mono inline-flex items-center gap-0.5">
                              <Wifi size={9} /> {d.targetProfile}
                            </span>
                          {/if}
                          {#if !d.hasMikrotik}
                            <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-medium" title="Sin cuenta MikroTik">
                              sin cuenta
                            </span>
                          {/if}
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Options -->
          <div class="px-5 py-4 space-y-3">
            <h4 class="text-sm font-semibold text-text-primary">Opciones</h4>

            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" bind:checked={syncMikrotik}
                     class="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary">Sincronizar perfil PPPoE en MikroTik</div>
                <div class="text-xs text-text-muted">
                  Reescribe el <code class="font-mono">profileName</code> en el secret de cada cliente y aplica el cambio en su router.
                </div>
              </div>
            </label>

            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" bind:checked={resetMonthlyFee}
                     class="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary">Resetear tarifas personalizadas</div>
                <div class="text-xs text-text-muted">
                  Pone <code class="font-mono">monthlyFee = 0</code> para que aplique el precio del plan.
                  {#if overrideCount > 0}
                    <span class="text-violet-700 font-medium">Afecta a {overrideCount} cliente{overrideCount === 1 ? '' : 's'} con tarifa personalizada.</span>
                  {/if}
                </div>
              </div>
            </label>

            <label class="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" bind:checked={includeSuspended}
                     class="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary">Sincronizar router para suspendidos</div>
                <div class="text-xs text-text-muted">
                  Por defecto saltamos el push a MikroTik para clientes suspendidos; el secret se actualiza al reactivar.
                  {#if suspendedCount > 0}
                    <span class="text-amber-700 font-medium">Hay {suspendedCount} suspendido{suspendedCount === 1 ? '' : 's'} en la selección.</span>
                  {/if}
                </div>
              </div>
            </label>
          </div>

          <!-- Phrase confirmation (only if N > 10) -->
          {#if needsPhrase}
            <div class="px-5 py-4 border-t border-slate-100 bg-amber-50/40">
              <div class="flex items-start gap-2 mb-2">
                <AlertTriangle size={16} class="text-amber-600 flex-shrink-0 mt-0.5" />
                <div class="text-sm text-amber-900">
                  Estás por aplicar este cambio a <strong>{realCount} clientes</strong>.
                  Escribe <span class="font-mono font-bold">CAMBIAR</span> para confirmar.
                </div>
              </div>
              <input type="text" bind:value={phrase}
                     placeholder="Escribe CAMBIAR"
                     class="input font-mono uppercase tracking-wider" />
            </div>
          {/if}
        {/if}

      {:else if step === 'running'}
        <div class="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={32} class="animate-spin text-brand-600" />
          <p class="text-sm text-text-secondary">Aplicando cambios a {selectedClients.length} cliente{selectedClients.length === 1 ? '' : 's'}…</p>
        </div>

      {:else if step === 'done'}
        <div class="p-5">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 size={24} class="text-emerald-600" />
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-base font-semibold text-text-primary">Cambios aplicados</h4>
              <p class="text-xs text-text-muted">
                {resultData?.summary?.ok || 0} aplicado{(resultData?.summary?.ok || 0) === 1 ? '' : 's'}
                · {resultData?.summary?.noop || 0} sin cambio
                · {resultData?.summary?.failed || 0} fallido{(resultData?.summary?.failed || 0) === 1 ? '' : 's'}
              </p>
            </div>
            <a href="/invoices/bulk-history" class="text-xs text-brand-700 hover:underline font-medium whitespace-nowrap">
              Ver historial →
            </a>
          </div>

          {#if (resultData?.summary?.failed || 0) > 0}
            <div class="mt-3 border border-amber-200 rounded-lg overflow-hidden">
              <div class="px-3 py-2 bg-amber-50 text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                <AlertCircle size={12} /> Clientes con error
              </div>
              <div class="max-h-[200px] overflow-y-auto divide-y divide-amber-100 text-xs">
                {#each (resultData?.results || []).filter(r => r.status === 'failed' || r.mikrotikSync?.status === 'failed') as r}
                  <div class="px-3 py-2">
                    <div class="font-medium text-text-primary">{r.name}</div>
                    <div class="text-text-muted">{r.reason || r.mikrotikSync?.reason || 'unknown'}</div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>

      {:else if step === 'error'}
        <div class="p-5">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle size={24} class="text-red-600" />
            </div>
            <div>
              <h4 class="text-base font-semibold text-text-primary">No se pudo aplicar</h4>
            </div>
          </div>
          <p class="text-sm text-text-secondary">{errorMessage}</p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
      {#if step === 'pick' || step === 'preview' || step === 'confirm'}
        <button type="button" class="btn-secondary" on:click={close}>Cancelar</button>
        <button type="button" class="btn-primary" on:click={submit}
                disabled={!canSubmit}>
          <Zap size={14} />
          Aplicar a {selectedClients.length - diff.filter(d => d.isNoop).length} cliente{(selectedClients.length - diff.filter(d => d.isNoop).length) === 1 ? '' : 's'}
        </button>
      {:else if step === 'running'}
        <button type="button" class="btn-secondary" disabled>En progreso…</button>
      {:else if step === 'done'}
        <button type="button" class="btn-primary" on:click={finish}>Listo</button>
      {:else if step === 'error'}
        <button type="button" class="btn-secondary" on:click={close}>Cerrar</button>
        <button type="button" class="btn-primary" on:click={() => step = 'pick'}>Reintentar</button>
      {/if}
    </div>

  </div>
</div>
