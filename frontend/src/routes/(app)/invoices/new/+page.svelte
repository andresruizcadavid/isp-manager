<script>
  import { goto } from '$app/navigation';
  import { invoicesApi } from '$lib/api/invoices.api.js';
  import { api } from '$lib/api/client.js';
  import { onMount } from 'svelte';
  import { Loader2, ArrowLeft, Plus, Search } from 'lucide-svelte';

  let clients = [];
  let clientsLoading = true;
  let clientSearch = '';
  let clientOpen = false;

  let form = { clientId: '', amount: '', dueDate: '', description: '' };
  let submitting = false;
  let error = '';

  onMount(async () => {
    try {
      const data = await api.get('/clients?limit=500&status=ACTIVE');
      clients = Array.isArray(data) ? data : data.clients || data.data || [];
    } catch (e) { error = 'Error al cargar clientes'; }
    finally { clientsLoading = false; }
  });

  $: filteredClients = clients.filter(c =>
    !clientSearch || c.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.documentNumber?.includes(clientSearch) || c.email?.toLowerCase().includes(clientSearch.toLowerCase())
  );

  function selectClient(c) {
    form.clientId = c.id;
    clientOpen = false;
    clientSearch = c.name;
  }

  function clearClient() {
    form.clientId = '';
    clientSearch = '';
  }

  function selectedClient() {
    return clients.find(c => c.id === form.clientId);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.clientId) { error = 'Selecciona un cliente'; return; }
    if (!form.amount || Number(form.amount) <= 0) { error = 'Ingresa un monto válido'; return; }
    if (!form.dueDate) { error = 'Selecciona una fecha de vencimiento'; return; }

    submitting = true;
    error = '';
    try {
      const invoice = await invoicesApi.create({
        clientId: form.clientId,
        amount: Number(form.amount),
        dueDate: new Date(form.dueDate).toISOString(),
        description: form.description || `Cobro por $${Number(form.amount).toLocaleString('es-CO')}`
      });
      goto(`/invoices/${invoice.id}`);
    } catch (e) { error = e.message; }
    finally { submitting = false; }
  }
</script>

<svelte:head><title>Nueva Factura — ISP Manager</title></svelte:head>

<div class="max-w-2xl mx-auto">
  <button type="button" on:click={() => goto('/invoices')} class="btn-ghost btn-sm mb-4 flex items-center gap-1.5">
    <ArrowLeft size={14} /> Volver a Facturas
  </button>

  <div class="card p-6">
    <h1 class="text-xl font-semibold text-text-primary mb-6">Nueva Factura / Cuenta de Cobro</h1>

    {#if error}
      <div class="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>
    {/if}

    <form on:submit={handleSubmit} class="space-y-4">
      <!-- Client selector -->
      <div class="relative">
        <label class="text-sm font-medium text-text-primary block mb-1">Cliente *</label>
        {#if form.clientId && selectedClient()}
          <div class="flex items-center justify-between input">
            <span>{selectedClient().name} <span class="text-text-muted text-xs">({selectedClient().documentNumber})</span></span>
            <button type="button" on:click={clearClient} class="text-red-400 hover:text-red-600 text-xs">Cambiar</button>
          </div>
        {:else}
          <div class="relative">
            <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" bind:value={clientSearch} placeholder="Buscar cliente…" class="input pl-9"
              on:focus={() => clientOpen = true} on:input={() => clientOpen = true} />
          </div>
          {#if clientOpen}
            <div class="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {#if clientsLoading}
                <div class="p-3 text-center"><Loader2 size={16} class="animate-spin text-brand-600 mx-auto" /></div>
              {:else if filteredClients.length === 0}
                <div class="p-3 text-sm text-text-muted text-center">Sin resultados</div>
              {:else}
                {#each filteredClients as c}
                  <button type="button" on:click={() => selectClient(c)} class="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between">
                    <span>{c.name}</span>
                    <span class="text-xs text-text-muted">{c.documentType || ''} {c.documentNumber || ''}</span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Amount -->
      <div>
        <label class="text-sm font-medium text-text-primary block mb-1">Monto * (COP)</label>
        <input type="number" bind:value={form.amount} placeholder="Ej: 150000" min="1" step="1" class="input w-full" />
        <p class="text-xs text-text-muted mt-1">
          {#if form.amount}
            $ {Number(form.amount).toLocaleString('es-CO')} COP
          {/if}
        </p>
      </div>

      <!-- Due date -->
      <div>
        <label class="text-sm font-medium text-text-primary block mb-1">Fecha de vencimiento *</label>
        <input type="date" bind:value={form.dueDate} class="input w-full" />
      </div>

      <!-- Description -->
      <div>
        <label class="text-sm font-medium text-text-primary block mb-1">Concepto / Descripción</label>
        <textarea bind:value={form.description} placeholder="Ej: Pago de servicio de internet mes de junio" rows="3" class="input w-full"></textarea>
      </div>

      <!-- Submit -->
      <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" on:click={() => goto('/invoices')} class="btn-secondary">Cancelar</button>
        <button type="submit" disabled={submitting} class="btn-primary flex items-center gap-1.5">
          {#if submitting}
            <Loader2 size={14} class="animate-spin" />
          {:else}
            <Plus size={14} />
          {/if}
          Crear Factura
        </button>
      </div>
    </form>
  </div>
</div>
