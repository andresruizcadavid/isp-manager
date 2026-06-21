<script>
	export let variant = 'info';
	export let dismissible = false;
	export let show = true;

	/** @type {Record<string, string>} */
	const variantClasses = {
		info: 'bg-info text-info-content border-info',
		success: 'bg-success text-success-content border-success',
		warning: 'bg-warning text-warning-content border-warning',
		error: 'bg-error text-error-content border-error'
	};

	$: alertClasses = `alert ${variantClasses[variant]} ${dismissible ? 'alert-dismissible' : ''}`;

	function handleDismiss() {
		show = false;
	}
</script>

{#if show}
	<div class={alertClasses}>
		<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
			{#if variant === 'info'}
				<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
			{:else if variant === 'success'}
				<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
			{:else if variant === 'warning'}
				<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
			{:else if variant === 'error'}
				<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
			{/if}
		</svg>
		
		<div class="flex-1">
			<slot />
		</div>

		{#if dismissible}
			<button on:click={handleDismiss} class="btn btn-sm btn-ghost">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
				</svg>
			</button>
		{/if}
	</div>
{/if}
