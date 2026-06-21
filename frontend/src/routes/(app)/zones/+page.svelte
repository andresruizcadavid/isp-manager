<script>
  import { onMount } from 'svelte';
  import { zonesApi } from '$lib/api/zones.api.js';
  import { routersApi } from '$lib/api/routers.api.js';
  import { MapPin, Router as RouterIcon, Save, AlertTriangle } from 'lucide-svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';

  /** @type {any[]} */
  let zones = [];
  /** @type {import('$lib/types').Router[]} */
  let routers = [];
  let showModal = false;
  /** @type {any} */
  let editing = null;
  let saving = false;
  let loading = true;
  let error = '';
  let formError = '';
  // Router list state — separate from page-level error so the modal can
  // surface "couldn't load routers" specifically without breaking the page.
  let routersLoading = true;
  let routersError = '';
  // routerId is kept as a string in the form state so the empty option ('')
  // and numeric ids coexist cleanly; we coerce to Number at submit time.
  let form = { name: '', description: '', color: '#2C4EC7', routerId: '' };

  async function loadRouters() {
    routersLoading = true;
    routersError = '';
    try {
      // Same source as /mikrotik/routers — single source of truth.
      const data = await routersApi.getAll();
      routers = Array.isArray(data) ? data : [];
    } catch (/** @type {any} */ e) {
      routersError = e.message || 'No se pudieron cargar los routers';
      routers = [];
    } finally {
      routersLoading = false;
    }
  }

  onMount(async () => {
    try {
      zones = (await zonesApi.getAll()) || [];
    } catch (/** @type {any} */ e) {
      error = e.message;
    } finally {
      loading = false;
    }
    await loadRouters();
  });

  function openNew() {
    editing = null;
    formError = '';
    form = { name: '', description: '', color: '#2C4EC7', routerId: '' };
    showModal = true;
  }

  /** @param {any} zone */
  function openEdit(zone) {
    editing = zone;
    formError = '';
    form = {
      name: zone.name,
      description: zone.description || '',
      color: zone.color || '#2C4EC7',
      // Normalize to string so the select preselects the matching option
      // even when zone.routerId comes back as a number from the API.
      routerId: zone.routerId != null ? String(zone.routerId) : ''
    };
    showModal = true;
  }

  function closeModal() {
    showModal = false;
    editing = null;
    formError = '';
  }

  async function handleSubmit() {
    formError = '';
    if (!form.name.trim()) {
      formError = 'El nombre es obligatorio';
      return;
    }
    if (!form.routerId) {
      formError = 'Debes seleccionar un router asociado';
      return;
    }
    saving = true;
    try {
      const payload = {
        name:        form.name.trim(),
        description: form.description?.trim() || null,
        color:       form.color,
        routerId:    Number(form.routerId)
      };
      if (editing) {
        const updated = await zonesApi.update(editing.id, payload);
        zones = zones.map(z => z.id === editing.id ? { ...z, ...updated } : z);
      } else {
        const created = await zonesApi.create(payload);
        zones = [...zones, { ...created, clientCount: 0 }];
      }
      closeModal();
    } catch (/** @type {any} */ e) {
      formError = e.message || 'Error al guardar';
    } finally {
      saving = false;
    }
  }

  /** @param {number} id */
  async function deleteZone(id) {
    if (!confirm('¿Eliminar esta zona?')) return;
    try {
      await zonesApi.remove(id);
      zones = zones.filter(z => z.id !== id);
    } catch (/** @type {any} */ e) {
      alert('No se puede eliminar: ' + e.message);
    }
  }

  // Brand-aligned palette: starts with brand-600 plus a curated set
  // that reads well on white cards.
  const colors = [
    '#2C4EC7', // brand-600 (default)
    '#1e3a8a', // brand-800
    '#0891b2', // cyan-600
    '#10b981', // emerald-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#8b5cf6', // violet-500
    '#ec4899', // pink-500
  ];
</script>

<svelte:head><title>Zonas — ISP Manager</title></svelte:head>

<!-- Header -->
<div class="flex items-center justify-between mb-6">
  <div class="flex items-center gap-3">
    <span class="text-2xl">🗺️</span>
    <div>
      <h1 class="text-2xl font-bold text-slate-800">Zonas / Sectores</h1>
      <p class="text-sm text-slate-500">
        Agrupa clientes por zona geográfica o sector de cobertura
      </p>
    </div>
  </div>
  <button on:click={openNew} class="btn-primary">
    ➕ Nueva Zona
  </button>
