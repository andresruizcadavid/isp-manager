<script>
  import { onMount } from 'svelte';
  import { usersApi } from '$lib/api/users.api.js';
  import { user as currentUser } from '$lib/stores/auth.store.js';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import {
    Users, Plus, Pencil, Trash2, Save, X,
    ShieldCheck, Wrench, Loader2, AlertCircle, CheckCircle2
  } from 'lucide-svelte';

  /** @type {import('$lib/types').User[]} */
  let users = [];
  let loading = true;
  let error = '';

  let modalOpen = false;
  /** @type {any} */
  let editing = null;          // null = create; user object = edit
  let saving = false;
  let formError = '';
  let form = emptyForm();

  function emptyForm() {
    return { email: '', name: '', password: '', role: 'TECHNICIAN', isActive: true };
  }

  async function load() {
    loading = true; error = '';
    try {
      users = await usersApi.list();
    } catch (/** @type {any} */ e) {
      error = e.message || 'No se pudieron cargar los usuarios';
    } finally { loading = false; }
  }
  onMount(load);

  function openCreate() {
    editing = null;
    form = emptyForm();
    formError = '';
    modalOpen = true;
  }
  /** @param {any} u */
  function openEdit(u) {
    editing = u;
    form = {
      email: u.email,
      name: u.name,
      password: '',           // empty = don't change
      role: u.role,
      isActive: u.isActive
    };
    formError = '';
    modalOpen = true;
  }
  function closeModal() {
    if (saving) return;
    modalOpen = false;
    editing = null;
    formError = '';
  }

  async function submit() {
    formError = '';
    if (!form.email.trim() || !form.name.trim()) {
      formError = 'Nombre y email son obligatorios.';
      return;
    }
    if (!editing && form.password.length < 6) {
      formError = 'La contraseña debe tener al menos 6 caracteres.';
      return;
    }
    saving = true;
    try {
      if (editing) {
        /** @type {any} */
        const payload = {
          email: form.email,
          name: form.name,
          role: form.role,
          isActive: form.isActive,
        };
        if (form.password) payload.password = form.password;
        const updated = await usersApi.update(editing.id, payload);
        users = users.map(u => u.id === editing.id ? updated : u);
      } else {
        const created = await usersApi.create({
          email: form.email,
          name: form.name,
          password: form.password,
          role: form.role,
          isActive: form.isActive,
        });
        users = [created, ...users];
      }
      closeModal();
    } catch (/** @type {any} */ e) {
      formError = e.message || 'No se pudo guardar el usuario.';
    } finally { saving = false; }
  }

  /** @param {any} u */
  async function toggleActive(u) {
    if (u.id === $currentUser?.id && u.isActive) {
      alert('No puedes desactivar tu propia cuenta.');
      return;
    }
    try {
      const updated = await usersApi.update(u.id, { isActive: !u.isActive });
      users = users.map(x => x.id === u.id ? updated : x);
    } catch (/** @type {any} */ e) {
      alert(e.message || 'Error al cambiar estado');
    }
  }

  /** @param {any} u */
  async function removeUser(u) {
    if (u.id === $currentUser?.id) {
      alert('No puedes eliminar tu propia cuenta.');
      return;
    }
    if (!confirm(`¿Desactivar al usuario "${u.name}"? Se cerrarán sus sesiones activas.`)) return;
    try {
      await usersApi.remove(u.id);
      // Soft-delete on backend → user becomes isActive=false.
      users = users.map(x => x.id === u.id ? { ...x, isActive: false } : x);
    } catch (/** @type {any} */ e) {
      alert(e.message || 'No se pudo eliminar');
    }
  }

  /** @type {Record<string, string>} */
  const ROLE_LABEL = {
    ADMIN:      'Administrador',
    OPERATOR:   'Administrador',
    TECHNICIAN: 'Técnico',
    VIEWER:     'Visualizador'
  };
  /** @type {Record<string, any>} */
  const ROLE_ICON = { ADMIN: ShieldCheck, OPERATOR: ShieldCheck, TECHNICIAN: Wrench, VIEWER: Users };
  /** @type {Record<string, string>} */
  const ROLE_BADGE = {
    ADMIN:      'bg-brand-50 text-brand-700 ring-brand-100',
    OPERATOR:   'bg-brand-50 text-brand-700 ring-brand-100',
    TECHNICIAN: 'bg-amber-50 text-amber-700 ring-amber-100',
    VIEWER:     'bg-slate-50 text-slate-600 ring-slate-200',
  };

  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleString('es-CO', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
</script>

<svelte:head><title>Usuarios — ISP Manager</title></svelte:head>

<!-- Header -->
<div class="flex flex-wrap items-start justify-between gap-3 mb-4 sm:mb-6">
  <div>
    <h1 class="text-xl sm:text-2xl font-bold text-text-primary tracking-tight">
      Usuarios del Sistema
    </h1>
    <p class="hidden sm:block text-sm text-text-secondary mt-1">
      Administra las cuentas de Administradores y Técnicos.
    </p>
  </div>
  <button type="button" on:click={openCreate} class="btn-primary">
    <Plus size={15} /> Nuevo Usuario
  </button>
</div>

{#if error}
  <div class="card p-3 flex items-start gap-2 border-red-200 bg-red-50 mb-4">
    <AlertCircle size={14} class="text-red-500 mt-0.5" />
    <div class="text-xs text-red-700 flex-1">{error}</div>
    <button class="text-xs text-brand-600 hover:underline" on:click={load}>Reintentar</button>
  </div>
{/if}

<!-- List -->
<div class="card">
  {#if loading}
    <div class="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
      <Loader2 size={14} class="animate-spin" /> Cargando usuarios...
    </div>
  {:else if users.length === 0}
    <div class="text-center py-16 text-sm text-slate-500">
      <Users size={32} class="mx-auto mb-3 opacity-40" />
      No hay usuarios registrados.
    </div>
  {:else}
    <!-- Desktop table -->
    <div class="hidden sm:block overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Email</th>
            <th>Rol</th>
            <th>Estado</th>
            <th>Creado</th>
            <th class="text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.id)}
            <tr class:opacity-60={!u.isActive}>
              <td>
                <div class="flex items-center gap-2.5">
                  <div class="avatar">{(u.name || u.email || '?').trim().charAt(0).toUpperCase()}</div>
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-slate-900 truncate">{u.name}</div>
                    {#if u.id === $currentUser?.id}
                      <div class="text-[10px] text-brand-700 font-medium">Tú</div>
                    {/if}
                  </div>
                </div>
              </td>
              <td class="text-sm text-slate-700 truncate max-w-[200px]" title={u.email}>{u.email}</td>
              <td>
                <span class="badge {ROLE_BADGE[u.role]} inline-flex items-center gap-1">
                  <svelte:component this={ROLE_ICON[u.role]} size={11} />
                  {ROLE_LABEL[u.role] || u.role}
                </span>
              </td>
              <td>
                {#if u.isActive}
                  <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100 inline-flex items-center gap-1">
                    <CheckCircle2 size={11} /> Activo
                  </span>
                {:else}
                  <span class="badge bg-slate-100 text-slate-600 ring-slate-200">Inactivo</span>
                {/if}
              </td>
              <td class="text-xs text-slate-500 whitespace-nowrap">{fmtDate(u.createdAt)}</td>
              <td class="text-right">
                <div class="flex items-center justify-end gap-1">
                  <button class="btn-icon" title="Editar" on:click={() => openEdit(u)}>
                    <Pencil size={14} />
                  </button>
                  <button class="btn-icon" title={u.isActive ? 'Desactivar' : 'Activar'}
                          disabled={u.id === $currentUser?.id && u.isActive}
                          on:click={() => toggleActive(u)}>
                    {#if u.isActive}<X size={14} />{:else}<CheckCircle2 size={14} />{/if}
                  </button>
                  <button class="btn-icon hover:!text-red-600 hover:!bg-red-50"
                          title="Eliminar"
                          disabled={u.id === $currentUser?.id}
                          on:click={() => removeUser(u)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <!-- Mobile cards -->
    <div class="sm:hidden divide-y divide-slate-100">
      {#each users as u (u.id)}
        <div class="px-4 py-3 class:opacity-60={!u.isActive}">
          <div class="flex items-center gap-3 mb-2">
            <div class="avatar">{(u.name || u.email || '?').trim().charAt(0).toUpperCase()}</div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-slate-900 truncate">{u.name}</div>
              <div class="text-xs text-slate-500 truncate">{u.email}</div>
              {#if u.id === $currentUser?.id}
                <div class="text-[10px] text-brand-700 font-medium">Tú</div>
              {/if}
            </div>
            {#if u.isActive}
              <span class="badge bg-emerald-50 text-emerald-700 ring-emerald-100 inline-flex items-center gap-1 flex-shrink-0">
                <CheckCircle2 size={11} /> Activo
              </span>
            {:else}
              <span class="badge bg-slate-100 text-slate-600 ring-slate-200 flex-shrink-0">Inactivo</span>
            {/if}
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="badge {ROLE_BADGE[u.role]} inline-flex items-center gap-1">
              <svelte:component this={ROLE_ICON[u.role]} size={11} />
              {ROLE_LABEL[u.role] || u.role}
            </span>
            <div class="flex items-center gap-1">
              <button class="btn-icon" title="Editar" on:click={() => openEdit(u)}>
                <Pencil size={14} />
              </button>
              <button class="btn-icon" title={u.isActive ? 'Desactivar' : 'Activar'}
                      disabled={u.id === $currentUser?.id && u.isActive}
                      on:click={() => toggleActive(u)}>
                {#if u.isActive}<X size={14} />{:else}<CheckCircle2 size={14} />{/if}
              </button>
              <button class="btn-icon hover:!text-red-600 hover:!bg-red-50"
                      title="Eliminar"
                      disabled={u.id === $currentUser?.id}
                      on:click={() => removeUser(u)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div class="text-[10px] text-slate-400 mt-1">Creado: {fmtDate(u.createdAt)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Create / Edit Modal -->
<Sheet bind:open={modalOpen} title={editing ? 'Editar usuario' : 'Nuevo usuario'} maxWidth="max-w-md">
  <form on:submit|preventDefault={submit} id="user-form" class="space-y-5">

    {#if formError}
      <div class="flex items-start gap-2 bg-red-50 border border-red-200
                  text-red-700 rounded-lg px-3 py-2.5 text-sm">
        <AlertCircle size={14} class="mt-0.5 flex-shrink-0" />
        <span>{formError}</span>
      </div>
    {/if}

    <div>
      <label for="u-name" class="label">Nombre completo *</label>
      <input id="u-name" type="text" bind:value={form.name} required
             placeholder="Ej: María Godoy Urrea" class="input" />
    </div>

    <div>
      <label for="u-email" class="label">Email *</label>
      <input id="u-email" type="email" bind:value={form.email} required
             placeholder="usuario@empresa.com" class="input" />
    </div>

    <div>
      <label for="u-password" class="label">
        Contraseña {#if editing}<span class="text-text-muted font-normal lowercase">(dejar vacía para no cambiar)</span>{:else}*{/if}
      </label>
      <input id="u-password" type="password" bind:value={form.password}
             placeholder="Mínimo 6 caracteres"
             required={!editing}
             autocomplete="new-password"
             class="input" />
    </div>

    <div>
      <label class="label">Rol *</label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex items-start gap-2 p-3 rounded-xl border-2 cursor-pointer transition
                      {form.role === 'ADMIN' ? 'border-brand-600 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300'}">
          <input type="radio" bind:group={form.role} value="ADMIN" class="mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <ShieldCheck size={14} class="text-brand-700" />
              <span class="text-sm font-semibold text-text-primary">Administrador</span>
            </div>
            <div class="text-[11px] text-text-secondary mt-0.5">Acceso total</div>
          </div>
        </label>
        <label class="flex items-start gap-2 p-3 rounded-xl border-2 cursor-pointer transition
                      {form.role === 'TECHNICIAN' ? 'border-brand-600 bg-brand-50/40' : 'border-slate-200 hover:border-slate-300'}">
          <input type="radio" bind:group={form.role} value="TECHNICIAN" class="mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <Wrench size={14} class="text-amber-600" />
              <span class="text-sm font-semibold text-text-primary">Técnico</span>
            </div>
            <div class="text-[11px] text-text-secondary mt-0.5">Solo operativo</div>
          </div>
        </label>
      </div>
    </div>

    <div>
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" bind:checked={form.isActive}
               disabled={editing?.id === $currentUser?.id}
               class="w-4 h-4" />
        <span class="text-sm text-text-primary">Cuenta activa</span>
        {#if editing?.id === $currentUser?.id}
          <span class="text-[11px] text-text-muted">(no puedes desactivar tu propia cuenta)</span>
        {/if}
      </label>
    </div>
  </form>

  <svelte:fragment slot="footer">
    <button type="button" on:click={closeModal} class="btn-secondary" disabled={saving}>
      Cancelar
    </button>
    <button type="submit" form="user-form" class="btn-primary" disabled={saving}>
      {#if saving}
        <Loader2 size={15} class="animate-spin" /> Guardando...
      {:else}
        <Save size={15} /> {editing ? 'Guardar cambios' : 'Crear usuario'}
      {/if}
    </button>
  </svelte:fragment>
</Sheet>
