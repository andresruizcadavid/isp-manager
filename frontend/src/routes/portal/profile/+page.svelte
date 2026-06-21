<script>
  import { onMount } from 'svelte';
  import { User, Mail, Phone, MapPin, IdCard, Loader2, AlertCircle, Wifi } from 'lucide-svelte';
  import { portalApi } from '$lib/api/portal.api.js';

  /** @type {any} */
  let profile = null;
  let loading = true;
  let error = '';

  onMount(async () => { try { profile = await portalApi.getProfile(); } catch (/** @type {any} */ e) { error = e.message; } finally { loading = false; } });
</script>

<svelte:head><title>Mi Perfil — Mi Portal</title></svelte:head>

<div class="mb-6"><h1 class="text-xl font-bold text-text-primary">Mi Perfil</h1><p class="text-sm text-text-secondary">Información de tu cuenta</p></div>

{#if loading}<div class="flex items-center justify-center py-20"><Loader2 size={24} class="animate-spin text-brand-600" /></div>
{:else if error}<div class="card p-8 text-center"><AlertCircle size={24} class="mx-auto mb-3 text-red-500" /><p class="text-text-secondary">{error}</p></div>
{:else if profile}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div class="card">
      <div class="card-header"><h2 class="font-semibold text-text-primary flex items-center gap-2"><User size={14} /> Datos Personales</h2></div>
      <div class="card-body space-y-3">
        <div><label class="text-xs text-text-muted">Nombre</label><p class="text-sm font-medium text-text-primary">{profile.name}</p></div>
        <div><label class="text-xs text-text-muted flex items-center gap-1"><Mail size={11} /> Correo</label><p class="text-sm font-medium text-text-primary">{profile.email || '—'}</p></div>
        <div><label class="text-xs text-text-muted flex items-center gap-1"><Phone size={11} /> Teléfono</label><p class="text-sm font-medium text-text-primary">{profile.phone || '—'}</p></div>
        <div><label class="text-xs text-text-muted flex items-center gap-1"><IdCard size={11} /> Documento</label><p class="text-sm font-medium text-text-primary">{profile.documentType || ''} {profile.documentNumber || '—'}</p></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2 class="font-semibold text-text-primary flex items-center gap-2"><MapPin size={14} /> Dirección</h2></div>
      <div class="card-body space-y-3">
        <div><label class="text-xs text-text-muted">Dirección</label><p class="text-sm font-medium text-text-primary">{profile.address || '—'}</p></div>
        <div><label class="text-xs text-text-muted">Barrio</label><p class="text-sm font-medium text-text-primary">{profile.neighborhood || '—'}</p></div>
        <div><label class="text-xs text-text-muted">Ciudad</label><p class="text-sm font-medium text-text-primary">{profile.city || '—'}</p></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2 class="font-semibold text-text-primary flex items-center gap-2"><Wifi size={14} /> Servicio</h2></div>
      <div class="card-body space-y-3">
        <div><label class="text-xs text-text-muted">Estado</label><p class="text-sm font-medium text-text-primary"><span class="inline-block w-2 h-2 rounded-full {profile.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-amber-500'} mr-1.5"></span>{profile.status === 'ACTIVE' ? 'Activo' : profile.status}</p></div>
        <div><label class="text-xs text-text-muted">Cliente desde</label><p class="text-sm font-medium text-text-primary">{new Date(profile.memberSince).toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' })}</p></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h2 class="font-semibold text-text-primary">Cuenta</h2></div>
      <div class="card-body space-y-3">
        <div><label class="text-xs text-text-muted">Contraseña</label><p class="text-sm text-text-primary">{profile.hasPassword ? '✓ Configurada' : '— Pendiente'}</p></div>
        <div><label class="text-xs text-text-muted">Miembro desde</label><p class="text-sm font-medium text-text-primary">{new Date(profile.memberSince).toLocaleDateString('es-CO', { year:'numeric', month:'long' })}</p></div>
      </div>
    </div>
  </div>
{/if}
