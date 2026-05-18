<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { authStore, user } from '$lib/stores/auth.store.js';
  import { sidebarOpen } from '$lib/stores/ui.store.js';
  import { sidebarFor } from '$lib/permissions.js';
  import {
    LayoutDashboard, Users, Router, Network,
    CreditCard, Building2, LogOut, ChevronDown, ChevronRight,
    Menu, X, Activity
  } from 'lucide-svelte';

  $: initial = ($user?.name || $user?.email || '?').trim().charAt(0).toUpperCase();
  $: displayName = $user?.name || $user?.email || 'Usuario';
  $: roleLabel = ({
    ADMIN:      'Administrador',
    OPERATOR:   'Administrador',
    TECHNICIAN: 'Técnico',
    VIEWER:     'Visualizador'
  })[$user?.role] || '—';

  // Auto-close the mobile drawer whenever the route changes.
  $: if ($page.url.pathname) $sidebarOpen = false;

  let expanded = {
    clientes: true, finanzas: false, sistema: false, empresa: false, monitor: false
  };

  // Icons per section key (presentation only — role gating lives in permissions.js).
  const SECTION_ICONS = {
    clientes: Users,
    finanzas: CreditCard,
    sistema:  Router,
    empresa:  Building2,
    monitor:  Activity
  };
  const TOP_ITEM_ICONS = {
    '/dashboard': LayoutDashboard
  };

  // Role-filtered menu — recomputes whenever the user (and thus role) changes.
  $: menu = sidebarFor($user?.role);

  function toggle(key) { expanded[key] = !expanded[key]; }

  function isActive(href) {
    return $page.url.pathname === href ||
           ($page.url.pathname.startsWith(href + '/') && href !== '/');
  }

  function getTitle() {
    const p = $page.url.pathname;
    const map = {
      '/dashboard': 'Dashboard',
      '/clients': 'Clientes',
      '/clients/new': 'Nuevo Cliente',
      '/zones': 'Zonas',
      '/invoices': 'Facturas',
      '/payments': 'Pagos',
      '/plans': 'Planes de Servicio',
      '/mikrotik/routers': 'Routers / NOC',
      '/mikrotik/accounts': 'Cuentas MikroTik',
      '/network/events':   'Historial de Eventos',
      '/network/settings': 'Alertas Telegram',
      '/network':          'Monitor de Red',
      '/reports': 'Reportes',
      '/settings': 'Configuración',
    };
    return Object.entries(map).find(([k]) => p.startsWith(k))?.[1] || 'ISP Manager';
  }
</script>

