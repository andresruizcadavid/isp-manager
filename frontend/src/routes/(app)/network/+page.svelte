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
    Settings, Activity, CircleDot, Check, Clock, Loader2, AlertCircle
  } from 'lucide-svelte';

  const nodeTypes = { device: DeviceNode };

  // Canvas bounds: hard origin at (0,0) so the operator can't pan or place
  // nodes into negative coords (which felt like "getting lost in empty
  // space"). Right and bottom stay open — the canvas keeps growing.
  // Number.POSITIVE_INFINITY is what SvelteFlow accepts for "no limit".
  const ORIGIN = 0;
  const INF = Number.POSITIVE_INFINITY;
  const CANVAS_EXTENT = [[ORIGIN, ORIGIN], [INF, INF]];

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

  // Shared viewports (pan+zoom) per tab — persisted on the backend so every
  // user lands on the same framing. Keyed as 'all' / 'none' / 'zone:<id>'.
  // SvelteFlow's `viewport` prop expects a Writable store ($viewport is
  // dereferenced inside the component), not a plain object — passing a
  // POJO crashes the render. Hence writable() here.
  let savedViews = {};                 // key -> { posX, posY, zoom }
  const viewport = writable({ x: 0, y: 0, zoom: 1 });
  let viewportDirty = false;
  let viewportSaveTimer = null;
  let suppressViewportSave = false;

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
  // suppressSave guards the watcher: rebuilding the nodes store would
  // otherwise look like a position change and trigger spurious PATCHes.
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
      const [devs, conns, zns, views] = await Promise.all([
        networkApi.listDevices(),
        networkApi.listConnections(),
        zonesApi.getAll().catch(() => []),
        networkApi.listViews().catch(() => ({}))
      ]);
      // One-shot migration: any device sitting in negative coords (from
      // before the canvas had an origin) gets snapped to (0,0)-quadrant.
      // We persist the snap so a future reload doesn't re-do it.
      const snapped = [];
      for (const d of devs) {
        if (d.posX < 0 || d.posY < 0) {
          d.posX = Math.max(0, d.posX);
          d.posY = Math.max(0, d.posY);
          snapped.push(d);
        }
      }
      devices = devs;
      devicesById = new Map(devs.map(d => [d.id, d]));
      connections = conns;
      zones = (zns || []).map(z => ({ id: z.id, name: z.name, color: z.color, _count: z._count }));
      savedViews = views || {};
      applyFilter();
      // NOTE: do NOT restore the viewport here. refresh() is called after
      // create/edit/delete; if we re-snap the camera, the user would lose
      // their framing every time they touch a device. Viewport restoration
      // happens exclusively in onMount + handleSelectZone.
      // Best-effort persist of snapped positions (no toast on individual
      // failures — they'll snap again next load).
      for (const d of snapped) {
        networkApi.updatePosition(d.id, d.posX, d.posY).catch(() => {});
      }
    } catch (e) {
      toasts.error('No se pudieron cargar los dispositivos: ' + e.message);
    } finally {
      loading = false;
    }
  }

  // ── Viewport persistence (per tab, shared via DB) ────────
  function viewportKeyForTab(tab) {
    if (tab === 'all')  return 'all';
    if (tab === 'none') return 'none';
    return `zone:${tab}`;
  }

  // We DO NOT use SvelteFlow's `fitView` prop because it's reactive — any
  // change in our reactive state can re-trigger it and reset the camera
  // mid-session. Instead we always control the viewport ourselves:
  // restoreViewportForTab() runs at mount + on tab switch and either
  // applies the saved view or computes a one-time fit from the node
  // bounding box.

  function restoreViewportForTab(tab) {
    const key = viewportKeyForTab(tab);
    const v = savedViews[key];
    suppressViewportSave = true;
    if (v) {
      viewport.set({ x: v.posX, y: v.posY, zoom: v.zoom });
    } else {
      // Compute a one-time fit from the visible nodes' bounding box. We do
      // this here (not via SvelteFlow's reactive fitView prop) so it only
      // runs when we explicitly want it. The result is queued for persistence.
      const visible = devices.filter(isInActiveTab);
      if (visible.length > 0) {
        const xs = visible.map(d => d.posX);
        const ys = visible.map(d => d.posY);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs) + 200; // node width
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys) + 90;  // node height
        // Simple center+zoom: pick zoom that fits the bbox into the canvas
        // assuming ~1100x600 visible area. Padding 20%.
        const w = Math.max(maxX - minX, 1);
        const h = Math.max(maxY - minY, 1);
        const zoom = Math.min(1, 1100 / (w * 1.2), 600 / (h * 1.2));
        const x = -minX * zoom + 100;
        const y = -minY * zoom + 80;
        viewport.set({ x, y, zoom });
        // Persist this default so all users see the same first-load framing.
        savedViews = { ...savedViews, [key]: { posX: x, posY: y, zoom } };
        networkApi.saveView(key, x, y, zoom).catch(() => {});
      } else {
        viewport.set({ x: 0, y: 0, zoom: 1 });
      }
    }
    // Swallow the echo onMoveEnd that fires from the store change.
    setTimeout(() => { suppressViewportSave = false; }, 300);
  }

  function queueViewportSave({ x, y, zoom }) {
    if (suppressViewportSave) return;
    viewportDirty = true;
    if (viewportSaveTimer) clearTimeout(viewportSaveTimer);
    viewportSaveTimer = setTimeout(async () => {
      viewportSaveTimer = null;
      const key = viewportKeyForTab(activeZoneTab);
      try {
        await networkApi.saveView(key, x, y, zoom);
        savedViews = { ...savedViews, [key]: { posX: x, posY: y, zoom } };
        viewportDirty = false;
      } catch (e) {
        toasts.error('No se pudo guardar el encuadre del mapa: ' + e.message);
      }
    }, 400);
  }

  function handleMoveEnd(vp) {
    if (vp) queueViewportSave(vp);
  }

  // ── Zone tabs handlers ────────────────────────────────────
  function handleSelectZone(e) {
    activeZoneTab = e.detail;
    applyFilter();
    syncUrl();
    // Each tab has its own saved framing; restore it on switch.
    setTimeout(() => restoreViewportForTab(activeZoneTab), 50);
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
  // Pick a spawn position for a new device that always falls within the
  // (0,0)+ quadrant and doesn't overlap obvious neighbours. Walks a grid
  // until we find a slot 200px from any existing device on the active tab.
  function pickSpawnPosition() {
    const visible = devices.filter(isInActiveTab);
    const STEP = 200;
    const collides = (x, y) => visible.some(d => Math.abs(d.posX - x) < STEP && Math.abs(d.posY - y) < STEP);
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        const x = 80 + col * STEP;
        const y = 80 + row * STEP;
        if (!collides(x, y)) return { posX: x, posY: y };
      }
    }
    return { posX: 80, posY: 80 + visible.length * STEP };
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
        await networkApi.createDevice({ ...form, ...pickSpawnPosition() });
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

  // ── Position persistence ─────────────────────────────────
  // @xyflow/svelte 0.1.x fires nodedrag during the drag and nodedragstop
  // at release. Both carry { event, targetNode, nodes } with the live
  // position. We queue moves into pendingMoves and flush with a debounce
  // (longer while dragging, very short on release) so a flurry of small
  // drags collapses into one PATCH per node.
  //
  // syncState drives the visible indicator in the toolbar:
  //   synced   — nothing pending, last save OK
  //   dirty    — drag detected, waiting for debounce
  //   saving   — PATCH in flight
  //   error    — last save failed; pending stays queued for retry
  let syncState = 'synced';
  let syncError = '';
  let lastSavedAt = null;
  const pendingMoves = new Map();    // nodeId -> { x, y } latest desired position
  let flushTimer = null;

  function queueMove(id, x, y, { eager = false } = {}) {
    pendingMoves.set(id, { x, y });
    syncState = 'dirty';
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushMoves, eager ? 200 : 800);
  }

  async function flushMoves() {
    flushTimer = null;
    if (pendingMoves.size === 0) { syncState = 'synced'; return; }
    syncState = 'saving';
    syncError = '';
    const batch = Array.from(pendingMoves.entries());
    pendingMoves.clear();
    try {
      await Promise.all(batch.map(([id, { x, y }]) =>
        networkApi.updatePosition(id, x, y)
      ));
      // Mirror to in-memory copies so subsequent filter/refresh keeps the move.
      for (const [id, { x, y }] of batch) {
        const dev = devicesById.get(id);
        if (dev) { dev.posX = x; dev.posY = y; }
      }
      devices = devices.map(d => {
        const m = batch.find(([id]) => id === d.id);
        return m ? { ...d, posX: m[1].x, posY: m[1].y } : d;
      });
      lastSavedAt = new Date();
      syncState = pendingMoves.size > 0 ? 'dirty' : 'synced';
    } catch (e) {
      // Put the batch back so the next flush retries. The user sees "Error".
      for (const [id, pos] of batch) pendingMoves.set(id, pos);
      syncState = 'error';
      syncError = e.message;
    }
  }

  function handleNodeDrag({ targetNode }) {
    if (!targetNode?.id || !targetNode?.position) return;
    queueMove(targetNode.id, targetNode.position.x, targetNode.position.y);
  }
  function handleNodeDragStop({ targetNode }) {
    if (!targetNode?.id || !targetNode?.position) return;
    queueMove(targetNode.id, targetNode.position.x, targetNode.position.y, { eager: true });
  }

  // Belt-and-suspenders: even if neither nodedrag nor nodedragstop fires
  // cleanly (HMR edge cases, SvelteFlow internals), the store still ends up
  // with the new positions. We compare each tick against a "last known"
  // map and queue diffs. This catches keyboard moves and programmatic
  // updates too.
  const lastKnownPos = new Map();
  function startNodesPositionWatch() {
    nodes.subscribe((arr) => {
      if (!Array.isArray(arr)) return;
      for (const n of arr) {
        const prev = lastKnownPos.get(n.id);
        const cur  = n.position;
        if (!cur) continue;
        if (!prev) { lastKnownPos.set(n.id, { x: cur.x, y: cur.y }); continue; }
        if (prev.x !== cur.x || prev.y !== cur.y) {
          lastKnownPos.set(n.id, { x: cur.x, y: cur.y });
          // Skip if the device list already has this exact position (i.e.
          // we just re-rendered from a filter, not a real user move).
          const dev = devicesById.get(n.id);
          if (dev && dev.posX === cur.x && dev.posY === cur.y) continue;
          queueMove(n.id, cur.x, cur.y);
        }
      }
    });
  }

  // Effective sync state = max(node positions, viewport).
  // If either pieces is dirty, the chip shows "dirty"; saving wins over dirty;
  // error wins over saving (sticky until next successful flush).
  $: effectiveSync = (() => {
    if (syncState === 'error') return 'error';
    if (syncState === 'saving') return 'saving';
    if (syncState === 'dirty' || viewportDirty) return 'dirty';
    return 'synced';
  })();
  $: syncLabel = ({
    synced: lastSavedAt ? 'Guardado' : 'Sin cambios',
    dirty:  'Pendiente…',
    saving: 'Guardando…',
    error:  'Error al guardar'
  })[effectiveSync];
  $: syncTitle = (() => {
    if (effectiveSync === 'error') return `Último error: ${syncError}\nReintentará en el próximo movimiento.`;
    if (effectiveSync === 'saving') return 'Sincronizando con el servidor…';
    if (effectiveSync === 'dirty') {
      const parts = [];
      if (pendingMoves.size > 0) parts.push(`${pendingMoves.size} posición(es)`);
      if (viewportDirty) parts.push('encuadre del mapa');
      return parts.join(' + ') + ' por guardar.';
    }
    if (lastSavedAt) return `Último guardado: ${lastSavedAt.toLocaleTimeString()}\nPosiciones y encuadre se guardan automáticamente.`;
    return 'Posiciones de nodos y encuadre del mapa se guardan automáticamente.';
  })();

  // Connection is a PROP (onconnect), not an event. Receives the Connection
  // object directly: { source, target, sourceHandle, targetHandle }.
  async function onConnect(connection) {
    const { source, target } = connection || {};
    if (!source || !target || source === target) return;
    try {
      const created = await networkApi.createConnection(source, target, null);
      connections = [...connections, created];
      edges.update(arr => [...arr, toEdge(created)]);
      toasts.success('Conexión creada');
    } catch (e) {
      toasts.error(e.message);
    }
  }

  // Delete is also a PROP (ondelete). Payload: { nodes, edges }.
  // Handles BOTH edges deleted via the Delete key AND nodes deleted that
  // way (cascading their edges) — we persist the edge deletion explicitly
  // since SvelteFlow only mutates its in-memory copy.
  async function onDelete({ nodes: deletedNodes = [], edges: deletedEdges = [] }) {
    for (const e of deletedEdges) {
      try { await networkApi.removeConnection(e.id); } catch {}
    }
    for (const n of deletedNodes) {
      try { await networkApi.removeDevice(n.id); } catch {}
    }
    if (deletedNodes.length || deletedEdges.length) {
      await refresh();
    }
  }

  function handleSelectionChange({ nodes: selected }) {
    selectedId = selected?.[0]?.id ?? null;
  }

  // @xyflow/svelte 0.1.x emits 'nodeclick' but NOT 'nodedblclick'.
  // We synthesize double-click with a 350ms window between two clicks on
  // the same node id. Resolves device from devicesById so the modal sees
  // the latest status/latency, not a stale copy bundled in the node object.
  let _lastNodeClick = { id: null, t: 0 };
  function handleNodeClick({ node }) {
    if (!node?.id) return;
    const now = Date.now();
    const isDouble = _lastNodeClick.id === node.id && (now - _lastNodeClick.t) < 350;
    if (isDouble) {
      _lastNodeClick = { id: null, t: 0 };
      const dev = devicesById.get(node.id);
      if (dev) openEdit(dev);
    } else {
      _lastNodeClick = { id: node.id, t: now };
    }
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
    // Restore the viewport ONCE on first mount (refresh() doesn't touch it).
    setTimeout(() => restoreViewportForTab(activeZoneTab), 80);
    startNodesPositionWatch();
  });

  onDestroy(() => {
    updateUnsub?.(); eventUnsub?.();
    // Best-effort flush of any in-flight moves so a tab switch doesn't lose them.
    if (flushTimer) { clearTimeout(flushTimer); flushMoves(); }
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
      <!-- Sync indicator: covers BOTH node positions and map viewport. -->
      <span class="sync-chip sync-{effectiveSync}" title={syncTitle} aria-live="polite">
        {#if effectiveSync === 'synced'}
          <Check size={13} strokeWidth={2.5} /> {syncLabel}
        {:else if effectiveSync === 'dirty'}
          <Clock size={13} strokeWidth={2.5} /> {syncLabel}
        {:else if effectiveSync === 'saving'}
          <span class="spin"><Loader2 size={13} strokeWidth={2.5} /></span> {syncLabel}
        {:else if effectiveSync === 'error'}
          <AlertCircle size={13} strokeWidth={2.5} /> {syncLabel}
        {/if}
      </span>

      <a href="/network/events" class="btn-ghost" title="Ver historial de eventos"><HistoryIcon size={16} /> Historial</a>
      <a href="/network/settings" class="btn-ghost" title="Configurar alertas Telegram"><Settings size={16} /> Configuración</a>
      <button class="btn-ghost" on:click={probeNow} title="Ejecutar un ping manual ahora"><Activity size={16} /> Probar</button>
      <button class="btn-ghost" on:click={refresh} title="Recargar dispositivos desde el servidor"><RefreshCw size={16} /> Refrescar</button>
      <button class="btn-primary" on:click={openCreate} title="Añadir nuevo dispositivo"><Plus size={16} /> Nuevo</button>
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
        {viewport}
        minZoom={0.2}
        maxZoom={1.5}
        translateExtent={CANVAS_EXTENT}
        nodeExtent={CANVAS_EXTENT}
        onMoveEnd={(_, vp) => handleMoveEnd(vp)}
        snapGrid={[16, 16]}
        snapToGrid
        defaultEdgeOptions={{ type: 'smoothstep' }}
        connectionLineType="smoothstep"
        onconnect={onConnect}
        ondelete={onDelete}
        on:nodedrag={(e) => handleNodeDrag(e.detail)}
        on:nodedragstop={(e) => handleNodeDragStop(e.detail)}
        on:selectionchange={(e) => handleSelectionChange(e.detail)}
        on:nodeclick={(e) => handleNodeClick(e.detail)}
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
  /* Fill the parent <main> exactly. The main has padding (p-4 / sm:p-6) so
     we use negative margin to go edge-to-edge — the toolbar/tabs end up
     flush with the layout chrome, and nothing inside the canvas can push
     the toolbar off the viewport. min-height:0 lets workspace shrink. */
  .page {
    display: flex; flex-direction: column;
    height: 100%;
    min-height: 0;
    margin: -1rem;
    background: white;
    border-radius: 0;
    overflow: hidden;
  }
  @media (min-width: 640px) {
    .page { margin: -1.5rem; }
  }

  .toolbar {
    flex-shrink: 0;       /* stay pinned, never scroll */
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: nowrap;
    gap: 0.75rem;
    padding: 0.625rem 1rem;
    background: white;
    border-bottom: 1px solid #e2e8f0;
    z-index: 5;
    overflow-x: auto;      /* if window is narrower than content, scroll instead of wrap */
  }
  /* hide scrollbar but keep ability to scroll */
  .toolbar::-webkit-scrollbar { height: 4px; }
  .toolbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 2px; }
  .title-block {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;        /* don't compress the title when actions are wide */
  }
  .title-block h1 {
    font-size: 1.1rem;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;   /* "Monitor de Red" stays on one line */
  }
  .status-pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px; border-radius: 999px;
    font-size: 0.7rem; font-weight: 500;
    background: #fee2e2; color: #b91c1c;
  }
  .status-pill.online { background: #dcfce7; color: #15803d; }

  .actions {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: nowrap;     /* one row, always */
    flex-shrink: 0;
  }
  /* Subtle divider between the sync chip and the action buttons */
  .actions .sync-chip + .btn-ghost::before,
  .actions .sync-chip + a.btn-ghost::before {
    content: "";
    display: inline-block;
    width: 1px;
    height: 22px;
    background: #e2e8f0;
    margin: 0 6px 0 -2px;
    vertical-align: middle;
  }
  .actions .btn-ghost, .actions .btn-primary {
    white-space: nowrap;
  }

  /* Position autosave indicator */
  .sync-chip {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 9px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    border: 1px solid transparent;
    cursor: help;
    transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
    margin-right: 4px;
  }
  .sync-chip.sync-synced { background: #dcfce7; color: #15803d; border-color: #bbf7d0; }
  .sync-chip.sync-dirty  { background: #fef3c7; color: #b45309; border-color: #fde68a; }
  .sync-chip.sync-saving { background: #dbeafe; color: #1d4ed8; border-color: #bfdbfe; }
  .sync-chip.sync-error  { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
  .spin { display: inline-flex; animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
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

  .workspace { flex: 1; display: flex; min-height: 0; overflow: hidden; }
  /* grid 1fr auto: canvas always takes the leftover space, the tabs row
     keeps its natural height and never gets pushed below the viewport. */
  .canvas-wrap {
    flex: 1;
    display: grid;
    grid-template-rows: 1fr auto;
    min-width: 0;
    min-height: 0;
  }
  .canvas { position: relative; background: #f8fafc; min-height: 0; overflow: hidden; }
  .empty {
    position: absolute; inset: 0; z-index: 5;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    color: #64748b; pointer-events: none;
  }
  .empty h2 { font-size: 1.125rem; font-weight: 600; color: #0f172a; pointer-events: auto; }
  .empty button { pointer-events: auto; }

  .side-panel {
    width: 320px;
    flex-shrink: 0;          /* fixed-width, never collapsed by canvas */
    background: white; border-left: 1px solid #e2e8f0;
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
