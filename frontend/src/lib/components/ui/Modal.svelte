<script>
	import { createEventDispatcher } from 'svelte';

	export let open = false;
	export let title = '';
	export let size = 'md';
	export let closeOnBackdrop = true;

	const dispatch = createEventDispatcher();

	/** @type {Record<string, string>} */
	const sizeClasses = {
		sm: 'modal-box-sm',
		md: 'modal-box-md',
		lg: 'modal-box-lg',
		xl: 'modal-box-xl',
		full: 'modal-box-full'
	};

	function handleBackdropClick() {
		if (closeOnBackdrop) {
			open = false;
			dispatch('close');
		}
	}

	function handleClose() {
		open = false;
		dispatch('close');
	}

	/** @param {KeyboardEvent} event */
	function handleKeydown(event) {
		if (event.key === 'Escape') {
			handleClose();
		}
	}

	$: if (open && typeof window !== 'undefined') {
		window.addEventListener('keydown', handleKeydown);
	} else if (typeof window !== 'undefined') {
		window.removeEventListener('keydown', handleKeydown);
	}
</script>

{#if open}
	<div class="modal modal-open">
		<div class="modal-box {sizeClasses[size]}" on:click|stopPropagation>
			{#if title}
				<h3 class="font-bold text-lg mb-4">{title}</h3>
			{/if}
			
			<div class="py-4">
				<slot />
			</div>
			
			<div class="modal-action">
				<slot name="actions" />
				<button class="btn" on:click={handleClose}>
					Cerrar
				</button>
			</div>
		</div>
		
		<div class="modal-backdrop" on:click={handleBackdropClick}></div>
	</div>
{/if}
