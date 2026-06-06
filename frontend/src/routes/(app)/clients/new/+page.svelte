<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { clientsApi } from '$lib/api/clients.api.js';
  import { zonesApi } from '$lib/api/zones.api.js';
  import { plansApi } from '$lib/api/plans.api.js';
  import { routersApi } from '$lib/api/routers.api.js';
  import { ArrowLeft, ArrowRight, User, MapPin, Router as RouterIcon,
           Wifi, Save, X, CheckCircle2, AlertTriangle, Plus,
           Search, Loader2, AlertCircle, ShieldCheck, Database, Shield } from 'lucide-svelte';
  import ZoneCreateSheet from '$lib/components/clients/ZoneCreateSheet.svelte';

  // Selected zone id (always required; sticky summary surfaces its state).
  let selectedZoneId = null;
  let zonesAvailable = [];       // only zones with router
  let zonesAll = [];             // all zones (for "sin router" info)
  let plans = [];
  let routers = [];              // for inline zone creation
  let zonesLoading = true;
  let plansLoading = true;
  let saving = false;
  let error = '';

  // Inline zone creation sheet
  let zoneSheetOpen = false;

  // ── Client form (no routerId — backend resolves from zone) ──
  let form = {
    fullName: '', documentType: 'CC', documentNumber: '',
    email: '', phone: '', address: '', neighborhood: '',
    city: '',
    contractDate: '', installationDate: '',
    // Per-client monthly fee override. Empty / 0 ⇒ inherit from plan.
    // Stored in COP (the backend keeps cents but we display whole pesos).
    monthlyFee: '',
    notes: '',
    planId: '',
    mikrotik: {
      username: '', password: '', remoteAddress: '',
      localAddress: '', profileName: '', coordinates: '',
      status: 'ACTIVE'
    }
  };

  $: selectedZone = zonesAvailable.find(z => z.id === selectedZoneId) || null;
  $: zonesWithoutRouter = zonesAll.filter(z => !z.routerId);

  // Summary panel — derived completion metrics so the operator sees at a
  // glance how close the form is to "guardable" without scrolling.
  $: filledPersonal = [form.fullName, form.documentNumber, form.phone, form.address].filter(Boolean).length;
  $: hasService = Boolean(form.planId && form.mikrotik.username && form.mikrotik.remoteAddress);
  $: selectedPlanName = plans.find(p => p.id === form.planId)?.name || null;

  onMount(async () => {
    // Pre-select zone from ?zone_id query param if present
    const preZone = $pageStore.url.searchParams.get('zone_id');

    try {
      const [zWith, zAll, p, r] = await Promise.all([
        zonesApi.getWithRouter().catch(() => []),
        zonesApi.getAll().catch(() => []),
        plansApi.getAll().catch(() => []),
        routersApi.getAll().catch(() => [])
      ]);
      zonesAvailable = zWith || [];
      zonesAll = zAll || [];
      plans = p || [];
      routers = r || [];
    } catch (e) {
      error = e.message || 'Error cargando datos';
    } finally {
      zonesLoading = false;
      plansLoading = false;
    }

    if (preZone) {
      const match = zonesAvailable.find(z => String(z.id) === String(preZone));
      if (match) selectedZoneId = match.id;
    }
  });

  // ── Inline zone created ──────────────────────────────────────────────
  // The Sheet emits the new zone row (already with its router attached).
  // We push it into the available list and auto-select it so the operator
  // continues seamlessly without losing form state.
  function onZoneCreated(e) {
    const z = e.detail?.zone;
    if (!z) return;
    if (z.router) zonesAvailable = [...zonesAvailable, { ...z, clientCount: 0 }];
    zonesAll = [...zonesAll, z];
    selectedZoneId = z.id;
    zoneSheetOpen = false;
  }

  // ── Auto-generate helpers (unchanged) ──────────────
  function generateUsername() {
    if (form.fullName && form.documentNumber) {
      const num = form.documentNumber.slice(-4).padStart(4, '0');
      const name = form.fullName
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      form.mikrotik.username = `${num}${name}`;
    }
  }
  function generatePassword() {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    form.mikrotik.password = Array.from({ length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  // ── Available IPs popover (for "Remote Address PPPoE" field) ─────────
  // Router is derived from the selected zone (see selectedZone.router.id).
  let ipsPopoverOpen = false;
  let ipsLoading = false;
  let ipsError = '';
  let ipsAvailable = [];
  let ipsTotals = null;
  let ipsTruncated = false;
  let ipsRouterId = null;       // routerId we last fetched for; refetch when zone changes
  let ipsRouterName = '';

  async function openIpsPopover() {
    ipsError = '';
    const rid = selectedZone?.router?.id;
    if (!rid) {
      ipsError = 'La zona seleccionada no tiene router asignado.';
      ipsPopoverOpen = true;
      return;
    }
    ipsPopoverOpen = true;
    // Reuse cached list if same router and not empty
    if (ipsRouterId === rid && ipsAvailable.length > 0 && !ipsError) return;

    ipsLoading = true; ipsAvailable = []; ipsTotals = null; ipsTruncated = false;
    try {
      const data = await routersApi.availableIps(rid);
      ipsAvailable = data?.available || [];
      ipsTotals = data?.totals || null;
      ipsTruncated = !!data?.truncated;
      ipsRouterId = rid;
      ipsRouterName = data?.router?.name || selectedZone?.router?.name || '';
    } catch (e) {
      ipsError = e.message || 'No se pudo obtener la lista de IPs disponibles.';
    } finally { ipsLoading = false; }
  }

  function pickIp(ip) {
    form.mikrotik.remoteAddress = ip;
    ipsPopoverOpen = false;
  }

  function refreshIps() {
    ipsRouterId = null; // invalidate cache
    openIpsPopover();
  }

  // If the user goes back to Step 0 and picks a different zone (=different
  // router), drop the cached list so we don't show stale IPs.
  $: if (selectedZone?.router?.id !== undefined) {
    if (ipsRouterId !== null && selectedZone.router.id !== ipsRouterId) {
      ipsPopoverOpen = false;
      ipsAvailable = [];
      ipsRouterId = null;
    }
  }

  // ── PPPoE profiles (loaded from MikroTik) ────────────────────────
  // Replaces the old free-text "Perfil PPPoE" field with a select fed by
  // the actual profiles configured on the zone's router. This prevents
  // the "input does not match any value of profile" error at create time.
  let profiles = [];
  let profilesLoading = false;
  let profilesError = '';
  let profilesRouterId = null;  // routerId we last fetched for

  async function loadProfiles(routerId) {
    profilesLoading = true;
    profilesError = '';
    profiles = [];
    try {
      const data = await routersApi.pppoeProfiles(routerId);
      profiles = Array.isArray(data) ? data : [];
      profilesRouterId = routerId;
    } catch (e) {
      profilesError = e.message || 'No se pudieron cargar los perfiles del router';
      profilesRouterId = null;
    } finally {
      profilesLoading = false;
    }
  }

  // Reactively (re)load profiles whenever the zone's router changes.
  // Single-page form means we always want fresh profiles once a zone is set.
  $: if (selectedZone?.router?.id && selectedZone.router.id !== profilesRouterId) {
    loadProfiles(selectedZone.router.id);
  }

  // ── Progress dialog state machine ──────────────────
  // The dialog is decorative: a single backend POST runs the full flow
  // (verify → mikrotik → db). We animate steps client-side so the operator
  // sees what's happening; the final 'done' / 'error' state is driven by
  // the server response.
  let progressOpen = false;
  let progressStep = 'verifying'; // verifying | creating | authorizing | syncing | done | error
  let progressError = '';
  let progressTimers = [];

  function clearProgressTimers() {
    progressTimers.forEach(t => clearTimeout(t));
    progressTimers = [];
  }

  function startProgressAnimation() {
    progressStep = 'verifying';
    progressError = '';
    clearProgressTimers();
    // verifying → creating PPPoE → authorizing IP → syncing DB (held until response)
    progressTimers.push(setTimeout(() => { progressStep = 'creating';    },  700));
    progressTimers.push(setTimeout(() => { progressStep = 'authorizing'; }, 1900));
    progressTimers.push(setTimeout(() => { progressStep = 'syncing';     }, 3000));
  }

  async function handleSubmit() {
    if (!selectedZoneId) {
      error = 'Debes seleccionar una zona';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    saving = true;
    error = '';
    progressOpen = true;
    startProgressAnimation();

    try {
      const payload = {
        fullName:       form.fullName,
        documentType:   form.documentType,
        documentNumber: form.documentNumber,
        email:          form.email,
        phone:          form.phone ? `+57${form.phone}` : '',
        address:        form.address,
        neighborhood:   form.neighborhood,
        city:           form.city || undefined,         // controller falls back to COMPANY_CITY
        zoneId:         selectedZoneId,
        contractDate:   form.contractDate     || null,
        installationDate: form.installationDate || null,
        // Send monthlyFee only when the operator filled it; otherwise the
        // server keeps the plan's price as the source of truth.
        monthlyFee:     form.monthlyFee !== '' && Number(form.monthlyFee) > 0
                          ? Math.round(Number(form.monthlyFee) * 100)   // pesos → cents
                          : undefined,
        notes:          form.notes,
        planId:         form.planId || null,
        // Note: no routerId — server resolves from zone.
        mikrotik: {
          username:      form.mikrotik.username,
          password:      form.mikrotik.password,
          remoteAddress: form.mikrotik.remoteAddress,
          localAddress:  form.mikrotik.localAddress,
          profileName:   form.mikrotik.profileName,
          coordinates:   form.mikrotik.coordinates,
          status:        form.mikrotik.status,
        }
      };
      const created = await clientsApi.create(payload);
      clearProgressTimers();
      progressStep = 'done';
      // Brief moment so the user sees the success state before navigating.
      setTimeout(() => goto(`/clients/${created.id}`), 800);
    } catch (e) {
      clearProgressTimers();
      progressStep = 'error';
      progressError = e.message || 'No se pudo crear el cliente.';
    } finally {
      saving = false;
    }
  }

  function closeProgressDialog() {
    if (progressStep === 'done') return; // navigation handles it
    progressOpen = false;
    progressStep = 'verifying';
    progressError = '';
  }
</script>

<svelte:head>
  <title>Nuevo Cliente — ISP Manager</title>
</svelte:head>

<!-- Page header -->
<div class="flex flex-col xs:flex-row xs:items-center justify-between gap-2 mb-4">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Nuevo Cliente</h1>
    <p class="text-sm sm:text-[13px] text-slate-500 mt-0.5">Agregar un nuevo abonado al sistema</p>
  </div>
  <a href="/clients" class="btn-secondary self-start">
    <ArrowLeft size={16} class="sm:w-3.5 sm:h-3.5" /> Volver
  </a>
</div>


{#if error}
  <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg
              px-4 py-3 text-sm mb-4 flex items-center gap-2">
    <X size={16} /> {error}
  </div>
{/if}

<!-- ─── Single-page form: 3 sections + sticky summary on the right ─── -->
<form on:submit|preventDefault={handleSubmit} class="grid lg:grid-cols-[1fr_320px] gap-4 lg:gap-6 items-start">
  <div class="space-y-4 min-w-0">

    <!-- SECTION 1: Zona y contexto técnico -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">1</div>
          <MapPin size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Zona y contexto técnico</h2>
        </div>
      </div>
      <div class="card-body">
        {#if zonesLoading}
          <div class="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
            <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            Cargando zonas...
          </div>
        {:else if zonesAvailable.length === 0}
          <div class="text-center py-10">
            <AlertTriangle size={32} class="mx-auto text-amber-400 mb-3" />
            <p class="text-sm font-semibold text-slate-700 mb-1">
              No hay zonas con router asignado
            </p>
            <p class="text-xs text-slate-500 mb-4">
              Crea una zona aquí mismo sin salir del alta del cliente.
            </p>
            <div class="flex items-center justify-center gap-2 flex-wrap">
              <button type="button" on:click={() => zoneSheetOpen = true} class="btn-primary inline-flex">
                <Plus size={14} /> Crear zona nueva
              </button>
              <a href="/zones" class="btn-secondary inline-flex">
                <MapPin size={14} /> Ir a Zonas
              </a>
            </div>
          </div>
        {:else}
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <p class="text-xs sm:text-[11px] text-slate-500 max-w-md">
              La zona define el router al que el cliente quedará asociado.
            </p>
            <button type="button" on:click={() => zoneSheetOpen = true}
                    class="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline">
              <Plus size={13} /> Crear zona nueva
            </button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            {#each zonesAvailable as zone}
              <button type="button"
                      on:click={() => selectedZoneId = zone.id}
                      class="text-left p-3 rounded-xl border-2 transition-all
                             {selectedZoneId === zone.id
                               ? 'border-brand-800 bg-blue-50/40 shadow-sm'
                               : 'border-slate-200 hover:border-slate-300 bg-white'}">
                <div class="flex items-start gap-2.5">
                  <div class="w-3 sm:w-2.5 h-3 sm:h-2.5 rounded-full mt-1 flex-shrink-0"
                       style="background-color: {zone.color || '#3b82f6'}"></div>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm sm:text-[13px] font-semibold text-slate-900 truncate">{zone.name}</div>
                    {#if zone.description}
                      <div class="text-xs sm:text-[11px] text-slate-500 truncate">{zone.description}</div>
                    {/if}
                    {#if zone.router}
                      <div class="text-xs sm:text-[11px] text-slate-500 mt-1 truncate">
                        📡 <span class="font-medium">{zone.router.name}</span>
                        <span class="font-mono text-slate-400">— {(zone.router.routes?.[0]?.ip ?? '—')}</span>
                      </div>
                    {/if}
                    <div class="text-xs sm:text-[11px] text-slate-400 mt-0.5">
                      {zone.clientCount || 0} clientes
                    </div>
                  </div>
                  {#if selectedZoneId === zone.id}
                    <CheckCircle2 size={18} class="sm:w-4 sm:h-4 text-brand-800 flex-shrink-0" />
                  {/if}
                </div>
              </button>
            {/each}

            <!-- Disabled zones (without router) — informational only -->
            {#each zonesWithoutRouter as zone}
              <div class="p-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 opacity-70"
                   title="Zona sin router asignado">
                <div class="flex items-start gap-2.5">
                  <div class="w-3 sm:w-2.5 h-3 sm:h-2.5 rounded-full mt-1.5 flex-shrink-0 bg-slate-300"></div>
                  <div class="min-w-0 flex-1">
                    <div class="text-sm sm:text-[13px] font-semibold text-slate-500 truncate">{zone.name}</div>
                    <div class="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded
                                bg-amber-50 text-amber-700 ring-1 ring-amber-100 text-[10px]">
                      ⚠️ Sin router
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>

        {/if}
      </div>
    </div>

    <!-- SECTION 2: Datos del cliente -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">2</div>
          <User size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Datos del cliente</h2>
        </div>
      </div>
      <div class="card-body grid grid-cols-1 md:grid-cols-2 gap-5">

        <div class="md:col-span-2">
          <label for="fullName" class="label">Nombre Completo *</label>
          <input id="fullName" type="text" bind:value={form.fullName}
                 on:blur={generateUsername} required
                 placeholder="Ej: María Godoy Urrea" class="input"/>
        </div>

        <div>
          <label for="documentType" class="label">Tipo Documento</label>
          <select id="documentType" bind:value={form.documentType} class="select">
            <option value="CC">Cédula de Ciudadanía</option>
            <option value="NIT">NIT</option>
            <option value="CE">Cédula Extranjería</option>
            <option value="PAS">Pasaporte</option>
          </select>
        </div>

        <div>
          <label for="documentNumber" class="label">Número Documento *</label>
          <input id="documentNumber" type="text" bind:value={form.documentNumber} required
                 on:blur={generateUsername} class="input"/>
        </div>

        <div>
          <label for="email" class="label">Correo Electrónico</label>
          <input id="email" type="email" bind:value={form.email}
                 placeholder="cliente@email.com" class="input"/>
        </div>

        <div>
          <label for="phone" class="label">Teléfono / WhatsApp</label>
          <div class="flex">
            <span class="inline-flex items-center px-3 rounded-l-lg
                         border border-r-0 border-slate-200
                         bg-slate-50 text-slate-700 text-sm">+57</span>
            <input id="phone" type="tel" bind:value={form.phone}
                   placeholder="3001234567"
                   class="input flex-1 rounded-l-none" />
          </div>
        </div>

        <div>
          <label for="address" class="label">Dirección de Instalación</label>
          <input id="address" type="text" bind:value={form.address}
                 placeholder="Calle 5 # 3-20" class="input"/>
        </div>

        <div>
          <label for="neighborhood" class="label">Barrio / Sector</label>
          <input id="neighborhood" type="text" bind:value={form.neighborhood} class="input"/>
        </div>

        <div>
          <label for="city" class="label">
            Ciudad
            <span class="text-slate-400 text-xs font-normal ml-1">opcional</span>
          </label>
          <input id="city" type="text" bind:value={form.city}
                 placeholder="Cali" class="input"/>
        </div>

        <div>
          <label for="contractDate" class="label">Fecha de Contrato</label>
          <input id="contractDate" type="date" bind:value={form.contractDate} class="input"/>
        </div>

        <div>
          <label for="installationDate" class="label">
            Fecha de Instalación
            <span class="text-slate-400 text-xs font-normal ml-1">opcional</span>
          </label>
          <input id="installationDate" type="date" bind:value={form.installationDate} class="input"/>
        </div>

        <div class="md:col-span-2">
          <label for="notes" class="label">Notas</label>
          <textarea id="notes" bind:value={form.notes} rows="2"
                    placeholder="Observaciones del cliente..."
                    class="input resize-none"></textarea>
        </div>
      </div>
    </div>

    <!-- SECTION 3: Servicio (plan, PPPoE, credenciales) — no router select; derived from zone -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">3</div>
          <RouterIcon size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Servicio</h2>
        </div>
      </div>
      <div class="card-body grid grid-cols-1 md:grid-cols-2 gap-5">

        <div class="md:col-span-2">
          <label for="planId" class="label">Plan de Servicio *</label>
          <select id="planId" bind:value={form.planId} required class="select">
            <option value="">Seleccionar plan...</option>
            {#each plans as p}
              <option value={p.id}>{p.name} — {p.downloadSpeed}↓/{p.uploadSpeed}↑ Mbps —
                ${(p.monthlyPrice / 100)?.toLocaleString('es-CO')} COP</option>
            {/each}
          </select>
        </div>

        <div class="md:col-span-2">
          <label for="monthlyFee" class="label">
            Precio mensual personalizado
            <span class="text-slate-400 text-xs font-normal ml-1">
              (opcional — sobreescribe el precio del plan)
            </span>
          </label>
          <div class="flex">
            <span class="inline-flex items-center px-3 rounded-l-lg
                         border border-r-0 border-slate-200
                         bg-slate-50 text-slate-700 text-sm font-mono">COP</span>
            <input id="monthlyFee" type="number" min="0" step="1000"
                   bind:value={form.monthlyFee}
                   placeholder="Dejar vacío para heredar del plan"
                   class="input flex-1 rounded-l-none font-mono"/>
          </div>
        </div>

        <div>
          <label for="username" class="label">
            Usuario en el RB (PPPoE)
            <span class="text-slate-400 text-xs font-normal ml-1">Auto-generado</span>
          </label>
          <input id="username" type="text" bind:value={form.mikrotik.username}
                 placeholder="0026maria_godoy_urrea" class="input font-mono"/>
        </div>

        <div>
          <label for="password" class="label">Password PPPoE</label>
          <div class="flex gap-2">
            <input id="password" type="text" bind:value={form.mikrotik.password}
                   class="flex-1 input font-mono"/>
            <button type="button" on:click={generatePassword} class="btn-ghost"
                    title="Generar contraseña aleatoria">
              <Wifi size={14} /> Auto
            </button>
          </div>
        </div>

        <div class="relative">
          <label for="remoteAddress" class="label">
            Remote Address PPPoE
            <span class="text-slate-400 text-xs font-normal">(IP cliente)</span>
          </label>
          <div class="flex gap-2">
            <input id="remoteAddress" type="text" bind:value={form.mikrotik.remoteAddress}
                   placeholder="172.16.60.28" class="flex-1 input font-mono" />
            <button type="button" on:click={openIpsPopover}
                    class="btn-ghost"
                    title="Ver IPs disponibles del router de la zona">
              <Search size={14} /> IPs
            </button>
          </div>

          {#if ipsPopoverOpen}
            <!-- click-outside backdrop -->
            <div class="fixed inset-0 z-40" on:click={() => ipsPopoverOpen = false}></div>

            <div class="absolute z-50 left-0 right-0 top-full mt-1 bg-white rounded-xl
                        shadow-xl border border-slate-200 max-h-80 overflow-hidden flex flex-col">
              <div class="px-3 py-2 border-b border-slate-100 flex items-center
                          justify-between gap-2 bg-slate-50">
                <div class="flex items-center gap-2 min-w-0">
                  <Wifi size={13} class="text-slate-500 flex-shrink-0" />
                  <span class="text-xs font-semibold text-slate-700 truncate">
                    IPs disponibles{ipsRouterName ? ` — ${ipsRouterName}` : ''}
                  </span>
                </div>
                <div class="flex items-center gap-1">
                  <button type="button" on:click={refreshIps}
                          class="text-xs text-brand-800 hover:underline disabled:opacity-50"
                          disabled={ipsLoading}
                          title="Actualizar lista">
                    {#if ipsLoading}
                      <Loader2 size={12} class="animate-spin inline" />
                    {:else}
                      Actualizar
                    {/if}
                  </button>
                  <button type="button" on:click={() => ipsPopoverOpen = false}
                          class="text-slate-400 hover:text-slate-600" title="Cerrar">
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div class="overflow-y-auto p-2">
                {#if ipsLoading}
                  <div class="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                    <Loader2 size={14} class="animate-spin" /> Consultando router...
                  </div>
                {:else if ipsError}
                  <div class="flex items-start gap-2 px-2 py-3 text-xs text-amber-700 bg-amber-50 rounded-lg">
                    <AlertCircle size={13} class="mt-0.5 flex-shrink-0" />
                    <span>{ipsError}</span>
                  </div>
                {:else if ipsAvailable.length === 0}
                  <div class="text-center text-xs text-slate-500 py-6">
                    No hay IPs disponibles en los pools del router.
                  </div>
                {:else}
                  <div class="grid grid-cols-3 gap-1">
                    {#each ipsAvailable as ip}
                      <button type="button" on:click={() => pickIp(ip)}
                              class="text-left text-xs font-mono px-2 py-1 rounded
                                     hover:bg-brand-50 hover:text-brand-800 transition-colors">
                        {ip}
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>

              {#if !ipsLoading && !ipsError && ipsTotals}
                <div class="px-3 py-1.5 border-t border-slate-100 bg-slate-50
                            text-[11px] text-slate-500 flex items-center justify-between">
                  <span>{ipsTotals.available} disponibles · {ipsTotals.used} en uso</span>
                  {#if ipsTruncated}
                    <span class="text-amber-600">Mostrando primeras {ipsAvailable.length}</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div>
          <label for="localAddress" class="label">
            Local Address PPPoE
            <span class="text-slate-400 text-xs font-normal">(IP gateway)</span>
          </label>
          <input id="localAddress" type="text" bind:value={form.mikrotik.localAddress}
                 placeholder="172.16.60.1" class="input font-mono"/>
        </div>

        <div>
          <label for="profileName" class="label">Perfil PPPoE *</label>

          {#if profilesLoading}
            <div class="input flex items-center gap-2 text-text-secondary cursor-wait">
              <Loader2 size={14} class="animate-spin" />
              Cargando perfiles del router...
            </div>
          {:else if profilesError}
            <div class="flex items-start gap-2 bg-red-50 border border-red-200
                        text-red-700 rounded-xl px-3 py-2.5 text-sm">
              <AlertCircle size={14} class="mt-0.5 flex-shrink-0" />
              <div class="flex-1 min-w-0">
                <div>No se pudieron cargar los perfiles.</div>
                <div class="text-xs text-red-600/80 truncate" title={profilesError}>{profilesError}</div>
                <button type="button"
                        on:click={() => selectedZone?.router?.id && loadProfiles(selectedZone.router.id)}
                        class="mt-1 text-xs text-brand-600 hover:underline font-medium">
                  Reintentar
                </button>
              </div>
            </div>
          {:else if profiles.length === 0}
            <div class="flex items-start gap-2 bg-amber-50 border border-amber-200
                        text-amber-800 rounded-xl px-3 py-2.5 text-sm">
              <AlertTriangle size={14} class="mt-0.5 flex-shrink-0 text-amber-500" />
              <span>No hay perfiles PPPoE disponibles en este router. Crea o sincroniza los perfiles desde MikroTik antes de continuar.</span>
            </div>
          {:else}
            <select id="profileName" bind:value={form.mikrotik.profileName} required
                    class="select font-mono">
              <option value="" disabled>Seleccionar perfil PPPoE...</option>
              {#each profiles as p (p.name || p['.id'])}
                {@const rate = p['rate-limit'] || p.rateLimit}
                <option value={p.name}>
                  {p.name}{rate ? ` — ${rate}` : ''}
                </option>
              {/each}
            </select>
            <p class="text-xs text-text-secondary mt-1.5">
              {profiles.length} {profiles.length === 1 ? 'perfil disponible' : 'perfiles disponibles'} en el router.
            </p>
          {/if}
        </div>

        <div>
          <label for="coordinates" class="label">Coordenadas GPS</label>
          <input id="coordinates" type="text" bind:value={form.mikrotik.coordinates}
                 placeholder="3.850149,-76.492356" class="input font-mono"/>
        </div>

        <div>
          <label for="status" class="label">Estado</label>
          <select id="status" bind:value={form.mikrotik.status} class="select">
            <option value="ACTIVE">Activo</option>
            <option value="SUSPENDED">Suspendido</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Mobile-only submit (sticky summary is hidden on small screens) -->
    <div class="lg:hidden flex items-center gap-2 flex-wrap">
      <button type="submit" disabled={saving || !selectedZoneId} class="btn-primary flex-1">
        {#if saving}
          <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          Guardando...
        {:else}
          <Save size={16} /> Guardar Cliente
        {/if}
      </button>
      <a href="/clients" class="btn-secondary">
        <X size={16} /> Cancelar
      </a>
    </div>
  </div><!-- end left column -->

  <!-- ── Sticky summary (desktop only) ──────────────────────────────── -->
  <aside class="hidden lg:block lg:sticky lg:top-20 space-y-3 max-w-[320px]">
    <div class="card">
      <div class="card-header">
        <h3 class="font-semibold text-slate-900 text-sm">Resumen</h3>
      </div>
      <div class="card-body space-y-3 text-sm">
        <!-- Zone status -->
        <div class="flex items-start gap-2.5">
          <div class="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                      {selectedZone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}">
            {#if selectedZone}<CheckCircle2 size={14} />{:else}<MapPin size={12} />{/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs text-text-muted uppercase tracking-wider font-semibold">Zona</div>
            {#if selectedZone}
              <div class="font-medium text-text-primary truncate">{selectedZone.name}</div>
              {#if selectedZone.router}
                <div class="text-[11px] text-text-muted truncate">📡 {selectedZone.router.name}</div>
              {/if}
            {:else}
              <div class="text-text-muted text-xs">— Sin elegir</div>
            {/if}
          </div>
        </div>

        <!-- Personal data status -->
        <div class="flex items-start gap-2.5">
          <div class="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                      {filledPersonal >= 3 ? 'bg-emerald-100 text-emerald-700' : filledPersonal > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}">
            {#if filledPersonal >= 3}<CheckCircle2 size={14} />{:else}<User size={12} />{/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs text-text-muted uppercase tracking-wider font-semibold">Datos</div>
            <div class="font-medium text-text-primary truncate">{form.fullName || '— Sin nombre'}</div>
            <div class="text-[11px] text-text-muted">{filledPersonal}/4 campos clave</div>
          </div>
        </div>

        <!-- Service status -->
        <div class="flex items-start gap-2.5">
          <div class="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                      {hasService ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}">
            {#if hasService}<CheckCircle2 size={14} />{:else}<RouterIcon size={12} />{/if}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs text-text-muted uppercase tracking-wider font-semibold">Servicio</div>
            {#if selectedPlanName}
              <div class="font-medium text-text-primary truncate">{selectedPlanName}</div>
              {#if form.mikrotik.username}
                <div class="text-[11px] text-text-muted truncate font-mono">{form.mikrotik.username}</div>
              {/if}
            {:else}
              <div class="text-text-muted text-xs">— Sin plan</div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <button type="submit" disabled={saving || !selectedZoneId} class="btn-primary w-full">
      {#if saving}
        <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
        Guardando…
      {:else}
        <Save size={14} /> Guardar Cliente
      {/if}
    </button>
    <a href="/clients" class="btn-secondary w-full">
      <X size={14} /> Cancelar
    </a>
  </aside>
</form>

<!-- ─── Progress dialog (creating client → MikroTik → DB) ─────────── -->
{#if progressOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4
              bg-slate-900/50 backdrop-blur-sm">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 sm:p-8">

      {#if progressStep === 'done'}
        <!-- Success state -->
        <div class="text-center">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-100
                      flex items-center justify-center">
            <CheckCircle2 size={28} class="text-emerald-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">
            Cliente creado correctamente
          </h3>
          <p class="text-sm text-text-secondary mt-1">
            IP autorizada en MikroTik. Redirigiendo…
          </p>
        </div>

      {:else if progressStep === 'error'}
        <!-- Error state -->
        <div class="text-center">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100
                      flex items-center justify-center">
            <AlertCircle size={28} class="text-red-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">
            No se pudo crear el cliente
          </h3>
          <p class="text-sm text-text-secondary mt-2 break-words">
            {progressError}
          </p>
          <button type="button" on:click={closeProgressDialog}
                  class="btn-primary w-full mt-5">
            Entendido
          </button>
        </div>

      {:else}
        <!-- In-progress steps -->
        <div class="text-center mb-5">
          <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-brand-50
                      flex items-center justify-center">
            <Wifi size={28} class="text-brand-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">
            Creando cliente PPPoE
          </h3>
          <p class="text-xs text-text-secondary mt-1">
            Esto puede tardar unos segundos…
          </p>
        </div>

        <ol class="space-y-3">
          <!-- Step 1: verifying credentials -->
          <li class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                         {progressStep === 'verifying'
                           ? 'bg-brand-100 text-brand-700'
                           : 'bg-emerald-100 text-emerald-600'}">
              {#if progressStep === 'verifying'}
                <Loader2 size={16} class="animate-spin" />
              {:else}
                <CheckCircle2 size={16} />
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-text-primary">Verificando credenciales</div>
              <div class="text-xs text-text-secondary">Comprobando que el usuario no exista en el router</div>
            </div>
          </li>

          <!-- Step 2: creating in MikroTik -->
          <li class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                         {progressStep === 'verifying'
                           ? 'bg-slate-100 text-slate-400'
                           : progressStep === 'creating'
                             ? 'bg-brand-100 text-brand-700'
                             : 'bg-emerald-100 text-emerald-600'}">
              {#if progressStep === 'creating'}
                <Loader2 size={16} class="animate-spin" />
              {:else if progressStep === 'verifying'}
                <Wifi size={16} />
              {:else}
                <CheckCircle2 size={16} />
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-text-primary">Creando usuario PPPoE</div>
              <div class="text-xs text-text-secondary">Insertando el secret en MikroTik</div>
            </div>
          </li>

          <!-- Step 3: authorizing IP in firewall -->
          <li class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                         {progressStep === 'verifying' || progressStep === 'creating'
                           ? 'bg-slate-100 text-slate-400'
                           : progressStep === 'authorizing'
                             ? 'bg-brand-100 text-brand-700'
                             : 'bg-emerald-100 text-emerald-600'}">
              {#if progressStep === 'authorizing'}
                <Loader2 size={16} class="animate-spin" />
              {:else if progressStep === 'syncing' || progressStep === 'done'}
                <CheckCircle2 size={16} />
              {:else}
                <Shield size={16} />
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-text-primary">Autorizando IP en firewall</div>
              <div class="text-xs text-text-secondary">Agregando la IP a <span class="font-mono">ips_autorizadas_wisphub</span></div>
            </div>
          </li>

          <!-- Step 4: syncing DB -->
          <li class="flex items-center gap-3">
            <span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                         {progressStep === 'syncing'
                           ? 'bg-brand-100 text-brand-700'
                           : 'bg-slate-100 text-slate-400'}">
              {#if progressStep === 'syncing'}
                <Loader2 size={16} class="animate-spin" />
              {:else}
                <Database size={16} />
              {/if}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-text-primary">Sincronizando cliente</div>
              <div class="text-xs text-text-secondary">Guardando el cliente en la base de datos</div>
            </div>
          </li>
        </ol>
      {/if}
    </div>
  </div>
{/if}

<!-- ── Inline zone creation ─────────────────────────────────────────── -->
<ZoneCreateSheet
  bind:open={zoneSheetOpen}
  routers={routers}
  on:close={() => zoneSheetOpen = false}
  on:created={onZoneCreated} />
