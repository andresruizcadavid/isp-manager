<script>
  // Ciclos de cobro — parametrización mensual del ciclo de cobranza.
  // El corte automático es un toggle separado, OFF por defecto, y NO
  // ejecuta corte: solo expone la etiqueta "suspendible" en el clasificador.

  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    ArrowLeft, Plus, Edit3, Trash2, CheckCircle2, RefreshCw, Loader2,
    AlertCircle, ChevronDown, ChevronRight, Calendar, Power, PauseCircle,
    AlertTriangle, Lock, Play, Eye, Users, Repeat, Save, Wand2
  } from 'lucide-svelte';

  let loading = true;
  /** @type {any[]} */
  let rows = [];
  /** @type {string | null} */
  let activeCycleId = null;
  let error = '';
  /** @type {string | null} */
  let expandedId = null;
  /** @type {Record<string, any>} */
  let impactCache = {};   // cycleId → impact data

  // Modal create/edit
  let modalOpen = false;
  /** @type {string | null} */
  let editingId = null;
  let saving = false;
  let form = emptyForm();

  function emptyForm() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    // Default: día 25 del mes corriente → último día del mes
    const lastDay = new Date(y, m, 0).getDate();
    return {
      year:               y,
      month:              m,
      collectionStart:    `${y}-${String(m).padStart(2,'0')}-25`,
      collectionEnd:      `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`,
      moraGraceDays:      7,
      autoSuspendEnabled: false,
      notes:              ''
    };
  }

  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  /** @param {string} s */
  function toLocalDate(s) {
    // datetime-local input value like "YYYY-MM-DD" — convert to ISO at 00:00 local.
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api.get('/billing-cycles');
      rows = Array.isArray(res) ? res : (res?.data || []);
      const active = rows.find(r => r.status === 'active');
      activeCycleId = active?.id || null;
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo cargar';
    } finally {
      loading = false;
    }
  }

  // ── Regla de ciclo recurrente ──────────────────────────────────────
  let ruleOpen = false;
  let ruleLoading = true;
  let ruleSaving = false;
  let ensuring = false;
  let ruleMsg = '';
  /** @type {{enabled:boolean, startDay:number, endMode:string, endDay:number|null, moraGraceDays:number, autoSuspendEnabled:boolean}} */
  let rule = { enabled: false, startDay: 25, endMode: 'end-of-month', endDay: 1, moraGraceDays: 7, autoSuspendEnabled: false };

  async function loadRule() {
    ruleLoading = true;
    try {
      const r = await api.get('/billing-cycles/rule');
      const data = r?.data ?? r;
      rule = { ...rule, ...(data || {}), endDay: (data?.endDay ?? rule.endDay) || 1 };
    } catch (/** @type {any} */ e) { /* no fatal: se usan defaults */ }
    finally { ruleLoading = false; }
  }

  /** @param {boolean} [reload] */
  async function ensureFromRule(reload = true) {
    ensuring = true;
    try {
      await api.post('/billing-cycles/ensure', { monthsAhead: 1 });
      if (reload) await load();
    } catch (/** @type {any} */ e) { error = e.message || 'No se pudo generar desde la regla'; }
    finally { ensuring = false; }
  }

  async function saveRule() {
    ruleSaving = true; error = ''; ruleMsg = '';
    try {
      const payload = {
        enabled:            rule.enabled,
        startDay:           Number(rule.startDay),
        endMode:            rule.endMode,
        endDay:             rule.endMode === 'day-of-month' ? Number(rule.endDay) : null,
        moraGraceDays:      Number(rule.moraGraceDays),
        autoSuspendEnabled: rule.autoSuspendEnabled
      };
      const r = await api.put('/billing-cycles/rule', payload);
      const data = r?.data ?? r;
      rule = { ...rule, ...(data || {}), endDay: (data?.endDay ?? rule.endDay) || 1 };
      ruleMsg = 'Regla guardada';
      if (rule.enabled) await ensureFromRule(false);   // materializa de una
      await load();
    } catch (/** @type {any} */ e) { error = e.message || 'No se pudo guardar la regla'; }
    finally { ruleSaving = false; setTimeout(() => (ruleMsg = ''), 2500); }
  }

  $: rulePreview = rule.enabled
    ? `Día ${rule.startDay} de cada mes → ${rule.endMode === 'end-of-month' ? 'último día del mes' : 'día ' + rule.endDay} · mora ${rule.moraGraceDays} d${rule.autoSuspendEnabled ? ' · corte auto ON' : ''}`
    : 'Regla desactivada — los ciclos se crean manualmente.';

  onMount(async () => {
    await loadRule();
    if (rule.enabled) { try { await api.post('/billing-cycles/ensure', { monthsAhead: 1 }); } catch (/** @type {any} */ e) { /* silencioso */ } }
    await load();
  });

  /** @param {string} id */
  async function toggleExpand(id) {
    expandedId = expandedId === id ? null : id;
    if (expandedId && !impactCache[id]) {
      try {
        impactCache[id] = await api.get(`/billing-cycles/${id}/impact`);
        impactCache = { ...impactCache };
      } catch (/** @type {any} */ e) {
        impactCache[id] = { error: e.message };
        impactCache = { ...impactCache };
      }
    }
  }
  /** @param {string} id */
  async function refreshImpact(id) {
    delete impactCache[id];
    impactCache = { ...impactCache };
    impactCache[id] = await api.get(`/billing-cycles/${id}/impact`);
    impactCache = { ...impactCache };
  }

  function openCreate() {
    editingId = null;
    form = emptyForm();
    modalOpen = true;
  }
  /** @param {any} row */
  function openEdit(row) {
    editingId = row.id;
    form = {
      year:  row.year,
      month: row.month,
      collectionStart:    row.collectionStart.slice(0,10),
      collectionEnd:      row.collectionEnd.slice(0,10),
      moraGraceDays:      row.moraGraceDays,
      autoSuspendEnabled: !!row.autoSuspendEnabled,
      notes:              row.notes || ''
    };
    modalOpen = true;
  }

  async function submit() {
    error = '';
    if (!form.collectionStart || !form.collectionEnd) {
      error = 'Definí ambas fechas del ciclo'; return;
    }
    const start = toLocalDate(form.collectionStart);
    const end   = toLocalDate(form.collectionEnd);
    end.setHours(23, 59, 59);
    if (end < start) { error = 'La fecha máxima debe ser >= a la fecha de inicio'; return; }

    saving = true;
    try {
      if (editingId) {
        await api.put(`/billing-cycles/${editingId}`, {
          collectionStart:    start.toISOString(),
          collectionEnd:      end.toISOString(),
          moraGraceDays:      Number(form.moraGraceDays),
          autoSuspendEnabled: form.autoSuspendEnabled,
          notes:              form.notes || null
        });
      } else {
        await api.post('/billing-cycles', {
          year:               Number(form.year),
          month:              Number(form.month),
          collectionStart:    start.toISOString(),
          collectionEnd:      end.toISOString(),
          moraGraceDays:      Number(form.moraGraceDays),
          autoSuspendEnabled: form.autoSuspendEnabled,
          notes:              form.notes || null
        });
      }
      modalOpen = false;
      await load();
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo guardar';
    } finally { saving = false; }
  }

  /** @param {any} row */
  async function activate(row) {
    if (!confirm(`Activar el ciclo de ${MONTH_NAMES[row.month-1]} ${row.year}? Cualquier otro ciclo activo se cerrará.`)) return;
    try { await api.post(`/billing-cycles/${row.id}/activate`, {}); await load(); }
    catch (/** @type {any} */ e) { error = e.message; }
  }
  /** @param {any} row */
  async function close(row) {
    if (!confirm(`Cerrar el ciclo de ${MONTH_NAMES[row.month-1]} ${row.year}? Quedará en modo solo-lectura.`)) return;
    try { await api.post(`/billing-cycles/${row.id}/close`, {}); await load(); }
    catch (/** @type {any} */ e) { error = e.message; }
  }
  /** @param {any} row */
  async function deleteRow(row) {
    if (row.status !== 'draft') { error = 'Solo se pueden eliminar borradores'; return; }
    if (!confirm(`Eliminar el borrador de ${MONTH_NAMES[row.month-1]} ${row.year}?`)) return;
    try { await api.delete(`/billing-cycles/${row.id}`); await load(); }
    catch (/** @type {any} */ e) { error = e.message; }
  }

  /** @param {string} s */
  function statusBadge(s) {
    if (s === 'active') return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '● Activo' };
    if (s === 'closed') return { cls: 'bg-slate-100 text-slate-500 border-slate-200',     label: 'Cerrado' };
    return                     { cls: 'bg-amber-50 text-amber-700 border-amber-200',     label: 'Borrador' };
  }
  /** @param {string} p */
  function phaseBadge(p) {
    if (p === 'before')   return { cls: 'bg-slate-100 text-slate-600',  label: 'Antes de inicio' };
    if (p === 'window')   return { cls: 'bg-blue-50 text-blue-700',     label: 'En ventana' };
    if (p === 'overdue')  return { cls: 'bg-orange-50 text-orange-700', label: 'Vencido' };
    if (p === 'mora')     return { cls: 'bg-red-50 text-red-700',       label: 'En mora' };
    return                       { cls: 'bg-slate-100 text-slate-500',  label: '—' };
  }
