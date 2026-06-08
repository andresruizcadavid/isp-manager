<script>
  import { createEventDispatcher } from 'svelte';
  import { CreditCard, Loader2 } from 'lucide-svelte';
  import { paymentsApi } from '$lib/api/payments.api.js';
  import { error as toastError } from '$lib/stores/toast.store.js';

  export let invoice;
  export let label = 'Pagar con Wompi';

  const dispatch = createEventDispatcher();
  let loading = false;

  // Load the Wompi Widget JS SDK once
  function loadWompiWidget() {
    return new Promise((resolve, reject) => {
      if (window.Wompi) return resolve(window.Wompi);
      const s = document.createElement('script');
      s.src = 'https://checkout.wompi.co/widget.js';
      s.async = true;
      s.onload = () => resolve(window.Wompi);
      s.onerror = () => reject(new Error('No se pudo cargar Wompi Widget'));
      document.head.appendChild(s);
    });
  }

  async function handleClick() {
    if (loading) return;
    loading = true;
    try {
      const config = await paymentsApi.getWompiCheckout(invoice.id);

      await loadWompiWidget();

      window.Wompi.open({
        publicKey: config.publicKey,
        amountInCents: config.amountInCents,
        currency: config.currency,
        reference: config.reference,
        signature: config.signature,
        redirectUrl: config.redirectUrl,
        customerData: config.customerData,
        onClose: () => {
          dispatch('close', { invoiceId: invoice.id });
        },
        onComplete: (result) => {
          if (result?.transaction?.status === 'APPROVED') {
            dispatch('paid', { invoiceId: invoice.id, transactionId: result.transaction.id });
          } else {
            dispatch('failed', { invoiceId: invoice.id, status: result?.transaction?.status });
          }
        },
      });
    } catch (e) {
      toastError(e.message || 'Error al iniciar pago con Wompi');
    } finally {
      loading = false;
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
