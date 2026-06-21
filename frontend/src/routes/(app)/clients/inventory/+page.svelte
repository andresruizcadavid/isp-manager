<script>
  import { onMount } from 'svelte';
  import { inventoryApi } from '$lib/api/inventory.api.js';
  import { clientsApi } from '$lib/api/clients.api.js';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import {
    Boxes, Package, Plus, Pencil, Trash2, Loader2, AlertCircle, ImageUp,
    Cpu, User, Search, X, Undo2
  } from 'lucide-svelte';

  const BASE = import.meta.env.PUBLIC_API_URL || '';
  /** @param {string|null|undefined} u */
  const imgUrl = (u) => u ? (u.startsWith('http') ? u : `${BASE}${u}`) : '';

  let tab = 'products';          // products | items
  let loading = true;
  let error = '';
  /** @type {import('$lib/types').InventoryProduct[]} */
  let products = [];
  /** @type {import('$lib/types').InventoryItem[]} */
  let items = [];
  /** @type {any[]} */
  let clients = [];

  const CATEGORIES = ['ONU', 'TV Box', 'Router', 'Antena', 'Cable/Drop', 'Otro'];
  /** @type {Record<string, string>} */
  const STATUS_LABEL = { IN_STOCK: 'En bodega', ASSIGNED: 'Asignado', RETURNED: 'Devuelto', FAULTY: 'Dañado' };
  /** @type {Record<string, string>} */
  const STATUS_CLASS = {
    IN_STOCK: 'bg-slate-100 text-slate-600',
    ASSIGNED: 'bg-emerald-50 text-emerald-700',
    RETURNED: 'bg-amber-50 text-amber-700',
    FAULTY:   'bg-red-50 text-red-700'
  };

  async function loadAll() {
    loading = true; error = '';
    try {
      const [p, it, cl] = await Promise.all([
        inventoryApi.listProducts(),
        inventoryApi.listItems(),
        clientsApi.getAll({ limit: 500 }).catch(() => [])
      ]);
      products = p || [];
      items = it || [];
      clients = ((/** @type {any} */ (cl))?.data || cl || []).map((/** @type {any} */ c) => ({ id: c.id, name: c.name }));
    } catch (/** @type {any} */ e) { error = e.message || 'No se pudo cargar el inventario'; }
    finally { loading = false; }
  }
  onMount(loadAll);

  // ── Product modal ──────────────────────────────────────────────
  let pOpen = false, pSaving = false, pError = '', pUploading = false;
  /** @type {any} */
  let pEditing = null;
  let pForm = emptyProduct();
  function emptyProduct() { return { name: '', category: '', description: '', imageUrl: '', isActive: true }; }
  function openNewProduct() { pForm = emptyProduct(); pEditing = null; pError = ''; pOpen = true; }
  /** @param {any} p */
  function openEditProduct(p) {
    pForm = { name: p.name, category: p.category || '', description: p.description || '', imageUrl: p.imageUrl || '', isActive: p.isActive };
    pEditing = p; pError = ''; pOpen = true;
  }
  /** @param {Event} e */
  async function onPickImage(e) {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (!file) return;
    pUploading = true; pError = '';
    try { pForm.imageUrl = await inventoryApi.uploadImage(file); }
    catch (/** @type {any} */ err) { pError = err.message || 'No se pudo subir la imagen'; }
    finally { pUploading = false; }
  }
  async function saveProduct() {
    if (!pForm.name.trim() || pForm.name.trim().length < 2) { pError = 'El nombre debe tener al menos 2 caracteres.'; return; }
    pSaving = true; pError = '';
    try {
      const payload = { ...pForm, category: pForm.category || null, description: pForm.description || null, imageUrl: pForm.imageUrl || null };
      if (pEditing) await inventoryApi.updateProduct(pEditing.id, payload);
      else          await inventoryApi.createProduct(payload);
      pOpen = false; await loadAll();
    } catch (/** @type {any} */ e) { pError = e.message || 'No se pudo guardar'; }
    finally { pSaving = false; }
  }
  /** @param {any} p */
  async function deleteProduct(p) {
    if (!confirm(`¿Eliminar el producto "${p.name}"?`)) return;
    try { await inventoryApi.removeProduct(p.id); await loadAll(); }
    catch (/** @type {any} */ e) { alert(e.message || 'No se pudo eliminar'); }
  }

  // ── Item modal ─────────────────────────────────────────────────
  let iOpen = false, iSaving = false, iError = '';
  /** @type {any} */
  let iEditing = null;
  let iForm = emptyItem();
  function emptyItem() { return { productId: '', serial: '', clientId: '', status: 'ASSIGNED', notes: '' }; }
  function openNewItem() { iForm = emptyItem(); iEditing = null; iError = ''; iOpen = true; }
  /** @param {any} it */
  function openEditItem(it) {
    iForm = { productId: it.productId, serial: it.serial || '', clientId: it.clientId || '', status: it.status, notes: it.notes || '' };
    iEditing = it; iError = ''; iOpen = true;
  }
  async function saveItem() {
    if (!iForm.productId) { iError = 'Selecciona un producto.'; return; }
    iSaving = true; iError = '';
    try {
      const payload = {
        productId: iForm.productId,
        serial:    iForm.serial.trim() || null,
        clientId:  iForm.clientId || null,
        status:    iForm.status,
        notes:     iForm.notes || null
      };
      if (iEditing) await inventoryApi.updateItem(iEditing.id, payload);
      else          await inventoryApi.createItem(payload);
      iOpen = false; await loadAll();
    } catch (/** @type {any} */ e) { iError = e.message || 'No se pudo guardar'; }
    finally { iSaving = false; }
  }
  /** @param {any} it */
  async function unassignItem(it) {
    if (!confirm(`¿Devolver "${it.product?.name}" (${it.serial || 'sin serial'}) a bodega?`)) return;
    try { await inventoryApi.unassign(it.id); await loadAll(); }
    catch (/** @type {any} */ e) { alert(e.message); }
  }
  /** @param {any} it */
  async function deleteItem(it) {
    if (!confirm(`¿Eliminar este equipo del inventario?`)) return;
    try { await inventoryApi.removeItem(it.id); await loadAll(); }
    catch (/** @type {any} */ e) { alert(e.message); }
  }

  // ── Filters for items ──
  let q = '';
  $: filteredItems = items.filter(it => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (it.product?.name || '').toLowerCase().includes(s)
        || (it.serial || '').toLowerCase().includes(s)
        || (it.client?.name || '').toLowerCase().includes(s);
  });
