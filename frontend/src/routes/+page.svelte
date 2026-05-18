<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { token } from '$lib/stores/auth.store.js';

	onMount(() => {
		const t = get(token);
		goto(t ? '/dashboard' : '/login', { replaceState: true });
	});
</script>

<svelte:head>
	<title>ISP Manager - Sistema de Gestión</title>
	<meta name="description" content="Sistema completo de gestión para Proveedores de Servicios de Internet" />
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-base-200">
	<div class="text-center">
		<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
		<p class="text-base-content/70">Redirigiendo...</p>
	</div>
</div>
