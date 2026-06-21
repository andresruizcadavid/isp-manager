<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { Eye, EyeOff, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-svelte';

  const BASE = import.meta.env.PUBLIC_API_URL || '';

  let token = '';
  let password = '';
  let confirm = '';
  let showPassword = false;
  let loading = false;
  let error = '';
  let success = false;

  onMount(() => {
    token = $page.params.token;
  });

  async function handleSubmit() {
    if (password.length < 6) { error = 'La contraseña debe tener al menos 6 caracteres'; return; }
    if (password !== confirm) { error = 'Las contraseñas no coinciden'; return; }
    loading = true;
    error = '';
    try {
      const res = await fetch(`${BASE}/api/v1/client-auth/register-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Error');
      success = true;
    } catch (/** @type {any} */ e) { error = e.message; }
    finally { loading = false; }
  }
</script>

<svelte:head><title>Crear Contraseña — Mi Portal</title></svelte:head>

<div class="min-h-[70vh] flex items-center justify-center">
  <div class="w-full max-w-sm">
    <div class="bg-white rounded-2xl shadow-lg border border-slate-200 p-7 sm:p-8">
      {#if success}
        <div class="text-center">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 size={28} class="text-emerald-600" />
          </div>
          <h2 class="text-lg font-semibold text-text-primary mb-2">¡Contraseña creada!</h2>
          <p class="text-sm text-text-secondary mb-6">Ahora puedes iniciar sesión.</p>
          <a href="/portal/login" class="btn-primary inline-flex items-center gap-2 px-6 py-2.5">Ir a Iniciar Sesión</a>
        </div>
      {:else if !token}
        <div class="text-center">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle size={28} class="text-red-600" />
          </div>
          <h2 class="text-lg font-semibold text-text-primary">Enlace inválido</h2>
        </div>
      {:else}
        <div class="flex flex-col items-center mb-6">
          <div class="w-12 h-12 bg-brand-100 rounded-2xl flex items-center justify-center mb-3">
            <KeyRound size={24} class="text-brand-600" />
          </div>
          <h1 class="text-lg font-semibold text-text-primary">Crea tu contraseña</h1>
          <p class="text-xs text-text-secondary text-center mt-1">Elige una contraseña para acceder a Mi Portal</p>
        </div>

        {#if error}
          <div class="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">{error}</div>
        {/if}

        <form on:submit|preventDefault={handleSubmit} class="space-y-4">
          <div>
            <label for="password" class="block text-sm font-medium text-text-primary mb-1.5">Contraseña</label>
            <div class="relative">
<input id="password" type={showPassword ? 'text' : 'password'} value={password} on:input={e => password = /** @type {HTMLInputElement} */ (e.currentTarget).value}
                placeholder="Mínimo 6 caracteres" required minlength="6"
                class="w-full px-4 py-3 pr-11 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600" />
              <button type="button" on:click={() => showPassword = !showPassword}
                class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
                {#if showPassword}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
              </button>
            </div>
          </div>
          <div>
            <label for="confirm" class="block text-sm font-medium text-text-primary mb-1.5">Confirmar contraseña</label>
            <input id="confirm" type="password" bind:value={confirm} placeholder="Repite la contraseña" required
              class="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600" />
          </div>
          <button type="submit" disabled={loading}
            class="w-full flex items-center justify-center gap-2 h-12 bg-brand-600 hover:bg-brand-700 active:scale-[0.98]
              disabled:bg-brand-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-lg shadow-brand-600/20 transition-all">
            {#if loading}
              <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="32" stroke-dashoffset="12" /></svg>
              Guardando...
            {:else}
              Crear Contraseña
            {/if}
          </button>
        </form>
      {/if}
    </div>
  </div>
</div>
