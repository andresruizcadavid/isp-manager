<script>
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    ArrowLeft, Save, RefreshCw, Power, Activity,
    Server, User, Wifi, Loader2, AlertCircle, CheckCircle2
  } from 'lucide-svelte';

  /** @type {any} */
  export let data;
  $: router = data.router;

  let saving = false;
  let syncing = false;
  let testing = false;
  let error = '';
  let success = '';
  // Live ping result mirror, keyed by route id. Persisted in DB by the backend
  // — we keep a local copy so the "Probar rutas" button can show immediate
  // feedback even before the server-sent socket event arrives.
  /** @type {Record<string, any>} */
  let liveRoutes = {};

  // Default-fill 3 slots so the operator can add alternativas without an
  // "Add row" button. Slots beyond the router's existing routes are empty.
  /** @param {any[]} [routes] */
  function seedRoutes(routes) {
    const out = [
      { id: null, ip: '', label: 'Enlace principal',  priority: 1 },
      { id: null, ip: '', label: 'Alternativa 1',     priority: 2 },
      { id: null, ip: '', label: 'Alternativa 2',     priority: 3 }
    ];
    for (const r of routes ?? []) {
      out[r.priority - 1] = { id: r.id, ip: r.ip, label: r.label ?? out[r.priority - 1].label, priority: r.priority };
    }
    return out;
  }

  let form = {
    name: router?.name || '',
    apiPort: router?.apiPort || 80,
    username: router?.username || 'admin',
    password: '',
    location: router?.location || '',
    model: router?.model || '',
    description: router?.description || '',
    isActive: router?.isActive ?? true,
    routes: seedRoutes(router?.routes)
  };

  const ROUTE_LABELS = ['Principal', 'Alternativa 1', 'Alternativa 2'];

  function nonEmptyRoutes() {
    return form.routes.filter(r => r.ip.trim());
  }

  async function saveRouter() {
    saving = true; error = ''; success = '';
    try {
      const updateData = {
        name: form.name,
        apiPort: Number(form.apiPort),
        username: form.username,
        password: form.password || undefined,
        location: form.location,
        model: form.model,
        description: form.description,
        isActive: form.isActive,
        routes: nonEmptyRoutes().map(r => ({
          ip: r.ip.trim(),
          label: r.label
        }))
      };
      const updated = await routersApi.update(router.id, updateData);
      // Refresh local view so newly-created routes get their IDs, and the
      // status pills reset to UNKNOWN until the next sweep runs.
      router = updated;
      form.routes = seedRoutes(updated?.routes);
      liveRoutes = {};
      success = 'Router actualizado correctamente';
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al guardar';
    } finally { saving = false; }
  }

  async function syncNow() {
    syncing = true; error = ''; success = '';
    try {
      await routersApi.sync(router.id);
      success = 'Sincronización completada';
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al sincronizar';
    } finally { syncing = false; }
  }

  // Hits /test-routes — pings every persisted route, updates statuses and
  // the router-level state. Result drives the live pills below + persists,
  // so a reload still shows fresh data.
  async function testRoutesNow() {
    testing = true; error = ''; success = '';
    liveRoutes = {};
    try {
      const result = await routersApi.testRoutes(router.id);
      // result = { router:{...}, activeRouteId, routes:[{id,ip,priority,label,status,latency}] }
      for (const r of result.routes) {
        liveRoutes[r.id] = { status: r.status, latency: r.latency };
      }
      liveRoutes = { ...liveRoutes };
      router = { ...router, status: result.router.status, activeRouteId: result.activeRouteId };
      success = `Estado del router: ${result.router.status}`;
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo probar las rutas';
    } finally { testing = false; }
  }

  // testConnection now dials the router via the failover resolver so the
  // operator sees which uplink answered.
  async function testConnection() {
    testing = true; error = ''; success = '';
    try {
      const result = await routersApi.testConn(router.id);
      const identity = result?.identity || result?.data?.identity;
      const dialIp = result?.dialIp || result?.data?.dialIp;
      success = identity
        ? `Conexión exitosa vía ${dialIp ?? 'ruta activa'}. Identidad: ${identity}`
        : 'Conexión exitosa';
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error de conexión';
    } finally { testing = false; }
  }

  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return 'Nunca';
    return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Per-row status pill: prefer live result (just pinged) over the persisted
  // status (last sweep) so the user sees immediate feedback after clicking.
  /** @param {any} rt */
  function routeStatusFor(rt) {
    const live = rt.id != null ? liveRoutes[rt.id] : null;
    const status  = live?.status ?? (rt.id == null ? 'UNKNOWN' : (router?.routes?.find((/** @type {any} */ x) => x.id === rt.id)?.status ?? 'UNKNOWN'));
    const latency = live?.latency ?? router?.routes?.find((/** @type {any} */ x) => x.id === rt.id)?.latency;
    if (status === 'ONLINE') {
      return { label: `Online${latency != null ? ` · ${latency.toFixed(0)}ms` : ''}`, cls: 'text-emerald-600' };
    }
    if (status === 'OFFLINE') return { label: 'Offline', cls: 'text-red-600' };
    return { label: 'Sin probar', cls: 'text-slate-400' };
  }

  /** @param {string} status */
  function routerStatusBadge(status) {
    switch (status) {
      case 'ONLINE':   return { cls: 'badge-green',  label: 'Online' };
      case 'DEGRADED': return { cls: 'badge-yellow', label: 'Degradado' };
      case 'OFFLINE':  return { cls: 'badge-red',    label: 'Offline' };
      default:         return { cls: 'badge-gray',   label: 'Sin probar' };
    }
  }
