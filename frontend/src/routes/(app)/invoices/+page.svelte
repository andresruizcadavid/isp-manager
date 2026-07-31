<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page as pageStore } from '$app/stores';
  import { goto } from '$app/navigation';
  import { invoicesApi } from '$lib/api/invoices.api.js';
  import { api } from '$lib/api/client.js';
  import RegisterPaymentModal from '$lib/components/payments/RegisterPaymentModal.svelte';
  import {
    Search, FileText, Eye, AlertCircle,
    Wallet, Clock, CheckCircle2, AlertTriangle,
    Pencil, Trash2, X, Loader2, Save,
    ArrowUp, ArrowDown, ArrowUpDown, Download,
    Calendar, ChevronDown, ChevronLeft, ChevronRight,
    CreditCard, Send, Link2, CheckSquare
  } from 'lucide-svelte';

  /** @type {import('$lib/types').Invoice[]} */
  let invoices = [];
  let total = 0;
  let loading = true;
  let error = '';

  // KPI stats — pulled from /invoices/stats/overview with the same filters
  // the table query uses. The numbers always match the full filtered set,
  // never the visible page. Empty object until the first response lands.
  /** @type {any} */
  let stats = {};
  let statsLoading = false;

  let q = '';
  let status = '';
  let paymentMethod = '';           // '' | CASH | BANK_TRANSFER | WOMPI
  let dateField = 'dueDate';        // 'dueDate' (vencimiento) | 'issueDate' (emisión)
  let dateFrom = '';                // 'YYYY-MM-DD'
  let dateTo = '';                  // 'YYYY-MM-DD'
  let page = 1;
  let pageSize = 25;                 // registros por página (10/25/50/100)
  // Ordenamiento (el backend valida contra una whitelist).
  let sortBy = 'createdAt';         // createdAt | invoiceNumber | issueDate | dueDate | amount | total | status
  let sortOrder = 'desc';           // 'asc' | 'desc'
  let exporting = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let searchTimer;

  // ── Estado del selector de fecha (popover con atajos) ──────────────
  let dateOpen = false;
  let datePreset = '';              // etiqueta del atajo activo (para el chip)
  // Valores en edición dentro del popover (se confirman al "Aplicar").
  let pDateField = 'dueDate';
  let pFrom = '';
  let pTo = '';
  let pPreset = '';
  let pYear = new Date().getFullYear();   // año mostrado en la grilla de meses
  const MONTHS_ABBR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // Estado como pestañas rápidas; los estados menos comunes van al select "Otros".
  const STATUS_TABS = [
    { v: '', l: 'Todas' },
    { v: 'PENDING', l: 'Pendientes' },
    { v: 'OVERDUE', l: 'Vencidas' },
    { v: 'PAID', l: 'Pagadas' }
  ];
  const OTHER_STATUSES = ['PARTIAL', 'CANCELLED', 'REFUNDED', 'DRAFT'];
  const DATE_PRESETS = [
    { k: 'today', l: 'Hoy' }, { k: 'week', l: 'Esta semana' }, { k: 'month', l: 'Este mes' },
    { k: 'lastmonth', l: 'Mes pasado' }, { k: 'd30', l: 'Últimos 30 días' },
    { k: 'd90', l: 'Últimos 90 días' }, { k: 'year', l: 'Este año' }
  ];
  /** @type {Record<string,string>} */
  const METHOD_PT = { CASH: 'Efectivo', BANK_TRANSFER: 'Consignación', WOMPI: 'Wompi', CREDIT_CARD: 'Tarjeta', NEQUI: 'Nequi', BANCOLOMBIA: 'Bancolombia', OTHER: 'Otro' };

  /** @param {string} v */
  function setStatus(v) { status = v; reloadAll(); }
  /** @param {Event} e */
  function onOtherStatus(e) { status = /** @type {HTMLSelectElement} */ (e.currentTarget).value; reloadAll(); }

  /** Date → 'YYYY-MM-DD' local. @param {Date} d */
  function ymd(d) { const p = (/** @type {number} */ n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  /** 'YYYY-MM-DD' → 'DD/MM/YYYY'. @param {string} s */
  function dm(s) { return s ? s.split('-').reverse().join('/') : ''; }
  /** @param {string} k */
  function presetRange(k) {
    const t = new Date(); let a, b;
    if (k === 'today') { a = new Date(t); b = new Date(t); }
    else if (k === 'week') { a = new Date(t); a.setDate(t.getDate() - ((t.getDay() + 6) % 7)); b = new Date(a); b.setDate(a.getDate() + 6); }
    else if (k === 'month') { a = new Date(t.getFullYear(), t.getMonth(), 1); b = new Date(t.getFullYear(), t.getMonth() + 1, 0); }
    else if (k === 'lastmonth') { a = new Date(t.getFullYear(), t.getMonth() - 1, 1); b = new Date(t.getFullYear(), t.getMonth(), 0); }
    else if (k === 'd30') { b = new Date(t); a = new Date(t); a.setDate(t.getDate() - 29); }
    else if (k === 'd90') { b = new Date(t); a = new Date(t); a.setDate(t.getDate() - 89); }
    else if (k === 'year') { a = new Date(t.getFullYear(), 0, 1); b = new Date(t.getFullYear(), 11, 31); }
    else return null;
    return { from: ymd(a), to: ymd(b) };
  }
  /** @param {string} f @param {string} t */
  function rangeText(f, t) {
    if (f && t) return `${dm(f)} – ${dm(t)}`;
    if (f) return `desde ${dm(f)}`;
    if (t) return `hasta ${dm(t)}`;
    return '';
  }

  function openDate() {
    pDateField = dateField; pFrom = dateFrom; pTo = dateTo; pPreset = datePreset;
    // Arranca la grilla en el año del filtro actual (o el año en curso).
    pYear = dateFrom ? Number(dateFrom.slice(0, 4)) : new Date().getFullYear();
    dateOpen = true;
  }
  /** @param {{k:string,l:string}} p */
  function pickPreset(p) { const r = presetRange(p.k); if (r) { pFrom = r.from; pTo = r.to; pPreset = p.l; } }
  /** Selecciona un mes completo (0-based) del año `pYear`. @param {number} mIdx */
  function pickMonth(mIdx) {
    pFrom = ymd(new Date(pYear, mIdx, 1));
    pTo   = ymd(new Date(pYear, mIdx + 1, 0));
    pPreset = `${MONTHS_FULL[mIdx]} ${pYear}`;
  }
  // Mes resaltado en la grilla: el que coincide con el rango pendiente + año.
  $: pActiveMonth = MONTHS_FULL.findIndex((_, m) =>
    pFrom === ymd(new Date(pYear, m, 1)) && pTo === ymd(new Date(pYear, m + 1, 0)));
  function onCustomDate() { pPreset = ''; }          // editar fechas a mano = deja de ser un atajo
  function applyDate() { dateField = pDateField; dateFrom = pFrom; dateTo = pTo; datePreset = pPreset; dateOpen = false; reloadAll(); }
  function clearDate() { dateFrom = ''; dateTo = ''; datePreset = ''; dateOpen = false; reloadAll(); }

  /** Filtro por defecto al entrar: el MES ACTUAL por vencimiento ("la realidad
   *  actual"). En este ISP casi todas las facturas del mes vencen dentro del mes,
   *  así que vencimiento es el campo que refleja el mes en curso. */
  function applyCurrentMonthDefault() {
    const now = new Date();
    dateField = 'dueDate';
    dateFrom  = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    dateTo    = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    datePreset = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`;
  }

  /** Medios de pago (COMPLETED) de una factura, sin repetir. @param {any} inv */
  function invMethods(inv) { return [...new Set((inv.payments || []).filter((/** @type {any} */ p) => p.status === 'COMPLETED').map((/** @type {any} */ p) => p.method))]; }

  /** @param {string} key */
  function removeChip(key) {
    if (key === 'status') status = '';
    else if (key === 'method') paymentMethod = '';
    else if (key === 'date') { dateFrom = ''; dateTo = ''; datePreset = ''; }
    reloadAll();
  }

  /** Build the shared filter object used by BOTH the list query and the
   *  stats query. Single source of truth so they can't drift. All filters
   *  combine (server ANDs them); date bounds are independent (solo "desde",
   *  solo "hasta", o rango). */
  function buildFilterParams() {
    /** @type {Record<string, any>} */
    const p = {};
    if (q.trim())      p.search = q.trim();
    if (status)        p.status = status;
    if (paymentMethod) p.paymentMethod = paymentMethod;
    if (dateFrom || dateTo) {
      p.dateField = dateField;
      // Enviar los límites como ISO en la ZONA LOCAL del navegador (no fecha
      // suelta, que el backend interpretaría como UTC). Así el filtro por mes
      // coincide con las fechas TAL COMO se muestran en la tabla — sin el
      // corrimiento de zona horaria que hacía que "julio" mostrara facturas
      // que se ven como 30/06.
      if (dateFrom) p.dateFrom = localDayBoundaryISO(dateFrom, false);
      if (dateTo)   p.dateTo   = localDayBoundaryISO(dateTo, true);
    }
    return p;
  }

  /** 'YYYY-MM-DD' → ISO del inicio (00:00) o fin (23:59:59.999) de ese día en
   *  la zona local del navegador. @param {string} s @param {boolean} endOfDay */
  function localDayBoundaryISO(s, endOfDay) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
    return dt.toISOString();
  }

  function clearFilters() {
    q = ''; status = ''; paymentMethod = '';
    dateField = 'dueDate'; dateFrom = ''; dateTo = ''; datePreset = '';
    reloadAll();
  }

  async function load() {
    loading = true; error = '';
    syncUrl();   // mantiene la URL en sync con los filtros/orden/página
    try {
      const params = { page, limit: pageSize, sortBy, sortOrder, ...buildFilterParams() };
      const res = await invoicesApi.getPage(params);
      invoices = res?.data ?? [];
      total    = res?.meta?.total ?? invoices.length;
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al cargar facturas';
    } finally { loading = false; }
  }

  /** Ordenar por columna: si es la misma, alterna asc/desc; si es nueva, arranca en desc. @param {string} col */
  function applySort(col) {
    if (sortBy === col) sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    else { sortBy = col; sortOrder = 'desc'; }
    page = 1;
    load();   // el orden no cambia los KPIs → no recargamos stats
  }

  /** Exporta a Excel el set COMPLETO que cumple los filtros actuales (no solo la
   *  página visible), respetando el orden. Cap 500 = tope del servidor. */
  async function exportXlsx() {
    exporting = true; error = '';
    try {
      const res = await invoicesApi.getPage({ page: 1, limit: 500, sortBy, sortOrder, ...buildFilterParams() });
      const rows = res?.data ?? [];
      if (!rows.length) { error = 'No hay facturas para exportar con los filtros actuales.'; return; }
      const XLSX = await import('xlsx');
      /** @type {Record<string,string>} */
      const METHOD_PT = { CASH:'Efectivo', BANK_TRANSFER:'Consignación', WOMPI:'Wompi', CREDIT_CARD:'Tarjeta', OTHER:'Otro' };
      const header = ['Número','Cliente','Documento','Emisión','Vencimiento','Subtotal (COP)','Total (COP)','Estado','Pagada','Medio(s) de pago'];
      const data = rows.map((/** @type {any} */ inv) => {
        const medios = [...new Set((inv.payments || [])
          .filter((/** @type {any} */ p) => p.status === 'COMPLETED')
          .map((/** @type {any} */ p) => METHOD_PT[p.method] || p.method))].join(', ');
        return [
          inv.invoiceNumber || '', inv.client?.name || '', inv.client?.documentNumber || '',
          fmtDate(inv.issueDate), fmtDate(inv.dueDate),
          Math.round((inv.amount || 0) / 100), Math.round((inv.total || 0) / 100),
          STATUS_PT[inv.status] || inv.status, fmtDate(inv.paidDate), medios
        ];
      });
      const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
      ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 20 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Facturas');
      XLSX.writeFile(wb, `facturas_${new Date().toISOString().slice(0, 10)}.xlsx`);
      if (res?.meta?.total > rows.length) {
        error = `Se exportaron ${rows.length} de ${res.meta.total} facturas (tope de exportación). Afina los filtros para exportar el resto.`;
      }
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudo exportar el Excel.';
    } finally { exporting = false; }
  }

  /** Aggregate KPIs for the FULL filtered set. Run in parallel with load(). */
  // Los KPIs de arriba son SIEMPRE del sistema completo (TODOS los períodos),
  // para que coincidan con la Planilla y el Dashboard (deuda total = una sola
  // realidad). El filtro de fecha/estado afecta solo el LISTADO de abajo.
  async function loadStats() {
    statsLoading = true;
    try {
      stats = await api.get('/invoices/stats/overview');
    } catch (/** @type {any} */ e) {
      // Non-fatal: leave previous stats in place + flag.
      console.error('stats load failed:', e.message);
    } finally { statsLoading = false; }
  }

  function reloadAll() {
    page = 1;
    clearSelection();
    load();
    loadStats();
    loadFilteredTotals();
  }

  // ── Totales del SET FILTRADO (pie de tabla) — distinto de los KPIs globales.
  /** @type {any} */
  let filteredTotals = null;
  async function loadFilteredTotals() {
    try {
      const qs = new URLSearchParams(buildFilterParams()).toString();
      filteredTotals = await api.get(`/invoices/stats/overview${qs ? '?' + qs : ''}`);
    } catch (/** @type {any} */ e) { filteredTotals = null; }
  }

  // ── Persistencia de filtros en la URL ──────────────────────────────
  function syncUrl() {
    if (!browser) return;
    const p = new URLSearchParams();
    if (q.trim())      p.set('q', q.trim());
    if (status)        p.set('status', status);
    if (paymentMethod) p.set('method', paymentMethod);
    if (dateFrom || dateTo) {
      p.set('df', dateField);
      if (dateFrom) p.set('from', dateFrom);
      if (dateTo)   p.set('to', dateTo);
      if (datePreset) p.set('pl', datePreset);
    }
    if (sortBy !== 'createdAt') p.set('sort', sortBy);
    if (sortOrder !== 'desc')   p.set('dir', sortOrder);
    if (page > 1)        p.set('page', String(page));
    if (pageSize !== 25) p.set('ps', String(pageSize));
    const qs = p.toString();
    goto(qs ? `?${qs}` : location.pathname, { replaceState: true, keepFocus: true, noScroll: true });
  }
  /** Lee filtros de la URL al montar. Devuelve true si había alguno. */
  function readUrl() {
    const sp = $pageStore.url.searchParams;
    let any = false;
    const g = (/** @type {string} */ k) => sp.get(k);
    if (g('q'))      { q = g('q') || ''; any = true; }
    if (g('status')) { status = g('status') || ''; any = true; }
    if (g('method')) { paymentMethod = g('method') || ''; any = true; }
    if (g('from') || g('to')) {
      dateField = g('df') === 'issueDate' ? 'issueDate' : 'dueDate';
      dateFrom  = g('from') || '';
      dateTo    = g('to') || '';
      datePreset = g('pl') || '';
      any = true;
    }
    if (g('sort')) sortBy = g('sort') || 'createdAt';
    if (g('dir'))  sortOrder = g('dir') === 'asc' ? 'asc' : 'desc';
    if (g('page')) page = Math.max(1, Number(g('page')) || 1);
    if (g('ps'))   pageSize = [10, 25, 50, 100].includes(Number(g('ps'))) ? Number(g('ps')) : 25;
    return any;
  }

  onMount(() => {
    const hadUrlFilters = readUrl();
    if (!hadUrlFilters) applyCurrentMonthDefault();   // default solo si la URL no traía filtros
    load(); loadStats(); loadFilteredTotals();
  });

  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reloadAll, 300);
  }

  /** Ícono de orden para una columna. @param {string} col */
  function arrowFor(col) {
    if (sortBy !== col) return ArrowUpDown;
    return sortOrder === 'asc' ? ArrowUp : ArrowDown;
  }

  $: totalPages = Math.max(1, Math.ceil(total / pageSize));
  /** @param {number} p */
  function setPage(p) {
    if (p < 1 || p > totalPages || p === page) return;
    page = p;
    load();
    // No need to reload stats on page change — they don't depend on page.
  }

  // KPIs sourced from the stats endpoint (server-side aggregate over the
  // full filtered set). Fallback to 0 while the first call is in flight.
  $: kpiTotal      = stats?.total            ?? 0;
  $: kpiPending    = stats?.pending          ?? 0;
  $: kpiPaid       = stats?.paid             ?? 0;
  $: kpiPendingAmt = stats?.outstandingAmount ?? 0;
  $: hasFilters    = !!(q.trim() || status || paymentMethod || dateFrom || dateTo);

  // Estado avanzado (para el select "Otros"): vacío si el estado activo es uno
  // de las pestañas rápidas o "Todas".
  $: otherStatusValue = OTHER_STATUSES.includes(status) ? status : '';
  // Etiqueta del botón de fecha.
  $: dateLabel = (dateFrom || dateTo)
    ? `${dateField === 'dueDate' ? 'Venc.' : 'Emisión'}: ${datePreset || rangeText(dateFrom, dateTo)}`
    : 'Fecha';
  // Vista previa dentro del popover.
  $: datePreview = (() => {
    const f = pDateField === 'dueDate' ? 'vencimiento' : 'emisión';
    if (!pFrom && !pTo) return `Elige un atajo o un rango para filtrar por ${f}.`;
    return `Filtra por ${f} entre ${dm(pFrom) || '—'} y ${dm(pTo) || '—'}.`;
  })();
  // Chips de filtros activos (búsqueda no lleva chip; tiene su propio campo).
  $: chips = [
    ...(status ? [{ key: 'status', label: 'Estado', val: STATUS_PT[status] || status }] : []),
    ...(paymentMethod ? [{ key: 'method', label: 'Medio', val: METHOD_PT[paymentMethod] || paymentMethod }] : []),
    ...((dateFrom || dateTo) ? [{ key: 'date', label: dateField === 'dueDate' ? 'Vencimiento' : 'Emisión', val: datePreset || rangeText(dateFrom, dateTo) }] : [])
  ];

  /** @param {number|null|undefined} cents */
  function fmtMoney(cents) {
    if (cents == null) return '—';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(cents / 100);
  }
  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  /** @type {Record<string, string>} */
  const STATUS_PT = { DRAFT:'Borrador', PENDING:'Pendiente', PARTIAL:'Parcial', PAID:'Pagada', OVERDUE:'Vencida', CANCELLED:'Cancelada', REFUNDED:'Reembolsada' };
  /** @type {Record<string, string>} */
  const STATUS_CLS = { PAID:'badge-green', PENDING:'badge-yellow', PARTIAL:'badge-blue', OVERDUE:'badge-red', CANCELLED:'badge-gray', DRAFT:'badge-gray', REFUNDED:'badge-blue' };

  const OPEN_ST = ['PENDING', 'PARTIAL', 'OVERDUE'];
  /** Días de mora (>0 solo si la factura está abierta y ya venció). @param {any} inv */
  function daysOverdue(inv) {
    if (!inv?.dueDate || !OPEN_ST.includes(inv.status)) return 0;
    if (inv.balanceDue != null && inv.balanceDue <= 0) return 0;
    const d = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86400000);
    return d > 0 ? d : 0;
  }
  /** @param {any} inv */
  const isPayable = (inv) => OPEN_ST.includes(inv?.status) && (inv?.balanceDue == null || inv?.balanceDue > 0);

  // ── Selección múltiple (acciones masivas) ──────────────────────────
  /** @type {Set<string>} */
  let selectedIds = new Set();
  let bulkBusy = false;
  let bulkMsg = '';
  function clearSelection() { selectedIds = new Set(); }
  /** @param {string} id */
  function toggleRow(id) { const s = new Set(selectedIds); s.has(id) ? s.delete(id) : s.add(id); selectedIds = s; }
  function toggleAllVisible() {
    const ids = invoices.map(i => i.id);
    const allSel = ids.length > 0 && ids.every(id => selectedIds.has(id));
    const s = new Set(selectedIds);
    if (allSel) ids.forEach(id => s.delete(id)); else ids.forEach(id => s.add(id));
    selectedIds = s;
  }
  $: allVisibleSelected = invoices.length > 0 && invoices.every(i => selectedIds.has(i.id));
  $: selectedInvoices = invoices.filter(i => selectedIds.has(i.id));

  /** Ejecuta una acción sobre cada factura seleccionada, secuencial, con progreso.
   *  @param {string} label @param {(inv:any)=>Promise<any>} fn */
  async function bulkRun(label, fn) {
    const items = [...selectedInvoices];
    if (!items.length) return;
    bulkBusy = true; error = '';
    let ok = 0, fail = 0;
    for (let i = 0; i < items.length; i++) {
      bulkMsg = `${label}… ${i + 1}/${items.length}`;
      try { await fn(items[i]); ok++; } catch (/** @type {any} */ e) { fail++; }
    }
    bulkBusy = false; bulkMsg = '';
    error = `${label}: ${ok} ok${fail ? ` · ${fail} con error` : ''}`;
    clearSelection();
    reloadAll();
  }
  function bulkReminder() {
    if (!confirm(`¿Enviar recordatorio a ${selectedInvoices.length} factura(s)?`)) return;
    bulkRun('Recordatorios', (inv) => invoicesApi.sendReminder(inv.id));
  }
  function bulkLinks() {
    const payables = selectedInvoices.filter(isPayable);
    if (!payables.length) { error = 'Ninguna de las seleccionadas es pagable (para generar link).'; return; }
    if (!confirm(`¿Generar link de pago para ${payables.length} factura(s)?`)) return;
    selectedIds = new Set(payables.map(i => i.id));
    bulkRun('Links de pago', (inv) => invoicesApi.paymentLink(inv.id));
  }
  function bulkDelete() {
    if (!confirm(`¿ELIMINAR ${selectedInvoices.length} factura(s)? Esta acción no se puede deshacer.`)) return;
    bulkRun('Eliminar', (inv) => invoicesApi.remove(inv.id));
  }

  // ── Registrar pago desde la fila ───────────────────────────────────
  let payModalOpen = false;
  /** @type {any} */
  let payClient = null;
  /** @type {any[]} */
  let payInvoices = [];
  /** @type {string | null} */
  let payPreselect = null;
  /** @param {any} inv */
  function openPayRow(inv) {
    payClient = inv.client || null;
    payInvoices = [inv];        // el modal permite pagar esta factura (y generar otro mes si hace falta)
    payPreselect = inv.id;
    payModalOpen = true;
  }
  function onPayDone() { payModalOpen = false; reloadAll(); }

  // ── Editar / Eliminar factura ──────────────────────────────
  let editOpen = false;
  /** @type {any} */
  let editInv = null;
  /** @type {{ amount: number | string, dueDate: string }} */
  let editForm = { amount: '', dueDate: '' };
  let editSaving = false;
  let editError = '';

  /** @param {any} inv */
  function openEdit(inv) {
    editInv = inv;
    editForm = {
      amount: Math.round((inv.total ?? inv.amount ?? 0) / 100),
      dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : ''
    };
    editError = '';
    editOpen = true;
  }
  async function saveEdit() {
    if (!editInv) return;
    const amount = Number(editForm.amount);
    if (!(amount > 0))       { editError = 'El monto debe ser mayor a 0.'; return; }
    if (!editForm.dueDate)   { editError = 'La fecha de vencimiento es requerida.'; return; }
    editSaving = true; editError = '';
    try {
      await invoicesApi.update(editInv.id, { amount, dueDate: editForm.dueDate });
      editOpen = false;
      reloadAll();
    } catch (/** @type {any} */ e) { editError = e.message || 'No se pudo actualizar la factura.'; }
    finally { editSaving = false; }
  }

  /** @param {any} inv */
  async function deleteInvoice(inv) {
    if (!confirm(`¿Eliminar la factura ${inv.invoiceNumber || ''}?\n\nEsta acción no se puede deshacer.`)) return;
    try {
      await invoicesApi.remove(inv.id);
      reloadAll();
    } catch (/** @type {any} */ e) {
      alert(e.message || 'No se pudo eliminar la factura.');
    }
  }
</script>

<svelte:head><title>Facturas — ISP Manager</title></svelte:head>
<svelte:window on:keydown={(e) => { if (e.key === 'Escape' && dateOpen) dateOpen = false; }} />

<div class="page-header">
  <div>
    <h1 class="page-title">Facturas</h1>
    <p class="page-subtitle">
      {total} {total === 1 ? 'factura' : 'facturas'}
      {#if hasFilters}<span class="text-amber-700 font-medium">· filtros activos</span>{:else}<span>en el sistema</span>{/if}
    </p>
  </div>
  <div class="flex items-center gap-2">
    <button class="btn-secondary btn-sm flex items-center gap-1.5" on:click={exportXlsx}
            disabled={exporting || loading || total === 0} title="Exportar a Excel las facturas que cumplen los filtros">
      {#if exporting}<Loader2 size={14} class="animate-spin" />{:else}<Download size={14} />{/if}
      Exportar
    </button>
    <a href="/invoices/new" class="btn-primary btn-sm flex items-center gap-1.5">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Nueva Factura
    </a>
  </div>
</div>

<!-- KPI strip — SIEMPRE del sistema completo (todos los períodos), para que
     coincidan con Planilla y Dashboard. El filtro afecta solo el listado. -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  <div class="kpi-tile">
    <div class="icon-square-blue"><FileText size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Total</div>
      <div class="kpi-value">{kpiTotal}</div>
      <div class="kpi-sub">Facturas en el sistema</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-amber"><Clock size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Pendientes</div>
      <div class="kpi-value">{kpiPending}</div>
      <div class="kpi-sub">Pendiente + parcial</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-green"><CheckCircle2 size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Pagadas</div>
      <div class="kpi-value">{kpiPaid}</div>
      <div class="kpi-sub">{stats?.collectionRate != null ? `${stats.collectionRate}% cobrado` : 'Cobradas'}</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-rose"><Wallet size={14} /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Cobranza</div>
      <div class="kpi-value">{fmtMoney(kpiPendingAmt)}</div>
      <div class="kpi-sub">
        {#if stats?.overdueAmount > 0}
          <span class="text-red-600 font-medium">{fmtMoney(stats.overdueAmount)} vencida</span> · todo el sistema
        {:else}Saldo por cobrar (todo){/if}
      </div>
    </div>
  </div>
</div>

{#if error}
  <div class="card p-4 mb-4 flex items-start gap-3 border-red-200 bg-red-50">
    <AlertCircle size={16} class="text-red-500 mt-0.5" />
    <div class="text-sm text-red-700">{error}</div>
  </div>
{/if}

<!-- Barra de filtros: compacta y sticky -->
<div class="card mb-3 sticky top-2 z-30">
  <div class="p-2.5 flex items-center gap-2.5 flex-wrap">
    <!-- Búsqueda -->
    <div class="relative flex-1 min-w-[200px] max-w-sm">
      <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input class="input-search" placeholder="Número, cliente, cédula..." bind:value={q} on:input={onSearchInput} />
    </div>

    <!-- Estado como pestañas rápidas -->
    <div class="inline-flex bg-slate-100 rounded-lg p-1 gap-0.5" role="tablist" aria-label="Estado">
      {#each STATUS_TABS as t}
        <button type="button" role="tab" aria-selected={status === t.v}
                class="px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap
                       {status === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}"
                on:click={() => setStatus(t.v)}>{t.l}</button>
      {/each}
    </div>

    <!-- Otros estados (parcial, cancelada, …) -->
    <select class="select !w-auto min-w-[125px]" value={otherStatusValue} on:change={onOtherStatus} title="Otros estados">
      <option value="">Otros estados</option>
      <option value="PARTIAL">Parcial</option>
      <option value="CANCELLED">Cancelada</option>
      <option value="REFUNDED">Reembolsada</option>
      <option value="DRAFT">Borrador</option>
    </select>

    <!-- Medio de pago -->
    <select class="select !w-auto min-w-[135px]" bind:value={paymentMethod} on:change={reloadAll} title="Medio con que se pagó">
      <option value="">Todos los medios</option>
      <option value="CASH">Efectivo</option>
      <option value="BANK_TRANSFER">Consignación</option>
      <option value="NEQUI">Nequi</option>
      <option value="BANCOLOMBIA">Bancolombia</option>
      <option value="WOMPI">Wompi</option>
    </select>

    <!-- Rango de fechas con atajos -->
    <div class="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={dateOpen}
              class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition whitespace-nowrap
                     {(dateFrom || dateTo) ? 'border-brand-600 text-brand-800 bg-brand-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}"
              on:click={() => (dateOpen ? (dateOpen = false) : openDate())}>
        <Calendar size={15} /> {dateLabel} <ChevronDown size={13} class="opacity-60 transition-transform {dateOpen ? 'rotate-180' : ''}" />
      </button>

      {#if dateOpen}
        <!-- Cierra al hacer clic fuera -->
        <button class="fixed inset-0 z-40 cursor-default" tabindex="-1" aria-label="Cerrar" on:click={() => (dateOpen = false)}></button>
        <div class="absolute right-0 top-full mt-2 z-50 w-[440px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
             role="dialog" aria-label="Filtrar por fecha">
          <!-- Campo a filtrar -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div class="inline-flex bg-slate-100 rounded-lg p-0.5">
              <button type="button" class="px-3 py-1.5 rounded-md text-xs font-semibold transition {pDateField === 'dueDate' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'}" on:click={() => (pDateField = 'dueDate')}>Vencimiento</button>
              <button type="button" class="px-3 py-1.5 rounded-md text-xs font-semibold transition {pDateField === 'issueDate' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-500'}" on:click={() => (pDateField = 'issueDate')}>Emisión</button>
            </div>
            <span class="text-xs text-slate-400">¿Qué fecha filtrar?</span>
          </div>

          <!-- Selección rápida por MES (Ene…Dic) -->
          <div class="px-3.5 pt-3 pb-3 border-b border-slate-100">
            <div class="flex items-center justify-between mb-2">
              <span class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mes</span>
              <div class="inline-flex items-center gap-1">
                <button type="button" class="btn-icon" title="Año anterior" on:click={() => (pYear = pYear - 1)}><ChevronLeft size={14} /></button>
                <span class="text-sm font-semibold text-slate-800 tabular-nums w-12 text-center">{pYear}</span>
                <button type="button" class="btn-icon" title="Año siguiente" on:click={() => (pYear = pYear + 1)}><ChevronRight size={14} /></button>
              </div>
            </div>
            <div class="grid grid-cols-4 gap-1.5">
              {#each MONTHS_ABBR as mon, i}
                <button type="button" on:click={() => pickMonth(i)}
                        class="py-1.5 rounded-md text-[13px] font-medium transition {pActiveMonth === i ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100'}">
                  {mon}
                </button>
              {/each}
            </div>
          </div>

          <div class="grid grid-cols-[148px_1fr]">
            <!-- Atajos -->
            <div class="border-r border-slate-100 p-2 flex flex-col gap-0.5">
              {#each DATE_PRESETS as p}
                <button type="button" class="text-left px-2.5 py-2 rounded-md text-[13px] transition {pPreset === p.l ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'}" on:click={() => pickPreset(p)}>{p.l}</button>
              {/each}
            </div>
            <!-- Rango personalizado -->
            <div class="p-3.5 flex flex-col gap-3">
              <div>
                <label for="dr-from" class="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Desde</label>
                <input id="dr-from" type="date" class="input w-full" bind:value={pFrom} on:change={onCustomDate} max={pTo || undefined} />
              </div>
              <div>
                <label for="dr-to" class="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Hasta</label>
                <input id="dr-to" type="date" class="input w-full" bind:value={pTo} on:change={onCustomDate} min={pFrom || undefined} />
              </div>
              <div class="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{datePreview}</div>
            </div>
          </div>
          <!-- Acciones -->
          <div class="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <button class="btn-ghost text-xs" on:click={clearDate}>Quitar fecha</button>
            <div class="flex gap-2">
              <button class="btn-secondary btn-sm" on:click={() => (dateOpen = false)}>Cancelar</button>
              <button class="btn-primary btn-sm" on:click={applyDate}>Aplicar</button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Chips de filtros activos -->
{#if chips.length}
  <div class="flex items-center gap-2 flex-wrap mb-4 px-1">
    <span class="text-xs text-slate-400 font-medium">Filtros:</span>
    {#each chips as c}
      <span class="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-full pl-3 pr-1 py-1">
        {c.label}: <b class="text-brand-800">{c.val}</b>
        <button class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-600 text-slate-500" title="Quitar" on:click={() => removeChip(c.key)}><X size={11} /></button>
      </span>
    {/each}
    <button class="btn-ghost text-xs" on:click={clearFilters}>Limpiar todo</button>
  </div>
{/if}

<!-- Barra de acciones masivas -->
{#if selectedIds.size > 0}
  <div class="flex items-center gap-2 flex-wrap mb-3 px-3 py-2 rounded-xl bg-brand-50 border border-brand-200">
    <span class="text-sm font-semibold text-brand-800 inline-flex items-center gap-1.5"><CheckSquare size={15} /> {selectedIds.size} seleccionada{selectedIds.size === 1 ? '' : 's'}</span>
    <button class="btn-secondary btn-sm flex items-center gap-1.5" on:click={bulkReminder} disabled={bulkBusy}><Send size={14} /> Recordatorio</button>
    <button class="btn-secondary btn-sm flex items-center gap-1.5" on:click={bulkLinks} disabled={bulkBusy}><Link2 size={14} /> Generar links</button>
    <button class="btn-secondary btn-sm flex items-center gap-1.5 !border-red-200 !text-red-600 hover:!bg-red-50" on:click={bulkDelete} disabled={bulkBusy}><Trash2 size={14} /> Eliminar</button>
    <button class="btn-ghost btn-sm" on:click={clearSelection} disabled={bulkBusy}>Deseleccionar</button>
    {#if bulkBusy}<span class="text-xs text-brand-700 inline-flex items-center gap-1"><Loader2 size={12} class="animate-spin" /> {bulkMsg}</span>{/if}
  </div>
{/if}

<div class="card overflow-hidden">
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          <th class="w-8 text-center">
            <input type="checkbox" class="align-middle" checked={allVisibleSelected} on:change={toggleAllVisible} title="Seleccionar visibles" />
          </th>
          <th class="text-right w-12 text-slate-400" title="Posición en la lista filtrada">#</th>
          <th>
            <button class="th-sort" class:th-active={sortBy==='invoiceNumber'} on:click={() => applySort('invoiceNumber')}>
              Número <svelte:component this={arrowFor('invoiceNumber')} size={12} class={sortBy==='invoiceNumber' ? '' : 'text-slate-300'} />
            </button>
          </th>
          <th>Cliente</th>
          <th>
            <button class="th-sort" class:th-active={sortBy==='issueDate'} on:click={() => applySort('issueDate')}>
              Emisión <svelte:component this={arrowFor('issueDate')} size={12} class={sortBy==='issueDate' ? '' : 'text-slate-300'} />
            </button>
          </th>
          <th>
            <button class="th-sort" class:th-active={sortBy==='dueDate'} on:click={() => applySort('dueDate')}>
              Vencimiento <svelte:component this={arrowFor('dueDate')} size={12} class={sortBy==='dueDate' ? '' : 'text-slate-300'} />
            </button>
          </th>
          <th class="text-right">
            <button class="th-sort justify-end w-full" class:th-active={sortBy==='amount'} on:click={() => applySort('amount')}>
              Subtotal <svelte:component this={arrowFor('amount')} size={12} class={sortBy==='amount' ? '' : 'text-slate-300'} />
            </button>
          </th>
          <th class="text-right">
            <button class="th-sort justify-end w-full" class:th-active={sortBy==='total'} on:click={() => applySort('total')}>
              Total <svelte:component this={arrowFor('total')} size={12} class={sortBy==='total' ? '' : 'text-slate-300'} />
            </button>
          </th>
          <th>
            <button class="th-sort" class:th-active={sortBy==='status'} on:click={() => applySort('status')}>
              Estado <svelte:component this={arrowFor('status')} size={12} class={sortBy==='status' ? '' : 'text-slate-300'} />
            </button>
          </th>
          <th>Pagada</th>
          <th class="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="11" class="py-16 text-center">
            <div class="flex items-center justify-center gap-2">
              <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-slate-500 text-sm">Cargando facturas...</span>
            </div>
          </td></tr>
        {:else if invoices.length === 0}
          <tr><td colspan="11" class="py-20 text-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <FileText size={28} class="text-slate-400" />
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-700">
                  {hasFilters ? 'Ninguna factura coincide con los filtros' : 'Aún no hay facturas'}
                </p>
              </div>
            </div>
          </td></tr>
        {:else}
          {#each invoices as inv, i}
            <tr class={selectedIds.has(inv.id) ? 'bg-brand-50/50' : ''}>
              <td class="text-center">
                <input type="checkbox" class="align-middle" checked={selectedIds.has(inv.id)} on:change={() => toggleRow(inv.id)} />
              </td>
              <td class="text-right text-xs text-slate-400 tabular-nums">{(page - 1) * pageSize + i + 1}</td>
              <td class="font-mono text-xs text-slate-700">{inv.invoiceNumber ?? '—'}</td>
              <td>
                <a href="/clients/{inv.client?.id}?from=/invoices" class="font-medium text-slate-900 hover:text-brand-800 transition-colors">
                  {inv.client?.name ?? '—'}
                </a>
                {#if inv.client?.documentNumber}
                  <div class="text-xs text-slate-400 mt-0.5">{inv.client.documentNumber}</div>
                {/if}
              </td>
              <td class="text-slate-600">{fmtDate(inv.issueDate)}</td>
              <td class="text-slate-600">{fmtDate(inv.dueDate)}</td>
              <td class="text-right font-mono text-xs text-slate-600">{fmtMoney(inv.amount)}</td>
              <td class="text-right font-mono text-xs font-semibold">{fmtMoney(inv.total)}</td>
              <td>
                <span class="{STATUS_CLS[inv.status] || 'badge-gray'}">{STATUS_PT[inv.status] || inv.status}</span>
                {#if daysOverdue(inv) > 0}
                  <span class="ml-1 text-[10px] font-semibold {daysOverdue(inv) > 30 ? 'text-red-700' : 'text-amber-600'}" title="Días en mora">· {daysOverdue(inv)}d</span>
                {/if}
              </td>
              <td>
                <div class="flex flex-col gap-1">
                  <span class="text-slate-600 text-xs">{fmtDate(inv.paidDate)}</span>
                  {#if invMethods(inv).length}
                    {@const ms = invMethods(inv)}
                    <span class="inline-flex items-center w-fit text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">
                      {METHOD_PT[ms[0]] || ms[0]}{ms.length > 1 ? ` +${ms.length - 1}` : ''}
                    </span>
                  {/if}
                </div>
              </td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  <a href="/invoices/{inv.id}" class="btn-icon" title="Ver">
                    <Eye size={14} />
                  </a>
                  {#if isPayable(inv)}
                    <button class="btn-icon hover:!text-emerald-600" title="Registrar pago" on:click={() => openPayRow(inv)}>
                      <CreditCard size={14} />
                    </button>
                  {/if}
                  {#if inv.status !== 'PAID'}
                    <button class="btn-icon" title="Editar" on:click={() => openEdit(inv)}>
                      <Pencil size={14} />
                    </button>
                  {/if}
                  <button class="btn-icon hover:!text-red-600" title="Eliminar" on:click={() => deleteInvoice(inv)}>
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

  {#if filteredTotals}
    <div class="px-5 py-2 border-t border-slate-100 bg-white flex items-center gap-x-5 gap-y-1 flex-wrap text-xs">
      <span class="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Totales del filtro</span>
      <span class="text-slate-500">Facturado <strong class="text-slate-800 tabular-nums">{fmtMoney(filteredTotals.billedAmount)}</strong></span>
      <span class="text-slate-500">Por cobrar <strong class="text-brand-800 tabular-nums">{fmtMoney(filteredTotals.outstandingAmount)}</strong></span>
      {#if filteredTotals.overdueAmount > 0}
        <span class="text-slate-500">Vencida <strong class="text-red-600 tabular-nums">{fmtMoney(filteredTotals.overdueAmount)}</strong></span>
      {/if}
    </div>
  {/if}

  <div class="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50/40 gap-3 flex-wrap">
    <div class="flex items-center gap-3 text-xs text-slate-500">
      <span>Mostrando {invoices.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}</span>
      <span class="inline-flex items-center gap-1.5">
        · Mostrar
        <select class="select !w-auto !min-h-0 py-1 pl-2 pr-7 text-xs" bind:value={pageSize} on:change={() => { page = 1; load(); }} title="Registros por página">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        por página
      </span>
    </div>
    <div class="flex items-center gap-1">
      <button class="btn-ghost text-xs py-1" disabled={page <= 1} on:click={() => setPage(page - 1)}>← Anterior</button>
      <span class="px-3 py-1 bg-brand-800 text-white text-xs rounded-md font-medium">{page} / {totalPages}</span>
      <button class="btn-ghost text-xs py-1" disabled={page >= totalPages} on:click={() => setPage(page + 1)}>Siguiente →</button>
    </div>
  </div>
</div>

<!-- ─── Modal Editar factura ───────────────────────────── -->
{#if editOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
       on:click|self={() => (editOpen = false)}>
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 class="font-semibold text-slate-900 flex items-center gap-2">
          <Pencil size={16} class="text-brand-600" /> Editar factura {editInv?.invoiceNumber || ''}
        </h3>
        <button class="btn-icon" on:click={() => (editOpen = false)} title="Cerrar"><X size={16} /></button>
      </div>
      <form on:submit|preventDefault={saveEdit} class="px-5 py-4 space-y-4">
        {#if editError}
          <div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
            <AlertCircle size={14} class="mt-0.5" /> <span>{editError}</span>
          </div>
        {/if}
        <div class="text-xs text-slate-500">
          Cliente: <span class="font-medium text-slate-700">{editInv?.client?.name ?? '—'}</span>
        </div>
        <div>
          <label for="edit-amount" class="label">Monto (COP)</label>
          <div class="flex">
            <span class="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 text-slate-700 text-sm font-mono">COP</span>
            <input id="edit-amount" type="number" min="0" step="500" bind:value={editForm.amount}
                   class="input flex-1 rounded-l-none font-mono" />
          </div>
          {#if editInv && (editInv.total ?? 0) !== (editInv.balanceDue ?? 0)}
            <p class="text-[11px] text-slate-500 mt-1">Esta factura tiene pagos parciales; el saldo pendiente se recalculará.</p>
          {/if}
        </div>
        <div>
          <label for="edit-due" class="label">Fecha de vencimiento</label>
          <input id="edit-due" type="date" bind:value={editForm.dueDate} class="input" />
        </div>
      </form>
      <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
        <button class="btn-secondary" on:click={() => (editOpen = false)} disabled={editSaving}>Cancelar</button>
        <button class="btn-primary" on:click={saveEdit} disabled={editSaving}>
          {#if editSaving}<Loader2 size={15} class="animate-spin" /> Guardando…{:else}<Save size={15} /> Guardar cambios{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Registrar pago desde la fila -->
{#if payModalOpen}
  <RegisterPaymentModal client={payClient} invoices={payInvoices} preselectInvoiceId={payPreselect}
    on:done={onPayDone} on:close={() => (payModalOpen = false)} />
{/if}

<style>
  /* Encabezados ordenables: heredan el estilo de la celda th de .data-table
     y solo agregan el layout del ícono + el color de marca en hover/activo. */
  .th-sort {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    cursor: pointer;
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    transition: color .12s;
  }
  .th-sort:hover { color: #16357E; }
  .th-active { color: #16357E; }
</style>
