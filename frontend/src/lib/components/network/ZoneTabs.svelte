<script>
  // Excel-like sheet tabs along the bottom of the network map.
  //
  // Special tabs (id encoded as string keys so the parent doesn't have to
  // care about Int vs null):
  //   'all'    → show every device (default landing)
  //   'none'   → show devices without zoneId
  //   <Int>    → show devices with zoneId === N
  //
  // Rename happens via double-click on the label (inline input). Delete is
  // a hover-only ✕ on the right side of each real-zone tab. Create is a
  // trailing "+" button that flips into an inline input.
  import { createEventDispatcher, tick } from 'svelte';
  import { Plus, X, Trash2, Pencil } from 'lucide-svelte';

  export let zones = [];           // [{ id, name, color, _count? }]
  export let activeId = 'all';     // 'all' | 'none' | Int
  export let counts = { all: 0, none: 0, byZone: {} };

  const dispatch = createEventDispatcher();

  let creating = false;
  let newName = '';
  let renamingId = null;
  let renameValue = '';

  function setActive(id) {
    if (renamingId != null) return;
    dispatch('select', id);
  }

  async function startCreate() {
    creating = true; newName = '';
    await tick();
    document.querySelector('.create-input')?.focus();
  }
  async function submitCreate() {
    const name = newName.trim();
    if (!name) { creating = false; return; }
    dispatch('create', { name });
    creating = false; newName = '';
  }
  function cancelCreate() { creating = false; newName = ''; }

  async function startRename(zone, e) {
    e?.stopPropagation();
    renamingId = zone.id;
    renameValue = zone.name;
    await tick();
    document.querySelector(`#rename-${zone.id}`)?.select?.();
  }
  function submitRename(zone) {
    const name = renameValue.trim();
    renamingId = null;
    if (name && name !== zone.name) dispatch('rename', { id: zone.id, name });
  }
  function cancelRename() { renamingId = null; }

  function confirmDelete(zone, e) {
    e.stopPropagation();
    const n = counts.byZone[zone.id] || 0;
    const msg = n > 0
      ? `Eliminar la zona "${zone.name}"? Sus ${n} dispositivo(s) quedarán en "Sin clasificar".`
      : `Eliminar la zona "${zone.name}"?`;
    if (confirm(msg)) dispatch('delete', { id: zone.id });
  }
</script>

<div class="tabs">
  <!-- All -->
  <button class="tab special" class:active={activeId === 'all'} on:click={() => setActive('all')}>
    <span class="label">Todos</span>
    <span class="count">{counts.all}</span>
  </button>

  <!-- Real zones -->
  {#each zones as z (z.id)}
    <button class="tab" class:active={activeId === z.id} on:click={() => setActive(z.id)}>
      <span class="color-dot" style="background: {z.color || '#94a3b8'};"></span>

      {#if renamingId === z.id}
        <input
          id={`rename-${z.id}`}
          class="rename-input"
          bind:value={renameValue}
          on:blur={() => submitRename(z)}
          on:keydown={(e) => { if (e.key === 'Enter') submitRename(z); if (e.key === 'Escape') cancelRename(); }}
          on:click|stopPropagation
        />
      {:else}
        <span class="label"
              role="button" tabindex="-1"
              on:dblclick={(e) => startRename(z, e)}
              on:keydown={(e) => { if (e.key === 'F2') startRename(z, e); }}
              title="Doble-clic para renombrar">{z.name}</span>
      {/if}

      <span class="count">{counts.byZone[z.id] || 0}</span>

      <span class="tab-actions">
        <button class="mini" on:click|stopPropagation={(e) => startRename(z, e)} aria-label="Renombrar"><Pencil size={10} /></button>
        <button class="mini danger" on:click={(e) => confirmDelete(z, e)} aria-label="Eliminar"><Trash2 size={10} /></button>
      </span>
    </button>
  {/each}

  <!-- Unclassified -->
  <button class="tab special" class:active={activeId === 'none'} on:click={() => setActive('none')}>
    <span class="label">Sin clasificar</span>
    <span class="count">{counts.none}</span>
  </button>

  <!-- + new zone -->
  {#if creating}
    <span class="tab tab-create">
      <input
        class="create-input"
        bind:value={newName}
        placeholder="Nombre de la zona"
        on:keydown={(e) => { if (e.key === 'Enter') submitCreate(); if (e.key === 'Escape') cancelCreate(); }}
        on:blur={submitCreate}
      />
    </span>
  {:else}
    <button class="tab tab-add" on:click={startCreate} title="Nueva zona">
      <Plus size={14} />
    </button>
  {/if}
</div>

<style>
  .tabs {
    display: flex; align-items: stretch;
    gap: 2px;
    padding: 6px 10px 0;
    background: linear-gradient(to top, #e2e8f0, #f1f5f9);
    border-top: 1px solid #e2e8f0;
    overflow-x: auto;
    overflow-y: hidden;
    min-height: 38px;
    scrollbar-width: thin;
  }
  .tabs::-webkit-scrollbar { height: 6px; }
  .tabs::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }

  .tab {
    position: relative;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px 6px 10px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-bottom: none;
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
    font-size: 0.78rem;
    font-weight: 500;
    color: #475569;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
    min-height: 32px;
  }
  .tab:hover:not(.active) { background: #ffffff; color: #0f172a; }
  .tab.active {
    background: white;
    color: #0f172a;
    font-weight: 600;
    border-color: #cbd5e1;
    box-shadow: 0 -2px 0 #2C4EC7 inset;
    z-index: 2;
  }
  .tab.special { font-style: italic; }
  .tab.special .label { color: #64748b; }
  .tab.active.special .label { color: #0f172a; }

  .color-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .label { font-size: 0.78rem; }
  .count {
    display: inline-block; padding: 1px 6px;
    background: #e2e8f0; color: #475569;
    border-radius: 999px;
    font-size: 0.65rem; font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .tab.active .count { background: #2C4EC7; color: white; }

  .tab-actions {
    display: none;
    gap: 2px;
    margin-left: 2px;
  }
  .tab:hover .tab-actions { display: inline-flex; }
  .mini {
    background: transparent; border: none; padding: 2px;
    color: #94a3b8; cursor: pointer; border-radius: 3px;
    display: grid; place-items: center;
  }
  .mini:hover { background: #f1f5f9; color: #0f172a; }
  .mini.danger:hover { background: #fee2e2; color: #b91c1c; }

  .tab-add {
    padding: 6px 10px;
    color: #2C4EC7;
    background: transparent;
    border: 1px dashed #cbd5e1;
    border-bottom: none;
  }
  .tab-add:hover { background: rgba(44, 78, 199, 0.06); border-color: #2C4EC7; }

  .tab-create { padding: 4px; background: white; border-bottom: none; }
  .create-input, .rename-input {
    border: none; outline: none;
    background: transparent;
    font-size: 0.78rem; font-weight: 500;
    color: #0f172a;
    min-width: 100px; max-width: 180px;
    padding: 2px 4px;
    border-bottom: 1px solid #2C4EC7;
  }
  .rename-input { font-weight: 600; }
</style>
