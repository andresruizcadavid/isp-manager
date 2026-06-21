<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    User, Search, Eye, Power, AlertCircle, CheckCircle2, Loader2
  } from 'lucide-svelte';

  /** @type {any[]} */
  let accounts = [];
  let loading = true;
  let error = '';
  let q = '';
  let status = '';

  async function load() {
    loading = true; error = '';
    try {
      /** @type {Record<string, any>} */
      const params = {};
      if (q.trim()) params.search = q.trim();
      if (status) params.status = status;
      const res = await api.get('/mikrotik/accounts?' + new URLSearchParams(params));
      accounts = res?.data ?? [];
    } catch (/** @type {any} */ e) {
      error = e.message || 'Error al cargar cuentas';
    } finally { loading = false; }
  }
  onMount(load);

  /** @param {string|Date|null|undefined} s */
  function fmtDate(s) {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
</script>

<svelte:head><title>Cuentas MikroTik — ISP Manager</title></svelte:head>

<div class="page-header">
  <div>
    <h1 class="page-title">Cuentas MikroTik</h1>
    <p class="page-subtitle">{accounts.length} {accounts.length === 1 ? 'cuenta' : 'cuentas'} registradas</p>
  </div>
</div>

<div class="card mb-5">
  <div class="p-4 flex items-center gap-3 flex-wrap">
    <div class="relative flex-1 min-w-[220px] max-w-sm">
      <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input class="input-search" placeholder="Buscar por usuario, cliente..." bind:value={q} on:input={() => { load(); }} />
    </div>
    <select class="select w-auto min-w-[140px]" bind:value={status} on:change={load}>
      <option value="">Todos los estados</option>
      <option value="ACTIVE">Activa</option>
      <option value="SUSPENDED">Suspendida</option>
    </select>
  </div>
</div>

<div class="card overflow-hidden">
  <div class="overflow-x-auto">
    <table class="data-table">
      <thead>
        <tr>
          <th>Usuario</th>
          <th>Cliente</th>
          <th>Router</th>
          <th>Perfil</th>
          <th>IP Remota</th>
          <th>Estado</th>
          <th>Última Actualización</th>
          <th class="text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {#if loading}
          <tr><td colspan="8" class="py-16 text-center">
            <div class="flex items-center justify-center gap-2">
              <div class="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-slate-500 text-sm">Cargando cuentas...</span>
            </div>
          </td></tr>
        {:else if accounts.length === 0}
          <tr><td colspan="8" class="py-20 text-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <User size={28} class="text-slate-400" />
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-700">
                  {q || status ? 'Ninguna cuenta coincide con los filtros' : 'Aún no hay cuentas MikroTik'}
                </p>
              </div>
            </div>
          </td></tr>
        {:else}
          {#each accounts as acc}
            <tr>
              <td class="font-mono text-sm text-slate-700">{acc.username}</td>
              <td>
                {#if acc.client}
                  <a href="/clients/{acc.client.id}" class="font-medium text-slate-900 hover:text-brand-800 transition-colors">
                    {acc.client.name}
                  </a>
                {:else}
                  <span class="text-slate-400">—</span>
                {/if}
              </td>
              <td class="text-slate-600 text-sm">{acc.router?.name || '—'}</td>
              <td class="text-slate-600 text-sm">{acc.profileName || 'default'}</td>
              <td class="font-mono text-xs text-slate-500">{acc.remoteAddress || '—'}</td>
              <td>
                {#if acc.status === 'ACTIVE'}
                  <span class="badge-green">Activa</span>
                {:else if acc.status === 'SUSPENDED'}
                  <span class="badge-red">Suspendida</span>
                {:else}
                  <span class="badge-gray">{acc.status}</span>
                {/if}
              </td>
              <td class="text-slate-500 text-xs">{fmtDate(acc.updatedAt)}</td>
              <td>
                <div class="flex items-center justify-end gap-1">
                  {#if acc.client}
                    <a href="/clients/{acc.client.id}" class="btn-icon" title="Ver Cliente">
                      <Eye size={14} />
                    </a>
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>