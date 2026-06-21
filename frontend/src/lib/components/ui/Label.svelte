<script>
	export let htmlFor = '';
	export let className = '';
	export let required = false;

	$: labelClasses = `block text-sm font-medium text-base-content ${required ? 'text-error' : ''} ${className}`;
</script>

<label for={htmlFor} class={labelClasses}>
	<slot />
	{#if required}
		<span class="text-error">*</span>
	{/if}
</label>
