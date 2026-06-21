<script>
	import { createEventDispatcher } from 'svelte';

	export let type = 'button';
	export let variant = 'primary';
	export let size = 'md';
	export let disabled = false;
	export let loading = false;
	export let href = '';
	export let fullWidth = false;

	const dispatch = createEventDispatcher();

	const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
	
	/** @type {Record<string, string>} */
	const variantClasses = {
		primary: 'bg-primary text-primary-content hover:bg-primary-focus focus:ring-primary',
		secondary: 'bg-secondary text-secondary-content hover:bg-secondary-focus focus:ring-secondary',
		accent: 'bg-accent text-accent-content hover:bg-accent-focus focus:ring-accent',
		neutral: 'bg-neutral text-neutral-content hover:bg-neutral-focus focus:ring-neutral',
		ghost: 'bg-transparent text-base-content hover:bg-base-200 focus:ring-base-200',
		link: 'text-primary hover:text-primary-focus p-0 h-auto focus:ring-primary',
		error: 'bg-error text-error-content hover:bg-error-focus focus:ring-error',
		success: 'bg-success text-success-content hover:bg-success-focus focus:ring-success',
		warning: 'bg-warning text-warning-content hover:bg-warning-focus focus:ring-warning',
		info: 'bg-info text-info-content hover:bg-info-focus focus:ring-info'
	};

	/** @type {Record<string, string>} */
	const sizeClasses = {
		xs: 'px-2 py-1 text-xs',
		sm: 'px-3 py-1.5 text-sm',
		md: 'px-4 py-2 text-sm',
		lg: 'px-6 py-3 text-base',
		xl: 'px-8 py-4 text-lg'
	};

	$: classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

	/** @param {Event} event */
	function handleClick(event) {
		if (!disabled && !loading) {
			dispatch('click', event);
		}
	}
</script>

{#if href}
	<a {href} class={classes} on:click={handleClick}>
		{#if loading}
			<span class="loading loading-spinner loading-sm mr-2"></span>
		{/if}
		<slot />
	</a>
{:else}
	<button {type} {disabled} class={classes} on:click={handleClick}>
		{#if loading}
			<span class="loading loading-spinner loading-sm mr-2"></span>
		{/if}
		<slot />
	</button>
{/if}
