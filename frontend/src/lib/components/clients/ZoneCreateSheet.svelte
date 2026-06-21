<script>
  // Inline zone creation — used from /clients/new step 0 so the operator
  // never has to leave the client-creation flow when the zone they need
  // doesn't exist yet. POSTs to /zones and emits `created` with the new
  // row so the parent form can auto-select it.

  import { createEventDispatcher } from 'svelte';
  import { Loader2, X, MapPin, Router as RouterIcon, AlertCircle } from 'lucide-svelte';
  import { zonesApi } from '$lib/api/zones.api.js';

  /** Available routers (id, name, apiPort, routes). Required to assign one. */
  export let routers = [];
  /** Whether the sheet is visible. Bind from parent. */
  export let open = false;

  const dispatch = createEventDispatcher();

  // Brand-aligned palette (mirrors /zones page).
  const COLORS = [
    '#2C4EC7', '#1e3a8a', '#0891b2', '#10b981', '#f59e0b',
    '#ef4444', '#8b5cf6', '#ec4899', '#64748b'
  ];

  let form = { name: '', description: '', color: COLORS[0], routerId: '' };
  let saving = false;
  let error  = '';

  function reset() {
    form = { name: '', description: '', color: COLORS[0], routerId: '' };
    error = '';
  }
  function close() {
    if (saving) return;
    reset();
    open = false;
    dispatch('close');
  }

  async function submit() {
    error = '';
    if (!form.name.trim()) { error = 'El nombre es requerido'; return; }
    if (!form.routerId)    { error = 'Selecciona un router'; return; }
    saving = true;
    try {
      const created = await zonesApi.create({
        name:        form.name.trim(),
        description: form.description?.trim() || null,
        color:       form.color,
        routerId:    Number(form.routerId)
      });
      const routerObj = routers.find(r => String(r.id) === String(form.routerId)) || null;
      dispatch('created', {
        // Merge the router so the parent form can render zone.router.name without a refetch.
        zone: { ...created, router: routerObj, clientCount: 0 }
      });
      reset();
      open = false;
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo crear la zona';
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <!-- Backdrop -->
  <button type="button" aria-label="Cerrar"
          on:click={close}
          class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity"></button>

  <!-- Sheet (right-anchored) -->
  <aside role="dialog" aria-label="Nueva zona"
         class="fixed inset-y-0 right-0 z-50 w-full sm:w-[28rem] bg-white shadow-2xl
                flex flex-col transition-transform duration-200">

    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background-color: {form.color}">
          <MapPin size={16} class="text-white" />
        </div>
        <div>
          <h3 class="text-sm font-semibold text-text-primary">Nueva zona</h3>
          <p class="text-[11px] text-text-muted leading-tight">Sin salir del alta del cliente</p>
        </div>
      </div>
      <button class="btn-icon" on:click={close} disabled={saving}>
        <X size={14} />
      </button>
    </div>

    <!-- Body -->
    <div class="flex-1 overflow-y-auto p-5 space-y-4">
      <div>
        <label for="zs-name" class="label">Nombre <span class="text-red-500">*</span></label>
        <input id="zs-name" type="text" bind:value={form.name}
               placeholder="Ej: Zona Norte"
               class="input" autocomplete="off" />
      </div>

      <div>
        <label for="zs-router" class="label">Router <span class="text-red-500">*</span></label>
        <select id="zs-router" bind:value={form.routerId} class="select">
          <option value="">— Selecciona el router que atiende esta zona —</option>
          {#each routers as r}
            <option value={r.id}>
              {r.name}{r.routes?.[0]?.ip ? ` — ${r.routes[0].ip}` : ''}
            </option>
          {/each}
        </select>
        <p class="text-[11px] text-text-muted mt-1">
          Toda zona se asigna a un único router. Los clientes de esta zona heredan ese router para el secret PPPoE.
        </p>
      </div>

      <div>
        <label for="zs-desc" class="label">Descripción (opcional)</label>
        <textarea id="zs-desc" bind:value={form.description} rows="2"
                  class="input resize-none"
                  placeholder="Notas técnicas, cobertura, etc."></textarea>
      </div>

      <div>
        <span class="label">Color</span>
        <div class="flex items-center gap-1.5 flex-wrap">
          {#each COLORS as c}
            <button type="button" on:click={() => form.color = c}
                    title={c}
                    class="w-7 h-7 rounded-full border-2 transition-transform
                           {form.color === c ? 'border-slate-900 scale-110' : 'border-white shadow-sm hover:scale-105'}"
                    style="background-color: {c}"></button>
          {/each}
          <input type="color" bind:value={form.color}
                 class="w-7 h-7 rounded-full overflow-hidden cursor-pointer border border-slate-200"
                 aria-label="Color personalizado" />
        </div>
      </div>

      {#if error}
        <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
      <button type="button" class="btn-secondary" on:click={close} disabled={saving}>
        Cancelar
      </button>
      <button type="button" class="btn-primary" on:click={submit} disabled={saving}>
        {#if saving}<Loader2 size={14} class="animate-spin" />{:else}<RouterIcon size={14} />{/if}
        Crear zona
      </button>
    </div>
  </aside>
{/if}
