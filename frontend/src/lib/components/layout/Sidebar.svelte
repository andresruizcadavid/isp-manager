<script>
	import { page } from '$app/stores';
	import { user } from '$lib/stores/auth.store.js';
	import { createEventDispatcher } from 'svelte';

	export let isOpen = false;
	export let onClose = () => {};
	export let currentPath = '';

	const dispatch = createEventDispatcher();

	const menuItems = [
		{
			title: 'Dashboard',
			href: '/dashboard',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR', 'VIEWER']
		},
		{
			title: 'Clientes',
			href: '/clients',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR', 'VIEWER']
		},
		{
			title: 'Facturas',
			href: '/invoices',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR', 'VIEWER']
		},
		{
			title: 'Pagos',
			href: '/payments',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR', 'VIEWER']
		},
		{
			title: 'Planes',
			href: '/plans',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR']
		},
		{
			title: 'Mikrotik',
			href: '/mikrotik',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR']
		},
		{
			title: 'Reportes',
			href: '/reports',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
			</svg>`,
			roles: ['ADMIN', 'OPERATOR', 'VIEWER']
		},
		{
			title: 'Configuración',
			href: '/settings',
			icon: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
			</svg>`,
			roles: ['ADMIN']
		}
	];

	$: filteredMenuItems = menuItems.filter(item => {
		if (!$user) return false;
		return item.roles.includes($user.role);
	});

	function handleItemClick(href) {
		onClose();
	}

	function isActive(href) {
		return currentPath === href || currentPath.startsWith(href + '/');
	}
</script>

<!-- Mobile Sidebar -->
<div 
	class="fixed inset-y-0 left-0 z-50 w-64 bg-base-100 transform transition-transform duration-300 ease-in-out lg:hidden"
	class:translate-x-0={isOpen}
	class:-translate-x-full={!isOpen}
>
	<div class="flex flex-col h-full">
		<!-- Header -->
		<div class="flex items-center justify-between p-4 border-b border-base-300">
			<div class="flex items-center space-x-3">
				<div class="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
					<svg class="w-4 h-4 text-primary-content" fill="currentColor" viewBox="0 0 20 20">
						<path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.748V17a1 1 0 001 1z"/>
					</svg>
				</div>
				<span class="font-semibold text-base-content">ISP Manager</span>
			</div>
			<button 
				on:click={onClose}
				class="p-2 rounded-lg hover:bg-base-200 transition-colors"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
				</svg>
			</button>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 p-4 space-y-1">
			{#each filteredMenuItems as item}
				<a
					href={item.href}
					on:click={() => handleItemClick(item.href)}
					class="flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors"
					class:bg-primary={isActive(item.href)}
					class:text-primary-content={isActive(item.href)}
					class:hover:bg-base-200={!isActive(item.href)}
					class:text-base-content={!isActive(item.href)}
				>
					{@html item.icon}
					<span class="font-medium">{item.title}</span>
				</a>
			{/each}
		</nav>

		<!-- User Section -->
		{#if $user}
			<div class="p-4 border-t border-base-300">
				<div class="flex items-center space-x-3">
					<div class="w-8 h-8 bg-base-300 rounded-full flex items-center justify-center">
						<span class="text-sm font-medium text-base-content">
							{$user.name.charAt(0).toUpperCase()}
						</span>
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium text-base-content truncate">{$user.name}</p>
						<p class="text-xs text-base-content/70">{$user.role}</p>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- Desktop Sidebar -->
<div class="hidden lg:flex lg:flex-col lg:w-64 lg:bg-base-100 lg:border-r lg:border-base-300">
	<div class="flex flex-col h-full">
		<!-- Header -->
		<div class="flex items-center p-6 border-b border-base-300">
			<div class="flex items-center space-x-3">
				<div class="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
					<svg class="w-4 h-4 text-primary-content" fill="currentColor" viewBox="0 0 20 20">
						<path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.748V17a1 1 0 001 1z"/>
					</svg>
				</div>
				<span class="font-semibold text-base-content">ISP Manager</span>
			</div>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 p-4 space-y-1">
			{#each filteredMenuItems as item}
				<a
					href={item.href}
					class="flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors"
					class:bg-primary={isActive(item.href)}
					class:text-primary-content={isActive(item.href)}
					class:hover:bg-base-200={!isActive(item.href)}
					class:text-base-content={!isActive(item.href)}
				>
					{@html item.icon}
					<span class="font-medium">{item.title}</span>
				</a>
			{/each}
		</nav>

		<!-- User Section -->
		{#if $user}
			<div class="p-4 border-t border-base-300">
				<div class="flex items-center space-x-3">
					<div class="w-8 h-8 bg-base-300 rounded-full flex items-center justify-center">
						<span class="text-sm font-medium text-base-content">
							{$user.name.charAt(0).toUpperCase()}
						</span>
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-medium text-base-content truncate">{$user.name}</p>
						<p class="text-xs text-base-content/70">{$user.role}</p>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
