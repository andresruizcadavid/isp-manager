<script>
	import { createEventDispatcher } from 'svelte';

	export let value = '';
	export let placeholder = '';
	export let disabled = false;
	export let required = false;
	export let readonly = false;
	export let rows = 4;
	export let error = '';
	export let label = '';
	export let id = '';
	export let name = '';
	export let className = '';

	const dispatch = createEventDispatcher();

	const baseClasses = 'block w-full rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 resize-vertical';
	
	const stateClasses = error 
		? 'border-error focus:ring-error' 
		: 'border-base-300 focus:ring-primary';

	$: textareaClasses = `${baseClasses} ${stateClasses} ${disabled ? 'bg-base-200 cursor-not-allowed' : 'bg-base-100'} ${className}`;

	/** @param {Event} event */
	function handleInput(event) {
		value = /** @type {HTMLTextAreaElement} */ (event.target).value;
		dispatch('input', { value });
	}

	/** @param {Event} event */
	function handleChange(event) {
		value = /** @type {HTMLTextAreaElement} */ (event.target).value;
		dispatch('change', { value });
	}

	/** @param {Event} event */
	function handleFocus(event) {
		dispatch('focus', event);
	}

	/** @param {Event} event */
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

<textarea
	{id}
	{name}
	{value}
	{placeholder}
	{disabled}
	{required}
	{readonly}
	{rows}
	class={textareaClasses}
	on:input={handleInput}
	on:change={handleChange}
	on:focus={handleFocus}
	on:blur={handleBlur}
	on:keydown
	on:keyup
	on:keypress
></textarea>

{#if error}
	<p class="mt-1 text-sm text-error">{error}</p>
{/if}
