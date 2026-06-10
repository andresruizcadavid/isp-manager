<script>
  import { Mail, ArrowLeft, CheckCircle2, Loader2 } from 'lucide-svelte';

  let email = '';
  let loading = false;
  let sent = false;
  let error = '';

  async function handleSubmit() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/v1/client-auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Error');
      sent = true;
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }
</script>

<svelte:head><title>Recuperar Contraseña — Mi Portal</title></svelte:head>

<div class="min-h-[70vh] flex items-center justify-center">
  <div class="w-full max-w-sm">
    <div class="bg-white rounded-2xl shadow-lg border border-slate-200 p-7 sm:p-8">
      {#if sent}
        <div class="text-center">
          <div class="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 size={28} class="text-emerald-600" />
          </div>
          <h2 class="text-lg font-semibold text-text-primary mb-2">Correo enviado</h2>
          <p class="text-sm text-text-secondary mb-6">Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.</p>
          <a href="/portal/login" class="text-sm text-brand-600 hover:underline">Volver a Iniciar Sesión</a>
        </div>
      {:else}
        <a href="/portal/login" class="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary mb-6">
          <ArrowLeft size={14} /> Volver
        </a>
        <div class="flex flex-col items-center mb-6">
          <div class="w-12 h-12 bg-brand-100 rounded-2xl flex items-center justify-center mb-3">
            <Mail size={24} class="text-brand-600" />
          </div>
          <h1 class="text-lg font-semibold text-text-primary">Recuperar contraseña</h1>
          <p class="text-xs text-text-secondary text-center mt-1">Te enviaremos un enlace a tu correo</p>
        </div>
        {#if error}
          <div class="bg-red-50 border border-red-100 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">{error}</div>
        {/if}
        <form on:submit|preventDefault={handleSubmit} class="space-y-4">
          <div>
            <label for="email" class="block text-sm font-medium text-text-primary mb-1.5">Correo electrónico</label>
            <input id="email" type="email" bind:value={email} placeholder="tucorreo@ejemplo.com" required
              class="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600" />
          </div>
          <button type="submit" disabled={loading || !email}
            class="w-full flex items-center justify-center gap-2 h-12 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] disabled:bg-brand-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl shadow-lg shadow-brand-600/20 transition-all">
            {#if loading}
              <Loader2 size={16} class="animate-spin" />
              Enviando...
            {:else}
              Enviar enlace
            {/if}
          </button>
        </form>
      {/if}
    </div>
  </div>
</div>
