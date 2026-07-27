<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { notificationsApi } from '$lib/api/notifications.api.js';
  import { evidenceApi } from '$lib/api/evidence.api.js';
  import { inventoryApi } from '$lib/api/inventory.api.js';
  import { goto } from '$app/navigation';
  import {
    ArrowLeft, User, Wifi, CreditCard, FileText, AlertCircle, CheckCircle2,
    Eye, EyeOff, PauseCircle, PlayCircle, Loader2, Trash2, Edit3, X,
    Calendar, FileCheck, Phone, Mail, MessageSquare, Copy, Check,
    MapPin, Receipt, ExternalLink, Camera, ImageUp, Image as ImageIcon,
    Send, Link2, Share2, Bell, Boxes, Package, Plus, AlertTriangle
  } from 'lucide-svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import RegisterPaymentModal from '$lib/components/payments/RegisterPaymentModal.svelte';
  import { user } from '$lib/stores/auth.store.js';
  import { isAdmin } from '$lib/permissions.js';

  /** @type {import('$lib/types').Client | null} */
  let client = null;
  let pageError = '';

  // Navegación contextual: la página que enlaza aquí puede pasar ?from=<ruta>
  // para que "volver" regrese a donde venías (Facturas, Planilla, Pagos…) y no
  // siempre a la lista de Clientes. Fallback: /clients.
  /** @type {Record<string, string>} */
  const BACK_LABELS = {
    '/invoices': 'Facturas',
    '/clients': 'Clientes',
    '/clients/planilla': 'Planilla',
    '/clients/eliminados': 'Eliminados',
    '/payments': 'Pagos',
    '/dashboard': 'Inicio',
    '/reports': 'Reportes'
  };
  // Solo rutas internas ("/algo", no "//host" ni URLs externas) para evitar
  // open-redirect a través del parámetro from.
  $: rawFrom   = $page.url.searchParams.get('from') || '';
  $: backHref  = (rawFrom.startsWith('/') && !rawFrom.startsWith('//')) ? rawFrom : '/clients';
  $: backLabel = BACK_LABELS[backHref] || 'Clientes';

  onMount(async () => {
    const id = $page.params.id;
    try {
      client = await api.get(`/clients/${id}`);
      resetForm();

      // Handle Wompi redirect callback
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('wompi') === 'return') {
        const ref = urlParams.get('ref') || '';
        showToast('success', ref
          ? `Pago iniciado con Wompi. Referencia: ${ref.slice(-12)}. El sistema actualizará el estado automáticamente al recibir la confirmación.`
          : 'Redirigido desde Wompi. Esperando confirmación del pago…');
        // Clean URL
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    } catch (/** @type {any} */ e) {
      pageError = e.message || 'Error al cargar el cliente';
    }
  });

  let loadingAction = false;
  let error = '';
  let success = '';
  let showPassword = false;
  let showDeleteModal = false;
  let showPaymentModal = false;
  let deleting = false;
  let deleteConfirmName = '';
  let delReason = '';
  let delNote = '';
  const DELETE_REASONS = [
    { value: 'NO_PAGO', label: 'No pagó' },
    { value: 'SE_RETIRO', label: 'Se retiró / mudó' },
    { value: 'CANCELACION_VOLUNTARIA', label: 'Cancelación voluntaria' },
    { value: 'OTRO', label: 'Otro' }
  ];

  let editPersonal = false;
  /** @type {Record<string, any>} */
  let formPersonal = {};

  // ── Payment details modal (read-only viewer for paid/partial invoices) ──
  let showPaymentDetails = false;
  /** @type {import('$lib/types').Invoice | null} */
  let paymentDetailsInvoice = null; // the invoice whose payments we're viewing
  /** @type {import('$lib/types').Payment[]} */
  let paymentDetailsList = [];      // payments associated with that invoice

  /** @param {any} inv */
  function openPaymentDetails(inv) {
    paymentDetailsInvoice = inv;
    paymentDetailsList = paymentsForInvoice(inv);
    showPaymentDetails = true;
  }
  /** @param {string} invoiceId */
  function openPaymentDetailsByInvoiceId(invoiceId) {
    const inv = client?.invoices?.find(i => i.id === invoiceId);
    if (inv) openPaymentDetails(inv);
  }

  // Plans available for the change-plan select. Loaded lazily on first edit.
  /** @type {import('$lib/types').Plan[]} */
  let plansForEdit = [];
  let plansForEditLoaded = false;
  async function ensurePlansLoaded() {
    if (plansForEditLoaded) return;
    try {
      plansForEdit = await api.get('/plans');
      plansForEditLoaded = true;
    } catch (/** @type {any} */ e) {
      // Non-fatal — the select just stays empty and the operator can cancel.
      console.warn('No se pudieron cargar planes:', e.message);
    }
  }

  /** @param {string|Date|null|undefined} d */
  function toDateInput(d) {
    if (!d) return '';
    try { return new Date(d).toISOString().slice(0, 10); }
    catch { return ''; }
  }

  /** Rebuild form state from the current `client` object. */
  function resetForm() {
    formPersonal = {
      fullName:       client?.name           || '',
      documentType:   client?.documentType   || 'CC',
      documentNumber: client?.documentNumber || '',
      email:          client?.email          || '',
      phone:          client?.phone          || '',
      address:        client?.address        || '',
      neighborhood:   client?.neighborhood   || '',
      city:           client?.city           || '',
      zoneId:         client?.zoneId         || null,
      planId:         client?.planId         || '',
      connectionType: client?.connectionType || 'FIBER',
      monthlyFee:     client?.monthlyFee
                        ? Math.round(client.monthlyFee / 100)
                        : '',
      contractDate:     toDateInput(client?.contractDate),
      installationDate: toDateInput(client?.installationDate),
      notes:          client?.notes          || '',
      mikrotik: {
        password:      '',
        remoteAddress: client?.mikrotikAccount?.remoteAddress || '',
        localAddress:  client?.mikrotikAccount?.localAddress  || '',
        profileName:   client?.mikrotikAccount?.profileName   || '',
        coordinates:   client?.mikrotikAccount?.coordinates   || client?.coordinates    || '',
      }
    };
  }

  // ── Constants ───────────────────────────────────────
  /** @type {Record<string, string>} */
  const PAYMENT_METHOD_PT = {
    CASH: 'Efectivo',
    BANK_TRANSFER: 'Transferencia bancaria',
    CREDIT_CARD: 'Tarjeta de crédito',
    WOMPI: 'Wompi',
    OTHER: 'Otro'
  };
  /** @type {Record<string, string>} */
  const STATUS_PT  = { ACTIVE:'Activo', SUSPENDED:'Suspendido', INACTIVE:'Inactivo', PENDING:'Pendiente' };
  /** @type {Record<string, string>} */
  const STATUS_CLS = {
    ACTIVE:    'bg-emerald-100 text-emerald-700',
    SUSPENDED: 'bg-red-100 text-red-700',
    INACTIVE:  'bg-slate-100 text-slate-600',
    PENDING:   'bg-amber-100 text-amber-700'
  };
  /** @type {Record<string, string>} */
  const INVOICE_CLS = {
    PAID:      'bg-emerald-100 text-emerald-700',
    PARTIAL:   'bg-blue-100 text-blue-700',
    PENDING:   'bg-amber-100 text-amber-700',
    OVERDUE:   'bg-red-100 text-red-700',
    CANCELLED: 'bg-slate-100 text-slate-600',
    DRAFT:     'bg-slate-100 text-slate-500',
    REFUNDED:  'bg-violet-100 text-violet-700'
  };

  // ── Helpers ─────────────────────────────────────────
  /** @param {number|null|undefined} cents */
  function fmtMoney(cents) {
    if (cents == null) return '—';
    return new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(cents / 100);
  }
  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
  }
  /** @param {string|Date|null|undefined} s */
  function fmtDateTime(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }
  // Extract any http(s) URL inside payment notes (likely the receipt/evidencia).
  /** @param {string|null|undefined} text */
  function extractUrls(text) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s)<>"']+/gi);
    return matches ? [...new Set(matches)] : [];
  }
  // Find invoice number for a given invoiceId (for payment history rows).
  /** @param {string} invoiceId */
  function invoiceNumberFor(invoiceId) {
    return client?.invoices?.find(i => i.id === invoiceId)?.invoiceNumber || null;
  }
  // Collect payments associated with an invoice. Prefer inv.payments (eager-loaded),
  // fall back to scanning client.payments by invoiceId.
  /** @param {any} inv */
  function paymentsForInvoice(inv) {
    if (Array.isArray(inv?.payments) && inv.payments.length) return inv.payments;
    return (client?.payments || []).filter(p => p.invoiceId === inv?.id);
  }
  function getClientDuration() {
    if (!client?.createdAt) return '—';
    const diff = Date.now() - new Date(client.createdAt).getTime();
    const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));
    const years = Math.floor(months / 12);
    const m = months % 12;
    if (years > 0) return `${years} año${years > 1 ? 's' : ''}, ${m} mes${m !== 1 ? 'es' : ''}`;
    return `${months} mes${months !== 1 ? 'es' : ''}`;
  }
  /** @param {string} type @param {string} message */
  function showToast(type, message) {
    if (type === 'error') error = message;
    else success = message;
    setTimeout(() => { error = ''; success = ''; }, 4000);
  }
  // ── Reenviar cobro: el staff reenvía al CLIENTE el cobro con link de pago ──
  // (correo si tiene; si no, abre WhatsApp). El cliente es quien paga.
  /** @type {string | null} */
  let resendBusyId = null;
  /** @param {string} invId */
  async function resendCharge(invId) {
    const c = client;
    if (resendBusyId || !c) return;
    resendBusyId = invId;
    try {
      const r = await api.post(`/clients/${c.id}/resend-charge`, { invoiceId: invId });
      if (r?.emailSent) {
        showToast('success', 'Cobro reenviado al correo del cliente ✓');
        if (r?.waUrl) window.open(r.waUrl, '_blank'); // además, ofrecer WhatsApp
      } else if (r?.waUrl) {
        showToast('success', 'Cliente sin correo — abriendo WhatsApp para enviar el cobro');
        window.open(r.waUrl, '_blank');
      } else {
        showToast('error', 'El cliente no tiene correo ni teléfono registrado');
      }
      loadNotifications(); notifLoaded = false; // refresca el contador de notificaciones
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'No se pudo reenviar el cobro');
    } finally { resendBusyId = null; }
  }

  // ── Wompi: generar/reusar link y copiar o compartir por WhatsApp ──────
  /** @type {string | null} */
  let linkBusyId = null;
  /** @param {string} invId @param {string} mode */
  async function genLink(invId, mode) {
    if (linkBusyId) return;
    linkBusyId = invId;
    try {
      const r = await api.post(`/payment-links/generate/${invId}`);
      const checkoutUrl = r?.checkoutUrl;
      const waUrl = r?.waUrl;
      if (mode === 'whatsapp') {
        if (waUrl) window.open(waUrl, '_blank');
        else { if (checkoutUrl) await navigator.clipboard.writeText(checkoutUrl); showToast('error', 'Cliente sin teléfono — link copiado'); }
      } else {
        await navigator.clipboard.writeText(checkoutUrl);
        showToast('success', 'Link de pago Wompi copiado ✓');
      }
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'No se pudo generar el link');
    } finally {
      linkBusyId = null;
    }
  }

  // Phone helpers (digits-only for tel:/wa.me)
  /** @param {string|null|undefined} p */
  function digitsOnly(p) { return (p || '').replace(/\D/g, ''); }

  // Copy with feedback
  let copied = '';
  /** @param {string} value @param {string} key */
  async function copyText(value, key) {
    try {
      await navigator.clipboard.writeText(value);
      copied = key;
      setTimeout(() => { if (copied === key) copied = ''; }, 1500);
    } catch (_) { /* clipboard unavailable */ }
  }

  // ── Actions ─────────────────────────────────────────
  async function toggleStatus() {
    const c = client;
    if (!c) return;
    loadingAction = true; error = '';
    try {
      const action = c.status === 'ACTIVE' ? 'suspend' : 'activate';
      await api.post(`/clients/${c.id}/${action}`);
      const newStatus = c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
      client = { ...c, status: newStatus };
      showToast('success', newStatus === 'ACTIVE' ? 'Servicio activado' : 'Servicio suspendido');
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'Error al cambiar estado');
    } finally { loadingAction = false; }
  }

  function buildPersonalPayload() {
    return {
      fullName:       formPersonal.fullName,
      documentType:   formPersonal.documentType,
      documentNumber: formPersonal.documentNumber,
      email:          formPersonal.email,
      phone:          formPersonal.phone,
      address:        formPersonal.address,
      neighborhood:   formPersonal.neighborhood,
      city:           formPersonal.city,
      zoneId:         formPersonal.zoneId,
      planId:         formPersonal.planId || null,
      contractDate:     formPersonal.contractDate     || null,
      installationDate: formPersonal.installationDate || null,
      connectionType: formPersonal.connectionType || 'FIBER',
      monthlyFee:     formPersonal.monthlyFee !== '' && Number(formPersonal.monthlyFee) >= 0
                        ? Math.round(Number(formPersonal.monthlyFee) * 100)
                        : 0,
      notes:          formPersonal.notes,
      mikrotik: {
        ...(formPersonal.mikrotik.password      && { password:      formPersonal.mikrotik.password }),
        ...(formPersonal.mikrotik.remoteAddress && { remoteAddress: formPersonal.mikrotik.remoteAddress }),
        ...(formPersonal.mikrotik.localAddress  && { localAddress:  formPersonal.mikrotik.localAddress }),
        ...(formPersonal.mikrotik.profileName   && { profileName:   formPersonal.mikrotik.profileName }),
        ...(formPersonal.mikrotik.coordinates   && { coordinates:   formPersonal.mikrotik.coordinates }),
      }
    };
  }

  async function savePersonal() {
    const c = client;
    if (!c) return;
    loadingAction = true;
    clearTimeout(autoSaveTimer);   // a manual save supersedes any pending autosave
    try {
      await api.put(`/clients/${c.id}`, buildPersonalPayload());
      // Full reload: re-fetch everything from the API so no relation is stale
      client = await api.get(`/clients/${c.id}`);
      resetForm();
      editPersonal = false;
      autoSaveState = '';
      showToast('success', 'Datos actualizados');
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'Error al guardar');
    } finally { loadingAction = false; }
  }

  // ── Autosave ──────────────────────────────────────────────────────
  // While the edit panel is open, changes persist automatically 1.5s after
  // the last keystroke (debounced + dirty-tracked). The manual "Guardar"
  // button remains the explicit way to close the panel; autosave never
  // closes it nor resets the form mid-typing.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let autoSaveTimer;
  let autoSaveState = '';        // '' | 'pending' | 'saving' | 'saved' | 'error'
  let autoSaveError = '';
  /** @type {Date | null} */
  let autoSaveAt    = null;      // Date of last successful autosave
  let autoSnapshot  = '';        // serialized form at last save (dirty tracking)

  async function runAutoSave() {
    const cur = client;
    if (!cur) return;
    const snap = JSON.stringify(formPersonal);
    if (snap === autoSnapshot) { autoSaveState = autoSaveAt ? 'saved' : ''; return; }
    autoSaveState = 'saving';
    try {
      await api.put(`/clients/${cur.id}`, buildPersonalPayload());
      autoSnapshot  = snap;
      autoSaveAt    = new Date();
      autoSaveState = 'saved';
      // Refresh the read panels silently (no resetForm — typing is sacred).
      api.get(`/clients/${cur.id}`).then(c => { client = c; }).catch(() => {});
    } catch (/** @type {any} */ e) {
      autoSaveState = 'error';
      autoSaveError = e.message || 'No se pudo autoguardar';
    }
  }

  // Debounce: any change to the form while editing schedules an autosave.
  $: if (editPersonal && autoSnapshot && JSON.stringify(formPersonal) !== autoSnapshot) {
    autoSaveState = 'pending';
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(runAutoSave, 1500);
  }

  function openPersonalEdit() {
    ensurePlansLoaded();
    editPersonal = true;
    autoSnapshot  = JSON.stringify(formPersonal);
    autoSaveState = '';
    autoSaveError = '';
    autoSaveAt    = null;
  }

  // ── Sheet: solicitar actualización pública de datos ─────────────────
  // Genera un ClientUpdateToken y dispatcha el link al cliente por los
  // canales seleccionados. La URL devuelta puede copiarse para envío manual.
  let showUpdateSheet  = false;
  let updateSending    = false;
  let updateError      = '';
  /** @type {any} */
  let updateResult     = null;     // { publicUrl, expiresAt, dispatch }
  let updateCopied     = false;
  // Canales para actualización de datos: solo Email y WhatsApp (Telegram no
  // está habilitado para este flujo). Si no se elige canal, el operador copia
  // el enlace y lo envía manualmente (ej. desde su propio WhatsApp).
  /** @type {string[]} */
  let updateSendChannels   = [];
  /** @type {string[]} */
  let updateNotifyChannels = [];

  function openUpdateSheet() {
    updateError  = '';
    updateResult = null;
    updateCopied = false;
    // Defaults inteligentes basados en lo que el cliente tiene.
    updateSendChannels = [
      ...(client?.email ? ['EMAIL']    : []),
      ...(client?.phone ? ['WHATSAPP'] : [])
    ];
    updateNotifyChannels = [];
    showUpdateSheet = true;
  }

  /** @param {string} ch */
  function toggleSendChannel(ch) {
    updateSendChannels = updateSendChannels.includes(ch)
      ? updateSendChannels.filter(c => c !== ch)
      : [...updateSendChannels, ch];
  }
  /** @param {string} ch */
  function toggleNotifyChannel(ch) {
    updateNotifyChannels = updateNotifyChannels.includes(ch)
      ? updateNotifyChannels.filter(c => c !== ch)
      : [...updateNotifyChannels, ch];
  }

  async function requestUpdateToken() {
    const c = client;
    if (!c) return;
    updateSending = true;
    updateError = '';
    try {
      // api.post already unwraps to the inner `data` payload.
      updateResult = await api.post(`/clients/${c.id}/update-tokens`, {
        sendChannels:   updateSendChannels,
        notifyChannels: updateNotifyChannels
      });
    } catch (/** @type {any} */ e) {
      updateError = e.message || 'No se pudo generar el enlace';
    } finally {
      updateSending = false;
    }
  }

  async function copyUpdateUrl() {
    if (!updateResult?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(updateResult.publicUrl);
      updateCopied = true;
      setTimeout(() => updateCopied = false, 2000);
    } catch (_) { /* clipboard unavailable */ }
  }

  let updateMsgCopied = false;
  async function copyUpdateMsg() {
    if (!updateResult?.whatsappMessage) return;
    try {
      await navigator.clipboard.writeText(updateResult.whatsappMessage);
      updateMsgCopied = true;
      setTimeout(() => updateMsgCopied = false, 2000);
    } catch (_) { /* clipboard unavailable */ }
  }

  /** @param {string} ch */
  function fmtChannel(ch) {
    return /** @type {Record<string,string>} */ ({ EMAIL: 'Email', WHATSAPP: 'WhatsApp', TELEGRAM: 'Telegram' })[ch] || ch;
  }
  /** @param {any} result @param {string} ch */
  function channelOk(result, ch) {
    return result?.dispatch?.[ch]?.ok === true;
  }
  /** @param {any} result @param {string} ch */
  function channelErr(result, ch) {
    const r = result?.dispatch?.[ch];
    return r && r.ok === false ? r.error : null;
  }

  async function deleteClient() {
    const c = client;
    if (!c || deleteConfirmName !== c.name) return;
    deleting = true;
    try {
      await api.delete(`/clients/${c.id}`, { reasonCategory: delReason || undefined, reasonNote: delNote || undefined });
      showDeleteModal = false;
      goto('/clients');
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'Error al eliminar');
    } finally { deleting = false; }
  }

  // ── Derived ─────────────────────────────────────────
  $: initials = client?.name?.split(/\s+/).map(n => n[0]).slice(0, 2).join('').toUpperCase() || '??';
  $: pendingInvoices = client?.invoices?.filter(i => ['PENDING','OVERDUE','PARTIAL'].includes(i.status)) || [];
  $: paidInvoices    = client?.invoices?.filter(i => i.status === 'PAID') || [];
  $: recentPayments  = client?.payments || [];
  $: isOnline        = client?.mikrotikAccount?.status === 'ACTIVE' || client?.status === 'ACTIVE';
  // Free-plan (trueque) clients never owe money even if old invoices linger.
  // The backend cancels open invoices on plan change to free, but we still
  // suppress every debt-related surface to be defensive.
  $: isFreeClient    = !!client?.plan?.isFree;
  $: pendingAmount   = isFreeClient ? 0 : pendingInvoices.reduce(
       (sum, inv) => sum + (inv.balanceDue > 0 ? inv.balanceDue : (inv.amount ?? inv.total ?? 0)),
       0
     );
  // Next due date among pending invoices (oldest first)
  $: nextDue = pendingInvoices
                .filter(i => i.dueDate)
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  /** @param {any} inv */
  function isOverdueInvoice(inv) {
    if (inv.status === 'OVERDUE') return true;
    if (!inv.dueDate) return false;
    return new Date(inv.dueDate) < now && inv.status !== 'PAID';
  }
  // MORA REAL: solo facturas vencidas (no las pendientes que aún no vencen).
  // El aviso rojo solo debe encenderse aquí — un cobro abierto sin vencer no
  // es "deuda". (Los pendientes-no-vencidos se ven en KPI + histórico.)
  $: overdueInvoices = isFreeClient ? [] : pendingInvoices.filter(isOverdueInvoice);
  $: overdueAmount   = overdueInvoices.reduce(
       (sum, inv) => sum + (inv.balanceDue > 0 ? inv.balanceDue : (inv.amount ?? inv.total ?? 0)), 0);

  // ── Payment modal ───────────────────────────────────
  // `payInvoiceId` actúa como preselección: vacío = todas las pendientes,
  // con valor = abre el modal con esa factura marcada.
  let payInvoiceId = '';

  function openPayment() {
    payInvoiceId = '';           // botón "Registrar pago" general → todas las pendientes
    showPaymentModal = true;
  }

  /** @param {string} invoiceId */
  function payInvoice(invoiceId) {
    payInvoiceId = invoiceId;    // "Registrar pago" por factura → preselecciona esa
    showPaymentModal = true;
  }

  async function onPaymentDone() {
    showPaymentModal = false;
    const c = client;
    try {
      if (c) client = await api.get(`/clients/${c.id}`);
    } catch {}
    showToast('success', 'Pago registrado correctamente');
  }

  // ── Evidence photos ─────────────────────────────────────────────────
  /** @type {import('$lib/types').EvidencePhoto[]} */
  let evidence = [];
  let evidenceLoading = false;
  let evidenceError = '';
  /** @type {HTMLInputElement} */
  let cameraInput;     // <input type="file" capture="environment">
  /** @type {HTMLInputElement} */
  let galleryInput;    // <input type="file" multiple>
  /** @type {File[]} */
  let pendingFiles = [];     // files chosen but not yet uploaded
  /** @type {string[]} */
  let pendingPreviews = [];  // object URLs for previews
  let evidenceType = 'installation';
  let evidenceDescription = '';
  let uploading = false;
  /** @type {any} */
  let lightboxPhoto = null;  // photo currently open in the lightbox

  async function loadEvidence() {
    if (!client?.id) return;
    evidenceLoading = true; evidenceError = '';
    try {
      evidence = await evidenceApi.list(client.id);
    } catch (/** @type {any} */ e) {
      evidenceError = e.message || 'No se pudieron cargar las evidencias';
    } finally { evidenceLoading = false; }
  }
  // Load when client becomes available.
  $: if (client?.id && evidence.length === 0 && !evidenceLoading && !evidenceError) loadEvidence();

  // ── Notificaciones (Centro de Notificaciones ↔ Clientes) ──────────
  /** @type {any[]} */
  let notifications = [];
  let notifLoading = false;
  let notifError = '';
  let notifLoaded = false;
  async function loadNotifications() {
    if (!client?.id) return;
    notifLoading = true; notifError = '';
    try { notifications = await api.get(`/clients/${client.id}/notifications`); }
    catch (/** @type {any} */ e) { notifError = e.message || 'No se pudieron cargar las notificaciones'; }
    finally { notifLoading = false; notifLoaded = true; }
  }
  $: if (client?.id && !notifLoaded && !notifLoading) loadNotifications();

  // ── Envío manual de una notificación a ESTE cliente ───────────────
  // El operador elige una plantilla + canal y se envía solo a este cliente
  // (lo masivo vive en el Centro de Notificaciones). Reusa el pipeline de
  // campañas en el backend (POST /clients/:id/notify).
  /** @type {import('$lib/types').NotificationTemplate[]} */
  let notifTemplates = [];
  let notifTplLoaded = false;
  let sendOpen = false;            // toggle del mini-formulario
  let sendForm = { templateId: '', channel: 'EMAIL', generatePaymentLinks: false };
  let sending = false;
  /** @type {{ type: 'success'|'error', text: string } | null} */
  let sendMsg = null;              // { type: 'success'|'error', text }

  async function loadNotifTemplates() {
    if (notifTplLoaded) return;
    try {
      const list = await notificationsApi.listTemplates();
      notifTemplates = (list || []).filter(t => t.isActive);
    } catch (/** @type {any} */ e) { /* no bloquea la ficha */ }
    finally { notifTplLoaded = true; }
  }
  function toggleSend() {
    sendOpen = !sendOpen;
    sendMsg = null;
    if (sendOpen) loadNotifTemplates();
  }
  // Al elegir plantilla, alinear el canal con el de la plantilla.
  $: selectedNotifTpl = notifTemplates.find(t => t.id === sendForm.templateId) || null;
  function onNotifTplChange() {
    if (selectedNotifTpl && sendForm.channel !== 'BOTH' && sendForm.channel !== selectedNotifTpl.channel) {
      sendForm.channel = selectedNotifTpl.channel;
    }
  }

  async function sendNotification() {
    const c = client;
    if (!c) return;
    if (!sendForm.templateId) { sendMsg = { type: 'error', text: 'Selecciona una plantilla.' }; return; }
    sending = true; sendMsg = null;
    try {
      const r = await api.post(`/clients/${c.id}/notify`, {
        templateId: sendForm.templateId,
        channel: sendForm.channel,
        generatePaymentLinks: sendForm.generatePaymentLinks
      });
      if ((r?.sent ?? 0) > 0) {
        sendMsg = { type: 'success', text: 'Notificación enviada.' };
        sendForm.templateId = '';
        notifLoaded = false; loadNotifications();   // refresca el historial
      } else {
        const missing = sendForm.channel === 'WHATSAPP' ? 'teléfono' : 'email';
        sendMsg = { type: 'error', text: `No se pudo enviar. Verifica que el cliente tenga ${missing} válido.` };
      }
    } catch (/** @type {any} */ e) { sendMsg = { type: 'error', text: e.message || 'No se pudo enviar la notificación.' }; }
    finally { sending = false; }
  }
  /** @type {Record<string, string>} */
  const NOTIF_CHANNEL_LABEL = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', BOTH: 'Email + WhatsApp' };

  // Resumen de notificaciones: recibidas (no fallidas) / vistas (leído/abierto).
  /** @param {any} s */
  const _ns = (s) => String(s || '').toLowerCase();
  $: notifReceived = notifications.filter(n => _ns(n.status) !== 'failed' && _ns(n.status) !== 'pending').length;
  $: notifOpened   = notifications.filter(n => ['read', 'opened'].includes(_ns(n.status))).length;
  $: notifFailed   = notifications.filter(n => _ns(n.status) === 'failed').length;

  /** @type {Record<string, string>} */
  const NOTIF_TYPE_LABELS = {
    INVOICE_GENERATED: 'Factura generada', PAYMENT_REMINDER: 'Recordatorio de pago',
    PAYMENT_DUE: 'Recordatorio de pago', PAYMENT_OVERDUE: 'Pago vencido',
    PAYMENT_CONFIRMATION: 'Pago confirmado', SERVICE_SUSPENSION: 'Servicio suspendido',
    SERVICE_ACTIVATION: 'Servicio reactivado', INSTALLATION_SCHEDULED: 'Instalación programada',
    GENERAL_ANNOUNCEMENT: 'Notificación'
  };
  /** @param {string} t */
  const notifTypeLabel  = (t) => NOTIF_TYPE_LABELS[t] || 'Notificación';
  /** @param {string|Date|null|undefined} d */
  const fmtNotifDate    = (d) => d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  /** @param {any} s */
  const notifStatusLabel = (s) => /** @type {Record<string,string>} */ ({ sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'Falló', pending: 'Pendiente', received: 'Recibido' })[String(s).toLowerCase()] || s;
  /** @param {any} s */
  const notifStatusClass = (s) => {
    const ss = String(s).toLowerCase();
    if (ss === 'failed') return 'bg-red-50 text-red-600';
    if (ss === 'pending') return 'bg-amber-50 text-amber-700';
    return 'bg-emerald-50 text-emerald-700';
  };

  // ── Inventario / equipos del cliente ──────────────────────────────
  const INV_BASE = import.meta.env.PUBLIC_API_URL || '';
  /** @param {string|null|undefined} u */
  const invImg = (u) => u ? (u.startsWith('http') ? u : `${INV_BASE}${u}`) : '';
  /** @type {import('$lib/types').InventoryItem[]} */
  let invItems = [];
  /** @type {import('$lib/types').InventoryProduct[]} */
  let invProducts = [];
  let invLoading = false;
  let invLoaded = false;
  let invModalOpen = false;
  let invSaving = false;
  let invError = '';
  let invForm = { productId: '', serial: '', notes: '' };
  async function loadInventory() {
    if (!client?.id) return;
    invLoading = true;
    try {
      const [its, prods] = await Promise.all([
        inventoryApi.listItems({ clientId: client.id }),
        invProducts.length ? Promise.resolve(invProducts) : inventoryApi.listProducts()
      ]);
      invItems = its || [];
      invProducts = prods || [];
    } catch (/** @type {any} */ e) { /* silent — panel just shows empty */ }
    finally { invLoading = false; invLoaded = true; }
  }
  $: if (client?.id && !invLoaded && !invLoading) loadInventory();

  function openInvModal() { invForm = { productId: '', serial: '', notes: '' }; invError = ''; invModalOpen = true; }
  async function saveInvItem() {
    const c = client;
    if (!c || !invForm.productId) { if (!invForm.productId) invError = 'Selecciona un producto.'; return; }
    invSaving = true; invError = '';
    try {
      await inventoryApi.createItem({
        productId: invForm.productId,
        serial:    invForm.serial.trim() || null,
        clientId:  c.id,
        status:    'ASSIGNED',
        notes:     invForm.notes || null
      });
      invModalOpen = false;
      invItems = await inventoryApi.listItems({ clientId: c.id });
      showToast('success', 'Equipo asignado al cliente');
    } catch (/** @type {any} */ e) { invError = e.message || 'No se pudo asignar el equipo'; }
    finally { invSaving = false; }
  }
  /** @param {any} it */
  async function removeInvItem(it) {
    const c = client;
    if (!c || !confirm(`¿Quitar "${it.product?.name}" (${it.serial || 'sin serial'}) de este cliente?`)) return;
    try {
      await inventoryApi.unassign(it.id);
      invItems = await inventoryApi.listItems({ clientId: c.id });
      showToast('success', 'Equipo devuelto a bodega');
    } catch (/** @type {any} */ e) { showToast('error', e.message); }
  }

  /** @param {Event} e */
  function onPickFiles(e) {
    const input = /** @type {HTMLInputElement} */ (e.target);
    const list = Array.from(input.files || []);
    if (list.length === 0) return;
    // Filter to images only (defensive — accept attribute may be ignored).
    const images = list.filter(f => f.type.startsWith('image/'));
    if (images.length === 0) {
      showToast('error', 'Solo se aceptan imágenes.');
      input.value = '';
      return;
    }
    // Revoke any old previews to avoid memory leaks.
    pendingPreviews.forEach(u => URL.revokeObjectURL(u));
    pendingFiles = images;
    pendingPreviews = images.map(f => URL.createObjectURL(f));
    // Reset the input so picking the same file again still triggers change.
    input.value = '';
  }

  function discardPending() {
    pendingPreviews.forEach(u => URL.revokeObjectURL(u));
    pendingFiles = [];
    pendingPreviews = [];
    evidenceDescription = '';
  }

  async function uploadPending() {
    const c = client;
    if (!c || pendingFiles.length === 0) return;
    uploading = true;
    try {
      const created = await evidenceApi.upload(c.id, pendingFiles, {
        type: evidenceType,
        description: evidenceDescription
      });
      // Prepend new ones (server returns ordered, but local concat is fine).
      evidence = [...created, ...evidence];
      showToast('success', `${created.length} ${created.length === 1 ? 'evidencia subida' : 'evidencias subidas'} correctamente.`);
      discardPending();
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'No se pudo subir la evidencia.');
    } finally { uploading = false; }
  }

  /** @param {any} photo */
  async function deleteEvidence(photo) {
    const c = client;
    if (!c || !confirm('¿Eliminar esta evidencia? No se puede deshacer.')) return;
    try {
      await evidenceApi.remove(c.id, photo.id);
      evidence = evidence.filter(p => p.id !== photo.id);
      if (lightboxPhoto?.id === photo.id) lightboxPhoto = null;
      showToast('success', 'Evidencia eliminada.');
    } catch (/** @type {any} */ e) {
      showToast('error', e.message || 'No se pudo eliminar.');
    }
  }

  /** @type {Record<string, string>} */
  const EVIDENCE_TYPE_LABEL = {
    installation: 'Instalación',
    support:      'Soporte técnico',
    visit:        'Visita',
    other:        'Otro'
  };
  /** @param {string|Date|null|undefined} s */
  function fmtEvDate(s) {
    if (!s) return '';
    return new Date(s).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
</script>

<svelte:head><title>{client?.name || 'Cliente'} — ISP Manager</title></svelte:head>

{#if pageError}
  <div class="flex flex-col items-center justify-center py-24 gap-4">
    <AlertCircle size={40} class="text-red-400" />
    <p class="text-slate-700 font-medium">No se pudo cargar el cliente</p>
    <p class="text-sm text-slate-500">{pageError}</p>
    <a href={backHref} class="btn-secondary"><ArrowLeft size={14} /> Volver a {backLabel}</a>
  </div>
{:else}

<!-- Toasts (mobile: bottom-center, desktop: top-right) -->
{#if error}
  <div class="fixed bottom-4 left-4 right-4 sm:top-4 sm:left-auto sm:right-4 sm:bottom-auto z-50
             bg-white rounded-xl shadow-lg border border-red-200 p-4 flex items-start gap-3 max-w-sm sm:max-w-sm mx-auto sm:mx-0">
    <AlertCircle size={18} class="text-red-500 mt-0.5 flex-shrink-0" />
    <span class="text-sm text-red-700">{error}</span>
  </div>
{/if}
{#if success}
  <div class="fixed bottom-4 left-4 right-4 sm:top-4 sm:left-auto sm:right-4 sm:bottom-auto z-50
             bg-white rounded-xl shadow-lg border border-emerald-200 p-4 flex items-start gap-3 max-w-sm sm:max-w-sm mx-auto sm:mx-0">
    <CheckCircle2 size={18} class="text-emerald-500 mt-0.5 flex-shrink-0" />
    <span class="text-sm text-emerald-700">{success}</span>
  </div>
{/if}

<!-- Breadcrumb -->
<div class="text-xs sm:text-[13px] text-slate-500 mb-2 sm:mb-3 truncate">
  <a href="/" class="hover:text-slate-700">ISP Manager</a>
  <span class="mx-1">/</span>
  <a href={backHref} class="hover:text-slate-700">{backLabel}</a>
  <span class="mx-1">/</span>
  <span class="text-slate-700 font-medium">{client?.name || '...'}</span>
</div>

<!-- Page header: mobile stacked, desktop side-by-side -->
<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
  <div class="flex items-center gap-2.5 sm:gap-3 min-w-0 overflow-hidden">
    <a href={backHref} class="btn-icon flex-shrink-0" title="Volver a {backLabel}">
      <ArrowLeft size={20} class="sm:w-[18px] sm:h-[18px]" />
    </a>
    {#if client}
      <div class="w-10 sm:w-12 h-10 sm:h-12 rounded-full bg-gradient-to-br from-brand-800 to-brand-500 flex items-center justify-center text-white font-bold text-base sm:text-lg flex-shrink-0">
        {initials}
      </div>
      <div class="min-w-0 overflow-hidden">
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight break-words leading-snug"
            title={client.name}>
          {client.name}
        </h1>
        <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-medium {STATUS_CLS[client.status] || 'bg-slate-100 text-slate-600'}">
            {STATUS_PT[client.status] || client.status}
          </span>
          {#if client.plan?.name}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{client.plan.name}</span>
          {/if}
          {#if client.zone?.name}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{client.zone.name}</span>
          {/if}
          {#if client.connectionType === 'WIRELESS'}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700">📡 Inalámbrico</span>
          {:else}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">🔵 Fibra óptica</span>
          {/if}
        </div>
      </div>
    {:else}
      <div class="w-10 sm:w-12 h-10 sm:h-12 rounded-full bg-slate-200 animate-pulse"></div>
      <div class="space-y-2">
        <div class="h-6 w-48 bg-slate-200 rounded animate-pulse"></div>
        <div class="h-4 w-32 bg-slate-200 rounded animate-pulse"></div>
      </div>
    {/if}
  </div>

  <!-- Actions: horizontal scroll on mobile.
       Free-plan clients don't ever owe money so the Cobrar entry-point is
       hidden — the in-row modal in /clients also suppresses it. -->
  <div class="flex items-center gap-1.5 sm:gap-2 overflow-x-auto sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 sm:pb-0 scrollbar-thin flex-shrink-0">
    {#if isFreeClient}
      <!-- nothing here — free plan, no debt surface -->
    {:else if pendingAmount > 0}
      <button on:click={openPayment} class="btn-primary whitespace-nowrap">
        <CreditCard size={16} class="sm:w-3.5 sm:h-3.5" /> Registrar pago
        <span class="bg-white/20 px-1.5 py-0.5 rounded-md text-xs tabular-nums">{fmtMoney(pendingAmount)}</span>
      </button>
    {:else}
      <button on:click={openPayment}
              class="btn-secondary whitespace-nowrap">
        <CreditCard size={16} class="sm:w-3.5 sm:h-3.5" /> Registrar pago
      </button>
    {/if}
    <button class="btn-secondary whitespace-nowrap" on:click={openPersonalEdit}>
      <Edit3 size={16} class="sm:w-3.5 sm:h-3.5" /> Editar
    </button>
    <button class="btn-secondary whitespace-nowrap" on:click={openUpdateSheet}
            title="Genera un link de un solo uso para que el cliente actualice sus datos">
      <Share2 size={16} class="sm:w-3.5 sm:h-3.5" />
      <span class="hidden xs:inline">Actualizar</span>
    </button>
    {#if isAdmin($user?.role)}
      <button class="btn-secondary whitespace-nowrap" on:click={toggleStatus} disabled={loadingAction}
              title={client?.status === 'ACTIVE' ? 'Suspender servicio' : 'Activar servicio'}>
        {#if loadingAction}<Loader2 size={16} class="animate-spin sm:w-3.5 sm:h-3.5" />
        {:else if client?.status === 'ACTIVE'}<PauseCircle size={16} class="sm:w-3.5 sm:h-3.5" />
        {:else}<PlayCircle size={16} class="sm:w-3.5 sm:h-3.5" />{/if}
        <span class="hidden xs:inline">{client?.status === 'ACTIVE' ? 'Suspender' : 'Activar'}</span>
      </button>
      <button class="btn-icon hover:!text-red-600 hover:!bg-red-50 shrink-0"
              on:click={() => { deleteConfirmName = ''; delReason = ''; delNote = ''; showDeleteModal = true; }}
              title="Eliminar cliente">
        <Trash2 size={18} class="sm:w-[15px] sm:h-[15px]" />
      </button>
    {/if}
  </div>
</div>

{#if !client}
  <!-- Skeleton placeholders -->
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
    {#each Array(4) as _}
      <div class="card p-3 h-[68px] animate-pulse">
        <div class="h-3 w-20 bg-slate-200 rounded mb-2"></div>
        <div class="h-5 w-24 bg-slate-200 rounded"></div>
      </div>
    {/each}
  </div>
{:else}

<!-- Alerta de MORA — franja delgada, solo cuando hay facturas VENCIDAS.
     Los cobros abiertos que aún no vencen NO encienden esto (se ven en las
     tarjetas KPI + el histórico de Facturas). El detalle por mes vive abajo. -->
{#if overdueInvoices.length > 0}
  <div class="mb-4 sm:mb-6 rounded-xl border border-red-200 bg-red-50 px-4 sm:px-5 py-3
              flex flex-wrap items-center gap-x-3 gap-y-2 justify-between">
    <div class="flex items-center gap-2 flex-wrap text-sm">
      <span class="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
      <span class="font-bold text-red-800">
        {overdueInvoices.length} {overdueInvoices.length === 1 ? 'factura vencida' : 'facturas vencidas'}
      </span>
      <span class="text-red-900 font-mono tabular-nums">· {fmtMoney(overdueAmount)} en mora</span>
      {#if nextDue}
        <span class="text-xs text-red-700/80">· la más antigua venció el {fmtDate(overdueInvoices.slice().sort((a,b)=>new Date(a.dueDate).getTime()-new Date(b.dueDate).getTime())[0]?.dueDate)}</span>
      {/if}
    </div>
    <button on:click={openPayment}
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                   bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors">
      <CreditCard size={14} /> Registrar pago
    </button>
  </div>
{/if}

<!-- KPI strip (design-system .kpi-tile) -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-4 sm:mb-6">
  <div class="kpi-tile">
    <div class="icon-square-{isFreeClient ? 'green' : 'rose'}"><CreditCard size={16} class="sm:w-3.5 sm:h-3.5" /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Saldo Pendiente</div>
      {#if isFreeClient}
        <div class="kpi-value text-emerald-600">$ 0</div>
        <div class="kpi-sub">Plan gratis · sin cobro</div>
      {:else}
        <div class="kpi-value {pendingAmount > 0 ? 'text-orange-600' : 'text-emerald-600'}">{fmtMoney(pendingAmount)}</div>
        <div class="kpi-sub">{pendingInvoices.length} factura{pendingInvoices.length === 1 ? '' : 's'} por cobrar</div>
      {/if}
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-{isOnline ? 'green' : 'amber'}">
      {#if isOnline}<CheckCircle2 size={16} class="sm:w-3.5 sm:h-3.5" />{:else}<PauseCircle size={16} class="sm:w-3.5 sm:h-3.5" />{/if}
    </div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Estado servicio</div>
      <div class="kpi-value text-base {isOnline ? 'text-emerald-600' : 'text-amber-600'}">{isOnline ? 'En línea' : 'Suspendido'}</div>
      <div class="kpi-sub">{client.mikrotikAccount?.username || 'Sin PPPoE'}</div>
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-{isFreeClient ? 'green' : 'amber'}"><Calendar size={16} class="sm:w-3.5 sm:h-3.5" /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Próximo Vencimiento</div>
      {#if isFreeClient}
        <div class="kpi-value text-base text-emerald-600">—</div>
        <div class="kpi-sub">No aplica</div>
      {:else}
        <div class="kpi-value text-base {nextDue && isOverdueInvoice(nextDue) ? 'text-red-600' : 'text-slate-900'}">
          {nextDue ? fmtDate(nextDue.dueDate) : '—'}
        </div>
        <div class="kpi-sub">{nextDue ? (isOverdueInvoice(nextDue) ? 'Vencida' : 'Próxima a vencer') : 'Sin pendientes'}</div>
      {/if}
    </div>
  </div>
  <div class="kpi-tile">
    <div class="icon-square-blue"><FileCheck size={16} class="sm:w-3.5 sm:h-3.5" /></div>
    <div class="kpi-tile-text">
      <div class="kpi-label">Facturas pagadas</div>
      <div class="kpi-value">{paidInvoices.length}</div>
      <div class="kpi-sub">de {client.invoices?.length || 0} totales</div>
    </div>
  </div>
</div>

<!-- Main content: 2/3 + 1/3 -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-6">

  <!-- LEFT: Datos personales + Facturas + Pagos -->
  <div class="lg:col-span-2 space-y-3 sm:space-y-4">

    <!-- Datos Personales -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <User size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Datos Personales</h2>
        </div>
        {#if !editPersonal}
          <button class="btn-icon" on:click={openPersonalEdit} title="Editar">
            <Edit3 size={14} />
          </button>
        {/if}
      </div>
      <div class="card-body">
        {#if editPersonal}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <label class="label" for="ed-name">Nombre Completo *</label>
              <input id="ed-name" class="input" bind:value={formPersonal.fullName} required />
            </div>
            <div>
              <label class="label" for="ed-doctype">Tipo Documento</label>
              <select id="ed-doctype" class="select" bind:value={formPersonal.documentType}>
                <option value="CC">Cédula</option>
                <option value="NIT">NIT</option>
                <option value="CE">Cédula Extranjería</option>
                <option value="PAS">Pasaporte</option>
              </select>
            </div>
            <div>
              <label class="label" for="ed-docnum">Número</label>
              <input id="ed-docnum" class="input" bind:value={formPersonal.documentNumber} />
            </div>
            <div class="md:col-span-2">
              <label class="label" for="ed-email">Email</label>
              <input id="ed-email" type="email" class="input" bind:value={formPersonal.email} />
            </div>
            <div class="md:col-span-2">
              <label class="label" for="ed-phone">Teléfono</label>
              <input id="ed-phone" class="input" bind:value={formPersonal.phone} />
            </div>
            <div class="md:col-span-2">
              <label class="label" for="ed-addr">Dirección</label>
              <input id="ed-addr" class="input" bind:value={formPersonal.address} />
            </div>
            <div>
              <label class="label" for="ed-neigh">Barrio</label>
              <input id="ed-neigh" class="input" bind:value={formPersonal.neighborhood} />
            </div>
            <div>
              <label class="label" for="ed-city">Ciudad</label>
              <input id="ed-city" class="input" bind:value={formPersonal.city} />
            </div>

            <!-- Fechas -->
            <div>
              <label class="label" for="ed-contract">Fecha de Contrato</label>
              <input id="ed-contract" type="date" class="input" bind:value={formPersonal.contractDate} />
            </div>
            <div>
              <label class="label" for="ed-install">Fecha de Instalación</label>
              <input id="ed-install" type="date" class="input" bind:value={formPersonal.installationDate} />
            </div>

            <!-- Plan + override de precio -->
            <div>
              <label class="label" for="ed-plan">Plan</label>
              <select id="ed-plan" class="select" bind:value={formPersonal.planId}>
                <option value="">Sin plan</option>
                {#each plansForEdit as p}
                  <option value={p.id}>
                    {p.name} — ${((p.monthlyPrice || 0) / 100).toLocaleString('es-CO')} COP
                  </option>
                {/each}
              </select>
            </div>
            <div>
              <label class="label" for="ed-fee">
                Precio mensual <span class="text-slate-400 text-xs font-normal">(opcional)</span>
              </label>
              <div class="flex">
                <span class="inline-flex items-center px-3 rounded-l-lg border border-r-0
                             border-slate-200 bg-slate-50 text-slate-700 text-sm font-mono">COP</span>
                <input id="ed-fee" type="number" min="0" step="1000"
                       bind:value={formPersonal.monthlyFee}
                       placeholder="Hereda del plan"
                       class="input flex-1 rounded-l-none font-mono" />
              </div>
            </div>

            <div>
              <label class="label" for="ed-conn">Tecnología de conexión</label>
              <select id="ed-conn" class="input" bind:value={formPersonal.connectionType}>
                <option value="FIBER">🔵 Fibra óptica</option>
                <option value="WIRELESS">📡 Inalámbrico</option>
              </select>
            </div>

            <div class="md:col-span-2">
              <label class="label" for="ed-notes">Notas</label>
              <textarea id="ed-notes" rows="2" class="input resize-none"
                        bind:value={formPersonal.notes}
                        placeholder="Observaciones del cliente..."></textarea>
            </div>

            <!-- PPPoE / MikroTik -->
            <div class="md:col-span-2 mt-2 pt-3 border-t border-slate-100">
              <div class="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Servicio PPPoE
              </div>
            </div>
            {#if client?.mikrotikAccount?.username}
              <div class="md:col-span-2">
                <div class="label">Usuario PPPoE</div>
                <div class="text-sm font-mono text-slate-700 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  {client.mikrotikAccount?.username}
                </div>
              </div>
            {/if}
            <div class="md:col-span-2">
              <div class="label">Contraseña PPPoE</div>
              <div class="flex items-start gap-2">
                <div class="flex-1 text-sm font-mono text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  ••••••••
                </div>
                <span class="text-xs text-slate-400 italic leading-relaxed mt-1">
                  Para cambiar la contraseña usa el flujo dedicado de cambio de credenciales.
                </span>
              </div>
            </div>
            <div>
              <label class="label" for="ed-mk-profile">Perfil PPPoE</label>
              <input id="ed-mk-profile" type="text" class="input font-mono"
                     bind:value={formPersonal.mikrotik.profileName}
                     placeholder="Online_basico" />
            </div>
            <div>
              <label class="label" for="ed-mk-remote">Remote Address (IP cliente)</label>
              <input id="ed-mk-remote" type="text" class="input font-mono"
                     bind:value={formPersonal.mikrotik.remoteAddress} />
            </div>
            <div>
              <label class="label" for="ed-mk-local">Local Address (gateway)</label>
              <input id="ed-mk-local" type="text" class="input font-mono"
                     bind:value={formPersonal.mikrotik.localAddress} />
            </div>
            <div class="md:col-span-2">
              <label class="label" for="ed-mk-coords">Coordenadas GPS</label>
              <input id="ed-mk-coords" type="text" class="input font-mono"
                     bind:value={formPersonal.mikrotik.coordinates}
                     placeholder="3.850149,-76.492356" />
            </div>

            <div class="md:col-span-2 flex items-center gap-2 pt-2">
              <button class="btn-primary" on:click={savePersonal} disabled={loadingAction}>
                {#if loadingAction}<Loader2 size={14} class="animate-spin" />{/if}
                Guardar y cerrar
              </button>
              <button class="btn-ghost" on:click={() => { clearTimeout(autoSaveTimer); editPersonal = false; resetForm(); }}>Cerrar</button>
              <!-- Autosave status -->
              <span class="ml-auto text-[11px] inline-flex items-center gap-1.5">
                {#if autoSaveState === 'pending'}
                  <span class="text-slate-400">Cambios sin guardar…</span>
                {:else if autoSaveState === 'saving'}
                  <Loader2 size={11} class="animate-spin text-slate-400" />
                  <span class="text-slate-500">Guardando…</span>
                {:else if autoSaveState === 'saved'}
                  <span class="text-emerald-600 font-medium">✓ Guardado automáticamente
                    {autoSaveAt ? autoSaveAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                {:else if autoSaveState === 'error'}
                  <span class="text-red-600" title={autoSaveError}>⚠ No se pudo autoguardar — revisa los datos</span>
                {/if}
              </span>
            </div>
          </div>
        {:else}
          <div class="grid grid-cols-1 xs:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <div class="label !mb-1">Documento</div>
              <div class="text-sm sm:text-[13px] font-medium text-slate-900">{client.documentType || ''} {client.documentNumber || '—'}</div>
            </div>
            <div>
              <div class="label !mb-1">Zona</div>
              <div class="text-sm sm:text-[13px] font-medium text-slate-900">{client.zone?.name || '—'}</div>
            </div>

            <div class="col-span-1 xs:col-span-2">
              <div class="label !mb-1">Email</div>
              {#if client.email}
                <a href="mailto:{client.email}" class="text-sm sm:text-[13px] font-medium text-brand-800 hover:underline inline-flex items-center gap-1.5">
                  <Mail size={14} class="sm:w-3.5 sm:h-3.5" /> {client.email}
                </a>
              {:else}
                <div class="text-sm text-slate-400">—</div>
              {/if}
            </div>

            <div>
              <div class="label !mb-1">Teléfono</div>
              {#if client.phone}
                <div class="flex items-center gap-2 flex-wrap">
                  <a href="tel:{digitsOnly(client.phone)}" class="text-sm sm:text-[13px] font-medium text-slate-900 hover:text-brand-800 inline-flex items-center gap-1.5">
                    <Phone size={14} class="sm:w-3.5 sm:h-3.5" /> {client.phone}
                  </a>
                  <a href="https://wa.me/{digitsOnly(client.phone)}" target="_blank" rel="noopener"
                     class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] sm:text-[10px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                    <MessageSquare size={12} class="sm:w-[11px] sm:h-[11px]" /> WhatsApp
                  </a>
                </div>
              {:else}
                <div class="text-sm text-slate-400">—</div>
              {/if}
            </div>

            <div>
              <div class="label !mb-1">Dirección</div>
              <div class="text-sm sm:text-[13px] font-medium text-slate-900 flex items-start gap-1.5">
                {#if client.address}<MapPin size={14} class="sm:w-3.5 sm:h-3.5 mt-0.5 text-slate-400 flex-shrink-0" />{/if}
                <span>{client.address || '—'}{client.neighborhood ? `, ${client.neighborhood}` : ''}</span>
              </div>
            </div>

            <div class="col-span-1 xs:col-span-2">
              <div class="label !mb-1">Antigüedad</div>
              <div class="text-sm sm:text-[13px] text-slate-700" title="Fecha de creación: {fmtDate(client.installationDate || client.createdAt)}">
                {getClientDuration()}
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Facturas -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <FileText size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Facturas</h2>
          <span class="text-xs text-slate-500">({client.invoices?.length || 0})</span>
        </div>
      </div>
      {#if !client.invoices || client.invoices.length === 0}
        <div class="p-8 text-center text-sm text-slate-400">Sin facturas registradas</div>
      {:else}
        <!-- Desktop: table -->
        <div class="hidden sm:block overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th class="text-right">Monto</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th class="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {#each client.invoices.slice(0, 8) as inv}
                <tr>
                  <td class="font-mono text-xs text-slate-600">{inv.invoiceNumber}</td>
                  <td class="text-right font-mono font-medium tabular-nums">{fmtMoney(inv.total)}</td>
                  <td class="{isOverdueInvoice(inv) ? 'text-red-600 font-medium' : 'text-slate-600'}">
                    {fmtDate(inv.dueDate)}
                  </td>
                  <td>
                    <span class="badge {INVOICE_CLS[inv.status] || 'bg-slate-100 text-slate-600'}">
                      {inv.status}
                    </span>
                  </td>
                  <td class="text-right">
                    {#if inv.status === 'PAID' || inv.status === 'PARTIAL'}
                      <button class="text-xs text-brand-800 hover:underline font-medium inline-flex items-center gap-1"
                              on:click={() => openPaymentDetails(inv)}
                              title="Ver detalle del pago">
                        <Receipt size={12} /> Ver pago
                      </button>
                    {:else if inv.status !== 'CANCELLED'}
                      <div class="flex items-center gap-1">
                        <button class="text-xs text-brand-700 hover:underline font-semibold"
                                on:click={() => payInvoice(inv.id)}>
                          Registrar pago
                        </button>
                        <button class="text-xs text-brand-700 hover:underline font-semibold" title="Reenviar el cobro al cliente (correo + WhatsApp)"
                                on:click={() => resendCharge(inv.id)} disabled={resendBusyId === inv.id}>
                          {resendBusyId === inv.id ? 'Enviando…' : 'Reenviar cobro'}
                        </button>
                        <button class="text-xs text-violet-700 hover:underline font-medium" title="Copiar link de pago"
                                on:click={() => genLink(inv.id, 'copy')} disabled={linkBusyId === inv.id}>Copiar</button>
                        <button class="text-xs text-violet-700 hover:underline font-medium" title="Enviar por WhatsApp"
                                on:click={() => genLink(inv.id, 'whatsapp')} disabled={linkBusyId === inv.id}>WhatsApp</button>
                      </div>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <!-- Mobile: cards -->
        <div class="sm:hidden divide-y divide-slate-100">
          {#each client.invoices.slice(0, 8) as inv}
            <div class="px-4 py-3 flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="font-mono text-xs text-slate-600">#{inv.invoiceNumber}</span>
                  <span class="badge {INVOICE_CLS[inv.status] || 'bg-slate-100 text-slate-600'}">
                    {inv.status}
                  </span>
                </div>
                <div class="flex items-center gap-3 text-xs text-slate-500">
                  <span>Vence: {fmtDate(inv.dueDate)}</span>
                  <span class="font-mono font-medium text-slate-900">{fmtMoney(inv.total)}</span>
                </div>
              </div>
              <div class="flex-shrink-0">
                {#if inv.status === 'PAID' || inv.status === 'PARTIAL'}
                  <button class="btn-ghost text-xs" on:click={() => openPaymentDetails(inv)}>
                    <Receipt size={12} /> Ver
                  </button>
                {:else if inv.status !== 'CANCELLED'}
                  <div class="flex items-center gap-1">
                    <button class="btn-ghost text-xs text-brand-700 font-semibold"
                            on:click={() => payInvoice(inv.id)}>
                      Registrar pago
                    </button>
                    <button class="btn-ghost text-xs text-brand-700 font-semibold" title="Reenviar el cobro al cliente"
                            on:click={() => resendCharge(inv.id)} disabled={resendBusyId === inv.id}>
                      {resendBusyId === inv.id ? 'Enviando…' : 'Reenviar cobro'}
                    </button>
                    <button class="btn-ghost text-xs text-violet-700" title="Copiar link de pago"
                            on:click={() => genLink(inv.id, 'copy')} disabled={linkBusyId === inv.id}>Copiar</button>
                    <button class="btn-ghost text-xs text-violet-700" title="Enviar por WhatsApp"
                            on:click={() => genLink(inv.id, 'whatsapp')} disabled={linkBusyId === inv.id}>WhatsApp</button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Historial Pagos -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <CreditCard size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Historial de Pagos</h2>
          <span class="text-xs text-slate-500">({recentPayments.length})</span>
        </div>
      </div>
      {#if recentPayments.length === 0}
        <div class="p-8 text-center text-sm text-slate-400">Sin pagos registrados</div>
      {:else}
        <!-- Desktop: table -->
        <div class="hidden sm:block overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th class="text-right">Monto</th>
                <th>Método</th>
                <th>Factura</th>
                <th>Notas</th>
                <th class="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {#each recentPayments.slice(0, 10) as pay}
                <tr>
                  <td class="text-slate-600">{fmtDate(pay.createdAt)}</td>
                  <td class="text-right font-mono font-medium tabular-nums">{fmtMoney(pay.amount)}</td>
                  <td><span class="badge bg-slate-100 text-slate-600">{PAYMENT_METHOD_PT[pay.method] || pay.method}</span></td>
                  <td class="font-mono text-xs text-slate-600">
                    {#if invoiceNumberFor(pay.invoiceId)}
                      <button class="hover:text-brand-800 hover:underline"
                              on:click={() => openPaymentDetailsByInvoiceId(pay.invoiceId)}>
                        {invoiceNumberFor(pay.invoiceId)}
                      </button>
                    {:else}—{/if}
                  </td>
                  <td class="text-slate-500 text-xs truncate max-w-[180px]" title={pay.notes || ''}>{pay.notes || '—'}</td>
                  <td class="text-right">
                    <button class="text-xs text-brand-800 hover:underline font-medium inline-flex items-center gap-1"
                            on:click={() => openPaymentDetailsByInvoiceId(pay.invoiceId)}
                            title="Ver detalle">
                      <Receipt size={12} /> Detalle
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <!-- Mobile: cards -->
        <div class="sm:hidden divide-y divide-slate-100">
          {#each recentPayments.slice(0, 10) as pay}
            <div class="px-4 py-3">
              <div class="flex items-center justify-between gap-2 mb-1">
                <span class="text-xs text-slate-500">{fmtDate(pay.createdAt)}</span>
                <span class="font-mono font-medium text-sm text-slate-900 tabular-nums">{fmtMoney(pay.amount)}</span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="badge bg-slate-100 text-slate-600 text-[10px]">{PAYMENT_METHOD_PT[pay.method] || pay.method}</span>
                  {#if invoiceNumberFor(pay.invoiceId)}
                    <span class="text-xs text-slate-500">Factura #{invoiceNumberFor(pay.invoiceId)}</span>
                  {/if}
                </div>
                <button class="btn-ghost text-xs"
                        on:click={() => openPaymentDetailsByInvoiceId(pay.invoiceId)}>
                  <Receipt size={12} /> Detalle
                </button>
              </div>
              {#if pay.notes}
                <div class="text-xs text-slate-400 mt-1 truncate">{pay.notes}</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Notificaciones (Centro de Notificaciones ↔ Clientes) -->
    <div class="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-4 sm:p-5">
      <div class="flex items-center gap-2 mb-3">
        <Bell size={18} class="text-brand-600" />
        <h2 class="font-semibold text-slate-900">Notificaciones</h2>
        <button class="btn-secondary btn-sm ml-auto" on:click={toggleSend}>
          <Send size={14} /> Enviar notificación
        </button>
        <a href="/notifications" class="text-xs text-brand-600 hover:underline">Centro</a>
      </div>

      {#if sendOpen}
        <!-- Mini-formulario: enviar una plantilla a ESTE cliente. Lo masivo va
             por el Centro de Notificaciones. -->
        <div class="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label for="notif-tpl" class="label">Plantilla</label>
              <select id="notif-tpl" bind:value={sendForm.templateId} on:change={onNotifTplChange} class="select text-sm">
                <option value="">Seleccionar…</option>
                {#each notifTemplates as t (t.id)}
                  <option value={t.id}>{t.name} — {NOTIF_CHANNEL_LABEL[t.channel] ?? t.channel}</option>
                {/each}
              </select>
              {#if notifTplLoaded && notifTemplates.length === 0}
                <p class="text-[11px] text-amber-700 mt-1">No hay plantillas activas. Créalas en el Centro de Notificaciones.</p>
              {/if}
            </div>
            <div>
              <label for="notif-channel" class="label">Canal</label>
              <select id="notif-channel" bind:value={sendForm.channel} class="select text-sm">
                {#each ['EMAIL', 'WHATSAPP', 'BOTH'] as ch}
                  {@const enabled = !selectedNotifTpl || selectedNotifTpl.channel === ch || ch === 'BOTH'}
                  <option value={ch} disabled={!enabled}>{NOTIF_CHANNEL_LABEL[ch]}</option>
                {/each}
              </select>
            </div>
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" bind:checked={sendForm.generatePaymentLinks} class="w-4 h-4" />
            Generar link de pago (factura pendiente más antigua)
          </label>
          {#if sendMsg}
            <p class="text-[11px] inline-flex items-center gap-1 {sendMsg.type === 'success' ? 'text-emerald-700' : 'text-red-600'}">
              {#if sendMsg.type === 'success'}<CheckCircle2 size={12} />{:else}<AlertCircle size={12} />{/if}
              {sendMsg.text}
            </p>
          {/if}
          <div class="flex items-center gap-2">
            <button class="btn-primary btn-sm" on:click={sendNotification} disabled={sending || !sendForm.templateId}>
              {#if sending}<Loader2 size={14} class="animate-spin" /> Enviando…{:else}<Send size={14} /> Enviar a este cliente{/if}
            </button>
            <button class="btn-secondary btn-sm" on:click={() => sendOpen = false} disabled={sending}>Cancelar</button>
          </div>
        </div>
      {/if}
      {#if !notifLoading && !notifError && notifications.length > 0}
        <!-- Resumen: cuántas recibió y cuántas vio -->
        <div class="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span class="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 font-semibold">{notifReceived} recibida{notifReceived === 1 ? '' : 's'}</span>
          <span class="px-2.5 py-1 rounded-lg {notifOpened > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'} font-medium">
            {notifOpened} vista{notifOpened === 1 ? '' : 's'}
          </span>
          {#if notifFailed > 0}<span class="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 font-medium">{notifFailed} fallida{notifFailed === 1 ? '' : 's'}</span>{/if}
          <span class="text-[11px] text-slate-400" title="La apertura se detecta en WhatsApp (leído) y en correos con seguimiento; algunos correos pueden no reportarla.">ⓘ</span>
        </div>
      {/if}
      {#if notifLoading}
        <div class="text-sm text-slate-400 py-4 flex items-center gap-2"><Loader2 size={14} class="animate-spin" /> Cargando…</div>
      {:else if notifError}
        <div class="text-sm text-red-600 py-2">{notifError}</div>
      {:else if notifications.length === 0}
        <div class="text-sm text-slate-400 py-4">Aún no se han enviado notificaciones a este cliente.</div>
      {:else}
        <ul class="divide-y divide-slate-100">
          {#each notifications as n (n.id)}
            <li class="py-2.5 flex items-start gap-3">
              <div class="mt-0.5">
                {#if n.channel === 'WHATSAPP'}<MessageSquare size={15} class="text-emerald-600" />
                {:else}<Mail size={15} class="text-brand-600" />{/if}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm text-slate-800 truncate">{n.subject || notifTypeLabel(n.type)}</div>
                <div class="text-xs text-slate-400">{fmtNotifDate(n.sentAt || n.createdAt)}{n.recipient ? ' · ' + n.recipient : ''}</div>
                {#if n.error}<div class="text-xs text-red-500 truncate mt-0.5">{n.error}</div>{/if}
              </div>
              <span class="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap {notifStatusClass(n.status)}">{notifStatusLabel(n.status)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Equipos / Inventario del cliente -->
    <div class="card mt-4">
      <div class="card-header flex items-center justify-between">
        <h2 class="font-semibold text-slate-900 flex items-center gap-2"><Boxes size={16} class="text-brand-600" /> Equipos asignados</h2>
        <button class="btn-secondary btn-sm" on:click={openInvModal}><Plus size={14} /> Asignar equipo</button>
      </div>
      <div class="card-body">
        {#if invLoading}
          <div class="flex items-center gap-2 text-sm text-slate-500 py-4"><Loader2 size={14} class="animate-spin" /> Cargando equipos…</div>
        {:else if invItems.length === 0}
          <div class="text-center py-6 text-slate-400 text-sm">
            <Package size={28} class="mx-auto mb-2 text-slate-300" />
            Este cliente no tiene equipos asignados.
          </div>
        {:else}
          <ul class="divide-y divide-slate-100">
            {#each invItems as it (it.id)}
              <li class="flex items-center gap-3 py-2.5">
                <div class="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                  {#if it.product?.imageUrl}<img src={invImg(it.product.imageUrl)} alt="" class="w-full h-full object-cover" />{:else}<Package size={16} class="text-slate-400" />{/if}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-slate-900 text-sm truncate">{it.product?.name || '—'}</div>
                  <div class="text-[11px] text-slate-500 font-mono truncate">
                    {it.serial ? `S/N ${it.serial}` : 'Sin serial'}{it.product?.category ? ` · ${it.product.category}` : ''}
                  </div>
                </div>
                <button class="btn-icon hover:!text-red-600 shrink-0" title="Devolver a bodega" on:click={() => removeInvItem(it)}><Trash2 size={14} /></button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>

  <!-- RIGHT: Servicio PPPoE (sticky) -->
  <div class="lg:col-span-1">
    <div class="card lg:sticky lg:top-4">
      <div class="card-header">
        <div class="flex items-center gap-2 min-w-0">
          <Wifi size={16} class="text-slate-600" />
          <h2 class="font-semibold text-slate-900">Servicio PPPoE</h2>
          {#if client.mikrotikAccount}
            <span class="px-2.5 py-0.5 rounded-full text-xs font-medium {isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
              {isOnline ? 'Online' : 'Offline'}
            </span>
          {/if}
        </div>
      </div>
      <div class="card-body">
        {#if client.mikrotikAccount}
          <div class="space-y-3">
            <div>
              <div class="label !mb-1">Usuario</div>
              <div class="flex items-center gap-2">
                <div class="text-xs font-mono text-slate-900 bg-slate-50 px-2 py-1.5 rounded flex-1 truncate">
                  {client.mikrotikAccount?.username || '—'}
                </div>
                <button class="btn-icon" title="Copiar usuario"
                        on:click={() => copyText(client?.mikrotikAccount?.username || '', 'user')}>
                  {#if copied === 'user'}<Check size={14} class="text-emerald-600" />{:else}<Copy size={14} />{/if}
                </button>
              </div>
            </div>

            <div>
              <div class="label !mb-1">Contraseña</div>
              <div class="flex items-center gap-2">
                <div class="text-xs font-mono text-slate-900 bg-slate-50 px-2 py-1.5 rounded flex-1 truncate">
                  {showPassword ? (client.mikrotikAccount?.password || '••••••••') : '••••••••'}
                </div>
                <button class="btn-icon" title={showPassword ? 'Ocultar' : 'Mostrar'} on:click={() => showPassword = !showPassword}>
                  {#if showPassword}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                </button>
                <button class="btn-icon" title="Copiar contraseña"
                        on:click={() => copyText(client?.mikrotikAccount?.password || '', 'pwd')}>
                  {#if copied === 'pwd'}<Check size={14} class="text-emerald-600" />{:else}<Copy size={14} />{/if}
                </button>
              </div>
            </div>

            <div>
              <div class="label !mb-1">IP Asignada</div>
              <div class="flex items-center gap-2">
                <div class="text-xs font-mono text-slate-900 bg-slate-50 px-2 py-1.5 rounded flex-1 truncate">
                  {client.mikrotikAccount?.remoteAddress || '—'}
                </div>
                {#if client.mikrotikAccount?.remoteAddress}
                  <button class="btn-icon" title="Copiar IP"
                          on:click={() => copyText(client?.mikrotikAccount?.remoteAddress || '', 'ip')}>
                    {#if copied === 'ip'}<Check size={14} class="text-emerald-600" />{:else}<Copy size={14} />{/if}
                  </button>
                {/if}
              </div>
            </div>

            <div>
              <div class="label !mb-1">IP Local</div>
              <div class="text-xs font-mono text-slate-700">{client.mikrotikAccount?.localAddress || '—'}</div>
            </div>

            <div>
              <div class="label !mb-1">Plan</div>
              <div class="text-sm font-medium text-slate-900">{client.plan?.name || 'Sin plan'}</div>
              {#if client.plan?.downloadSpeed && client.plan?.uploadSpeed}
                <div class="text-xs text-slate-500 mt-0.5">
                  {client.plan.downloadSpeed}↓ / {client.plan.uploadSpeed}↑ Mbps
                </div>
              {/if}
            </div>

            {#if client.coordinates}
              <div>
                <div class="label !mb-1">Coordenadas</div>
                <a href="https://www.google.com/maps?q={client.coordinates}" target="_blank" rel="noopener"
                   class="text-xs font-mono text-brand-800 hover:underline inline-flex items-center gap-1">
                  <MapPin size={12} /> {client.coordinates}
                </a>
              </div>
            {/if}
          </div>
        {:else}
          <div class="text-center py-8 text-slate-400 text-sm">
            <Wifi size={28} class="mx-auto mb-2 opacity-50" />
            Sin servicio PPPoE configurado
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- ─── Evidencias Fotográficas ───────────────────────────────── -->
<div class="card mb-6">
  <div class="card-header">
    <div class="flex items-center gap-2">
      <ImageIcon size={16} class="text-slate-600" />
      <h3 class="font-semibold text-slate-900">Evidencias Fotográficas</h3>
      {#if evidence.length > 0}
        <span class="text-xs text-text-secondary">· {evidence.length}</span>
      {/if}
    </div>
  </div>
  <div class="card-body">

    <!-- Hidden inputs (camera + gallery) -->
    <input type="file" accept="image/*" capture="environment" class="hidden"
           bind:this={cameraInput} on:change={onPickFiles} />
    <input type="file" accept="image/*" multiple class="hidden"
           bind:this={galleryInput} on:change={onPickFiles} />

    {#if pendingFiles.length === 0}
      <!-- Upload action buttons -->
      <div class="flex flex-wrap gap-2 mb-4">
        <button type="button" on:click={() => cameraInput?.click()} class="btn-primary">
          <Camera size={16} /> Tomar foto
        </button>
        <button type="button" on:click={() => galleryInput?.click()} class="btn-secondary">
          <ImageUp size={16} /> Subir desde galería
        </button>
      </div>

      <!-- Gallery -->
      {#if evidenceLoading}
        <div class="flex items-center justify-center gap-2 py-8 text-slate-500 text-sm">
          <Loader2 size={14} class="animate-spin" /> Cargando evidencias...
        </div>
      {:else if evidenceError}
        <div class="flex items-start gap-2 bg-red-50 border border-red-200
                    text-red-700 rounded-xl px-3 py-2.5 text-sm">
          <AlertCircle size={14} class="mt-0.5 flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <div>{evidenceError}</div>
            <button type="button" on:click={loadEvidence}
                    class="mt-1 text-xs text-brand-600 hover:underline font-medium">
              Reintentar
            </button>
          </div>
        </div>
      {:else if evidence.length === 0}
        <div class="text-center py-8 text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
          <ImageIcon size={28} class="mx-auto mb-2 opacity-50" />
          Aún no hay evidencias. Toma o sube la primera foto.
        </div>
      {:else}
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {#each evidence as photo (photo.id)}
            <div class="relative group">
              <button type="button" on:click={() => lightboxPhoto = photo}
                      class="block w-full aspect-square overflow-hidden rounded-lg
                             border border-slate-200 bg-slate-50 hover:border-brand-600
                             active:scale-[0.98] transition">
                <img src={photo.fileUrl} alt={photo.description || 'Evidencia'}
                     class="w-full h-full object-cover" loading="lazy" />
              </button>
              <button type="button" on:click={() => deleteEvidence(photo)}
                      title="Eliminar evidencia"
                      class="absolute top-1 right-1 p-1.5 rounded-md
                             bg-white/90 hover:bg-red-600 hover:text-white
                             text-slate-600 shadow-sm
                             opacity-0 group-hover:opacity-100 transition">
                <Trash2 size={12} />
              </button>
              <div class="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                <span class="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 font-medium">
                  {EVIDENCE_TYPE_LABEL[photo.type] ?? photo.type}
                </span>
                <span class="truncate">{fmtEvDate(photo.createdAt)}</span>
              </div>
            </div>
          {/each}
        </div>
      {/if}

    {:else}
      <!-- Preview + save flow -->
      <div class="space-y-4">
        <div class="text-sm font-medium text-text-primary">
          {pendingFiles.length} {pendingFiles.length === 1 ? 'foto lista' : 'fotos listas'} para subir
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {#each pendingPreviews as src, i}
            <div class="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
              <img {src} alt="Vista previa {i+1}" class="w-full h-full object-cover" />
            </div>
          {/each}
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label for="ev-type" class="label">Tipo de evidencia</label>
            <select id="ev-type" bind:value={evidenceType} class="select">
              <option value="installation">Instalación</option>
              <option value="support">Soporte técnico</option>
              <option value="visit">Visita</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <div>
            <label for="ev-desc" class="label">Observación (opcional)</label>
            <input id="ev-desc" type="text" bind:value={evidenceDescription}
                   placeholder="Detalle breve, dirección, hito..." class="input" />
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 pt-2">
          <button type="button" on:click={discardPending} disabled={uploading} class="btn-secondary">
            <X size={15} /> Descartar
          </button>
          <button type="button" on:click={uploadPending} disabled={uploading} class="btn-primary">
            {#if uploading}
              <Loader2 size={15} class="animate-spin" /> Subiendo...
            {:else}
              <CheckCircle2 size={15} /> Guardar evidencia
            {/if}
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
{/if}

<!-- Lightbox -->
{#if lightboxPhoto}
  <div class="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4"
       on:click|self={() => lightboxPhoto = null}>
    <div class="relative max-w-4xl max-h-[90vh] w-full">
      <button type="button" on:click={() => lightboxPhoto = null}
              class="absolute -top-3 -right-3 sm:top-3 sm:right-3 p-2.5 rounded-full
                     bg-white text-slate-700 hover:bg-slate-100 shadow-lg
                     min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Cerrar">
        <X size={18} />
      </button>
      <img src={lightboxPhoto.fileUrl} alt={lightboxPhoto.description || 'Evidencia'}
           class="max-h-[80vh] w-auto mx-auto rounded-xl shadow-2xl" />
      <div class="mt-3 text-center text-white text-sm">
        <div class="flex items-center justify-center gap-2 flex-wrap">
          <span class="px-2 py-0.5 rounded bg-white/15 text-xs font-medium">
            {EVIDENCE_TYPE_LABEL[lightboxPhoto.type] ?? lightboxPhoto.type}
          </span>
          <span class="text-white/70 text-xs">{fmtEvDate(lightboxPhoto.createdAt)}</span>
        </div>
        {#if lightboxPhoto.description}
          <p class="mt-2 text-white/90 text-sm">{lightboxPhoto.description}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Modal Eliminar -->
{#if showDeleteModal}
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" on:click|self={() => showDeleteModal = false}>
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-md">
      <div class="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
          <Trash2 size={18} class="text-red-600" />
        </div>
        <div>
          <h3 class="text-base font-semibold text-slate-900">Eliminar Cliente</h3>
          <p class="text-xs text-slate-500">Esta acción no se puede deshacer</p>
        </div>
      </div>
      <div class="p-6 space-y-3">
        <div class="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={16} class="shrink-0 mt-0.5" />
          <span>Se eliminarán también <b>todas las facturas y pagos</b> de este cliente. No se puede deshacer.</span>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">Motivo de la baja</label>
          <select class="input" bind:value={delReason}>
            <option value="">— Sin especificar —</option>
            {#each DELETE_REASONS as opt}<option value={opt.value}>{opt.label}</option>{/each}
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-600 mb-1">Nota (opcional)</label>
          <input class="input" bind:value={delNote} maxlength="500" placeholder="Detalle del motivo…" />
        </div>
        <p class="text-sm text-slate-600">
          Para confirmar, escribe el nombre exacto del cliente:
          <span class="font-semibold text-slate-900">{client?.name}</span>
        </p>
        <input class="input" bind:value={deleteConfirmName} placeholder={client?.name} />
      </div>
      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button class="btn-secondary" on:click={() => showDeleteModal = false}>Cancelar</button>
        <button class="btn-danger"
                on:click={deleteClient}
                disabled={deleting || deleteConfirmName !== client?.name}>
          {#if deleting}<Loader2 size={14} class="animate-spin" /> Eliminando...{:else}<Trash2 size={14} /> Eliminar Cliente{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal Ver Pago (detalle / evidencia) -->
{#if showPaymentDetails}
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" on:click|self={() => showPaymentDetails = false}>
    <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <div class="flex items-center gap-2">
          <Receipt size={18} class="text-brand-800" />
          <h3 class="text-lg font-semibold text-slate-900">Detalle del pago</h3>
        </div>
        <button class="text-slate-400 hover:text-slate-600" on:click={() => showPaymentDetails = false}>
          <X size={20} />
        </button>
      </div>

      <div class="p-6 space-y-4 overflow-y-auto">
        <!-- Invoice context -->
        <div class="bg-slate-50 rounded-lg p-3 border border-slate-100 grid grid-cols-2 gap-3">
          <div>
            <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Factura</div>
            <div class="text-sm font-mono font-medium text-slate-900">{paymentDetailsInvoice?.invoiceNumber || '—'}</div>
          </div>
          <div>
            <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Estado</div>
            <span class="badge {INVOICE_CLS[paymentDetailsInvoice?.status || ''] || 'bg-slate-100 text-slate-600'}">
              {paymentDetailsInvoice?.status || '—'}
            </span>
          </div>
          <div>
            <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Total factura</div>
            <div class="text-sm font-mono tabular-nums">{fmtMoney(paymentDetailsInvoice?.total)}</div>
          </div>
          <div>
            <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Saldo</div>
            <div class="text-sm font-mono tabular-nums {(paymentDetailsInvoice?.balanceDue ?? 0) > 0 ? 'text-orange-600' : 'text-emerald-600'}">
              {fmtMoney(paymentDetailsInvoice?.balanceDue ?? 0)}
            </div>
          </div>
        </div>

        {#if paymentDetailsList.length === 0}
          <div class="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-sm">
            No hay pagos registrados para esta factura.
          </div>
        {:else}
          <div class="space-y-3">
            {#each paymentDetailsList as p, idx}
              <div class="border border-slate-200 rounded-lg p-3 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Pago {idx + 1} de {paymentDetailsList.length}
                  </div>
                  <span class="badge bg-slate-100 text-slate-600">{PAYMENT_METHOD_PT[p.method] || p.method}</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Monto</div>
                    <div class="text-sm font-mono font-semibold tabular-nums text-emerald-700">{fmtMoney(p.amount)}</div>
                  </div>
                  <div>
                    <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Fecha</div>
                    <div class="text-sm text-slate-700">{fmtDateTime(p.createdAt)}</div>
                  </div>
                  {#if p.status}
                    <div>
                      <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Estado</div>
                      <div class="text-sm text-slate-700">{p.status}</div>
                    </div>
                  {/if}
                  {#if p.transactionId}
                    <div>
                      <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Transacción</div>
                      <div class="text-xs font-mono text-slate-700 truncate" title={p.transactionId}>{p.transactionId}</div>
                    </div>
                  {/if}
                  {#if p.externalId}
                    <div>
                      <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">ID externo</div>
                      <div class="text-xs font-mono text-slate-700 truncate" title={p.externalId}>{p.externalId}</div>
                    </div>
                  {/if}
                </div>

                {#if p.notes}
                  <div>
                    <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Notas</div>
                    <div class="text-xs text-slate-700 whitespace-pre-wrap break-words">{p.notes}</div>
                  </div>
                {/if}

                {#if extractUrls(p.notes).length > 0}
                  <div class="pt-1 border-t border-slate-100">
                    <div class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Evidencia / comprobante</div>
                    <div class="flex flex-wrap gap-2">
                      {#each extractUrls(p.notes) as url}
                        <a href={url} target="_blank" rel="noopener"
                           class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-brand-800 hover:bg-blue-100 text-xs font-medium">
                          <ExternalLink size={12} /> Abrir comprobante
                        </a>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button class="btn-secondary" type="button" on:click={() => showPaymentDetails = false}>Cerrar</button>
      </div>
    </div>
  </div>
{/if}

<!-- Registrar pago (modal único: facturas pendientes + comprobante) -->
{#if showPaymentModal}
  <RegisterPaymentModal
    {client}
    invoices={pendingInvoices}
    preselectInvoiceId={payInvoiceId || null}
    on:done={onPaymentDone}
    on:close={() => showPaymentModal = false} />
{/if}

<!-- ─── Sheet: solicitar actualización pública ─────────────────────── -->
<Sheet bind:open={showUpdateSheet} title="Solicitar actualización de datos" maxWidth="max-w-lg">
  {#if !updateResult}
    <!-- ── Step 1: configure channels ───────────────────────────────── -->
    <div class="space-y-5 p-5">
      <p class="text-sm text-text-secondary">
        Genera un enlace de un solo uso (válido 7 días) para que
        <strong>{client?.name || 'el cliente'}</strong> actualice sus datos
        de contacto, documento y suba fotos sin necesidad de iniciar sesión.
      </p>

      <!-- Send channels -->
      <div>
        <div class="label !mb-2">Enviar enlace al cliente vía</div>
        <div class="space-y-2">
          {#each ['EMAIL', 'WHATSAPP'] as ch}
            {@const disabled = (ch === 'EMAIL' && !client?.email) || (ch === 'WHATSAPP' && !client?.phone)}
            <label class="flex items-center gap-2 p-2.5 rounded-lg border
                          {updateSendChannels.includes(ch)
                            ? 'border-brand-600 bg-brand-50/40'
                            : 'border-slate-200 hover:border-slate-300'}
                          {disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}">
              <input type="checkbox"
                     checked={updateSendChannels.includes(ch)}
                     disabled={disabled}
                     on:change={() => !disabled && toggleSendChannel(ch)}
                     class="rounded border-slate-300 text-brand-600 focus:ring-brand-600/30" />
              {#if ch === 'EMAIL'}<Mail size={14} class="text-slate-500" />{/if}
              {#if ch === 'WHATSAPP'}<MessageSquare size={14} class="text-emerald-600" />{/if}
              <span class="text-sm font-medium text-text-primary">{fmtChannel(ch)}</span>
              {#if ch === 'EMAIL' && !client?.email}
                <span class="text-xs text-text-muted ml-auto">cliente sin email</span>
              {:else if ch === 'WHATSAPP' && !client?.phone}
                <span class="text-xs text-text-muted ml-auto">cliente sin teléfono</span>
              {/if}
            </label>
          {/each}
        </div>
        <div class="mt-2 flex items-start gap-2 p-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50">
          <Link2 size={14} class="text-slate-500 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-text-secondary">
            <strong class="text-text-primary">Manual:</strong> no selecciones ningún canal y, al generar,
            copia el enlace para enviarlo tú mismo (ej. desde tu propio WhatsApp).
          </p>
        </div>
      </div>

      <!-- Notify channels -->
      <div>
        <div class="label !mb-2">Notificarme cuando el cliente lo complete vía</div>
        <div class="flex flex-wrap gap-2">
          {#each ['EMAIL', 'WHATSAPP'] as ch}
            <button type="button"
                    on:click={() => toggleNotifyChannel(ch)}
                    class="px-4 min-h-[44px] text-sm rounded-lg border font-medium
                           {updateNotifyChannels.includes(ch)
                             ? 'border-brand-600 bg-brand-50/40 text-brand-800'
                             : 'border-slate-200 text-slate-600 hover:border-slate-300'}">
              {fmtChannel(ch)}
            </button>
          {/each}
        </div>
      </div>

      {#if updateError}
        <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
          <AlertCircle size={14} /> {updateError}
        </div>
      {/if}
    </div>

    <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
      <button type="button" class="btn-secondary" on:click={() => showUpdateSheet = false}>
        Cancelar
      </button>
      <button type="button" class="btn-primary" on:click={requestUpdateToken} disabled={updateSending}>
        {#if updateSending}
          <Loader2 size={14} class="animate-spin" /> Generando...
        {:else}
          <Link2 size={14} /> Generar enlace
        {/if}
      </button>
    </div>

  {:else}
    <!-- ── Step 2: token created, show URL + dispatch results ────── -->
    <div class="space-y-4 p-5">
      <div class="flex items-start gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
        <CheckCircle2 size={18} class="text-emerald-600 flex-shrink-0 mt-0.5" />
        <div class="text-sm text-emerald-800">
          <div class="font-semibold">Enlace generado</div>
          <div class="text-xs text-emerald-700 mt-0.5">
            Vence el {new Date(updateResult.expiresAt).toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })}.
          </div>
        </div>
      </div>

      <!-- Public URL -->
      <div>
        <div class="label !mb-1">URL pública (single-use)</div>
        <div class="flex items-center gap-2">
          <input type="text" readonly value={updateResult.publicUrl}
                 class="input flex-1 font-mono text-xs" />
          <button type="button" class="btn-secondary" on:click={copyUpdateUrl}>
            {#if updateCopied}
              <Check size={14} class="text-emerald-600" /> Copiado
            {:else}
              <Copy size={14} /> Copiar
            {/if}
          </button>
        </div>
      </div>

      <!-- WhatsApp message (manual copy / WhatsApp Web) -->
      {#if updateResult.whatsappMessage}
        <div>
          <div class="label !mb-1 flex items-center gap-1.5"><MessageSquare size={13} class="text-emerald-600" /> Mensaje de WhatsApp</div>
          <textarea readonly rows="8" class="input w-full text-xs font-mono leading-relaxed resize-none">{updateResult.whatsappMessage}</textarea>
          <div class="flex items-center gap-2 mt-2">
            <button type="button" class="btn-secondary" on:click={copyUpdateMsg}>
              {#if updateMsgCopied}<Check size={14} class="text-emerald-600" /> Copiado{:else}<Copy size={14} /> Copiar mensaje{/if}
            </button>
            {#if updateResult.whatsappWebUrl}
              <a href={updateResult.whatsappWebUrl} target="_blank" rel="noopener"
                 class="btn-primary !bg-emerald-600 hover:!bg-emerald-700 inline-flex items-center gap-1.5">
                <ExternalLink size={14} /> Abrir WhatsApp Web
              </a>
            {/if}
          </div>
          <p class="text-xs text-text-muted mt-1.5">Cópialo y pégalo en WhatsApp, o ábrelo con el mensaje ya listo para enviar.</p>
        </div>
      {/if}

      <!-- Email preview (mismo contenido que WhatsApp, plantilla branded) -->
      {#if updateResult.emailHtml}
        <div>
          <div class="label !mb-1 flex items-center gap-1.5"><Mail size={13} class="text-slate-500" /> {channelOk(updateResult,'EMAIL') ? 'Correo enviado (vista del mensaje)' : 'Correo — previsualización (no enviado)'}</div>
          <div class="rounded-lg border border-slate-200 overflow-hidden bg-white">
            <iframe title="Previsualización del correo" srcdoc={updateResult.emailHtml} class="w-full" style="height:300px;border:0;" sandbox=""></iframe>
          </div>
          <p class="text-xs text-text-muted mt-1.5">Mismo contenido que WhatsApp. Asunto: {updateResult.emailSubject}</p>
        </div>
      {/if}

      <!-- Dispatch results -->
      {#if updateResult.sendChannels?.length > 0}
        <div>
          <div class="label !mb-2">Envío al cliente</div>
          <ul class="space-y-1.5">
            {#each updateResult.sendChannels as ch}
              <li class="flex items-center gap-2 text-sm">
                {#if channelOk(updateResult, ch)}
                  <CheckCircle2 size={14} class="text-emerald-600" />
                  <span class="text-emerald-700">{fmtChannel(ch)} — enviado</span>
                {:else if channelErr(updateResult, ch)}
                  <AlertCircle size={14} class="text-amber-600" />
                  <span class="text-amber-700">{fmtChannel(ch)} — {channelErr(updateResult, ch)}</span>
                {:else}
                  <Loader2 size={14} class="text-slate-400" />
                  <span class="text-text-muted">{fmtChannel(ch)} — pendiente</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if updateResult.notifyChannels?.length > 0}
        <p class="text-xs text-text-muted">
          Recibirás aviso por <strong>{updateResult.notifyChannels.map(fmtChannel).join(', ')}</strong> cuando el cliente envíe los cambios.
        </p>
      {/if}
    </div>

    <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50">
      <button type="button" class="btn-primary" on:click={() => showUpdateSheet = false}>
        Listo
      </button>
    </div>
  {/if}
</Sheet>

<!-- ░░ Asignar equipo del inventario ░░ -->
<Sheet bind:open={invModalOpen} title="Asignar equipo al cliente" maxWidth="max-w-md">
  <form id="inv-assign-form" class="space-y-4" on:submit|preventDefault={saveInvItem}>
    {#if invError}<div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm"><AlertCircle size={14} class="mt-0.5" /> {invError}</div>{/if}
    {#if invProducts.filter(p => p.isActive).length === 0}
      <p class="text-sm text-slate-500">No hay productos en el catálogo. Crea uno primero en <a href="/clients/inventory" class="text-brand-700 hover:underline">Inventario</a>.</p>
    {/if}
    <div>
      <label for="inv-prod" class="label">Producto *</label>
      <select id="inv-prod" class="select" bind:value={invForm.productId}>
        <option value="">— Selecciona un producto —</option>
        {#each invProducts.filter(p => p.isActive) as p}<option value={p.id}>{p.name}{p.category ? ` (${p.category})` : ''}</option>{/each}
      </select>
    </div>
    <div>
      <label for="inv-serial" class="label">Serial</label>
      <input id="inv-serial" class="input font-mono" bind:value={invForm.serial} placeholder="Ej: 48575443XXXXXXXX" />
      <p class="text-[11px] text-slate-400 mt-1">Opcional, pero debe ser único si lo registras.</p>
    </div>
    <div>
      <label for="inv-notes" class="label">Notas</label>
      <textarea id="inv-notes" rows="2" class="input" bind:value={invForm.notes} placeholder="Opcional"></textarea>
    </div>
  </form>
  <svelte:fragment slot="footer">
    <button type="button" class="btn-secondary" on:click={() => invModalOpen = false} disabled={invSaving}>Cancelar</button>
    <button type="submit" form="inv-assign-form" class="btn-primary" disabled={invSaving}>
      {#if invSaving}<Loader2 size={15} class="animate-spin" />{/if} Asignar
    </button>
  </svelte:fragment>
</Sheet>

{/if}