</script>

<svelte:head><title>{router?.name || 'Router'} — ISP Manager</title></svelte:head>

<div class="page-header">
  <div class="flex items-center gap-4">
    <a href="/mikrotik/routers" class="btn-icon">
      <ArrowLeft size={18} />
    </a>
    <div>
      <h1 class="page-title">{router?.name || 'Cargando...'}</h1>
      <p class="page-subtitle">Configuración del router</p>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary" on:click={syncNow} disabled={syncing}>
      {#if syncing}
        <Loader2 size={16} class="animate-spin" />
      {:else}
        <RefreshCw size={16} />
      {/if}
      Sincronizar ahora
    </button>
    <button class="btn-primary" on:click={saveRouter} disabled={saving}>
      {#if saving}
        <Loader2 size={16} class="animate-spin" />
      {:else}
        <Save size={16} />
      {/if}
      Guardar cambios
    </button>
  </div>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

{#if success}
  <div class="card p-4 mb-4 flex items-start gap-3 border-green-200 bg-green-50">
    <CheckCircle2 size={16} class="text-green-500 mt-0.5" />
    <div class="text-sm text-green-700">{success}</div>
  </div>
{/if}

<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <!-- Información General -->
  <div class="lg:col-span-2 space-y-6">
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Server size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Información General</h3>
      </div>
      <div class="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="label">Nombre</label>
          <input type="text" class="input" bind:value={form.name} placeholder="Nombre del router" />
        </div>
        <div>
          <label class="label">Estado</label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" class="checkbox" bind:checked={form.isActive} />
            <span class="text-sm text-slate-600">Router activo</span>
          </label>
        </div>
        <div>
          <label class="label">Puerto API</label>
          <input type="number" class="input" bind:value={form.apiPort} placeholder="80" />
        </div>
        <div>
          <label class="label">Ubicación</label>
          <input type="text" class="input" bind:value={form.location} placeholder="Ciudad, barrio..." />
        </div>
        <div>
          <label class="label">Modelo</label>
          <input type="text" class="input" bind:value={form.model} placeholder="RB750, CCR1009, etc." />
        </div>
        <div class="md:col-span-2">
          <label class="label">Descripción</label>
          <textarea class="textarea" bind:value={form.description} placeholder="Descripción opcional..." rows="2"></textarea>
        </div>
      </div>
    </div>

    <!-- Rutas de Acceso (failover) -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Activity size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Rutas de Acceso</h3>
        <span class="ml-auto text-[11px] text-slate-400">Failover por prioridad</span>
      </div>
      <div class="p-5">
        <p class="text-xs text-slate-500 mb-3">
          Define hasta 3 IPs. El sistema usará siempre la primera disponible.
          La ruta marcada como <span class="font-semibold text-slate-700">activa</span> es la que está respondiendo ahora mismo.
        </p>
        <div class="space-y-2">
          {#each form.routes as r, idx}
            {@const ss = routeStatusFor(r)}
            {@const isActive = r.id != null && r.id === router?.activeRouteId}
            <div class="flex items-center gap-3">
              <span class="inline-flex items-center justify-center min-w-[96px] px-2 py-1 rounded text-[11px] font-medium
                           {idx === 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}">
                {ROUTE_LABELS[idx]}{isActive ? ' ✓' : ''}
              </span>
              <input
                type="text"
                class="input font-mono flex-1 {isActive ? 'ring-2 ring-emerald-200' : ''}"
                bind:value={r.ip}
                placeholder={idx === 0 ? 'IP principal — ej: 10.2.2.2' : `IP alternativa ${idx} (opcional)`}
              />
              <span class="text-xs font-medium {ss.cls} min-w-[130px]">● {ss.label}</span>
            </div>
          {/each}
        </div>
        <div class="mt-4 flex items-center justify-between">
          <p class="text-[11px] text-slate-400">
            Cambios en las rutas se aplican al guardar. El monitor sondea cada ruta periódicamente.
          </p>
          <button class="btn-secondary" on:click={testRoutesNow} disabled={testing}>
            {#if testing}
              <Loader2 size={14} class="animate-spin" />
            {:else}
              <Power size={14} />
            {/if}
            Probar rutas
          </button>
        </div>
      </div>
    </div>

    <!-- Credenciales -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <User size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Credenciales de Acceso</h3>
      </div>
      <div class="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="label">Usuario</label>
          <input type="text" class="input" bind:value={form.username} placeholder="admin" />
        </div>
        <div>
          <label class="label">Nueva Contraseña</label>
          <input type="password" class="input" bind:value={form.password} placeholder="Dejar vacío para mantener" />
        </div>
      </div>
    </div>

    <!-- Acciones -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Power size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Prueba de Conexión</h3>
      </div>
      <div class="p-5">
        <p class="text-xs text-slate-500 mb-3">
          Hace login HTTP en la REST API del router usando la ruta activa (failover automático).
        </p>
        <button class="btn-secondary" on:click={testConnection} disabled={testing}>
          {#if testing}
            <Loader2 size={16} class="animate-spin" />
          {:else}
            <Power size={16} />
          {/if}
          Probar conexión al router
        </button>
      </div>
    </div>
  </div>

  <!-- Sidebar -->
  <div class="space-y-6">
    <!-- Estado -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100">
        <h3 class="font-semibold text-slate-700">Estado</h3>
      </div>
      <div class="p-5 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-500">Failover</span>
          {#if !router?.isActive}
            <span class="badge-gray">Inactivo</span>
          {:else}
            {@const sb = routerStatusBadge(router?.status)}
            <span class={sb.cls}>{sb.label}</span>
          {/if}
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-500">Cuentas PPPoE</span>
          <span class="font-medium text-slate-700">{router?._count?.mikrotikAccounts || 0}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-500">Última sync</span>
          <span class="text-xs text-slate-600">{fmtDate(router?.lastSyncAt)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-500">Creado</span>
          <span class="text-xs text-slate-600">{fmtDate(router?.createdAt)}</span>
        </div>
      </div>
    </div>

    <!-- Accesos directos -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100">
        <h3 class="font-semibold text-slate-700">Accesos Directos</h3>
      </div>
      <div class="p-5 space-y-2">
        <a href="/mikrotik/routers/{router?.id}/import" class="flex items-center gap-2 text-sm text-slate-600 hover:text-brand-800">
          <RefreshCw size={14} />
          Importar cuentas PPPoE
        </a>
        <a href="/mikrotik/accounts?router={router?.id}" class="flex items-center gap-2 text-sm text-slate-600 hover:text-brand-800">
          <Wifi size={14} />
          Ver cuentas vinculadas
        </a>
      </div>
    </div>
  </div>
</div>
