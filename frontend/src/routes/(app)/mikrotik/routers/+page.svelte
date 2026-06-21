<script>
  import { onMount } from 'svelte';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    Router as RouterIcon, Plus, Search, Power, RefreshCw,
    Settings, Trash2, AlertCircle, CheckCircle2, Loader2, X
  } from 'lucide-svelte';

  /** @type {import('$lib/types').Router[]} */
  let routers = [];
  let loading = true;
  let error = '';
  /** @type {Record<number, boolean>} */
  let testing = {};
  /** @type {Record<number, boolean>} */
  let syncing = {};

  // Delete modal state
  /** @type {any} */
  let routerToDelete = null;
  let deleteConfirmName = '';
  let deleting = false;
  let deleteError = '';

  async function load() {
    loading = true; error = '';
    try {
      routers = await routersApi.getAll();
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al cargar routers';
    } finally { loading = false; }
  }
  onMount(load);

  /** @param {number} id */
  async function testConnection(id) {
    testing[id] = true;
    try {
      await routersApi.testRoutes(id);   // pings every route + persists status
      await load();
    } catch (/** @type {any} */ e) {
      alert('Error de conexión: ' + e.message);
    } finally { testing[id] = false; }
  }

  // Map RouterStatus enum to the badge styling used by the rest of the app.
  /** @param {string} status */
  function statusBadge(status) {
    switch (status) {
      case 'ONLINE':   return { cls: 'badge-green',  label: 'Online'   };
      case 'DEGRADED': return { cls: 'badge-yellow', label: 'Degradado' };
      case 'OFFLINE':  return { cls: 'badge-red',    label: 'Offline'  };
      default:         return { cls: 'badge-gray',   label: 'Sin probar' };
    }
  }

  // Per-route dot color. Latency is suffixed when known so the operator can
  // tell which uplink is healthier at a glance.
  /** @param {string} status */
  function routeDotClass(status) {
    if (status === 'ONLINE')  return 'text-emerald-500';
    if (status === 'OFFLINE') return 'text-red-500';
    return 'text-slate-300';
  }

  /** @param {number} id */
  async function syncRouter(id) {
    syncing[id] = true;
    try {
      await routersApi.sync(id);
      await load();
    } catch (/** @type {any} */ e) {
      alert('Error al sincronizar: ' + e.message);
    } finally { syncing[id] = false; }
  }

  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return 'Nunca';
    return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** @param {any} r */
  function openDelete(r) {
    routerToDelete = r;
    deleteConfirmName = '';
    deleteError = '';
  }
  function closeDelete() {
    if (deleting) return;
    routerToDelete = null;
    deleteConfirmName = '';
    deleteError = '';
  }
  async function executeDelete() {
    if (!routerToDelete || deleteConfirmName !== routerToDelete.name) return;
    deleting = true; deleteError = '';
    try {
      await routersApi.remove(routerToDelete.id);
      routerToDelete = null;
      deleteConfirmName = '';
      await load();
    } catch (/** @type {any} */ e) {
      // Prisma foreign-key violation when the router still has linked accounts.
      const msg = e.message || '';
      if (/foreign key|constraint|P2003/i.test(msg)) {
        deleteError = 'No se puede eliminar: el router tiene cuentas MikroTik asociadas. Primero reasigna o elimina esas cuentas.';
      } else {
        deleteError = msg || 'Error al eliminar el router';
      }
    } finally { deleting = false; }
  }
</script>

<svelte:head><title>Routers / NOC — ISP Manager</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Routers / NOC</h1>
    <p class="page-subtitle">{routers.length} {routers.length === 1 ? 'router' : 'routers'} configurados</p>
  </div>
  <a href="/mikrotik/routers/new" class="btn-primary">
    <Plus size={16} />
    Agregar Router
  </a>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

