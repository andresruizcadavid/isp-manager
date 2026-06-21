<script>
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/auth.store.js';
  import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-svelte';

  $: roleLabel = (/** @type {Record<string, string>} */ ({
    ADMIN:      'Administrador',
    OPERATOR:   'Administrador',
    TECHNICIAN: 'Técnico',
    VIEWER:     'Visualizador'
  }))[$user?.role || ''] || 'Usuario';
</script>

<svelte:head><title>Acceso denegado — ISP Manager</title></svelte:head>

<div class="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4 text-center">
  <div class="w-20 h-20 rounded-2xl bg-red-50 flex items-center justify-center">
    <ShieldAlert size={40} class="text-red-500" />
  </div>

  <div>
    <h1 class="text-2xl font-semibold text-text-primary">Acceso denegado</h1>
    <p class="text-sm text-text-secondary mt-2 max-w-md">
      Tu rol <span class="font-semibold text-text-primary">{roleLabel}</span> no tiene
      permisos para ver esta sección. Si crees que es un error, contacta a un administrador.
    </p>
  </div>

  <div class="flex flex-wrap gap-2 mt-2">
    <button type="button" on:click={() => history.back()} class="btn-secondary">
      <ArrowLeft size={15} /> Volver
    </button>
    <button type="button" on:click={() => goto('/dashboard')} class="btn-primary">
      <LayoutDashboard size={15} /> Ir al Dashboard
    </button>
  </div>
</div>
