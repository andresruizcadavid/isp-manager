<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    ArrowLeft, Plus, Edit3, Trash2, Play, RefreshCw, Loader2,
    AlertCircle, CheckCircle2, ChevronDown, ChevronRight,
    Mail, MessageSquare, Send, Calendar, Zap
  } from 'lucide-svelte';

  let loading = true;
  let rows = [];
  let activeWindowId = null;
  let error = '';
  let expandedId = null;
  let metricsCache = {}; // windowId -> metrics

  // Modal state for create/edit
  let modalOpen = false;
  let editingId = null;
  let saving = false;
  let form = emptyForm();

  function emptyForm() {
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    return {
      name: '',
      startDate:          toLocalInput(now),
      endDate:            toLocalInput(end),
      channels:           ['EMAIL'],
      targetStatuses:     ['PENDING','OVERDUE'],
      sendFrequencyHours: 24,
      messageTemplate:    'Hola {name}, tu factura por {amount} vence el {dueDate}. Realiza tu pago para evitar inconvenientes.',
      isActive:           true
    };
  }

  function toLocalInput(d) {
    const z = new Date(d);
    z.setMinutes(z.getMinutes() - z.getTimezoneOffset());
    return z.toISOString().slice(0, 16);
  }
  function toIso(s) { return new Date(s).toISOString(); }
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
  function fmtMoney(c) {
    if (c == null) return '—';
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits: 0 }).format((c || 0) / 100);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api.get('/collection-windows');
      // api.get unwraps data; we want meta too — but the endpoint puts
      // activeWindowId in meta. Workaround: read it via a second flag in
      // the rows by matching now.
      rows = Array.isArray(res) ? res : (res?.data || []);
      const now = Date.now();
      activeWindowId = rows.find(r =>
        r.isActive && new Date(r.startDate).getTime() <= now && new Date(r.endDate).getTime() >= now
      )?.id || null;
    } catch (e) {
      error = e.message || 'No se pudo cargar el listado';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function toggleExpand(id) {
    expandedId = expandedId === id ? null : id;
    if (expandedId && !metricsCache[id]) {
      try {
        metricsCache[id] = await api.get(`/collection-windows/${id}/metrics`);
        metricsCache = { ...metricsCache };
      } catch (e) {
        metricsCache[id] = { error: e.message };
        metricsCache = { ...metricsCache };
      }
    }
  }

  function openCreate() {
    editingId = null;
    form = emptyForm();
    modalOpen = true;
  }
  function openEdit(row) {
    editingId = row.id;
    form = {
      name:               row.name,
      startDate:          toLocalInput(row.startDate),
      endDate:            toLocalInput(row.endDate),
      channels:           [...(row.channels || ['EMAIL'])],
      targetStatuses:     [...(row.targetStatuses || ['PENDING','OVERDUE'])],
      sendFrequencyHours: row.sendFrequencyHours,
      messageTemplate:    row.messageTemplate,
      isActive:           row.isActive
    };
    modalOpen = true;
  }
  function toggleChannel(c) {
    form.channels = form.channels.includes(c)
      ? form.channels.filter(x => x !== c)
      : [...form.channels, c];
  }
  function toggleStatus(s) {
    form.targetStatuses = form.targetStatuses.includes(s)
      ? form.targetStatuses.filter(x => x !== s)
      : [...form.targetStatuses, s];
  }
  async function submit() {
    if (!form.name.trim()) { error = 'Nombre requerido'; return; }
    if (form.channels.length === 0) { error = 'Al menos un canal'; return; }
    if (form.targetStatuses.length === 0) { error = 'Al menos un estado objetivo'; return; }
    saving = true;
    try {
      const body = {
        name:               form.name.trim(),
        startDate:          toIso(form.startDate),
        endDate:            toIso(form.endDate),
        channels:           form.channels,
        targetStatuses:     form.targetStatuses,
        sendFrequencyHours: Number(form.sendFrequencyHours),
        messageTemplate:    form.messageTemplate,
        isActive:           form.isActive
      };
      if (editingId) await api.put(`/collection-windows/${editingId}`, body);
      else           await api.post('/collection-windows', body);
      modalOpen = false;
      await load();
    } catch (e) {
      error = e.message || 'No se pudo guardar';
    } finally {
      saving = false;
    }
  }
  async function deleteRow(row) {
    if (!confirm(`Eliminar ventana "${row.name}"?`)) return;
    try {
      await api.delete(`/collection-windows/${row.id}`);
      await load();
    } catch (e) { error = e.message || 'No se pudo eliminar'; }
  }
  async function runNow(row) {
    if (!confirm(`Lanzar un envío ahora para "${row.name}"? Esto manda recordatorios reales a los deudores actuales que no hayan recibido uno en las últimas ${row.sendFrequencyHours} horas.`)) return;
    try {
      const r = await api.post(`/collection-windows/${row.id}/run-now`, {});
      alert(`Tick lanzado · ${r.sweptDebtors} deudores · enviados: ${JSON.stringify(r.sentByChannel || {})} · saltados (frecuencia): ${r.skippedRecent} · fallidos: ${r.failed}`);
      delete metricsCache[row.id];
      metricsCache = { ...metricsCache };
      if (expandedId === row.id) toggleExpand(row.id);
    } catch (e) { error = e.message || 'No se pudo ejecutar'; }
  }
  async function refreshMetrics(id) {
    delete metricsCache[id];
    metricsCache = { ...metricsCache };
    const m = await api.get(`/collection-windows/${id}/metrics`);
    metricsCache[id] = m;
    metricsCache = { ...metricsCache };
  }

  function statusOf(row) {
    const now = Date.now();
    const s = new Date(row.startDate).getTime();
    const e = new Date(row.endDate).getTime();
    if (!row.isActive)     return { label: 'Inactiva',     cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    if (now < s)           return { label: 'Programada',   cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (now > e)           return { label: 'Finalizada',   cls: 'bg-slate-100 text-slate-500 border-slate-200' };
    return                       { label: 'En curso',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
</script>

<svelte:head><title>Ventanas de cobranza — ISP Manager</title></svelte:head>

<!-- Header -->
<div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
      <Zap size={20} class="text-brand-600" />
      Ventanas de cobranza
    </h1>
    <p class="text-sm text-text-muted mt-0.5">
      Períodos durante los cuales la campaña automática envía recordatorios a deudores.
    </p>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary" on:click={load} disabled={loading}>
      {#if loading}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
      Recargar
    </button>
    <a href="/invoices" class="btn-secondary">
      <ArrowLeft size={14} /> Facturas
    </a>
    <button class="btn-primary" on:click={openCreate}>
      <Plus size={14} /> Crear ventana
    </button>
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
      <Loader2 size={18} class="animate-spin" /> Cargando…
    </div>
  {:else if rows.length === 0}
    <div class="p-12 text-center">
      <div class="w-14 h-14 rounded-2xl bg-slate-100 mx-auto mb-3 flex items-center justify-center">
        <Calendar size={24} class="text-slate-400" />
      </div>
      <p class="text-sm font-semibold text-text-primary">Aún no hay ventanas configuradas</p>
      <p class="text-xs text-text-muted mt-1">
        Crea una ventana para que la campaña automática mande recordatorios durante esos días.
      </p>
      <button class="btn-primary inline-flex mt-4" on:click={openCreate}>
        <Plus size={14} /> Crear ventana
      </button>
    </div>
  {:else}
    <div class="divide-y divide-slate-100">
      {#each rows as row (row.id)}
        {@const isOpen = expandedId === row.id}
        {@const st = statusOf(row)}
        {@const isLive = row.id === activeWindowId}
        <div class={isLive ? 'bg-emerald-50/30' : ''}>
          <!-- Row header -->
          <div class="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/40">
            <button type="button" on:click={() => toggleExpand(row.id)}
                    class="flex-shrink-0 w-6 h-6 inline-flex items-center justify-center rounded hover:bg-slate-100">
              {#if isOpen}<ChevronDown size={14} class="text-text-muted" />{:else}<ChevronRight size={14} class="text-text-muted" />{/if}
            </button>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold text-text-primary">{row.name}</span>
                <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium {st.cls}">{st.label}</span>
                {#if isLive}
                  <span class="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>EN CURSO
                  </span>
                {/if}
              </div>
              <div class="text-xs text-text-muted mt-0.5">
                {fmtDate(row.startDate)} → {fmtDate(row.endDate)} · cada {row.sendFrequencyHours}h
              </div>
              <div class="flex items-center gap-1.5 mt-1.5">
                {#each row.channels as ch}
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-medium text-slate-600">
                    {#if ch === 'EMAIL'}<Mail size={9} />Email{:else if ch === 'WHATSAPP'}<MessageSquare size={9} />WhatsApp{:else}<Send size={9} />Telegram{/if}
                  </span>
                {/each}
                {#each row.targetStatuses as s}
                  <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">{s}</span>
                {/each}
              </div>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0">
              <button class="btn-icon" title="Lanzar ahora" on:click={() => runNow(row)}><Play size={13} /></button>
              <button class="btn-icon" title="Editar"      on:click={() => openEdit(row)}><Edit3 size={13} /></button>
              <button class="btn-icon" title="Eliminar"    on:click={() => deleteRow(row)}><Trash2 size={13} /></button>
            </div>
          </div>

          <!-- Metrics expansion -->
          {#if isOpen}
            <div class="px-4 pb-4 pt-1 bg-slate-50/40 border-t border-slate-100">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-xs font-semibold text-text-secondary uppercase tracking-wider">Métricas de la ventana</h4>
                <button class="text-xs text-brand-700 hover:underline inline-flex items-center gap-1" on:click={() => refreshMetrics(row.id)}>
                  <RefreshCw size={11} /> Refrescar
                </button>
              </div>
              {#if !metricsCache[row.id]}
                <div class="flex items-center gap-2 text-xs text-text-muted py-3">
                  <Loader2 size={12} class="animate-spin" /> Calculando…
                </div>
              {:else if metricsCache[row.id].error}
                <div class="text-xs text-red-600">{metricsCache[row.id].error}</div>
              {:else}
                {@const m = metricsCache[row.id]}
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div class="rounded-lg bg-white border border-slate-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Invitados</div>
                    <div class="text-base font-bold text-text-primary tabular-nums">{m.invitedCount}</div>
                  </div>
                  <div class="rounded-lg bg-white border border-slate-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Enviados</div>
                    <div class="text-base font-bold text-emerald-700 tabular-nums">{m.sentCount}</div>
                    {#if m.failedCount > 0}<div class="text-[10px] text-red-600">{m.failedCount} fallidos</div>{/if}
                  </div>
                  <div class="rounded-lg bg-white border border-slate-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Pagaron</div>
                    <div class="text-base font-bold text-text-primary tabular-nums">{m.paidCount}</div>
                    <div class="text-[10px] text-text-muted font-mono">{fmtMoney(m.paidAmount)}</div>
                  </div>
                  <div class="rounded-lg bg-white border border-slate-200 px-3 py-2">
                    <div class="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Conversión</div>
                    <div class="text-base font-bold text-brand-700 tabular-nums">{m.conversionPct}%</div>
                  </div>
                </div>
                {#if Object.keys(m.sentByChannel || {}).length > 0}
                  <div class="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span class="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Por canal:</span>
                    {#each Object.entries(m.sentByChannel) as [k, v]}
                      <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-medium text-slate-700">
                        {k}: <strong class="tabular-nums">{v}</strong>
                      </span>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Modal — create / edit -->
{#if modalOpen}
  <div class="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
       on:click|self={() => modalOpen = false}
       role="dialog" aria-label="Editar ventana">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 sm:my-0 max-h-[95vh] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
        <h3 class="font-semibold text-text-primary text-base flex items-center gap-2">
          <Zap size={18} class="text-brand-600" />
          {editingId ? 'Editar ventana' : 'Nueva ventana de cobranza'}
        </h3>
        <button class="btn-icon" on:click={() => modalOpen = false} disabled={saving}>✕</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <label class="label" for="cw-name">Nombre <span class="text-red-500">*</span></label>
          <input id="cw-name" class="input" type="text" bind:value={form.name} placeholder="Ej: Cierre Junio 2026" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="cw-start">Inicio <span class="text-red-500">*</span></label>
            <input id="cw-start" class="input" type="datetime-local" bind:value={form.startDate} />
          </div>
          <div>
            <label class="label" for="cw-end">Fin <span class="text-red-500">*</span></label>
            <input id="cw-end" class="input" type="datetime-local" bind:value={form.endDate} />
          </div>
        </div>

        <div>
          <div class="label !mb-1.5">Canales</div>
          <div class="flex items-center gap-2 flex-wrap">
            {#each [['EMAIL','Email'],['WHATSAPP','WhatsApp'],['TELEGRAM','Telegram']] as [v, l]}
              {@const on = form.channels.includes(v)}
              <button type="button" on:click={() => toggleChannel(v)}
                      class="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
                             {on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'}">
                {l}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <div class="label !mb-1.5">Estados objetivo</div>
          <div class="flex items-center gap-2 flex-wrap">
            {#each [['PENDING','Pendiente'],['OVERDUE','Vencida'],['PARTIAL','Parcial']] as [v, l]}
              {@const on = form.targetStatuses.includes(v)}
              <button type="button" on:click={() => toggleStatus(v)}
                      class="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
                             {on ? 'border-red-400 bg-red-50 text-red-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'}">
                {l}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <label class="label" for="cw-freq">Frecuencia entre envíos (horas)</label>
          <input id="cw-freq" class="input" type="number" min="1" max="168" bind:value={form.sendFrequencyHours} />
          <p class="text-[11px] text-text-muted mt-1">
            Espacio mínimo entre dos recordatorios al mismo cliente. 24 = un envío por día.
          </p>
        </div>

        <div>
          <label class="label" for="cw-tpl">Plantilla del mensaje</label>
          <textarea id="cw-tpl" class="input resize-none" rows="4" bind:value={form.messageTemplate}></textarea>
          <p class="text-[11px] text-text-muted mt-1">
            Placeholders disponibles: <code class="font-mono">&#123;name&#125;</code>, <code class="font-mono">&#123;amount&#125;</code>, <code class="font-mono">&#123;dueDate&#125;</code>, <code class="font-mono">&#123;invoiceCount&#125;</code>.
          </p>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={form.isActive}
                 class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
          <span class="text-sm">Activa</span>
        </label>
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
        <button class="btn-secondary" on:click={() => modalOpen = false} disabled={saving}>Cancelar</button>
        <button class="btn-primary" on:click={submit} disabled={saving}>
          {#if saving}<Loader2 size={14} class="animate-spin" />{:else}<CheckCircle2 size={14} />{/if}
          {editingId ? 'Guardar cambios' : 'Crear ventana'}
        </button>
      </div>
    </div>
  </div>
{/if}
