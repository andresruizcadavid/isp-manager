<script>
  // ── App shell ────────────────────────────────────────────────────────
  //
  // Drawer-only layout. The sidebar is ALWAYS an overlay (no flow column,
  // no persistent rail). The hamburger in the topbar opens/closes it.
  // `<main>` always spans the full viewport width — the workspace is
  // maximized by default and the operator opens the menu on demand.
  //
  // Layers (z-index):
  //   • Topbar:    z-30 (sticky top)
  //   • Backdrop:  z-40 (when drawer open)
  //   • Drawer:    z-50
  //   • Palette:   z-[60]
  //   • Toasts:    z-[70] (page-level)

  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { browser } from '$app/environment';
  import { authStore, user } from '$lib/stores/auth.store.js';
  import { sidebarOpen } from '$lib/stores/ui.store.js';
  import { layout, density, focusMode } from '$lib/stores/layout.store.js';
  import {
    menuForRole, resolveActive, resolveParent, resolveTitle,
    isItemActive, canAccess
  } from '$lib/navigation.js';
  import {
    LogOut, ChevronDown, ChevronRight, Menu, X, Network,
    Search, Bell, Settings as SettingsIcon,
    Maximize2, Minimize2, Command, ArrowRight
  } from 'lucide-svelte';
  import InstallPrompt from '$lib/components/layout/InstallPrompt.svelte';

  // ── User-derived bits ───────────────────────────────────────────────
  $: initial     = ($user?.name || $user?.email || '?').trim().charAt(0).toUpperCase();
  $: displayName = $user?.name || $user?.email || 'Usuario';
  $: roleLabel   = ({
      ADMIN: 'Administrador', OPERATOR: 'Administrador',
      TECHNICIAN: 'Técnico',  VIEWER: 'Visualizador'
    })[$user?.role] || '—';

  // ── Reactive navigation state ───────────────────────────────────────
  // Everything below derives from `pathname`. Reading `$page.url.pathname`
  // inside a `$:` declaration is reactive — Svelte traces the store
  // dependency at the top level. Calling helpers as pure functions (with
  // pathname as argument) means the template's `{pageTitle}` /
  // `isItemActive(item, pathname)` calls also recompute on each route
  // change. The OLD code used `{getTitle()}` and `isActive(href)` inline
  // — those functions read the store from their body, which Svelte did
  // NOT trace, so the title and highlight were frozen at first render.
  $: pathname     = $page.url.pathname;
  $: activeItem   = resolveActive(pathname);
  $: activeParent = resolveParent(activeItem);
  $: pageTitle    = resolveTitle(pathname);

  // ── Drawer auto-close on route change ───────────────────────────────
  $: if (pathname) $sidebarOpen = false;

  // ── Sidebar menu tree (filtered by role) ────────────────────────────
  // menuForRole returns [{ type:'item', item }, { type:'group', group, items }, ...]
  $: menu = menuForRole($user?.role);

  // ── Group expand state ──────────────────────────────────────────────
  // Operator can toggle freely; we also auto-expand the group that
  // contains the active item so the user always sees where they are.
  let expanded = {};
  // Auto-expand the active group, but ONLY when the active group actually
  // changes (tracked via _lastActiveParent). Without this guard the reactive
  // re-ran on every `expanded` write — reading `expanded` made it a dependency —
  // so collapsing the active group instantly re-opened it (the reported bug).
  let _lastActiveParent = null;
  $: if (activeParent?.id && activeParent.id !== _lastActiveParent) {
    _lastActiveParent = activeParent.id;
    expanded = { ...expanded, [activeParent.id]: true };
  }
  function toggleSection(id) { expanded = { ...expanded, [id]: !expanded[id] }; }

  // ── Toggle drawer ───────────────────────────────────────────────────
  function toggleDrawer() { $sidebarOpen = !$sidebarOpen; }
  function closeDrawer()  { $sidebarOpen = false; }

  // ── User dropdown ───────────────────────────────────────────────────
  let userMenuOpen = false;
  function closeUserMenu() { userMenuOpen = false; }
  function onUserMenuKey(e) { if (e.key === 'Escape') closeUserMenu(); }

  // ── Command palette ─────────────────────────────────────────────────
  let paletteOpen = false;
  let paletteQuery = '';
  let paletteIndex = 0;
  let paletteInput;

  $: paletteCommands = (() => {
    const all = [
      { id: 'go-dashboard', label: 'Ir a Dashboard',       hint: 'g d', group: 'Navegación', href: '/dashboard' },
      { id: 'go-clients',   label: 'Ir a Clientes',        hint: 'g c', group: 'Navegación', href: '/clients' },
      { id: 'go-new-client',label: 'Nuevo cliente',        hint: '',    group: 'Acciones',   href: '/clients/new' },
      { id: 'go-zones',     label: 'Ir a Zonas',           hint: '',    group: 'Navegación', href: '/zones' },
      { id: 'go-invoices',  label: 'Ir a Facturas',        hint: 'g f', group: 'Navegación', href: '/invoices' },
      { id: 'go-plans',     label: 'Ir a Planes',          hint: '',    group: 'Navegación', href: '/plans' },
      { id: 'go-routers',   label: 'Ir a Routers / NOC',   hint: '',    group: 'Navegación', href: '/mikrotik/routers' },
      { id: 'go-network',   label: 'Ir a Monitor de Red',  hint: 'g m', group: 'Navegación', href: '/network' },
      { id: 'go-reports',   label: 'Ir a Reportes',        hint: '',    group: 'Navegación', href: '/reports' },
      { id: 'go-notifs',    label: 'Ir a Notificaciones',  hint: '',    group: 'Navegación', href: '/notifications' },
      { id: 'go-users',     label: 'Ir a Usuarios',        hint: '',    group: 'Navegación', href: '/users' },
      { id: 'toggle-density', label: $density === 'comfortable' ? 'Modo compacto' : 'Modo confortable',
        hint: '', group: 'Layout', run: () => layout.toggleDensity() },
      { id: 'toggle-focus',  label: $focusMode ? 'Salir de enfoque' : 'Modo enfoque',
        hint: 'f', group: 'Layout', run: () => layout.toggleFocus() },
      { id: 'open-drawer', label: $sidebarOpen ? 'Cerrar menú' : 'Abrir menú',
        hint: '', group: 'Layout', run: () => toggleDrawer() },
      { id: 'logout', label: 'Cerrar sesión', hint: '', group: 'Cuenta',
        run: async () => { await authStore.logout(); goto('/login'); } }
    ];
    const role = $user?.role;
    const allowed = all.filter(c => !c.href || canAccess(c.href, role));
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter(c => c.label.toLowerCase().includes(q) || (c.hint || '').toLowerCase().includes(q));
  })();

  function openPalette() {
    paletteQuery = '';
    paletteIndex = 0;
    paletteOpen = true;
    setTimeout(() => paletteInput?.focus(), 30);
  }
  function closePalette() { paletteOpen = false; }
  async function runCommand(cmd) {
    closePalette();
    if (cmd.href) { goto(cmd.href); return; }
    if (cmd.run)  { await cmd.run(); }
  }
  function onPaletteKey(e) {
    if (e.key === 'Escape')      { closePalette(); return; }
    if (e.key === 'ArrowDown')   { e.preventDefault(); paletteIndex = Math.min(paletteCommands.length - 1, paletteIndex + 1); return; }
    if (e.key === 'ArrowUp')     { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); return; }
    if (e.key === 'Enter')       { e.preventDefault(); const cmd = paletteCommands[paletteIndex]; if (cmd) runCommand(cmd); }
  }
  $: paletteQuery, (paletteIndex = 0);

  // ── Global keyboard shortcuts ───────────────────────────────────────
  let chordPrimed = false;
  let chordTimer  = null;
  function isTextTarget(e) {
    const t = e.target;
    if (!t) return false;
    return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }
  function handleGlobalKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); openPalette(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault(); toggleDrawer(); return;
    }
    if (e.key === 'Escape') {
      if (paletteOpen)   { closePalette();        return; }
      if ($sidebarOpen)  { closeDrawer();         return; }
      if ($focusMode)    { layout.setFocus(false); return; }
      if (userMenuOpen)  { closeUserMenu();       return; }
    }
    if (isTextTarget(e)) return;
    if (chordPrimed) {
      const map = {
        d: '/dashboard', c: '/clients', f: '/invoices',
        m: '/network'
      };
      const dest = map[e.key.toLowerCase()];
      if (dest && canAccess(dest, $user?.role)) {
        e.preventDefault();
        goto(dest);
      }
      chordPrimed = false; clearTimeout(chordTimer);
      return;
    }
    if (e.key.toLowerCase() === 'g') {
      chordPrimed = true;
      clearTimeout(chordTimer);
      chordTimer = setTimeout(() => { chordPrimed = false; }, 900);
      return;
    }
    if (e.key.toLowerCase() === 'f') {
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        layout.toggleFocus();
      }
    }
  }

  function onWindowClick(e) {
    if (!userMenuOpen) return;
    const el = e.target;
    if (el?.closest?.('[data-user-menu]')) return;
    closeUserMenu();
  }

  onMount(() => {
    if (!browser) return;
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('click', onWindowClick);
  });
  onDestroy(() => {
    if (!browser) return;
    window.removeEventListener('keydown', handleGlobalKey);
    window.removeEventListener('click', onWindowClick);
  });
