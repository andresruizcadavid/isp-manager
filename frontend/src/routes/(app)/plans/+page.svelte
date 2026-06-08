<script>
  import { onMount } from 'svelte';
  import { plansApi } from '$lib/api/plans.api.js';
  import { routersApi } from '$lib/api/routers.api.js';
  import {
    Package, Pencil, X, AlertCircle, CheckCircle2, EyeOff, Layers,
    RefreshCw, Trash2, Loader2, Router as RouterIcon, AlertTriangle,
    ChevronDown, ChevronRight
  } from 'lucide-svelte';

  let plans = [];
  let loading = true;
  let error = '';

  // Router scoping — profiles are per-router, so the operator picks one.
  let routers = [];
  let routerId = '';
  let profiles = [];
  let profilesLoading = false;
  let profilesError = '';

  // Edit / Create modal
  let showEdit = false;
  let createMode = false;
  let editing = null;
  let editError = '';
  let saving = false;
  let syncToRouter = false;

  async function loadPlans() {
    loading = true; error = '';
    try { plans = (await plansApi.getAll()) || []; }
    catch (e) { error = e.message || 'Error cargando planes'; }
    finally { loading = false; }
  }

  async function loadRouters() {
    try {
      routers = (await routersApi.getAll()) || [];
      // Auto-pick first active router so the sync column is meaningful out of the gate.
      if (!routerId && routers.length > 0) routerId = String(routers[0].id);
    } catch { /* swallow — page still works without sync */ }
  }

  async function loadProfiles() {
    if (!routerId) { profiles = []; return; }
    profilesLoading = true; profilesError = '';
    try {
      const res = await routersApi.pppProfiles(Number(routerId));
      profiles = (res && res.profiles) || [];
    } catch (e) {
      profilesError = e.message || 'No se pudo consultar el router';
      profiles = [];
    } finally { profilesLoading = false; }
  }

  // Re-fetch profiles whenever the selected router changes.
  $: if (routerId) {
    loadProfiles();
    loadOrphans();
  }

  // ── Orphan / Unlinked profiles (cleanup tool) ───────────────────
  let orphans = [];
  let inUseUnlinked = [];
  let orphansLoading = false;
  let orphansError = '';
  let orphansOpen = false;

  async function loadOrphans() {
    if (!routerId) { orphans = []; inUseUnlinked = []; return; }
    orphansLoading = true; orphansError = '';
    try {
      const data = await routersApi.orphanPppProfiles(Number(routerId));
      orphans = data?.orphans || [];
      inUseUnlinked = data?.inUseUnlinked || [];
    } catch (e) {
      orphansError = e.message || 'No se pudieron leer huérfanos';
      orphans = [];
      inUseUnlinked = [];
    } finally { orphansLoading = false; }
  }

  async function deleteOrphan(name) {
    if (!confirm(`¿Eliminar el perfil "${name}" del router? No está en uso ni referenciado.`)) return;
    try {
      await routersApi.deletePppProfile(Number(routerId), name);
      await Promise.all([loadProfiles(), loadOrphans()]);
    } catch (e) {
      alert('No se pudo eliminar: ' + e.message);
    }
  }

  async function importProfile(profile) {
    const name = prompt('Nombre del plan a crear desde "' + profile.name + '":', profile.name);
    if (!name) return;
    try {
      await plansApi.create({
        name,
        type: 'PPPoE',
        mikrotikProfile: profile.name,
        price: 0,
        monthlyPrice: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        dataLimit: null,
        isActive: true,
      });
      await Promise.all([loadPlans(), loadProfiles(), loadOrphans()]);
    } catch (e) {
      alert('Error al importar: ' + e.message);
    }
  }

  onMount(async () => {
    await Promise.all([loadPlans(), loadRouters()]);
  });

  // Sync status helper.
  $: profileNames = new Set(profiles.map(p => p.name).filter(Boolean));
  function syncStatus(plan) {
    if (!routerId) return 'no_router';
    if (!plan.mikrotikProfile) return 'unset';
    return profileNames.has(plan.mikrotikProfile) ? 'synced' : 'missing';
  }

  function fmtMoney(cents) {
    if (cents == null) return '—';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  }
  const mbps = (kbps) => kbps ? (kbps / 1000).toFixed(kbps % 1000 ? 1 : 0) : 0;
  function fmtRate(rateLimit) {
    if (!rateLimit) return '—';
    const parts = rateLimit.split(' ');
    return parts[0] || rateLimit;
  }

  // KPIs
  $: kpiTotal    = plans.length;
  $: kpiActive   = plans.filter(p => p.isActive).length;
  $: kpiInactive = plans.filter(p => !p.isActive).length;
  // Free plans are intentionally priced 0 — they don't count as "por configurar".
  $: kpiNoPrice  = plans.filter(p => !p.isFree && !(p.monthlyPrice || p.price)).length;
  $: kpiSynced   = plans.filter(p => syncStatus(p) === 'synced').length;

  function openEdit(p) {
    editing = {
      id: p.id,
      name: p.name || '',
      type: p.type || 'PPPoE',
      mikrotikProfile: p.mikrotikProfile || '',
      monthlyPesos: Math.round((p.monthlyPrice || p.price || 0) / 100),
      downloadMbps: Number((p.downloadSpeed || 0) / 1000) || 0,
      uploadMbps:   Number((p.uploadSpeed   || 0) / 1000) || 0,
      dataLimit:    p.dataLimit ?? '',
      isActive:     p.isActive !== false,
      isFree:       !!p.isFree,
    };
    editError = ''; showEdit = true;
  }
  function newPlan() {
    createMode = true;
    editing = {
      id: null,
      name: '',
      type: 'PPPoE',
      mikrotikProfile: '',
      monthlyPesos: 0,
      downloadMbps: 0,
      uploadMbps: 0,
      dataLimit: '',
      isActive: true,
      isFree: false,
    };
    syncToRouter = false;
    editError = ''; showEdit = true;
  }

  function closeEdit() { showEdit = false; createMode = false; editing = null; editError = ''; syncToRouter = false; }

  async function saveEdit() {
    if (!editing) return;
    saving = true; editError = '';
    try {
      const cents = Math.round(Number(editing.monthlyPesos || 0) * 100);
      // Reject save if a profile is selected but doesn't exist on the router
      // (skip check when creating with sync-to-router — profile will be created).
      if (editing.mikrotikProfile && !profileNames.has(editing.mikrotikProfile) && !(createMode && syncToRouter)) {
        throw new Error(`El perfil "${editing.mikrotikProfile}" no existe en el router seleccionado.`);
      }
      const planData = {
        name: editing.name.trim(),
        type: editing.type || null,
        mikrotikProfile: editing.mikrotikProfile || null,
        // Free plans force price to 0 regardless of what the input held.
        price:        editing.isFree ? 0 : cents,
        monthlyPrice: editing.isFree ? 0 : cents,
        downloadSpeed: Math.round(Number(editing.downloadMbps || 0) * 1000),
        uploadSpeed:   Math.round(Number(editing.uploadMbps   || 0) * 1000),
        dataLimit:     editing.dataLimit === '' ? null : Number(editing.dataLimit),
        isActive: !!editing.isActive,
        isFree:   !!editing.isFree,
      };

      if (createMode && syncToRouter && routerId && editing.mikrotikProfile) {
        const rateLimit = `${editing.downloadMbps || 0}M/${editing.uploadMbps || 0}M`;
        await routersApi.createPppProfile(Number(routerId), {
          name: editing.mikrotikProfile,
          rateLimit,
        });
      }

      if (createMode) {
        await plansApi.create(planData);
      } else {
        await plansApi.update(editing.id, planData);
      }
      closeEdit();
      await Promise.all([loadPlans(), loadProfiles()]);
    } catch (e) { editError = e.message || 'No se pudo guardar'; }
    finally { saving = false; }
  }

  async function deleteOnRouter(plan) {
    if (!routerId || !plan.mikrotikProfile) return;
    if (!confirm(
      `¿Eliminar el perfil "${plan.mikrotikProfile}" del router?\n\n` +
      `Esto NO elimina el plan en el sistema — solo borra el PPP profile del MikroTik. ` +
      `Los clientes que usen este perfil dejarán de tener sus límites aplicados.`
    )) return;
    try {
      await routersApi.deletePppProfile(Number(routerId), plan.mikrotikProfile);
      await loadProfiles();
    } catch (e) {
      alert('No se pudo eliminar en MikroTik: ' + e.message);
    }
  }

  $: selectedRouter = routers.find(r => String(r.id) === String(routerId)) || null;
