<script>
	/** @type {any[]} */
	export let data = [];
	/** @type {any[]} */
	export let columns = [];
	export let loading = false;
	export let pagination = false;
	export let pageSize = 10;
	export let currentPage = 1;
	export let className = '';

	$: totalPages = pagination ? Math.ceil(data.length / pageSize) : 1;
	$: paginatedData = pagination ? data.slice((currentPage - 1) * pageSize, currentPage * pageSize) : data;

	/** @param {number} page */
	function changePage(page) {
		if (page >= 1 && page <= totalPages) {
			currentPage = page;
		}
	}

	function goToPreviousPage() {
		changePage(currentPage - 1);
	}

	function goToNextPage() {
		changePage(currentPage + 1);
	}
</script>

<div class="overflow-x-auto {className}">
	<table class="table table-zebra w-full">
		<thead>
			<tr>
				{#each columns as column}
					<th class={column.class}>
						{column.header}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#if loading}
				{#each Array(pageSize) as _}
					<tr>
						{#each columns as column}
							<td>
								<div class="skeleton h-4 w-full"></div>
							</td>
						{/each}
					</tr>
				{/each}
			{:else if paginatedData.length > 0}
				{#each paginatedData as row, index}
					<tr>
						{#each columns as column}
							<td class={column.cellClass}>
								{#if column.render}
									{@html column.render(row, index)}
								{:else}
									{row[column.key] || ''}
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			{:else}
				<tr>
					<td colspan={columns.length} class="text-center py-8">
						<div class="text-base-content/70">
							<svg class="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
							</svg>
							<p>No hay datos disponibles</p>
						</div>
					</td>
				</tr>
			{/if}
		</tbody>
	</table>

	{#if pagination && totalPages > 1}
		<div class="flex justify-between items-center mt-4">
			<div class="text-sm text-base-content/70">
				Mostrando {(currentPage - 1) * pageSize + 1} a {Math.min(currentPage * pageSize, data.length)} de {data.length} resultados
			</div>
			<div class="btn-group">
				<button 
					class="btn btn-sm" 
					class:btn-disabled={currentPage === 1}
					on:click={goToPreviousPage}
				>
					Anterior
				</button>
				
				{#each Array(totalPages) as _, i}
					<button 
						class="btn btn-sm" 
						class:btn-active={currentPage === i + 1}
						on:click={() => changePage(i + 1)}
					>
						{i + 1}
					</button>
				{/each}
				
				<button 
					class="btn btn-sm" 
					class:btn-disabled={currentPage === totalPages}
					on:click={goToNextPage}
				>
					Siguiente
				</button>
			</div>
		</div>
	{/if}
</div>
