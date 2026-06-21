<script>
  /**
   * ResponsiveTable
   * ----------------
   * Renders a standard `<table>` on md+ viewports and a vertical list of
   * cards on < md. Pages provide:
   *   - default slot: the <thead>/<tbody> of the desktop table
   *   - "mobile" slot (let:row): how each row should look on mobile
   *
   * Usage:
   *   <ResponsiveTable items={clients} let:row>
   *     <thead slot="thead">...</thead>
   *     <tbody slot="tbody">
   *       {#each clients as c}<tr>...</tr>{/each}
   *     </tbody>
   *     <svelte:fragment slot="mobile" let:row={c}>
   *       <ClientCard client={c} />
   *     </svelte:fragment>
   *   </ResponsiveTable>
   *
   * For convenience this component just provides the responsive scaffolding;
   * the actual table and card markup live in the calling page so each list
   * can stay fully customized.
   */

  /** @type {any[]} Items to iterate for the mobile card view. */
  export let items = [];
  /** Toggle table classes (passed to the desktop <table>). */
  export let tableClass = 'data-table';
  /** Empty-state node only used if items.length === 0. */
  export let empty = '';
</script>

<!-- Desktop / tablet (md+): full table -->
<div class="hidden md:block flex-1 min-h-0 overflow-auto">
  <table class={tableClass}>
    <slot name="thead" />
    <slot name="tbody" />
  </table>
</div>

<!-- Mobile (< md): list of cards -->
<div class="md:hidden flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
  {#if items.length === 0}
    <div class="text-center text-sm text-slate-500 py-12">
      {empty || 'Sin resultados'}
    </div>
  {:else}
    {#each items as row (row.id ?? row)}
      <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm
                  active:bg-slate-50 transition">
        <slot name="mobile" {row} />
      </div>
    {/each}
  {/if}
</div>
