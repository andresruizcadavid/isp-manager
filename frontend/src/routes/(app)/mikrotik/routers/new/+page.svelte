<script>
  import { goto } from '$app/navigation';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    ArrowLeft, Save, Power, Server, User, Loader2, AlertCircle, CheckCircle2,
    Activity
  } from 'lucide-svelte';

  let saving = false;
  let testing = false;
  let error = '';
  let success = '';
  // Per-route ping results, keyed by row index (0..2). { status, latency }.
  let routeResults = [null, null, null];

  let form = {
    name: '',
    apiPort: 80,
    username: 'admin',
    password: '',
    location: '',
    model: '',
    description: '',
    isActive: true,
    // 3 rows for the failover routes — only `ip` is bound, label is auto-derived
    // server-side ("Enlace principal" / "Alternativa 1" / "Alternativa 2").
    routes: [
      { ip: '', label: 'Enlace principal' },
      { ip: '', label: 'Alternativa 1' },
      { ip: '', label: 'Alternativa 2' }
    ]
  };

  const ROUTE_LABELS = ['Principal', 'Alternativa 1', 'Alternativa 2'];

  function nonEmptyRoutes() {
    return form.routes.filter(r => r.ip.trim());
  }

  function validate() {
    if (!form.name.trim()) return 'El nombre es requerido';
    const routes = nonEmptyRoutes();
    if (routes.length === 0) return 'Al menos una IP es requerida (la principal)';
    const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
    for (const r of routes) {
      if (!ipRe.test(r.ip.trim())) return `IP inválida: ${r.ip}`;
    }
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
        apiPort: Number(form.apiPort) || 80,
        username: form.username.trim(),
        password: form.password,
        location: form.location.trim() || null,
        model: form.model.trim() || null,
        description: form.description.trim() || null,
        isActive: form.isActive,
        routes: nonEmptyRoutes().map(r => ({
          ip: r.ip.trim(),
          label: r.label
        }))
      });
      success = 'Router creado correctamente';
      // Redirect to the edit page after a short pause so the user sees feedback.
      setTimeout(() => goto(`/mikrotik/routers/${created.id}`), 600);
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al crear el router';
    } finally { saving = false; }
  }

  // Live-ping every filled route via the credentials test endpoint. We can't
  // hit /test-routes (no router id yet) so we re-use /test per row.
  async function testRoutesNow() {
    error = ''; success = '';
    const routes = nonEmptyRoutes();
    if (routes.length === 0) { error = 'Ingresa al menos una IP para probar'; return; }
    if (!form.password) { error = 'Ingresa la contraseña antes de probar'; return; }
    testing = true;
    // Clear previous results
    routeResults = form.routes.map(() => null);
    try {
      // Per-row probes in parallel. The credentials test does an HTTP request
      // to the MikroTik REST API — if it answers, the IP is alive AND the
      // credentials work for that uplink.
      await Promise.all(form.routes.map(async (r, idx) => {
        if (!r.ip.trim()) return;
        const t0 = Date.now();
        try {
          await routersApi.testCredentials({
            ip: r.ip.trim(),
            apiPort: Number(form.apiPort) || 80,
            username: form.username.trim() || 'admin',
            password: form.password
          });
          routeResults[idx] = { status: 'ONLINE', latency: Date.now() - t0 };
        } catch {
          routeResults[idx] = { status: 'OFFLINE', latency: null };
        }
        routeResults = [...routeResults];
      }));
      success = 'Prueba completada';
    } finally { testing = false; }
  }

  function routeStatusFor(idx) {
    const r = routeResults[idx];
    if (!r) return { label: 'Sin probar', cls: 'text-slate-400' };
    if (r.status === 'ONLINE')  return { label: `Online · ${r.latency}ms`, cls: 'text-emerald-600' };
    return { label: 'Offline', cls: 'text-red-600' };
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
      <p class="page-subtitle">Configura un nuevo router MikroTik con rutas de failover</p>
    </div>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary" on:click={testRoutesNow} disabled={testing || saving}>
      {#if testing}
        <Loader2 size={16} class="animate-spin" />
      {:else}
        <Power size={16} />
      {/if}
      Probar rutas
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

    <!-- Rutas de Acceso (failover) -->
    <div class="card">
      <div class="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Activity size={16} class="text-brand-800" />
        <h3 class="font-semibold text-slate-700">Rutas de Acceso</h3>
      </div>
      <div class="p-5">
        <p class="text-xs text-slate-500 mb-3">
          Define hasta 3 IPs. El sistema usará siempre la primera disponible (failover automático).
        </p>
        <div class="space-y-2">
          {#each form.routes as r, idx}
            {@const ss = routeStatusFor(idx)}
            <div class="flex items-center gap-3">
              <span class="inline-flex items-center justify-center min-w-[88px] px-2 py-1 rounded text-[11px] font-medium
                           {idx === 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}">
                {ROUTE_LABELS[idx]}
              </span>
              <input
                type="text"
                class="input font-mono flex-1"
                bind:value={r.ip}
                placeholder={idx === 0 ? 'IP principal — ej: 10.2.2.2' : `IP alternativa ${idx} (opcional)`}
              />
              <span class="text-xs font-medium {ss.cls} min-w-[110px]">● {ss.label}</span>
            </div>
          {/each}
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
        <p class="pt-2 border-t border-slate-100">
          Si configuras 2+ rutas, el sistema seguirá operando aunque la principal caiga — usará la siguiente disponible automáticamente.
        </p>
      </div>
    </div>
  </div>
</div>