</script>

<svelte:head><title>Inventario — Internet Online</title></svelte:head>

<div class="flex items-center justify-between gap-3 mb-5">
  <div class="flex items-center gap-3">
    <div class="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-700"><Boxes size={20} /></div>
    <div>
      <h1 class="text-xl font-bold text-slate-900">Inventario de equipos</h1>
      <p class="text-sm text-slate-500">Productos del catálogo y equipos asignados a clientes</p>
    </div>
  </div>
  {#if tab === 'products'}
    <button class="btn-primary" on:click={openNewProduct}><Plus size={16} /> Nuevo producto</button>
  {:else}
    <button class="btn-primary" on:click={openNewItem}><Plus size={16} /> Asignar equipo</button>
  {/if}
</div>

<!-- Tabs -->
<div class="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
  <button class="px-4 py-2 rounded-lg text-sm font-medium transition {tab === 'products' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-500'}"
          on:click={() => tab = 'products'}>
    <Package size={14} class="inline -mt-0.5 mr-1" /> Productos ({products.length})
  </button>
  <button class="px-4 py-2 rounded-lg text-sm font-medium transition {tab === 'items' ? 'bg-white shadow-sm text-brand-700' : 'text-slate-500'}"
          on:click={() => tab = 'items'}>
    <Cpu size={14} class="inline -mt-0.5 mr-1" /> Equipos ({items.length})
  </button>
</div>

{#if error}
  <div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm mb-4">
    <AlertCircle size={14} class="mt-0.5" /> {error}
  </div>
{/if}

{#if loading}
  <div class="flex items-center justify-center gap-2 py-20 text-slate-500"><Loader2 size={18} class="animate-spin" /> Cargando inventario…</div>

{:else if tab === 'products'}
  <!-- ░ Catálogo de productos ░ -->
  {#if products.length === 0}
    <div class="card text-center py-16 text-slate-500">
      <Package size={40} class="mx-auto mb-3 text-slate-300" />
      <p class="font-medium text-slate-700">Aún no hay productos</p>
      <p class="text-sm">Crea el primer producto del catálogo (ONU, TV Box, router…)</p>
    </div>
  {:else}
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {#each products as p (p.id)}
        <div class="card overflow-hidden flex flex-col {!p.isActive ? 'opacity-60' : ''}">
          <div class="aspect-video bg-slate-100 flex items-center justify-center overflow-hidden">
            {#if p.imageUrl}
              <img src={imgUrl(p.imageUrl)} alt={p.name} class="w-full h-full object-cover" />
            {:else}
              <Package size={32} class="text-slate-300" />
            {/if}
          </div>
          <div class="p-3 flex-1 flex flex-col">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h3 class="font-semibold text-slate-900 text-sm truncate" title={p.name}>{p.name}</h3>
                {#if p.category}<span class="text-[11px] text-slate-500">{p.category}</span>{/if}
              </div>
            </div>
            <div class="mt-2 flex items-center justify-between">
              <span class="text-[11px] text-slate-500">{p._count?.items ?? 0} unidad(es)</span>
              <div class="flex gap-1">
                <button class="btn-icon" title="Editar" on:click={() => openEditProduct(p)}><Pencil size={13} /></button>
                <button class="btn-icon hover:!text-red-600" title="Eliminar" on:click={() => deleteProduct(p)}><Trash2 size={13} /></button>
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

{:else}
  <!-- ░ Equipos físicos ░ -->
  <div class="card overflow-hidden">
    <div class="p-3 border-b border-slate-100">
      <div class="relative max-w-sm">
        <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input class="input pl-9" placeholder="Buscar por equipo, serial o cliente…" bind:value={q} />
      </div>
    </div>
    {#if filteredItems.length === 0}
      <div class="text-center py-14 text-slate-500"><Cpu size={36} class="mx-auto mb-2 text-slate-300" /> Sin equipos.</div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th class="text-left px-4 py-2.5 font-medium">Equipo</th>
              <th class="text-left px-4 py-2.5 font-medium">Serial</th>
              <th class="text-left px-4 py-2.5 font-medium">Cliente</th>
              <th class="text-left px-4 py-2.5 font-medium">Estado</th>
              <th class="text-right px-4 py-2.5 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredItems as it (it.id)}
              <tr class="border-t border-slate-100 hover:bg-slate-50">
                <td class="px-4 py-2.5">
                  <div class="flex items-center gap-2.5">
                    <div class="w-9 h-9 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
                      {#if it.product?.imageUrl}<img src={imgUrl(it.product.imageUrl)} alt="" class="w-full h-full object-cover" />{:else}<Package size={16} class="text-slate-400" />{/if}
                    </div>
                    <div class="min-w-0">
                      <div class="font-medium text-slate-900 truncate">{it.product?.name || '—'}</div>
                      {#if it.product?.category}<div class="text-[11px] text-slate-400">{it.product.category}</div>{/if}
                    </div>
                  </div>
                </td>
                <td class="px-4 py-2.5 font-mono text-xs text-slate-600">{it.serial || '—'}</td>
                <td class="px-4 py-2.5">
                  {#if it.client}
                    <a href={`/clients/${it.client.id}`} class="text-brand-700 hover:underline inline-flex items-center gap-1"><User size={12} /> {it.client.name}</a>
                  {:else}
                    <span class="text-slate-400">En bodega</span>
                  {/if}
                </td>
                <td class="px-4 py-2.5"><span class="text-[11px] px-2 py-0.5 rounded-full font-medium {STATUS_CLASS[it.status]}">{STATUS_LABEL[it.status] || it.status}</span></td>
                <td class="px-4 py-2.5">
                  <div class="flex justify-end gap-1">
                    <button class="btn-icon" title="Editar" on:click={() => openEditItem(it)}><Pencil size={13} /></button>
                    {#if it.clientId}<button class="btn-icon" title="Devolver a bodega" on:click={() => unassignItem(it)}><Undo2 size={13} /></button>{/if}
                    <button class="btn-icon hover:!text-red-600" title="Eliminar" on:click={() => deleteItem(it)}><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}

<!-- ░░ Product modal ░░ -->
<Sheet bind:open={pOpen} title={pEditing ? 'Editar producto' : 'Nuevo producto'} maxWidth="max-w-lg">
  <form id="prod-form" class="space-y-4" on:submit|preventDefault={saveProduct}>
    {#if pError}<div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm"><AlertCircle size={14} class="mt-0.5" /> {pError}</div>{/if}

    <!-- Imagen -->
    <div>
      <span class="label">Imagen del producto</span>
      <div class="flex items-center gap-3">
        <div class="w-24 h-24 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center shrink-0">
          {#if pUploading}<Loader2 size={20} class="animate-spin text-slate-400" />
          {:else if pForm.imageUrl}<img src={imgUrl(pForm.imageUrl)} alt="" class="w-full h-full object-cover" />
          {:else}<Package size={26} class="text-slate-300" />{/if}
        </div>
        <div class="space-y-1.5">
          <label class="btn-secondary cursor-pointer inline-flex">
            <ImageUp size={14} /> {pForm.imageUrl ? 'Cambiar imagen' : 'Subir imagen'}
            <input type="file" accept="image/*" class="hidden" on:change={onPickImage} />
          </label>
          {#if pForm.imageUrl}<button type="button" class="text-xs text-slate-500 hover:text-red-600 block" on:click={() => pForm.imageUrl = ''}>Quitar imagen</button>{/if}
        </div>
      </div>
    </div>

    <div>
      <label for="p-name" class="label">Nombre *</label>
      <input id="p-name" class="input" bind:value={pForm.name} placeholder="Ej: ONU Huawei HG8310M" />
    </div>
    <div>
      <label for="p-cat" class="label">Categoría</label>
      <select id="p-cat" class="select" bind:value={pForm.category}>
        <option value="">— Sin categoría —</option>
        {#each CATEGORIES as c}<option value={c}>{c}</option>{/each}
      </select>
    </div>
    <div>
      <label for="p-desc" class="label">Descripción</label>
      <textarea id="p-desc" rows="2" class="input" bind:value={pForm.description} placeholder="Notas opcionales del producto"></textarea>
    </div>
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={pForm.isActive} class="w-4 h-4" /> Producto activo</label>
  </form>
  <svelte:fragment slot="footer">
    <button type="button" class="btn-secondary" on:click={() => pOpen = false} disabled={pSaving}>Cancelar</button>
    <button type="submit" form="prod-form" class="btn-primary" disabled={pSaving || pUploading}>
      {#if pSaving}<Loader2 size={15} class="animate-spin" />{/if} Guardar
    </button>
  </svelte:fragment>
</Sheet>

<!-- ░░ Item modal ░░ -->
<Sheet bind:open={iOpen} title={iEditing ? 'Editar equipo' : 'Asignar equipo'} maxWidth="max-w-lg">
  <form id="item-form" class="space-y-4" on:submit|preventDefault={saveItem}>
    {#if iError}<div class="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2.5 text-sm"><AlertCircle size={14} class="mt-0.5" /> {iError}</div>{/if}
    <div>
      <label for="i-prod" class="label">Producto *</label>
      <select id="i-prod" class="select" bind:value={iForm.productId}>
        <option value="">— Selecciona un producto —</option>
        {#each products.filter(p => p.isActive) as p}<option value={p.id}>{p.name}{p.category ? ` (${p.category})` : ''}</option>{/each}
      </select>
    </div>
    <div>
      <label for="i-serial" class="label">Serial</label>
      <input id="i-serial" class="input font-mono" bind:value={iForm.serial} placeholder="Ej: 48575443XXXXXXXX" />
      <p class="text-[11px] text-slate-400 mt-1">Opcional, pero si lo pones debe ser único.</p>
    </div>
    <div>
      <label for="i-client" class="label">Cliente</label>
      <select id="i-client" class="select" bind:value={iForm.clientId}>
        <option value="">— En bodega (sin asignar) —</option>
        {#each clients as c}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </div>
    <div>
      <label for="i-status" class="label">Estado</label>
      <select id="i-status" class="select" bind:value={iForm.status}>
        <option value="ASSIGNED">Asignado</option>
        <option value="IN_STOCK">En bodega</option>
        <option value="RETURNED">Devuelto</option>
        <option value="FAULTY">Dañado</option>
      </select>
    </div>
    <div>
      <label for="i-notes" class="label">Notas</label>
      <textarea id="i-notes" rows="2" class="input" bind:value={iForm.notes} placeholder="Opcional"></textarea>
    </div>
  </form>
  <svelte:fragment slot="footer">
    <button type="button" class="btn-secondary" on:click={() => iOpen = false} disabled={iSaving}>Cancelar</button>
    <button type="submit" form="item-form" class="btn-primary" disabled={iSaving}>
      {#if iSaving}<Loader2 size={15} class="animate-spin" />{/if} Guardar
    </button>
  </svelte:fragment>
</Sheet>
