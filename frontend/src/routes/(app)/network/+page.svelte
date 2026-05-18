<script>
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import {
    SvelteFlow, Controls, Background
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { networkApi } from '$lib/api/network.api.js';
  import { zonesApi } from '$lib/api/zones.api.js';
  import { ensureSocket, deviceUpdates, deviceEvents, socketStatus } from '$lib/stores/socket.store.js';
  import { toastStore as toasts } from '$lib/stores/toast.store.js';
  import DeviceNode from '$lib/components/network/DeviceNode.svelte';
  import ZoneTabs from '$lib/components/network/ZoneTabs.svelte';
  import {
    Plus, RefreshCw, Trash2, Pencil, X, Wifi, History as HistoryIcon,
    Settings, Activity, CircleDot
  } from 'lucide-svelte';

  const nodeTypes = { device: DeviceNode };

  const nodes = writable([]);
  const edges = writable([]);

  let devices = [];           // raw devices from API (id-indexed via map)
  let devicesById = new Map();
  let connections = [];       // raw NetworkConnection rows
  let selectedId = null;
  let loading = true;

  // Zones / tabs
  let zones = [];             // [{ id, name, color, _count }]
  let activeZoneTab = 'all';  // 'all' | 'none' | Int

  // CRUD modal state
  let formOpen = false;
  let editing = null;         // null = create mode; object = edit
  let form = { name: '', ip: '', type: 'ROUTER', notes: '', zoneId: null };
  let saving = false;
  let formError = '';

  const DEVICE_TYPES = [
    { value: 'ROUTER',  label: 'Router MikroTik' },
    { value: 'ANTENNA', label: 'Antena / AP' },
    { value: 'SWITCH',  label: 'Switch' },
    { value: 'ONT',     label: 'ONT / CPE' },
    { value: 'SERVER',  label: 'Servidor' },
    { value: 'OTHER',   label: 'Otro' }
  ];
  const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

  // ── Edge color from device statuses ───────────────────────
  function edgeColor(sourceId, targetId) {
    const s = devicesById.get(sourceId)?.status;
    const t = devicesById.get(targetId)?.status;
    if (s === 'OFFLINE' || t === 'OFFLINE') return '#dc2626';   // red
    if (s === 'UNSTABLE' || t === 'UNSTABLE') return '#f59e0b'; // yellow
    if (s === 'ONLINE' && t === 'ONLINE') return '#16a34a';     // green
    return '#94a3b8';                                            // gray
  }

  function toNode(d) {
    return {
      id: d.id,
      type: 'device',
      position: { x: d.posX, y: d.posY },
      data: d,
      selected: d.id === selectedId
    };
  }

  function toEdge(c) {
    return {
      id: c.id,
      source: c.sourceId,
      target: c.targetId,
      label: c.label || undefined,
      style: `stroke: ${edgeColor(c.sourceId, c.targetId)}; stroke-width: 2;`,
      animated: edgeColor(c.sourceId, c.targetId) === '#dc2626'
    };
  }

  // Returns true if device d should render in the current tab.
  function isInActiveTab(d) {
    if (activeZoneTab === 'all') return true;
    if (activeZoneTab === 'none') return d.zoneId == null;
    return d.zoneId === activeZoneTab;
  }

  // Apply filter: nodes whose device matches the tab, edges whose BOTH
  // endpoints survive the filter (so we don't leave dangling lines).
  function applyFilter() {
    const allowedIds = new Set(devices.filter(isInActiveTab).map(d => d.id));
    nodes.set(devices.filter(d => allowedIds.has(d.id)).map(toNode));
    edges.set(connections
      .filter(c => allowedIds.has(c.sourceId) && allowedIds.has(c.targetId))
      .map(toEdge));
  }

  function rebuildEdges(conns) {
    connections = conns;
    applyFilter();
  }

  $: tabCounts = (() => {
    const byZone = {};
    let none = 0;
    for (const d of devices) {
      if (d.zoneId == null) none++;
      else byZone[d.zoneId] = (byZone[d.zoneId] || 0) + 1;
    }
    return { all: devices.length, none, byZone };
  })();

  async function refresh() {
    loading = true;
    try {
      const [devs, conns, zns] = await Promise.all([
        networkApi.listDevices(),
        networkApi.listConnections(),
        zonesApi.getAll().catch(() => [])
      ]);
      devices = devs;
      devicesById = new Map(devs.map(d => [d.id, d]));
      connections = conns;
      zones = (zns || []).map(z => ({ id: z.id, name: z.name, color: z.color, _count: z._count }));
      applyFilter();
    } catch (e) {
      toasts.error('No se pudieron cargar los dispositivos: ' + e.message);
    } finally {
      loading = false;
    }
  }

  // ── Zone tabs handlers ────────────────────────────────────
  function handleSelectZone(e) {
    activeZoneTab = e.detail;
    applyFilter();
    syncUrl();
  }
  async function handleCreateZone(e) {
    try {
      const created = await zonesApi.create({ name: e.detail.name });
      zones = [...zones, { id: created.id, name: created.name, color: created.color }];
      activeZoneTab = created.id;
      applyFilter();
      syncUrl();
      toasts.success(`Zona "${created.name}" creada`);
    } catch (err) {
      toasts.error(err.message);
    }
  }
  async function handleRenameZone(e) {
    const { id, name } = e.detail;
    try {
      await zonesApi.update(id, { name });
      zones = zones.map(z => z.id === id ? { ...z, name } : z);
      toasts.success('Zona renombrada');
    } catch (err) {
      toasts.error(err.message);
    }
  }
  async function handleDeleteZone(e) {
    const { id } = e.detail;
    try {
      await zonesApi.remove(id);
      zones = zones.filter(z => z.id !== id);
      // Devices that pointed here will now have zoneId=null (Prisma SetNull
      // cascade on NetworkDevice.zoneId). Reload to reflect.
      if (activeZoneTab === id) activeZoneTab = 'all';
      await refresh();
      syncUrl();
      toasts.success('Zona eliminada');
    } catch (err) {
      toasts.error('No se pudo eliminar: ' + err.message);
    }
  }

  function syncUrl() {
    const url = new URL($page.url);
    if (activeZoneTab === 'all') url.searchParams.delete('zone');
    else url.searchParams.set('zone', String(activeZoneTab));
    goto(url.pathname + url.search, { replaceState: true, noScroll: true, keepFocus: true });
  }

  // ── Live updates from socket.io ───────────────────────────
  let updateUnsub, eventUnsub;

  function applyDeviceUpdate(u) {
    if (!u) return;
    const dev = devicesById.get(u.id);
    if (!dev) return;
    Object.assign(dev, {
      status: u.status,
      latency: u.latency,
      lastSeen: u.lastSeen
    });
    devicesById = new Map(devicesById);
    // Keep the in-memory devices list in sync so re-filters see fresh data.
    devices = devices.map(d => d.id === u.id ? { ...dev } : d);
    // Re-emit nodes so the data prop refreshes (immutable update).
    nodes.update(arr => arr.map(n => n.id === u.id
      ? { ...n, data: { ...n.data, status: u.status, latency: u.latency, lastSeen: u.lastSeen } }
      : n));
    // Re-color any edges touching this device.
    edges.update(arr => arr.map(e => (e.source === u.id || e.target === u.id)
      ? { ...e, style: `stroke: ${edgeColor(e.source, e.target)}; stroke-width: 2;`,
                animated: edgeColor(e.source, e.target) === '#dc2626' }
      : e));
  }

  // ── CRUD actions ──────────────────────────────────────────
  function openCreate() {
    editing = null;
    // Pre-fill zone with the active tab when it's a real zone.
    const presetZone = (typeof activeZoneTab === 'number') ? activeZoneTab : null;
    form = { name: '', ip: '', type: 'ROUTER', notes: '', zoneId: presetZone };
    formError = '';
    formOpen = true;
  }
  function openEdit(d) {
    editing = d;
    form = {
      name:   d.name,
      ip:     d.ip === '0.0.0.0' ? '' : d.ip,
      type:   d.type,
      notes:  d.notes || '',
      zoneId: d.zoneId ?? null
    };
    formError = '';
    formOpen = true;
  }
  async function saveForm() {
    formError = '';
    if (!form.name?.trim())      { formError = 'El nombre es obligatorio.'; return; }
    if (!IP_RE.test(form.ip))    { formError = 'IP inválida (ej. 192.168.1.1).'; return; }
    saving = true;
    try {
      if (editing) {
        await networkApi.updateDevice(editing.id, form);
        toasts.success('Dispositivo actualizado');
      } else {
        await networkApi.createDevice({ ...form, posX: 200 + Math.random()*200, posY: 100 + Math.random()*200 });
        toasts.success('Dispositivo creado');
      }
      formOpen = false;
      await refresh();
    } catch (e) {
      formError = e.message;
    } finally {
      saving = false;
    }
  }
  async function removeDevice(id) {
    if (!confirm('¿Eliminar este dispositivo del mapa?')) return;
    try {
      await networkApi.removeDevice(id);
      selectedId = null;
      await refresh();
      toasts.success('Dispositivo eliminado');
    } catch (e) {
      toasts.error(e.message);
    }
  }

  async function probeNow() {
    try {
      const r = await networkApi.probeNow();
      toasts.success(`Probe ejecutado: ${r.swept} nodos · ${r.transitions} cambios`);
    } catch (e) {
      toasts.error(e.message);
    }
  }

  // ── Svelte Flow callbacks ─────────────────────────────────
  // onNodeDragStop fires once when the user releases the node.
  async function handleNodeDragStop({ target }) {
    if (!target?.id) return;
    const n = $nodes.find(x => x.id === target.id);
    if (!n) return;
    try {
      await networkApi.updatePosition(target.id, n.position.x, n.position.y);
    } catch (e) {
      toasts.error('No se pudo guardar posición: ' + e.message);
    }
  }

  async function handleConnect({ source, target }) {
    if (!source || !target || source === target) return;
    try {
      const created = await networkApi.createConnection(source, target, null);
      edges.update(arr => [...arr, toEdge(created)]);
      toasts.success('Conexión creada');
    } catch (e) {
      toasts.error(e.message);
    }
  }

  async function handleEdgesDelete({ edges: deleted }) {
    for (const e of deleted) {
      try { await networkApi.removeConnection(e.id); } catch {}
    }
  }

  function handleSelectionChange({ nodes: selected }) {
    selectedId = selected?.[0]?.id ?? null;
  }

  // Double-click on a node opens the edit modal directly. We resolve the
  // device from devicesById so the modal sees the latest state (status,
  // latency, etc.) instead of a stale copy bundled in the node object.
  function handleNodeDoubleClick({ node }) {
    const dev = devicesById.get(node?.id);
    if (dev) openEdit(dev);
  }

  $: selectedDevice = selectedId ? devicesById.get(selectedId) : null;

  onMount(async () => {
    ensureSocket();
    updateUnsub = deviceUpdates.subscribe(applyDeviceUpdate);
    eventUnsub = deviceEvents.subscribe((evt) => {
      if (!evt) return;
      const d = devicesById.get(evt.deviceId);
      const name = d?.name || evt.deviceId;
      if (evt.status === 'OFFLINE') toasts.error(`🔴 ${name} cayó`);
      else if (evt.status === 'ONLINE') toasts.success(`✅ ${name} recuperado`);
    });
    // Restore tab from URL: ?zone=12, ?zone=none, ?zone=all
    const urlZone = $page.url.searchParams.get('zone');
    if (urlZone === 'none') activeZoneTab = 'none';
    else if (urlZone && !Number.isNaN(Number(urlZone))) activeZoneTab = Number(urlZone);
    await refresh();
  });

  onDestroy(() => {
    updateUnsub?.(); eventUnsub?.();
  });
</script>

<svelte:head>
  <title>Monitor de Red — ISP Manager</title>
</svelte:head>

<div class="page">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="title-block">
      <h1>Monitor de Red</h1>
      <span class="status-pill" class:online={$socketStatus === 'connected'}>
        <CircleDot size={10} /> {$socketStatus === 'connected' ? 'En vivo' : ($socketStatus === 'reconnecting' ? 'Reconectando…' : 'Desconectado')}
      </span>
    </div>

    <div class="actions">
      <a href="/network/events" class="btn-ghost"><HistoryIcon size={16} /> Historial</a>
      <a href="/network/settings" class="btn-ghost"><Settings size={16} /> Configuración</a>
      <button class="btn-ghost" on:click={probeNow}><Activity size={16} /> Probar ahora</button>
      <button class="btn-ghost" on:click={refresh}><RefreshCw size={16} /> Refrescar</button>
      <button class="btn-primary" on:click={openCreate}><Plus size={16} /> Agregar dispositivo</button>
    </div>
  </div>

  <!-- Canvas + side panel + bottom tabs -->
  <div class="workspace">
    <div class="canvas-wrap">
    <div class="canvas">
      {#if loading}
        <div class="empty">Cargando…</div>
      {:else if devices.length === 0}
        <div class="empty">
          <Wifi size={42} />
          <h2>Aún no hay dispositivos</h2>
          <p>Crea tu primer dispositivo para comenzar a mapear la red.</p>
          <button class="btn-primary" on:click={openCreate}><Plus size={16} /> Agregar dispositivo</button>
        </div>
      {/if}

      <SvelteFlow
        {nodes}
        {edges}
        {nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        snapGrid={[16, 16]}
        snapToGrid
        defaultEdgeOptions={{ type: 'smoothstep' }}
        connectionLineType="smoothstep"
        on:nodedragstop={(e) => handleNodeDragStop(e.detail)}
        on:connect={(e) => handleConnect(e.detail)}
        on:edgesdelete={(e) => handleEdgesDelete(e.detail)}
        on:selectionchange={(e) => handleSelectionChange(e.detail)}
        on:nodedblclick={(e) => handleNodeDoubleClick(e.detail)}
        deleteKey="Delete"
      >
        <Background gap={20} size={1} bgColor="#f8fafc" patternColor="#e2e8f0" />
        <Controls />
      </SvelteFlow>
    </div>

    <!-- Excel-like zone tabs at the bottom of the canvas -->
    <ZoneTabs
      {zones}
      activeId={activeZoneTab}
      counts={tabCounts}
      on:select={handleSelectZone}
      on:create={handleCreateZone}
      on:rename={handleRenameZone}
      on:delete={handleDeleteZone}
    />
    </div>

    <!-- Side panel -->
    {#if selectedDevice}
      <aside class="side-panel">
        <div class="sp-head">
          <div>
            <div class="sp-name">{selectedDevice.name}</div>
            <div class="sp-ip">{selectedDevice.ip}</div>
          </div>
          <button class="icon-btn" on:click={() => selectedId = null} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>

        <div class="sp-grid">
          <div><dt>Tipo</dt><dd>{selectedDevice.type}</dd></div>
          <div><dt>Estado</dt>
            <dd class="status-{(selectedDevice.status||'unknown').toLowerCase()}">
              {selectedDevice.status}
            </dd>
          </div>
          <div><dt>Latencia</dt>
            <dd>{selectedDevice.latency != null ? Math.round(selectedDevice.latency) + ' ms' : '—'}</dd>
          </div>
          <div><dt>Última conexión</dt>
            <dd>{selectedDevice.lastSeen ? new Date(selectedDevice.lastSeen).toLocaleString() : '—'}</dd>
          </div>
          {#if selectedDevice.zone?.name}
            <div><dt>Zona</dt><dd>{selectedDevice.zone.name}</dd></div>
          {/if}
        </div>

        {#if selectedDevice.notes}
          <div class="sp-notes">{selectedDevice.notes}</div>
        {/if}

        <div class="sp-actions">
          <button class="btn-ghost" on:click={() => openEdit(selectedDevice)}>
            <Pencil size={14} /> Editar
          </button>
          <button class="btn-danger" on:click={() => removeDevice(selectedDevice.id)}>
            <Trash2 size={14} /> Eliminar
          </button>
        </div>
      </aside>
    {/if}
  </div>
</div>

<!-- Create / Edit modal -->
{#if formOpen}
  <div class="modal-backdrop" on:click|self={() => formOpen = false} on:keydown role="button" tabindex="-1">
    <div class="modal">
      <div class="modal-head">
        <div>
          <h2>{editing ? 'Editar dispositivo' : 'Nuevo dispositivo'}</h2>
          {#if editing}
            <p class="modal-sub">
              <span class="status-badge status-{(editing.status||'unknown').toLowerCase()}">{editing.status}</span>
              {#if editing.latency != null}· {Math.round(editing.latency)} ms{/if}
            </p>
          {/if}
        </div>
        <button class="icon-btn" on:click={() => formOpen = false} aria-label="Cerrar"><X size={16} /></button>
      </div>

      <form on:submit|preventDefault={saveForm} class="modal-body">
        {#if formError}
          <div class="form-error">{formError}</div>
        {/if}

        <div class="grid-2">
          <label>
            <span>Nombre</span>
            <input bind:value={form.name} required placeholder="Torre-Centro" />
          </label>
          <label>
            <span>Tipo</span>
            <select bind:value={form.type}>
              {#each DEVICE_TYPES as t}<option value={t.value}>{t.label}</option>{/each}
            </select>
          </label>
        </div>

        <div class="grid-2">
          <label>
            <span>Dirección IP</span>
            <input bind:value={form.ip} required placeholder="10.2.2.1" inputmode="decimal" />
            <small class="hint">Solo IPv4. Se usa para los pings.</small>
          </label>
          <label>
            <span>Zona</span>
            <select bind:value={form.zoneId}>
              <option value={null}>— Sin clasificar —</option>
              {#each zones as z}<option value={z.id}>{z.name}</option>{/each}
            </select>
            <small class="hint">Agrupa en una "hoja" del libro.</small>
          </label>
        </div>

        <label>
          <span>Notas</span>
          <textarea bind:value={form.notes} rows="4" placeholder="Comentarios opcionales, zona, contacto, etc."></textarea>
        </label>

        <div class="modal-actions">
          {#if editing}
            <button type="button" class="btn-danger-ghost" on:click={() => { formOpen = false; removeDevice(editing.id); }}>
              <Trash2 size={14} /> Eliminar
            </button>
          {/if}
          <span class="flex-spacer"></span>
          <button type="button" class="btn-ghost" on:click={() => formOpen = false}>Cancelar</button>
          <button type="submit" class="btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .page { display: flex; flex-direction: column; height: calc(100vh - 1rem); }
  .toolbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.75rem 1rem; background: white; border-bottom: 1px solid #e2e8f0;
  }
  .title-block { display: flex; align-items: center; gap: 12px; }
  .title-block h1 { font-size: 1.25rem; font-weight: 700; color: #0f172a; }
  .status-pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 999px;
    font-size: 0.7rem; font-weight: 500;
    background: #fee2e2; color: #b91c1c;
  }
  .status-pill.online { background: #dcfce7; color: #15803d; }

  .actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .btn-ghost, .btn-primary, .btn-danger {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: 8px; font-size: 0.8rem; font-weight: 500;
    border: 1px solid #e2e8f0; background: white; color: #334155;
    cursor: pointer; transition: all 0.15s;
    text-decoration: none;
  }
  .btn-ghost:hover { background: #f8fafc; }
  .btn-primary {
    background: #2C4EC7; color: white; border-color: #2C4EC7;
  }
  .btn-primary:hover { background: #233dab; }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-danger {
    background: #dc2626; color: white; border-color: #dc2626;
  }
  .btn-danger:hover { background: #b91c1c; }

  .workspace { flex: 1; display: flex; min-height: 0; }
  .canvas-wrap { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .canvas { flex: 1; position: relative; background: #f8fafc; min-height: 0; }
  .empty {
    position: absolute; inset: 0; z-index: 5;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    color: #64748b; pointer-events: none;
  }
  .empty h2 { font-size: 1.125rem; font-weight: 600; color: #0f172a; pointer-events: auto; }
  .empty button { pointer-events: auto; }

  .side-panel {
    width: 320px; background: white; border-left: 1px solid #e2e8f0;
    display: flex; flex-direction: column; padding: 1rem; gap: 1rem;
    overflow-y: auto;
  }
  .sp-head { display: flex; align-items: start; justify-content: space-between; }
  .sp-name { font-weight: 600; font-size: 1rem; color: #0f172a; }
  .sp-ip { font-size: 0.8rem; color: #64748b; font-variant-numeric: tabular-nums; }
  .icon-btn { background: transparent; border: none; padding: 4px; color: #94a3b8; cursor: pointer; border-radius: 4px; }
  .icon-btn:hover { background: #f1f5f9; color: #0f172a; }

  .sp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .sp-grid > div { display: flex; flex-direction: column; gap: 2px; }
  .sp-grid dt { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
  .sp-grid dd { font-size: 0.85rem; color: #0f172a; font-weight: 500; }
  .sp-grid dd.status-online { color: #15803d; }
  .sp-grid dd.status-offline { color: #b91c1c; }
  .sp-grid dd.status-unstable { color: #b45309; }
  .sp-notes { font-size: 0.8rem; color: #475569; padding: 8px; background: #f8fafc; border-radius: 6px; }
  .sp-actions { display: flex; gap: 6px; margin-top: auto; }

  /* Modal */
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 50;
    background: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(2px);
    display: grid; place-items: center; padding: 1rem;
    animation: fadeIn 0.15s ease;
  }
  .modal {
    width: 100%; max-width: 480px;
    background: white; border-radius: 14px; overflow: hidden;
    box-shadow: 0 20px 50px -10px rgba(15, 23, 42, 0.35);
    animation: popIn 0.18s ease;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes popIn { from { opacity: 0; transform: translateY(8px) scale(.97) } to { opacity: 1; transform: none } }

  .modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 18px 12px; border-bottom: 1px solid #e2e8f0; }
  .modal-head h2 { font-size: 1.05rem; font-weight: 600; color: #0f172a; }
  .modal-sub { font-size: 0.75rem; color: #64748b; margin-top: 4px; display: flex; align-items: center; gap: 6px; }

  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em; }
  .status-badge.status-online   { background: #dcfce7; color: #15803d; }
  .status-badge.status-offline  { background: #fee2e2; color: #b91c1c; }
  .status-badge.status-unstable { background: #fef3c7; color: #b45309; }
  .status-badge.status-unknown  { background: #f1f5f9; color: #64748b; }

  .modal-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 14px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .modal-body label { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: #334155; font-weight: 600; }
  .modal-body input, .modal-body select, .modal-body textarea {
    padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px;
    font-size: 0.875rem; color: #0f172a; background: white;
    font-weight: 400;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .modal-body textarea { resize: vertical; font-family: inherit; }
  .modal-body input:focus, .modal-body select:focus, .modal-body textarea:focus {
    outline: none; border-color: #2C4EC7; box-shadow: 0 0 0 3px rgba(44, 78, 199, 0.15);
  }
  .hint { font-size: 0.7rem; color: #94a3b8; font-weight: 400; margin-top: 2px; }

  .form-error {
    padding: 8px 12px;
    background: #fee2e2; border: 1px solid #fecaca;
    color: #991b1b; font-size: 0.78rem; font-weight: 500;
    border-radius: 8px;
  }

  .modal-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; padding-top: 6px; border-top: 1px solid #f1f5f9; }
  .flex-spacer { flex: 1; }
  .btn-danger-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 500;
    background: transparent; border: 1px solid transparent;
    color: #b91c1c; cursor: pointer;
  }
  .btn-danger-ghost:hover { background: #fee2e2; }
</style>
