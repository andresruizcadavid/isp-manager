<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    Loader2, AlertCircle, CheckCircle2, Play, RefreshCw, Download,
    Trash2, Save, Calendar, HardDrive, Clock, AlertTriangle
  } from 'lucide-svelte';

  /** @type {import('$lib/types').Router[]} */
  let routers = [];
  /** @type {number | null} */
  let routerId = null;
  /** @type {any} */
  let schedule = null;
  /** @type {any[]} */
  let backups = [];
  let loading = true;
  let saving = false;
  let runningBackup = false;
  let error = '';

  // Local form state — flushed to backend on "Guardar".
  let form = {
    isActive: true,
    cronExpression: '0 3 * * *',
    retentionCount: 30
  };

  const CRON_PRESETS = [
    { label: 'Diario · 03:00',         value: '0 3 * * *'  },
    { label: 'Cada 6 horas',           value: '0 */6 * * *'},
    { label: 'Lunes 03:00 (semanal)',  value: '0 3 * * 1'  },
    { label: 'Día 1 de mes 03:00',     value: '0 3 1 * *'  }
  ];

  async function loadRouters() {
    try {
      const list = await routersApi.getAll();
      routers = Array.isArray(list) ? list : (list?.data || []);
      if (!routerId && routers.length) routerId = routers[0].id;
    } catch (/** @type {any} */ e) { error = e.message; }
  }

  /** @param {number|null} rid */
  async function loadFor(rid) {
    if (!rid) return;
    loading = true; error = '';
    try {
      const [sched, list] = await Promise.all([
        api.get(`/backups/schedules/${rid}`).catch(() => ({ data: null })),
        api.get(`/backups?routerId=${rid}`)
      ]);
      schedule = sched;
      backups  = Array.isArray(list) ? list : (list?.data || list || []);
      if (schedule) {
        form = {
          isActive:       !!schedule.isActive,
          cronExpression: schedule.cronExpression || '0 3 * * *',
          retentionCount: schedule.retentionCount || 30
        };
      } else {
        form = { isActive: true, cronExpression: '0 3 * * *', retentionCount: 30 };
      }
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo cargar';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    await loadRouters();
    if (routerId) await loadFor(routerId);
  });
  $: if (routerId) loadFor(routerId);

  async function saveSchedule() {
    if (!routerId) return;
    saving = true; error = '';
    try {
      await api.put(`/backups/schedules/${routerId}`, {
        cronExpression: form.cronExpression,
        isActive:       form.isActive,
        retentionCount: Number(form.retentionCount)
      });
      await loadFor(routerId);
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo guardar';
    } finally { saving = false; }
  }

  async function runNow() {
    if (!routerId) return;
    if (!confirm('Lanzar un backup ahora contra este router?')) return;
    runningBackup = true; error = '';
    try {
      await api.post(`/backups/run/${routerId}`, {});
      await loadFor(routerId);
    } catch (/** @type {any} */ e) {
      error = e.message || 'Backup falló';
    } finally { runningBackup = false; }
  }

  /** @param {string} id */
  async function deleteRow(id) {
    if (!confirm('Eliminar este backup?')) return;
    try {
      await api.delete(`/backups/${id}`);
      await loadFor(routerId);
    } catch (/** @type {any} */ e) { error = e.message; }
  }

  /** @param {string} id @param {string} [name] */
  function downloadRow(id, name) {
    // Stream download — open in same tab; browser handles Content-Disposition.
    window.location.href = `/api/v1/backups/${id}/download`;
  }

  /** @param {number|null|undefined} n */
  function fmtBytes(n) {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n/1024).toFixed(1)} KB`;
    return `${(n/1024/1024).toFixed(2)} MB`;
  }
  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
  /** @param {string} s */
  function statusBadge(s) {
    if (s === 'success') return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '✓ OK' };
    if (s === 'failed')  return { cls: 'bg-red-50 text-red-700 border-red-200',           label: '✗ Falló' };
    if (s === 'pending') return { cls: 'bg-amber-50 text-amber-700 border-amber-200',     label: '… En curso' };
    return { cls: 'bg-slate-100 text-slate-600 border-slate-200', label: s };
  }

  // Compose the operator-friendly description of the cron expression.
  /** @param {string} expr */
  function cronExplain(expr) {
    const p = CRON_PRESETS.find(p => p.value === expr);
    return p ? p.label : expr;
  }
</script>

<svelte:head><title>Backup MikroTik — ISP Manager</title></svelte:head>

<div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
      <HardDrive size={20} class="text-brand-600" />
      Backup MikroTik
    </h1>
    <p class="text-sm text-text-muted mt-0.5">
      Exporta la configuración (.rsc) por SSH/SCP y la guarda en el server.
    </p>
  </div>
  <div class="flex items-center gap-2">
    <select bind:value={routerId} class="text-sm rounded-md border border-slate-200 bg-white py-1.5 px-3">
      {#each routers as r}
        <option value={r.id}>{r.name}</option>
      {/each}
    </select>
    <button class="btn-secondary" on:click={() => loadFor(routerId)} disabled={loading}>
      {#if loading}<Loader2 size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
      Recargar
    </button>
  </div>
</div>

{#if error}
  <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4 flex items-center gap-2">
    <AlertCircle size={14} /> {error}
  </div>
{/if}

{#if !routerId}
  <div class="card p-12 text-center">
    <AlertTriangle size={24} class="text-amber-500 mx-auto mb-2" />
    <p class="text-sm text-text-secondary">No hay routers configurados. Agregá uno en <a href="/mikrotik/routers" class="text-brand-700 hover:underline">Routers / NOC</a> antes de programar backups.</p>
  </div>
{:else}

<!-- Schedule editor -->
<div class="card mb-4">
  <div class="card-header">
    <div class="flex items-center gap-2">
      <Calendar size={16} class="text-brand-600" />
      <h2 class="font-semibold text-text-primary text-base">Programación</h2>
    </div>
  </div>
  <div class="card-body grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div>
      <label class="label" for="cron">Expresión cron</label>
      <select id="cron" bind:value={form.cronExpression} class="select">
        {#each CRON_PRESETS as p}
          <option value={p.value}>{p.label}  ·  {p.value}</option>
        {/each}
        {#if !CRON_PRESETS.find(p => p.value === form.cronExpression)}
          <option value={form.cronExpression}>{form.cronExpression} (custom)</option>
        {/if}
      </select>
      <p class="text-[11px] text-text-muted mt-1 font-mono">{form.cronExpression}</p>
    </div>
    <div>
      <label class="label" for="retention">Retención (últimos N)</label>
      <input id="retention" type="number" min="1" max="365" class="input"
             bind:value={form.retentionCount} />
      <p class="text-[11px] text-text-muted mt-1">Backups más viejos se eliminan automáticamente.</p>
    </div>
    <div class="flex flex-col gap-2">
      <label class="inline-flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30"
               bind:checked={form.isActive} />
        <span>Programación activa</span>
      </label>
      {#if schedule?.nextRunAt}
        <div class="text-xs text-text-secondary">
          <Clock size={11} class="inline" />
          Próximo: <strong class="text-text-primary">{fmtDate(schedule.nextRunAt)}</strong>
        </div>
      {/if}
      {#if schedule?.lastRunAt}
        <div class="text-xs text-text-muted">
          Último: {fmtDate(schedule.lastRunAt)}
        </div>
      {/if}
    </div>
  </div>
  <div class="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-end gap-2">
    <button class="btn-secondary" on:click={runNow} disabled={runningBackup}>
      {#if runningBackup}<Loader2 size={14} class="animate-spin" />{:else}<Play size={14} />{/if}
      Lanzar ahora
    </button>
    <button class="btn-primary" on:click={saveSchedule} disabled={saving}>
      {#if saving}<Loader2 size={14} class="animate-spin" />{:else}<Save size={14} />{/if}
      Guardar
    </button>
  </div>
</div>

<!-- Backups list -->
<div class="card">
  <div class="card-header">
    <h2 class="font-semibold text-text-primary text-base">Historial ({backups.length})</h2>
  </div>
  {#if loading && backups.length === 0}
    <div class="p-10 flex items-center justify-center gap-2 text-text-secondary">
      <Loader2 size={18} class="animate-spin" /> Cargando…
    </div>
  {:else if backups.length === 0}
    <div class="p-10 text-center">
      <HardDrive size={32} class="text-slate-300 mx-auto mb-2" />
      <p class="text-sm text-text-secondary">Aún no hay backups para este router.</p>
      <p class="text-xs text-text-muted mt-1">Lanzá uno manual o esperá al próximo run programado.</p>
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead class="bg-slate-50 text-text-secondary uppercase tracking-wider text-[10px] font-semibold">
          <tr>
            <th class="text-left px-4 py-2">Fecha</th>
            <th class="text-left px-2 py-2">Trigger</th>
            <th class="text-left px-2 py-2">Estado</th>
            <th class="text-right px-2 py-2">Tamaño</th>
            <th class="text-left px-2 py-2">Operador</th>
            <th class="text-right px-2 py-2">Acción</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#each backups as b}
            {@const st = statusBadge(b.status)}
            <tr>
              <td class="px-4 py-2 font-mono">{fmtDate(b.startedAt)}</td>
              <td class="px-2 py-2">
                <span class="text-[10px] uppercase tracking-wider font-medium text-text-muted">{b.triggeredBy}</span>
              </td>
              <td class="px-2 py-2">
                <span class="inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium {st.cls}">{st.label}</span>
                {#if b.errorMessage}
                  <div class="text-[10px] text-red-600 mt-0.5 max-w-[280px] truncate" title={b.errorMessage}>{b.errorMessage}</div>
                {/if}
              </td>
              <td class="px-2 py-2 text-right tabular-nums">{fmtBytes(b.sizeBytes)}</td>
              <td class="px-2 py-2 text-text-secondary">{b.createdBy?.name || (b.triggeredBy === 'cron' ? 'cron' : '—')}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">
                {#if b.status === 'success'}
                  <button class="btn-icon" title="Descargar"
                          on:click={() => downloadRow(b.id, b.fileName)}>
                    <Download size={13} />
                  </button>
                {/if}
                <button class="btn-icon" title="Eliminar" on:click={() => deleteRow(b.id)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{/if}
