<script>
	import { createEventDispatcher } from 'svelte';
	import { user } from '$lib/stores/auth.store.js';
	import { authStore } from '$lib/stores/auth.store.js';
	import { toastStore } from '$lib/stores/toast.store.js';

	export let onToggleSidebar = () => {};

	const dispatch = createEventDispatcher();

	async function handleLogout() {
		try {
			await authStore.logout();
			toastStore.success('Sesión cerrada correctamente');
		} catch (error) {
			toastStore.error('Error al cerrar sesión');
		}
	}

	function handleProfileClick() {
		dispatch('profileClick');
	}

	function handleSettingsClick() {
		dispatch('settingsClick');
	}
</script>

<header class="bg-base-100 border-b border-base-300">
	<div class="px-4 sm:px-6 lg:px-8">
		<div class="flex items-center justify-between h-16">
			<!-- Mobile menu button -->
			<button
				on:click={onToggleSidebar}
				class="lg:hidden p-2 rounded-lg hover:bg-base-200 transition-colors"
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
				</svg>
			</button>

			<!-- Search Bar (Desktop) -->
			<div class="hidden lg:flex-1 lg:flex lg:items-center lg:justify-center">
				<div class="relative w-full max-w-md">
					<input
						type="text"
						placeholder="Buscar clientes, facturas..."
						class="w-full pl-10 pr-4 py-2 border border-base-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-base-100"
					/>
					<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
						<svg class="w-5 h-5 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
						</svg>
					</div>
				</div>
			</div>

			<!-- Right side items -->
			<div class="flex items-center space-x-4">
				<!-- Notifications -->
				<button class="relative p-2 rounded-lg hover:bg-base-200 transition-colors">
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
					</svg>
					<span class="absolute top-1 right-1 w-2 h-2 bg-error rounded-full"></span>
				</button>

				<!-- User Menu -->
				<div class="relative">
					<button
						on:click={handleProfileClick}
						class="flex items-center space-x-3 p-2 rounded-lg hover:bg-base-200 transition-colors"
					>
						<div class="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
							<span class="text-sm font-medium text-primary-content">
								{$user?.name?.charAt(0).toUpperCase() || 'U'}
							</span>
						</div>
						<div class="hidden sm:block text-left">
							<p class="text-sm font-medium text-base-content">{$user?.name || 'Usuario'}</p>
							<p class="text-xs text-base-content/70">{$user?.role || 'Role'}</p>
						</div>
						<svg class="w-4 h-4 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
						</svg>
					</button>
				</div>

				<!-- Logout -->
				<button
					on:click={handleLogout}
					class="p-2 rounded-lg hover:bg-base-200 transition-colors"
					title="Cerrar sesión"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
					</svg>
				</button>
			</div>
		</div>
	</div>
</header>
