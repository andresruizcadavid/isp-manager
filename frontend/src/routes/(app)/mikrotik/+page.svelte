<script>
  import { onMount } from 'svelte';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    Router as RouterIcon, Wifi, Users, Server, AlertCircle,
    CheckCircle2, Clock, ExternalLink
  } from 'lucide-svelte';

  let routers = [];
  let loading = true;
  let error = '';

  async function load() {
    loading = true; error = '';
    try {
      routers = await routersApi.getAll();
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al cargar routers';
    } finally { loading = false; }
  }
  onMount(load);

  $: totalRouters = routers.length;
  $: activeRouters = routers.filter(r => r.isActive).length;
  $: totalAccounts = routers.reduce((sum, r) => sum + (r._count?.mikrotikAccounts || 0), 0);

  function fmtDate(s) {
    if (!s) return 'Nunca';
    return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
</script>

<svelte:head><title>MikroTik — ISP Manager</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">MikroTik</h1>
    <p class="page-subtitle">Gestión de routers y cuentas PPPoE</p>
  </div>
</div>

<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  <div class="kpi-tile">
    <div class="icon-square-blue"><Server size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Total Routers</div>
      <div class="kpi-value">{totalRouters}</div>
      <div class="kpi-sub">Configurados</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-green"><CheckCircle2 size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Activos</div>
      <div class="kpi-value">{activeRouters}</div>
      <div class="kpi-sub">En línea</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-rose"><Users size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Cuentas PPPoE</div>
      <div class="kpi-value">{totalAccounts}</div>
      <div class="kpi-sub">Total registradas</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-amber"><Clock size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Última Sincronización</div>
      <div class="kpi-value text-sm">—</div>
      <div class="kpi-sub">Sistema global</div>
    </div>
  </div>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
  <a href="/mikrotik/routers" class="card p-6 hover:shadow-lg transition-shadow group">
    <div class="flex items-start justify-between">
      <div>
        <div class="flex items-center gap-2 mb-2">
          <RouterIcon size={20} class="text-brand-800" />
          <h3 class="text-lg font-semibold text-slate-800">Routers / NOC</h3>
        </div>
        <p class="text-sm text-slate-500 mb-4">Gestiona la configuración de tus routers MikroTik, sincroniza cuentas PPPoE y supervisa el estado de conexión.</p>
        <div class="text-xs text-slate-400">Ir a Routers →</div>
      </div>
      <ExternalLink size={18} class="text-slate-400 group-hover:text-brand-800 transition-colors" />
    </div>
  </a>

  <a href="/plans" class="card p-6 hover:shadow-lg transition-shadow group">
    <div class="flex items-start justify-between">
      <div>
        <div class="flex items-center gap-2 mb-2">
          <Wifi size={20} class="text-brand-800" />
          <h3 class="text-lg font-semibold text-slate-800">Planes de Servicio</h3>
        </div>
        <p class="text-sm text-slate-500 mb-4">Administra los planes de internet, velocidades, precios y límites de datos para tus clientes.</p>
        <div class="text-xs text-slate-400">Ir a Planes →</div>
      </div>
      <ExternalLink size={18} class="text-slate-400 group-hover:text-brand-800 transition-colors" />
    </div>
  </a>
</div>

<div class="card">
  <div class="px-5 py-3 border-b border-slate-100">
    <h3 class="font-semibold text-slate-700">Routers Recientes</h3>
  </div>
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>IP</th>
          <th>Ubicación</th>
          <th>Cuentas</th>
          <th>Última Sincronización</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="6" class="py-12 text-center">
            <div class="flex items-center justify-center gap-2">
              <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-slate-500 text-sm">Cargando...</span>
            </div>
          </td></tr>
        {:else if routers.length === 0}
          <tr><td colspan="6" class="py-12 text-center text-slate-400 text-sm">No hay routers configurados</td></tr>
        {:else}
          {#each routers.slice(0, 5) as r}
            <tr>
              <td><a href="/mikrotik/routers/{r.id}" class="font-medium text-slate-900 hover:text-brand-800">{r.name}</a></td>
              <td class="font-mono text-xs text-slate-600">{r.routes?.[0]?.ip ?? '—'}</td>
              <td class="text-slate-600 text-sm">{r.location || '—'}</td>
              <td class="text-center">{r._count?.mikrotikAccounts || 0}</td>
              <td class="text-slate-500 text-xs">{fmtDate(r.lastSyncAt)}</td>
              <td>
                {#if r.isActive}
                  <span class="badge-green">Activo</span>
                {:else}
                  <span class="badge-gray">Inactivo</span>
                {/if}
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>