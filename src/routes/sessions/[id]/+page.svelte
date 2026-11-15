<script lang="ts">
	import ChatView from '#lib/components/ChatView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#key data.session.id}
	<ChatView {data} />
{/key}
