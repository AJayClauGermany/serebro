<script lang="ts">
	// A collapsible settings row, like "Network access  ›  Limited · 3 domains".
	import type { Snippet } from 'svelte';
	let {
		title,
		summary,
		open = $bindable(false),
		children
	}: { title: string; summary: string; open?: boolean; children: Snippet } = $props();
</script>

<div class="section" class:open>
	<button type="button" class="toggle" onclick={() => (open = !open)} aria-expanded={open}>
		<span class="text">
			<span class="title">{title}</span>
			<span class="summary">{summary}</span>
		</span>
		<span class="chev" aria-hidden="true">{open ? '▾' : '›'}</span>
	</button>
	{#if open}<div class="body">{@render children()}</div>{/if}
</div>

<style>
	.section { border: 2px solid var(--line); background: var(--panel); }
	.toggle {
		width: 100%; display: flex; justify-content: space-between; align-items: center;
		border: 0; box-shadow: none; padding: 12px 14px; text-transform: none; background: transparent; text-align: left;
	}
	.toggle:hover, .toggle:active { transform: none; box-shadow: none; background: var(--bg); }
	.text { display: flex; flex-direction: column; gap: 2px; }
	.title { font-weight: 800; font-size: 0.95rem; }
	.summary { font: 400 0.82rem var(--mono); color: var(--muted); }
	.chev { font-size: 1.2rem; }
	.open .toggle { border-bottom: 2px solid var(--line); }
	.body { padding: 14px; display: flex; flex-direction: column; gap: 14px; }
</style>
