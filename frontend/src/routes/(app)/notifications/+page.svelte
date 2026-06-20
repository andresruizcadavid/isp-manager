<script>
  import { onMount, onDestroy } from 'svelte';
  import { notificationsApi } from '$lib/api/notifications.api.js';
  import { smtpApi, SMTP_PRESETS } from '$lib/api/smtp.api.js';
  import { whatsappApi } from '$lib/api/whatsapp.api.js';
  import { zonesApi } from '$lib/api/zones.api.js';
  import { plansApi } from '$lib/api/plans.api.js';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import {
    Bell, Send, FileText, History as HistoryIcon, Plus, Pencil, Trash2,
    Mail, MessageSquare, MessageCircle, Layers, CheckCircle2, AlertCircle, Loader2,
    Save, X, Filter, RefreshCw, Eye, Server, Lock, User as UserIcon,
    Eye as EyeIcon, EyeOff, ChevronDown, ChevronUp, Copy, Stethoscope, Phone,
    Play, FlaskConical, Search
  } from 'lucide-svelte';

  let tab = 'campaigns'; // campaigns | templates | history | smtp | whatsapp

  // ── Shared lookups ──────────────────────────────────────
  let zones = [];
  let plans = [];

  onMount(async () => {
    [zones, plans] = await Promise.all([
      zonesApi.getAll().catch(() => []),
      plansApi.getAll().catch(() => [])
    ]);
    await Promise.all([loadTemplates(), loadCampaigns(), loadHistory()]);
  });

  // ── Templates ───────────────────────────────────────────
  let templates = [];
  let tplLoading = false;
  async function loadTemplates() {
    tplLoading = true;
    try { templates = await notificationsApi.listTemplates(); }
    catch (e) { console.error(e); }
    finally { tplLoading = false; }
  }

  let tplModalOpen = false;
  let tplEditing = null;
  let tplForm = emptyTpl();
  let tplSaving = false;
  let tplError = '';

  // Email presets — must mirror EMAIL_PRESETS in backend/src/services/email-base.template.js.
  // `event` describes the transactional email this preset governs when the
  // template is active (besides driving the header icon + title).
  const EMAIL_PRESETS = [
    { key: '',                     icon: '📣', title: 'Aviso importante (por defecto)', event: 'Solo para campañas / avisos generales' },
    { key: 'invoice',              icon: '🧾', title: 'Tu factura ya está lista',        event: 'Correo de factura emitida' },
    { key: 'reminder',             icon: '⏰', title: 'Recuerda pagar tu internet',      event: 'Recordatorios de pago' },
    { key: 'service_suspended',    icon: '⛔', title: 'Tu servicio está suspendido',     event: 'Aviso de suspensión' },
    { key: 'service_activated',    icon: '✅', title: '¡Tu internet está activo!',       event: 'Aviso de reactivación' },
    { key: 'payment_received',     icon: '✅', title: '¡Recibimos tu pago!',             event: 'Confirmación de pago' },
    { key: 'welcome',              icon: '🎉', title: '¡Bienvenido a Internet Online!',  event: 'Correo de bienvenida (cliente nuevo)' },
    { key: 'general_announcement', icon: '📣', title: 'Tenemos un aviso para ti',        event: 'Avisos generales / campañas' }
  ];

  // ── Vista previa con el diseño real de marca (renderizada por el backend) ──
  let tplPreviewHtml = '';
  let tplPreviewSubject = '';
  let tplPreviewLoading = false;
  let tplPreviewTimer = null;
  async function loadTplPreview() {
    if (tplForm.channel !== 'EMAIL') return;
    tplPreviewLoading = true;
    try {
      const r = await notificationsApi.previewTemplate({
        preset:  tplForm.preset || '',
        subject: tplForm.subject || '',
        body:    tplForm.body || ''
      });
      tplPreviewHtml = r?.html || '';
      tplPreviewSubject = r?.subject || '';
    } catch (e) {
      tplPreviewHtml = '';
    } finally {
      tplPreviewLoading = false;
    }
  }
  // Debounced live refresh while the modal is open and editing an EMAIL template.
  $: if (tplModalOpen && tplForm.channel === 'EMAIL'
         && (tplForm.preset, tplForm.subject, tplForm.body, true)) {
    clearTimeout(tplPreviewTimer);
    tplPreviewTimer = setTimeout(loadTplPreview, 350);
  }

  // Suggested subject + body per preset. Used to seed the form when the
  // operator picks a preset and the body is still empty (or via the
  // "Usar contenido sugerido" button to override).
  const PRESET_SAMPLES = {
    invoice: {
      subject: 'Tu factura {{plan}} está lista',
      body: `Estimado(a) {{name}},

Hemos generado tu factura por el plan {{plan}}.

• Monto a pagar: {{amount}}
• Fecha de vencimiento: {{dueDate}}

Realiza tu pago antes de la fecha de corte para mantener tu servicio activo.

Link de pago: {{paymentLink}}

Datos de contacto:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

— Equipo internet-online`
    },
    reminder: {
      subject: 'Recuerda pagar antes del {{dueDate}}',
      body: `Estimado(a) {{name}},

Tu pago de internet está próximo a vencer.

• Plan: {{plan}}
• Monto pendiente: {{amount}}
• Fecha de vencimiento: {{dueDate}}

Realiza tu pago antes de la fecha de corte para evitar la suspensión del servicio.

Link de pago: {{paymentLink}}

Contacto:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

Horarios: Lunes a Sábado, 8:00 am a 6:00 pm

— Equipo internet-online`
    },
    service_suspended: {
      subject: 'Tu servicio de internet fue suspendido',
      body: `Estimado(a) {{name}},

Te informamos que tu servicio de internet fue suspendido temporalmente por falta de pago.

Para reactivarlo:
1. Realiza el pago de la factura pendiente ({{amount}}).
2. Comunícate con nosotros para confirmarlo.
3. Reactivaremos tu servicio en menos de 24 horas.

WhatsApp: 323 6329425
Email: contacto@internetonline.co

— Equipo internet-online`
    },
    service_activated: {
      subject: 'Tu servicio está activo nuevamente',
      body: `Estimado(a) {{name}},

¡Bienvenido(a) de vuelta! Tu servicio de internet ya está activo y puedes navegar con normalidad.

Si presentas algún problema técnico, contáctanos:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

— Equipo internet-online`
    },
    payment_received: {
      subject: 'Recibimos tu pago — Gracias',
      body: `Estimado(a) {{name}},

Confirmamos la recepción de tu pago por {{amount}}. ¡Gracias!

Tu servicio continúa activo sin interrupciones.

Para cualquier consulta:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

— Equipo internet-online`
    },
    welcome: {
      subject: '¡Bienvenido(a) a internet-online!',
      body: `Estimado(a) {{name}},

¡Bienvenido(a) a internet-online! Ya formas parte de nuestra red.

• Plan contratado: {{plan}}
• IP asignada: {{ip}}
• Zona: {{zone}}

Si necesitas soporte técnico o tienes preguntas:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

Horarios: Lunes a Sábado, 8:00 am a 6:00 pm

— Equipo internet-online`
    },
    general_announcement: {
      subject: 'Aviso importante',
      body: `Estimado(a) {{name}},

[Escribe aquí tu mensaje]

Si tienes alguna pregunta:
WhatsApp: 323 6329425
Email: contacto@internetonline.co

— Equipo internet-online`
    }
  };

  // Auto-fill subject + body when the preset changes AND the body is still
  // empty (so we never overwrite the operator's work silently). If they want
  // to overwrite an existing body, they use the "Usar sugerido" button.
  function onPresetChange() {
    if (!tplForm.preset) return;
    const sample = PRESET_SAMPLES[tplForm.preset];
    if (!sample) return;
    if (!tplForm.body || tplForm.body.trim() === '') {
      tplForm.body = sample.body;
    }
    if (!tplForm.subject || tplForm.subject.trim() === '') {
      tplForm.subject = sample.subject;
    }
  }

  function useSampleNow() {
    const sample = PRESET_SAMPLES[tplForm.preset];
    if (!sample) return;
    if (tplForm.body && tplForm.body.trim() !== '') {
      if (!confirm('Se reemplazará el contenido actual del cuerpo y asunto con el ejemplo. ¿Continuar?')) return;
    }
    tplForm.body = sample.body;
    tplForm.subject = sample.subject;
  }

  function emptyTpl() {
    return { name: '', channel: 'EMAIL', subject: '', body: '', preset: '', isActive: true };
  }
  function openNewTpl() {
    tplEditing = null;
    tplForm = emptyTpl();
    tplError = '';
    tplModalOpen = true;
  }
  function openEditTpl(t) {
    tplEditing = t;
    tplForm = {
      name: t.name, channel: t.channel,
      subject: t.subject || '', body: t.body,
      preset: t.preset || '',
      isActive: t.isActive
    };
    tplError = '';
    tplModalOpen = true;
  }
  async function saveTpl() {
    if (!tplForm.name.trim() || !tplForm.body.trim()) {
      tplError = 'Nombre y cuerpo son obligatorios.';
      return;
    }
    tplSaving = true; tplError = '';
    try {
      const payload = {
        name: tplForm.name.trim(),
        channel: tplForm.channel,
        subject: tplForm.channel === 'EMAIL' ? (tplForm.subject || '') : null,
        body: tplForm.body,
        preset: tplForm.channel === 'EMAIL' ? (tplForm.preset || null) : null,
        isActive: tplForm.isActive
      };
      if (tplEditing) {
        const updated = await notificationsApi.updateTemplate(tplEditing.id, payload);
        templates = templates.map(t => t.id === tplEditing.id ? updated : t);
      } else {
        const created = await notificationsApi.createTemplate(payload);
        templates = [created, ...templates];
      }
      tplModalOpen = false;
    } catch (e) { tplError = e.message || 'No se pudo guardar.'; }
    finally { tplSaving = false; }
  }
  async function removeTpl(t) {
    if (!confirm(
      `¿Eliminar la plantilla "${t.name}"?\n\n` +
      `Esta acción no se puede deshacer. Las campañas históricas conservarán su contenido ` +
      `enviado, pero perderán el enlace a esta plantilla.`
    )) return;
    try {
      await notificationsApi.removeTemplate(t.id);
      templates = templates.filter(x => x.id !== t.id);
    } catch (e) { alert(e.message); }
  }

  // ── Campaigns ───────────────────────────────────────────
  let campaigns = [];
  let cmpLoading = false;
  async function loadCampaigns() {
    cmpLoading = true;
    try { campaigns = await notificationsApi.listCampaigns(); }
    catch (e) { console.error(e); }
    finally { cmpLoading = false; }
  }

  let cmpModalOpen = false;
  let cmpForm = emptyCmp();
  let cmpSaving = false;
  let cmpError = '';
  let audiencePreview = null;
  let previewLoading = false;
  let audienceList = [];           // first 200 matched clients (for review)
  let audienceListLoading = false;
  let audienceListOpen = false;    // expand/collapse the review list
  let cmpSelected = new Set();      // explicit recipient selection (client ids)
  // One-shot: when editing/cloning a campaign that saved an explicit
  // clientIds selection, restore THAT selection when the list loads instead
  // of the "select everyone" default. Consumed (nulled) on first load.
  let cmpInitialSelection = null;
  // Id of the DRAFT campaign being edited in place (PUT). null = new/clone.
  let cmpEditingId = null;
  // Single-client test send (the campaign is sent to just this one client).
  let cmpTestClientId = '';
  let cmpTesting = false;
  let cmpTestMsg = null;            // { type: 'success'|'error', text }
  // Live search to filter the recipient list (name / email / phone / zone / plan).
  let cmpSearch = '';

  function emptyCmp() {
    return {
      name: '', templateId: '', channel: 'EMAIL', generatePaymentLinks: false,
      audience: { zoneId: '', planId: '', status: '', overdue: false }
    };
  }
  function resetCmpModalState() {
    cmpError = '';
    audiencePreview = null;
    audienceList = [];
    audienceListOpen = false;
    cmpTestClientId = '';
    cmpTesting = false;
    cmpTestMsg = null;
    cmpSearch = '';
  }

  function openNewCmp() {
    cmpForm = emptyCmp();
    cmpEditingId = null;
    cmpInitialSelection = null;
    resetCmpModalState();
    cmpModalOpen = true;
  }

  // "Editar" opens the campaign config. A DRAFT is edited in place (saving =
  // PUT, no send). A campaign that already ran is immutable history, so we
  // open it as a CLONE ("Copia de…") that saves as a new draft — the original
  // run + its history stay intact. Either way, editing never sends anything;
  // launching is a separate explicit action.
  function openEditCmp(c) {
    const audience = c.audienceJson
      ? (typeof c.audienceJson === 'string' ? JSON.parse(c.audienceJson) : c.audienceJson)
      : {};
    const isDraft = c.status === 'draft';
    cmpEditingId = isDraft ? c.id : null;
    cmpForm = {
      name:       isDraft ? c.name : `Copia de ${c.name}`,
      templateId: c.templateId || '',
      channel:    c.channel || 'EMAIL',
      generatePaymentLinks: !!c.generatePaymentLinks,
      audience: {
        zoneId:  audience.zoneId  ?? '',
        planId:  audience.planId  ?? '',
        status:  audience.status  ?? '',
        overdue: !!audience.overdue
      }
    };
    resetCmpModalState();
    // Preserve the campaign's saved explicit recipient selection (if any) so
    // editing shows exactly who was picked, not the select-all default.
    cmpInitialSelection = Array.isArray(audience.clientIds) && audience.clientIds.length
      ? audience.clientIds : null;
    cmpModalOpen = true;
  }

  // "Reenviar" launches a fresh campaign with the exact same template +
  // audience as the source one, without opening the modal. Used for quick
  // re-runs of a recurring announcement.
  // ── Campaign diagnostics ────────────────────────────────
  let diagOpen = false;
  let diagLoading = false;
  let diagData = null;
  let diagError = '';

  async function openDiagnose(c) {
    diagOpen = true;
    diagLoading = true;
    diagError = '';
    diagData = null;
    try {
      diagData = await notificationsApi.diagnoseCampaign(c.id);
    } catch (e) {
      diagError = e.message || 'No se pudo cargar el diagnóstico.';
    } finally {
      diagLoading = false;
    }
  }

  async function resendCmp(c) {
    if (!confirm(`Reenviar la campaña "${c.name}" con los mismos parámetros?\n\nSe creará una nueva ejecución con la misma plantilla y audiencia.`)) return;
    try {
      const audience = c.audienceJson
        ? (typeof c.audienceJson === 'string' ? JSON.parse(c.audienceJson) : c.audienceJson)
        : {};
      const created = await notificationsApi.createCampaign({
        name:       `${c.name} (reenvío)`,
        templateId: c.templateId,
        channel:    c.channel,
        generatePaymentLinks: !!c.generatePaymentLinks,
        audience
      });
      campaigns = [created, ...campaigns];
      pollCampaign(created.id);
    } catch (e) {
      alert(e.message || 'No se pudo reenviar la campaña.');
    }
  }

  // Delete a campaign row. The delivery history survives (the backend keeps
  // NotificationLog rows, just unlinked), so this only clears the list.
  async function deleteCmp(c) {
    if (!confirm(`¿Eliminar la campaña "${c.name}"?\n\nEl historial de envíos se conserva en la pestaña Historial.`)) return;
    try {
      await notificationsApi.removeCampaign(c.id);
      campaigns = campaigns.filter(x => x.id !== c.id);
    } catch (e) {
      alert(e.message || 'No se pudo eliminar la campaña.');
    }
  }

  async function loadAudienceList() {
    const filter = {};
    if (cmpForm.audience.zoneId)  filter.zoneId  = cmpForm.audience.zoneId;
    if (cmpForm.audience.planId)  filter.planId  = cmpForm.audience.planId;
    if (cmpForm.audience.status)  filter.status  = cmpForm.audience.status;
    if (cmpForm.audience.overdue) filter.overdue = true;
    audienceListLoading = true;
    try {
      const res = await notificationsApi.previewClients(filter);
      audienceList = res?.clients || [];
      // Default selection: restore the saved selection when editing (one-shot),
      // otherwise select everyone in the candidate list.
      if (cmpInitialSelection) {
        const valid = new Set(audienceList.map(c => c.id));
        cmpSelected = new Set(cmpInitialSelection.filter(id => valid.has(id)));
        cmpInitialSelection = null;
      } else {
        cmpSelected = new Set(audienceList.map(c => c.id));
      }
      // Default the test recipient to the first selected (or first candidate)
      // so "Enviar prueba" works without an extra pick. Drop a stale id.
      if (!audienceList.some(c => c.id === cmpTestClientId)) {
        cmpTestClientId = [...cmpSelected][0] || audienceList[0]?.id || '';
      }
    } catch (e) {
      cmpError = e.message;
      audienceList = [];
      cmpSelected = new Set();
    } finally { audienceListLoading = false; }
  }
  async function previewAudience() {
    previewLoading = true;
    try {
      const filter = {};
      if (cmpForm.audience.zoneId)  filter.zoneId  = cmpForm.audience.zoneId;
      if (cmpForm.audience.planId)  filter.planId  = cmpForm.audience.planId;
      if (cmpForm.audience.status)  filter.status  = cmpForm.audience.status;
      if (cmpForm.audience.overdue) filter.overdue = true;
      const res = await notificationsApi.previewAudience(filter);
      audiencePreview = res?.count ?? 0;
    } catch (e) { audiencePreview = null; cmpError = e.message; }
    finally { previewLoading = false; }
  }
  // Re-preview whenever audience filter changes. We depend on primitives
  // (audienceKey) instead of the whole audience object so writes to OTHER
  // cmpForm fields don't refire the preview.
  $: audienceKey = `${cmpForm.audience.zoneId}|${cmpForm.audience.planId}|${cmpForm.audience.status}|${cmpForm.audience.overdue}`;
  $: if (cmpModalOpen && audienceKey) {
    previewAudience();
    loadAudienceList();   // auto-load so the operator can pick recipients
  }

  // Helper: does this client have a contact for the chosen channel? Used ONLY
  // to warn — selection is NEVER blocked. The operator decides who receives;
  // clients without a contact will simply be logged as "fallidos".
  function hasChannelContact(c, channel = cmpForm.channel) {
    if (channel === 'WHATSAPP') return !!c.phone;
    if (channel === 'BOTH')     return !!(c.email || c.phone);
    return !!c.email; // EMAIL
  }
  // (selection defaulting happens in loadAudienceList — deterministic, and it
  // honors cmpInitialSelection when editing a campaign with saved clientIds.)
  $: cmpAllSelected = audienceList.length > 0 && cmpSelected.size === audienceList.length;
  $: cmpTruncated   = audienceList.length < (audiencePreview ?? 0);
  $: cmpNoContact   = audienceList.filter(c => !hasChannelContact(c, cmpForm.channel)).length;
  // How many of the SELECTED recipients actually have an open invoice — i.e.
  // will get a Wompi link when generatePaymentLinks is on. null = toggle off.
  $: cmpLinkEligible = cmpForm.generatePaymentLinks
    ? audienceList.filter(c => cmpSelected.has(c.id) && c.invoices?.length).length
    : null;
  const fmtCop = (cents) => '$' + Math.round((cents || 0) / 100).toLocaleString('es-CO');
  // Recipients we'll send to: the explicit selection, except "todos" on a
  // truncated list → defer to the filter so clients beyond the shown 200 count.
  $: cmpSendCount   = (cmpTruncated && cmpAllSelected) ? (audiencePreview ?? 0) : cmpSelected.size;

  function toggleClient(id) {
    const s = new Set(cmpSelected);
    s.has(id) ? s.delete(id) : s.add(id);
    cmpSelected = s;
  }
  function toggleAllClients() {
    cmpSelected = (cmpSelected.size >= audienceList.length) ? new Set() : new Set(audienceList.map(c => c.id));
  }

  // ── Live recipient search ─────────────────────────────────────────
  // Filters the already-loaded candidates client-side (name/email/phone/zone/
  // plan). The selection (cmpSelected) persists across searches — searching
  // only changes what's VISIBLE, never what's chosen.
  $: cmpFilteredList = (() => {
    const q = cmpSearch.trim().toLowerCase();
    if (!q) return audienceList;
    return audienceList.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.zone?.name || '').toLowerCase().includes(q) ||
      (c.plan?.name || '').toLowerCase().includes(q)
    );
  })();
  // Header checkbox acts on the CURRENTLY VISIBLE (filtered) rows so the
  // operator can "select all matching X" without touching hidden selections.
  $: cmpVisibleAllSelected  = cmpFilteredList.length > 0 && cmpFilteredList.every(c => cmpSelected.has(c.id));
  $: cmpVisibleSomeSelected = cmpFilteredList.some(c => cmpSelected.has(c.id));
  function toggleAllVisible() {
    const s = new Set(cmpSelected);
    if (cmpVisibleAllSelected) cmpFilteredList.forEach(c => s.delete(c.id));
    else                       cmpFilteredList.forEach(c => s.add(c.id));
    cmpSelected = s;
  }

  // tplSelected depends on the primitive templateId — safe to be reactive.
  $: tplSelected = templates.find(t => t.id === cmpForm.templateId) || null;

  // Auto-pick a compatible channel when the operator selects a template.
  // Moved out of a reactive `$:` block (which created a cycle with cmpForm)
  // into an explicit on:change handler on the template <select>.
  function onTemplateChange() {
    const tpl = templates.find(t => t.id === cmpForm.templateId);
    if (!tpl) return;
    if (cmpForm.channel !== 'BOTH' && cmpForm.channel !== tpl.channel) {
      cmpForm.channel = tpl.channel;
    }
  }

  // Build the {name, templateId, channel, generatePaymentLinks, audience}
  // payload from the current form state. Shared by save-draft and launch.
  function buildCampaignPayload() {
    const filter = {};
    if (cmpForm.audience.zoneId)  filter.zoneId  = cmpForm.audience.zoneId;
    if (cmpForm.audience.planId)  filter.planId  = cmpForm.audience.planId;
    if (cmpForm.audience.status)  filter.status  = cmpForm.audience.status;
    if (cmpForm.audience.overdue) filter.overdue = true;
    // Explicit recipient selection — unless "todos" is marked on a truncated
    // list, where we defer to the filter so everyone matching is included.
    if (!(cmpTruncated && cmpAllSelected)) {
      filter.clientIds = [...cmpSelected];
    }
    return {
      name: cmpForm.name.trim(),
      templateId: cmpForm.templateId,
      channel: cmpForm.channel,
      generatePaymentLinks: cmpForm.generatePaymentLinks,
      audience: filter
    };
  }

  // Returns an error string or '' if the form is valid. `requireRecipients`
  // is false for save-draft (you can save an incomplete audience) and true
  // for launch.
  function validateCmpForm(requireRecipients) {
    if (!cmpForm.templateId) return 'Selecciona una plantilla.';
    if (cmpForm.name.trim().length < 2) return 'El nombre de la campaña debe tener al menos 2 caracteres.';
    if (requireRecipients && cmpSendCount === 0) return 'Selecciona al menos un cliente.';
    return '';
  }

  // Save configuration WITHOUT sending. Updates the draft in place (PUT) when
  // editing one, otherwise creates a new draft.
  async function saveDraft() {
    const err = validateCmpForm(false);
    if (err) { cmpError = err; return; }
    cmpSaving = true; cmpError = '';
    try {
      const payload = buildCampaignPayload();
      let saved;
      if (cmpEditingId) {
        saved = await notificationsApi.updateCampaign(cmpEditingId, payload);
        campaigns = campaigns.map(x => x.id === saved.id ? { ...x, ...saved } : x);
      } else {
        saved = await notificationsApi.createCampaign({ ...payload, mode: 'draft' });
        campaigns = [saved, ...campaigns];
      }
      cmpModalOpen = false;
      tab = 'campaigns';
    } catch (e) { cmpError = e.message || 'No se pudo guardar el borrador.'; }
    finally { cmpSaving = false; }
  }

  // Send now. When editing a draft we persist the edits first, then launch it;
  // otherwise we create + launch in one call.
  async function launchNow() {
    const err = validateCmpForm(true);
    if (err) { cmpError = err; return; }
    cmpSaving = true; cmpError = '';
    try {
      const payload = buildCampaignPayload();
      let created;
      if (cmpEditingId) {
        await notificationsApi.updateCampaign(cmpEditingId, payload);
        created = await notificationsApi.launchCampaign(cmpEditingId);
        campaigns = campaigns.map(x => x.id === created.id ? { ...x, ...created } : x);
      } else {
        created = await notificationsApi.createCampaign({ ...payload, mode: 'launch' });
        campaigns = [created, ...campaigns];
      }
      cmpModalOpen = false;
      tab = 'campaigns';
      pollCampaign(created.id);
    } catch (e) { cmpError = e.message || 'No se pudo lanzar la campaña.'; }
    finally { cmpSaving = false; }
  }

  // Launch an existing draft straight from the list (no modal).
  async function executeDraft(c) {
    if (!confirm(`¿Lanzar la campaña "${c.name}" ahora?`)) return;
    try {
      const updated = await notificationsApi.launchCampaign(c.id);
      campaigns = campaigns.map(x => x.id === c.id ? { ...x, ...updated } : x);
      pollCampaign(c.id);
    } catch (e) {
      alert(e.message || 'No se pudo lanzar la campaña.');
    }
  }

  // Send the campaign as a TEST to a single selected client (real data, real
  // contact). Logged separately — never counts as a campaign.
  async function sendTest() {
    if (!cmpForm.templateId) { cmpTestMsg = { type: 'error', text: 'Selecciona una plantilla primero.' }; return; }
    if (!cmpTestClientId)    { cmpTestMsg = { type: 'error', text: 'Elige un cliente de la lista para la prueba.' }; return; }
    cmpTesting = true; cmpTestMsg = null;
    try {
      const r = await notificationsApi.testCampaign({
        clientId: cmpTestClientId,
        templateId: cmpForm.templateId,
        channel: cmpForm.channel,
        generatePaymentLinks: cmpForm.generatePaymentLinks
      });
      const who = r?.client?.name || 'el cliente';
      if ((r?.sent ?? 0) > 0) {
        cmpTestMsg = { type: 'success', text: `Prueba enviada a ${who}.` };
      } else {
        const missing = cmpForm.channel === 'WHATSAPP' ? 'teléfono' : 'email';
        cmpTestMsg = { type: 'error', text: `No se pudo enviar la prueba a ${who}. Verifica que tenga ${missing} válido.` };
      }
    } catch (e) { cmpTestMsg = { type: 'error', text: e.message || 'No se pudo enviar la prueba.' }; }
    finally { cmpTesting = false; }
  }

  // Poll running campaigns every 2s for live counter updates.
  let pollHandles = new Map();
  function pollCampaign(id) {
    if (pollHandles.has(id)) return;
    const tick = async () => {
      try {
        const c = await notificationsApi.getCampaign(id);
        campaigns = campaigns.map(x => x.id === id ? { ...x, ...c } : x);
        if (c.status === 'running') {
          pollHandles.set(id, setTimeout(tick, 2000));
        } else {
          pollHandles.delete(id);
          await loadHistory();
        }
      } catch { pollHandles.delete(id); }
    };
    tick();
  }
  // Auto-poll any campaigns that come back from the server already running.
  $: campaigns.filter(c => c.status === 'running').forEach(c => pollCampaign(c.id));
  onDestroy(() => { for (const h of pollHandles.values()) clearTimeout(h); });

  async function retryCmp(c) {
    if (!confirm(`Reintentar los envíos fallidos de "${c.name}"?`)) return;
    try {
      await notificationsApi.retryCampaign(c.id);
      await Promise.all([loadCampaigns(), loadHistory()]);
    } catch (e) { alert(e.message); }
  }

  // ── History ────────────────────────────────────────────
  let history = [];
  let hisLoading = false;
  let hisFilter = { campaignId: '', status: '', channel: '' };
  async function loadHistory() {
    hisLoading = true;
    try {
      const params = {};
      if (hisFilter.campaignId) params.campaignId = hisFilter.campaignId;
      if (hisFilter.status)     params.status     = hisFilter.status;
      if (hisFilter.channel)    params.channel    = hisFilter.channel;
      history = await notificationsApi.listHistory(params);
    } catch (e) { console.error(e); }
    finally { hisLoading = false; }
  }

  async function removeHisRow(h) {
    if (!confirm(`¿Eliminar este registro de entrega?\n\nDestinatario: ${h.recipient || '—'}`)) return;
    try {
      await notificationsApi.removeHistory(h.id);
      history = history.filter(x => x.id !== h.id);
    } catch (e) { alert(e.message); }
  }

  async function clearHistory() {
    const params = {};
    if (hisFilter.campaignId) params.campaignId = hisFilter.campaignId;
    if (hisFilter.status)     params.status     = hisFilter.status;
    if (hisFilter.channel)    params.channel    = hisFilter.channel;
    const hasFilters = Object.keys(params).length > 0;
    const msg = hasFilters
      ? `¿Borrar TODOS los registros que coinciden con los filtros actuales?\n\nEsta acción no se puede deshacer.`
      : `¿Borrar el historial COMPLETO de entregas?\n\nSe perderán todos los registros de envío. Las campañas en sí no se borran.`;
    if (!confirm(msg)) return;
    try {
      const res = await notificationsApi.clearHistory(params);
      history = [];
      alert(`${res?.deleted ?? 0} registros eliminados.`);
    } catch (e) { alert(e.message); }
  }

  // Inline preview of what was actually sent (subject + body) — used to
  // verify that the correct template was rendered and the right SMTP path
  // was used. Backend stores the EXACT content delivered.
  let previewOpen = null;  // log id whose body is expanded

  // ── SMTP config ────────────────────────────────────────
  let smtpForm = {
    id: null, provider: '', host: '', port: 587, secure: false,
    username: '', password: '', fromEmail: '', fromName: 'ISP Manager', replyTo: '',
    isVerified: false, lastTestedAt: null, lastTestResult: null
  };
  let smtpLoading = false;
  let smtpLoaded = false;   // becomes true after first attempt (success or empty)
  let smtpSaving = false;
  let smtpTesting = false;
  let smtpPreset = '';
  let smtpShowPassword = false;
  let smtpTestEmail = '';
  let smtpMsg = null; // { type: 'success' | 'error', text }

  async function loadSmtp() {
    smtpLoading = true;
    try {
      const data = await smtpApi.get();
      if (data) {
        // Password never travels back from the server — keep blank, write-only.
        smtpForm = { ...smtpForm, ...data, password: '' };
        smtpPreset = data.provider || '';
      }
      // else: no config yet — keep the empty form so the operator can create one.
    } catch (e) {
      smtpMsg = { type: 'error', text: e.message };
    } finally {
      smtpLoading = false;
      smtpLoaded = true;
    }
  }

  // Ojo de contraseña: si se va a revelar y el campo está vacío pero hay una
  // config guardada, trae la contraseña almacenada del servidor (solo admin).
  async function toggleSmtpPassword() {
    if (!smtpShowPassword && !smtpForm.password && smtpForm.id) {
      try {
        const { password } = await smtpApi.reveal(smtpForm.id);
        smtpForm.password = password || '';
      } catch (e) {
        smtpMsg = { type: 'error', text: 'No se pudo obtener la contraseña guardada.' };
        return;
      }
    }
    smtpShowPassword = !smtpShowPassword;
  }

  function applyPreset(name) {
    const p = SMTP_PRESETS.find(x => x.name === name);
    if (!p) return;
    smtpPreset = name;
    // NO destructivo: el preset solo PRE-LLENA campos vacíos. Nunca borra el
    // host/puerto/credenciales que el operador ya escribió. Cambiar de
    // proveedor conserva tus datos; vacía un campo si quieres el valor del preset.
    const port = smtpForm.port || p.port;
    smtpForm = {
      ...smtpForm,
      provider: name,
      host: smtpForm.host || p.host,
      port,
      secure: Number(port) === 465
    };
  }

  // Auto-correct the port↔SSL combination — a very common footgun.
  // Port 465 requires SSL on (SMTPS); port 587 requires SSL off (STARTTLS).
  // Watching the user-edited port number and silently flipping the toggle
  // saves them from "connection timeout" errors that look like network bugs.
  function onPortChange() {
    const p = Number(smtpForm.port);
    if (p === 465 && !smtpForm.secure) smtpForm.secure = true;
    if (p === 587 &&  smtpForm.secure) smtpForm.secure = false;
  }

  async function saveSmtp() {
    smtpMsg = null;
    if (!smtpForm.host || !smtpForm.username || !smtpForm.fromEmail) {
      smtpMsg = { type: 'error', text: 'Host, usuario y email remitente son obligatorios.' };
      return;
    }
    if (smtpForm.host.includes('@') || /\s/.test(smtpForm.host)) {
      smtpMsg = { type: 'error', text: 'El "Servidor SMTP (host)" debe ser un servidor como mail.tudominio.com, no un correo.' };
      return;
    }
    if (!smtpForm.id && !smtpForm.password) {
      smtpMsg = { type: 'error', text: 'La contraseña es obligatoria al crear una nueva configuración.' };
      return;
    }
    smtpSaving = true;
    try {
      const payload = {
        provider:  smtpForm.provider || null,
        host:      smtpForm.host,
        port:      Number(smtpForm.port),
        secure:    !!smtpForm.secure,
        username:  smtpForm.username,
        password:  smtpForm.password,  // empty string = keep existing on PUT
        fromEmail: smtpForm.fromEmail,
        fromName:  smtpForm.fromName || 'ISP Manager',
        replyTo:   smtpForm.replyTo || null
      };
      const saved = smtpForm.id
        ? await smtpApi.update(smtpForm.id, payload)
        : await smtpApi.create(payload);
      smtpForm = { ...smtpForm, ...saved, password: '' };
      smtpPreset = saved.provider || '';
      smtpMsg = { type: 'success', text: 'Configuración guardada correctamente.' };
    } catch (e) {
      smtpMsg = { type: 'error', text: e.message || 'No se pudo guardar.' };
    } finally { smtpSaving = false; }
  }

  async function testSmtp() {
    smtpMsg = null;
    if (!smtpTestEmail) {
      smtpMsg = { type: 'error', text: 'Indica un email para enviar la prueba.' };
      return;
    }
    smtpTesting = true;
    try {
      const result = await smtpApi.test({
        host:      smtpForm.host,
        port:      Number(smtpForm.port),
        secure:    !!smtpForm.secure,
        username:  smtpForm.username,
        password:  smtpForm.password,   // empty → backend uses stored password
        fromEmail: smtpForm.fromEmail,
        fromName:  smtpForm.fromName,
        testEmail: smtpTestEmail,
        configId:  smtpForm.id || undefined
      });
      smtpMsg = { type: 'success', text: result?.message || 'Correo enviado.' };
      if (smtpForm.id) await loadSmtp(); // refresh isVerified + lastTestedAt
    } catch (e) {
      smtpMsg = { type: 'error', text: e.message || 'La prueba falló.' };
    } finally { smtpTesting = false; }
  }

  // Lazy-load SMTP only when the operator opens that tab. We track `smtpLoaded`
  // ── WhatsApp config ─────────────────────────────────────
  // Transactional events that can be mapped to an approved Meta template.
  // Outside the 24h customer-service window Meta only delivers TEMPLATE
  // messages (free text → error 131047), so each automated notification
  // needs the operator to point it at a template approved in WhatsApp Manager.
  const WA_TEMPLATE_EVENTS = [
    { key: 'PAYMENT_REMINDER',      label: 'Recordatorio de pago',  suggested: 'recordatorio_pago',   hint: 'Factura por vencer / vencida' },
    { key: 'PAYMENT_CONFIRMATION',  label: 'Pago confirmado',       suggested: 'pago_confirmado',      hint: 'Tras registrar un pago' },
    { key: 'SERVICE_SUSPENSION',    label: 'Servicio suspendido',   suggested: 'servicio_suspendido',  hint: 'Al suspender por mora' },
    { key: 'SERVICE_ACTIVATION',    label: 'Servicio reactivado',   suggested: 'servicio_reactivado',  hint: 'Al reactivar el servicio' }
  ];
  let waForm = {
    id: null,
    token: '',
    phoneId: '',
    businessAccountId: '',
    displayName: '',
    defaultLanguage: 'es_CO',
    templateMap: { PAYMENT_REMINDER: '', PAYMENT_CONFIRMATION: '', SERVICE_SUSPENSION: '', SERVICE_ACTIVATION: '' },
    isActive: true,
    isVerified: false,
    lastTestedAt: null,
    lastTestResult: null
  };
  let waLoading = false;
  let waLoaded = false;
  let waSaving = false;
  let waTesting = false;
  let waTestRecipient = '';
  let waShowToken = false;
  let waMsg = null;

  async function loadWhatsApp() {
    waLoading = true;
    try {
      const data = await whatsappApi.get();
      if (data) {
        // Merge templateMap onto the defaults so every event key stays bound,
        // even if the stored map only has a subset (or is null).
        const templateMap = { ...waForm.templateMap, ...(data.templateMap || {}) };
        waForm = { ...waForm, ...data, templateMap };
      }
    } catch (e) {
      waMsg = { type: 'error', text: e.message };
    } finally {
      waLoading = false;
      waLoaded = true;
    }
  }
  async function saveWhatsApp() {
    waSaving = true;
    waMsg = null;
    try {
      const saved = await whatsappApi.save({
        token: waForm.token,
        phoneId: waForm.phoneId,
        businessAccountId: waForm.businessAccountId || null,
        displayName: waForm.displayName || null,
        defaultLanguage: waForm.defaultLanguage || 'es_CO',
        templateMap: waForm.templateMap,
        isActive: !!waForm.isActive
      });
      waForm = { ...waForm, ...saved };
      waMsg = { type: 'success', text: 'Configuración guardada.' };
    } catch (e) {
      waMsg = { type: 'error', text: e.message };
    } finally {
      waSaving = false;
    }
  }
  async function testWhatsApp() {
    if (!waForm.token || !waForm.phoneId || !waTestRecipient) {
      waMsg = { type: 'error', text: 'Llena token, phoneId y un número destino.' };
      return;
    }
    waTesting = true;
    waMsg = null;
    try {
      await whatsappApi.test({
        token: waForm.token,
        phoneId: waForm.phoneId,
        recipient: waTestRecipient
        // defaults to Meta's built-in "hello_world" en_US template
      });
      waMsg = { type: 'success', text: 'Mensaje de prueba enviado. Revisa el WhatsApp del número destino.' };
      await loadWhatsApp(); // refresh lastTestedAt
    } catch (e) {
      waMsg = { type: 'error', text: 'No se pudo enviar: ' + e.message };
    } finally {
      waTesting = false;
    }
  }
  $: if (tab === 'whatsapp' && !waLoaded && !waLoading) loadWhatsApp();

  // explicitly because checking `smtpForm.id === null` would loop forever when
  // there is no config in DB yet (id stays null → reactive refires forever).
  $: if (tab === 'smtp' && !smtpLoaded && !smtpLoading) loadSmtp();

  // ── Ajustes de notificaciones (periodicidad / on-off) ──────────
  let settings = [];
  let settingsLoading = false;
  let settingsLoaded = false;
  let settingsSaving = '';   // type actualmente guardándose
  async function loadSettings() {
    settingsLoading = true;
    try { settings = await notificationsApi.listSettings(); }
    catch (e) { console.error(e); }
    finally { settingsLoading = false; settingsLoaded = true; }
  }
  $: if (tab === 'settings' && !settingsLoaded && !settingsLoading) loadSettings();

  async function patchSetting(s, patch) {
    settingsSaving = s.type;
    try {
      const updated = await notificationsApi.updateSetting(s.type, patch);
      settings = settings.map(x => x.type === s.type ? { ...x, ...updated } : x);
    } catch (e) {
      alert(e.message || 'No se pudo guardar el ajuste.');
      loadSettings(); // revertir al estado real
    } finally { settingsSaving = ''; }
  }
  // Resumen legible de la periodicidad para mostrar.
  function scheduleSummary(sc) {
    if (!sc) return 'Por evento (inmediato)';
    const parts = [];
    if (Array.isArray(sc.times) && sc.times.length) parts.push(`Horas: ${sc.times.join(', ')}`);
    if (sc.daysBeforeDue != null) parts.push(`${sc.daysBeforeDue} días antes de vencer`);
    if (sc.dayOfMonthFrom != null) parts.push(`desde el día ${sc.dayOfMonthFrom} del mes`);
    return parts.length ? parts.join(' · ') : 'Programado';
  }

  // ── Helpers ────────────────────────────────────────────
  const CHANNEL_LABEL = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', BOTH: 'Email + WhatsApp' };
  const CHANNEL_ICON  = { EMAIL: Mail, WHATSAPP: MessageSquare, BOTH: Send };
  const STATUS_BADGE = {
    draft:          'bg-slate-100 text-slate-600 ring-slate-200',
    running:        'bg-amber-50   text-amber-700   ring-amber-100',
    completed:      'bg-emerald-50 text-emerald-700 ring-emerald-100',
    failed:         'bg-red-50     text-red-700     ring-red-100',
    empty_audience: 'bg-amber-50   text-amber-700   ring-amber-100',
    sent:           'bg-emerald-50 text-emerald-700 ring-emerald-100',
    pending:        'bg-amber-50   text-amber-700   ring-amber-100'
  };
  const STATUS_LABEL = {
    draft: 'Borrador',
    running: 'Enviando',
    completed: 'Completada',
    failed: 'Con errores',
    empty_audience: 'Sin destinatarios',
    sent: 'Enviado',
    pending: 'Pendiente'
  };

  // Build a human-readable summary of the audience filter for inline display.
  function audienceSummary(c) {
    let f = {};
    try { f = c.audienceJson ? (typeof c.audienceJson === 'string' ? JSON.parse(c.audienceJson) : c.audienceJson) : {}; }
    catch { f = {}; }
    const parts = [];
    if (f.zoneId) {
      const z = zones.find(z => String(z.id) === String(f.zoneId));
      parts.push(`zona: ${z?.name || f.zoneId}`);
    }
    if (f.planId) {
      const p = plans.find(p => p.id === f.planId);
      parts.push(`plan: ${p?.name || f.planId}`);
    }
    if (f.status)  parts.push(`estado: ${f.status}`);
    if (f.overdue) parts.push('vencidas');
    return parts.length ? parts.join(' · ') : 'todos los clientes';
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
</script>

<svelte:head><title>Centro de Notificaciones — ISP Manager</title></svelte:head>

<!-- Header -->
<div class="flex flex-wrap items-start justify-between gap-3 mb-4">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-text-primary tracking-tight inline-flex items-center gap-2">
      <Bell size={20} class="text-brand-600" /> Centro de Notificaciones
    </h1>
    <p class="hidden sm:block text-sm text-text-secondary mt-1">
      Envía correos y WhatsApp masivos a tus clientes desde una sola pantalla.
    </p>
  </div>
  {#if tab === 'campaigns'}
    <div class="flex items-center gap-2">
      <button type="button" on:click={loadCampaigns}
              class="btn-secondary" title="Recargar campañas">
        <RefreshCw size={14} class={cmpLoading ? 'animate-spin' : ''} />
        Refrescar
      </button>
      <button type="button" on:click={openNewCmp} class="btn-primary">
        <Send size={15} /> Nueva campaña
      </button>
    </div>
  {:else if tab === 'templates'}
    <button type="button" on:click={openNewTpl} class="btn-primary">
      <Plus size={15} /> Nueva plantilla
    </button>
  {/if}
</div>

<!-- Tabs -->
<div class="card mb-4">
  <div class="flex items-center gap-1 overflow-x-auto p-1.5">
    {#each [
      { id: 'campaigns', label: 'Campañas',    icon: Send },
      { id: 'templates', label: 'Plantillas',  icon: FileText },
      { id: 'history',   label: 'Historial',   icon: HistoryIcon },
      { id: 'settings',  label: 'Ajustes',     icon: Filter },
      { id: 'smtp',      label: 'Correo SMTP', icon: Server },
      { id: 'whatsapp',  label: 'WhatsApp',    icon: MessageCircle },
    ] as t}
      <button type="button" on:click={() => tab = t.id}
              class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg
                     whitespace-nowrap transition-colors
                     {tab === t.id
                       ? 'bg-brand-600 text-white'
                       : 'text-slate-600 hover:bg-slate-100'}">
        <svelte:component this={t.icon} size={14} />
        {t.label}
      </button>
    {/each}
  </div>
</div>

<!-- ─── CAMPAIGNS ─────────────────────────────────────── -->
{#if tab === 'campaigns'}
  <div class="card">
    {#if cmpLoading}
      <div class="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
        <Loader2 size={14} class="animate-spin" /> Cargando...
      </div>
    {:else if campaigns.length === 0}
      <div class="text-center py-16 text-sm text-slate-500">
        <Send size={32} class="mx-auto mb-3 opacity-40" />
        Aún no has lanzado ninguna campaña.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Canal</th>
              <th>Estado</th>
              <th class="text-right">Progreso</th>
              <th>Lanzada</th>
              <th class="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {#each campaigns as c (c.id)}
              {@const pct = c.totalCount > 0 ? Math.round(((c.sentCount + c.failedCount) / c.totalCount) * 100) : 0}
              <tr>
                <td>
                  <div class="text-sm font-medium text-slate-900">{c.name}</div>
                  {#if c.template}
                    <div class="text-[11px] text-slate-500">Plantilla: {c.template.name}</div>
                  {/if}
                  <div class="text-[11px] text-slate-400 mt-0.5">
                    Audiencia: <span class="text-slate-500">{audienceSummary(c)}</span>
                    {#if c.generatePaymentLinks}
                      <span class="ml-1.5 badge bg-blue-50 text-blue-700 ring-blue-100 text-[9px]">🔗 links de pago</span>
                    {/if}
                  </div>
                </td>
                <td>
                  <span class="inline-flex items-center gap-1 text-xs text-slate-600">
                    <svelte:component this={CHANNEL_ICON[c.channel]} size={12} />
                    {CHANNEL_LABEL[c.channel] ?? c.channel}
                  </span>
                </td>
                <td>
                  <span class="badge {STATUS_BADGE[c.status]} inline-flex items-center gap-1">
                    {#if c.status === 'running'}<Loader2 size={10} class="animate-spin" />{/if}
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </td>
                <td class="text-right">
                  <div class="text-xs text-slate-600 tabular-nums">
                    <span class="text-emerald-700 font-medium">{c.sentCount}</span> /
                    <span class="text-red-600">{c.failedCount}</span> /
                    {c.totalCount}
                  </div>
                  <div class="h-1 mt-1 bg-slate-100 rounded overflow-hidden w-32 ml-auto">
                    <div class="h-full bg-brand-600 transition-all" style="width: {pct}%"></div>
                  </div>
                </td>
                <td class="text-xs text-slate-500 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                <td class="text-right">
                  <div class="flex items-center justify-end gap-1">
                    {#if c.status === 'draft'}
                      <button class="btn-icon !text-emerald-600 hover:!text-emerald-700" title="Lanzar campaña"
                              on:click={() => executeDraft(c)}>
                        <Play size={14} />
                      </button>
                    {/if}
                    {#if c.failedCount > 0 && c.status !== 'running'}
                      <button class="btn-icon" title="Reintentar fallidos" on:click={() => retryCmp(c)}>
                        <RefreshCw size={14} />
                      </button>
                    {/if}
                    <button class="btn-icon" title="Ver entregas"
                            on:click={() => { hisFilter.campaignId = c.id; tab = 'history'; loadHistory(); }}>
                      <Eye size={14} />
                    </button>
                    <button class="btn-icon"
                            title={c.status === 'draft' ? 'Editar configuración' : 'Editar configuración (guarda como borrador)'}
                            on:click={() => openEditCmp(c)}>
                      <Pencil size={14} />
                    </button>
                    <button class="btn-icon" title="Reenviar con los mismos parámetros"
                            on:click={() => resendCmp(c)}>
                      <Copy size={14} />
                    </button>
                    <button class="btn-icon" title="Diagnóstico (debug)"
                            on:click={() => openDiagnose(c)}>
                      <Stethoscope size={14} />
                    </button>
                    <button class="btn-icon hover:!text-red-600" title="Eliminar campaña"
                            disabled={c.status === 'running'}
                            on:click={() => deleteCmp(c)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

<!-- ─── TEMPLATES ─────────────────────────────────────── -->
{:else if tab === 'templates'}
  <div class="card">
    {#if tplLoading}
      <div class="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
        <Loader2 size={14} class="animate-spin" /> Cargando...
      </div>
    {:else if templates.length === 0}
      <div class="text-center py-16 text-sm text-slate-500">
        <FileText size={32} class="mx-auto mb-3 opacity-40" />
        Crea tu primera plantilla para enviar campañas.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Plantilla</th>
              <th>Canal</th>
              <th>Asunto / Vista previa</th>
              <th>Estado</th>
              <th>Actualizada</th>
              <th class="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {#each templates as t (t.id)}
              <tr class:opacity-60={!t.isActive}>
                <td class="font-medium text-slate-900">{t.name}</td>
                <td>
                  <span class="inline-flex items-center gap-1 text-xs text-slate-600">
                    <svelte:component this={CHANNEL_ICON[t.channel]} size={12} />
                    {CHANNEL_LABEL[t.channel] ?? t.channel}
                  </span>
                </td>
                <td>
                  {#if t.subject}
                    <div class="text-xs font-medium text-slate-700 truncate max-w-xs" title={t.subject}>{t.subject}</div>
                  {/if}
                  <div class="text-[11px] text-slate-500 truncate max-w-xs" title={t.body}>{t.body}</div>
                </td>
                <td>
                  {#if t.isActive}<span class="badge-green">Activa</span>
                  {:else}<span class="badge-gray">Inactiva</span>{/if}
                </td>
                <td class="text-xs text-slate-500 whitespace-nowrap">{fmtDate(t.updatedAt)}</td>
                <td class="text-right">
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-icon" title="Editar" on:click={() => openEditTpl(t)}>
                      <Pencil size={14} />
                    </button>
                    <button class="btn-icon hover:!text-red-600 hover:!bg-red-50"
                            title="Desactivar" on:click={() => removeTpl(t)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

<!-- ─── HISTORY ─────────────────────────────────────── -->
{:else if tab === 'history'}
  <div class="card mb-4">
    <div class="p-3 flex flex-wrap items-center gap-2">
      <span class="text-xs font-medium text-slate-600 inline-flex items-center gap-1">
        <Filter size={12} /> Filtros
      </span>
      {#if hisFilter.campaignId}
        {@const camp = campaigns.find(c => c.id === hisFilter.campaignId)}
        <span class="badge bg-brand-50 text-brand-700 ring-brand-100 inline-flex items-center gap-1">
          Campaña: {camp?.name || hisFilter.campaignId}
          <button on:click={() => { hisFilter.campaignId = ''; loadHistory(); }} class="hover:text-brand-900">
            <X size={10} />
          </button>
        </span>
      {/if}
      <select bind:value={hisFilter.status} on:change={loadHistory} class="select !py-1.5 text-xs max-w-xs">
        <option value="">Todos los estados</option>
        <option value="sent">Enviados</option>
        <option value="failed">Fallidos</option>
        <option value="pending">Pendientes</option>
      </select>
      <select bind:value={hisFilter.channel} on:change={loadHistory} class="select !py-1.5 text-xs max-w-xs">
        <option value="">Todos los canales</option>
        <option value="EMAIL">Email</option>
        <option value="WHATSAPP">WhatsApp</option>
      </select>
      <div class="flex-1"></div>
      {#if history.length > 0}
        <button type="button" on:click={clearHistory}
                class="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 px-2">
          <Trash2 size={12} /> Borrar {hisFilter.campaignId || hisFilter.status || hisFilter.channel ? 'filtrados' : 'todo'}
        </button>
      {/if}
    </div>
  </div>

  <div class="card">
    {#if hisLoading}
      <div class="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
        <Loader2 size={14} class="animate-spin" /> Cargando...
      </div>
    {:else if history.length === 0}
      <div class="text-center py-16 text-sm text-slate-500">
        <HistoryIcon size={32} class="mx-auto mb-3 opacity-40" />
        Sin entregas registradas con esos filtros.
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Canal</th>
              <th>Destinatario</th>
              <th>Estado</th>
              <th>Campaña</th>
              <th class="text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {#each history as h (h.id)}
              <tr>
                <td class="text-xs text-slate-500 whitespace-nowrap">{fmtDate(h.sentAt || h.createdAt)}</td>
                <td class="text-sm">{h.client?.name || '—'}</td>
                <td>
                  <span class="inline-flex items-center gap-1 text-xs text-slate-600">
                    <svelte:component this={CHANNEL_ICON[h.channel]} size={12} />
                    {CHANNEL_LABEL[h.channel] ?? h.channel}
                  </span>
                </td>
                <td class="font-mono text-xs text-slate-600 truncate max-w-[180px]" title={h.recipient}>{h.recipient || '—'}</td>
                <td>
                  <span class="badge {STATUS_BADGE[h.status]}">{STATUS_LABEL[h.status] ?? h.status}</span>
                  {#if h.status === 'failed' && h.error}
                    <div class="text-[10px] text-red-600 mt-0.5 truncate max-w-[180px]" title={h.error}>{h.error}</div>
                  {/if}
                </td>
                <td class="text-xs text-slate-500 truncate max-w-[140px]">{h.campaign?.name || '—'}</td>
                <td class="text-right">
                  <div class="flex items-center justify-end gap-1">
                    <button class="btn-icon"
                            title={previewOpen === h.id ? 'Ocultar' : 'Ver mensaje enviado'}
                            on:click={() => previewOpen = previewOpen === h.id ? null : h.id}>
                      <svelte:component this={previewOpen === h.id ? ChevronUp : Eye} size={14} />
                    </button>
                    <button class="btn-icon hover:!text-red-600 hover:!bg-red-50"
                            title="Eliminar registro"
                            on:click={() => removeHisRow(h)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
              {#if previewOpen === h.id}
                <tr class="bg-slate-50/60">
                  <td colspan="7" class="px-4 py-3">
                    <div class="space-y-2 text-xs">
                      {#if h.subject}
                        <div>
                          <span class="text-text-secondary uppercase tracking-wide font-semibold text-[10px]">Asunto enviado:</span>
                          <div class="font-medium text-text-primary">{h.subject}</div>
                        </div>
                      {/if}
                      <div>
                        <span class="text-text-secondary uppercase tracking-wide font-semibold text-[10px]">
                          Cuerpo enviado al cliente (variables ya renderizadas):
                        </span>
                        <pre class="mt-1 p-3 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-slate-800 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">{h.content}</pre>
                      </div>
                      {#if (h.content || '').match(/https?:\/\/[^\s]+/)}
                        {@const payUrl = (h.content.match(/https?:\/\/[^\s]+/) || [])[0]}
                        <div class="flex items-center gap-2 pt-1">
                          <span class="text-text-secondary uppercase tracking-wide font-semibold text-[10px]">Botón de pago incluido:</span>
                          <a href={payUrl} target="_blank" rel="noopener"
                             class="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#FDB913] text-[#0E255C] font-bold text-[11px] hover:bg-[#ECA600]">
                            Pagar ahora →
                          </a>
                          <span class="text-[10px] text-text-secondary break-all">{payUrl}</span>
                        </div>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

<!-- ─── AJUSTES / PERIODICIDAD ───────────────────────── -->
{:else if tab === 'settings'}
  <div class="card">
    <div class="card-header">
      <div>
        <h2 class="font-semibold text-slate-900 flex items-center gap-2"><Filter size={16} class="text-brand-600" /> Ajustes de notificaciones a clientes</h2>
        <p class="text-xs text-slate-500 mt-0.5">
          Controla qué correos/mensajes reciben los clientes y por qué canal. Si apagas un tipo,
          <strong>ningún</strong> envío de ese tipo sale (venga de un cron, un evento o la UI). Lo masivo (campañas)
          y los envíos manuales puntuales no dependen de aquí.
        </p>
      </div>
    </div>
    <div class="card-body">
      {#if settingsLoading}
        <div class="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
          <Loader2 size={14} class="animate-spin" /> Cargando ajustes...
        </div>
      {:else if settings.length === 0}
        <div class="text-center py-12 text-sm text-slate-500">No hay ajustes para mostrar.</div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-slate-500 border-b border-slate-200">
                <th class="py-2 pr-3">Tipo</th>
                <th class="py-2 px-2 text-center">Activo</th>
                <th class="py-2 px-2 text-center">Email</th>
                <th class="py-2 px-2 text-center">WhatsApp</th>
                <th class="py-2 pl-3">Periodicidad</th>
              </tr>
            </thead>
            <tbody>
              {#each settings as s (s.type)}
                <tr class="border-b border-slate-100 align-top {s.enabled ? '' : 'opacity-60'}">
                  <td class="py-3 pr-3">
                    <div class="font-medium text-slate-900 flex items-center gap-1.5">
                      {s.label}
                      {#if settingsSaving === s.type}<Loader2 size={12} class="animate-spin text-slate-400" />{/if}
                    </div>
                    <div class="text-[11px] {s.security ? 'text-amber-700' : 'text-slate-500'} max-w-md">{s.desc}</div>
                  </td>
                  <td class="py-3 px-2 text-center">
                    <input type="checkbox" class="w-4 h-4" checked={s.enabled}
                           disabled={settingsSaving === s.type}
                           on:change={(e) => patchSetting(s, { enabled: e.currentTarget.checked })} />
                  </td>
                  <td class="py-3 px-2 text-center">
                    <input type="checkbox" class="w-4 h-4" checked={s.email}
                           disabled={settingsSaving === s.type || !s.enabled}
                           on:change={(e) => patchSetting(s, { email: e.currentTarget.checked })} />
                  </td>
                  <td class="py-3 px-2 text-center">
                    <input type="checkbox" class="w-4 h-4" checked={s.whatsapp}
                           disabled={settingsSaving === s.type || !s.enabled}
                           on:change={(e) => patchSetting(s, { whatsapp: e.currentTarget.checked })} />
                  </td>
                  <td class="py-3 pl-3 text-xs text-slate-600">
                    {scheduleSummary(s.schedule)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="text-[11px] text-slate-400 mt-3">
          El encendido/apagado y los canales se aplican de inmediato. La columna “Periodicidad”
          muestra el horario actual de cada envío programado (de momento fijo).
        </p>
      {/if}
    </div>
  </div>

<!-- ─── SMTP CONFIG ──────────────────────────────────── -->
{:else if tab === 'smtp'}
  <div class="space-y-4">

    {#if smtpMsg}
      <div class="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm
                  {smtpMsg.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-red-50 border-red-200 text-red-700'}">
        {#if smtpMsg.type === 'success'}
          <CheckCircle2 size={14} class="mt-0.5 flex-shrink-0" />
        {:else}
          <AlertCircle size={14} class="mt-0.5 flex-shrink-0" />
        {/if}
        <span class="flex-1">{smtpMsg.text}</span>
        <button class="text-current/60 hover:text-current" on:click={() => smtpMsg = null}>
          <X size={14} />
        </button>
      </div>
    {/if}

    <!-- Connection + Sender side-by-side on lg+, stacked below -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

    <!-- Connection card -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center justify-between w-full">
          <div class="flex items-center gap-2">
            <Server size={16} class="text-slate-600" />
            <h3 class="font-semibold text-slate-900">Conexión SMTP</h3>
          </div>
          {#if smtpForm.id}
            {#if smtpForm.isVerified}
              <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100 inline-flex items-center gap-1">
                <CheckCircle2 size={10} /> Verificado
              </span>
            {:else}
              <span class="badge bg-amber-50 text-amber-700 ring-amber-100 inline-flex items-center gap-1">
                <AlertCircle size={10} /> Sin verificar
              </span>
            {/if}
          {/if}
        </div>
      </div>
      <div class="card-body space-y-4">
        {#if smtpLoading}
          <div class="flex items-center gap-2 text-sm text-slate-500 py-2">
            <Loader2 size={14} class="animate-spin" /> Cargando configuración...
          </div>
        {:else}
          <div>
            <label for="smtp-preset" class="label">Proveedor (preset)</label>
            <select id="smtp-preset" bind:value={smtpPreset}
                    on:change={() => applyPreset(smtpPreset)} class="select">
              <option value="">— Selecciona un preset —</option>
              {#each SMTP_PRESETS as p}
                <option value={p.name}>{p.name}</option>
              {/each}
            </select>
            <p class="text-xs text-text-secondary mt-1">
              El preset solo precarga host/puerto. Puedes editar manualmente cualquier campo.
            </p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="sm:col-span-2">
              <label for="smtp-host" class="label flex items-center gap-1.5">
                <Server size={12} /> Servidor SMTP (host)
              </label>
              <input id="smtp-host" type="text" bind:value={smtpForm.host}
                     placeholder="mail.hostgator.com" class="input font-mono" />
            </div>
            <div>
              <label for="smtp-port" class="label">Puerto</label>
              <input id="smtp-port" type="number" bind:value={smtpForm.port}
                     on:change={onPortChange}
                     placeholder="465 (SSL) o 587 (STARTTLS)" class="input font-mono" />
            </div>
            <div class="flex flex-col justify-end">
              <label class="flex items-center gap-2 text-sm pb-1">
                <input type="checkbox" bind:checked={smtpForm.secure} class="w-4 h-4" />
                Usar SSL directo (recomendado para puerto 465)
              </label>
              <p class="text-[11px] text-text-secondary leading-tight">
                {Number(smtpForm.port) === 465
                  ? '✓ Puerto 465 requiere SSL marcado.'
                  : Number(smtpForm.port) === 587
                    ? '✓ Puerto 587 usa STARTTLS (sin marcar).'
                    : ''}
              </p>
            </div>
            <div>
              <label for="smtp-user" class="label flex items-center gap-1.5">
                <UserIcon size={12} /> Usuario
              </label>
              <input id="smtp-user" type="text" bind:value={smtpForm.username}
                     placeholder="contacto@dominio.com" class="input" autocomplete="off" />
            </div>
            <div>
              <label for="smtp-pwd" class="label flex items-center gap-1.5">
                <Lock size={12} /> Contraseña
              </label>
              <div class="relative">
                <input id="smtp-pwd"
                       type={smtpShowPassword ? 'text' : 'password'}
                       value={smtpForm.password}
                       on:input={(e) => smtpForm.password = e.currentTarget.value}
                       placeholder={smtpForm.id ? '(sin cambios)' : 'mínimo 1 carácter'}
                       autocomplete="new-password"
                       class="input pr-10" />
                <button type="button" on:click={toggleSmtpPassword}
                        class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700"
                        aria-label="Mostrar/ocultar">
                  <svelte:component this={smtpShowPassword ? EyeOff : EyeIcon} size={14} />
                </button>
              </div>
              {#if smtpForm.id}
                <p class="text-xs text-text-secondary mt-1">Deja vacío para mantener la contraseña actual.</p>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Sender info card -->
    {#if !smtpLoading}
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <Mail size={16} class="text-slate-600" />
            <h3 class="font-semibold text-slate-900">Identidad del remitente</h3>
          </div>
        </div>
        <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="smtp-from-email" class="label">Email remitente *</label>
            <input id="smtp-from-email" type="email" bind:value={smtpForm.fromEmail}
                   placeholder="contacto@dominio.com" class="input" />
          </div>
          <div>
            <label for="smtp-from-name" class="label">Nombre remitente</label>
            <input id="smtp-from-name" type="text" bind:value={smtpForm.fromName}
                   placeholder="ISP Manager" class="input" />
          </div>
          <div class="sm:col-span-2">
            <label for="smtp-reply" class="label">Reply-To (opcional)</label>
            <input id="smtp-reply" type="email" bind:value={smtpForm.replyTo}
                   placeholder="soporte@dominio.com" class="input" />
          </div>
        </div>
        <div class="px-5 py-4 border-t border-slate-100 bg-slate-50/40 flex flex-wrap items-center justify-end gap-2">
          <button type="button" on:click={saveSmtp} class="btn-primary" disabled={smtpSaving}>
            {#if smtpSaving}
              <Loader2 size={15} class="animate-spin" /> Guardando...
            {:else}
              <Save size={15} /> Guardar configuración
            {/if}
          </button>
        </div>
      </div>
    {/if}

    </div> <!-- /grid Connection + Sender -->

    <!-- Test card (full width below) -->
    {#if !smtpLoading}
      <div class="card">
        <div class="card-header">
          <div class="flex items-center gap-2">
            <Send size={16} class="text-slate-600" />
            <h3 class="font-semibold text-slate-900">Probar conexión</h3>
          </div>
        </div>
        <div class="card-body space-y-3">
          <p class="text-sm text-text-secondary">
            Envía un email de prueba a una dirección para verificar que la configuración funciona.
          </p>
          <div class="flex flex-wrap items-end gap-3">
            <div class="flex-1 min-w-[200px]">
              <label for="smtp-test-email" class="label">Email destinatario</label>
              <input id="smtp-test-email" type="email" bind:value={smtpTestEmail}
                     placeholder="tu@email.com" class="input" />
            </div>
            <button type="button" on:click={testSmtp}
                    disabled={smtpTesting || !smtpTestEmail}
                    class="btn-secondary">
              {#if smtpTesting}
                <Loader2 size={15} class="animate-spin" /> Enviando...
              {:else}
                <Send size={15} /> Enviar prueba
              {/if}
            </button>
          </div>
          {#if smtpForm.lastTestedAt}
            <p class="text-xs text-text-secondary">
              <strong>Última prueba:</strong> {new Date(smtpForm.lastTestedAt).toLocaleString('es-CO')} —
              {smtpForm.lastTestResult || '—'}
            </p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ─── WHATSAPP ─────────────────────────────────────── -->
{#if tab === 'whatsapp'}
  <div class="card">
    {#if waLoading}
      <div class="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
        <Loader2 size={14} class="animate-spin" /> Cargando...
      </div>
    {:else}
      <div class="grid lg:grid-cols-[1.5fr_1fr] gap-6 p-1">
        <!-- Left: credentials form -->
        <div>
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-xl bg-green-100 grid place-items-center">
              <MessageCircle size={22} class="text-green-700" />
            </div>
            <div>
              <h2 class="text-base font-semibold text-slate-900">WhatsApp Cloud API</h2>
              <p class="text-xs text-slate-500">Conecta tu cuenta de Meta WhatsApp Business para enviar mensajes a clientes.</p>
            </div>
          </div>

          {#if waMsg}
            <div class="mb-4 px-3 py-2 rounded-lg text-sm border"
                 class:bg-green-50={waMsg.type === 'success'}
                 class:border-green-200={waMsg.type === 'success'}
                 class:text-green-700={waMsg.type === 'success'}
                 class:bg-red-50={waMsg.type === 'error'}
                 class:border-red-200={waMsg.type === 'error'}
                 class:text-red-700={waMsg.type === 'error'}>
              {waMsg.text}
            </div>
          {/if}

          <form on:submit|preventDefault={saveWhatsApp} class="space-y-3">
            <label class="block">
              <span class="text-xs font-semibold text-slate-700">Token (System User)</span>
              <div class="relative mt-1">
                <input
                  type={waShowToken ? 'text' : 'password'}
                  value={waForm.token}
                  on:input={(e) => waForm.token = e.currentTarget.value}
                  required
                  placeholder="EAAxxxxxxxxxxxxxxxxxxxxxx..."
                  class="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 pr-10 focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none" />
                <button type="button" on:click={() => waShowToken = !waShowToken}
                        class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <svelte:component this={waShowToken ? EyeOff : EyeIcon} size={14} />
                </button>
              </div>
              <p class="text-[11px] text-slate-500 mt-1">Business Settings → System Users → Genera token con permiso whatsapp_business_messaging.</p>
            </label>

            <div class="grid sm:grid-cols-2 gap-3">
              <label class="block">
                <span class="text-xs font-semibold text-slate-700">Phone Number ID</span>
                <input bind:value={waForm.phoneId} required placeholder="123456789012345"
                       class="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none" />
                <p class="text-[11px] text-slate-500 mt-1">Numérico. NO el número telefónico, es el ID asignado por Meta.</p>
              </label>
              <label class="block">
                <span class="text-xs font-semibold text-slate-700">WABA ID (opcional)</span>
                <input bind:value={waForm.businessAccountId} placeholder="987654321098765"
                       class="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none" />
              </label>
            </div>

            <div class="grid sm:grid-cols-2 gap-3">
              <label class="block">
                <span class="text-xs font-semibold text-slate-700">Nombre visible (opcional)</span>
                <input bind:value={waForm.displayName} placeholder="Oficina TIC Jamundí"
                       class="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none" />
              </label>
              <label class="block">
                <span class="text-xs font-semibold text-slate-700">Idioma por defecto (plantillas)</span>
                <select bind:value={waForm.defaultLanguage}
                        class="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none">
                  <option value="es_CO">Español (Colombia)</option>
                  <option value="es_ES">Español (España)</option>
                  <option value="es_MX">Español (México)</option>
                  <option value="en_US">English (US)</option>
                </select>
              </label>
            </div>

            <label class="inline-flex items-center gap-2 text-sm text-slate-700 mt-2">
              <input type="checkbox" bind:checked={waForm.isActive} class="rounded" />
              Activo (se usa para enviar mensajes)
            </label>

            <!-- Plantillas de Meta por evento -->
            <div class="border-t border-slate-100 pt-4 mt-4">
              <h3 class="text-sm font-semibold text-slate-900">Plantillas de Meta por evento</h3>
              <p class="text-[11px] text-slate-500 mt-1 mb-3">
                Escribe el nombre exacto de la plantilla aprobada en WhatsApp Manager para cada evento.
                Sin plantilla, el mensaje solo llega si el cliente te escribió en las últimas 24h (Meta rechaza el resto con error 131047).
              </p>
              <div class="space-y-2.5">
                {#each WA_TEMPLATE_EVENTS as ev}
                  <label class="block">
                    <span class="text-xs font-semibold text-slate-700">{ev.label}</span>
                    <span class="text-[11px] text-slate-400 font-normal"> — {ev.hint}</span>
                    <input
                      bind:value={waForm.templateMap[ev.key]}
                      placeholder={ev.suggested}
                      class="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 font-mono focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none" />
                  </label>
                {/each}
              </div>
            </div>

            <div class="flex justify-end pt-2">
              <button type="submit" disabled={waSaving}
                      class="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold disabled:opacity-60">
                {#if waSaving}<Loader2 size={14} class="animate-spin" />{:else}<Save size={14} />{/if}
                Guardar
              </button>
            </div>
          </form>
        </div>

        <!-- Right: test + status + setup guide -->
        <div class="space-y-4">
          <div class="border border-slate-200 rounded-xl p-4">
            <h3 class="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <Phone size={14} class="text-green-600" /> Enviar prueba
            </h3>
            <p class="text-xs text-slate-500 mb-3">Envía el template <code>hello_world</code> (incluido por Meta en cada cuenta nueva) al número que indiques. Sirve para validar las credenciales sin tener que aprobar plantillas propias todavía.</p>
            <label class="block">
              <span class="text-xs font-semibold text-slate-700">Número destino</span>
              <input bind:value={waTestRecipient} placeholder="573001234567"
                     class="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none" />
              <p class="text-[11px] text-slate-500 mt-1">Formato E.164 sin "+" — código país + número.</p>
            </label>
            <button type="button" on:click={testWhatsApp} disabled={waTesting}
                    class="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-green-300 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-sm font-semibold disabled:opacity-60">
              {#if waTesting}<Loader2 size={14} class="animate-spin" />{:else}<Send size={14} />{/if}
              Enviar prueba
            </button>
          </div>

          <div class="border border-slate-200 rounded-xl p-4">
            <h3 class="text-sm font-semibold text-slate-900 mb-2">Estado</h3>
            <dl class="text-xs space-y-1.5">
              <div class="flex justify-between"><dt class="text-slate-500">Conexión</dt>
                <dd class={waForm.isActive ? 'text-green-700 font-semibold' : 'text-slate-500'}>
                  {waForm.isActive ? 'Activa' : 'Inactiva'}
                </dd>
              </div>
              <div class="flex justify-between"><dt class="text-slate-500">Última prueba</dt>
                <dd>{waForm.lastTestedAt ? new Date(waForm.lastTestedAt).toLocaleString('es-CO') : 'Nunca'}</dd>
              </div>
              <div class="flex justify-between"><dt class="text-slate-500">Resultado</dt>
                <dd class={waForm.lastTestResult === 'success' ? 'text-green-700' : waForm.lastTestResult ? 'text-red-700' : 'text-slate-500'}>
                  {waForm.lastTestResult || '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div class="border border-amber-200 bg-amber-50 rounded-xl p-4">
            <h3 class="text-xs font-semibold text-amber-900 mb-1.5">Antes de empezar</h3>
            <ol class="text-[11px] text-amber-800 list-decimal pl-4 space-y-1">
              <li>Crear cuenta en <a href="https://business.facebook.com" target="_blank" rel="noopener" class="underline">business.facebook.com</a>.</li>
              <li>Crear app de WhatsApp en <a href="https://developers.facebook.com" target="_blank" rel="noopener" class="underline">developers.facebook.com</a>.</li>
              <li>Vincular un número telefónico dedicado (no tu WhatsApp personal).</li>
              <li>Generar System User Token sin expiración.</li>
              <li>Crear plantillas: <code>recordatorio_pago</code>, <code>pago_confirmado</code>, <code>servicio_suspendido</code>, <code>servicio_reactivado</code>.</li>
            </ol>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- ════════════════════════════════════════════════════
     TEMPLATE MODAL
     ════════════════════════════════════════════════════ -->
<Sheet bind:open={tplModalOpen} title={tplEditing ? 'Editar plantilla' : 'Nueva plantilla'} maxWidth="max-w-4xl">
  <div class="grid gap-5 lg:grid-cols-2 items-start">
  <form on:submit|preventDefault={saveTpl} id="tpl-form" class="space-y-4">
    {#if tplError}
      <div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
        <AlertCircle size={14} class="mt-0.5" /> <span>{tplError}</span>
      </div>
    {/if}
    <div>
      <label for="tpl-name" class="label">Nombre</label>
      <input id="tpl-name" type="text" bind:value={tplForm.name} class="input" placeholder="Ej: Recordatorio de pago" />
    </div>
    <div>
      <label class="label">Canal</label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer
                      {tplForm.channel === 'EMAIL' ? 'border-brand-600 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300'}">
          <input type="radio" bind:group={tplForm.channel} value="EMAIL" />
          <Mail size={14} /> Email
        </label>
        <label class="flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer
                      {tplForm.channel === 'WHATSAPP' ? 'border-brand-600 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300'}">
          <input type="radio" bind:group={tplForm.channel} value="WHATSAPP" />
          <MessageSquare size={14} /> WhatsApp
        </label>
      </div>
    </div>
    {#if tplForm.channel === 'EMAIL'}
      <div>
        <label for="tpl-subject" class="label">Asunto</label>
        <input id="tpl-subject" type="text" bind:value={tplForm.subject} class="input" placeholder="Ej: Recordatorio: tu pago vence pronto" />
      </div>

      <div>
        <label for="tpl-preset" class="label">Tipo de correo</label>
        <select id="tpl-preset" bind:value={tplForm.preset}
                on:change={onPresetChange} class="select">
          {#each EMAIL_PRESETS as p}
            <option value={p.key}>{p.icon} · {p.title}</option>
          {/each}
        </select>
        <div class="flex items-start justify-between gap-2 mt-1.5">
          <p class="text-[11px] text-text-secondary flex-1">
            Define el header (icono + título) <strong>y</strong> a qué correo del sistema aplica
            esta plantilla cuando está activa.
            {#if EMAIL_PRESETS.find(p => p.key === (tplForm.preset || ''))?.event}
              <br><span class="text-brand-600 font-medium">→ {EMAIL_PRESETS.find(p => p.key === (tplForm.preset || '')).event}</span>
            {/if}
          </p>
          {#if tplForm.preset && PRESET_SAMPLES[tplForm.preset]}
            <button type="button" on:click={useSampleNow}
                    class="text-[11px] text-brand-600 hover:underline font-medium whitespace-nowrap">
              ↻ Usar contenido sugerido
            </button>
          {/if}
        </div>
      </div>
    {/if}
    <div>
      <label for="tpl-body" class="label">Cuerpo del mensaje</label>
      <textarea id="tpl-body" bind:value={tplForm.body} rows="6" class="input"
                placeholder="Hola {'{{'}name{'}}'},&#10;&#10;Tu pago de {'{{'}amount{'}}'} vence el {'{{'}dueDate{'}}'}.&#10;Plan: {'{{'}plan{'}}'}"></textarea>
      <p class="text-[11px] text-slate-500 mt-1.5">
        Variables: <code>{'{{'}name{'}}'}</code>, <code>{'{{'}plan{'}}'}</code>, <code>{'{{'}amount{'}}'}</code>,
        <code>{'{{'}dueDate{'}}'}</code>, <code>{'{{'}balance{'}}'}</code>, <code>{'{{'}zone{'}}'}</code>,
        <code>{'{{'}ip{'}}'}</code>
      </p>
    </div>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={tplForm.isActive} class="w-4 h-4" />
      Plantilla activa
    </label>
  </form>

  {#if tplForm.channel === 'EMAIL'}
    <div class="space-y-2 lg:sticky lg:top-2">
      <div class="flex items-center justify-between">
        <span class="label !mb-0">Vista previa</span>
        {#if tplPreviewLoading}<Loader2 size={13} class="animate-spin text-slate-400" />{/if}
      </div>
      <div class="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div class="px-3 py-2 border-b border-slate-200 bg-white text-xs text-slate-600 truncate">
          <span class="text-slate-400">Asunto:</span> {tplPreviewSubject || '—'}
        </div>
        <iframe title="Vista previa del correo" srcdoc={tplPreviewHtml}
                class="w-full h-[440px] bg-white block" sandbox=""></iframe>
      </div>
      <p class="text-[11px] text-slate-400">
        Diseño real de marca con datos de ejemplo — es exactamente lo que recibe el cliente.
      </p>
    </div>
  {/if}
  </div>
  <svelte:fragment slot="footer">
    <button type="button" on:click={() => tplModalOpen = false} class="btn-secondary" disabled={tplSaving}>Cancelar</button>
    <button type="submit" form="tpl-form" class="btn-primary" disabled={tplSaving}>
      {#if tplSaving}<Loader2 size={15} class="animate-spin" /> Guardando...{:else}<Save size={15} /> Guardar{/if}
    </button>
  </svelte:fragment>
</Sheet>

<!-- ════════════════════════════════════════════════════
     CAMPAIGN DIAGNOSE MODAL
     ════════════════════════════════════════════════════ -->
<Sheet bind:open={diagOpen} title="Diagnóstico de campaña" maxWidth="max-w-3xl">
  {#if diagLoading}
    <div class="flex items-center gap-2 text-sm text-text-secondary py-8 justify-center">
      <Loader2 size={14} class="animate-spin" /> Analizando...
    </div>
  {:else if diagError}
    <div class="flex items-start gap-2 bg-red-50 border border-red-200
                text-red-700 rounded-lg px-3 py-2.5 text-sm">
      <AlertCircle size={14} class="mt-0.5" /> <span>{diagError}</span>
    </div>
  {:else if diagData}
    {@const c = diagData.campaign}
    <div class="space-y-4 text-sm">

      <!-- Campaign summary -->
      <div class="grid grid-cols-2 gap-3">
        <div class="rounded-lg bg-slate-50 p-3">
          <div class="text-[10px] uppercase tracking-wide text-text-secondary font-semibold">Campaña</div>
          <div class="font-medium">{c.name}</div>
          <div class="text-xs text-text-secondary">id: <code>{c.id}</code></div>
        </div>
        <div class="rounded-lg bg-slate-50 p-3">
          <div class="text-[10px] uppercase tracking-wide text-text-secondary font-semibold">Estado</div>
          <span class="badge {STATUS_BADGE[c.status]}">{STATUS_LABEL[c.status] ?? c.status}</span>
          <div class="text-xs text-text-secondary mt-1">
            {c.sentCount} enviados · {c.failedCount} fallidos · {c.totalCount} total
          </div>
        </div>
      </div>

      <!-- Template + channel -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="text-[10px] uppercase tracking-wide text-text-secondary font-semibold mb-1">Plantilla usada</div>
        {#if c.template}
          <div><strong>{c.template.name}</strong> <span class="text-xs text-text-secondary">(id: {c.template.id})</span></div>
          <div class="text-xs text-text-secondary">Canal de plantilla: {c.template.channel} · {c.template.isActive ? 'activa' : 'INACTIVA ⚠️'}</div>
        {:else}
          <div class="text-red-600">⚠️ Plantilla no encontrada (id={c.templateId || 'null'}) — la campaña no puede enviarse.</div>
        {/if}
        <div class="text-xs text-text-secondary mt-1">Canal seleccionado en campaña: <strong>{c.channel}</strong></div>
      </div>

      <!-- Audience -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="text-[10px] uppercase tracking-wide text-text-secondary font-semibold mb-1">Audiencia</div>
        <div class="text-xs">
          Filtro guardado:
          <code class="bg-slate-100 px-1.5 py-0.5 rounded">{JSON.stringify(diagData.audienceFilter)}</code>
        </div>
        <div class="text-xs mt-1">
          Clientes que coinciden AHORA:
          <strong class="{diagData.currentAudienceCount === 0 ? 'text-red-600' : 'text-emerald-700'}">
            {diagData.currentAudienceCount}
          </strong>
        </div>
        {#if diagData.currentAudienceCount === 0}
          <p class="text-xs text-red-600 mt-1">⚠️ El filtro no matchea a ningún cliente. La campaña no puede enviar nada.</p>
        {/if}
      </div>

      <!-- SMTP source -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="text-[10px] uppercase tracking-wide text-text-secondary font-semibold mb-1">SMTP en uso</div>
        {#if diagData.smtpSource === 'DB' && diagData.smtp}
          <div class="inline-flex items-center gap-1 text-xs">
            <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100">DB (Centro de Notificaciones)</span>
            {#if diagData.smtp.isVerified}
              <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100">verificado</span>
            {:else}
              <span class="badge bg-amber-50 text-amber-700 ring-amber-100">sin verificar</span>
            {/if}
          </div>
          <div class="text-xs text-text-secondary mt-1 font-mono">
            {diagData.smtp.host}:{diagData.smtp.port} {diagData.smtp.secure ? '(SSL)' : '(STARTTLS)'}
            · {diagData.smtp.username}
            · from "{diagData.smtp.fromName} &lt;{diagData.smtp.fromEmail}&gt;"
          </div>
        {:else}
          <div class="text-xs text-amber-700">
            ⚠️ No hay SMTP configurado en el sistema — está usando los valores de <code>.env</code>.
          </div>
        {/if}
      </div>

      <!-- Logs -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[10px] uppercase tracking-wide text-text-secondary font-semibold">
            Entregas registradas
          </span>
          <span class="text-xs text-text-secondary">
            {diagData.logSummary.total} logs ·
            <span class="text-emerald-700">{diagData.logSummary.sent} ok</span> ·
            <span class="text-red-600">{diagData.logSummary.failed} error</span>
            {#if diagData.logSummary.systemFailures > 0}
              · <span class="text-red-700 font-semibold">{diagData.logSummary.systemFailures} system</span>
            {/if}
          </span>
        </div>
        {#if diagData.logs.length === 0}
          <p class="text-xs text-amber-700">
            ⚠️ No hay logs para esta campaña. Posibles causas: audiencia vacía al ejecutar, plantilla nula,
            o el runner crasheó antes del primer envío. Mira /tmp/isp-backend.log con
            <code>grep "campaign {c.id}"</code>.
          </p>
        {:else}
          <div class="max-h-64 overflow-y-auto -mx-2">
            <table class="w-full text-xs">
              <thead class="bg-slate-50 sticky top-0">
                <tr class="text-text-secondary">
                  <th class="text-left px-2 py-1.5 font-medium">Estado</th>
                  <th class="text-left px-2 py-1.5 font-medium">Cliente</th>
                  <th class="text-left px-2 py-1.5 font-medium">Destinatario</th>
                  <th class="text-left px-2 py-1.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {#each diagData.logs as l (l.id)}
                  <tr class="border-t border-slate-100">
                    <td class="px-2 py-1">
                      <span class="badge {STATUS_BADGE[l.status]}">{l.status}</span>
                    </td>
                    <td class="px-2 py-1">{l.client?.name || (l.clientId === null ? '(sistema)' : '—')}</td>
                    <td class="px-2 py-1 font-mono">{l.recipient || '—'}</td>
                    <td class="px-2 py-1 text-red-600 truncate max-w-[260px]" title={l.error || ''}>
                      {l.error || ''}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <svelte:fragment slot="footer">
    <button type="button" on:click={() => diagOpen = false} class="btn-primary">Cerrar</button>
  </svelte:fragment>
</Sheet>

<!-- ════════════════════════════════════════════════════
     CAMPAIGN MODAL
     ════════════════════════════════════════════════════ -->
<Sheet bind:open={cmpModalOpen} title={cmpEditingId ? 'Editar borrador' : 'Nueva campaña'} maxWidth="max-w-2xl">
  <form on:submit|preventDefault={launchNow} id="cmp-form" class="space-y-5">
    {#if cmpError}
      <div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm">
        <AlertCircle size={14} class="mt-0.5" /> <span>{cmpError}</span>
      </div>
    {/if}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label for="cmp-name" class="label">Nombre de la campaña</label>
        <input id="cmp-name" type="text" bind:value={cmpForm.name} class="input" placeholder="Ej: Aviso mantenimiento octubre" />
      </div>
      <div>
        <label for="cmp-tpl" class="label">Plantilla</label>
        <select id="cmp-tpl" bind:value={cmpForm.templateId}
                on:change={onTemplateChange} class="select">
          <option value="">Seleccionar plantilla...</option>
          {#each templates.filter(t => t.isActive) as t}
            <option value={t.id}>{t.name} — {CHANNEL_LABEL[t.channel]}</option>
          {/each}
        </select>
      </div>
    </div>

    <div>
      <label class="label">Canal</label>
      <div class="grid grid-cols-3 gap-2">
        {#each ['EMAIL', 'WHATSAPP', 'BOTH'] as ch}
          {@const enabled = !tplSelected || tplSelected.channel === ch || ch === 'BOTH'}
          <label class="flex items-center gap-2 p-2.5 rounded-xl border-2 text-sm
                        {!enabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                        {cmpForm.channel === ch ? 'border-brand-600 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300'}">
            <input type="radio" bind:group={cmpForm.channel} value={ch} disabled={!enabled} />
            <svelte:component this={CHANNEL_ICON[ch]} size={14} /> {CHANNEL_LABEL[ch]}
          </label>
        {/each}
      </div>
    </div>

    <div class="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-text-primary inline-flex items-center gap-1">
          <Filter size={14} /> Audiencia
        </span>
        {#if previewLoading}
          <span class="text-xs text-slate-500 inline-flex items-center gap-1">
            <Loader2 size={11} class="animate-spin" /> calculando...
          </span>
        {:else if audiencePreview !== null}
          <span class="badge bg-brand-50 text-brand-700 ring-brand-100">
            {audiencePreview} {audiencePreview === 1 ? 'cliente' : 'clientes'}
          </span>
        {/if}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label for="aud-zone" class="label">Zona</label>
          <select id="aud-zone" bind:value={cmpForm.audience.zoneId} class="select">
            <option value="">Todas</option>
            {#each zones as z}
              <option value={z.id}>{z.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="aud-plan" class="label">Plan</label>
          <select id="aud-plan" bind:value={cmpForm.audience.planId} class="select">
            <option value="">Todos</option>
            {#each plans as p}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="aud-status" class="label">Estado</label>
          <select id="aud-status" bind:value={cmpForm.audience.status} class="select">
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="SUSPENDED">Suspendidos</option>
            <option value="PENDING">Pendientes</option>
          </select>
        </div>
        <label class="flex items-end gap-2 text-sm pb-1">
          <input type="checkbox" bind:checked={cmpForm.audience.overdue} class="w-4 h-4" />
          Solo con facturas vencidas
        </label>
      </div>
      <label class="inline-flex items-center gap-2 text-sm pt-1 border-t border-slate-200">
        <input type="checkbox" bind:checked={cmpForm.generatePaymentLinks} class="w-4 h-4" />
        <span>Generar links de pago para cada cliente</span>
        <span class="badge bg-amber-50 text-amber-700 ring-amber-100 text-[10px]">
          {'{{'}paymentLink{'}}'}
        </span>
      </label>
      {#if cmpForm.generatePaymentLinks}
        <div class="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-[11px] text-blue-800 leading-relaxed">
          <strong>¿Qué se cobra?</strong> A cada cliente se le genera un link Wompi por su
          <strong>factura pendiente más antigua</strong>, por el <strong>saldo pendiente</strong> de esa factura
          (no es un cobro adicional). La lista de abajo muestra la factura y el monto exacto por cliente.
          Quien no tenga facturas pendientes <strong>no recibe link</strong> (el mensaje le llega sin botón de pago).
          {#if cmpLinkEligible !== null}
            <br><span class="font-semibold">{cmpLinkEligible}</span> de {cmpSelected.size} seleccionados recibirán link de pago.
          {/if}
        </div>
      {/if}

      <!-- Recipient selection (checkboxes): pick all or just some -->
      {#if (audiencePreview ?? 0) > 0}
        <div class="border-t border-slate-200 pt-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-text-primary inline-flex items-center gap-1.5">
              <Eye size={14} /> ¿Quién recibe la campaña?
            </span>
            <span class="text-xs text-text-secondary">
              <strong class="text-brand-700">{cmpSendCount}</strong> de {audiencePreview} seleccionado{cmpSendCount === 1 ? '' : 's'}
            </span>
          </div>

          {#if audienceListLoading}
            <div class="flex items-center gap-2 text-xs text-text-secondary py-3">
              <Loader2 size={12} class="animate-spin" /> Cargando clientes...
            </div>
          {:else if audienceList.length === 0}
            <div class="text-xs text-text-secondary py-2">No hay clientes que coincidan.</div>
          {:else}
            <!-- Búsqueda dinámica dentro de los candidatos cargados -->
            <div class="relative">
              <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="search" bind:value={cmpSearch}
                     placeholder="Buscar por nombre, email, teléfono, zona o plan…"
                     class="input text-sm pl-8 w-full" />
            </div>
            <div class="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <!-- Seleccionar todos (los visibles según la búsqueda) -->
              <label class="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200
                            cursor-pointer text-xs font-semibold text-text-primary select-none">
                <input type="checkbox" class="w-4 h-4"
                       checked={cmpVisibleAllSelected}
                       indeterminate={cmpVisibleSomeSelected && !cmpVisibleAllSelected}
                       on:change={toggleAllVisible} />
                {#if cmpSearch.trim()}
                  Seleccionar los {cmpFilteredList.length} resultado{cmpFilteredList.length === 1 ? '' : 's'}
                {:else}
                  Seleccionar todos ({audienceList.length})
                {/if}
              </label>
              <div class="max-h-60 overflow-y-auto">
                {#if cmpFilteredList.length === 0}
                  <div class="px-3 py-4 text-xs text-text-secondary text-center">
                    Ningún cliente coincide con “{cmpSearch}”.
                  </div>
                {:else}
                <table class="w-full text-xs">
                  <tbody>
                    {#each cmpFilteredList as c (c.id)}
                      <tr class="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                          on:click={() => toggleClient(c.id)}>
                        <td class="pl-3 py-1.5 w-7">
                          <input type="checkbox" class="w-4 h-4 pointer-events-none"
                                 checked={cmpSelected.has(c.id)}
                                 tabindex="-1" />
                        </td>
                        <td class="px-2 py-1.5 text-slate-900">{c.name}</td>
                        <td class="px-2 py-1.5 text-slate-600">
                          {c.zone?.name || '—'}{#if c.plan?.name}<span class="text-slate-400"> · {c.plan.name}</span>{/if}
                        </td>
                        <td class="px-2 py-1.5 font-mono {!c.email ? 'text-amber-600' : 'text-slate-700'}">{c.email || '(sin email)'}</td>
                        <td class="px-3 py-1.5 font-mono {!c.phone ? 'text-amber-600' : 'text-slate-700'}">{c.phone || '(sin tel)'}</td>
                        {#if cmpForm.generatePaymentLinks}
                          {@const inv = c.invoices?.[0]}
                          <td class="px-3 py-1.5 whitespace-nowrap text-right">
                            {#if inv}
                              <span class="inline-flex items-center gap-1 rounded-md bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-medium"
                                    title="Se cobrará la factura {inv.invoiceNumber} (vence {new Date(inv.dueDate).toLocaleDateString('es-CO')})">
                                🧾 {inv.invoiceNumber} · {fmtCop(inv.balanceDue > 0 ? inv.balanceDue : (inv.total ?? inv.amount))}
                              </span>
                            {:else}
                              <span class="text-slate-400" title="Sin facturas pendientes — el correo llega sin botón de pago">sin pendientes</span>
                            {/if}
                          </td>
                        {/if}
                      </tr>
                    {/each}
                  </tbody>
                </table>
                {/if}
              </div>
            </div>
            {#if cmpTruncated}
              <p class="text-[11px] text-text-secondary">
                Mostrando los primeros {audienceList.length} de {audiencePreview}.
                {#if cmpAllSelected}Con “todos” marcado se enviará a los {audiencePreview}.{/if}
              </p>
            {/if}
            {#if cmpNoContact > 0}
              <p class="text-[11px] text-amber-700 inline-flex items-center gap-1">
                <AlertCircle size={11} />
                {cmpNoContact} sin {cmpForm.channel === 'WHATSAPP' ? 'teléfono' : 'email'} — si los incluyes, esos envíos quedarán como “fallidos”.
              </p>
            {/if}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Prueba: enviar la campaña a UN solo cliente real (datos reales, su
         contacto). Se registra aparte; no cuenta como campaña ni la lanza. -->
    {#if cmpForm.templateId && audienceList.length > 0}
      <div class="border border-amber-200 rounded-xl p-3.5 bg-amber-50/40 space-y-2">
        <div class="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
          <FlaskConical size={14} class="text-amber-600" /> Enviar prueba a un cliente
        </div>
        <p class="text-[11px] text-text-secondary">
          Se envía solo a este cliente con sus datos reales para que verifiques cómo llega.
          No cuenta como campaña ni la lanza.
        </p>
        <div class="flex flex-col sm:flex-row gap-2">
          <select bind:value={cmpTestClientId} class="select flex-1 text-sm">
            <option value="">Elegir cliente para la prueba…</option>
            {#each audienceList as c (c.id)}
              <option value={c.id}>{c.name}{c.email || c.phone ? ` · ${c.email || c.phone}` : ''}</option>
            {/each}
          </select>
          <button type="button" on:click={sendTest} disabled={cmpTesting || !cmpTestClientId}
                  class="btn-secondary whitespace-nowrap">
            {#if cmpTesting}<Loader2 size={14} class="animate-spin" /> Enviando…
            {:else}<Send size={14} /> Enviar prueba{/if}
          </button>
        </div>
        {#if cmpTestMsg}
          <p class="text-[11px] inline-flex items-center gap-1 {cmpTestMsg.type === 'success' ? 'text-emerald-700' : 'text-red-600'}">
            {#if cmpTestMsg.type === 'success'}<CheckCircle2 size={12} />{:else}<AlertCircle size={12} />{/if}
            {cmpTestMsg.text}
          </p>
        {/if}
      </div>
    {/if}
  </form>

  <svelte:fragment slot="footer">
    <!-- The form error also renders here (sticky footer) because the in-form
         banner sits at the top and is out of view when the modal is scrolled
         down — the operator must always see WHY the action was rejected. -->
    {#if cmpError}
      <span class="flex-1 text-xs text-red-600 inline-flex items-center gap-1.5 min-w-0">
        <AlertCircle size={13} class="shrink-0" /> <span class="truncate" title={cmpError}>{cmpError}</span>
      </span>
    {/if}
    <button type="button" on:click={() => cmpModalOpen = false} class="btn-secondary" disabled={cmpSaving}>Cancelar</button>
    <button type="button" on:click={saveDraft} class="btn-secondary" disabled={cmpSaving}>
      <Save size={15} /> Guardar borrador
    </button>
    <button type="submit" form="cmp-form" class="btn-primary"
            disabled={cmpSaving || cmpSendCount === 0}>
      {#if cmpSaving}
        <Loader2 size={15} class="animate-spin" /> Procesando...
      {:else}
        <Send size={15} /> Lanzar a {cmpSendCount} {cmpSendCount === 1 ? 'cliente' : 'clientes'}
      {/if}
    </button>
  </svelte:fragment>
</Sheet>
