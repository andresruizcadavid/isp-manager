<script>
  // Aviso de pago (interstitial). El cliente TIENE servicio; se le recuerda
  // pagar antes de la suspensión. Contador de 20s arriba: el botón "Continuar"
  // se habilita al llegar a 0 (o auto-sale). "Continuar" habilita la navegación
  // (AvisoOK con timeout en el router). Siempre disponible el pago por Wompi.
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import { Loader2, AlertTriangle, CheckCircle2, CreditCard, Phone, Clock } from 'lucide-svelte';

  const apiBase = import.meta.env.VITE_API_URL || '/api/v1';
  const COUNTDOWN = 20;
  $: token = $page.params.token;

  let loading = true;
  let error = '';
  /** @type {any} */
  let info = null;

  let left = COUNTDOWN;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  let continuing = false;
  let done = false;   // ya reconoció → puede navegar

  async function load() {
    loading = true; error = '';
    try {
      const res = await fetch(`${apiBase}/public/aviso/${token}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json?.error?.message || 'No se pudo cargar la información.');
      info = json.data;
      if (!info.noDebt) startCountdown();
    } catch (e) {
      error = /** @type {any} */ (e)?.message || 'No se pudo cargar la información.';
    } finally {
      loading = false;
    }
  }

  function startCountdown() {
    clearInterval(timer);
    left = COUNTDOWN;
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) { clearInterval(timer); left = 0; continuar(true); }  // auto-salida a los 0s
    }, 1000);
  }

  async function continuar(auto = false) {
    if (continuing || done) return;
    continuing = true;
    try { await fetch(`${apiBase}/public/aviso/${token}/continuar`, { method: 'POST' }); }
    catch { /* best-effort: igual liberamos la UI */ }
    continuing = false;
    done = true;
  }

  onMount(load);
  onDestroy(() => clearInterval(timer));

  $: paid = $page.url.searchParams.get('pago') === 'ok';
  $: pct = Math.round(((COUNTDOWN - left) / COUNTDOWN) * 100);

  let nequiCopied = false;
  /** @param {string} n */
  async function copyNequi(n) {
    try { await navigator.clipboard.writeText(n); nequiCopied = true; setTimeout(() => (nequiCopied = false), 1800); } catch { /* noop */ }
  }
  /** @param {any} b */
  function waLink(b) {
    const num = b?.whatsappRaw || b?.phoneRaw || '';
    return `https://wa.me/${num}?text=${encodeURIComponent('Hola, quiero ponerme al día con mi factura de Internet Online.')}`;
  }
</script>

<svelte:head><title>Recordatorio de pago — Internet Online</title></svelte:head>

{#if loading}
  <div class="flex items-center justify-center py-20 text-slate-500">
    <Loader2 class="w-6 h-6 animate-spin" /> <span class="ml-2">Cargando…</span>
  </div>

{:else if error}
  <div class="max-w-md mx-auto rounded-2xl bg-white shadow-sm border border-slate-200 p-6 text-center">
    <AlertTriangle class="w-10 h-10 text-amber-500 mx-auto" />
    <h1 class="mt-3 text-lg font-bold text-[#16357E]">Enlace no válido</h1>
    <p class="mt-1 text-sm text-slate-600">{error}</p>
  </div>

{:else if info?.noDebt}
  <div class="max-w-md mx-auto rounded-2xl bg-white shadow-sm border border-slate-200 p-6 text-center">
    <CheckCircle2 class="w-12 h-12 text-emerald-500 mx-auto" />
    <h1 class="mt-3 text-xl font-bold text-[#16357E]">¡Estás al día!</h1>
    <p class="mt-1 text-sm text-slate-600">Hola {info.name}, gracias por tu pago puntual.</p>
  </div>

{:else}
  <!-- Barra de cuenta regresiva (arriba) -->
  <div class="max-w-md mx-auto mb-4">
    <div class="rounded-xl bg-white border border-slate-200 shadow-sm px-4 py-3">
      <div class="flex items-center justify-between text-sm">
        <span class="inline-flex items-center gap-1.5 font-medium text-[#16357E]"><Clock class="w-4 h-4" /> Recordatorio de pago</span>
        <span class="tabular-nums font-bold {left > 0 ? 'text-slate-700' : 'text-emerald-600'}">
          {left > 0 ? `${left}s` : '¡Listo!'}
        </span>
      </div>
      <div class="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full bg-[#FDB913] transition-all duration-1000 ease-linear" style="width:{pct}%"></div>
      </div>
    </div>
  </div>

  <div class="max-w-md mx-auto space-y-4">
    <div class="rounded-2xl bg-white shadow-sm border-2 border-[#FDB913] overflow-hidden">
      <div class="bg-[#16357E] px-5 py-4 text-white text-center">
        <AlertTriangle class="w-9 h-9 mx-auto text-[#FDB913]" />
        <h1 class="mt-2 text-xl font-extrabold">Tu factura está por vencer</h1>
        <p class="text-sm text-white/85 mt-0.5">Hola {info.name}, paga a tiempo y evita la suspensión de tu servicio.</p>
      </div>

      <div class="p-5 text-center">
        {#if paid}
          <div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-3 mb-4 inline-flex items-center gap-1.5">
            <CheckCircle2 class="w-4 h-4" /> Gracias, estamos verificando tu pago.
          </div>
        {/if}

        <p class="text-sm text-slate-600">Valor pendiente</p>
        <p class="text-4xl font-extrabold text-[#16357E] mt-1">${info.amountCop.toLocaleString('es-CO')}</p>
        {#if info.dueDate}
          <p class="text-xs text-slate-400 mt-1">Vence el {new Date(info.dueDate).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
        {/if}

        <a href={info.checkoutUrl} rel="external"
           class="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl
                  font-bold text-[#0E255C] bg-[#FDB913] hover:bg-[#ECA600] transition-colors shadow-sm">
          <CreditCard class="w-5 h-5" /> Pagar ahora con Wompi
        </a>

        <!-- Nequi (transferencia directa) -->
        {#if info.brand?.nequiRaw}
          <button type="button" on:click={() => copyNequi(info.brand.nequiRaw)}
                  class="mt-3 w-full inline-flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl
                         text-white font-semibold transition-colors shadow-sm"
                  style="background:#DA0081;" title="Toca para copiar el número">
            <span class="inline-flex items-center gap-2">
              <span class="lowercase font-extrabold tracking-tight text-white/95 text-lg">nequi</span>
              <span class="tabular-nums">{info.brand.nequi}</span>
            </span>
            <span class="text-xs bg-white/20 rounded px-2 py-0.5">{nequiCopied ? '¡Copiado!' : 'Copiar'}</span>
          </button>
          <p class="mt-1.5 text-[11px] text-slate-400">O transfiere por <b>Nequi</b> a este número y envíanos el comprobante.</p>
        {/if}

        <!-- Continuar: habilitado a los 0s -->
        <button on:click={() => continuar(false)} disabled={left > 0 || continuing || done}
                class="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
                       font-semibold border transition-colors
                       {left > 0 || done
                          ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                          : 'border-[#16357E] text-[#16357E] hover:bg-[#16357E]/5'}">
          {#if continuing}<Loader2 class="w-4 h-4 animate-spin" /> Habilitando…
          {:else if done}<CheckCircle2 class="w-4 h-4 text-emerald-600" /> Ya puedes navegar
          {:else if left > 0}Continuar ({left}s)
          {:else}Continuar y seguir navegando{/if}
        </button>

        {#if done}
          <p class="mt-2 text-xs text-emerald-600">Servicio habilitado. Puedes cerrar esta página y navegar con normalidad.</p>
        {:else}
          <p class="mt-2 text-[11px] text-slate-400">Podrás continuar cuando termine la cuenta regresiva.</p>
        {/if}
      </div>
    </div>

    <a href={waLink(info.brand)} rel="external"
       class="flex items-center justify-center gap-2 w-full max-w-md mx-auto px-4 py-2.5 rounded-xl
              font-semibold text-white transition-colors shadow-sm" style="background:#25D366;">
      <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.15-1.7-.83-2-.93s-.46-.15-.65.15-.75.93-.92 1.12-.33.22-.62.07a8.2 8.2 0 0 1-2.4-1.48 9 9 0 0 1-1.67-2.07c-.17-.3 0-.46.13-.6l.44-.52c.15-.17.2-.3.3-.5s.05-.37 0-.52-.65-1.57-.9-2.15-.47-.48-.65-.49h-.56a1.07 1.07 0 0 0-.77.36 3.25 3.25 0 0 0-1 2.42 5.64 5.64 0 0 0 1.18 3 12.9 12.9 0 0 0 4.94 4.36c.69.3 1.23.48 1.65.61a4 4 0 0 0 1.82.11c.56-.08 1.7-.69 1.94-1.36s.24-1.24.17-1.36-.26-.2-.55-.34zM12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2z"/></svg>
      Chatear ahora por WhatsApp
    </a>
    <div class="text-center text-sm text-slate-500">
      o llámanos al
      <a href="tel:{info.brand?.phoneRaw}" class="font-semibold text-[#16357E] underline ml-1">{info.brand?.phone}</a>
    </div>
  </div>
{/if}
