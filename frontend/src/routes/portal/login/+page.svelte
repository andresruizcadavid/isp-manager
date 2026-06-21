<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Eye, EyeOff, LogIn, Wifi } from 'lucide-svelte';
  import { clientAuthStore } from '$lib/stores/client-auth.store.js';

  let email = '';
  let password = '';
  let loading = false;
  let error = '';
  let showPassword = false;
  let checking = true;

  onMount(async () => {
    const ok = await clientAuthStore.checkSession();
    if (ok) goto('/portal/dashboard', { replaceState: true });
    checking = false;
  });

  async function handleLogin() {
    loading = true;
    error = '';
    try {
      await clientAuthStore.login(email, password);
      goto('/portal/dashboard');
    } catch (/** @type {any} */ e) {
      error = e.message || 'Credenciales incorrectas';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Mi Portal — Iniciar Sesión</title>
</svelte:head>

{#if checking}
  <div class="flex items-center justify-center py-20">
    <svg class="animate-spin w-6 h-6 text-brand-600" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="32" stroke-dashoffset="12" />
    </svg>
  </div>
{:else}
<div class="min-h-[70vh] flex items-center justify-center">
  <div class="w-full max-w-sm">
    <div class="bg-white rounded-2xl shadow-lg border border-slate-200 p-7 sm:p-8">
      <div class="flex flex-col items-center mb-8">
        <div class="bg-brand-600 p-3.5 rounded-2xl mb-4 shadow-md shadow-brand-600/20">
          <Wifi size={32} class="text-white" strokeWidth={1.75} />
        </div>
        <h1 class="text-xl font-bold text-text-primary tracking-tight">Mi Portal</h1>
        <p class="text-xs text-text-secondary text-center mt-1">Accede a tus facturas y pagos</p>
      </div>

      {#if error}
        <div class="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">{error}</div>
      {/if}

      <form on:submit|preventDefault={handleLogin} class="space-y-5">
        <div>
          <label for="email" class="block text-sm font-medium text-text-primary mb-2">Correo electrónico</label>
          <input id="email" type="email" bind:value={email} placeholder="tucorreo@ejemplo.com" required autocomplete="email"
            class="w-full px-4 py-3 text-sm text-text-primary bg-white border border-slate-200 rounded-xl placeholder:text-text-muted
              focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 hover:border-slate-300 transition-all" />
        </div>

        <div>
          <label for="password" class="block text-sm font-medium text-text-primary mb-2">Contraseña</label>
          <div class="relative">
<input id="password" type={showPassword ? 'text' : 'password'} value={password} on:input={e => password = /** @type {HTMLInputElement} */ (e.currentTarget).value} placeholder="••••••••" required autocomplete="current-password"
              class="w-full px-4 py-3 pr-11 text-sm text-text-primary bg-white border border-slate-200 rounded-xl placeholder:text-text-muted
                focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 hover:border-slate-300 transition-all" />
            <button type="button" on:click={() => showPassword = !showPassword} aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition p-1 rounded">
              {#if showPassword}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading}
          class="w-full flex items-center justify-center gap-2 h-12 px-4 bg-brand-600 hover:bg-brand-700 active:scale-[0.98]
            disabled:bg-brand-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-lg shadow-brand-600/20 transition-all">
          {#if loading}
            <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="32" stroke-dashoffset="12" /></svg>
            Entrando...
          {:else}
            <LogIn size={16} strokeWidth={2.25} />
            Iniciar Sesión
          {/if}
        </button>
      </form>

      <div class="mt-5 pt-4 border-t border-slate-100 text-center space-y-2">
        <a href="/portal/forgot-password" class="block text-xs text-brand-600 hover:text-brand-700 font-medium hover:underline">¿Olvidaste tu contraseña?</a>
      </div>
    </div>
  </div>
</div>
{/if}
