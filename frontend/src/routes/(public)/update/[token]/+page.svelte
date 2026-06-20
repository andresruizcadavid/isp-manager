<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    User, Mail, Phone, MapPin, IdCard, Camera,
    Loader2, AlertCircle, CheckCircle2, Save, Upload, X
  } from 'lucide-svelte';

  // ── Local API helpers — we DON'T use $lib/api/client.js because that
  // attaches Authorization headers from the auth store. This is a public
  // flow; the token in the URL is the credential.
  const apiBase = import.meta.env.VITE_API_URL || '/api/v1';

  async function publicGet(path) {
    const res = await fetch(`${apiBase}${path}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    return json.data;
  }
  async function publicPut(path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json?.error?.message || `HTTP ${res.status}`);
      err.code = json?.error?.code;
      throw err;
    }
    return json.data;
  }
  async function publicUpload(path, formData) {
    const res = await fetch(`${apiBase}${path}`, { method: 'POST', body: formData });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
    return json.data;
  }

  // ── State ────────────────────────────────────────────────────────────
  let token       = '';
  let loading     = true;
  let loadError   = '';
  let saving      = false;
  let saveError   = '';
  let success     = false;
  let snapshot    = null;       // original data, for the "no cambió ningún campo" check
  let expiresAt   = '';

  let form = {
    email: '', phone: '', address: '', neighborhood: '', city: '',
    documentType: 'CC', documentNumber: '', coordinates: ''
  };

  // Photo upload state
  let photoFiles      = [];
  let photoType       = 'identity';
  let photoUploading  = false;
  let photoError      = '';
  let photoUploaded   = [];     // list of successfully uploaded photos this session

  onMount(async () => {
    token = $page.params.token;
    try {
      const data = await publicGet(`/public/client-updates/${token}`);
      snapshot = data.client;
      expiresAt = data.expiresAt;
      // Seed the form with what's already on file so the customer only
      // edits what's wrong.
      form = {
        email:          data.client.email          ?? '',
        phone:          data.client.phone          ?? '',
        address:        data.client.address        ?? '',
        neighborhood:   data.client.neighborhood   ?? '',
        city:           data.client.city           ?? '',
        documentType:   data.client.documentType   ?? 'CC',
        documentNumber: data.client.documentNumber ?? '',
        coordinates:    data.client.coordinates    ?? ''
      };
    } catch (e) {
      loadError = e.message || 'No se pudo cargar el enlace';
    } finally {
      loading = false;
    }
  });

  async function handleSubmit() {
    saving = true;
    saveError = '';
    try {
      // Only send fields that the customer actually changed. Empty strings
      // ARE sent (so the customer can clear an old value).
      const payload = {};
      for (const k of Object.keys(form)) {
        if ((form[k] ?? '') !== (snapshot?.[k] ?? '')) payload[k] = form[k];
      }
      if (Object.keys(payload).length === 0 && photoUploaded.length === 0) {
        saveError = 'No has hecho ningún cambio.';
        saving = false;
        return;
      }
      await publicPut(`/public/client-updates/${token}`, payload);
      success = true;
    } catch (e) {
      saveError = e.message || 'No se pudo guardar';
    } finally {
      saving = false;
    }
  }

  async function handlePhotoUpload() {
    if (photoFiles.length === 0) {
      photoError = 'Selecciona al menos una imagen.';
      return;
    }
    photoUploading = true;
    photoError = '';
    try {
      const fd = new FormData();
      for (const f of photoFiles) fd.append('files', f);
      fd.append('type', photoType);
      const data = await publicUpload(`/public/client-updates/${token}/photos`, fd);
      photoUploaded = [...photoUploaded, ...(data?.photos || [])];
      photoFiles = [];
      // Reset the input element value so the same file can be re-picked.
      const input = document.getElementById('photo-input');
      if (input) input.value = '';
    } catch (e) {
      photoError = e.message || 'No se pudo subir';
    } finally {
      photoUploading = false;
    }
  }

  function onPhotoSelect(e) {
    photoFiles = Array.from(e.target.files || []);
    photoError = '';
  }

  function fmtExpires(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-CO', {
      day: '2-digit', month: 'long', year: 'numeric'
    });
  }
</script>

<svelte:head>
  <title>Actualiza tus datos — Internet Online</title>
</svelte:head>

{#if loading}
  <div class="flex items-center justify-center py-20 text-text-secondary">
    <Loader2 size={20} class="animate-spin mr-2" /> Cargando enlace…
  </div>

{:else if loadError}
  <div class="card text-center p-8">
    <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-red-100 flex items-center justify-center">
      <AlertCircle size={28} class="text-red-600" />
    </div>
    <h1 class="text-lg font-semibold text-text-primary">Enlace no disponible</h1>
    <p class="text-sm text-text-secondary mt-2">{loadError}</p>
    <p class="text-xs text-text-muted mt-4">
      Si tu técnico te envió este enlace y crees que es un error, contáctalo de nuevo.
    </p>
  </div>

{:else if success}
  <div class="card text-center p-8">
    <div class="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center">
      <CheckCircle2 size={28} class="text-emerald-600" />
    </div>
    <h1 class="text-lg font-semibold text-text-primary">Datos actualizados</h1>
    <p class="text-sm text-text-secondary mt-2">
      Recibimos tu información correctamente. Ya puedes cerrar esta ventana.
    </p>
  </div>

{:else}
  <!-- Top banner -->
  <div class="card mb-4 overflow-hidden">
    <div class="h-1 bg-[#FDB913]"></div>
    <div class="p-5 sm:p-6">
      <h1 class="text-xl font-bold text-[#16357E]">Actualiza tus datos</h1>
      <p class="text-sm text-text-secondary mt-1">
        Hola{snapshot?.name ? ` ${snapshot.name.split(/\s+/)[0]}` : ''}, ayúdanos a
        mantener tu información al día para brindarte un mejor servicio. Revisa que
        tus datos de contacto y documento estén correctos — sólo se enviará lo que cambies.
      </p>
      <p class="text-xs text-text-muted mt-2">
        Este enlace es seguro, vence el <strong>{fmtExpires(expiresAt)}</strong> y sólo se
        puede usar una vez.
      </p>
    </div>
  </div>

  <!-- Datos form -->
  <form on:submit|preventDefault={handleSubmit} class="space-y-4">
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <User size={16} class="text-slate-600" />
          <h2 class="font-semibold text-text-primary">Tus datos</h2>
        </div>
      </div>
      <div class="card-body grid grid-cols-1 md:grid-cols-2 gap-4">

        <div class="md:col-span-2">
          <label for="email" class="label flex items-center gap-1.5">
            <Mail size={13} /> Email
          </label>
          <input id="email" type="email" class="input"
                 bind:value={form.email} placeholder="tucorreo@ejemplo.com" />
        </div>

        <div class="md:col-span-2">
          <label for="phone" class="label flex items-center gap-1.5">
            <Phone size={13} /> Teléfono / WhatsApp
          </label>
          <input id="phone" type="tel" class="input"
                 bind:value={form.phone} placeholder="+57 300 123 4567" />
        </div>

        <div class="md:col-span-2">
          <label for="address" class="label flex items-center gap-1.5">
            <MapPin size={13} /> Dirección
          </label>
          <input id="address" type="text" class="input"
                 bind:value={form.address} placeholder="Calle 5 # 3-20" />
        </div>

        <div>
          <label for="neighborhood" class="label">Barrio / Sector</label>
          <input id="neighborhood" type="text" class="input" bind:value={form.neighborhood} />
        </div>

        <div>
          <label for="city" class="label">Ciudad</label>
          <input id="city" type="text" class="input" bind:value={form.city} />
        </div>

        <div>
          <label for="docType" class="label flex items-center gap-1.5">
            <IdCard size={13} /> Tipo de documento
          </label>
          <select id="docType" class="select" bind:value={form.documentType}>
            <option value="CC">Cédula de Ciudadanía</option>
            <option value="NIT">NIT</option>
            <option value="CE">Cédula de Extranjería</option>
            <option value="TI">Tarjeta de Identidad</option>
            <option value="PAS">Pasaporte</option>
          </select>
        </div>

        <div>
          <label for="docNum" class="label">Número de documento</label>
          <input id="docNum" type="text" class="input" bind:value={form.documentNumber} />
        </div>

        <div class="md:col-span-2">
          <label for="coords" class="label">Coordenadas GPS (opcional)</label>
          <input id="coords" type="text" class="input font-mono"
                 bind:value={form.coordinates}
                 placeholder="3.850149,-76.492356" />
          <p class="text-xs text-text-muted mt-1">
            Puedes obtenerlas con Google Maps: mantén presionado tu ubicación y copia el par de números.
          </p>
        </div>
      </div>
    </div>

    <!-- Foto de cédula / otras imágenes -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Camera size={16} class="text-slate-600" />
          <h2 class="font-semibold text-text-primary">Fotos (opcional)</h2>
        </div>
      </div>
      <div class="card-body space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <select bind:value={photoType} class="select" style="max-width:220px;">
            <option value="identity">Foto de cédula / documento</option>
            <option value="other">Otra foto</option>
          </select>
          <input id="photo-input" type="file" accept="image/*" multiple
                 on:change={onPhotoSelect}
                 class="text-sm" />
          <button type="button" class="btn-secondary"
                  on:click={handlePhotoUpload}
                  disabled={photoUploading || photoFiles.length === 0}>
            {#if photoUploading}<Loader2 size={14} class="animate-spin" />{:else}<Upload size={14} />{/if}
            Subir
          </button>
        </div>

        {#if photoError}
          <div class="text-sm text-red-600 flex items-center gap-1.5">
            <AlertCircle size={14} /> {photoError}
          </div>
        {/if}

        {#if photoUploaded.length > 0}
          <div class="text-xs text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 size={14} /> {photoUploaded.length} foto{photoUploaded.length === 1 ? '' : 's'} subida{photoUploaded.length === 1 ? '' : 's'} correctamente.
          </div>
        {/if}

        <p class="text-xs text-text-muted">
          Máximo 5 imágenes por subida, 5 MB cada una. Formatos: JPG, PNG, WEBP, HEIC.
        </p>
      </div>
    </div>

    {#if saveError}
      <div class="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
        <AlertCircle size={16} /> {saveError}
      </div>
    {/if}

    <div class="flex items-center justify-end gap-2 pb-6">
      <!-- CTA dorado de marca (igual al botón de los correos) -->
      <button type="submit" disabled={saving}
              class="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-extrabold text-[15px]
                     text-[#0E255C] bg-[#FDB913] hover:bg-[#ECA600] transition-colors
                     shadow-[0_4px_12px_rgba(253,185,19,0.35)] disabled:opacity-60">
        {#if saving}<Loader2 size={15} class="animate-spin" />{:else}<Save size={15} />{/if}
        Guardar mis datos
      </button>
    </div>
  </form>
{/if}
