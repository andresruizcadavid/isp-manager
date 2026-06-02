<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { clientsApi } from '$lib/api/clients.api.js';
  import { zonesApi } from '$lib/api/zones.api.js';
  import { plansApi } from '$lib/api/plans.api.js';
  import { routersApi } from '$lib/api/routers.api.js';
  import { paymentsApi } from '$lib/api/payments.api.js';
  import {
    Search, Plus, Eye, EyeOff, Pencil, Trash2, Users, X,
    Power, PowerOff, ArrowUpDown, ArrowUp, ArrowDown,
    CheckCircle2, PauseCircle, Wallet, AlertCircle,
    User, Router as RouterIcon, Wifi, Save,
    CreditCard, FileText, Loader2, SlidersHorizontal, MoreVertical,
    Download, Database
  } from 'lucide-svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import ResponsiveTable from '$lib/components/ui/ResponsiveTable.svelte';
  import { user } from '$lib/stores/auth.store.js';
  import { isAdmin } from '$lib/permissions.js';

  // ── Data ────────────────────────────────────────────
  let clients = [];
  let total   = 0;
  let zones   = [];
  let plans   = [];
  let routers = [];
  let loading = true;
  let error   = '';

  // ── Filters / sort / pagination ────────────────────
  let q       = '';
  let status  = '';
  let planId  = '';
  let zoneId  = '';
  let sortBy  = 'createdAt';
  let sortDir = 'desc';
  let page    = 1;
  const pageSize = 20;
  let searchTimer;

  // ── Action menu state ───────────────────────────────
  let openMenuId = null;

  // ── Row density toggle ─────────────────────────────
  let density = 'compact'; // 'compact' | 'cozy'

  // ── Mobile filters drawer ──────────────────────────
  let filtersOpen = false;
  $: activeFilterCount = (status ? 1 : 0) + (planId ? 1 : 0) + (zoneId ? 1 : 0);

  // Per-row mobile menu (kebab) — only one open at a time
  let mobileMenuId = null;

  // ── Modal state (create / edit only — view goes to /clients/[id]) ──
  let modalMode = null;
  let modalLoading = false;
  let modalError = '';
  let newClient = emptyClient();
  let editingId = null;
  $: modalTitle = modalMode === 'create' ? 'Nuevo Cliente'
                : modalMode === 'edit'   ? 'Editar Cliente'
                : '';
  $: isReadOnly = false;

  // ── Payment modal state ─────────────────────────────
  let payOpen = false;
  let payClient = null;
  let payInvoice = null;
  let payAmount = '';
  let payMethod = 'CASH';
  let payNotes = '';
  let paySaving = false;
  let payError = '';

  function emptyClient() {
    return {
      fullName: '', documentType: 'CC', documentNumber: '',
      email: '', phone: '', address: '', neighborhood: '',
      zoneId: '', contractDate: '', notes: '',
      routerId: '', planId: '',
      mikrotik: {
        username: '',
        password: '',
        remoteAddress: '',
        localAddress: '',
        profileName: '',
        coordinates: '',
        status: 'ACTIVE'
      }
    };
  }

  // Sequential PPPoE prefix proposed by the backend (e.g. "0027").
  // Loaded when the create modal opens, so successive clients keep counting.
  let nextPppoePrefix = '';

  function slugifyName(s) {
    const diacriticsRe = new RegExp('[̀-ͯ]', 'g');
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(diacriticsRe, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  function generateUsername() {
    // Build username from the proposed sequential prefix plus the slugified name.
    // Falls back to last 4 digits of document number if the prefix wasn't loaded yet.
    if (!newClient.fullName) return;
    const name = slugifyName(newClient.fullName);
    if (!name) return;
    let num = nextPppoePrefix;
    if (!num && newClient.documentNumber) {
      num = newClient.documentNumber.slice(-4).padStart(4, '0');
    }
    if (!num) return;
    newClient.mikrotik.username = `${num}${name}`;
  }

  // ── Available IPs popover (for "Remote Address PPPoE" field) ─────────
  let ipsPopoverOpen = false;
  let ipsLoading = false;
  let ipsError = '';
  let ipsAvailable = [];
  let ipsTotals = null;
  let ipsTruncated = false;
  let ipsRouterId = null;       // routerId we last fetched for; refetch when changed
  let ipsRouterName = '';

  async function openIpsPopover() {
    ipsError = '';
    if (!newClient.routerId) {
      ipsError = 'Selecciona primero el router asignado.';
      ipsPopoverOpen = true;
      return;
    }
    const rid = Number(newClient.routerId);
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
      ipsRouterName = data?.router?.name || '';
    } catch (e) {
      ipsError = e.message || 'No se pudo obtener la lista de IPs disponibles.';
    } finally { ipsLoading = false; }
  }

  function pickIp(ip) {
    newClient.mikrotik.remoteAddress = ip;
    ipsPopoverOpen = false;
  }

  function refreshIps() {
    ipsRouterId = null; // invalidate cache
    openIpsPopover();
  }

  // Close popover when the chosen router changes (avoid stale list)
  $: if (newClient?.routerId !== undefined) {
    if (ipsRouterId !== null && Number(newClient.routerId) !== ipsRouterId) {
      ipsPopoverOpen = false;
      ipsAvailable = [];
      ipsRouterId = null;
    }
  }

  // ── PPPoE profiles (loaded from MikroTik) ────────────────────────
  // Drives the "Perfil PPPoE" select in the edit modal. Reactive to the
  // currently-selected router on the form — when the operator changes
  // routers we drop the stale list and refetch.
  let profiles = [];
  let profilesLoading = false;
  let profilesError = '';
  let profilesRouterId = null;

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

  // (Re)load profiles when the edit modal is open and a router is picked.
  $: if (modalMode && newClient?.routerId) {
    const rid = Number(newClient.routerId);
    if (rid && rid !== profilesRouterId && !profilesLoading) {
      loadProfiles(rid);
    }
  }
  // When the modal closes, clear so next open refetches cleanly.
  $: if (!modalMode) {
    profilesRouterId = null;
    profiles = [];
    profilesError = '';
  }

  function generatePassword() {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    newClient.mikrotik.password = Array.from({length: 8},
      () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  // ── Load ────────────────────────────────────────────
  async function load() {
    loading = true; error = '';
    try {
      const params = { page, limit: pageSize, sortBy, sortOrder: sortDir };
      if (q.trim())  params.search = q.trim();
      if (status)    params.status = status;
      if (planId)    params.planId = planId;
      if (zoneId)    params.zoneId = zoneId;
      const res = await clientsApi.getPage(params);
      clients = res?.data ?? [];
      total   = res?.meta?.total ?? clients.length;
    } catch (e) {
      error = e.message || 'Error al cargar clientes';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    // Pre-fill zone filter from ?zone=<id> (used by /zones page links)
    if (typeof window !== 'undefined') {
      const urlZone = new URL(window.location.href).searchParams.get('zone');
      if (urlZone) zoneId = urlZone;
    }
    try {
      const [z, pl, r] = await Promise.all([
        zonesApi.getAll().catch(() => []),
        plansApi.getAll().catch(() => []),
        routersApi.getAll().catch(() => []),
      ]);
      zones = z || [];
      plans = pl || [];
      routers = r || [];
    } catch {/* swallow — still load clients */}
    await load();
  });

  // Debounced search
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 300);
  }
  function onFilterChange() { page = 1; load(); }

  // ── Sorting ─────────────────────────────────────────
  function toggleSort(col) {
    if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortBy = col; sortDir = 'asc'; }
    load();
  }
  function sortIcon(col) {
    if (sortBy !== col) return ArrowUpDown;
    return sortDir === 'asc' ? ArrowUp : ArrowDown;
  }

  // ── Pagination ──────────────────────────────────────
  $: totalPages = Math.max(1, Math.ceil(total / pageSize));
  function setPage(p) {
    if (p < 1 || p > totalPages || p === page) return;
    page = p;
    load();
  }

  // ── KPIs (derived) ──────────────────────────────────
  // Note: these come from the *current page* of clients. For perfect global
  // numbers we'd query the dashboard endpoint — but for a list overview,
  // page-derived feels honest.
  $: kpiTotal      = total;
  $: kpiActive     = clients.filter(c => c.status === 'ACTIVE').length;
  $: kpiSuspended  = clients.filter(c => c.status === 'SUSPENDED').length;
  $: kpiBalance    = clients.reduce((s, c) => s + (c.balance || 0), 0);

  // ── UI helpers ──────────────────────────────────────
  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).slice(0, 2).map(s => s[0] || '').join('').toUpperCase() || '?';
  }
  function fmtMoney(cents) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format((cents || 0) / 100);
  }

  function statusLabel(s) {
    return ({ ACTIVE:'Activo', SUSPENDED:'Suspendido', INACTIVE:'Inactivo', PENDING:'Pendiente' })[s] || s;
  }
  function statusBadgeClass(s) {
    return ({ ACTIVE:'badge-green', SUSPENDED:'badge-red', PENDING:'badge-yellow', INACTIVE:'badge-gray' })[s] || 'badge-gray';
  }

  // ── Action handlers ─────────────────────────────────
  function closeMenuOnClick(e) {
    if (!e.target.closest('[data-action-menu]')) openMenuId = null;
  }
  onMount(() => { document.addEventListener('click', closeMenuOnClick); });
  onDestroy(() => { document.removeEventListener('click', closeMenuOnClick); });

  async function suspendClient(c) {
    openMenuId = null;
    try {
      await clientsApi.suspend(c.id);
      await load();
    } catch (e) { error = e.message; }
  }
  async function activateClient(c) {
    openMenuId = null;
    try {
      await clientsApi.activate(c.id);
      await load();
    } catch (e) { error = e.message; }
  }
  async function deleteClient(c) {
    openMenuId = null;
    if (!confirm(`¿Eliminar al cliente "${c.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await clientsApi.remove(c.id);
      await load();
    } catch (e) { error = e.message; }
  }

  // ── Modal ───────────────────────────────────────────
  async function openCreateModal() {
    newClient = emptyClient();
    editingId = null;
    modalError = '';
    nextPppoePrefix = '';
    modalMode = 'create';
    // Fetch the next sequential PPPoE prefix in the background; we don't
    // block the modal on it, but keep it ready for generateUsername().
    try {
      const res = await clientsApi.nextPppoeNumber();
      nextPppoePrefix = res?.next || '';
    } catch (_) {
      // Non-fatal: generateUsername will fall back to the document number.
    }
  }

  async function openClientModal(client, mode) {
    modalError = '';
    modalLoading = true;
    modalMode = mode;
    editingId = client.id;
    newClient = emptyClient();
    try {
      const data = await clientsApi.getOne(client.id);
      const c = data?.client || data;  // tolerate either shape
      // Strip leading +57 from phone if present
      const rawPhone = c.phone || '';
      const localPhone = rawPhone.startsWith('+57') ? rawPhone.slice(3) : rawPhone;
      // Format contractDate as yyyy-mm-dd for date input
      const contractDate = c.contractDate
        ? new Date(c.contractDate).toISOString().slice(0, 10)
        : '';
      newClient = {
        fullName:       c.name || c.fullName || '',
        documentType:   c.documentType || 'CC',
        documentNumber: c.documentNumber || '',
        email:          c.email || '',
        phone:          localPhone,
        address:        c.address || '',
        neighborhood:   c.neighborhood || '',
        zoneId:         c.zoneId ?? '',
        contractDate,
        notes:          c.notes || '',
        routerId:       c.mikrotikAccount?.routerId ?? '',
        planId:         c.planId ?? '',
        mikrotik: {
          // Prefer MikrotikAccount as the source of truth; only fall back to
          // the legacy duplicated columns on Client so old/imported rows
          // still load. Never seed profileName from c.plan?.name — that's
          // the commercial plan name, not the technical PPPoE profile, and
          // putting it there caused the form to overwrite the real profile.
          username:      c.mikrotikAccount?.username      || c.pppoeUsername  || '',
          password:      c.mikrotikAccount?.password      || c.pppoePassword  || '',
          remoteAddress: c.mikrotikAccount?.remoteAddress || c.serviceIp      || '',
          localAddress:  c.mikrotikAccount?.localAddress  || c.serviceLocalIp || '',
          profileName:   c.mikrotikAccount?.profileName   || '',
          coordinates:   c.mikrotikAccount?.coordinates   || c.coordinates    || '',
          status:        c.mikrotikAccount?.status        || c.status         || 'ACTIVE',
        }
      };
    } catch (e) {
      modalError = e.message || 'Error al cargar cliente';
    } finally {
      modalLoading = false;
    }
  }

  function closeModal() {
    modalMode = null; modalError = ''; editingId = null;
  }

  function buildPayload() {
    return {
      fullName:       newClient.fullName,
      documentType:   newClient.documentType,
      documentNumber: newClient.documentNumber,
      email:          newClient.email,
      phone:          newClient.phone ? `+57${newClient.phone}` : '',
      address:        newClient.address,
      neighborhood:   newClient.neighborhood,
      zoneId:         newClient.zoneId ? Number(newClient.zoneId) : null,
      contractDate:   newClient.contractDate || null,
      notes:          newClient.notes,
      planId:         newClient.planId || null,    // Plan.id is cuid (string) — do NOT cast to Number
      mikrotik: {
        routerId:      newClient.routerId ? Number(newClient.routerId) : null,
        username:      newClient.mikrotik.username,
        password:      newClient.mikrotik.password,
        remoteAddress: newClient.mikrotik.remoteAddress,
        localAddress:  newClient.mikrotik.localAddress,
        profileName:   newClient.mikrotik.profileName,
        coordinates:   newClient.mikrotik.coordinates,
        status:        newClient.mikrotik.status,
      }
    };
  }

  async function handleCreateClient() {
    modalLoading = true; modalError = '';
    try {
      await clientsApi.create(buildPayload());
      closeModal();
      await load();
    } catch (e) {
      modalError = e.message || 'Error al crear cliente';
    } finally { modalLoading = false; }
  }

  async function handleUpdateClient() {
    if (!editingId) return;
    modalLoading = true; modalError = '';
    try {
      await clientsApi.update(editingId, buildPayload());
      closeModal();
      await load();
    } catch (e) {
      modalError = e.message || 'Error al guardar cambios';
    } finally { modalLoading = false; }
  }

  // ── Payment modal ───────────────────────────────────
  function openPaymentModal(client) {
    payClient = client;
    // Pick the oldest pending invoice (OVERDUE first, then by dueDate asc)
    const pending = client.pendingInvoices || [];
    const sorted = [...pending].sort((a, b) => {
      const aOver = a.status === 'OVERDUE' ? 0 : 1;
      const bOver = b.status === 'OVERDUE' ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
    payInvoice = sorted[0] || null;
    if (payInvoice) {
      const remaining = payInvoice.balanceDue > 0 ? payInvoice.balanceDue : (payInvoice.amount ?? payInvoice.total ?? 0);
      payAmount = String(Math.round(remaining / 100));
    } else {
      payAmount = '';
    }
    payMethod = 'CASH';
    payNotes = '';
    payError = '';
    payOpen = true;
  }

  function closePaymentModal() {
    payOpen = false; payClient = null; payInvoice = null;
    payAmount = ''; payNotes = ''; payError = '';
  }

  // Detect clients that came in via the MikroTik import flow. The import
  // writes a distinctive prefix into `notes` — cheap and schema-free.
  const IMPORT_PREFIX = 'Importado desde MikroTik';
  function isImported(c) {
    return typeof c?.notes === 'string' && c.notes.startsWith(IMPORT_PREFIX);
  }

  // ── Import PPPoE clients from MikroTik ────────────────────────────
  let importOpen = false;
  let importRouterId = '';
  let importStep = 'pick';   // pick | connecting | reading | comparing | importing | done | error
  let importError = '';
  let importSummary = null;  // { total, imported, skipped, errors, details }
  let importTimers = [];

  function openImport() {
    importOpen = true;
    importStep = 'pick';
    importError = '';
    importSummary = null;
    importRouterId = routers[0] ? String(routers[0].id) : '';
  }
  function closeImport() {
    if (['connecting', 'reading', 'comparing', 'importing'].includes(importStep)) return;
    importTimers.forEach(clearTimeout);
    importTimers = [];
    importOpen = false;
  }
  async function runImport() {
    if (!importRouterId) return;
    importError = '';
    importSummary = null;
    importStep = 'connecting';
    // Decorative staged animation while the backend does the work in one shot.
    importTimers.forEach(clearTimeout);
    importTimers = [
      setTimeout(() => { importStep = 'reading';   },  600),
      setTimeout(() => { importStep = 'comparing'; }, 1500),
      setTimeout(() => { importStep = 'importing'; }, 2400),
    ];
    try {
      const data = await routersApi.importPppoeClients(Number(importRouterId));
      importTimers.forEach(clearTimeout); importTimers = [];
      importSummary = data;
      importStep = 'done';
      // Refresh the clients list so the new rows appear.
      await load();
    } catch (e) {
      importTimers.forEach(clearTimeout); importTimers = [];
      importError = e.message || 'No se pudo importar.';
      importStep = 'error';
    }
  }

  async function submitPayment() {
    if (!payInvoice) { payError = 'No hay factura pendiente'; return; }
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { payError = 'Monto inválido'; return; }
    paySaving = true; payError = '';
    try {
      await paymentsApi.create({
        invoiceId: payInvoice.id,
        amount: amt,
        paymentMethod: payMethod,
        notes: payNotes || undefined
      });
      closePaymentModal();
      await load();
    } catch (e) {
      payError = e.message || 'Error al registrar pago';
    } finally { paySaving = false; }
  }
</script>

<svelte:head><title>Clientes — ISP Manager</title></svelte:head>

<div class="h-full flex flex-col gap-3">

  <!-- 1. Compact header -->
  <div class="flex items-center justify-between gap-3 flex-shrink-0 min-h-[48px]">
    <div class="flex items-baseline gap-2 sm:gap-3 min-w-0">
      <h1 class="text-xl sm:text-lg font-bold sm:font-semibold text-slate-900 tracking-tight">Clientes</h1>
      <span class="text-xs sm:text-[11px] text-slate-500 truncate hidden xs:inline">
        {total} {total === 1 ? 'cliente' : 'clientes'}
      </span>
    </div>
    <div class="flex items-center gap-1.5 sm:gap-2">
      <button type="button" on:click={openImport}
              class="inline-flex items-center gap-1.5 px-2.5 sm:px-3 min-h-[44px] sm:py-1.5
                     bg-white border border-slate-200 hover:border-brand-600 hover:text-brand-700
                     text-slate-700 text-xs font-medium rounded-lg shadow-sm transition-colors">
        <Download size={14} /> <span class="hidden xs:inline">Importar</span>
      </button>
      <a href={zoneId ? `/clients/new?zone_id=${zoneId}` : '/clients/new'}
         class="inline-flex items-center gap-1.5 px-3 min-h-[44px] sm:py-1.5 bg-brand-600 hover:bg-brand-700
                active:bg-brand-800 text-white text-xs font-semibold rounded-lg
                shadow-sm transition-colors">
        <Plus size={16} class="sm:w-3.5 sm:h-3.5" /> <span class="hidden xs:inline">Nuevo Cliente</span>
      </a>
    </div>
  </div>

  <!-- 2. KPI pills inline (horizontal scroll on mobile) -->
  <div class="flex items-center gap-1.5 md:flex-wrap flex-shrink-0
              overflow-x-auto md:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 md:pb-0
              scrollbar-thin">
    <span class="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-full bg-white border border-slate-200 text-xs flex-shrink-0 min-w-[90px] justify-center md:min-w-0 md:justify-start">
      <Users size={12} class="text-slate-400 hidden xs:inline" />
      <strong class="text-slate-900 tabular-nums">{kpiTotal}</strong>
      <span class="text-slate-500 hidden xs:inline">Total</span>
    </span>
    <span class="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-full bg-emerald-50 border border-emerald-100 text-xs flex-shrink-0 min-w-[90px] justify-center md:min-w-0 md:justify-start">
      <strong class="text-emerald-700 tabular-nums">{kpiActive}</strong>
      <span class="text-emerald-700/80 hidden xs:inline">Activos</span>
    </span>
    <span class="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-full bg-amber-50 border border-amber-100 text-xs flex-shrink-0 min-w-[90px] justify-center md:min-w-0 md:justify-start">
      <strong class="text-amber-700 tabular-nums">{kpiSuspended}</strong>
      <span class="text-amber-700/80 hidden xs:inline">Suspendidos</span>
    </span>
    <span class="inline-flex items-center gap-1 py-0.5 px-2.5 rounded-full bg-rose-50 border border-rose-100 text-xs flex-shrink-0 min-w-[110px] justify-center md:min-w-0 md:justify-start">
      <strong class="text-rose-700 tabular-nums">{fmtMoney(kpiBalance)}</strong>
      <span class="text-rose-700/80 hidden xs:inline">Saldo</span>
    </span>
  </div>

  {#if error}
    <div class="card p-3 flex items-start gap-2 border-red-200 bg-red-50 flex-shrink-0">
      <AlertCircle size={14} class="text-red-500 mt-0.5" />
      <div class="text-xs text-red-700">{error}</div>
    </div>
  {/if}

  <!-- 3+4. Table card: toolbar h-10 + sticky thead + flex-1 scroll -->
  <div class="card flex-1 min-h-0 flex flex-col overflow-hidden">

    <!-- Filter toolbar: desktop (md+) inline, mobile compact + sheet -->
    <div class="md:h-10 px-2.5 py-2 md:py-0 flex items-center gap-2 border-b border-slate-100 bg-slate-50/40 flex-shrink-0">
      <!-- Search always visible -->
      <div class="relative flex-1 md:max-w-xs">
        <Search size={12} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          class="w-full min-h-[44px] md:h-7 pl-7 pr-2 text-sm md:text-xs bg-white text-slate-900 placeholder-slate-400
                 border border-slate-200 rounded-md
                 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          placeholder="Buscar cliente..."
          bind:value={q}
          on:input={onSearchInput} />
      </div>

      <!-- Mobile: Filters button -->
      <button type="button" on:click={() => filtersOpen = true}
              class="md:hidden inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md
                     border border-slate-200 bg-white hover:bg-slate-50 active:scale-95
                     text-sm text-slate-700 transition relative">
        <SlidersHorizontal size={14} />
        Filtros
        {#if activeFilterCount > 0}
          <span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full
                       bg-brand-800 text-white text-[10px] font-semibold
                       flex items-center justify-center">
            {activeFilterCount}
          </span>
        {/if}
      </button>

      <!-- Desktop: inline filters -->
      <select class="hidden md:block h-7 text-xs py-0 px-2 pr-7 bg-white border border-slate-200 rounded-md
                     text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                     focus:border-blue-500 appearance-none cursor-pointer"
              style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E&quot;); background-repeat: no-repeat; background-position: right 0.5rem center;"
              bind:value={status} on:change={onFilterChange}>
        <option value="">Todos los estados</option>
        <option value="ACTIVE">Activo</option>
        <option value="SUSPENDED">Suspendido</option>
        <option value="PENDING">Pendiente</option>
        <option value="INACTIVE">Inactivo</option>
      </select>
      <select class="hidden md:block h-7 text-xs py-0 px-2 pr-7 bg-white border border-slate-200 rounded-md
                     text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                     focus:border-blue-500 appearance-none cursor-pointer"
              style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E&quot;); background-repeat: no-repeat; background-position: right 0.5rem center;"
              bind:value={planId} on:change={onFilterChange}>
        <option value="">Todos los planes</option>
        {#each plans as p}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
      <select class="hidden md:block h-7 text-xs py-0 px-2 pr-7 bg-white border border-slate-200 rounded-md
                     text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                     focus:border-blue-500 appearance-none cursor-pointer"
              style="background-image: url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E&quot;); background-repeat: no-repeat; background-position: right 0.5rem center;"
              bind:value={zoneId} on:change={onFilterChange}>
        <option value="">Todas las zonas</option>
        {#each zones as z}
          <option value={z.id}>{z.name}{z.routerId ? '' : ' ⚠️'}</option>
        {/each}
      </select>
      {#if q || status || planId || zoneId}
        <button class="hidden md:inline-flex text-xs text-slate-500 hover:text-slate-700 px-1.5"
                on:click={() => { q=''; status=''; planId=''; zoneId=''; page=1; load(); }}>
          Limpiar
        </button>
      {/if}
      <div class="hidden md:block flex-1"></div>
      <button class="hidden md:inline-flex items-center gap-1 px-2 h-7 rounded-md border border-slate-200
                     bg-white hover:bg-slate-50 text-xs text-slate-600"
              on:click={() => density = density === 'compact' ? 'cozy' : 'compact'}
              title="Cambiar densidad de filas">
        <ArrowUpDown size={11} /> {density === 'compact' ? 'Cómodo' : 'Compacto'}
      </button>
    </div>

    <!-- Loading / empty state -->
    {#if loading}
      <div class="flex-1 flex items-center justify-center gap-2 py-16">
        <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-slate-500 text-sm">Cargando clientes...</span>
      </div>
    {:else if clients.length === 0}
      <div class="flex-1 flex flex-col items-center justify-center gap-4 py-20 px-4 text-center">
        <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
          <Users size={28} class="text-slate-400" />
        </div>
        <div>
          <p class="text-sm font-semibold text-slate-700">
            {q || status || planId || zoneId ? 'Ningún cliente coincide con los filtros' : 'Aún no hay clientes'}
          </p>
          <p class="text-xs text-slate-400 mt-1">
            {q || status || planId || zoneId ? 'Prueba ajustando los criterios de búsqueda' : 'Agrega el primer abonado del ISP'}
          </p>
        </div>
        {#if !q && !status && !planId && !zoneId}
          <a href="/clients/new" class="btn-primary inline-flex">
            <Plus size={14} /> Nuevo Cliente
          </a>
        {/if}
      </div>
    {:else}
    <ResponsiveTable items={clients}
                     tableClass={'data-table' + (density === 'cozy' ? ' density-cozy' : '')}>
      <thead slot="thead">
        <tr>
          <th class="sortable sticky-top" on:click={() => toggleSort('name')}>
            <span class="inline-flex items-center gap-1">
              Cliente <svelte:component this={sortIcon('name')} size={11} />
            </span>
          </th>
          <th class="sticky-top">Servicio PPPoE</th>
          <th class="sticky-top">IP Asignada</th>
          <th class="sticky-top">Plan</th>
          <th class="sticky-top">Zona</th>
          <th class="sortable sticky-top" on:click={() => toggleSort('status')}>
            <span class="inline-flex items-center gap-1">
              Estado <svelte:component this={sortIcon('status')} size={11} />
            </span>
          </th>
          <th class="sortable sticky-top text-right" on:click={() => toggleSort('balance')}>
            <span class="inline-flex items-center gap-1 justify-end">
              Saldo <svelte:component this={sortIcon('balance')} size={11} />
            </span>
          </th>
          <th class="sticky-top">Estado Pago</th>
          <th class="sticky-top text-right col-sticky-right">Acciones</th>
        </tr>
      </thead>
      <tbody slot="tbody">
        {#each clients as client}
            <tr>
              <td>
                <a href="/clients/{client.id}" class="flex items-center gap-3 group cursor-pointer">
                  <div class="avatar">{initials(client.name || client.fullName)}</div>
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span class="font-medium text-slate-900 group-hover:text-brand-800 group-hover:underline transition-colors truncate">
                        {client.name || client.fullName || '—'}
                      </span>
                      {#if isImported(client)}
                        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                                     bg-brand-50 text-brand-700 ring-1 ring-brand-100
                                     text-[10px] font-semibold flex-shrink-0"
                              title="Importado desde MikroTik">
                          <Download size={9} /> Importado
                        </span>
                      {/if}
                    </div>
                  </div>
                </a>
              </td>
              <td class="font-mono text-xs text-slate-600">
                {client.pppoeUsername || client.mikrotikAccount?.username || '—'}
              </td>
              <td class="font-mono text-xs text-slate-700">
                {client.serviceIp || client.mikrotikAccount?.remoteAddress || '—'}
              </td>
              <td class="text-slate-600 whitespace-nowrap">{client.plan?.name || '—'}</td>
              <td class="text-slate-600 text-xs whitespace-nowrap max-w-[140px] truncate"
                  title={client.zone?.name || ''}>
                {client.zone?.name || '—'}
              </td>
              <td><span class="{statusBadgeClass(client.status)}">{statusLabel(client.status)}</span></td>
              <td class="text-right font-mono text-xs whitespace-nowrap">{fmtMoney(client.balance)}</td>
              <td>
                {#if client.paymentStatus === 'OVERDUE'}
                  <span class="badge bg-red-50 text-red-700 ring-red-100" title="Factura vencida">
                    Vencida
                  </span>
                {:else if client.paymentStatus === 'PENDING'}
                  <span class="badge bg-amber-50 text-amber-700 ring-amber-100 tabular-nums" title="Saldo pendiente">
                    {fmtMoney(client.pendingAmount || 0)}
                  </span>
                {:else}
                  <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100">
                    ✓ Al día
                  </span>
                {/if}
              </td>
              <td class="col-sticky-right">
                <div class="flex items-center justify-end gap-1">
                  {#if client.paymentStatus !== 'OK'}
                    <button class="inline-flex items-center gap-1 px-2 py-1 rounded-md
                                   bg-brand-600 hover:bg-brand-700 active:bg-brand-800
                                   text-white text-xs font-semibold
                                   transition-colors"
                            title="Registrar pago"
                            on:click={() => openPaymentModal(client)}>
                      <CreditCard size={12} /> Pagar
                    </button>
                  {:else}
                    <a href="/clients/{client.id}" class="btn-icon" title="Ver detalle">
                      <Eye size={14} />
                    </a>
                  {/if}
                  <button class="btn-icon" title="Editar"
                          on:click={() => openClientModal(client, 'edit')}>
                    <Pencil size={14} />
                  </button>
                  {#if isAdmin($user?.role)}
                    {#if client.status === 'ACTIVE'}
                      <button class="btn-icon" title="Suspender" on:click={() => suspendClient(client)}>
                        <PowerOff size={14} />
                      </button>
                    {:else}
                      <button class="btn-icon" title="Activar" on:click={() => activateClient(client)}>
                        <Power size={14} />
                      </button>
                    {/if}
                    <button class="btn-icon hover:!text-red-600 hover:!bg-red-50"
                            title="Eliminar"
                            on:click={() => deleteClient(client)}>
                      <Trash2 size={14} />
                    </button>
                  {/if}
                </div>
              </td>
            </tr>
        {/each}
      </tbody>

      <!-- Mobile card per row -->
      <svelte:fragment slot="mobile" let:row={client}>
        <div class="flex items-start gap-2.5">
          <a href="/clients/{client.id}" class="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-brand-800 to-brand-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {initials(client.name || client.fullName)}
          </a>
          <a href="/clients/{client.id}" class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="text-[15px] sm:text-sm font-semibold text-slate-900 truncate leading-snug">
                {client.name || client.fullName || '—'}
              </span>
              {#if isImported(client)}
                <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded
                             bg-brand-50 text-brand-700 ring-1 ring-brand-100
                             text-[10px] font-semibold flex-shrink-0">
                  <Download size={8} /> Importado
                </span>
              {/if}
            </div>
            <div class="text-sm sm:text-xs text-slate-500 truncate leading-normal mt-0.5">
              {client.plan?.name || 'Sin plan'}{#if client.zone} · {client.zone.name}{/if}
            </div>
            <div class="text-xs font-mono text-slate-400 truncate leading-normal mt-0.5">
              {client.pppoeUsername || client.mikrotikAccount?.username || '—'}
              {#if client.serviceIp || client.mikrotikAccount?.remoteAddress}
                · {client.serviceIp || client.mikrotikAccount?.remoteAddress}
              {/if}
            </div>
          </a>
          <div class="flex flex-col items-end gap-1.5 shrink-0">
            <span class="{statusBadgeClass(client.status)}">{statusLabel(client.status)}</span>
            {#if client.paymentStatus === 'OVERDUE' || client.paymentStatus === 'PENDING'}
              <button type="button" on:click={() => openPaymentModal(client)}
                      class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md
                             bg-brand-600 hover:bg-brand-700 active:bg-brand-800 active:scale-95
                             text-white text-[13px] font-semibold transition">
                <CreditCard size={13} /> Pagar
              </button>
            {:else}
              <span class="text-xs text-emerald-700 font-medium whitespace-nowrap">✓ Al día</span>
            {/if}
            <button type="button"
                    on:click|stopPropagation={() => mobileMenuId = mobileMenuId === client.id ? null : client.id}
                    class="p-1.5 rounded text-slate-500 hover:bg-slate-100 active:scale-95
                           min-h-[44px] min-w-[44px] flex items-center justify-center"
                    aria-label="Más acciones">
              <MoreVertical size={18} />
            </button>
          </div>
        </div>

        {#if mobileMenuId === client.id}
          <div class="mt-2.5 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-1.5">
            <a href="/clients/{client.id}"
               class="inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-md
                      bg-slate-100 hover:bg-slate-200 text-[15px] sm:text-sm text-slate-700 font-medium">
              <Eye size={15} /> Ver detalle
            </a>
            <button type="button"
                    on:click={() => { mobileMenuId = null; openClientModal(client, 'edit'); }}
                    class="inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-md
                           bg-slate-100 hover:bg-slate-200 text-[15px] sm:text-sm text-slate-700 font-medium">
              <Pencil size={15} /> Editar
            </button>
            {#if isAdmin($user?.role)}
              {#if client.status === 'ACTIVE'}
                <button type="button"
                        on:click={() => { mobileMenuId = null; suspendClient(client); }}
                        class="inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-md
                               bg-amber-50 hover:bg-amber-100 text-[15px] sm:text-sm text-amber-700 font-medium">
                  <PowerOff size={15} /> Suspender
                </button>
              {:else}
                <button type="button"
                        on:click={() => { mobileMenuId = null; activateClient(client); }}
                        class="inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-md
                               bg-brand-50 hover:bg-brand-100 text-[15px] sm:text-sm text-brand-700 font-medium">
                  <Power size={15} /> Activar
                </button>
              {/if}
              <button type="button"
                      on:click={() => { mobileMenuId = null; deleteClient(client); }}
                      class="inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-md
                             bg-red-50 hover:bg-red-100 text-[15px] sm:text-sm text-red-700 font-medium">
                <Trash2 size={15} /> Eliminar
              </button>
            {/if}
          </div>
        {/if}
      </svelte:fragment>
    </ResponsiveTable>
    {/if}

    <!-- Footer -->
    <div class="px-3 py-1.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/40 flex-shrink-0">
      <span class="text-xs text-slate-500">
        Mostrando {clients.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <div class="flex items-center gap-1">
        <button class="btn-ghost text-xs min-h-[44px] sm:min-h-0 sm:py-1" disabled={page <= 1} on:click={() => setPage(page - 1)}>← Anterior</button>
        <span class="px-3 min-h-[44px] sm:py-1 inline-flex items-center bg-brand-800 text-white text-xs rounded-md font-medium">{page} / {totalPages}</span>
        <button class="btn-ghost text-xs min-h-[44px] sm:min-h-0 sm:py-1" disabled={page >= totalPages} on:click={() => setPage(page + 1)}>Siguiente →</button>
      </div>
    </div>
  </div>
</div>

<!-- Mobile filter sheet -->
<Sheet bind:open={filtersOpen} title="Filtros" maxWidth="max-w-md">
  <div class="space-y-4">
    <div>
      <label class="label">Estado</label>
      <select bind:value={status} on:change={() => { onFilterChange(); }} class="select">
        <option value="">Todos los estados</option>
        <option value="ACTIVE">Activo</option>
        <option value="SUSPENDED">Suspendido</option>
        <option value="PENDING">Pendiente</option>
        <option value="INACTIVE">Inactivo</option>
      </select>
    </div>
    <div>
      <label class="label">Plan</label>
      <select bind:value={planId} on:change={() => { onFilterChange(); }} class="select">
        <option value="">Todos los planes</option>
        {#each plans as p}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="label">Zona</label>
      <select bind:value={zoneId} on:change={() => { onFilterChange(); }} class="select">
        <option value="">Todas las zonas</option>
        {#each zones as z}
          <option value={z.id}>{z.name}{z.routerId ? '' : ' ⚠️'}</option>
        {/each}
      </select>
    </div>
    <div>
      <label class="label">Densidad</label>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary flex-1"
                class:!bg-blue-50={density === 'compact'}
                class:!border-blue-200={density === 'compact'}
                on:click={() => density = 'compact'}>
          Compacto
        </button>
        <button type="button" class="btn-secondary flex-1"
                class:!bg-blue-50={density === 'cozy'}
                class:!border-blue-200={density === 'cozy'}
                on:click={() => density = 'cozy'}>
          Cómodo
        </button>
      </div>
    </div>
  </div>

  <svelte:fragment slot="footer">
    {#if activeFilterCount > 0 || q}
      <button type="button" class="btn-secondary"
              on:click={() => { q=''; status=''; planId=''; zoneId=''; page=1; load(); }}>
        Limpiar
      </button>
    {/if}
    <button type="button" class="btn-primary"
            on:click={() => filtersOpen = false}>
      Aplicar
    </button>
  </svelte:fragment>
</Sheet>

<!-- ─── Importar desde MikroTik ──────────────────────────────────── -->
{#if importOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4
              bg-slate-900/50 backdrop-blur-sm">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 sm:p-8">

      {#if importStep === 'pick'}
        <!-- Router selection -->
        <div class="text-center mb-5">
          <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-brand-50
                      flex items-center justify-center">
            <Download size={28} class="text-brand-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">Importar clientes desde MikroTik</h3>
          <p class="text-xs text-text-secondary mt-1">
            Lee los usuarios PPPoE del router e importa solo los que aún no existen.
          </p>
        </div>

        <div class="mb-5">
          <label for="imp-router" class="label">Router</label>
          <select id="imp-router" bind:value={importRouterId} class="select">
            <option value="">Seleccionar router...</option>
            {#each routers as r}
              <option value={String(r.id)}>{r.name} — {r.routes?.[0]?.ip ?? '—'}</option>
            {/each}
          </select>
        </div>

        <div class="flex items-center justify-end gap-2">
          <button type="button" on:click={closeImport} class="btn-secondary">Cancelar</button>
          <button type="button" on:click={runImport} disabled={!importRouterId} class="btn-primary">
            <Download size={15} /> Iniciar import
          </button>
        </div>

      {:else if importStep === 'done'}
        <!-- Summary -->
        <div class="text-center mb-5">
          <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 size={28} class="text-emerald-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">Importación completada</h3>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-5">
          <div class="text-center p-3 rounded-xl bg-emerald-50 border border-emerald-100">
            <div class="text-2xl font-bold text-emerald-700 tabular-nums">{importSummary?.imported ?? 0}</div>
            <div class="text-[10px] text-emerald-700/80 uppercase tracking-wide font-semibold">Importados</div>
          </div>
          <div class="text-center p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div class="text-2xl font-bold text-slate-700 tabular-nums">{importSummary?.skipped ?? 0}</div>
            <div class="text-[10px] text-slate-600 uppercase tracking-wide font-semibold">Ya existían</div>
          </div>
          <div class="text-center p-3 rounded-xl bg-red-50 border border-red-100">
            <div class="text-2xl font-bold text-red-700 tabular-nums">{importSummary?.errors ?? 0}</div>
            <div class="text-[10px] text-red-700/80 uppercase tracking-wide font-semibold">Errores</div>
          </div>
        </div>

        <p class="text-xs text-text-secondary text-center mb-5">
          Total leído del router: <span class="font-medium text-text-primary">{importSummary?.total ?? 0}</span>.
          {#if importSummary?.linkedToPlan > 0}
            <br><span class="text-emerald-700 font-medium">{importSummary.linkedToPlan}</span> {importSummary.linkedToPlan === 1 ? 'cliente quedó' : 'clientes quedaron'} auto-vinculados a un plan existente.
          {/if}
          {#if importSummary?.imported}
            <br>Revisa los nuevos clientes para completar nombre, documento{importSummary?.linkedToPlan < importSummary?.imported ? ' y plan' : ''}.
          {/if}
        </p>

        {#if importSummary?.details && importSummary.errors > 0}
          <div class="border border-slate-200 rounded-lg max-h-32 overflow-y-auto p-2 mb-5 text-xs">
            {#each importSummary.details.filter(d => d.status === 'error') as d}
              <div class="font-mono text-red-700 truncate" title={d.reason}>{d.username}: {d.reason}</div>
            {/each}
          </div>
        {/if}

        <button type="button" on:click={() => { closeImport(); importOpen = false; }}
                class="btn-primary w-full">
          Entendido
        </button>

      {:else if importStep === 'error'}
        <!-- Error -->
        <div class="text-center">
          <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle size={28} class="text-red-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">No se pudo importar</h3>
          <p class="text-sm text-text-secondary mt-2 break-words">{importError}</p>
          <button type="button" on:click={() => importStep = 'pick'} class="btn-primary mt-5 w-full">
            Reintentar
          </button>
        </div>

      {:else}
        <!-- Progress steps -->
        <div class="text-center mb-5">
          <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-brand-50 flex items-center justify-center">
            <Download size={28} class="text-brand-600" />
          </div>
          <h3 class="text-base font-semibold text-text-primary">Importando...</h3>
        </div>

        <ol class="space-y-3">
          {#each [
            { id: 'connecting', label: 'Conectando al MikroTik...',   icon: RouterIcon },
            { id: 'reading',    label: 'Leyendo clientes PPPoE...',   icon: Wifi },
            { id: 'comparing',  label: 'Comparando registros...',     icon: SlidersHorizontal },
            { id: 'importing',  label: 'Importando nuevos clientes...', icon: Database },
          ] as s, idx}
            {@const order = ['connecting', 'reading', 'comparing', 'importing']}
            {@const currentIdx = order.indexOf(importStep)}
            {@const stepIdx = order.indexOf(s.id)}
            <li class="flex items-center gap-3">
              <span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                           {stepIdx < currentIdx
                             ? 'bg-emerald-100 text-emerald-600'
                             : stepIdx === currentIdx
                               ? 'bg-brand-100 text-brand-700'
                               : 'bg-slate-100 text-slate-400'}">
                {#if stepIdx === currentIdx}
                  <Loader2 size={16} class="animate-spin" />
                {:else if stepIdx < currentIdx}
                  <CheckCircle2 size={16} />
                {:else}
                  <svelte:component this={s.icon} size={16} />
                {/if}
              </span>
              <span class="text-sm font-medium text-text-primary">{s.label}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>
{/if}

<!-- Client Modal (create / view / edit) -->
{#if modalMode}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" on:click|self={closeModal}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
        <h2 class="text-lg font-semibold text-slate-900">{modalTitle}</h2>
        <button on:click={closeModal} class="text-slate-400 hover:text-slate-600">
          <X size={20} />
        </button>
      </div>

      <div class="p-6">
        {#if modalError}
          <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm flex items-center gap-2">
            <X size={16} /> {modalError}
          </div>
        {/if}

        {#if modalLoading && modalMode !== 'create'}
          <div class="flex items-center justify-center py-12 text-slate-500 gap-2">
            <div class="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-sm">Cargando datos del cliente…</span>
          </div>
        {:else}
        <form on:submit|preventDefault={modalMode === 'edit' ? handleUpdateClient : handleCreateClient}>
          <fieldset disabled={isReadOnly} class="space-y-5">

          <!-- SECTION 1: Personal data -->
          <div class="card">
            <div class="card-header">
              <div class="flex items-center gap-2">
                <User size={16} class="text-slate-600" />
                <h3 class="font-semibold text-slate-900">Datos Personales</h3>
              </div>
            </div>
            <div class="card-body grid grid-cols-1 md:grid-cols-2 gap-4">

              <div class="md:col-span-2">
                <label for="m-fullName" class="label">Nombre Completo *</label>
                <input id="m-fullName" type="text" bind:value={newClient.fullName}
                       on:blur={generateUsername} required
                       placeholder="Ej: María Godoy Urrea"
                       class="input"/>
              </div>

              <div>
                <label for="m-documentType" class="label">Tipo Documento</label>
                <select id="m-documentType" bind:value={newClient.documentType} class="select">
                  <option value="CC">Cédula de Ciudadanía</option>
                  <option value="NIT">NIT</option>
                  <option value="CE">Cédula Extranjería</option>
                  <option value="PAS">Pasaporte</option>
                </select>
              </div>

              <div>
                <label for="m-documentNumber" class="label">Número Documento *</label>
                <input id="m-documentNumber" type="text" bind:value={newClient.documentNumber}
                       on:blur={generateUsername} required class="input"/>
              </div>

              <div>
                <label for="m-email" class="label">Correo Electrónico</label>
                <input id="m-email" type="email" bind:value={newClient.email}
                       placeholder="cliente@email.com" class="input"/>
              </div>

              <div>
                <label for="m-phone" class="label">Teléfono / WhatsApp</label>
                <div class="flex">
                  <span class="inline-flex items-center px-3 rounded-l-lg
                               border border-r-0 border-slate-200
                               bg-slate-50 text-slate-700 text-sm">+57</span>
                  <input id="m-phone" type="tel" bind:value={newClient.phone}
                         placeholder="3001234567"
                         class="input flex-1 rounded-l-none" />
                </div>
              </div>

              <div>
                <label for="m-address" class="label">Dirección de Instalación</label>
                <input id="m-address" type="text" bind:value={newClient.address}
                       placeholder="Calle 5 # 3-20" class="input"/>
              </div>

              <div>
                <label for="m-neighborhood" class="label">Barrio / Sector</label>
                <input id="m-neighborhood" type="text" bind:value={newClient.neighborhood} class="input"/>
              </div>

              <div>
                <label for="m-zone" class="label">Zona</label>
                <select id="m-zone" bind:value={newClient.zoneId} class="select">
                  <option value="">Seleccionar zona...</option>
                  {#each zones as z}<option value={z.id}>{z.name}</option>{/each}
                </select>
              </div>

              <div>
                <label for="m-contractDate" class="label">Fecha de Contrato</label>
                <input id="m-contractDate" type="date" bind:value={newClient.contractDate} class="input"/>
              </div>

              <div class="md:col-span-2">
                <label for="m-notes" class="label">Notas</label>
                <textarea id="m-notes" bind:value={newClient.notes} rows="2"
                          placeholder="Observaciones del cliente..."
                          class="input resize-none"></textarea>
              </div>
            </div>
          </div>

          <!-- SECTION 2: MikroTik / PPPoE Service -->
          <div class="card">
            <div class="card-header">
              <div class="flex items-center gap-2">
                <RouterIcon size={16} class="text-slate-600" />
                <h3 class="font-semibold text-slate-900">Servicio / Cuenta MikroTik</h3>
              </div>
            </div>
            <div class="card-body grid grid-cols-1 md:grid-cols-2 gap-4">

              <div>
                <label for="m-routerId" class="label">Router Asignado *</label>
                <select id="m-routerId" bind:value={newClient.routerId} required class="select">
                  <option value="">Seleccionar router...</option>
                  {#each routers as r}
                    <option value={r.id}>{r.name} — {r.ip}</option>
                  {/each}
                </select>
              </div>

              <div>
                <label for="m-planId" class="label">Plan de Servicio *</label>
                <select id="m-planId" bind:value={newClient.planId} required class="select">
                  <option value="">Seleccionar plan...</option>
                  {#each plans as p}
                    <option value={p.id}>{p.name} — {p.downloadSpeed}↓/{p.uploadSpeed}↑ Mbps —
                      ${p.monthlyPrice.toLocaleString('es-CO')} COP</option>
                  {/each}
                </select>
              </div>

              <div>
                <label for="m-username" class="label">
                  Usuario en el RB (PPPoE)
                  <span class="text-slate-400 text-xs font-normal ml-1">Auto-generado</span>
                </label>
                <input id="m-username" type="text" bind:value={newClient.mikrotik.username}
                       placeholder="0026maria_godoy_urrea" class="input font-mono"/>
              </div>

              <div>
                <label for="m-password" class="label">Password PPPoE</label>
                <div class="flex gap-2">
                  <input id="m-password" type="text" bind:value={newClient.mikrotik.password}
                         class="flex-1 input font-mono"/>
                  <button type="button" on:click={generatePassword}
                          class="btn-ghost" title="Generar contraseña aleatoria">
                    <Wifi size={14} /> Auto
                  </button>
                </div>
              </div>

              <div class="relative">
                <label for="m-remoteAddress" class="label">
                  Remote Address PPPoE
                  <span class="text-slate-400 text-xs font-normal">(IP cliente)</span>
                </label>
                <div class="flex gap-2">
                  <input id="m-remoteAddress" type="text" bind:value={newClient.mikrotik.remoteAddress}
                         placeholder="172.16.60.28" class="flex-1 input font-mono"/>
                  <button type="button" on:click={openIpsPopover}
                          class="btn-ghost"
                          title="Ver IPs disponibles del router">
                    <Search size={14} /> IPs
                  </button>
                </div>

                {#if ipsPopoverOpen}
                  <!-- click-outside backdrop -->
                  <div class="fixed inset-0 z-40" on:click={() => ipsPopoverOpen = false}></div>

                  <div class="absolute z-50 left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-slate-200 max-h-80 overflow-hidden flex flex-col">
                    <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50">
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
                                class="text-slate-400 hover:text-slate-600"
                                title="Cerrar">
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
                                    class="text-left text-xs font-mono px-2 py-1 rounded hover:bg-blue-50 hover:text-brand-800">
                              {ip}
                            </button>
                          {/each}
                        </div>
                      {/if}
                    </div>

                    {#if !ipsLoading && !ipsError && ipsTotals}
                      <div class="px-3 py-1.5 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
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
                <label for="m-localAddress" class="label">
                  Local Address PPPoE
                  <span class="text-slate-400 text-xs font-normal">(IP gateway)</span>
                </label>
                <input id="m-localAddress" type="text" bind:value={newClient.mikrotik.localAddress}
                       placeholder="172.16.60.1" class="input font-mono"/>
              </div>

              <div>
                <label for="m-profileName" class="label">Perfil PPPoE *</label>

                {#if !newClient.routerId}
                  <div class="input flex items-center gap-2 text-text-secondary cursor-not-allowed bg-slate-50">
                    Selecciona primero un router para cargar perfiles
                  </div>
                {:else if profilesLoading}
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
                              on:click={() => loadProfiles(Number(newClient.routerId))}
                              class="mt-1 text-xs text-brand-600 hover:underline font-medium">
                        Reintentar
                      </button>
                    </div>
                  </div>
                {:else if profiles.length === 0}
                  <div class="flex items-start gap-2 bg-amber-50 border border-amber-200
                              text-amber-800 rounded-xl px-3 py-2.5 text-sm">
                    <AlertCircle size={14} class="mt-0.5 flex-shrink-0 text-amber-500" />
                    <span>No hay perfiles PPPoE disponibles en este router.</span>
                  </div>
                {:else}
                  <select id="m-profileName" bind:value={newClient.mikrotik.profileName}
                          required class="select font-mono">
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
                <label for="m-coordinates" class="label">Coordenadas GPS</label>
                <input id="m-coordinates" type="text" bind:value={newClient.mikrotik.coordinates}
                       placeholder="3.850149,-76.492356" class="input font-mono"/>
                <p class="text-xs text-slate-400 mt-1">Ej: 3.850149,-76.492356</p>
              </div>

              <div class="md:col-span-2">
                <label for="m-status" class="label">Estado</label>
                <select id="m-status" bind:value={newClient.mikrotik.status} class="select">
                  <option value="ACTIVE">Activo</option>
                  <option value="SUSPENDED">Suspendido</option>
                </select>
              </div>

            </div>
          </div>
          </fieldset>
        </form>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 sticky bottom-0">
        {#if modalMode === 'edit'}
          <button on:click={closeModal} type="button" class="btn-secondary" disabled={modalLoading}>
            <X size={15} /> Cancelar
          </button>
          <button on:click={handleUpdateClient} type="button" class="btn-primary" disabled={modalLoading}>
            {#if modalLoading}
              <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Guardando...
            {:else}
              <Save size={15} /> Guardar Cambios
            {/if}
          </button>
        {:else}
          <button on:click={closeModal} type="button" class="btn-secondary" disabled={modalLoading}>
            <X size={15} /> Cancelar
          </button>
          <button on:click={handleCreateClient} type="button" class="btn-primary" disabled={modalLoading}>
            {#if modalLoading}
              <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Creando...
            {:else}
              <Save size={15} /> Crear Cliente
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Modal Registrar Pago -->
{#if payOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" on:click|self={closePaymentModal}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 class="text-lg font-semibold text-slate-900">Registrar Pago</h2>
        <button on:click={closePaymentModal} class="text-slate-400 hover:text-slate-600">
          <X size={20} />
        </button>
      </div>

      <div class="p-6 space-y-4">
        {#if payError}
          <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
            {payError}
          </div>
        {/if}

        {#if payClient}
          <div class="bg-slate-50 rounded-lg p-3 border border-slate-100">
            <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Cliente</div>
            <div class="text-sm font-medium text-slate-900">{payClient.name || '—'}</div>
            {#if payInvoice}
              <div class="mt-2 text-xs text-slate-600">
                Factura <span class="font-mono">#{payInvoice.id?.slice(-6) || '—'}</span> ·
                vence {payInvoice.dueDate ? new Date(payInvoice.dueDate).toLocaleDateString('es-CO') : '—'}
              </div>
              <div class="text-xs text-slate-500">
                Saldo restante: <span class="font-semibold text-slate-900">{fmtMoney(payInvoice.balanceDue > 0 ? payInvoice.balanceDue : (payInvoice.amount ?? payInvoice.total ?? 0))}</span>
              </div>
            {:else}
              <div class="mt-2 text-xs text-amber-600">⚠ Este cliente no tiene facturas pendientes</div>
            {/if}
          </div>
        {/if}

        <div>
          <label for="pay-amount" class="label">Monto a pagar (COP)</label>
          <input id="pay-amount" type="number" min="1" bind:value={payAmount} class="input" placeholder="0" />
        </div>

        <div>
          <label for="pay-method" class="label">Método de pago</label>
          <select id="pay-method" bind:value={payMethod} class="select">
            <option value="CASH">Efectivo</option>
            <option value="BANK_TRANSFER">Transferencia bancaria</option>
            <option value="WOMPI">Wompi</option>
            <option value="CREDIT_CARD">Tarjeta de crédito</option>
            <option value="OTHER">Otro</option>
          </select>
        </div>

        <div>
          <label for="pay-notes" class="label">Notas (opcional)</label>
          <input id="pay-notes" type="text" bind:value={payNotes} class="input" placeholder="Referencia o comentario" />
        </div>
      </div>

      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button on:click={closePaymentModal} type="button" class="btn-secondary" disabled={paySaving}>
          <X size={15} /> Cancelar
        </button>
        <button on:click={submitPayment} type="button" class="btn-primary"
                disabled={paySaving || !payInvoice}>
          {#if paySaving}
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            Registrando...
          {:else}
            <CreditCard size={15} /> Registrar Pago
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
