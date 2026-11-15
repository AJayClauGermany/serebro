<script lang="ts">
	// Edit a list of strings (paths or domains). One per row, add/remove.
	let {
		items = $bindable([]),
		placeholder = '',
		addLabel = 'Add'
	}: { items: string[]; placeholder?: string; addLabel?: string } = $props();
	let draft = $state('');

	function add() {
		const parts = draft.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
		const next = [...items];
		for (const p of parts) if (!next.includes(p)) next.push(p);
		items = next;
		draft = '';
	}
</script>

<div class="list">
	{#each items as item, i (item)}
		<div class="item">
			<code>{item}</code>
			<button type="button" class="ghost" aria-label="Remove {item}" onclick={() => (items = items.filter((_, j) => j !== i))}>✕</button>
		</div>
	{/each}
	<div class="add">
		<input
			bind:value={draft}
			{placeholder}
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					add();
				}
			}}
		/>
		<button type="button" onclick={add} disabled={!draft.trim()}>+ {addLabel}</button>
	</div>
</div>

<style>
	.list { display: flex; flex-direction: column; gap: 6px; }
	.item { display: flex; justify-content: space-between; align-items: center; border: 2px solid var(--line); padding: 2px 2px 2px 10px; background: var(--bg); word-break: break-all; }
	.add { display: flex; gap: 6px; }
	.add button { white-space: nowrap; }
</style>
