<script>
	import { createEventDispatcher } from 'svelte';

	export let value = '';
	export let options = [];
	export let placeholder = 'Seleccione una opción';
	export let disabled = false;
	export let required = false;
	export let size = 'md';
	export let error = '';
	export let label = '';
	export let id = '';
	export let name = '';
	export let className = '';

	const dispatch = createEventDispatcher();

	const baseClasses = 'block w-full rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
	
	const sizeClasses = {
		sm: 'px-3 py-1.5 text-sm',
		md: 'px-4 py-2 text-sm',
		lg: 'px-6 py-3 text-base'
	};

	const stateClasses = error 
		? 'border-error focus:ring-error' 
		: 'border-base-300 focus:ring-primary';

	$: selectClasses = `${baseClasses} ${sizeClasses[size]} ${stateClasses} ${disabled ? 'bg-base-200 cursor-not-allowed' : 'bg-base-100'} ${className}`;

	function handleChange(event) {
		value = event.target.value;
		dispatch('change', { value });
	}

	function handleFocus(event) {
		dispatch('focus', event);
	}

	function handleBlur(event) {
		dispatch('blur', event);
	}
</script>

{#if label}
	<label for={id} class="block text-sm font-medium text-base-content mb-1">
		{label}
		{#if required}
			<span class="text-error">*</span>
		{/if}
	</label>
{/if}

<select
	{id}
	{name}
	{value}
	{disabled}
	{required}
	class={selectClasses}
	on:change={handleChange}
	on:focus={handleFocus}
	on:blur={handleBlur}
>
	{#if placeholder}
		<option value="" disabled={!required}>{placeholder}</option>
	{/if}
	{#each options as option}
		<option value={option.value}>
			{option.label || option.value}
		</option>
	{/each}
</select>

{#if error}
	<p class="mt-1 text-sm text-error">{error}</p>
{/if}
