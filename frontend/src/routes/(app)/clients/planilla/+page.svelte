<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { clientsApi } from '$lib/api/clients.api.js';
  import { plansApi } from '$lib/api/plans.api.js';
  import { evidenceApi } from '$lib/api/evidence.api.js';
  import {
    Search, Loader2, AlertCircle, Table2, RefreshCw, Wallet,
    Undo2, Redo2, CheckCircle2, XCircle, X, Banknote, Landmark, Ban, RotateCcw, Plus,
    Download, Upload, AlertTriangle, Pencil, Trash2, Send, Check,
    Mail, MessageSquare, Link2, Copy, ExternalLink, Camera, ArrowUp, ArrowDown, ArrowUpDown,
    Power, Wifi, Tag, ArrowRight, Clock, GripVertical
  } from 'lucide-svelte';

  // ── State ───────────────────────────────────────────
  /** @type {any[]} */
  let rows = [];
  let loading = true;
  let error = '';
  let q = '';
  /** Ordenamiento por IP. null = orden natural (por ID/nombre del backend). @type {null|'asc'|'desc'} */
  let ipSort = null;
  const NOW_YEAR = new Date().getFullYear();
  let year = NOW_YEAR;
  const YEARS = [NOW_YEAR + 1, NOW_YEAR, NOW_YEAR - 1, NOW_YEAR - 2];
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  // Editing bookkeeping
  let saving = {};          // key `${id}:${field}` -> true while a save is in flight
  let flashOk = {};         // key -> true briefly after a successful save
  /** @type {{id:string,field:string,oldVal:any,newVal:any}[]} */
  let undoStack = [];
  let redoStack = [];
  /** @type {{type:'ok'|'err'|'saving', msg:string}|null} */
  let status = null;
  let statusTimer;

  // ── Helpers ─────────────────────────────────────────
  const fmt = (cents) => '$' + Math.round((cents || 0) / 100).toLocaleString('es-CO');
  const norm = (s) => (s || '').toString().toLowerCase();
  const cop = (cents) => Math.round((cents || 0) / 100);   // cents -> COP integer
  const LABELS = { fullName:'nombre', name:'nombre', phone:'teléfono', email:'correo', monthlyFee:'mensualidad' };

  /** IPv4 → entero comparable (por octetos, no alfabético: .10 va después de .2). Vacías/invalidas al final. @param {any} ip */
  function ipKey(ip) {
    const parts = String(ip || '').trim().split('.');
    if (parts.length !== 4) return Number.POSITIVE_INFINITY;
    let n = 0;
    for (const p of parts) {
      const o = Number(p);
      if (!Number.isInteger(o) || o < 0 || o > 255) return Number.POSITIVE_INFINITY;
      n = n * 256 + o;
    }
    return n;
  }
  // Ciclo del encabezado IP: natural → ascendente → descendente → natural.
  function toggleIpSort() {
    ipSort = ipSort === 'asc' ? 'desc' : ipSort === 'desc' ? null : 'asc';
  }

  function cellState(m) {
    if (!m) return 'none';
    if (m.status === 'PAID') return 'paid';
    if (m.status === 'CANCELLED' || m.status === 'REFUNDED') return 'none';
    return 'owed';
  }

  function setStatus(type, msg) {
    status = { type, msg };
    clearTimeout(statusTimer);
    if (type !== 'saving') statusTimer = setTimeout(() => (status = null), 2500);
  }

  async function load() {
    loading = true; error = '';
    try { rows = await clientsApi.getSheet(year); }
    catch (e) { error = e?.message || 'No se pudo cargar la planilla'; }
    finally { loading = false; }
  }
  onMount(load);

  // ── Columnas redimensionables (arrastre + persistencia en localStorage) ──
  const COL_KEYS = ['cliente', 'ip', 'phone', 'email', 'monthlyFee', 'reminder'];
  const COL_DEFAULTS = { cliente: 360, ip: 120, phone: 130, email: 210, monthlyFee: 110, reminder: 150 };
  const COLW_KEY = 'planilla_col_widths_v2';
  /** @type {Record<string, number>} */
  let colWidths = { ...COL_DEFAULTS };
  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLW_KEY) || '{}');
      const merged = { ...COL_DEFAULTS };
      for (const k of COL_KEYS) if (Number.isFinite(saved?.[k])) merged[k] = saved[k];
      colWidths = merged;
    } catch { /* noop */ }
  });
  // Estilos reactivos por columna. IMPORTANTE: referenciar colWidths.X aquí
  // (no dentro de un helper) para que Svelte re-renderice al cambiar el ancho.
  /** @param {number} w */
  const wStyle = (w) => `width:${w}px;min-width:${w}px;max-width:${w}px`;
  $: styleCliente = wStyle(colWidths.cliente);
  $: styleIp      = `${wStyle(colWidths.ip)};left:${colWidths.cliente}px`;
  $: stylePhone   = wStyle(colWidths.phone);
  $: styleEmail   = wStyle(colWidths.email);
  $: styleFee     = wStyle(colWidths.monthlyFee);
  $: styleRem     = wStyle(colWidths.reminder);

  /** @type {{key:string,startX:number,startW:number}|null} */
  let colResizing = null;
  /** @param {MouseEvent} e @param {string} key */
  function startColResize(e, key) {
    e.preventDefault(); e.stopPropagation();
    colResizing = { key, startX: e.clientX, startW: colWidths[key] };
    window.addEventListener('mousemove', onColResizeMove);
    window.addEventListener('mouseup', endColResize);
    document.body.style.cursor = 'col-resize';
  }
  /** @param {MouseEvent} e */
  function onColResizeMove(e) {
    if (!colResizing) return;
    const w = Math.max(60, Math.min(700, colResizing.startW + (e.clientX - colResizing.startX)));
    colWidths = { ...colWidths, [colResizing.key]: w };
  }
  function endColResize() {
    if (!colResizing) return;
    colResizing = null;
    window.removeEventListener('mousemove', onColResizeMove);
    window.removeEventListener('mouseup', endColResize);
    document.body.style.cursor = '';
    try { localStorage.setItem(COLW_KEY, JSON.stringify(colWidths)); } catch { /* noop */ }
  }

  // ── Save / edit logic ───────────────────────────────
  function toPayload(field, val) {
    if (field === 'name')       return { fullName: val };
    if (field === 'monthlyFee') return { monthlyFee: val };  // already cents
    return { [field]: val };
  }

  /** Persist one field change. Optimistic: applies immediately, reverts on error. */
  async function applyChange(r, field, newVal, oldVal, pushUndo) {
    const key = `${r.id}:${field}`;
    saving = { ...saving, [key]: true };
    setStatus('saving', `Guardando ${LABELS[field]} de ${r.name}…`);
    // optimistic
    r[field] = newVal; rows = rows;
    try {
      await clientsApi.update(r.id, toPayload(field, newVal));
      if (pushUndo) { undoStack = [...undoStack, { id: r.id, field, oldVal, newVal }]; redoStack = []; }
      flashOk = { ...flashOk, [key]: true };
      setTimeout(() => { const f = { ...flashOk }; delete f[key]; flashOk = f; }, 1200);
      setStatus('ok', `Guardado: ${LABELS[field]} de ${r.name}`);
    } catch (e) {
      r[field] = oldVal; rows = rows;            // revert
      setStatus('err', e?.message || 'Error al guardar');
    } finally {
      const s = { ...saving }; delete s[key]; saving = s;
    }
  }

  /** Commit handler for text/number cells (on blur / Enter). */
  function commit(r, field, raw) {
    const oldVal = r[field];
    let newVal;
    if (field === 'monthlyFee') {
      const n = Number(String(raw).replace(/[^\d]/g, ''));
      newVal = Number.isFinite(n) ? Math.round(n) * 100 : oldVal;  // COP -> cents
    } else {
      newVal = (raw ?? '').toString().trim();
    }
    if (String(newVal) === String(oldVal)) return;       // no change → no PUT
    applyChange(r, field, newVal, oldVal, true);
  }

  // ── Mejora 1: conciliación de precio (modal al cambiar "Mensual") ─────
  // En vez de guardar el precio directo, abrimos un modal que: crea/asigna un
  // Plan a ese valor y re-liquida las facturas ABIERTAS (jamás las pagadas).
  /** @type {any} */
  let repriceModal = null;
  let repriceBusy = false;
  /** @type {any[]} */
  let allPlans = [];
  let plansLoaded = false;

  /** Blur del input de mensualidad → intercepta el cambio para conciliar. @param {Event} e @param {any} r */
  function onFeeBlur(e, r) {
    const el = /** @type {HTMLInputElement} */ (e.currentTarget);
    const n = Number(String(el.value).replace(/[^\d]/g, ''));
    const newCents = Number.isFinite(n) ? Math.round(n) * 100 : r.monthlyFee;
    if (!newCents || newCents === r.monthlyFee) { el.value = String(cop(r.monthlyFee)); return; }
    openReprice(r, r.monthlyFee, newCents, el);
  }

  /** @param {any} r @param {number} oldCents @param {number} newCents @param {HTMLInputElement} el */
  async function openReprice(r, oldCents, newCents, el) {
    const open = [];
    for (let m = 1; m <= 12; m++) {
      const c = r.months?.[m];
      if (c && ['PENDING', 'OVERDUE', 'PARTIAL'].includes(c.status)) {
        open.push({ month: m, invoiceId: c.invoiceId, amount: c.amount, balanceDue: c.balanceDue, status: c.status, checked: true });
      }
    }
    repriceModal = { r, el, oldCents, newCents, open, planAction: 'none', planId: '', newPlanName: '', existing: null, loadingPlans: true };
    repriceOpenedAt = Date.now();
    try { if (!plansLoaded) { allPlans = await plansApi.getAll(); plansLoaded = true; } }
    catch { allPlans = []; }
    const match = allPlans.find((p) => p.isActive !== false && (p.price === newCents || p.monthlyPrice === newCents));
    if (repriceModal) {
      repriceModal = {
        ...repriceModal,
        loadingPlans: false,
        existing: match || null,
        planAction: match ? 'attach' : 'create',
        planId: match ? match.id : '',
        newPlanName: `Plan $${cop(newCents).toLocaleString('es-CO')}`
      };
    }
  }

  // Momento de apertura del modal. El clic con el que el usuario "sale" del
  // input (blur) puede propagarse como click sobre el backdrop recién montado y
  // cerrarlo al instante. Ignoramos cierres por backdrop dentro de ~400ms.
  let repriceOpenedAt = 0;
  function closeReprice() {
    if (repriceBusy) return;
    if (repriceModal?.el) repriceModal.el.value = String(cop(repriceModal.r.monthlyFee)); // revertir display
    repriceModal = null;
  }
  function closeRepriceBackdrop() {
    if (Date.now() - repriceOpenedAt < 400) return; // evita el cierre por el clic que abrió el modal
    closeReprice();
  }

  async function applyReprice() {
    if (!repriceModal || repriceBusy) return;
    repriceBusy = true;
    const rm = repriceModal;
    const invoiceIds = rm.open.filter((/** @type {any} */ o) => o.checked).map((/** @type {any} */ o) => o.invoiceId);
    try {
      const d = await clientsApi.reprice(rm.r.id, {
        newFeeCents: rm.newCents,
        planAction: rm.planAction,
        ...(rm.planAction === 'attach' ? { planId: rm.planId } : {}),
        ...(rm.planAction === 'create' ? { newPlanName: rm.newPlanName } : {}),
        invoiceIds
      });
      const n = d?.reconciled?.length || 0;
      const sk = d?.skipped?.length || 0;
      setStatus('ok', `Precio conciliado · ${n} factura(s) actualizada(s)${sk ? ` · ${sk} omitida(s)` : ''}`);
      repriceBusy = false;
      repriceModal = null;
      plansLoaded = false; // por si se creó un plan nuevo
      await load();
    } catch (e) {
      repriceBusy = false;
      setStatus('err', /** @type {any} */ (e)?.message || 'No se pudo conciliar el precio');
    }
  }

  // ── Mejora 2: suspensión masiva OPERADA (nunca automática) ────────────
  // Flujo de 3 pasos: seleccionar → confirmar → consola en vivo por cliente
  // (reusa POST /clients/:id/suspend, que ya empuja al Mikrotik y devuelve el
  // detalle por paso). Cero cron / cero automatismo.
  /** @type {any} */
  let suspendModal = null;   // { mode:'suspend'|'aviso', step, items:[...], busy }
  $: suspIsAviso = suspendModal?.mode === 'aviso';
  $: suspIsActivate = suspendModal?.mode === 'activate';
  // #3: recurrencia del recordatorio (timeout de AvisoOK en el router).
  const AVISO_RECURRENCES = [
    { v: '1d', label: 'Una vez al día' },
    { v: '12h', label: 'Cada 12 horas' },
    { v: '8h', label: 'Cada 8 horas' },
    { v: '6h', label: 'Cada 6 horas' },
    { v: '4h', label: 'Cada 4 horas' },
    { v: '2h', label: 'Cada 2 horas' },
    { v: '1h', label: 'Cada hora' }
  ];
  let avisoRecurrence = '1d';

  // #4: sincronizar Client.status con la lista de corte real del router.
  let syncing = false;
  async function syncStatus() {
    if (syncing) return;
    syncing = true;
    setStatus('saving', 'Sincronizando estado con el router…');
    try {
      const d = await clientsApi.syncCollectionStatus();
      setStatus('ok', `Estado sincronizado · ${d?.setSuspended || 0} → suspendido · ${d?.setActive || 0} → activo`);
      await load();
    } catch (e) {
      setStatus('err', /** @type {any} */ (e)?.message || 'No se pudo sincronizar');
    } finally { syncing = false; }
  }

  /** @param {any} r */
  function isMora(r) {
    return Object.values(r.months || {}).some((/** @type {any} */ m) => m && m.status === 'OVERDUE');
  }
  /** ¿accionable en este modo? suspend: no suspendido · aviso: siempre · activate: solo suspendido. @param {any} it */
  function suspEligible(it) {
    const m = suspendModal?.mode;
    if (m === 'activate') return it.status === 'SUSPENDED';
    if (m === 'aviso') return true;
    return it.status !== 'SUSPENDED';
  }
  /** Meses adeudados (facturas abiertas del año). @param {any} r */
  function owedMonths(r) {
    return Object.values(r.months || {}).filter((/** @type {any} */ m) => m && ['PENDING', 'OVERDUE', 'PARTIAL'].includes(m.status)).length;
  }
  /** Construye el ítem del modal con la info de deuda. @param {any} r @param {boolean} checked */
  function mkSuspItem(r, checked) {
    return {
      id: r.id, name: r.name, ip: r.ip, status: r.status,
      mora: isMora(r), debtor: (r.totalDebt || 0) > 0,
      debtMonths: owedMonths(r), debt: r.totalDebt || 0,
      hasMk: !!r.ip, checked, run: null
    };
  }

  /** @param {'suspend'|'aviso'} [mode] */
  function openSuspend(mode = 'suspend') {
    const items = displayed.map((r) => mkSuspItem(r, mode === 'aviso' ? ((r.totalDebt || 0) > 0) : (isMora(r) && r.status !== 'SUSPENDED')));
    suspendModal = { mode, step: 'select', items, busy: false };
  }
  /** Acción individual desde una fila → abre el modal directo en "confirmar". @param {any} r @param {'suspend'|'aviso'|'activate'} mode */
  function openSuspendOne(r, mode) {
    suspendModal = { mode, step: 'confirm', items: [mkSuspItem(r, true)], busy: false };
  }
  function closeSuspend() { if (!suspendModal?.busy) suspendModal = null; }
  function suspendSelectMorosos() {
    if (!suspendModal) return;
    const av = suspendModal.mode === 'aviso';
    suspendModal.items = suspendModal.items.map((/** @type {any} */ it) => ({ ...it, checked: av ? it.debtor : (it.mora && it.status !== 'SUSPENDED') }));
    suspendModal = suspendModal;
  }
  /** @param {any} it */
  function toggleSuspendItem(it) {
    it.checked = !it.checked;
    suspendModal = suspendModal;
  }
  const sleep = (/** @type {number} */ ms) => new Promise((res) => setTimeout(res, ms));

  async function runSuspend() {
    if (!suspendModal) return;
    const av = suspendModal.mode === 'aviso';
    const act = suspendModal.mode === 'activate';
    const chosen = suspendModal.items.filter((/** @type {any} */ it) => it.checked && suspEligible(it));
    if (!chosen.length) return;
    suspendModal = { ...suspendModal, step: 'running', busy: true };
    for (const it of chosen) {
      it.run = { state: 'running', secret: 'wait', kick: 'wait', addressList: 'wait', error: null };
      suspendModal = suspendModal;
      await sleep(180); // pequeño escalonado para que se lea "en vivo"
      try {
        const d = av ? await clientsApi.aviso(it.id, { recurrence: avisoRecurrence }) : (act ? await clientsApi.activate(it.id) : await clientsApi.suspend(it.id));
        const mk = d?.mikrotik || {};
        if (av) {
          it.run.addressList = mk.addressList && !mk.addressList.error ? 'ok' : (mk.addressList?.error ? 'err' : 'skip');
          it.run.error = mk.error || null;
        } else if (act) {
          it.run.secret      = mk.secret && !mk.secret.error ? 'ok' : (mk.secret?.error ? 'err' : 'skip');
          it.run.addressList = mk.addressList && !mk.addressList.error ? 'ok' : (mk.addressList?.error ? 'err' : 'skip');
          it.run.error = mk.error || null;
          it.status = 'ACTIVE';
          const row = rows.find((x) => x.id === it.id); if (row) { row.status = 'ACTIVE'; }
        } else {
          it.run.secret      = mk.secret && !mk.secret.error ? 'ok' : (mk.secret?.error ? 'err' : 'skip');
          it.run.kick        = mk.kick && !mk.kick.error ? 'ok' : (mk.kick?.error ? 'err' : 'skip');
          it.run.addressList = mk.addressList && !mk.addressList.error && !mk.addressList.skipped ? 'ok'
                                : (mk.addressList?.error ? 'err' : 'skip');
          it.run.error = mk.error || null;
          it.status = 'SUSPENDED';
          const row = rows.find((x) => x.id === it.id); if (row) { row.status = 'SUSPENDED'; }
        }
        it.run.state = 'done';
      } catch (e) {
        it.run.state = 'fail';
        it.run.error = /** @type {any} */ (e)?.message || 'Error';
      }
      suspendModal = suspendModal;
      await sleep(120);
    }
    rows = rows;
    suspendModal = { ...suspendModal, step: 'done', busy: false };
  }

  $: suspendChosen = suspendModal ? suspendModal.items.filter((/** @type {any} */ it) => it.checked && suspEligible(it)) : [];
  $: suspendConsoleItems = suspendModal ? suspendModal.items.filter((/** @type {any} */ it) => it.checked && (it.run || suspEligible(it))) : [];
  $: suspendChosenCount = suspendChosen.length;
  $: suspendOkCount = suspendModal ? suspendModal.items.filter((/** @type {any} */ it) => it.run?.state === 'done' && !it.run?.error).length : 0;
  $: suspendFailCount = suspendModal ? suspendModal.items.filter((/** @type {any} */ it) => it.run?.state === 'fail' || (it.run?.state === 'done' && it.run?.error)).length : 0;
  /** @param {string} s */
  function stepIcon(s) { return s === 'ok' ? '✓' : s === 'err' ? '✗' : s === 'skip' ? '·' : '…'; }
  /** @param {string} s */
  function stepCls(s) { return s === 'err' ? 'text-red-600' : s === 'ok' ? 'text-green-600' : 'text-gray-400'; }

  async function undo() {
    const last = undoStack[undoStack.length - 1]; if (!last) return;
    const r = rows.find(x => x.id === last.id); if (!r) return;
    undoStack = undoStack.slice(0, -1);
    await applyChange(r, last.field, last.oldVal, last.newVal, false);
    redoStack = [...redoStack, last];
  }
  async function redo() {
    const last = redoStack[redoStack.length - 1]; if (!last) return;
    const r = rows.find(x => x.id === last.id); if (!r) return;
    redoStack = redoStack.slice(0, -1);
    await applyChange(r, last.field, last.newVal, last.oldVal, false);
    undoStack = [...undoStack, last];
  }

  // ── Month cell actions (money — modal-driven, NOT in the undo stack) ──
  /** @type {{r:any,m:number,cell:any,mode:string,method:string,amountCop:number}|null} */
  let cellModal = null;
  let cellBusy = false;

  // Foto de comprobante opcional para el registro de pago. Se sube a la evidencia
  // del cliente ligada al pago recién creado (paymentId que devuelve sheetCell).
  /** @type {File|null} */
  let payPhoto = null;
  let payPhotoUrl = '';
  /** @param {Event} e */
  function onPayPhoto(e) {
    const input = /** @type {HTMLInputElement} */ (e.currentTarget);
    const f = input.files?.[0];
    input.value = '';
    if (payPhotoUrl) URL.revokeObjectURL(payPhotoUrl);
    payPhoto = f || null;
    payPhotoUrl = f ? URL.createObjectURL(f) : '';
  }
  function clearPayPhoto() {
    if (payPhotoUrl) URL.revokeObjectURL(payPhotoUrl);
    payPhoto = null; payPhotoUrl = '';
  }

  function openCell(r, m, cell) {
    const st = cellState(cell);
    const prefill = cop((cell?.balanceDue || cell?.amount) || r.monthlyFee || 0);
    clearPayPhoto();
    cellModal = { r, m, cell, mode: 'menu', method: 'CASH', amountCop: prefill, st };
  }
  // Abre el modal de pago desde el botón de la fila (móvil-friendly): arranca en
  // el mes actual y desde el modal se puede elegir cualquier mes.
  /** @param {any} r */
  function openPayPicker(r) {
    const m = new Date().getMonth() + 1;
    openCell(r, m, r.months?.[m]);
  }
  /** @param {Event} e */
  function onCellMonthChange(e) { setCellMonth(Number(/** @type {HTMLSelectElement} */ (e.currentTarget).value)); }
  // Cambia el mes seleccionado dentro del modal (selector de mes).
  /** @param {number} m */
  function setCellMonth(m) {
    if (!cellModal) return;
    const r = /** @type {any} */ (cellModal.r);
    const cell = r.months?.[m];
    const st = cellState(cell);
    const prefill = cop((cell?.balanceDue || cell?.amount) || r.monthlyFee || 0);
    clearPayPhoto();
    cellModal = { ...cellModal, m, cell, st, mode: 'menu', amountCop: prefill };
  }
  function closeCell() { if (!cellBusy) { clearPayPhoto(); cellModal = null; } }

  async function doCell(action, extra = {}) {
    if (!cellModal) return;
    const { r, m } = cellModal;
    cellBusy = true;
    setStatus('saving', `Actualizando ${MONTHS[m - 1]} de ${r.name}…`);
    try {
      const resp = await clientsApi.sheetCell(r.id, { year, month: m, action, ...extra });
      if (resp.cell) r.months = { ...r.months, [m]: resp.cell };
      else { const mm = { ...r.months }; delete mm[m]; r.months = mm; }
      r.totalDebt = resp.totalDebt; rows = rows;

      // Adjuntar el comprobante al pago recién creado, si el usuario cargó una foto.
      if (action === 'pay' && payPhoto && resp.paymentId) {
        try {
          await evidenceApi.upload(r.id, [payPhoto], {
            type: 'payment', paymentId: resp.paymentId,
            description: `Comprobante de pago · ${MONTHS[m - 1]} ${year}`
          });
          setStatus('ok', `${MONTHS[m - 1]} de ${r.name} actualizado · foto adjunta`);
        } catch (/** @type {any} */ e) {
          // El pago YA quedó registrado; solo falló la foto. No revertimos.
          setStatus('err', `Pago guardado, pero la foto no se pudo subir: ${e?.message || 'error'}`);
        }
      } else {
        setStatus('ok', `${MONTHS[m - 1]} de ${r.name} actualizado`);
      }
      clearPayPhoto();
      cellModal = null;
    } catch (e) {
      setStatus('err', e?.message || 'No se pudo actualizar el mes');
    } finally { cellBusy = false; }
  }

  // ── Export to Excel (SheetJS, lazy-loaded) ──────────
  let exporting = false;
  function monthToken(cell) {
    const st = cellState(cell);
    return st === 'paid' ? 'P' : st === 'owed' ? 'D' : '';
  }
  async function exportXlsx() {
    exporting = true;
    setStatus('saving', 'Generando Excel…');
    try {
      const XLSX = await import('xlsx');
      const header = ['ID', 'Nombre', 'IP', 'Teléfono', 'Correo', 'Documento', 'Mensual', 'Cobro enviado', 'Medio cobro', ...MONTHS, 'Deuda total'];
      const data = displayed.map(r => [
        r.id, r.name, r.ip || '', r.phone || '', r.email || '', r.documentNumber || '', cop(r.monthlyFee),
        r.reminderSentAt ? new Date(r.reminderSentAt).toLocaleDateString('es-CO') : '', remLabel(r.reminderChannel),
        ...MONTHS.map((_, i) => monthToken(r.months[i + 1])),
        cop(r.totalDebt)
      ]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
      ws['!cols'] = [{ wch: 26 }, { wch: 24 }, { wch: 14 }, { wch: 13 }, { wch: 26 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
                     ...MONTHS.map(() => ({ wch: 5 })), { wch: 12 }];
      const help = XLSX.utils.aoa_to_sheet([
        ['Instrucciones para editar y reimportar'],
        [''],
        ['• NO cambies la columna ID — identifica al cliente al reimportar.'],
        ['• NO cambies la columna IP — es de solo lectura en el sistema.'],
        ['• Editables: Nombre, Teléfono, Correo, Documento, Mensual (en pesos).'],
        ['• Meses (Ene..Dic), valores aceptados:'],
        ['    P = pagado    E = pagado en efectivo    C = pagado por consignación'],
        ['    D = debe (factura abierta)    (vacío) = sin factura'],
        ['• Al reimportar verás un resumen de cambios antes de aplicar.']
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Planilla');
      XLSX.utils.book_append_sheet(wb, help, 'Instrucciones');
      XLSX.writeFile(wb, `planilla_clientes_${year}.xlsx`);
      setStatus('ok', `Excel generado (${data.length} clientes)`);
    } catch (e) {
      setStatus('err', 'No se pudo generar el Excel');
    } finally { exporting = false; }
  }

  // ── Import from Excel (parse → diff → preview → apply) ──────────────
  let fileInput;
  /** @type {{changes:any[],warnings:string[],notFound:string[],fileName:string}|null} */
  let importPreview = null;
  let importBusy = false;
  let importDone = 0;

  function normTok(v) {
    let t = (v == null ? '' : String(v)).trim().toUpperCase();
    if (t === 'PAGÓ' || t === 'PAGO') t = 'P';
    if (t === 'DEBE') t = 'D';
    return t;
  }

  function buildPreview(aoa) {
    const header = (aoa[0] || []).map(h => String(h).trim());
    const ix = (n) => header.indexOf(n);
    const c = { id: ix('ID'), name: ix('Nombre'), phone: ix('Teléfono'), email: ix('Correo'), doc: ix('Documento'), fee: ix('Mensual') };
    const monthCols = MONTHS.map(m => ix(m));
    const byId = new Map(rows.map(r => [r.id, r]));
    const changes = []; const warnings = []; const notFound = [];
    const s = (v) => (v == null ? '' : String(v).trim());

    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i]; if (!row || !row.length) continue;
      const id = s(row[c.id]); if (!id) continue;
      const r = byId.get(id); if (!r) { notFound.push(id); continue; }

      // Contact fields (one combined PUT per client). IP/ID never change.
      const payload = {}; const labels = [];
      if (c.name >= 0) { const v = s(row[c.name]); if (v && v !== s(r.name)) { payload.fullName = v; labels.push(`nombre → ${v}`); } }
      if (c.phone >= 0) { const v = s(row[c.phone]); if (v !== s(r.phone)) { payload.phone = v; labels.push(`teléfono → ${v || '(vacío)'}`); } }
      if (c.email >= 0) { const v = s(row[c.email]); if (v !== s(r.email)) { payload.email = v; labels.push(`correo → ${v || '(vacío)'}`); } }
      if (c.doc >= 0) { const v = s(row[c.doc]); if (v !== s(r.documentNumber)) { payload.documentNumber = v; labels.push(`documento → ${v || '(vacío)'}`); } }
      if (c.fee >= 0 && s(row[c.fee]) !== '') {
        const v = Number(String(row[c.fee]).replace(/[^\d]/g, ''));
        if (Number.isFinite(v) && v * 100 !== r.monthlyFee) { payload.monthlyFee = v * 100; labels.push(`mensual → $${v.toLocaleString('es-CO')}`); }
      }
      if (labels.length) changes.push({ type: 'contact', id, name: r.name, payload, labels });

      // Month tokens
      monthCols.forEach((ci, mi) => {
        if (ci < 0) return;
        const t = normTok(row[ci]);
        const cur = cellState(r.months[mi + 1]);
        const month = mi + 1, mn = MONTHS[mi];
        const add = (action, method, from, to) => changes.push({ type: 'month', id, name: r.name, month, mn, action, method, from, to });
        if (t === 'D') {
          if (cur === 'none') add('bill', null, '—', 'Debe');
          else if (cur === 'paid') add('unpay', null, 'Pagó', 'Debe');
        } else if (t === 'P' || t === 'E' || t === 'C') {
          if (cur === 'none' || cur === 'owed') add('pay', t === 'C' ? 'BANK_TRANSFER' : 'CASH', cur === 'owed' ? 'Debe' : '—', t === 'C' ? 'Pagó (consig.)' : 'Pagó (efect.)');
        } else if (t === '') {
          if (cur === 'owed') add('unbill', null, 'Debe', '—');
          else if (cur === 'paid') warnings.push(`${r.name} · ${mn}: está PAGADO; lo dejé igual (un vacío no revierte pagos — usa "D" o revierte manual).`);
        } else {
          warnings.push(`${r.name} · ${mn}: valor "${t}" no reconocido, ignorado.`);
        }
      });
    }
    return { changes, warnings, notFound, fileName: '' };
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    setStatus('saving', 'Leyendo Excel…');
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets['Planilla'] || wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      const pv = buildPreview(aoa); pv.fileName = file.name;
      importPreview = pv;
      if (!pv.changes.length) setStatus('ok', 'Sin cambios respecto a lo actual');
      else setStatus('ok', `${pv.changes.length} cambios detectados`);
    } catch (err) {
      setStatus('err', 'No se pudo leer el archivo Excel');
    }
  }

  async function applyImport() {
    if (!importPreview) return;
    importBusy = true; importDone = 0;
    const errs = [];
    const contacts = importPreview.changes.filter(x => x.type === 'contact');
    const months   = importPreview.changes.filter(x => x.type === 'month');
    // Contact first so monthlyFee is updated before month ops use it.
    for (const ch of contacts) {
      try { await clientsApi.update(ch.id, ch.payload); } catch (e) { errs.push(`${ch.name}: ${e?.message || 'error'}`); }
      importDone++;
    }
    for (const ch of months) {
      try { await clientsApi.sheetCell(ch.id, { year, month: ch.month, action: ch.action, ...(ch.method ? { method: ch.method } : {}) }); }
      catch (e) { errs.push(`${ch.name} ${ch.mn}: ${e?.message || 'error'}`); }
      importDone++;
    }
    importBusy = false;
    const total = contacts.length + months.length;
    setStatus(errs.length ? 'err' : 'ok', `Importación: ${total - errs.length}/${total} aplicados${errs.length ? ` · ${errs.length} con error` : ''}`);
    if (errs.length) console.warn('[import] errores:', errs);
    importPreview = null;
    await load();
  }

  // ── Delete client (with confirmation; cascades invoices + payments) ──
  /** @type {any|null} */
  let delRow = null;
  let delBusy = false;
  let delReason = '';
  let delNote = '';
  const REASONS = [
    { value: 'NO_PAGO', label: 'No pagó' },
    { value: 'SE_RETIRO', label: 'Se retiró / mudó' },
    { value: 'CANCELACION_VOLUNTARIA', label: 'Cancelación voluntaria' },
    { value: 'OTRO', label: 'Otro' }
  ];
  function askDelete(r) { delRow = r; delReason = ''; delNote = ''; }
  async function doDelete() {
    if (!delRow) return;
    const r = delRow;
    delBusy = true;
    setStatus('saving', `Eliminando ${r.name}…`);
    try {
      const res = await clientsApi.remove(r.id, { reasonCategory: delReason || undefined, reasonNote: delNote || undefined });
      rows = rows.filter(x => x.id !== r.id);
      const inv = res?.invoicesDeleted ?? 0, pay = res?.paymentsDeleted ?? 0;
      setStatus('ok', `${r.name} eliminado${(inv || pay) ? ` · ${inv} factura(s), ${pay} pago(s)` : ''}`);
      delRow = null;
    } catch (e) {
      setStatus('err', e?.message || 'No se pudo eliminar el cliente');
    } finally { delBusy = false; }
  }

  // ── Collection reminder (registrar mensaje de cobro) ────────────────
  // Canales de cobro habilitados actualmente. SMS se sumará más adelante.
  const REM_CHANNELS = [
    { value: 'WHATSAPP', label: 'WhatsApp' },
    { value: 'EMAIL', label: 'Email' }
  ];
  // Labels para mostrar (incluye canales no seleccionables aún, p.ej. registros previos).
  const REM_LABELS = { WHATSAPP: 'WhatsApp', EMAIL: 'Email', SMS: 'SMS', LLAMADA: 'Llamada', MANUAL: 'Manual' };
  // reminderChannel puede traer varios canales separados por coma (ej. "WHATSAPP,EMAIL").
  const remLabel = (ch) => (ch || '').split(',').filter(Boolean).map(x => REM_LABELS[x] || x).join(' · ');
  const fdateShort = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
  /** @type {{r:any, channels:string[], dateStr:string}|null} */
  let remModal = null;
  let remBusy = false;
  const VALID_CH = REM_CHANNELS.map(c => c.value);
  function openReminder(r) {
    const today = new Date().toISOString().slice(0, 10);
    const existing = (r.reminderChannel || '').split(',').filter(c => VALID_CH.includes(c));
    remModal = {
      r,
      channels: existing.length ? existing : ['WHATSAPP'],
      dateStr: r.reminderSentAt ? new Date(r.reminderSentAt).toISOString().slice(0, 10) : today
    };
  }
  function toggleChannel(value) {
    if (!remModal) return;
    const set = new Set(remModal.channels);
    set.has(value) ? set.delete(value) : set.add(value);
    remModal = { ...remModal, channels: VALID_CH.filter(v => set.has(v)) };
  }
  async function saveReminder() {
    if (!remModal) return;
    const { r, channels, dateStr } = remModal;
    remBusy = true;
    setStatus('saving', `Registrando cobro de ${r.name}…`);
    try {
      const sentAt = dateStr ? new Date(dateStr + 'T12:00:00').toISOString() : undefined;
      const res = await clientsApi.setReminder(r.id, { channels, sentAt });
      r.reminderSentAt = res.reminderSentAt; r.reminderChannel = res.reminderChannel; rows = rows;
      setStatus('ok', `Cobro registrado para ${r.name}`);
      remModal = null;
    } catch (e) { setStatus('err', e?.message || 'No se pudo registrar el cobro'); }
    finally { remBusy = false; }
  }
  async function clearReminder() {
    if (!remModal) return;
    const { r } = remModal;
    remBusy = true;
    try {
      const res = await clientsApi.setReminder(r.id, { channels: [] });
      r.reminderSentAt = res.reminderSentAt; r.reminderChannel = res.reminderChannel; rows = rows;
      setStatus('ok', `Cobro borrado de ${r.name}`);
      remModal = null;
    } catch (e) { setStatus('err', e?.message || 'No se pudo borrar'); }
    finally { remBusy = false; }
  }

  // ── Solicitar actualización de datos (mismo flujo que la ficha) ─────
  /** @type {{r:any, channels:string[], result:any}|null} */
  let updModal = null;
  let updBusy = false;
  let updUrlCopied = false;
  let updMsgCopied = false;
  function openUpdate(r) {
    updModal = {
      r,
      channels: [...(r.email ? ['EMAIL'] : []), ...(r.phone ? ['WHATSAPP'] : [])],
      result: null
    };
  }
  function toggleUpd(ch) {
    if (!updModal) return;
    const s = new Set(updModal.channels);
    s.has(ch) ? s.delete(ch) : s.add(ch);
    updModal = { ...updModal, channels: ['EMAIL', 'WHATSAPP'].filter(c => s.has(c)) };
  }
  async function genUpdate() {
    if (!updModal) return;
    updBusy = true;
    setStatus('saving', `Generando enlace para ${updModal.r.name}…`);
    try {
      const res = await clientsApi.requestUpdate(updModal.r.id, { sendChannels: updModal.channels, notifyChannels: [] });
      updModal = { ...updModal, result: res };
      setStatus('ok', `Enlace generado para ${updModal.r.name}`);
    } catch (e) { setStatus('err', e?.message || 'No se pudo generar el enlace'); }
    finally { updBusy = false; }
  }
  async function copyUpd(text, which) {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'url') { updUrlCopied = true; setTimeout(() => updUrlCopied = false, 1500); }
      else { updMsgCopied = true; setTimeout(() => updMsgCopied = false, 1500); }
    } catch (_) { /* clipboard unavailable */ }
  }

  function onKey(e) {
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;   // don't hijack native field editing
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
  }

  function inputCls(r, field) {
    const key = `${r.id}:${field}`;
    return 'cell-in' + (saving[key] ? ' is-saving' : '') + (flashOk[key] ? ' is-ok' : '');
  }

  // ── Derived ─────────────────────────────────────────
  $: filtered = !q.trim() ? rows : rows.filter(r => {
    const t = norm(q);
    return norm(r.name).includes(t) || norm(r.ip).includes(t) ||
           norm(r.email).includes(t) || norm(r.phone).includes(t) ||
           norm(r.documentNumber).includes(t);
  });
  // Orden de visualización: aplica el orden por IP sobre lo filtrado. Los totales
  // y conteos usan `filtered` (el orden no los cambia); la tabla y el export usan `displayed`.
  $: displayed = !ipSort ? filtered : [...filtered].sort((a, b) => {
    const ka = ipKey(a.ip), kb = ipKey(b.ip);
    const cmp = ka === kb ? norm(a.name).localeCompare(norm(b.name)) : ka - kb;
    return ipSort === 'asc' ? cmp : -cmp;
  });
  $: totalDebt = filtered.reduce((s, r) => s + (r.totalDebt || 0), 0);
  $: debtorCount = filtered.filter(r => (r.totalDebt || 0) > 0).length;
