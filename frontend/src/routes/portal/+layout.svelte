<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { Wifi, LogOut, LayoutDashboard, FileText, CreditCard, User } from 'lucide-svelte';
  import { clientAuthStore, isClientAuthenticated } from '$lib/stores/client-auth.store.js';

  let checking = true;
  let mobileMenuOpen = false;

  $: pathname = $page.url.pathname;

  onMount(async () => {
    await clientAuthStore.checkSession();
    checking = false;
  });

  $: if (!checking && !$isClientAuthenticated) {
    if (!pathname.startsWith('/portal/login') &&
        !pathname.startsWith('/portal/forgot-password') &&
        !pathname.startsWith('/portal/register-password')) {
      goto('/portal/login');
    }
  }

  async function handleLogout() {
    await clientAuthStore.logout();
    goto('/portal/login');
  }

  /** @param {string} href */
  function isActive(href) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  const navItems = [
    { href: '/portal/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/portal/invoices', label: 'Facturas', icon: FileText },
    { href: '/portal/payments', label: 'Pagos', icon: CreditCard },
    { href: '/portal/profile', label: 'Mi Perfil', icon: User }
  ];
</script>

<div class="min-h-screen flex flex-col bg-surface-page">
  <header class="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4">
    <div class="flex items-center gap-2.5">
      <div class="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
        <Wifi size={16} class="text-white" />
      </div>
      <span class="text-sm font-semibold text-text-primary">Mi Portal</span>
    </div>
    <div class="flex items-center gap-2">
      {#if $isClientAuthenticated}
        <button on:click={handleLogout} class="flex items-center gap-1.5 text-sm text-text-muted hover:text-red-600 transition px-2 py-1.5 rounded-lg hover:bg-red-50">
          <LogOut size={14} />
          <span class="hidden sm:inline">Salir</span>
        </button>
      {/if}
      <button on:click={() => mobileMenuOpen = !mobileMenuOpen} class="sm:hidden p-2 rounded-lg text-text-secondary hover:bg-slate-100">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
          {#if mobileMenuOpen}
            <path d="M5 15L15 5M5 5l10 10" />
          {:else}
            <path d="M3 5h14M3 10h14M3 15h14" />
          {/if}
        </svg>
      </button>
    </div>
  </header>

  {#if mobileMenuOpen && $isClientAuthenticated}
    <nav class="sm:hidden bg-white border-b border-slate-200 px-2 pb-2">
      {#each navItems as item}
        <a href={item.href}
          class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm {isActive(item.href) ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-secondary hover:bg-slate-50'}"
          on:click={() => mobileMenuOpen = false}>
          <svelte:component this={item.icon} size={16} />
          {item.label}
        </a>
      {/each}
    </nav>
  {/if}

  <main class="flex-1 w-full max-w-5xl mx-auto px-4 py-6">
    {#if checking}
      <div class="flex items-center justify-center py-20">
        <svg class="animate-spin w-6 h-6 text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-dasharray="32" stroke-dashoffset="12" />
        </svg>
      </div>
    {:else}
      <slot />
    {/if}
  </main>

  <footer class="border-t border-slate-200 bg-white py-3">
    <p class="text-center text-xs text-text-muted">Internet Online — Jamundí, Valle del Cauca</p>
  </footer>
</div>
