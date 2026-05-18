<script>
	export let className = '';
	export let padding = 'normal';
	export let shadow = 'normal';
	export let border = true;

	const paddingClasses = {
		none: '',
		sm: 'p-4',
		normal: 'p-6',
		lg: 'p-8',
		xl: 'p-10'
	};

	const shadowClasses = {
		none: '',
		sm: 'shadow-sm',
		normal: 'shadow-lg',
		lg: 'shadow-xl',
		xl: 'shadow-2xl'
	};

	$: cardClasses = `bg-base-100 rounded-lg ${paddingClasses[padding]} ${shadowClasses[shadow]} ${border ? 'border border-base-300' : ''} ${className}`;
</script>

<div class={cardClasses}>
	<slot />
</div>