<div class="card overflow-hidden">
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>Rutas / Failover</th>
          <th>Ubicación</th>
          <th>Modelo</th>
          <th>Cuentas</th>
          <th>Última Sincronización</th>
          <th>Estado</th>
          <th class="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="8" class="py-16 text-center">
            <div class="flex items-center justify-center gap-2">
              <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-slate-500 text-sm">Cargando routers...</span>
            </div>
          </td></tr>
        {:else if routers.length === 0}
          <tr><td colspan="8" class="py-20 text-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <RouterIcon size={28} class="text-slate-400" />
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-700">Aún no hay routers configurados</p>
                <p class="text-xs text-slate-500 mt-1">Agrega un router MikroTik para comenzar</p>
              </div>
            </div>
          </td></tr>
        {:else}
          {#each routers as r}
            <tr>
              <td>
                <a href="/mikrotik/routers/{r.id}" class="font-semibold text-slate-900 hover:text-brand-800 transition-colors">
                  {r.name}
                </a>
              </td>
              <td>
                {#if r.routes && r.routes.length > 0}
                  <div class="flex flex-col gap-0.5">
                    {#each r.routes as rt}
                      <div class="flex items-center gap-1.5 text-xs font-mono text-slate-600">
                        <span class={routeDotClass(rt.status)}>●</span>
                        <span class={rt.id === r.activeRouteId ? 'font-semibold text-slate-900' : ''}>
                          {rt.ip}
                        </span>
                        {#if rt.latency != null && rt.status === 'ONLINE'}
                          <span class="text-[10px] text-slate-400">{rt.latency.toFixed(0)}ms</span>
                        {/if}
                        <span class="text-[10px] text-slate-400">P{rt.priority}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <span class="text-xs text-slate-400 italic">Sin rutas</span>
                {/if}
              </td>
              <td class="text-slate-600 text-sm">{r.location || '—'}</td>
              <td class="text-slate-600 text-sm">{r.model || '—'}</td>
              <td class="text-center">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                  {r._count?.mikrotikAccounts || 0}
                </span>
              </td>
              <td class="text-slate-500 text-xs">{fmtDate(r.lastSyncAt)}</td>
              <td>
                {#if !r.isActive}
                  <span class="badge-gray">Inactivo</span>
                {:else}
                  {@const sb = statusBadge(r.status)}
                  <span class={sb.cls}>{sb.label}</span>
                {/if}
              </td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <button
                    class="btn-icon"
                    title="Sincronizar PPPoE"
                    on:click={() => syncRouter(r.id)}
                    disabled={syncing[r.id]}
                  >
                    {#if syncing[r.id]}
                      <Loader2 size={14} class="animate-spin" />
                    {:else}
                      <RefreshCw size={14} />
                    {/if}
                  </button>
                  <button
                    class="btn-icon"
                    title="Probar Conexión"
                    on:click={() => testConnection(r.id)}
                    disabled={testing[r.id]}
                  >
                    {#if testing[r.id]}
                      <Loader2 size={14} class="animate-spin" />
                    {:else}
                      <Power size={14} />
                    {/if}
                  </button>
                  <a href="/mikrotik/routers/{r.id}" class="btn-icon" title="Configurar">
                    <Settings size={14} />
                  </a>
                  <button
                    class="btn-icon hover:bg-red-50 hover:text-red-600"
                    title="Eliminar router"
                    on:click={() => openDelete(r)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<!-- Modal Eliminar Router -->
{#if routerToDelete}
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" on:click|self={closeDelete}>
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-md">
      <div class="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
          <Trash2 size={18} class="text-red-600" />
        </div>
        <div class="flex-1">
          <h3 class="text-base font-semibold text-slate-900">Eliminar Router</h3>
          <p class="text-xs text-slate-500">Esta acción no se puede deshacer</p>
        </div>
        <button class="text-slate-400 hover:text-slate-600" on:click={closeDelete} disabled={deleting}>
          <X size={18} />
        </button>
      </div>

      <div class="p-6 space-y-3">
        {#if deleteError}
          <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-start gap-2">
            <AlertCircle size={14} class="mt-0.5 flex-shrink-0" />
            <span>{deleteError}</span>
          </div>
        {/if}

        {#if (routerToDelete._count?.mikrotikAccounts || 0) > 0}
          <div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-sm flex items-start gap-2">
            <AlertCircle size={14} class="mt-0.5 flex-shrink-0" />
            <span>
              Este router tiene <strong>{routerToDelete._count.mikrotikAccounts}</strong>
              cuenta{routerToDelete._count.mikrotikAccounts === 1 ? '' : 's'} MikroTik asociada{routerToDelete._count.mikrotikAccounts === 1 ? '' : 's'}.
              Primero deberás reasignarla{routerToDelete._count.mikrotikAccounts === 1 ? '' : 's'} o eliminarla{routerToDelete._count.mikrotikAccounts === 1 ? '' : 's'}.
            </span>
          </div>
        {/if}

        <p class="text-sm text-slate-600">
          Para confirmar, escribe el nombre exacto del router:
          <span class="font-semibold text-slate-900">{routerToDelete.name}</span>
        </p>
        <input class="input" bind:value={deleteConfirmName} placeholder={routerToDelete.name} disabled={deleting} />
      </div>

      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button class="btn-secondary" on:click={closeDelete} disabled={deleting}>Cancelar</button>
        <button class="btn-danger"
                on:click={executeDelete}
                disabled={deleting || deleteConfirmName !== routerToDelete.name}>
          {#if deleting}
            <Loader2 size={14} class="animate-spin" /> Eliminando...
          {:else}
            <Trash2 size={14} /> Eliminar Router
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}