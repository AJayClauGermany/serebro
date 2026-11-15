<script lang="ts">
	import EnvironmentForm from '#lib/components/EnvironmentForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<main class="page">
	{#key data.environment.id}
		<EnvironmentForm harnesses={data.harnesses} defaults={data.defaults} existing={data.environment} />
	{/key}
</main>
