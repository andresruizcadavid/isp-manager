<script>
	export let variant = 'primary';
	export let size = 'md';
	export let className = '';

	const variantClasses = {
		primary: 'badge-primary',
		secondary: 'badge-secondary',
		accent: 'badge-accent',
		neutral: 'badge-neutral',
		info: 'badge-info',
		success: 'badge-success',
		warning: 'badge-warning',
		error: 'badge-error',
		ghost: 'badge-ghost',
		outline: 'badge-outline'
	};

	const sizeClasses = {
		xs: 'badge-xs',
		sm: 'badge-sm',
		md: 'badge-md',
		lg: 'badge-lg'
	};

	$: badgeClasses = `badge ${variantClasses[variant]} ${sizeClasses[size]} ${className}`;
</script>

<span class={badgeClasses}>
	<slot />
</span>
