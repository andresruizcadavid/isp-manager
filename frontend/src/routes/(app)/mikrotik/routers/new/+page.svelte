<script>
  import { goto } from '$app/navigation';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    ArrowLeft, Save, Power, Server, User, Loader2, AlertCircle, CheckCircle2
  } from 'lucide-svelte';

  let saving = false;
  let testing = false;
  let error = '';
  let success = '';

  let form = {
    name: '',
    ipAddress: '',
    apiPort: 80,
    username: 'admin',
    password: '',
    location: '',
    model: '',
    description: '',
    isActive: true
  };

  function validate() {
    if (!form.name.trim()) return 'El nombre es requerido';
    if (!form.ipAddress.trim()) return 'La dirección IP es requerida';
    if (!form.username.trim()) return 'El usuario es requerido';
    if (!form.password) return 'La contraseña es requerida para crear el router';
    return null;
  }

  async function createRouter() {
    error = ''; success = '';
    const v = validate();
    if (v) { error = v; return; }
    saving = true;
    try {
      const created = await routersApi.create({
        name: form.name.trim(),
        ipAddress: form.ipAddress.trim(),
        apiPort: Number(form.apiPort) || 80,
        username: form.username.trim(),
        password: form.password,
        location: form.location.trim() || null,
        model: form.model.trim() || null,
        description: form.description.trim() || null,
        isActive: form.isActive
      });
      success = 'Router creado correctamente';
      // Redirect to the edit page after a short pause so the user sees feedback.
      setTimeout(() => goto(`/mikrotik/routers/${created.id}`), 600);
    } catch (e) {
      error = e.message || 'Error al crear el router';
    } finally { saving = false; }
  }

  async function testConnection() {
    error = ''; success = '';
    if (!form.ipAddress.trim()) { error = 'Ingresa la IP antes de probar'; return; }
    if (!form.password) { error = 'Ingresa la contraseña antes de probar'; return; }
    testing = true;
    try {
      const result = await routersApi.testCredentials({
        ipAddress: form.ipAddress.trim(),
        apiPort: Number(form.apiPort) || 80,
        username: form.username.trim() || 'admin',
        password: form.password
      });
      const identity = result?.identity || result?.data?.identity;
      success = identity
        ? `Conexión exitosa. Identidad: ${identity}`
        : 'Conexión exitosa';
    } catch (e) {
      error = e.message || 'Error de conexión';
    } finally { testing = false; }
  }
</script>

<svelte:head><title>Nuevo router — ISP Manager</title></svelte:head>

<div class="page-header">
  <div class="flex items-center gap-4">
    <a href="/mikrotik/routers" class="btn-icon">
      <ArrowLeft size={18} />
    </a>
    <div>
      <h1 class="page-title">Nuevo router</h1>
      <p class="page-subtitle">Configura un nuevo router MikroTik</p>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary" on:click={testConnection} disabled={testing || saving}>
      {#if testing}
        <Loader2 size={16} class="animate-spin" />
      {:else}
        <Power size={16} />
      {/if}
      Probar conexión
    </button>
    <button class="btn-primary" on:click={createRouter} disabled={saving || testing}>
      {#if saving}
        <Loader2 size={16} class="animate-spin" />
      {:else}
        <Save size={16} />
      {/if}
      Crear router
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
  <div class="lg:col-span-2 space-y-6">
    <!-- Información General -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Server size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Información General</h3>
      </div>
      <div class="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="label" for="rn-name">Nombre <span class="text-red-500">*</span></label>
          <input id="rn-name" type="text" class="input" bind:value={form.name} placeholder="Router principal" />
        </div>
        <div>
          <label class="label" for="rn-active">Estado</label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input id="rn-active" type="checkbox" class="checkbox" bind:checked={form.isActive} />
            <span class="text-sm text-slate-600">Router activo</span>
          </label>
        </div>
        <div>
          <label class="label" for="rn-ip">Dirección IP <span class="text-red-500">*</span></label>
          <input id="rn-ip" type="text" class="input font-mono" bind:value={form.ipAddress} placeholder="192.168.1.1" />
        </div>
        <div>
          <label class="label" for="rn-port">Puerto API</label>
          <input id="rn-port" type="number" class="input" bind:value={form.apiPort} placeholder="80" />
        </div>
        <div>
          <label class="label" for="rn-loc">Ubicación</label>
          <input id="rn-loc" type="text" class="input" bind:value={form.location} placeholder="Ciudad, barrio..." />
        </div>
        <div>
          <label class="label" for="rn-model">Modelo</label>
          <input id="rn-model" type="text" class="input" bind:value={form.model} placeholder="RB750, CCR1009, etc." />
        </div>
        <div class="md:col-span-2">
          <label class="label" for="rn-desc">Descripción</label>
          <textarea id="rn-desc" class="textarea" bind:value={form.description} placeholder="Descripción opcional..." rows="2"></textarea>
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
          <label class="label" for="rn-user">Usuario <span class="text-red-500">*</span></label>
          <input id="rn-user" type="text" class="input" bind:value={form.username} placeholder="admin" />
        </div>
        <div>
          <label class="label" for="rn-pass">Contraseña <span class="text-red-500">*</span></label>
          <input id="rn-pass" type="password" class="input" bind:value={form.password} placeholder="Contraseña del router" />
        </div>
      </div>
    </div>

    <!-- Probar conexión -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Power size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Prueba de Conexión</h3>
      </div>
      <div class="p-5">
        <p class="text-sm text-slate-500 mb-3">
          Verifica que las credenciales y la IP funcionan antes de crear el router.
          La conexión se hace contra <code class="px-1 py-0.5 bg-slate-100 rounded text-xs">/system/identity</code> vía la REST API de MikroTik.
        </p>
        <button class="btn-secondary" on:click={testConnection} disabled={testing || saving}>
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
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100">
        <h3 class="font-semibold text-slate-700">Sugerencias</h3>
      </div>
      <div class="p-5 space-y-2 text-sm text-slate-600">
        <p>El router debe tener habilitado <strong>www</strong> (REST API) en MikroTik:</p>
        <ul class="list-disc pl-5 space-y-1 text-xs text-slate-500">
          <li>RouterOS 7.1+ con servicio <code>www</code> activo.</li>
          <li>Usuario con permisos de lectura sobre <code>/ppp/secret</code> y <code>/system</code>.</li>
          <li>Puerto 80 (HTTP) o el que esté configurado en <code>IP &gt; Services</code>.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
