<script>
  import { onMount } from 'svelte';
  import { Download, X } from 'lucide-svelte';

  /** @type {any} */
  let deferredPrompt = null;
  let showPrompt = false;
  let isInstalled = false;
  let isStandalone = false;
  let dismissed = false;

  onMount(() => {
    if (typeof window === 'undefined') return;

    const w = /** @type {any} */ (window);
    isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                   w.navigator.standalone === true;
    if (isStandalone) return;
    if (localStorage.getItem('pwa-installed')) { isInstalled = true; return; }
    if (localStorage.getItem('pwa-dismissed')) { dismissed = true; return; }

    // Use event captured early in app.html if available
    if (w.__deferredPrompt) {
      deferredPrompt = w.__deferredPrompt;
      showPrompt = true;
    }

    window.addEventListener('beforeinstallprompt', (/** @type {any} */ e) => {
      e.preventDefault();
      deferredPrompt = e;
      showPrompt = true;
    });

    window.addEventListener('appinstalled', () => {
      showPrompt = false;
      isInstalled = true;
      localStorage.setItem('pwa-installed', 'true');
    });
  });

  function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((/** @type {any} */ choice) => {
      if (choice.outcome === 'accepted') {
        showPrompt = false;
        localStorage.setItem('pwa-installed', 'true');
      }
      deferredPrompt = null;
    });
  }

  function dismiss() {
    showPrompt = false;
    dismissed = true;
    localStorage.setItem('pwa-dismissed', 'true');
  }
</script>

{#if showPrompt && !isStandalone && !isInstalled && !dismissed}
  <div class="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80">
    <div class="bg-white rounded-xl shadow-2xl border border-slate-200 p-4 flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-slate-900 flex items-center justify-center shrink-0">
        <Download size={18} class="text-white" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-slate-900">Instalar ISP Manager</p>
        <p class="text-xs text-slate-500 mt-0.5">Agrega esta app a tu pantalla de inicio</p>
      </div>
      <button type="button" on:click={install}
              class="shrink-0 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 active:bg-sky-800 text-white text-xs font-semibold transition">
        Instalar
      </button>
      <button type="button" on:click={dismiss}
              class="shrink-0 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              aria-label="Cerrar">
        <X size={16} />
      </button>
    </div>
  </div>
{/if}

{#if !showPrompt && !isStandalone && !isInstalled && !dismissed}
  <div class="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80">
    <div class="bg-white rounded-xl shadow-2xl border border-slate-200 p-4 flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-slate-900 flex items-center justify-center shrink-0">
        <Download size={18} class="text-white" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-slate-900">Agregar a pantalla de inicio</p>
        <p class="text-xs text-slate-500 mt-0.5">Android: Menú <span class="font-semibold">⋮</span> → Agregar a pantalla de inicio</p>
        <p class="text-xs text-slate-400 mt-0.5">iPhone: Compartir <span class="font-semibold">☐↑</span> → Agregar a pantalla de inicio</p>
      </div>
      <button type="button" on:click={dismiss}
              class="shrink-0 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              aria-label="Cerrar">
        <X size={16} />
      </button>
    </div>
  </div>
{/if}
