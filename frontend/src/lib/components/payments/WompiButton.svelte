<script>
  import { CreditCard, Loader2 } from 'lucide-svelte';
  import { paymentsApi } from '$lib/api/payments.api.js';
  import { error as toastError } from '$lib/stores/toast.store.js';

  export let invoice;
  export let label = 'Pagar con Wompi';

  let loading = false;

  async function handleClick() {
    if (loading) return;
    loading = true;
    try {
      const { redirectUrl } = await paymentsApi.getWompiCheckout(invoice.id);
      window.location.href = redirectUrl;
    } catch (/** @type {any} */ e) {
      loading = false;
      toastError(e.message || 'Error al iniciar pago con Wompi');
    }
  }
</script>

<button class="wompi-btn" on:click={handleClick} disabled={loading}>
  {#if loading}
    <Loader2 size={14} class="spin" />
    Iniciando…
  {:else}
    <CreditCard size={14} />
    {label}
  {/if}
</button>

<style>
  .wompi-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #fff;
    background: #7c3aed;
    border: none;
    border-radius: 0.4rem;
    cursor: pointer;
    transition: background 0.15s;
    line-height: 1.4;
  }
  .wompi-btn:hover:not(:disabled) {
    background: #6d28d9;
  }
  .wompi-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