<div class="flex h-screen overflow-hidden bg-surface-page">

  <!-- Mobile backdrop (visible only when drawer open on < md) -->
  {#if $sidebarOpen}
    <button type="button" aria-label="Cerrar menú"
            on:click={() => $sidebarOpen = false}
            class="md:hidden fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm"></button>
  {/if}

  <!-- SIDEBAR (brand-800 background, white/brand-100 text — WCAG AA) -->
  <aside class="w-60 bg-brand-800 flex flex-col flex-shrink-0 overflow-y-auto
                fixed inset-y-0 left-0 z-40 transform transition-transform duration-200
                {$sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                md:static md:translate-x-0">

    <!-- Brand -->
    <div class="px-4 py-5 border-b border-brand-700">
      <div class="flex items-center justify-between gap-2.5">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-8 h-8 bg-brand-600 rounded-lg flex items-center
                      justify-center flex-shrink-0 shadow-md shadow-brand-900/30">
            <svelte:component this={Network} size={16} class="text-white" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-white leading-tight truncate">
              ISP Manager
            </div>
            <div class="text-[11px] text-brand-100 leading-tight truncate">
              Panel Administrativo
            </div>
          </div>
        </div>
        <!-- Close button (only on mobile) -->
        <button type="button" on:click={() => $sidebarOpen = false}
                aria-label="Cerrar menú"
                class="md:hidden p-2 -mr-2 rounded text-brand-100 hover:text-white
                       hover:bg-brand-700 active:scale-95 transition">
          <X size={18} />
        </button>
      </div>
    </div>

    <!-- Nav (filtered by role via sidebarFor) -->
    <nav class="flex-1 py-3 px-2">
      {#each menu as section}
        {#if !section.key}
          {#each section.items as item}
            <a href={item.href}
               class="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5
                      text-xs font-medium transition-colors duration-150
                      {isActive(item.href)
                        ? 'bg-brand-600 text-white font-semibold'
                        : 'text-brand-100 hover:bg-brand-700 hover:text-white'}">
              <svelte:component this={TOP_ITEM_ICONS[item.href] || LayoutDashboard} size={14} />
              {item.label}
            </a>
          {/each}
        {:else}
          <button on:click={() => toggle(section.key)}
                  class="w-full flex items-center justify-between px-3 py-2
                         rounded-lg text-xs font-medium text-brand-100
                         hover:bg-brand-700 hover:text-white
                         transition-colors duration-150 mb-0.5">
            <div class="flex items-center gap-2.5">
              <svelte:component this={SECTION_ICONS[section.key] || Network} size={14} />
              <span>{section.label}</span>
            </div>
            <svelte:component
              this={expanded[section.key] ? ChevronDown : ChevronRight}
              size={12} class="text-brand-200" />
          </button>

          {#if expanded[section.key]}
            <div class="mb-1">
              {#each section.items as item}
                <a href={item.href}
                   class="flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-lg
                          text-xs transition-colors duration-150
                          {isActive(item.href)
                            ? 'text-white bg-brand-600 font-medium'
                            : 'text-brand-200 hover:text-white hover:bg-brand-700'}">
                  <div class="w-1 h-1 rounded-full bg-current opacity-70
                               flex-shrink-0"></div>
                  {item.label}
                </a>
              {/each}
            </div>
          {/if}
        {/if}
      {/each}
    </nav>

    <!-- User card (anchored to the bottom, just above logout) -->
    <div class="mt-auto px-3 pt-4 pb-2 border-t border-brand-700">
      <div class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-brand-700/60">
        <div class="w-9 h-9 rounded-full bg-brand-500 flex items-center
                    justify-center text-sm font-bold text-white flex-shrink-0">
          {initial}
        </div>
        <div class="min-w-0">
          <div class="text-xs font-medium text-white truncate leading-tight" title={displayName}>
            {displayName}
          </div>
          <div class="text-[10px] text-brand-200 leading-tight mt-0.5">{roleLabel}</div>
        </div>
      </div>
    </div>

    <!-- Logout (anchored at the very bottom) -->
    <div class="px-3 pb-3">
      <button on:click={async () => { await authStore.logout(); goto('/login'); }}
              class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg
                     text-xs text-brand-100 hover:bg-brand-700 hover:text-white
                     active:scale-[0.98]
                     transition-colors duration-150">
        <LogOut size={14} />
        Cerrar Sesión
      </button>
    </div>
  </aside>

  <!-- MAIN -->
  <div class="flex-1 flex flex-col overflow-hidden min-w-0">

    <!-- Topbar (h-14 consistent across breakpoints) -->
    <header class="h-14 bg-surface-card border-b border-slate-100 px-4 sm:px-6
                   flex items-center justify-between flex-shrink-0 gap-3">

      <div class="flex items-center gap-3 min-w-0">
        <!-- Hamburger (only < md) -->
        <button type="button" on:click={() => $sidebarOpen = true}
                aria-label="Abrir menú"
                class="md:hidden -ml-2 p-2 rounded-lg text-text-secondary
                       hover:bg-slate-100 active:scale-95 transition">
          <Menu size={20} />
        </button>

        <!-- Breadcrumb (md+) / page title only (< md) -->
        <div class="flex items-center gap-2 text-xs text-text-muted min-w-0">
          <span class="hidden md:inline">ISP Manager</span>
          <span class="hidden md:inline">/</span>
          <span class="text-text-primary font-medium truncate">{getTitle()}</span>
        </div>
      </div>

      <!-- Right side: system indicator + user avatar -->
      <div class="flex items-center gap-3 flex-shrink-0">
        <div class="flex items-center gap-1.5" title="Sistema en línea">
          <div class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
          <span class="hidden sm:inline text-xs text-text-secondary">Sistema en línea</span>
        </div>
        <!-- User avatar (mobile-only — sidebar already shows it on md+) -->
        <div class="md:hidden w-8 h-8 rounded-full bg-brand-600 flex items-center
                    justify-center text-xs font-bold text-white"
             title={displayName}>
          {initial}
        </div>
      </div>
    </header>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto p-4 sm:p-6">
      <slot />
    </main>
  </div>
</div>
