<script>
  import { onMount, onDestroy } from 'svelte';
  import { networkApi } from '$lib/api/network.api.js';
  import { ensureSocket, deviceEvents } from '$lib/stores/socket.store.js';
  import { toastStore as toasts } from '$lib/stores/toast.store.js';
  import { ArrowLeft, Download, Filter, RotateCw } from 'lucide-svelte';

  /** @type {any[]} */
  let events = [];
  /** @type {any[]} */
  let devices = [];
  let loading = true;

  // Filters
  let f = { deviceId: '', status: '', from: '', to: '' };

  const STATUSES = [
    { value: '',         label: 'Todos' },
    { value: 'ONLINE',   label: 'Online' },
    { value: 'OFFLINE',  label: 'Offline' },
    { value: 'UNSTABLE', label: 'Inestable' },
    { value: 'UNKNOWN',  label: 'Desconocido' }
  ];

  function buildQuery() {
    /** @type {Record<string, any>} */
    const q = {};
    if (f.deviceId) q.deviceId = f.deviceId;
    if (f.status)   q.status   = f.status;
    if (f.from)     q.from     = new Date(f.from).toISOString();
    if (f.to)       q.to       = new Date(f.to).toISOString();
    return q;
  }

  async function refresh() {
    loading = true;
    try {
      events = await networkApi.listEvents(buildQuery());
    } catch (/** @type {any} */ e) {
      toasts.error(e.message);
    } finally {
      loading = false;
    }
  }

  async function loadDevices() {
    try {
      devices = await networkApi.listDevices();
    } catch {}
  }

  function downloadCsv() {
    const url = networkApi.csvUrl(buildQuery());
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `network-events-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(e => toasts.error('CSV: ' + e.message));
  }

  /** @type {(() => void) | undefined} */
  let unsub;
  onMount(async () => {
    ensureSocket();
    unsub = deviceEvents.subscribe((e) => { if (e) refresh(); });
    await Promise.all([loadDevices(), refresh()]);
  });
  onDestroy(() => unsub?.());

  /** @param {string|Date} d */
  function fmt(d) {
    return new Date(d).toLocaleString();
  }
  /** @param {string} [s] */
  function statusClass(s) { return 'status-' + (s||'unknown').toLowerCase(); }
</script>

<svelte:head>
  <title>Historial de Red — ISP Manager</title>
</svelte:head>

<div class="page">
  <div class="header">
    <div>
      <a href="/network" class="back"><ArrowLeft size={14} /> Mapa</a>
      <h1>Historial de Eventos</h1>
      <p class="subtitle">Transiciones de estado de los dispositivos del mapa.</p>
    </div>
    <div class="header-actions">
      <button class="btn-ghost" on:click={refresh}><RotateCw size={14} /> Refrescar</button>
      <button class="btn-primary" on:click={downloadCsv}><Download size={14} /> Exportar CSV</button>
    </div>
  </div>

  <div class="filters">
    <div class="filter-icon"><Filter size={14} /> Filtros</div>
    <select bind:value={f.deviceId} on:change={refresh}>
      <option value="">Todos los dispositivos</option>
      {#each devices as d}
        <option value={d.id}>{d.name} ({d.ip})</option>
      {/each}
    </select>
    <select bind:value={f.status} on:change={refresh}>
      {#each STATUSES as s}<option value={s.value}>{s.label}</option>{/each}
    </select>
    <label class="date">
      <span>Desde</span>
      <input type="datetime-local" bind:value={f.from} on:change={refresh} />
    </label>
    <label class="date">
      <span>Hasta</span>
      <input type="datetime-local" bind:value={f.to} on:change={refresh} />
    </label>
  </div>

  {#if loading && events.length === 0}
    <div class="empty">Cargando…</div>
  {:else if events.length === 0}
    <div class="empty">Sin eventos para los filtros seleccionados.</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Dispositivo</th>
            <th>IP</th>
            <th>Zona</th>
            <th>Estado</th>
            <th>Latencia</th>
            <th>Pérdida</th>
            <th>Mensaje</th>
            <th>Notificado</th>
          </tr>
        </thead>
        <tbody>
          {#each events as e}
            <tr>
              <td class="mono">{fmt(e.createdAt)}</td>
              <td><b>{e.device?.name || '—'}</b></td>
              <td class="mono">{e.device?.ip || '—'}</td>
              <td>{e.device?.zone?.name || '—'}</td>
              <td><span class="badge {statusClass(e.status)}">{e.status}</span></td>
              <td class="mono">{e.latency != null ? Math.round(e.latency) + ' ms' : '—'}</td>
              <td class="mono">{e.loss != null ? Math.round(e.loss) + '%' : '—'}</td>
              <td>{e.message || ''}</td>
              <td>{e.notified ? '✓' : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page { padding: 1.5rem; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 1rem; }
  .back { display: inline-flex; align-items: center; gap: 4px; font-size: 0.8rem; color: #64748b; text-decoration: none; margin-bottom: 4px; }
  .back:hover { color: #0f172a; }
  h1 { font-size: 1.5rem; font-weight: 700; color: #0f172a; }
  .subtitle { font-size: 0.85rem; color: #64748b; margin-top: 2px; }
  .header-actions { display: flex; gap: 6px; }

  .btn-ghost, .btn-primary {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: 8px; font-size: 0.8rem; font-weight: 500;
    border: 1px solid #e2e8f0; background: white; color: #334155; cursor: pointer;
  }
  .btn-primary { background: #2C4EC7; color: white; border-color: #2C4EC7; }

  .filters {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    background: white; padding: 0.75rem; border-radius: 10px; margin-bottom: 1rem;
    border: 1px solid #e2e8f0;
  }
  .filter-icon { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #64748b; font-weight: 600; }
  .filters select, .filters input { padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.8rem; background: white; }
  .filters .date { display: flex; flex-direction: column; gap: 2px; font-size: 0.7rem; color: #64748b; }

  .empty { background: white; padding: 3rem; border-radius: 10px; text-align: center; color: #64748b; border: 1px dashed #cbd5e1; }
  .table-wrap { background: white; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 10px 14px; text-align: left; font-size: 0.8rem; border-bottom: 1px solid #f1f5f9; }
  th { background: #f8fafc; color: #475569; font-weight: 600; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; }
  tr:hover { background: #f8fafc; }
  .mono { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.75rem; color: #475569; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 600; }
  .badge.status-online   { background: #dcfce7; color: #15803d; }
  .badge.status-offline  { background: #fee2e2; color: #b91c1c; }
  .badge.status-unstable { background: #fef3c7; color: #b45309; }
  .badge.status-unknown  { background: #f1f5f9; color: #64748b; }
</style>
