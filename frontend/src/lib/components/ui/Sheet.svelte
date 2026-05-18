<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { X } from 'lucide-svelte';

  /** Whether the sheet is visible. Bind it from the parent. */
  export let open = false;
  /** Sheet title shown in the header. */
  export let title = '';
  /** Optional max width applied on sm+ when rendered as a centered dialog. */
  export let maxWidth = 'max-w-md';

  const dispatch = createEventDispatcher();

  function close() {
    open = false;
    dispatch('close');
  }

  function onKey(e) {
    if (e.key === 'Escape' && open) close();
  }

  onMount(() => document.addEventListener('keydown', onKey));
  onDestroy(() => document.removeEventListener('keydown', onKey));
</script>

{#if open}
  <!-- Backdrop -->
  <button type="button" aria-label="Cerrar"
          on:click={close}
          transition:fade={{ duration: 150 }}
          class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm
                 flex items-end sm:items-center sm:justify-center
                 p-0 sm:p-4 cursor-default">
  </button>

  <!-- Panel: bottom sheet on < sm, centered modal on sm+ -->
  <div
    role="dialog" aria-modal="true" aria-label={title}
    transition:fly={{ y: 32, duration: 200 }}
    on:click|stopPropagation
    class="fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:top-1/2 sm:left-1/2
           sm:-translate-x-1/2 sm:-translate-y-1/2
           w-full {maxWidth} sm:rounded-2xl rounded-t-2xl
           bg-white shadow-2xl
           max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden">

    <!-- Drag indicator (mobile only) -->
    <div class="sm:hidden flex justify-center pt-2 pb-1">
      <div class="w-10 h-1 rounded-full bg-slate-200"></div>
    </div>

    <!-- Header -->
    {#if title || $$slots.header}
      <div class="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4
                  border-b border-slate-100 flex-shrink-0">
        {#if $$slots.header}
          <slot name="header" />
        {:else}
          <h2 class="text-base sm:text-lg font-semibold text-slate-900 truncate">{title}</h2>
        {/if}
        <button type="button" on:click={close}
                aria-label="Cerrar"
                class="text-slate-400 hover:text-slate-600 p-2 -mr-2 rounded
                       min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0
                       active:scale-95 transition flex items-center justify-center">
          <X size={20} />
        </button>
      </div>
    {/if}

    <!-- Body -->
    <div class="flex-1 overflow-y-auto p-4 sm:p-6">
      <slot />
    </div>

    <!-- Footer (optional) -->
    {#if $$slots.footer}
      <div class="flex items-center justify-end gap-2 px-4 sm:px-6 py-3 sm:py-4
                  border-t border-slate-100 bg-slate-50/60 flex-shrink-0">
        <slot name="footer" />
      </div>
    {/if}
  </div>
{/if}
