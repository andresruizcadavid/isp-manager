<script>
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store.js';
  import { Eye, EyeOff, LogIn, Wifi } from 'lucide-svelte';

  let email = '';
  let password = '';
  let loading = false;
  let error = '';
  let showPassword = false;

  async function handleLogin() {
    loading = true;
    error = '';
    try {
      await authStore.login({ email, password });
      goto('/dashboard');
    } catch (e) {
      error = e.message || 'Credenciales incorrectas';
    } finally {
      loading = false;
    }
  }

  function fillDemo() {
    email = 'admin@demo.com';
    password = 'admin123';
  }
</script>

<svelte:head>
  <title>ISP Manager — Iniciar Sesión</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</svelte:head>

<div class="min-h-screen flex items-center justify-center px-4 py-10 bg-brand-600"
     style="font-family: 'Inter', system-ui, sans-serif;">

  <div class="w-full max-w-sm">

    <!-- Centered card with everything inside -->
    <div class="bg-white rounded-2xl shadow-2xl p-7 sm:p-8">

      <!-- Logo + title (inside the card) -->
      <div class="flex flex-col items-center mb-8">
        <div class="bg-brand-600 p-4 rounded-2xl mb-4 shadow-md shadow-brand-600/20">
          <Wifi size={40} class="text-white" strokeWidth={1.75} />
        </div>
        <h1 class="text-2xl font-bold text-text-primary tracking-tight">
          ISP Manager
        </h1>
        <p class="text-sm text-text-secondary text-center mt-1.5">
          Oficina TIC — Jamundí, Valle del Cauca
        </p>
      </div>

      <!-- Error alert -->
      {#if error}
        <div class="flex items-start gap-3 bg-red-50 border border-red-100
                    text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">
          <span class="text-red-500">⚠</span>
          <span>{error}</span>
        </div>
      {/if}

      <form on:submit|preventDefault={handleLogin} class="space-y-5">

        <!-- Email -->
        <div>
          <label for="email" class="block text-sm font-medium text-text-primary mb-2">
            Usuario
          </label>
          <input
            id="email"
            type="email"
            bind:value={email}
            placeholder="admin@empresa.com"
            required
            autocomplete="email"
            class="w-full px-4 py-3 text-sm text-text-primary bg-white
                   border border-slate-200 rounded-xl placeholder:text-text-muted
                   focus:outline-none focus:ring-2 focus:ring-brand-600/20
                   focus:border-brand-600
                   hover:border-slate-300
                   transition-all duration-200"
          />
        </div>

        <!-- Password -->
        <div>
          <label for="password" class="block text-sm font-medium text-text-primary mb-2">
            Contraseña
          </label>
          <div class="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              on:input={(e) => password = e.currentTarget.value}
              placeholder="••••••••"
              required
              autocomplete="current-password"
              class="w-full px-4 py-3 pr-11 text-sm text-text-primary bg-white
                     border border-slate-200 rounded-xl placeholder:text-text-muted
                     focus:outline-none focus:ring-2 focus:ring-brand-600/20
                     focus:border-brand-600
                     hover:border-slate-300
                     transition-all duration-200"
            />
            <button
              type="button"
              on:click={() => showPassword = !showPassword}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted
                     hover:text-text-secondary transition-colors p-1 rounded">
              <svelte:component this={showPassword ? EyeOff : Eye} size={16} />
            </button>
          </div>
        </div>

        <!-- Submit -->
        <!-- Note: page bg is brand-600 (same as the primary token). We use
             brand-800 here to give the CTA enough contrast against the page,
             instead of inheriting the global .btn-primary which would blend in. -->
        <button
          type="submit"
          disabled={loading}
          class="w-full flex items-center justify-center gap-2.5
                 h-12 px-4 mt-2
                 bg-brand-800 hover:bg-brand-900 active:scale-[0.98]
                 disabled:bg-brand-400 disabled:cursor-not-allowed disabled:active:scale-100
                 text-white text-sm font-semibold rounded-xl
                 shadow-lg shadow-brand-900/30
                 transition-all duration-200">
          {#if loading}
            <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor"
                      stroke-width="3" stroke-dasharray="32"
                      stroke-dashoffset="12" />
            </svg>
            Verificando...
          {:else}
            <LogIn size={16} strokeWidth={2.25} />
            Iniciar Sesión
          {/if}
        </button>
      </form>

      <!-- Demo hint -->
      <div class="mt-6 pt-5 border-t border-slate-100 text-center">
        <p class="text-xs text-text-muted">
          ¿Es tu primera vez?
          <button type="button" on:click={fillDemo}
                  class="text-brand-600 hover:text-brand-700 font-medium
                         underline-offset-2 hover:underline transition-colors">
            Usar acceso demo
          </button>
        </p>
      </div>
    </div>

    <!-- Footer (on blue bg → use inverse-muted) -->
    <p class="text-center text-xs text-text-inverse-muted mt-6">
      Conectado a <span class="font-medium text-white">internet-online</span> · isp.jamundi.gov.co
    </p>
  </div>
</div>