</div>

<!-- Zones grid -->
{#if zones.length === 0}
  <div class="bg-white rounded-xl border border-slate-200 shadow-sm 
              p-16 text-center">
    <div class="text-5xl mb-3">🗺️</div>
    <h3 class="text-lg font-semibold text-slate-700 mb-1">
      No hay zonas creadas
    </h3>
    <p class="text-slate-400 text-sm mb-5">
      Las zonas permiten agrupar clientes por sector o área de cobertura
    </p>
    <button on:click={openNew} class="btn-primary">
      ➕ Crear primera zona
    </button>
  </div>
{:else}
  <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
    {#each zones as zone}
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm 
                  overflow-hidden hover:shadow-md transition">
        <!-- Color bar -->
        <div class="h-2" style="background-color: {zone.color || '#3b82f6'}"></div>
        <div class="p-5">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-semibold text-slate-800 text-base">{zone.name}</h3>
              {#if zone.description}
                <p class="text-slate-500 text-sm mt-0.5">{zone.description}</p>
              {/if}
            </div>
            <div class="flex gap-1">
              <button on:click={() => openEdit(zone)}
                      class="p-1.5 text-slate-400 hover:text-blue-600 
                             hover:bg-blue-50 rounded transition">✏️</button>
              <button on:click={() => deleteZone(zone.id)}
                      class="p-1.5 text-slate-400 hover:text-red-600 
                             hover:bg-red-50 rounded transition">🗑️</button>
            </div>
          </div>
          <div class="mt-3 flex flex-col gap-1.5">
            {#if zone.router}
              <div class="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <span class="text-slate-400">📡 Router:</span>
                <span class="font-medium text-slate-800">{zone.router.name}</span>
                <span class="font-mono text-slate-500">— {zone.router.routes?.[0]?.ip ?? '—'}</span>
              </div>
            {:else}
              <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md
                          bg-amber-50 text-amber-700 ring-1 ring-amber-100
                          text-[11px] font-medium w-fit">
                ⚠️ Sin router asignado
              </div>
            {/if}
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full"
                   style="background-color: {zone.color || '#3b82f6'}"></div>
              <span class="text-xs text-slate-500">
                {zone.clientCount || 0} clientes en esta zona
              </span>
            </div>
          </div>
          <div class="mt-3 flex items-center gap-3 flex-wrap">
            <a href="/clients?zone={zone.id}"
               class="inline-flex items-center gap-1 text-xs text-blue-600
                      hover:underline">
              👥 Ver clientes →
            </a>
            {#if (zone.clientCount || 0) > 0}
              <a href="/clients?bulk=zone:{zone.id}"
                 class="inline-flex items-center gap-1 text-xs text-brand-700
                        hover:underline"
                 title="Abre la lista de clientes con esta zona pre-seleccionada para asignar plan masivo">
                ⚡ Cambiar plan masivo
              </a>
            {/if}
            {#if zone.router}
              <a href="/clients/new?zone_id={zone.id}"
                 class="inline-flex items-center gap-1 text-xs text-emerald-700
                        hover:underline">
                ➕ Nuevo cliente
              </a>
            {:else}
              <span class="inline-flex items-center gap-1 text-xs text-slate-400 cursor-not-allowed"
                    title="Asigna un router para poder crear clientes">
                ➕ Nuevo cliente
              </span>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>
{/if}

<!-- Modal Create/Edit Zone -->
<Sheet bind:open={showModal} title={editing ? 'Editar Zona' : 'Nueva Zona'} maxWidth="max-w-md">
  <form on:submit|preventDefault={handleSubmit} id="zone-form" class="space-y-5">

    {#if formError}
      <div class="flex items-start gap-2 bg-red-50 border border-red-200
                  text-red-700 rounded-lg px-3 py-2.5 text-sm">
        <AlertTriangle size={14} class="mt-0.5 flex-shrink-0" />
        <span>{formError}</span>
      </div>
    {/if}

    <!-- Nombre -->
    <div>
      <label for="zone-name" class="label">Nombre de la zona *</label>
      <input id="zone-name" type="text" bind:value={form.name} required
             placeholder="Ej: LA ESTRELLA / SAN VICENTE"
             class="input" />
    </div>

    <!-- Router asociado -->
    <div>
      <label for="zone-router" class="label flex items-center gap-1.5">
        <RouterIcon size={12} /> Router asociado *
      </label>

      {#if routersLoading}
        <!-- Loading state — disabled select with spinner -->
        <div class="input flex items-center gap-2 text-text-secondary cursor-wait">
          <div class="w-3 h-3 border-2 border-brand-600 border-t-transparent rounded-full animate-spin"></div>
          Cargando routers...
        </div>
      {:else if routersError}
        <!-- Error state — surface the problem instead of an empty select -->
        <div class="flex items-start gap-2 bg-red-50 border border-red-200
                    text-red-700 rounded-lg px-3 py-2.5 text-sm">
          <AlertTriangle size={14} class="mt-0.5 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div>No se pudieron cargar los routers.</div>
            <div class="text-xs text-red-600/80 truncate" title={routersError}>{routersError}</div>
            <button type="button" on:click={loadRouters}
                    class="mt-1 text-xs text-brand-600 hover:underline font-medium">
              Reintentar
            </button>
          </div>
        </div>
      {:else if routers.length === 0}
        <!-- Empty state — block the flow with a clear CTA -->
        <div class="flex items-start gap-3 bg-amber-50 border border-amber-200
                    text-amber-800 rounded-lg p-3 text-sm">
          <AlertTriangle size={16} class="mt-0.5 flex-shrink-0 text-amber-500" />
          <div class="flex-1 min-w-0">
            <div class="font-medium">No hay routers registrados</div>
            <div class="text-xs text-amber-700/80 mt-0.5">
              Crea primero un router en el módulo MikroTik para poder asociarlo a esta zona.
            </div>
            <a href="/mikrotik/routers/new"
               class="inline-flex items-center gap-1 mt-2 text-xs font-medium
                      text-brand-600 hover:underline">
              + Crear router
            </a>
          </div>
        </div>
      {:else}
        <!-- Normal state — render the actual options -->
        <select id="zone-router" bind:value={form.routerId} required class="select">
          <option value="" disabled>Seleccionar router...</option>
          {#each routers as r (r.id)}
            <option value={String(r.id)}>
              {r.name} — {r.routes?.[0]?.ip ?? '—'}{r.apiPort && r.apiPort !== 80 ? `:${r.apiPort}` : ''}
            </option>
          {/each}
        </select>
        <p class="text-xs text-text-secondary mt-1.5">
          Todos los clientes de esta zona quedarán asociados a este router.
          {#if routers.length === 1}<span class="text-text-muted">· Solo hay un router disponible.</span>{/if}
        </p>
      {/if}
    </div>

    <!-- Descripción -->
    <div>
      <label for="zone-desc" class="label">Descripción</label>
      <textarea id="zone-desc" bind:value={form.description} rows="2"
                placeholder="Descripción del área de cobertura..."
                class="input resize-none"></textarea>
    </div>

    <!-- Color identificador -->
    <div>
      <label class="label">Color identificador</label>
      <div class="flex items-center gap-2 flex-wrap">
        {#each colors as color}
          <button type="button" on:click={() => form.color = color}
                  aria-label="Color {color}"
                  class="w-9 h-9 rounded-full transition-all active:scale-90
                         ring-2 ring-offset-2 ring-offset-white
                         {form.color === color
                           ? 'ring-brand-600 scale-105'
                           : 'ring-transparent hover:ring-slate-200'}"
                  style="background-color: {color}">
          </button>
        {/each}
        <label class="relative w-9 h-9 rounded-full border-2 border-dashed border-slate-300
                      hover:border-brand-600 cursor-pointer flex items-center justify-center
                      text-slate-400 hover:text-brand-600 transition"
               title="Color personalizado">
          <span class="text-lg leading-none">+</span>
          <input type="color" bind:value={form.color}
                 class="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
      </div>
    </div>
  </form>

  <svelte:fragment slot="footer">
    <button type="button" on:click={closeModal} class="btn-secondary" disabled={saving}>
      Cancelar
    </button>
    <button type="submit" form="zone-form" class="btn-primary"
            disabled={saving || routersLoading || routers.length === 0}>
      {#if saving}
        <div class="w-4 h-4 border-2 border-white border-t-transparent
                    rounded-full animate-spin"></div>
        Guardando...
      {:else}
        <Save size={15} /> {editing ? 'Guardar cambios' : 'Crear zona'}
      {/if}
    </button>
  </svelte:fragment>
</Sheet>