</script>

<svelte:head><title>Ciclos de cobro — ISP Manager</title></svelte:head>

<div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
      <Calendar size={20} class="text-brand-600" />
      Ciclos de cobro
    </h1>
    <p class="text-sm text-text-muted mt-0.5">
      Parámetros del ciclo mensual: fecha de inicio de cobro, fecha máxima de pago y mora.
      El corte automático es opcional y separado.
    </p>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary" on:click={load} disabled={loading}>
      {#if loading}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
      Recargar
    </button>
    <a href="/invoices" class="btn-secondary"><ArrowLeft size={14} /> Facturas</a>
    <button class="btn-primary" on:click={openCreate}><Plus size={14} /> Nuevo ciclo</button>
  </div>
</div>

<!-- Banner explicativo de separación cobro vs corte -->
<div class="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 flex items-start gap-2 text-sm">
  <AlertCircle size={14} class="text-blue-600 flex-shrink-0 mt-0.5" />
  <div class="text-blue-900">
    <strong>Esta sección parametriza la ventana de cobro.</strong> No suspende servicios.
    El corte automático es un toggle <strong>independiente</strong> dentro de cada ciclo y está
    <strong>desactivado por defecto</strong> — si lo activás, solo se etiqueta a los clientes como
    "suspendible"; la suspensión real se hace manual desde el detalle del cliente.
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
    <AlertCircle size={14} /> {error}
  </div>
{/if}

<!-- Regla de ciclo recurrente -->
<div class="card mb-4">
  <button type="button" class="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/50"
          on:click={() => (ruleOpen = !ruleOpen)}>
    <div class="flex items-center gap-2 min-w-0">
      <Repeat size={16} class="text-brand-600 flex-shrink-0" />
      <span class="font-semibold text-text-primary">Regla recurrente</span>
      {#if ruleLoading}
        <Loader2 size={12} class="animate-spin text-text-muted" />
      {:else if rule.enabled}
        <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">● Activa</span>
      {:else}
        <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium bg-slate-100 text-slate-500 border-slate-200">Desactivada</span>
      {/if}
      <span class="text-xs text-text-muted truncate hidden sm:inline">· {rulePreview}</span>
    </div>
    {#if ruleOpen}<ChevronDown size={16} class="text-text-muted flex-shrink-0" />{:else}<ChevronRight size={16} class="text-text-muted flex-shrink-0" />{/if}
  </button>

  {#if ruleOpen}
    <div class="px-4 pb-4 pt-1 border-t border-slate-100 space-y-4">
      <p class="text-xs text-text-muted mt-3">
        Definí la ventana en <strong>días del mes</strong> y el sistema crea el ciclo de cada mes
        automáticamente (mes actual + próximo), sin cargarlos a mano. Los ciclos manuales que ya
        existan <strong>mandan</strong>: la regla solo llena los meses que falten.
      </p>

      <!-- Activar regla -->
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" bind:checked={rule.enabled} class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
        <span class="text-sm font-medium text-text-primary">Aplicar esta regla automáticamente a cada mes</span>
      </label>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <!-- Inicio -->
        <div>
          <label class="label" for="rule-start">Inicio de cobro — día del mes</label>
          <input id="rule-start" type="number" min="1" max="31" class="input w-28" bind:value={rule.startDay} />
          <p class="text-[11px] text-text-muted mt-1">Ej. 20 = el cobro abre el 20 de cada mes. Se ajusta si el mes es más corto.</p>
        </div>

        <!-- Fin -->
        <div>
          <span class="label">Fecha máxima de pago</span>
          <div class="space-y-1.5 mt-1">
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <input type="radio" bind:group={rule.endMode} value="end-of-month" class="text-brand-600 focus:ring-brand-600/30" />
              Último día del mes <span class="text-[11px] text-text-muted">(31, 30, 28/29…)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-sm">
              <input type="radio" bind:group={rule.endMode} value="day-of-month" class="text-brand-600 focus:ring-brand-600/30" />
              Día fijo
              <input type="number" min="1" max="31" class="input w-20 py-1" bind:value={rule.endDay}
                     disabled={rule.endMode !== 'day-of-month'} />
            </label>
          </div>
          <p class="text-[11px] text-text-muted mt-1">Si el día fijo es menor al de inicio, se toma del mes siguiente.</p>
        </div>

        <!-- Mora -->
        <div>
          <label class="label" for="rule-mora">Días para entrar en mora</label>
          <input id="rule-mora" type="number" min="0" max="60" class="input w-28" bind:value={rule.moraGraceDays} />
        </div>

        <!-- Corte auto default -->
        <div class="flex items-end">
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" bind:checked={rule.autoSuspendEnabled} class="mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-600/30" />
            <span class="text-sm text-text-primary">
              <span class="font-medium flex items-center gap-1"><Power size={13} class="text-red-600" /> Corte automático por defecto</span>
              <span class="text-[11px] text-text-muted block">Solo etiqueta "suspendible"; la suspensión sigue siendo manual.</span>
            </span>
          </label>
        </div>
      </div>

      <div class="rounded-lg bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800 flex items-center gap-2">
        <Calendar size={13} /> <span>Resultado: <strong>{rulePreview}</strong></span>
      </div>

      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="text-xs text-emerald-600 font-medium">{ruleMsg}</span>
        <div class="flex items-center gap-2">
          {#if rule.enabled}
            <button class="btn-secondary" on:click={() => ensureFromRule(true)} disabled={ensuring || ruleSaving}
                    title="Crear ahora los ciclos faltantes (mes actual + próximo)">
              {#if ensuring}<Loader2 size={14} class="animate-spin" />{:else}<Wand2 size={14} />{/if}
              Generar meses
            </button>
          {/if}
          <button class="btn-primary" on:click={saveRule} disabled={ruleSaving}>
            {#if ruleSaving}<Loader2 size={14} class="animate-spin" />{:else}<Save size={14} />{/if}
            Guardar regla
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<div class="card">
  {#if loading && rows.length === 0}
    <div class="p-10 flex items-center justify-center gap-2 text-text-secondary">
      <Loader2 size={18} class="animate-spin" /> Cargando…
    </div>
  {:else if rows.length === 0}
    <div class="p-12 text-center">
      <div class="w-14 h-14 rounded-2xl bg-slate-100 mx-auto mb-3 flex items-center justify-center">
        <Calendar size={24} class="text-slate-400" />
      </div>
      <p class="text-sm font-semibold text-text-primary">Aún no hay ciclos configurados</p>
      <p class="text-xs text-text-muted mt-1">
        Crea el primer ciclo para definir la ventana de cobro de un mes.
      </p>
      <button class="btn-primary inline-flex mt-4" on:click={openCreate}>
        <Plus size={14} /> Crear ciclo
      </button>
    </div>
  {:else}
    <div class="divide-y divide-slate-100">
      {#each rows as row (row.id)}
        {@const isOpen = expandedId === row.id}
        {@const st = statusBadge(row.status)}
        {@const isLive = row.id === activeCycleId}
        <div class={isLive ? 'bg-emerald-50/30' : ''}>
          <div class="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/40">
            <button type="button" on:click={() => toggleExpand(row.id)}
                    class="flex-shrink-0 w-6 h-6 inline-flex items-center justify-center rounded hover:bg-slate-100">
              {#if isOpen}<ChevronDown size={14} class="text-text-muted" />{:else}<ChevronRight size={14} class="text-text-muted" />{/if}
            </button>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold text-text-primary">
                  {MONTH_NAMES[row.month - 1]} {row.year}
                </span>
                <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium {st.cls}">{st.label}</span>
                {#if row.autoSuspendEnabled}
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold bg-red-50 text-red-700 border-red-200" title="Corte automático habilitado (sólo etiquetado, no ejecuta suspensión)">
                    <Power size={9} /> Corte auto
                  </span>
                {/if}
              </div>
              <div class="text-xs text-text-muted mt-0.5">
                Cobro <strong>{fmtDate(row.collectionStart)}</strong> → <strong>{fmtDate(row.collectionEnd)}</strong>
                · Mora {row.moraGraceDays}d después · {row.createdBy?.name || 'sin operador'}
              </div>
              {#if row.notes}
                <div class="text-[11px] text-text-muted italic mt-1">{row.notes}</div>
              {/if}
            </div>

            <div class="flex items-center gap-1 flex-shrink-0">
              {#if row.status === 'draft'}
                <button class="btn-icon" title="Activar" on:click={() => activate(row)}><Play size={13} /></button>
                <button class="btn-icon" title="Editar"  on:click={() => openEdit(row)}><Edit3 size={13} /></button>
                <button class="btn-icon" title="Eliminar"on:click={() => deleteRow(row)}><Trash2 size={13} /></button>
              {:else if row.status === 'active'}
                <button class="btn-icon" title="Editar fechas" on:click={() => openEdit(row)}><Edit3 size={13} /></button>
                <button class="btn-icon" title="Cerrar ciclo"  on:click={() => close(row)}><Lock size={13} /></button>
              {:else}
                <span class="text-[10px] text-text-muted italic px-2">solo-lectura</span>
              {/if}
            </div>
          </div>

          <!-- Impact expansion -->
          {#if isOpen}
            <div class="px-4 pb-4 pt-1 bg-slate-50/40 border-t border-slate-100">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <Users size={11} /> Impacto en clientes
                </h4>
                <button class="text-xs text-brand-700 hover:underline inline-flex items-center gap-1" on:click={() => refreshImpact(row.id)}>
                  <RefreshCw size={11} /> Refrescar
                </button>
              </div>

              {#if !impactCache[row.id]}
                <div class="flex items-center gap-2 text-xs text-text-muted py-3">
                  <Loader2 size={12} class="animate-spin" /> Calculando…
                </div>
              {:else if impactCache[row.id].error}
                <div class="text-xs text-red-600">{impactCache[row.id].error}</div>
              {:else}
                {@const im = impactCache[row.id]}
                {@const ph = phaseBadge(im.phase)}
                <div class="mb-3 flex items-center gap-2 flex-wrap">
                  <span class="text-[10px] uppercase tracking-wider text-text-muted">Fase actual:</span>
                  <span class="inline-block px-2 py-0.5 rounded text-[10px] font-semibold {ph.cls}">{ph.label}</span>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div class="rounded-lg bg-white border border-emerald-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 size={10} /> Al día</div>
                    <div class="text-base font-bold text-emerald-700 tabular-nums">{im.totals.alDia}</div>
                  </div>
                  <div class="rounded-lg bg-white border border-blue-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-blue-700 font-semibold">Dentro de ventana</div>
                    <div class="text-base font-bold text-blue-700 tabular-nums">{im.totals.dentroDeVentana}</div>
                  </div>
                  <div class="rounded-lg bg-white border border-orange-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-orange-700 font-semibold">Vencido</div>
                    <div class="text-base font-bold text-orange-700 tabular-nums">{im.totals.vencido}</div>
                  </div>
                  <div class="rounded-lg bg-white border border-red-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-red-700 font-semibold">En mora</div>
                    <div class="text-base font-bold text-red-700 tabular-nums">{im.totals.mora}</div>
                  </div>
                  <div class="rounded-lg bg-white border {im.autoSuspendEnabled ? 'border-red-300' : 'border-slate-200'} px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider {im.autoSuspendEnabled ? 'text-red-700' : 'text-text-muted'} font-semibold flex items-center gap-1">
                      <PauseCircle size={10} /> Suspendible
                    </div>
                    <div class="text-base font-bold tabular-nums {im.autoSuspendEnabled ? 'text-red-700' : 'text-text-muted'}">
                      {im.totals.suspendible}
                    </div>
                    {#if !im.autoSuspendEnabled}
                      <div class="text-[10px] text-text-muted italic mt-0.5">corte auto OFF</div>
                    {/if}
                  </div>
                </div>

                <div class="mt-3 text-[11px] text-text-muted">
                  <strong>{im.totals.totalConsiderados}</strong> clientes considerados (excluye plan gratis).
                  La etiqueta "Suspendible" es solo informativa — el corte se hace manual desde el detalle del cliente.
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Modal create / edit -->
{#if modalOpen}
  <div class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
       on:click|self={() => modalOpen = false}
       role="dialog" aria-label="Editar ciclo">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl my-4 sm:my-0 max-h-[95vh] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
        <h3 class="font-semibold text-text-primary text-base flex items-center gap-2">
          <Calendar size={18} class="text-brand-600" />
          {editingId ? 'Editar ciclo' : 'Nuevo ciclo de cobro'}
        </h3>
        <button class="btn-icon" on:click={() => modalOpen = false} disabled={saving}>✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        {#if !editingId}
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="bc-month">Mes</label>
              <select id="bc-month" bind:value={form.month} class="select">
                {#each MONTH_NAMES as name, i}
                  <option value={i + 1}>{name}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="label" for="bc-year">Año</label>
              <input id="bc-year" type="number" min="2020" max="2100" class="input" bind:value={form.year} />
            </div>
          </div>
        {:else}
          <div class="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span class="text-xs text-text-muted">Período</span>
            <div class="font-semibold text-sm">{MONTH_NAMES[form.month - 1]} {form.year}</div>
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="bc-start">Fecha de inicio de cobro</label>
            <input id="bc-start" type="date" class="input" bind:value={form.collectionStart} />
            <p class="text-[11px] text-text-muted mt-1">Día a partir del cual el cobro está abierto.</p>
          </div>
          <div>
            <label class="label" for="bc-end">Fecha máxima de pago</label>
            <input id="bc-end" type="date" class="input" bind:value={form.collectionEnd} />
            <p class="text-[11px] text-text-muted mt-1">Pasado este día, el cliente queda "vencido".</p>
          </div>
        </div>

        <div>
          <label class="label" for="bc-mora">Días para entrar en mora</label>
          <input id="bc-mora" type="number" min="0" max="60" class="input w-32" bind:value={form.moraGraceDays} />
          <p class="text-[11px] text-text-muted mt-1">
            Días después de la fecha máxima en que un cliente vencido pasa a "mora". Default 7.
          </p>
        </div>

        <!-- Sección visualmente separada para el corte automático -->
        <div class="border-2 border-dashed border-red-200 rounded-xl p-4 bg-red-50/30">
          <label class="flex items-start gap-3 cursor-pointer">
            <input type="checkbox"
                   bind:checked={form.autoSuspendEnabled}
                   class="mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-600/30" />
            <div class="flex-1">
              <div class="flex items-center gap-2 font-semibold text-text-primary text-sm">
                <Power size={14} class="text-red-600" />
                Habilitar corte automático
              </div>
              <p class="text-xs text-text-muted mt-1 leading-relaxed">
                <strong>Off por defecto.</strong> Si está activado, los clientes en mora aparecerán
                etiquetados como "Suspendible" en la vista de impacto. <strong>El corte real
                sigue siendo manual</strong> — esta opción solo prepara la data.
              </p>
            </div>
          </label>
        </div>

        <div>
          <label class="label" for="bc-notes">Notas (opcional)</label>
          <textarea id="bc-notes" rows="2" class="input resize-none" bind:value={form.notes}
                    placeholder="Cualquier nota operativa del ciclo"></textarea>
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
        <button class="btn-secondary" on:click={() => modalOpen = false} disabled={saving}>Cancelar</button>
        <button class="btn-primary" on:click={submit} disabled={saving}>
          {#if saving}<Loader2 size={14} class="animate-spin" />{:else}<CheckCircle2 size={14} />{/if}
          {editingId ? 'Guardar cambios' : 'Crear ciclo'}
        </button>
      </div>
    </div>
  </div>
{/if}
