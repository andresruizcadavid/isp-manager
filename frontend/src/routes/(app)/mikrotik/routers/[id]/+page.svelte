<script>
  import { page } from '$app/stores';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    ArrowLeft, Save, RefreshCw, Power, Settings,
    Server, MapPin, User, Wifi, Loader2, AlertCircle, CheckCircle2
  } from 'lucide-svelte';

  export let data;
  $: router = data.router;

  let saving = false;
  let syncing = false;
  let testing = false;
  let error = '';
  let success = '';

  let form = {
    name: router?.name || '',
    ipAddress: router?.ipAddress || '',
    apiPort: router?.apiPort || 80,
    username: router?.username || 'admin',
    password: '',
    location: router?.location || '',
    model: router?.model || '',
    description: router?.description || '',
    isActive: router?.isActive ?? true
  };

  async function saveRouter() {
    saving = true; error = ''; success = '';
    try {
      const updateData = {
        name: form.name,
        ipAddress: form.ipAddress,
        apiPort: Number(form.apiPort),
        username: form.username,
        password: form.password || undefined,
        location: form.location,
        model: form.model,
        description: form.description,
        isActive: form.isActive
      };
      await routersApi.update(router.id, updateData);
      success = 'Router actualizado correctamente';
    } catch (e) {
      error = e.message || 'Error al guardar';
    } finally { saving = false; }
  }

  async function syncNow() {
    syncing = true; error = ''; success = '';
    try {
      await routersApi.sync(router.id);
      success = 'Sincronización completada';
    } catch (e) {
      error = e.message || 'Error al sincronizar';
    } finally { syncing = false; }
  }

  async function testConnection() {
    testing = true; error = ''; success = '';
    try {
      const result = await routersApi.testConn(router.id);
      const identity = result?.identity || result?.data?.identity;
      success = identity
        ? `Conexión exitosa. Identidad: ${identity}`
        : 'Conexión exitosa';
    } catch (e) {
      error = e.message || 'Error de conexión';
    } finally { testing = false; }
  }

  function fmtDate(s) {
    if (!s) return 'Nunca';
    return new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
          <label class="label">Dirección IP</label>
          <input type="text" class="input font-mono" bind:value={form.ipAddress} placeholder="192.168.1.1" />
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
          <span class="text-sm text-slate-500">Estado</span>
          {#if router?.isActive}
            <span class="badge-green">Activo</span>
          {:else}
            <span class="badge-gray">Inactivo</span>
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