<script lang="ts">
	import '../app.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>Serebro</title>
	<link
		rel="icon"
		href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%23ffd23f' stroke='%23111' stroke-width='3'/></svg>"
	/>
</svelte:head>

<header class="top">
	<a href="/" class="brand">Serebro</a>
	<span class="muted small">Coding agents in a sandbox you control</span>
	<nav class="row">
		<a class="btn" href="/environments/new">+ New environment</a>
	</nav>
</header>

{@render children()}

<style>
	.top {
		display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
		padding: 12px 20px; border-bottom: 2px solid var(--line); background: var(--panel);
	}
	.brand {
		font-weight: 900; font-size: 1.2rem; text-transform: uppercase; text-decoration: none;
		background: var(--accent); color: #111; border: 2px solid var(--line); padding: 2px 10px;
	}
	nav { margin-left: auto; }
</style>
