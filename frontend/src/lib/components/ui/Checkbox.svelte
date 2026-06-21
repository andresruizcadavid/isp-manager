<script>
	import { createEventDispatcher } from 'svelte';

	export let checked = false;
	export let disabled = false;
	export let required = false;
	export let error = '';
	export let label = '';
	export let id = '';
	export let name = '';
	export let className = '';

	const dispatch = createEventDispatcher();

	/** @param {Event} event */
	function handleChange(event) {
		checked = /** @type {HTMLInputElement} */ (event.target).checked;
		dispatch('change', { checked });
	}

	/** @param {Event} event */
	function handleClick(event) {
		dispatch('click', event);
	}
</script>

<div class="form-control">
	<label class="label cursor-pointer flex items-center gap-3">
		<input
			type="checkbox"
			{id}
			{name}
			{checked}
			{disabled}
			{required}
			class="checkbox checkbox-primary"
			on:change={handleChange}
			on:click={handleClick}
		/>
		<span class="label-text {className}">
			{label}
			{#if required}
				<span class="text-error">*</span>
			{/if}
		</span>
	</label>
	
	{#if error}
		<label class="label">
			<span class="label-text-alt text-error">{error}</span>
		</label>
	{/if}
</div>