</script>

<svelte:head><title>Planilla de clientes · ISP Manager</title></svelte:head>
<svelte:window on:keydown={onKey} />

<div class="p-4 sm:p-6 space-y-4">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div class="flex items-center gap-2">
      <Table2 class="w-6 h-6 text-[#16357E]" />
      <div>
        <h1 class="text-xl font-bold text-gray-900">Planilla de clientes</h1>
        <p class="text-sm text-gray-500">Edición rápida · {filtered.length} clientes · año {year}</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
      <button on:click={undo} disabled={!undoStack.length}
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-2 text-sm hover:bg-gray-50 disabled:opacity-40" title="Deshacer (Ctrl+Z)">
        <Undo2 class="w-4 h-4" />
      </button>
      <button on:click={redo} disabled={!redoStack.length}
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-2 text-sm hover:bg-gray-50 disabled:opacity-40" title="Rehacer (Ctrl+Y)">
        <Redo2 class="w-4 h-4" />
      </button>
      <select bind:value={year} on:change={load}
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#16357E]/30">
        {#each YEARS as y}<option value={y}>{y}</option>{/each}
      </select>
      <button on:click={load}
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
        <RefreshCw class="w-4 h-4" /> Actualizar
      </button>
      <button on:click={exportXlsx} disabled={exporting || loading || !filtered.length}
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#16357E] text-white px-3 py-2 text-sm hover:bg-[#0f2860] disabled:opacity-50">
        {#if exporting}<Loader2 class="w-4 h-4 animate-spin" />{:else}<Download class="w-4 h-4" />{/if} Exportar Excel
      </button>
      <input type="file" accept=".xlsx,.xls" class="hidden" bind:this={fileInput} on:change={handleFile} />
      <button on:click={() => fileInput?.click()} disabled={loading}
              class="inline-flex items-center gap-1.5 rounded-lg border border-[#16357E] text-[#16357E] px-3 py-2 text-sm hover:bg-blue-50 disabled:opacity-50">
        <Upload class="w-4 h-4" /> Importar Excel
      </button>
      <button on:click={syncStatus} disabled={loading || syncing}
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              title="Sincronizar el estado (suspendido/activo) con la realidad del Mikrotik">
        {#if syncing}<Loader2 class="w-4 h-4 animate-spin" />{:else}<RefreshCw class="w-4 h-4" />{/if} Sincronizar
      </button>
      <button on:click={() => openSuspend('aviso')} disabled={loading || !filtered.length}
              class="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 text-amber-700 px-3 py-2 text-sm hover:bg-amber-50 disabled:opacity-50"
              title="Poner en aviso (recordatorio de pago) — no corta el servicio">
        <Clock class="w-4 h-4" /> Aviso…
      </button>
      <button on:click={() => openSuspend('suspend')} disabled={loading || !filtered.length}
              class="inline-flex items-center gap-1.5 rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm hover:bg-red-50 disabled:opacity-50"
              title="Suspender servicio de varios clientes (morosos) con confirmación">
        <Power class="w-4 h-4" /> Suspender…
      </button>
    </div>
  </div>

  <!-- Summary + search -->
  <div class="flex flex-col sm:flex-row sm:items-center gap-3">
    <div class="relative flex-1 max-w-md">
      <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
      <input bind:value={q} placeholder="Buscar nombre, IP, correo, teléfono, documento…"
             class="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-[#16357E]/30" />
    </div>
    <span class="inline-flex items-center gap-1.5 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-sm font-medium">
      <Wallet class="w-4 h-4" /> {debtorCount} deudores · {fmt(totalDebt)}
    </span>
  </div>

  <!-- Legend -->
  <div class="flex flex-wrap items-center gap-4 text-xs text-gray-500">
    <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-green-500"></span> Pagó</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-red-500"></span> Debe</span>
    <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-gray-200"></span> No facturado</span>
    <span class="text-gray-400">· Nombre, teléfono, correo y mensualidad se editan al instante (autosave). Clic en el encabezado <b>IP</b> para ordenar. Al registrar un pago puedes adjuntar el comprobante.</span>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20 text-gray-400">
      <Loader2 class="w-6 h-6 animate-spin" /> <span class="ml-2">Cargando planilla…</span>
    </div>
  {:else if error}
    <div class="flex items-center gap-2 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">
      <AlertCircle class="w-5 h-5" /> {error}
    </div>
  {:else}
    <!-- ── Vista móvil: tarjetas (sin scroll horizontal, targets grandes) ── -->
    <div class="sm:hidden space-y-2.5">
      {#each displayed as r (r.id)}
        <div class="rounded-xl border p-3 shadow-sm {r.status==='SUSPENDED' ? 'border-fuchsia-200 bg-fuchsia-50' : 'border-gray-200 bg-white'}">
          <div class="flex items-start justify-between gap-2">
            <button type="button" class="min-w-0 text-left"
                    on:click={() => goto(`/clients/${r.id}?from=/clients/planilla`)}>
              <div class="font-semibold text-gray-900 truncate">{r.name}</div>
              <div class="text-xs text-gray-400 truncate">
                {r.ip || 'sin IP'}{r.phone ? ' · ' + r.phone : ''}
              </div>
            </button>
            {#if r.totalDebt > 0}
              <span class="shrink-0 rounded-full bg-red-50 text-red-700 px-2.5 py-1 text-xs font-semibold">{fmt(r.totalDebt)}</span>
            {:else}
              <span class="shrink-0 rounded-full bg-green-50 text-green-700 px-2.5 py-1 text-xs font-medium">Al día</span>
            {/if}
          </div>

          <!-- Tira de 12 meses (táctil → abre modal de ese mes) -->
          <div class="mt-2.5 grid grid-cols-6 gap-1">
            {#each MONTHS as mo, i}
              {@const cell = r.months[i + 1]}
              {@const st = cellState(cell)}
              <button type="button" title="{mo}: {st === 'paid' ? 'Pagó' : st === 'owed' ? 'Debe' : 'Sin factura'}"
                      class="flex flex-col items-center rounded-md py-1 leading-tight
                             {st === 'paid' ? 'bg-green-100 text-green-700'
                               : st === 'owed' ? 'bg-red-100 text-red-700'
                               : 'bg-gray-50 text-gray-400'}"
                      on:click={() => openCell(r, i + 1, cell)}>
                <span class="text-[10px] font-medium">{mo}</span>
                <span class="text-[11px] font-semibold">{st === 'paid' ? '✓' : st === 'owed' ? '•' : '–'}</span>
              </button>
            {/each}
          </div>

          <!-- Acciones: botón verde prominente + utilidades -->
          <div class="mt-3 flex items-center gap-2">
            <button type="button"
                    class="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 text-white px-3 py-2.5 text-sm font-semibold hover:bg-green-700 active:scale-[0.98] transition"
                    on:click={() => openPayPicker(r)}>
              <Banknote class="w-4 h-4" /> Registrar pago
            </button>
            <button type="button" class="shrink-0 rounded-lg border border-amber-200 p-2.5 text-amber-500 hover:bg-amber-50" title="Poner en aviso" on:click={() => openSuspendOne(r, 'aviso')}><Clock class="w-4 h-4" /></button>
            {#if r.status==='SUSPENDED'}
              <button type="button" class="shrink-0 rounded-lg border border-emerald-300 p-2.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100" title="Reactivar servicio" on:click={() => openSuspendOne(r, 'activate')}><Power class="w-4 h-4" /></button>
            {:else}
              <button type="button" class="shrink-0 rounded-lg border border-red-200 p-2.5 text-red-500 hover:bg-red-50" title="Suspender servicio" on:click={() => openSuspendOne(r, 'suspend')}><Power class="w-4 h-4" /></button>
            {/if}
            <button type="button" class="shrink-0 rounded-lg border border-gray-200 p-2.5 text-slate-500 hover:bg-slate-100" title="Editar ficha" on:click={() => goto(`/clients/${r.id}?from=/clients/planilla`)}><Pencil class="w-4 h-4" /></button>
            <button type="button" class="shrink-0 rounded-lg border border-gray-200 p-2.5 text-gray-400 hover:text-red-600 hover:border-red-300" title="Eliminar" on:click={() => askDelete(r)}><Trash2 class="w-4 h-4" /></button>
          </div>
        </div>
      {/each}
      {#if displayed.length === 0}
        <div class="text-center py-10 text-gray-400 text-sm">Sin resultados</div>
      {/if}
    </div>

    <!-- ── Vista escritorio: planilla tipo Excel ── -->
    <div class="hidden sm:block overflow-auto border border-gray-200 rounded-lg bg-white max-h-[calc(100vh-280px)]">
      <table class="min-w-max text-sm border-collapse">
        <thead class="sticky top-0 z-20">
          <tr class="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <th class="sticky left-0 z-40 bg-gray-50 text-left px-3 py-2 border-b border-r border-gray-200" style={styleCliente}>
              <div class="flex items-center justify-between gap-1">
                <span>Cliente</span>
                <button type="button" class="cliente-grip shrink-0" title="Arrastrá para ampliar la columna Cliente"
                        on:mousedown={(e)=>startColResize(e,'cliente')}><GripVertical class="w-4 h-4" /></button>
              </div>
            </th>
            <th class="sticky z-30 bg-gray-50 text-left px-1 py-1 border-b border-r border-gray-200" style={styleIp}>
              <button type="button" on:click={toggleIpSort}
                      class="inline-flex items-center gap-1 px-2 py-1 rounded uppercase tracking-wide text-xs font-semibold
                             hover:bg-gray-200/70 {ipSort ? 'text-[#16357E]' : 'text-gray-600'}"
                      title="Ordenar por IP (asc/desc)">
                IP
                {#if ipSort === 'asc'}<ArrowUp class="w-3.5 h-3.5" />
                {:else if ipSort === 'desc'}<ArrowDown class="w-3.5 h-3.5" />
                {:else}<ArrowUpDown class="w-3.5 h-3.5 text-gray-400" />{/if}
              </button>
              <div class="col-resizer" role="separator" aria-orientation="vertical" title="Arrastrá para cambiar el ancho" on:mousedown={(e)=>startColResize(e,'ip')}></div>
            </th>
            <th class="relative text-left px-3 py-2 border-b border-gray-200" style={stylePhone}>Teléfono
              <div class="col-resizer" role="separator" aria-orientation="vertical" title="Arrastrá para cambiar el ancho" on:mousedown={(e)=>startColResize(e,'phone')}></div>
            </th>
            <th class="relative text-left px-3 py-2 border-b border-gray-200" style={styleEmail}>Correo
              <div class="col-resizer" role="separator" aria-orientation="vertical" title="Arrastrá para cambiar el ancho" on:mousedown={(e)=>startColResize(e,'email')}></div>
            </th>
            <th class="relative text-right px-3 py-2 border-b border-gray-200" style={styleFee}>Mensual
              <div class="col-resizer" role="separator" aria-orientation="vertical" title="Arrastrá para cambiar el ancho" on:mousedown={(e)=>startColResize(e,'monthlyFee')}></div>
            </th>
            <th class="relative text-left px-3 py-2 border-b border-l border-gray-200" style={styleRem}>Cobro enviado
              <div class="col-resizer" role="separator" aria-orientation="vertical" title="Arrastrá para cambiar el ancho" on:mousedown={(e)=>startColResize(e,'reminder')}></div>
            </th>
            <th class="text-center px-2 py-2 border-b border-l border-gray-200 min-w-[68px] leading-tight" title="Veces que el cliente cargó la página de SUSPENSIÓN">Vistas<br/>Susp.</th>
            <th class="text-center px-2 py-2 border-b border-l border-gray-200 min-w-[68px] leading-tight" title="Veces que el cliente cargó la página de AVISO">Vistas<br/>Aviso</th>
            {#each MONTHS as m}
              <th class="text-center px-2 py-2 border-b border-l border-gray-200 w-12">{m}</th>
            {/each}
            <th class="text-right px-3 py-2 border-b border-l border-gray-200 min-w-[110px]">Deuda total</th>
          </tr>
        </thead>
        <tbody>
          {#each displayed as r (r.id)}
            <tr class="border-b border-gray-100 {r.status==='SUSPENDED' ? 'bg-fuchsia-50/70 hover:bg-fuchsia-100/60' : 'hover:bg-blue-50/30'}">
              <!-- Name (editable) + acciones -->
              <td class="sticky left-0 z-10 px-2 py-1 border-r border-gray-200 {r.status==='SUSPENDED' ? 'bg-fuchsia-50' : 'bg-white'}" style={styleCliente}>
                <div class="flex items-center gap-0.5 min-w-0">
                  <input class="{inputCls(r,'name')} min-w-0" value={r.name}
                         on:focus={(e)=>e.target.select()}
                         on:keydown={(e)=>{ if(e.key==='Enter') e.target.blur(); if(e.key==='Escape'){ e.target.value=r.name; e.target.blur(); } }}
                         on:blur={(e)=>commit(r,'name',e.target.value)} />
                  <button class="shrink-0 rounded-md p-1 text-emerald-600 hover:bg-emerald-100 transition" title="Registrar pago (elegí el mes)"
                          on:click={() => openPayPicker(r)}><Banknote class="w-4 h-4" /></button>
                  <button class="shrink-0 rounded-md p-1 text-amber-500 hover:bg-amber-100 transition" title="Poner en aviso (recordatorio de pago)"
                          on:click={() => openSuspendOne(r, 'aviso')}><Clock class="w-4 h-4" /></button>
                  {#if r.status==='SUSPENDED'}
                    <button class="shrink-0 rounded-md p-1 text-emerald-600 bg-emerald-100/60 hover:bg-emerald-200 transition" title="Reactivar servicio"
                            on:click={() => openSuspendOne(r, 'activate')}><Power class="w-4 h-4" /></button>
                  {:else}
                    <button class="shrink-0 rounded-md p-1 text-red-500 hover:bg-red-100 transition" title="Suspender servicio"
                            on:click={() => openSuspendOne(r, 'suspend')}><Power class="w-4 h-4" /></button>
                  {/if}
                  <button class="shrink-0 rounded-md p-1 text-blue-500 hover:bg-blue-100 transition" title="Solicitar actualización de datos / enviar enlace"
                          on:click={() => openUpdate(r)}><Link2 class="w-4 h-4" /></button>
                  <button class="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-200 transition" title="Editar ficha completa"
                          on:click={() => goto(`/clients/${r.id}?from=/clients/planilla`)}><Pencil class="w-4 h-4" /></button>
                  <button class="shrink-0 rounded-md p-1 text-rose-500 hover:bg-rose-100 transition" title="Eliminar cliente"
                          on:click={() => askDelete(r)}><Trash2 class="w-4 h-4" /></button>
                </div>
              </td>
              <!-- IP (read-only) — columna fija junto a Cliente -->
              <td class="sticky z-10 bg-white px-3 py-2 text-gray-500 font-mono text-xs border-r border-gray-200 truncate" style={styleIp}>{r.ip || '—'}</td>
              <!-- Phone -->
              <td class="px-2 py-1" style={stylePhone}>
                <input class={inputCls(r,'phone')} value={r.phone || ''}
                       on:focus={(e)=>e.target.select()}
                       on:keydown={(e)=>{ if(e.key==='Enter') e.target.blur(); if(e.key==='Escape'){ e.target.value=r.phone||''; e.target.blur(); } }}
                       on:blur={(e)=>commit(r,'phone',e.target.value)} />
              </td>
              <!-- Email -->
              <td class="px-2 py-1" style={styleEmail}>
                <input class={inputCls(r,'email')} value={r.email || ''} type="email"
                       on:focus={(e)=>e.target.select()}
                       on:keydown={(e)=>{ if(e.key==='Enter') e.target.blur(); if(e.key==='Escape'){ e.target.value=r.email||''; e.target.blur(); } }}
                       on:blur={(e)=>commit(r,'email',e.target.value)} />
              </td>
              <!-- Monthly fee (COP) -->
              <td class="px-2 py-1" style={styleFee}>
                <input class="{inputCls(r,'monthlyFee')} text-right" value={cop(r.monthlyFee)} inputmode="numeric"
                       on:focus={(e)=>e.target.select()}
                       on:keydown={(e)=>{ if(e.key==='Enter') e.target.blur(); if(e.key==='Escape'){ e.target.value=cop(r.monthlyFee); e.target.blur(); } }}
                       on:blur={(e)=>onFeeBlur(e, r)} />
              </td>
              <!-- Collection reminder (clic → registrar) -->
              <td class="px-2 py-1 border-l border-gray-100" style={styleRem}>
                {#if r.reminderSentAt}
                  <button class="w-full inline-flex items-center gap-1.5 rounded bg-green-50 text-green-700 hover:bg-green-100 px-2 py-1 text-[11px] font-medium"
                          title="Editar registro de cobro" on:click={() => openReminder(r)}>
                    <Check class="w-3 h-3" /> {fdateShort(r.reminderSentAt)} · {remLabel(r.reminderChannel)}
                  </button>
                {:else}
                  <button class="w-full inline-flex items-center gap-1.5 rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 px-2 py-1 text-[11px]"
                          title="Registrar envío de cobro" on:click={() => openReminder(r)}>
                    <Send class="w-3 h-3" /> Registrar
                  </button>
                {/if}
              </td>
              <!-- Vistas del portal: suspensión / aviso -->
              <td class="text-center px-2 py-1 border-l border-gray-100">
                {#if (r.suspendedViews || 0) > 0}
                  <span class="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold tabular-nums"
                        title="Vio la página de suspensión {r.suspendedViews} {r.suspendedViews===1?'vez':'veces'} · última: {r.suspendedViewedAt ? fdateShort(r.suspendedViewedAt) : '—'}">{r.suspendedViews}</span>
                {:else}<span class="text-gray-300">—</span>{/if}
              </td>
              <td class="text-center px-2 py-1 border-l border-gray-100">
                {#if (r.avisoViews || 0) > 0}
                  <span class="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold tabular-nums"
                        title="Vio la página de aviso {r.avisoViews} {r.avisoViews===1?'vez':'veces'} · última: {r.avisoViewedAt ? fdateShort(r.avisoViewedAt) : '—'}">{r.avisoViews}</span>
                {:else}<span class="text-gray-300">—</span>{/if}
              </td>
              <!-- Months (clickable → action modal) -->
              {#each MONTHS as _m, i}
                {@const cell = r.months[i + 1]}
                {@const st = cellState(cell)}
                <td class="text-center px-1 py-1 border-l border-gray-100">
                  {#if st === 'paid'}
                    <button class="block w-full rounded bg-green-100 text-green-700 hover:bg-green-200 text-[11px] font-medium py-0.5" title="Pagó · {fmt(cell.amount)} · {cell.invoiceNumber} — clic para ajustar" on:click={() => openCell(r, i + 1, cell)}>✓</button>
                  {:else if st === 'owed'}
                    <button class="block w-full rounded bg-red-100 text-red-700 hover:bg-red-200 text-[11px] font-medium py-0.5" title="Debe · {fmt(cell.balanceDue || cell.amount)} · {cell.invoiceNumber} — clic para ajustar" on:click={() => openCell(r, i + 1, cell)}>{fmt(cell.balanceDue || cell.amount)}</button>
                  {:else}
                    <button class="block w-full rounded text-gray-300 hover:bg-gray-100 hover:text-gray-500 text-[11px] py-0.5" title="Sin factura — clic para registrar pago o deuda" on:click={() => openCell(r, i + 1, cell)}>—</button>
                  {/if}
                </td>
              {/each}
              <!-- Total debt (read-only) -->
              <td class="px-3 py-2 text-right font-semibold border-l border-gray-100"
                  class:text-red-600={r.totalDebt > 0} class:text-gray-400={!r.totalDebt}>
                {r.totalDebt > 0 ? fmt(r.totalDebt) : '—'}
              </td>
            </tr>
          {/each}
          {#if displayed.length === 0}
            <tr><td colspan={19} class="text-center py-10 text-gray-400">Sin resultados</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Month action modal -->
{#if cellModal}
  {@const cm = cellModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" on:click={closeCell} on:keydown={(e)=>e.key==='Escape'&&closeCell()} role="presentation">
    <div class="w-full max-w-sm rounded-xl bg-white shadow-xl" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div class="min-w-0">
          <h3 class="font-semibold text-gray-900 truncate">{cm.r.name}</h3>
          <div class="mt-1 flex items-center gap-1.5">
            <span class="text-[11px] text-gray-400">Mes:</span>
            <select class="text-xs text-gray-700 border border-gray-200 rounded px-1.5 py-1 focus:ring-2 focus:ring-[#16357E]/30"
                    value={cm.m} on:change={onCellMonthChange} disabled={cellBusy}>
              {#each MONTHS as mo, i}<option value={i + 1}>{mo} {year}</option>{/each}
            </select>
          </div>
        </div>
        <button class="text-gray-400 hover:text-gray-700 shrink-0" on:click={closeCell} disabled={cellBusy}><X class="w-5 h-5" /></button>
      </div>

      <div class="px-4 py-3 space-y-3">
        <!-- current state -->
        <div class="text-sm">
          {#if cm.st === 'paid'}
            <span class="inline-flex items-center gap-1.5 text-green-700"><CheckCircle2 class="w-4 h-4" /> Pagado · {fmt(cm.cell.amount)} · {cm.cell.invoiceNumber}</span>
          {:else if cm.st === 'owed'}
            <span class="inline-flex items-center gap-1.5 text-red-700"><Wallet class="w-4 h-4" /> Debe {fmt(cm.cell.balanceDue || cm.cell.amount)} · {cm.cell.invoiceNumber}</span>
          {:else}
            <span class="text-gray-500">Sin factura para este mes</span>
          {/if}
        </div>

        {#if cm.mode === 'menu'}
          <div class="grid gap-2">
            {#if cm.st !== 'paid'}
              <button class="btn-primary" on:click={() => cellModal = { ...cm, mode: 'pay' }}>
                <Banknote class="w-4 h-4" /> Registrar pago
              </button>
            {/if}
            {#if cm.st === 'none'}
              <button class="btn-ghost" on:click={() => cellModal = { ...cm, mode: 'bill' }}>
                <Plus class="w-4 h-4" /> Marcar deuda (crear factura)
              </button>
            {/if}
            {#if cm.st === 'owed'}
              <button class="btn-danger" on:click={() => cellModal = { ...cm, mode: 'unbill' }}>
                <Ban class="w-4 h-4" /> Quitar (cancelar factura)
              </button>
            {/if}
            {#if cm.st === 'paid'}
              <button class="btn-danger" on:click={() => cellModal = { ...cm, mode: 'unpay' }}>
                <RotateCcw class="w-4 h-4" /> Revertir pago (volver a deuda)
              </button>
            {/if}
          </div>

        {:else if cm.mode === 'pay'}
          <div class="space-y-2">
            <label class="block text-xs font-medium text-gray-600">Método</label>
            <div class="grid grid-cols-2 gap-2">
              <button class="seg {cm.method==='CASH'?'seg-on':''}" on:click={() => cellModal = { ...cm, method: 'CASH' }}><Banknote class="w-4 h-4" /> Efectivo</button>
              <button class="seg {cm.method==='BANK_TRANSFER'?'seg-on':''}" on:click={() => cellModal = { ...cm, method: 'BANK_TRANSFER' }}><Landmark class="w-4 h-4" /> Consignación</button>
            </div>
            <label class="block text-xs font-medium text-gray-600 mt-2">Monto (COP)</label>
            <input type="number" min="0" bind:value={cellModal.amountCop} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#16357E]/30" />

            <!-- Comprobante (opcional): foto que se adjunta al pago -->
            <label class="block text-xs font-medium text-gray-600 mt-2">Comprobante (opcional)</label>
            {#if payPhotoUrl}
              <div class="flex items-center gap-2 rounded-lg border border-gray-200 p-2">
                <img src={payPhotoUrl} alt="Comprobante" class="w-12 h-12 rounded object-cover border border-gray-200" />
                <span class="text-xs text-gray-500 truncate flex-1">{payPhoto?.name}</span>
                <button type="button" class="text-gray-400 hover:text-red-600" on:click={clearPayPhoto} title="Quitar foto" disabled={cellBusy}><X class="w-4 h-4" /></button>
              </div>
            {:else}
              <label class="flex items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 cursor-pointer hover:bg-gray-50">
                <Camera class="w-4 h-4" /> Adjuntar foto
                <input type="file" accept="image/*" class="hidden" on:change={onPayPhoto} />
              </label>
            {/if}

            <div class="flex gap-2 pt-1">
              <button class="btn-ghost flex-1" on:click={() => cellModal = { ...cm, mode: 'menu' }} disabled={cellBusy}>Atrás</button>
              <button class="btn-primary flex-1" on:click={() => doCell('pay', { method: cm.method, amount: Math.round((cm.amountCop || 0) * 100) })} disabled={cellBusy || !(cm.amountCop > 0)}>
                {#if cellBusy}<Loader2 class="w-4 h-4 animate-spin" />{:else}Confirmar pago{/if}
              </button>
            </div>
          </div>

        {:else if cm.mode === 'bill'}
          <div class="space-y-2">
            <p class="text-sm text-gray-600">Crear factura de deuda para este mes.</p>
            <label class="block text-xs font-medium text-gray-600">Monto (COP)</label>
            <input type="number" min="0" bind:value={cellModal.amountCop} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#16357E]/30" />
            <div class="flex gap-2 pt-1">
              <button class="btn-ghost flex-1" on:click={() => cellModal = { ...cm, mode: 'menu' }} disabled={cellBusy}>Atrás</button>
              <button class="btn-primary flex-1" on:click={() => doCell('bill', { amount: Math.round((cm.amountCop || 0) * 100) })} disabled={cellBusy || !(cm.amountCop > 0)}>
                {#if cellBusy}<Loader2 class="w-4 h-4 animate-spin" />{:else}Crear factura{/if}
              </button>
            </div>
          </div>

        {:else if cm.mode === 'unbill'}
          <div class="space-y-2">
            <p class="text-sm text-gray-600">Se <b>cancelará</b> la factura de este mes (deja de contar como deuda). Reversible: puedes volver a marcar deuda después.</p>
            <div class="flex gap-2 pt-1">
              <button class="btn-ghost flex-1" on:click={() => cellModal = { ...cm, mode: 'menu' }} disabled={cellBusy}>Atrás</button>
              <button class="btn-danger flex-1" on:click={() => doCell('unbill')} disabled={cellBusy}>
                {#if cellBusy}<Loader2 class="w-4 h-4 animate-spin" />{:else}Sí, cancelar{/if}
              </button>
            </div>
          </div>

        {:else if cm.mode === 'unpay'}
          <div class="space-y-2">
            <p class="text-sm text-gray-600">Se <b>eliminará el pago</b> registrado y el mes volverá a quedar como <b>deuda</b>. Úsalo solo para corregir un error.</p>
            <div class="flex gap-2 pt-1">
              <button class="btn-ghost flex-1" on:click={() => cellModal = { ...cm, mode: 'menu' }} disabled={cellBusy}>Atrás</button>
              <button class="btn-danger flex-1" on:click={() => doCell('unpay')} disabled={cellBusy}>
                {#if cellBusy}<Loader2 class="w-4 h-4 animate-spin" />{:else}Sí, revertir pago{/if}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Import preview modal -->
{#if importPreview}
  {@const pv = importPreview}
  {@const contactN = pv.changes.filter(c => c.type === 'contact').length}
  {@const billN = pv.changes.filter(c => c.action === 'bill').length}
  {@const payN = pv.changes.filter(c => c.action === 'pay').length}
  {@const unbillN = pv.changes.filter(c => c.action === 'unbill').length}
  {@const unpayN = pv.changes.filter(c => c.action === 'unpay').length}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" on:click={() => !importBusy && (importPreview = null)} on:keydown={(e)=>e.key==='Escape'&&!importBusy&&(importPreview=null)} role="presentation">
    <div class="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-white shadow-xl" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div>
          <h3 class="font-semibold text-gray-900">Previsualizar importación</h3>
          <p class="text-xs text-gray-500 truncate max-w-[400px]">{pv.fileName}</p>
        </div>
        <button class="text-gray-400 hover:text-gray-700" on:click={() => importPreview = null} disabled={importBusy}><X class="w-5 h-5" /></button>
      </div>

      <!-- Summary chips -->
      <div class="flex flex-wrap gap-2 px-5 py-3 text-xs border-b border-gray-100">
        <span class="rounded-full bg-blue-50 text-blue-700 px-2.5 py-1">{contactN} contacto</span>
        <span class="rounded-full bg-amber-50 text-amber-700 px-2.5 py-1">{billN} a facturar</span>
        <span class="rounded-full bg-green-50 text-green-700 px-2.5 py-1">{payN} a pagar</span>
        <span class="rounded-full bg-gray-100 text-gray-700 px-2.5 py-1">{unbillN} a quitar</span>
        <span class="rounded-full bg-red-50 text-red-700 px-2.5 py-1">{unpayN} a revertir</span>
        {#if pv.warnings.length}<span class="rounded-full bg-orange-100 text-orange-800 px-2.5 py-1">{pv.warnings.length} advertencias</span>{/if}
        {#if pv.notFound.length}<span class="rounded-full bg-gray-100 text-gray-500 px-2.5 py-1">{pv.notFound.length} no encontrados</span>{/if}
      </div>

      <!-- Detail list -->
      <div class="flex-1 overflow-auto px-5 py-3 space-y-1 text-sm">
        {#if pv.changes.length === 0}
          <p class="text-gray-500 py-6 text-center">No hay cambios respecto al estado actual.</p>
        {/if}
        {#each pv.changes as ch}
          {#if ch.type === 'contact'}
            <div class="flex items-start gap-2 py-1 border-b border-gray-50">
              <span class="shrink-0 rounded bg-blue-100 text-blue-700 text-[10px] px-1.5 py-0.5 mt-0.5">CONTACTO</span>
              <span class="font-medium text-gray-800">{ch.name}</span>
              <span class="text-gray-500">{ch.labels.join(' · ')}</span>
            </div>
          {:else}
            <div class="flex items-center gap-2 py-1 border-b border-gray-50">
              <span class="shrink-0 rounded text-[10px] px-1.5 py-0.5
                {ch.action==='pay'?'bg-green-100 text-green-700':ch.action==='bill'?'bg-amber-100 text-amber-700':ch.action==='unpay'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-600'}">
                {ch.mn.toUpperCase()}
              </span>
              <span class="font-medium text-gray-800">{ch.name}</span>
              <span class="text-gray-500">{ch.from} → {ch.to}</span>
            </div>
          {/if}
        {/each}

        {#if pv.warnings.length}
          <div class="mt-3 rounded-lg bg-orange-50 p-3 space-y-1">
            <p class="flex items-center gap-1.5 text-orange-800 font-medium text-xs"><AlertTriangle class="w-4 h-4" /> Advertencias (no se aplican)</p>
            {#each pv.warnings as w}<p class="text-xs text-orange-700">{w}</p>{/each}
          </div>
        {/if}
        {#if pv.notFound.length}
          <p class="mt-2 text-xs text-gray-400">No encontrados (ID sin coincidencia): {pv.notFound.join(', ')}</p>
        {/if}
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100">
        <span class="text-xs text-gray-400">IP e ID nunca se modifican.</span>
        <div class="flex gap-2">
          <button class="btn-ghost" on:click={() => importPreview = null} disabled={importBusy}>Cancelar</button>
          <button class="btn-primary" on:click={applyImport} disabled={importBusy || !pv.changes.length}>
            {#if importBusy}<Loader2 class="w-4 h-4 animate-spin" /> Aplicando {importDone}/{pv.changes.length}
            {:else}Aplicar {pv.changes.length} cambios{/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Delete confirmation modal -->
{#if delRow}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" on:click={() => !delBusy && (delRow = null)} on:keydown={(e)=>e.key==='Escape'&&!delBusy&&(delRow=null)} role="presentation">
    <div class="w-full max-w-sm rounded-xl bg-white shadow-xl" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <div class="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center"><Trash2 class="w-4 h-4 text-red-600" /></div>
        <div>
          <h3 class="font-semibold text-gray-900">Eliminar cliente</h3>
          <p class="text-xs text-gray-500">No se puede deshacer</p>
        </div>
      </div>
      <div class="px-4 py-3 space-y-3">
        <p class="text-sm text-gray-700">Vas a eliminar a <b>{delRow.name}</b>.</p>
        <div class="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
          <AlertTriangle class="w-4 h-4 shrink-0 mt-0.5" />
          <span>Se eliminarán también <b>todas sus facturas y pagos</b>{#if delRow.totalDebt > 0} (deuda actual {fmt(delRow.totalDebt)}){/if}. Quedará registrado en <b>Clientes eliminados</b>.</span>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Motivo</label>
          <select bind:value={delReason} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#16357E]/30">
            <option value="">— Sin especificar —</option>
            {#each REASONS as opt}<option value={opt.value}>{opt.label}</option>{/each}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Nota (opcional)</label>
          <input bind:value={delNote} maxlength="500" placeholder="Detalle del motivo…"
                 class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#16357E]/30" />
        </div>
        <div class="flex gap-2 pt-1">
          <button class="btn-ghost flex-1" on:click={() => delRow = null} disabled={delBusy}>Cancelar</button>
          <button class="btn-danger flex-1" on:click={doDelete} disabled={delBusy}>
            {#if delBusy}<Loader2 class="w-4 h-4 animate-spin" /> Eliminando…{:else}Sí, eliminar{/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Collection reminder modal -->
{#if remModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" on:click={() => !remBusy && (remModal = null)} on:keydown={(e)=>e.key==='Escape'&&!remBusy&&(remModal=null)} role="presentation">
    <div class="w-full max-w-sm rounded-xl bg-white shadow-xl" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h3 class="font-semibold text-gray-900">Registrar cobro</h3>
          <p class="text-xs text-gray-500">{remModal.r.name}</p>
        </div>
        <button class="text-gray-400 hover:text-gray-700" on:click={() => remModal = null} disabled={remBusy}><X class="w-5 h-5" /></button>
      </div>
      <div class="px-4 py-3 space-y-3">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1.5">¿Por qué medio(s) se envió?</label>
          <div class="grid grid-cols-2 gap-2">
            {#each REM_CHANNELS as opt}
              <button type="button" on:click={() => toggleChannel(opt.value)}
                      class="inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition
                             {remModal.channels.includes(opt.value) ? 'border-[#16357E] bg-[#eef2ff] text-[#16357E] font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}">
                {#if remModal.channels.includes(opt.value)}<Check class="w-4 h-4" />{/if} {opt.label}
              </button>
            {/each}
          </div>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Fecha de envío</label>
          <input type="date" bind:value={remModal.dateStr} class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-[#16357E]/30" />
        </div>
        <div class="flex gap-2 pt-1">
          {#if remModal.r.reminderSentAt}
            <button class="btn-ghost" on:click={clearReminder} disabled={remBusy} title="Borrar registro">Quitar</button>
          {/if}
          <button class="btn-ghost flex-1" on:click={() => remModal = null} disabled={remBusy}>Cancelar</button>
          <button class="btn-primary flex-1" on:click={saveReminder} disabled={remBusy || !remModal.channels.length || !remModal.dateStr}>
            {#if remBusy}<Loader2 class="w-4 h-4 animate-spin" />{:else}Guardar{/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Solicitar actualización de datos modal -->
{#if updModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" on:click={() => !updBusy && (updModal = null)} on:keydown={(e)=>e.key==='Escape'&&!updBusy&&(updModal=null)} role="presentation">
    <div class="w-full max-w-lg max-h-[88vh] flex flex-col rounded-xl bg-white shadow-xl" on:click|stopPropagation role="dialog" aria-modal="true">
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div>
          <h3 class="font-semibold text-gray-900">Solicitar actualización de datos</h3>
          <p class="text-xs text-gray-500">{updModal.r.name}</p>
        </div>
        <button class="text-gray-400 hover:text-gray-700" on:click={() => updModal = null} disabled={updBusy}><X class="w-5 h-5" /></button>
      </div>

      <div class="flex-1 overflow-auto px-5 py-4 space-y-4">
        {#if !updModal.result}
          <!-- Paso 1: canales -->
          <p class="text-sm text-gray-600">Genera un enlace de un solo uso (vence en 7 días) para que el cliente actualice sus datos y, si debe, pueda pagar.</p>
          <div>
            <div class="text-xs font-medium text-gray-600 mb-2">Enviar al cliente vía</div>
            <div class="space-y-2">
              {#each [['EMAIL','Email'],['WHATSAPP','WhatsApp']] as [ch,label]}
                {@const disabled = (ch==='EMAIL' && !updModal.r.email) || (ch==='WHATSAPP' && !updModal.r.phone)}
                <button type="button" disabled={disabled} on:click={() => toggleUpd(ch)}
                        class="w-full flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition
                               {updModal.channels.includes(ch) ? 'border-[#16357E] bg-[#eef2ff]' : 'border-gray-300 hover:bg-gray-50'}
                               {disabled ? 'opacity-50 cursor-not-allowed' : ''}">
                  {#if updModal.channels.includes(ch)}<Check class="w-4 h-4 text-[#16357E]" />{:else}<span class="w-4 h-4"></span>{/if}
                  {#if ch==='EMAIL'}<Mail class="w-4 h-4 text-gray-500" />{:else}<MessageSquare class="w-4 h-4 text-emerald-600" />{/if}
                  <span class="font-medium text-gray-800">{label}</span>
                  {#if disabled}<span class="ml-auto text-xs text-gray-400">{ch==='EMAIL' ? 'sin email' : 'sin teléfono'}</span>{/if}
                </button>
              {/each}
            </div>
            <p class="mt-2 text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-2">
              <b>Manual:</b> no marques ningún canal y, al generar, copia el enlace/mensaje para enviarlo tú mismo.
            </p>
          </div>
        {:else}
          {@const disp = updModal.result.dispatch || {}}
          <!-- Paso 2: resultado -->
          <div class="flex items-center gap-2 rounded-lg bg-green-50 text-green-800 px-3 py-2 text-sm">
            <Check class="w-4 h-4" /> Enlace generado — vence el {new Date(updModal.result.expiresAt).toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'})}
          </div>
          <!-- Estado de envío -->
          {#if disp.EMAIL || disp.WHATSAPP}
            <div class="space-y-1.5">
              {#if disp.EMAIL?.ok}
                <div class="flex items-center gap-1.5 text-sm text-green-700"><Check class="w-4 h-4" /> Correo <b>enviado</b> a {updModal.r.email}</div>
              {:else if disp.EMAIL}
                <div class="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle class="w-4 h-4" /> Email no enviado: {disp.EMAIL.error}</div>
              {/if}
              {#if disp.WHATSAPP?.ok}
                <div class="flex items-center gap-1.5 text-sm text-green-700"><Check class="w-4 h-4" /> WhatsApp <b>enviado</b> por la API</div>
              {:else if disp.WHATSAPP}
                <div class="flex items-center gap-1.5 text-sm text-amber-700"><AlertTriangle class="w-4 h-4" /> WhatsApp no enviado: {disp.WHATSAPP.error} — usa "Abrir WhatsApp Web" abajo</div>
              {/if}
            </div>
          {:else}
            <div class="flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600">
              <Send class="w-4 h-4 shrink-0 mt-0.5" /> <span><b>Modo manual:</b> no se envió nada automáticamente. Copia el enlace/mensaje y envíalo tú.</span>
            </div>
          {/if}
          <!-- URL -->
          <div>
            <div class="text-xs font-medium text-gray-600 mb-1">URL pública (un solo uso)</div>
            <div class="flex gap-2">
              <input readonly value={updModal.result.publicUrl} class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono" />
              <button class="btn-ghost" on:click={() => copyUpd(updModal.result.publicUrl,'url')}>{#if updUrlCopied}<Check class="w-4 h-4 text-green-600" />{:else}<Copy class="w-4 h-4" />{/if}</button>
            </div>
          </div>
          <!-- WhatsApp -->
          {#if updModal.result.whatsappMessage}
            <div>
              <div class="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5"><MessageSquare class="w-3.5 h-3.5 text-emerald-600" /> Mensaje de WhatsApp {disp.WHATSAPP?.ok ? '(enviado)' : '(para enviar manual)'}</div>
              <textarea readonly rows="7" class="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono leading-relaxed resize-none">{updModal.result.whatsappMessage}</textarea>
              <div class="flex gap-2 mt-2">
                <button class="btn-ghost" on:click={() => copyUpd(updModal.result.whatsappMessage,'msg')}>{#if updMsgCopied}<Check class="w-4 h-4 text-green-600" /> Copiado{:else}<Copy class="w-4 h-4" /> Copiar mensaje{/if}</button>
                {#if updModal.result.whatsappWebUrl}
                  <a href={updModal.result.whatsappWebUrl} target="_blank" rel="noopener" class="btn-primary !bg-emerald-600 hover:!bg-emerald-700"><ExternalLink class="w-4 h-4" /> Abrir WhatsApp Web</a>
                {/if}
              </div>
            </div>
          {/if}
          <!-- Email preview -->
          {#if updModal.result.emailHtml}
            <div>
              <div class="text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5"><Mail class="w-3.5 h-3.5 text-gray-500" /> {disp.EMAIL?.ok ? 'Correo enviado (vista del mensaje)' : 'Correo — previsualización (no enviado)'}</div>
              <div class="rounded-lg border border-gray-200 overflow-hidden bg-white">
                <iframe title="Previsualización del correo" srcdoc={updModal.result.emailHtml} class="w-full" style="height:300px;border:0;" sandbox=""></iframe>
              </div>
              <p class="text-xs text-gray-400 mt-1">Asunto: {updModal.result.emailSubject}</p>
            </div>
          {/if}
        {/if}
      </div>

      <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
        {#if !updModal.result}
          <button class="btn-ghost" on:click={() => updModal = null} disabled={updBusy}>Cancelar</button>
          <button class="btn-primary" on:click={genUpdate} disabled={updBusy}>
            {#if updBusy}<Loader2 class="w-4 h-4 animate-spin" /> Generando…{:else}<Link2 class="w-4 h-4" /> Generar enlace{/if}
          </button>
        {:else}
          <button class="btn-primary" on:click={() => updModal = null}>Listo</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Status pill -->
{#if status}
  <div class="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm shadow-lg
              {status.type==='ok' ? 'bg-green-600 text-white' : status.type==='err' ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'}">
    {#if status.type==='saving'}<Loader2 class="w-4 h-4 animate-spin" />
    {:else if status.type==='ok'}<CheckCircle2 class="w-4 h-4" />
    {:else}<XCircle class="w-4 h-4" />{/if}
    {status.msg}
  </div>
{/if}

<!-- ── Mejora 1: modal de conciliación de precio ── -->
{#if repriceModal}
  {@const rm = repriceModal}
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
       role="dialog" aria-modal="true" on:click|self={closeRepriceBackdrop}>
    <div class="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
      <div class="flex items-start justify-between gap-2 p-4 border-b border-gray-100">
        <div class="min-w-0">
          <h3 class="font-semibold text-gray-900 flex items-center gap-1.5"><Tag class="w-4 h-4 text-[#16357E]" /> Conciliar cambio de precio</h3>
          <p class="text-xs text-gray-500 truncate">{rm.r.name}</p>
        </div>
        <button class="text-gray-400 hover:text-gray-700 shrink-0" on:click={closeReprice} disabled={repriceBusy}><X class="w-5 h-5" /></button>
      </div>

      <div class="p-4 space-y-4 overflow-y-auto">
        <div class="flex items-center justify-center gap-3 text-center">
          <div class="rounded-lg bg-gray-50 px-4 py-2">
            <div class="text-[11px] text-gray-400 uppercase">Antes</div>
            <div class="font-semibold text-gray-600">{fmt(rm.oldCents)}</div>
          </div>
          <ArrowRight class="w-5 h-5 text-gray-300" />
          <div class="rounded-lg bg-green-50 px-4 py-2 border border-green-200">
            <div class="text-[11px] text-green-600 uppercase">Nuevo</div>
            <div class="font-bold text-green-700">{fmt(rm.newCents)}</div>
          </div>
        </div>

        <div>
          <div class="text-xs font-semibold text-gray-600 mb-1.5">Plan</div>
          {#if rm.loadingPlans}
            <div class="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 class="w-3.5 h-3.5 animate-spin" /> Buscando plan con ese valor…</div>
          {:else}
            <div class="space-y-1.5">
              {#if rm.existing}
                <label class="flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer {rm.planAction==='attach'?'border-[#16357E] bg-blue-50':'border-gray-200'}">
                  <input type="radio" bind:group={repriceModal.planAction} value="attach" />
                  <span>Asignar plan existente <b>{rm.existing.name}</b></span>
                </label>
              {/if}
              <label class="flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer {rm.planAction==='create'?'border-[#16357E] bg-blue-50':'border-gray-200'}">
                <input type="radio" bind:group={repriceModal.planAction} value="create" />
                <span class="flex items-center gap-1.5 shrink-0"><Plus class="w-3.5 h-3.5" /> Crear plan:</span>
                <input class="flex-1 min-w-0 rounded border border-gray-200 px-2 py-1 text-xs" bind:value={repriceModal.newPlanName} disabled={rm.planAction!=='create'} />
              </label>
              <label class="flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer {rm.planAction==='none'?'border-[#16357E] bg-blue-50':'border-gray-200'}">
                <input type="radio" bind:group={repriceModal.planAction} value="none" />
                <span>Solo cambiar el precio del cliente (sin plan)</span>
              </label>
            </div>
          {/if}
        </div>

        <div>
          <div class="text-xs font-semibold text-gray-600 mb-1.5">Facturas a re-liquidar <span class="font-normal text-gray-400">· solo abiertas; las pagadas no se tocan</span></div>
          {#if rm.open.length === 0}
            <div class="text-xs text-gray-400">No hay facturas abiertas este año. El nuevo precio aplicará a las próximas.</div>
          {:else}
            <div class="space-y-1 max-h-40 overflow-y-auto">
              {#each rm.open as o}
                <label class="flex items-center gap-2 text-sm rounded px-2 py-1.5 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" bind:checked={o.checked} />
                  <span class="w-9 font-medium">{MONTHS[o.month-1]}</span>
                  <span class="text-[11px] px-1.5 py-0.5 rounded {o.status==='OVERDUE'?'bg-red-100 text-red-700':o.status==='PARTIAL'?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-600'}">{o.status==='OVERDUE'?'Vencida':o.status==='PARTIAL'?'Parcial':'Pendiente'}</span>
                  <span class="ml-auto text-xs text-gray-500">{fmt(o.amount)} → <b class="text-gray-800">{fmt(rm.newCents)}</b></span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="flex items-center justify-end gap-2 p-4 border-t border-gray-100">
        <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" on:click={closeReprice} disabled={repriceBusy}>Cancelar</button>
        <button class="inline-flex items-center gap-1.5 rounded-lg bg-[#16357E] text-white px-4 py-2 text-sm font-semibold hover:bg-[#0f2860] disabled:opacity-50"
                on:click={applyReprice} disabled={repriceBusy || rm.loadingPlans}>
          {#if repriceBusy}<Loader2 class="w-4 h-4 animate-spin" />{/if} Aplicar cambio
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Mejora 2: modal de suspensión masiva (seleccionar → confirmar → consola) ── -->
{#if suspendModal}
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
       role="dialog" aria-modal="true" on:click|self={closeSuspend}>
    <div class="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
      <div class="flex items-start justify-between gap-2 p-4 border-b border-gray-100">
        <div>
          {#if suspIsActivate}
            <h3 class="font-semibold text-gray-900 flex items-center gap-1.5"><Power class="w-4 h-4 text-emerald-600" /> Reactivar servicio</h3>
          {:else if suspIsAviso}
            <h3 class="font-semibold text-gray-900 flex items-center gap-1.5"><Clock class="w-4 h-4 text-amber-600" /> Aviso de pago masivo</h3>
          {:else}
            <h3 class="font-semibold text-gray-900 flex items-center gap-1.5"><Power class="w-4 h-4 text-red-600" /> Suspensión masiva de servicio</h3>
          {/if}
          <p class="text-xs text-gray-500">
            {#if suspendModal.step==='select'}{suspIsAviso ? 'Elegí a quién recordarle el pago · se proponen los deudores.' : 'Elegí a quién suspender · se proponen los que están en mora.'}
            {:else if suspendModal.step==='confirm'}Revisá y confirmá.
            {:else if suspendModal.step==='running'}Comunicando con el Mikrotik…
            {:else}Resultado de la operación.{/if}
          </p>
        </div>
        <button class="text-gray-400 hover:text-gray-700 shrink-0" on:click={closeSuspend} disabled={suspendModal.busy}><X class="w-5 h-5" /></button>
      </div>

      <div class="p-4 overflow-y-auto flex-1">
        {#if suspendModal.step==='select'}
          <div class="flex items-center justify-between mb-2">
            <button class="text-xs inline-flex items-center gap-1 rounded border px-2 py-1 {suspIsAviso ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-red-200 text-red-700 hover:bg-red-50'}" on:click={suspendSelectMorosos}>
              <AlertTriangle class="w-3.5 h-3.5" /> {suspIsAviso ? 'Seleccionar deudores' : 'Seleccionar morosos'}
            </button>
            <span class="text-xs text-gray-500">{suspendChosenCount} seleccionado(s)</span>
          </div>
          <div class="space-y-1 max-h-[50vh] overflow-y-auto">
            {#each suspendModal.items as it}
              {@const dis = !suspIsAviso && it.status==='SUSPENDED'}
              <label class="flex items-center gap-2 text-sm rounded px-2 py-1.5 hover:bg-gray-50 cursor-pointer {dis?'opacity-50':''}">
                <input type="checkbox" checked={it.checked} disabled={dis} on:change={() => toggleSuspendItem(it)} />
                <span class="min-w-0 truncate flex-1">{it.name}</span>
                {#if it.debtMonths > 0}<span class="text-[10px] px-1.5 py-0.5 rounded tabular-nums {it.mora ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}" title="Deuda total {fmt(it.debt)}">{it.debtMonths} {it.debtMonths===1?'mes':'meses'} · {fmt(it.debt)}</span>{/if}
                {#if it.status==='SUSPENDED'}<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">Suspendido</span>{/if}
                <span class="text-[10px] px-1.5 py-0.5 rounded {it.hasMk?'bg-blue-50 text-blue-700':'bg-amber-50 text-amber-700'}">{it.hasMk?'Router':'Solo sistema'}</span>
              </label>
            {/each}
          </div>
        {:else if suspendModal.step==='confirm'}
          {#if suspIsActivate}
            <div class="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 flex items-start gap-2">
              <Power class="w-5 h-5 shrink-0" />
              <div>Vas a <b>reactivar el servicio</b> de <b>{suspendChosenCount}</b> cliente(s): se habilita el PPPoE y se quita de las listas "Moroso"/"AvisoOK" del Mikrotik.</div>
            </div>
          {:else if suspIsAviso}
            <div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-start gap-2">
              <Clock class="w-5 h-5 shrink-0" />
              <div>Vas a <b>poner en aviso</b> a <b>{suspendChosenCount}</b> cliente(s). <b>No se corta el servicio</b>: al navegar verán una página de recordatorio con cuenta regresiva y podrán continuar. Se agrega la IP a la lista "Aviso".</div>
            </div>
            <!-- #3: recurrencia del aviso -->
            <div class="mt-3 flex items-center gap-2 text-sm">
              <span class="text-gray-600">Recurrencia del recordatorio:</span>
              <select bind:value={avisoRecurrence} class="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:ring-2 focus:ring-amber-400/40">
                {#each AVISO_RECURRENCES as opt}<option value={opt.v}>{opt.label}</option>{/each}
              </select>
            </div>
          {:else}
            <div class="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800 flex items-start gap-2">
              <AlertTriangle class="w-5 h-5 shrink-0" />
              <div>Vas a <b>suspender el servicio</b> de <b>{suspendChosenCount}</b> cliente(s): se deshabilita el PPPoE, se corta la sesión activa y se agrega la IP al address-list "Moroso" en el Mikrotik. Es reversible reactivando cada cliente.</div>
            </div>
          {/if}
          <div class="mt-3 space-y-0.5 max-h-[40vh] overflow-y-auto">
            {#each suspendChosen as it}
              <div class="text-sm text-gray-700 px-2 py-1 flex items-center gap-2">
                <span class="flex-1 truncate">{it.name}</span>
                {#if it.debtMonths > 0}<span class="text-[11px] text-gray-500 tabular-nums">{it.debtMonths} {it.debtMonths===1?'mes':'meses'} · {fmt(it.debt)}</span>{/if}
                <span class="text-xs text-gray-400 font-mono">{it.ip||'—'}</span>
              </div>
            {/each}
          </div>
        {:else}
          <div class="space-y-1.5 max-h-[55vh] overflow-y-auto">
            {#each suspendConsoleItems as it}
              {#if it.run}
                <div class="rounded-lg border border-gray-200 p-2">
                  <div class="flex items-center gap-2 mb-1">
                    {#if it.run.state==='running'}<Loader2 class="w-3.5 h-3.5 animate-spin text-[#16357E]" />
                    {:else if it.run.state==='fail'}<XCircle class="w-3.5 h-3.5 text-red-600" />
                    {:else}<CheckCircle2 class="w-3.5 h-3.5 text-green-600" />{/if}
                    <span class="font-medium text-gray-800 truncate text-sm">{it.name}</span>
                    <span class="ml-auto text-[11px] text-gray-400 font-mono">{it.ip||''}</span>
                  </div>
                  {#if it.run.state==='fail'}
                    <div class="text-red-600 pl-5 text-xs">✗ {it.run.error}</div>
                  {:else}
                    <div class="pl-5 space-y-0.5 text-xs">
                      {#if suspIsActivate}
                        <div class={stepCls(it.run.secret)}>{stepIcon(it.run.secret)} Habilitar PPPoE</div>
                        <div class={stepCls(it.run.addressList)}>{stepIcon(it.run.addressList)} Quitar de "Moroso"/"AvisoOK"</div>
                      {:else if suspIsAviso}
                        <div class={stepCls(it.run.addressList)}>{stepIcon(it.run.addressList)} Agregar a lista "Aviso"</div>
                      {:else}
                        <div class={stepCls(it.run.secret)}>{stepIcon(it.run.secret)} Deshabilitar PPPoE</div>
                        <div class={stepCls(it.run.kick)}>{stepIcon(it.run.kick)} Cortar sesión activa</div>
                        <div class={stepCls(it.run.addressList)}>{stepIcon(it.run.addressList)} Address-list "Moroso"</div>
                      {/if}
                      {#if it.run.error}<div class="text-amber-600">⚠ {it.run.error}</div>{/if}
                      {#if !it.hasMk}<div class="text-amber-600">Sin cuenta Mikrotik — no se pudo aplicar</div>{/if}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
          {#if suspendModal.step==='done'}
            <div class="mt-3 rounded-lg bg-gray-50 p-3 text-sm flex items-center gap-4">
              <span class="text-green-700 font-medium inline-flex items-center gap-1"><CheckCircle2 class="w-4 h-4" /> {suspendOkCount} {suspIsActivate ? 'reactivados' : suspIsAviso ? 'en aviso' : 'suspendidos'}</span>
              {#if suspendFailCount}<span class="text-red-600 font-medium inline-flex items-center gap-1"><AlertTriangle class="w-4 h-4" /> {suspendFailCount} con problemas de router</span>{/if}
            </div>
          {/if}
        {/if}
      </div>

      <div class="flex items-center justify-end gap-2 p-4 border-t border-gray-100">
        {#if suspendModal.step==='select'}
          <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" on:click={closeSuspend}>Cancelar</button>
          <button class="rounded-lg text-white px-4 py-2 text-sm font-semibold disabled:opacity-50 {suspIsAviso ? 'bg-amber-500 hover:bg-amber-600' : 'bg-red-600 hover:bg-red-700'}" disabled={suspendChosenCount===0} on:click={() => suspendModal = {...suspendModal, step:'confirm'}}>Continuar ({suspendChosenCount})</button>
        {:else if suspendModal.step==='confirm'}
          {#if suspIsActivate}
            <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" on:click={closeSuspend}>Cancelar</button>
            <button class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700" on:click={runSuspend}><Power class="w-4 h-4" /> Reactivar {suspendChosenCount}</button>
          {:else if suspIsAviso}
            <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" on:click={() => suspendModal = {...suspendModal, step:'select'}}>Atrás</button>
            <button class="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-600" on:click={runSuspend}><Clock class="w-4 h-4" /> Poner en aviso {suspendChosenCount}</button>
          {:else}
            <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" on:click={() => suspendModal = {...suspendModal, step:'select'}}>Atrás</button>
            <button class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-semibold hover:bg-red-700" on:click={runSuspend}><Power class="w-4 h-4" /> Suspender {suspendChosenCount}</button>
          {/if}
        {:else if suspendModal.step==='running'}
          <button class="rounded-lg border border-gray-300 px-3 py-2 text-sm opacity-60" disabled>{suspIsActivate ? 'Reactivando…' : suspIsAviso ? 'Aplicando…' : 'Suspendiendo…'}</button>
        {:else}
          <button class="rounded-lg bg-[#16357E] text-white px-4 py-2 text-sm font-semibold hover:bg-[#0f2860]" on:click={closeSuspend}>Cerrar</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Manija de redimensionado de columna (borde derecho del th) */
  .col-resizer {
    position: absolute;
    top: 0;
    right: 0;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    user-select: none;
    z-index: 5;
    touch-action: none;
  }
  .col-resizer::after {
    content: '';
    position: absolute;
    top: 15%;
    right: 2px;
    width: 2px;
    height: 70%;
    border-radius: 2px;
    background: transparent;
    transition: background .12s;
  }
  .col-resizer:hover::after,
  .col-resizer:active::after { background: #16357E; }
  /* La columna IP (sticky) empieza justo en el borde de Cliente y tapaba la
     manija al borde: por eso Cliente usa una manija VISIBLE dentro de la celda. */
  .cliente-grip {
    display: inline-flex;
    align-items: center;
    cursor: col-resize;
    color: #9ca3af;
    border-radius: 4px;
    padding: 2px;
    touch-action: none;
  }
  .cliente-grip:hover { color: #16357E; background: rgba(22,53,126,.1); }

  .cell-in {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 0.875rem;
    color: #111827;
    outline: none;
    transition: border-color .12s, background .12s;
  }
  .cell-in:hover { border-color: #e5e7eb; }
  .cell-in:focus { border-color: #16357E; background: #fff; box-shadow: 0 0 0 3px rgba(22,53,126,.12); }
  .cell-in.is-saving { border-color: #fbbf24; background: #fffbeb; }
  .cell-in.is-ok { border-color: #34d399; background: #ecfdf5; }

  .btn-primary, .btn-ghost, .btn-danger, .seg {
    display: inline-flex; align-items: center; justify-content: center; gap: .4rem;
    border-radius: 8px; padding: .55rem .8rem; font-size: .875rem; font-weight: 500;
    cursor: pointer; transition: background .12s, border-color .12s; border: 1px solid transparent;
  }
  .btn-primary { background: #16357E; color: #fff; }
  .btn-primary:hover { background: #0f2860; }
  .btn-ghost { background: #fff; color: #374151; border-color: #d1d5db; }
  .btn-ghost:hover { background: #f9fafb; }
  .btn-danger { background: #fee2e2; color: #b91c1c; }
  .btn-danger:hover { background: #fecaca; }
  .btn-primary:disabled, .btn-ghost:disabled, .btn-danger:disabled { opacity: .5; cursor: default; }
  .seg { background: #fff; color: #374151; border-color: #d1d5db; }
  .seg-on { background: #eef2ff; color: #16357E; border-color: #16357E; }
</style>