</script>

<!-- Document title — tab text mirrors the current module. Individual
     pages can still <svelte:head><title>…</title></svelte:head> their own
     more-specific titles and they take precedence (svelte:head from the
     leaf overrides the layout's). -->
<svelte:head>
  <title>{pageTitle} — ISP Manager</title>
</svelte:head>

<!-- ─── SHELL ───────────────────────────────────────────────────────── -->
<!-- `min-h-screen` instead of `h-screen` so long pages can scroll naturally
     without trapping inside a fixed-height container. Topbar uses sticky
     positioning so it stays at the top of the viewport.                 -->
<div class="min-h-screen bg-surface-page">

  <!-- ─── Topbar (always visible unless focus mode) ─── -->
  {#if !$focusMode}
  <header class="sticky top-0 z-30 h-14 bg-surface-card border-b border-slate-200
                 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6">

    <!-- LEFT: hamburger + breadcrumb -->
    <div class="flex items-center gap-2 min-w-0">
      <button type="button" on:click={toggleDrawer}
              aria-label={$sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={$sidebarOpen}
              title="Abrir / cerrar menú (⌘\\)"
              class="p-2 -ml-1 rounded-lg text-text-secondary hover:bg-slate-100 hover:text-text-primary
                     active:scale-95 transition min-h-[40px] min-w-[40px] flex items-center justify-center">
        {#if $sidebarOpen}<X size={20} />{:else}<Menu size={20} />{/if}
      </button>

      <div class="hidden sm:flex items-center gap-1.5 text-sm min-w-0 leading-tight">
        <span class="hidden md:inline text-text-muted">ISP Manager</span>
        <span class="hidden md:inline text-text-muted opacity-50">/</span>
        <span class="text-text-primary font-semibold truncate">{pageTitle}</span>
      </div>
    </div>

    <div class="flex-1"></div>

    <!-- RIGHT: search + focus + bell + status + user -->
    <div class="flex items-center gap-1 sm:gap-2 flex-shrink-0">
      <button type="button" on:click={openPalette}
              aria-label="Buscar (⌘K)"
              class="hidden md:flex items-center gap-2 h-9 px-2.5 rounded-lg
                     border border-slate-200 text-text-muted hover:text-text-primary hover:border-slate-300
                     transition min-w-[220px] lg:min-w-[280px] bg-surface-page">
        <Search size={14} />
        <span class="text-xs flex-1 text-left">Buscar o ejecutar…</span>
        <span class="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 text-text-muted">⌘K</span>
      </button>
      <button type="button" on:click={openPalette}
              aria-label="Buscar (⌘K)"
              class="md:hidden p-2 rounded-lg text-text-secondary hover:bg-slate-100 transition
                     min-h-[40px] min-w-[40px] flex items-center justify-center">
        <Search size={18} />
      </button>

      <button type="button" on:click={() => layout.toggleFocus()}
              aria-label={$focusMode ? 'Salir de enfoque' : 'Modo enfoque'}
              title={$focusMode ? 'Salir de enfoque (Esc)' : 'Modo enfoque (f)'}
              class="hidden lg:flex p-2 rounded-lg text-text-secondary hover:bg-slate-100 hover:text-text-primary
                     transition min-h-[40px] min-w-[40px] items-center justify-center">
        {#if $focusMode}<Minimize2 size={16} />{:else}<Maximize2 size={16} />{/if}
      </button>

      <a href="/notifications"
         aria-label="Notificaciones"
         class="relative p-2 rounded-lg text-text-secondary hover:bg-slate-100 hover:text-text-primary
                transition min-h-[40px] min-w-[40px] flex items-center justify-center">
        <Bell size={16} />
      </a>

      <div class="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 border border-emerald-100"
           title="Sistema en línea">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span class="text-[11px] text-emerald-700 font-medium">Sistema en línea</span>
      </div>

      <div class="relative" data-user-menu>
        <button type="button" on:click|stopPropagation={() => userMenuOpen = !userMenuOpen}
                on:keydown={onUserMenuKey}
                aria-label="Menú de usuario"
                class="flex items-center gap-1.5 p-1 pl-1.5 rounded-lg hover:bg-slate-100 transition min-h-[40px]">
          <div class="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-sm font-bold text-white">
            {initial}
          </div>
          <ChevronDown size={14} class="text-text-muted hidden sm:inline" />
        </button>

        {#if userMenuOpen}
          <div class="absolute right-0 top-full mt-1 w-60 bg-surface-card rounded-xl shadow-xl border border-slate-200 py-1 z-50">
            <div class="px-3 py-2.5 border-b border-slate-100">
              <div class="text-sm font-semibold text-text-primary truncate">{displayName}</div>
              <div class="text-[11px] text-text-muted mt-0.5">{$user?.email || ''} · {roleLabel}</div>
            </div>
            <div class="px-1.5 py-1">
              <button type="button"
                      on:click={() => { layout.toggleDensity(); closeUserMenu(); }}
                      class="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg
                             text-sm text-text-primary hover:bg-slate-50 transition">
                <span class="flex items-center gap-2">
                  <SettingsIcon size={14} class="text-text-muted" />
                  Densidad
                </span>
                <span class="text-xs text-text-muted">
                  {$density === 'comfortable' ? 'Confortable' : 'Compacta'}
                </span>
              </button>
              <button type="button"
                      on:click={() => { openPalette(); closeUserMenu(); }}
                      class="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg
                             text-sm text-text-primary hover:bg-slate-50 transition">
                <span class="flex items-center gap-2">
                  <Command size={14} class="text-text-muted" />
                  Buscador / comandos
                </span>
                <span class="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 text-text-muted">⌘K</span>
              </button>
            </div>
            <div class="border-t border-slate-100 mt-1 pt-1 px-1.5 pb-1">
              <button type="button"
                      on:click={async () => { closeUserMenu(); await authStore.logout(); goto('/login'); }}
                      class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg
                             text-sm text-red-600 hover:bg-red-50 transition">
                <LogOut size={14} />
                Cerrar sesión
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </header>
  {/if}

  <!-- ─── Drawer backdrop (visible on ALL viewports when open) ─── -->
  {#if $sidebarOpen}
    <button type="button" aria-label="Cerrar menú"
            on:click={closeDrawer}
            class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity"></button>
  {/if}

  <!-- ─── Drawer (always overlay, never in flow) ─── -->
  <aside aria-label="Menú principal"
         class="fixed inset-y-0 left-0 z-50 w-72 sm:w-80 bg-brand-800 text-brand-100
                flex flex-col shadow-2xl
                transition-transform duration-200 ease-out
                {$sidebarOpen ? 'translate-x-0' : '-translate-x-full'}">

    <!-- Drawer header -->
    <div class="h-14 flex items-center gap-2.5 px-4 border-b border-brand-700 flex-shrink-0">
      <div class="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md shadow-brand-900/30">
        <Network size={16} class="text-white" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-white leading-tight truncate">ISP Manager</div>
        <div class="text-[11px] text-brand-100 leading-tight truncate">Panel Administrativo</div>
      </div>
      <button type="button" on:click={closeDrawer}
              aria-label="Cerrar menú"
              class="p-2 -mr-1 rounded text-brand-100 hover:text-white hover:bg-brand-700 transition">
        <X size={16} />
      </button>
    </div>

    <!-- Nav: data shape from menuForRole() —
         [{ type:'item',  item },
          { type:'group', group, items:[...] }, ...] -->
    <nav class="flex-1 py-2 px-2 overflow-y-auto">
      {#each menu as section}
        {#if section.type === 'item'}
          {@const item = section.item}
          {@const Icon = item.icon || Network}
          {@const active = isItemActive(item, pathname)}
          <a href={item.href}
             class="relative flex items-center gap-2.5 px-3 min-h-[44px] rounded-lg mb-0.5
                    text-sm font-medium transition-colors duration-150
                    {active
                      ? 'bg-brand-600 text-white font-semibold'
                      : 'text-brand-100 hover:bg-brand-700 hover:text-white'}">
            {#if active}<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-white/90"></span>{/if}
            <Icon size={16} />
            <span>{item.label}</span>
          </a>
        {:else}
          {@const group = section.group}
          {@const GroupIcon = group.icon || Network}
          {@const groupHasActive = activeParent?.id === group.id}
          <!-- isOpen sigue SOLO el estado `expanded` (toggle del operador). La
               auto-apertura del grupo activo la hace el reactivo de arriba; NO
               forzar con `|| groupHasActive` o el grupo activo nunca se podría
               recoger (bug reportado). -->
          {@const isOpen = expanded[group.id]}
          <button type="button" on:click={() => toggleSection(group.id)}
                  class="w-full flex items-center justify-between px-3 min-h-[44px] rounded-lg
                         text-sm font-medium transition-colors duration-150 mb-0.5
                         {groupHasActive ? 'text-white' : 'text-brand-100 hover:bg-brand-700 hover:text-white'}">
            <div class="flex items-center gap-2.5">
              <GroupIcon size={16} />
              <span>{group.label}</span>
            </div>
            <svelte:component
              this={isOpen ? ChevronDown : ChevronRight}
              size={12} class="text-brand-200" />
          </button>

          {#if isOpen}
            <div class="mb-1">
              {#each section.items as item}
                {@const active = isItemActive(item, pathname)}
                <a href={item.href}
                   class="relative flex items-center gap-2 pl-9 pr-3 min-h-[40px] rounded-lg
                          text-sm transition-colors duration-150
                          {active
                            ? 'text-white bg-brand-600 font-medium'
                            : 'text-brand-200 hover:text-white hover:bg-brand-700'}">
                  {#if active}<span class="absolute left-3.5 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-white"></span>{/if}
                  <span>{item.label}</span>
                </a>
              {/each}
            </div>
          {/if}
        {/if}
      {/each}
    </nav>

    <!-- Drawer footer: user card + logout -->
    <div class="border-t border-brand-700 flex-shrink-0">
      <div class="px-3 pt-3 pb-2">
        <div class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-brand-700/60">
          <div class="w-9 h-9 rounded-full bg-brand-500 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {initial}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-white truncate leading-tight" title={displayName}>{displayName}</div>
            <div class="text-[11px] text-brand-200 leading-tight mt-0.5 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              {roleLabel}
            </div>
          </div>
        </div>
      </div>
      <div class="px-3 pb-3">
        <button on:click={async () => { closeDrawer(); await authStore.logout(); goto('/login'); }}
                class="w-full flex items-center gap-2.5 px-3 min-h-[44px] rounded-lg
                       text-sm text-brand-100 hover:bg-brand-700 hover:text-white
                       active:scale-[0.98] transition-colors duration-150">
          <LogOut size={14} />
          Cerrar Sesión
        </button>
      </div>
    </div>
  </aside>

  <!-- ─── Main content (always 100% width — no cap) ─── -->
  <!-- We deliberately do NOT impose a max-width on <main>. The shell's job
       is to maximise the workspace; each individual page decides if it wants
       to centre its own column (forms typically max-w-4xl, lists go full
       bleed). This is the structural change vs the old layout where the
       sidebar permanently claimed ~256px of horizontal real estate.       -->
  <main class="{$focusMode ? '' : 'px-3 sm:px-5 lg:px-8 py-4 sm:py-6'}">
    <slot />
  </main>
</div>

<!-- ── Command Palette ──────────────────────────────────────────────── -->
{#if paletteOpen}
  <div class="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4
              bg-slate-900/40 backdrop-blur-sm"
       on:click|self={closePalette}
       role="dialog" aria-label="Buscador y comandos">
    <div class="w-full max-w-xl bg-surface-card rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div class="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
        <Search size={16} class="text-text-muted flex-shrink-0" />
        <input type="text" placeholder="Buscar módulos, acciones, atajos…"
               bind:value={paletteQuery}
               bind:this={paletteInput}
               on:keydown={onPaletteKey}
               class="flex-1 bg-transparent border-0 focus:outline-none focus:ring-0
                      text-sm text-text-primary placeholder:text-text-muted" />
        <kbd class="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 text-text-muted">Esc</kbd>
      </div>

      <div class="max-h-[50vh] overflow-y-auto py-1.5" role="listbox">
        {#if paletteCommands.length === 0}
          <div class="px-4 py-6 text-center text-sm text-text-muted">
            Sin coincidencias para "{paletteQuery}"
          </div>
        {:else}
          {#each paletteCommands as cmd, i}
            <button type="button" role="option" aria-selected={i === paletteIndex}
                    on:click={() => runCommand(cmd)}
                    on:mouseenter={() => paletteIndex = i}
                    class="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg
                           mx-1.5 transition-colors
                           {i === paletteIndex ? 'bg-brand-50 text-brand-800' : 'text-text-primary hover:bg-slate-50'}">
              <span class="flex-1 text-sm font-medium truncate">{cmd.label}</span>
              <span class="text-[10px] text-text-muted uppercase tracking-wider font-semibold">{cmd.group}</span>
              {#if cmd.hint}<kbd class="text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 text-text-muted">{cmd.hint}</kbd>{/if}
              <ArrowRight size={12} class="text-text-muted opacity-60" />
            </button>
          {/each}
        {/if}
      </div>

      <div class="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50 text-[11px] text-text-muted">
        <div class="flex items-center gap-2">
          <kbd class="px-1.5 py-0.5 rounded border border-slate-200 bg-white">↑↓</kbd> navegar
          <kbd class="px-1.5 py-0.5 rounded border border-slate-200 bg-white">Enter</kbd> ejecutar
        </div>
        <div class="flex items-center gap-1.5">
          <kbd class="px-1.5 py-0.5 rounded border border-slate-200 bg-white">g</kbd> + letra para saltar
        </div>
      </div>
    </div>
  </div>
{/if}

<InstallPrompt />