</script>

<svelte:head><title>Planes — ISP Manager</title></svelte:head>

<!-- Header -->
<div class="flex flex-wrap items-start justify-between gap-3 mb-4">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-text-primary tracking-tight">
      Planes de Servicio
    </h1>
    <p class="hidden sm:block text-sm text-text-secondary mt-1">
      Catálogo del ISP, sincronizado con los PPP Profiles del MikroTik.
    </p>
  </div>
  <button type="button" class="btn-primary" on:click={newPlan}>
    <Package size={14} /> Crear plan
  </button>
</div>

<!-- Router selector + sync action -->
<div class="card p-3 mb-4 flex flex-wrap items-center gap-2">
  <label for="router-pick" class="label !mb-0 flex items-center gap-1.5">
    <RouterIcon size={12} /> Router
  </label>
  <select id="router-pick" bind:value={routerId} class="select max-w-xs">
    <option value="">— Selecciona router para ver sync —</option>
    {#each routers as r}
      <option value={String(r.id)}>{r.name} — {r.routes?.[0]?.ip ?? '—'}</option>
    {/each}
  </select>
  {#if routerId}
    <button type="button" on:click={loadProfiles} disabled={profilesLoading}
            class="btn-secondary !py-1.5">
      {#if profilesLoading}
        <Loader2 size={14} class="animate-spin" /> Sincronizando...
      {:else}
        <RefreshCw size={14} /> Sincronizar perfiles
      {/if}
    </button>
  {/if}
  {#if profilesError}
    <span class="text-xs text-red-600 inline-flex items-center gap-1">
      <AlertCircle size={12} /> {profilesError}
    </span>
  {:else if profiles.length > 0}
    <span class="text-xs text-text-secondary">
      {profiles.length} {profiles.length === 1 ? 'perfil' : 'perfiles'} en el router
    </span>
  {/if}
</div>

<!-- KPI strip -->
<div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
  <div class="kpi-tile">
    <div class="icon-square-blue"><Layers size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Catálogo</div>
      <div class="kpi-value">{kpiTotal}</div>
      <div class="kpi-sub">Total de planes</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-green"><CheckCircle2 size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Activos</div>
      <div class="kpi-value">{kpiActive}</div>
      <div class="kpi-sub">Disponibles para venta</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-cyan"><EyeOff size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Inactivos</div>
      <div class="kpi-value">{kpiInactive}</div>
      <div class="kpi-sub">Ocultos del catálogo</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-amber"><AlertCircle size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Sin precio</div>
      <div class="kpi-value">{kpiNoPrice}</div>
      <div class="kpi-sub">Por configurar</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-blue"><RefreshCw size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Sincronizados</div>
      <div class="kpi-value">{kpiSynced}</div>
      <div class="kpi-sub">{routerId ? 'Con perfil en MikroTik' : 'Selecciona un router'}</div>
    </div>
  </div>
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
          <th>Plan</th>
          <th>Perfil MikroTik</th>
          <th>Sync</th>
          <th class="text-right">Precio</th>
          <th class="text-right">↓ / ↑</th>
          <th class="text-right">Datos</th>
          <th>Estado</th>
          <th class="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="8" class="py-16 text-center">
            <div class="flex items-center justify-center gap-2">
              <Loader2 size={14} class="animate-spin text-blue-400" />
              <span class="text-slate-500 text-sm">Cargando planes...</span>
            </div>
          </td></tr>
        {:else if plans.length === 0}
          <tr><td colspan="8" class="py-20 text-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <Package size={28} class="text-slate-400" />
              </div>
              <p class="text-sm font-semibold text-slate-700">No hay planes</p>
            </div>
          </td></tr>
        {:else}
          {#each plans as p}
            {@const status = syncStatus(p)}
            <tr>
              <td>
                <div class="font-medium text-slate-900">{p.name}</div>
                {#if p.type}<div class="text-[11px] text-slate-500">{p.type}</div>{/if}
              </td>
              <td>
                {#if p.mikrotikProfile}
                  <span class="font-mono text-xs text-slate-700">{p.mikrotikProfile}</span>
                {:else}
                  <span class="text-xs text-slate-400 italic">— sin asignar —</span>
                {/if}
              </td>
              <td>
                {#if status === 'no_router'}
                  <span class="text-[11px] text-slate-400">—</span>
                {:else if status === 'unset'}
                  <span class="badge bg-slate-100 text-slate-600 ring-slate-200 inline-flex items-center gap-1">
                    <AlertTriangle size={10} /> Sin asignar
                  </span>
                {:else if status === 'synced'}
                  <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100 inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> Sincronizado
                  </span>
                {:else}
                  <span class="badge bg-red-50 text-red-700 ring-red-100 inline-flex items-center gap-1"
                        title="El perfil no existe en el router seleccionado">
                    <AlertCircle size={10} /> No existe en MikroTik
                  </span>
                {/if}
              </td>
              <td class="text-right font-mono text-xs">
                {#if p.isFree}
                  <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100 font-semibold">Gratis</span>
                {:else if p.monthlyPrice || p.price}
                  <span class="font-semibold text-slate-900">{fmtMoney(p.monthlyPrice || p.price)}</span>
                {:else}
                  <span class="text-amber-600 italic">sin definir</span>
                {/if}
              </td>
              <td class="text-right font-mono text-[11px] text-slate-600 whitespace-nowrap">
                {p.downloadSpeed ? `${mbps(p.downloadSpeed)}` : '—'} / {p.uploadSpeed ? `${mbps(p.uploadSpeed)}` : '—'}
              </td>
              <td class="text-right font-mono text-xs text-slate-600">{p.dataLimit ? `${p.dataLimit} GB` : 'Ilimitado'}</td>
              <td>
                {#if p.isActive}<span class="badge-green">Activo</span>
                {:else}<span class="badge-gray">Inactivo</span>{/if}
              </td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <button class="btn-icon" title="Editar plan" on:click={() => openEdit(p)}>
                    <Pencil size={14} />
                  </button>
                  {#if status === 'synced'}
                    <button class="btn-icon hover:!text-red-600 hover:!bg-red-50"
                            title="Eliminar perfil en MikroTik (no toca el plan local)"
                            on:click={() => deleteOnRouter(p)}>
                      <Trash2 size={14} />
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>

  <div class="px-5 py-3 border-t border-slate-100 bg-slate-50/40">
    <span class="text-xs text-slate-500">{plans.length} plan{plans.length === 1 ? '' : 'es'}</span>
  </div>
</div>

<!-- ─── Perfiles disponibles en MikroTik ──────────────────────────── -->
{#if routerId && profiles.length > 0}
  <div class="card mt-4 overflow-hidden">
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-100">
      <div class="flex items-center gap-2">
        <RouterIcon size={14} class="text-slate-400" />
        <span class="text-sm font-medium text-text-primary">
          Perfiles PPP en {selectedRouter?.name || 'el router'}
        </span>
        <span class="badge bg-slate-100 text-slate-600 ring-slate-200 text-[11px]">{profiles.length}</span>
      </div>
      {#if profilesLoading}
        <Loader2 size={12} class="animate-spin text-blue-400" />
      {/if}
    </div>

    <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Perfil</th>
            <th>Rate Limit</th>
            <th>Estado</th>
            <th class="text-right">Acción</th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as p (p.id || p.name)}
            <tr>
              <td>
                <div class="font-medium text-sm text-slate-900 font-mono">{p.name}</div>
                {#if p.comment}
                  <div class="text-[11px] text-slate-500">{p.comment}</div>
                {/if}
              </td>
              <td class="font-mono text-xs text-slate-600">
                {p.rateLimit ? fmtRate(p.rateLimit) : '—'}
              </td>
              <td>
                {#if p.isBuiltin}
                  <span class="badge bg-slate-100 text-slate-500 ring-slate-200 text-[11px]">Sistema</span>
                {:else if p.linkedToPlan}
                  <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100 inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> Vinculado a plan
                  </span>
                {:else if p.inUse}
                  <span class="badge bg-amber-50 text-amber-700 ring-amber-100 inline-flex items-center gap-1">
                    <AlertTriangle size={10} /> En uso sin plan
                  </span>
                {:else}
                  <span class="badge bg-blue-50 text-blue-700 ring-blue-100 inline-flex items-center gap-1">
                    Disponible
                  </span>
                {/if}
              </td>
              <td class="text-right">
                {#if !p.isBuiltin && !p.linkedToPlan}
                  <button class="btn-primary !py-1 !px-3 text-xs" on:click={() => importProfile(p)}>
                    Importar
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

<!-- ─── Perfiles sin vínculo en el router ──────────────────────────── -->
{#if routerId}
  <div class="card mt-4">
    <button type="button" on:click={() => orphansOpen = !orphansOpen}
            class="w-full flex items-center justify-between px-5 py-3
                   text-left hover:bg-slate-50 transition rounded-xl">
      <div class="flex items-center gap-2">
        <AlertCircle size={14} class="text-slate-400" />
        <span class="text-sm font-medium text-text-primary">
          Perfiles sin plan local en {selectedRouter?.name || 'el router'}
        </span>
        {#if orphans.length + inUseUnlinked.length > 0}
          <span class="badge bg-amber-50 text-amber-700 ring-amber-100">{orphans.length + inUseUnlinked.length}</span>
        {/if}
      </div>
      <svelte:component this={orphansOpen ? ChevronDown : ChevronRight} size={14} class="text-slate-400" />
    </button>

    {#if orphansOpen}
      <div class="px-5 pb-4 border-t border-slate-100">
        {#if orphansLoading}
          <div class="flex items-center gap-2 text-xs text-slate-500 py-3">
            <Loader2 size={12} class="animate-spin" /> Analizando...
          </div>
        {:else if orphansError}
          <div class="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            {orphansError}
          </div>
        {:else if orphans.length === 0 && inUseUnlinked.length === 0}
          <div class="text-xs text-emerald-700 inline-flex items-center gap-1.5">
            <CheckCircle2 size={12} /> Todos los perfiles están vinculados a un plan.
          </div>
        {:else}
          {#if orphans.length > 0}
            <div class="py-3">
              <p class="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1.5">
                <Trash2 size={12} class="text-amber-500" />
                Huérfanos — no los usa ningún cliente ni plan ({orphans.length})
              </p>
              <div class="flex flex-wrap gap-2">
                {#each orphans as o (o.name)}
                  <div class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                              bg-amber-50 border border-amber-200 text-xs">
                    <span class="font-mono text-slate-700">{o.name}</span>
                    {#if o.rateLimit}
                      <span class="text-slate-400 text-[10px]">· {fmtRate(o.rateLimit)}</span>
                    {/if}
                    <button type="button" on:click={() => deleteOrphan(o.name)}
                            title="Eliminar del router"
                            class="ml-1 text-slate-400 hover:text-red-600 transition">
                      <Trash2 size={12} />
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if inUseUnlinked.length > 0}
            <div class="py-3 border-t border-slate-100">
              <p class="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} class="text-blue-500" />
                En uso por clientes pero sin plan local ({inUseUnlinked.length})
              </p>
              <div class="flex flex-wrap gap-2">
                {#each inUseUnlinked as o (o.name)}
                  <div class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                              bg-blue-50 border border-blue-200 text-xs">
                    <span class="font-mono text-slate-700">{o.name}</span>
                    {#if o.rateLimit}
                      <span class="text-slate-400 text-[10px]">· {fmtRate(o.rateLimit)}</span>
                    {/if}
                    <button class="ml-1 text-blue-500 hover:text-blue-700 transition font-medium"
                            on:click={() => importProfile(o)}>
                      Importar
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if showEdit && editing}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" on:click|self={closeEdit}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
      <div class="flex items-center justify-between p-6 border-b border-slate-200">
        <h2 class="text-lg font-semibold text-slate-900">{createMode ? 'Crear plan' : 'Editar plan'}</h2>
        <button class="text-slate-400 hover:text-slate-600" on:click={closeEdit}>
          <X size={20} />
        </button>
      </div>

      <div class="p-6 space-y-4">
        {#if editError}
          <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{editError}</div>
        {/if}

        <div>
          <label for="plan-name" class="label">Nombre</label>
          <input id="plan-name" type="text" class="input" bind:value={editing.name} />
        </div>

        <div>
          <label for="plan-profile" class="label">Perfil MikroTik (técnico)</label>
          {#if createMode && syncToRouter}
            <input id="plan-profile" type="text" class="input font-mono" bind:value={editing.mikrotikProfile}
                   placeholder="ej. Online_basico" />
            <p class="text-xs text-text-secondary mt-1.5">
              Nombre del nuevo perfil que se creará en {selectedRouter?.name || 'el router'}.
            </p>
          {:else if !routerId}
            <div class="input flex items-center text-text-secondary bg-slate-50 cursor-not-allowed">
              Selecciona un router arriba para listar perfiles
            </div>
          {:else if profilesLoading}
            <div class="input flex items-center gap-2 text-text-secondary cursor-wait">
              <Loader2 size={14} class="animate-spin" /> Cargando perfiles...
            </div>
          {:else if profiles.length === 0}
            <div class="input flex items-center text-text-secondary bg-slate-50">
              Este router no tiene perfiles PPP
            </div>
          {:else}
            <select id="plan-profile" bind:value={editing.mikrotikProfile} class="select font-mono">
              <option value="">— sin asignar —</option>
              {#each profiles as pr}
                <option value={pr.name}>{pr.name}</option>
              {/each}
            </select>
            <p class="text-xs text-text-secondary mt-1.5">
              Nombre técnico del perfil en {selectedRouter?.name}. Debe existir en el router.
            </p>
          {/if}
        </div>

        {#if createMode && routerId}
          <label class="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" class="rounded border-slate-300" bind:checked={syncToRouter} />
            <span class="text-text-primary">Crear perfil PPP en MikroTik</span>
            <span class="text-xs text-text-secondary">(se usará el nombre del perfil + velocidad)</span>
          </label>
        {/if}

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="plan-type" class="label">Tipo</label>
            <select id="plan-type" class="select" bind:value={editing.type}>
              <option value="PPPoE">PPPoE</option>
              <option value="Hotspot">Hotspot</option>
              <option value="Static">Static IP</option>
              <option value="">(sin tipo)</option>
            </select>
          </div>
          <div>
            <label for="plan-price" class="label">Precio mensual (COP)</label>
            <input id="plan-price" type="number" min="0" step="1000" class="input"
                   bind:value={editing.monthlyPesos}
                   disabled={editing.isFree}
                   placeholder={editing.isFree ? '0 (gratis)' : ''} />
            {#if editing.isFree}
              <p class="text-[11px] text-emerald-700 mt-1">
                Plan gratuito (trueque) — no se facturará.
              </p>
            {/if}
          </div>
          <div>
            <label for="plan-down" class="label">Bajada (Mbps)</label>
            <input id="plan-down" type="number" min="0" step="1" class="input" bind:value={editing.downloadMbps} />
          </div>
          <div>
            <label for="plan-up" class="label">Subida (Mbps)</label>
            <input id="plan-up" type="number" min="0" step="1" class="input" bind:value={editing.uploadMbps} />
          </div>
          <div>
            <label for="plan-data" class="label">Cuota datos (GB)</label>
            <input id="plan-data" type="number" min="0" placeholder="vacío = ilimitado" class="input" bind:value={editing.dataLimit} />
          </div>
          <div class="flex items-end">
            <label class="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" class="rounded border-slate-300" bind:checked={editing.isActive} />
              Activo
            </label>
          </div>
          <div class="flex items-end">
            <label class="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-600/30"
                     bind:checked={editing.isFree}
                     on:change={() => { if (editing.isFree) editing.monthlyPesos = 0; }} />
              <span>Plan gratis <span class="text-text-muted">(trueque)</span></span>
            </label>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 p-6 border-t border-slate-200 bg-slate-50">
        <button class="btn-secondary" on:click={closeEdit} disabled={saving}>Cancelar</button>
        <button class="btn-primary" on:click={saveEdit} disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  </div>
{/if}
