<script lang="ts">
	import { createChat, fetchServerSentEvents } from '@tanstack/ai-svelte';
	import AccessPanel from './AccessPanel.svelte';
	import { untrack } from 'svelte';
	import type { AccessReport, EnvironmentView, HarnessInfo, SessionView } from '#lib/types.ts';

	let {
		data
	}: {
		data: { session: SessionView; messages: unknown[]; environment: EnvironmentView; access: AccessReport; harness: HarnessInfo };
	} = $props();
	// Seeded once; the page keys this component by session id.
	const sessionId = untrack(() => data.session.id);
	const initialMessages = untrack(() => data.messages) as never[];

	const chat = createChat({
		connection: fetchServerSentEvents('/api/chat'),
		threadId: sessionId,
		initialMessages,
		onFinish: () => persist(),
		onError: () => persist()
	});

	let input = $state('');
	let scroller: HTMLElement | undefined = $state();

	async function persist() {
		await fetch(`/api/sessions/${sessionId}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ messages: $state.snapshot(chat.messages) })
		});
	}

	function send(e?: Event) {
		e?.preventDefault();
		const text = input.trim();
		if (!text || chat.isLoading) return;
		input = '';
		chat.sendMessage(text);
	}

	$effect(() => {
		void chat.messages.length;
		void chat.messages.at(-1)?.parts.length;
		scroller?.scrollTo({ top: scroller.scrollHeight });
	});

	function pretty(v: unknown) {
		if (typeof v === 'string') {
			try {
				return JSON.stringify(JSON.parse(v), null, 2);
			} catch {
				return v;
			}
		}
		return JSON.stringify(v, null, 2);
	}

	function toolSummary(name: string, args: string) {
		try {
			const a = JSON.parse(args);
			const v = a.command ?? a.file_path ?? a.path ?? a.pattern ?? a.url ?? a.description;
			return typeof v === 'string' ? v : '';
		} catch {
			return '';
		}
	}
</script>

<main class="chat-page">
	<section class="chat box">
		<header class="chat-head spread">
			<div>
				<h2>{data.session.title}</h2>
				<span class="small muted">
					<a href="/environments/{data.environment.id}">{data.environment.name}</a> · {data.harness.label} ·
					<code>{data.session.model}</code> · <code>{data.environment.workspace}</code>
				</span>
			</div>
			{#if chat.isLoading}<span class="tag acc">working…</span>{:else}<span class="tag ok">ready</span>{/if}
		</header>

		<div class="messages" bind:this={scroller}>
			{#if chat.messages.length === 0}
				<div class="empty muted">
					<p>Ask {data.harness.label} to do something in <code>{data.environment.workspace}</code>.</p>
					<p class="small">It runs inside the sandbox described on the right. Anything not listed there is blocked.</p>
				</div>
			{/if}
			{#each chat.messages as m (m.id)}
				<div class="msg {m.role}">
					<div class="who">{m.role === 'user' ? 'You' : data.harness.label}</div>
					{#each m.parts as part, i (i)}
						{#if part.type === 'text'}
							<div class="text">{part.content}</div>
						{:else if part.type === 'thinking'}
							<details class="thinking"><summary>thinking</summary><div class="text">{part.content}</div></details>
						{:else if part.type === 'tool-call'}
							<details class="tool">
								<summary>
									<span class="tag">{part.name}</span>
									<code class="tool-arg">{toolSummary(part.name, part.arguments)}</code>
									<span class="state small muted">{part.state}</span>
								</summary>
								<pre>{pretty(part.arguments)}</pre>
								{#if part.output !== undefined}<pre class="out">{pretty(part.output)}</pre>{/if}
							</details>
						{:else if part.type === 'tool-result'}
							<details class="tool result">
								<summary><span class="tag">result</span> <span class="small muted">{part.state}</span></summary>
								<pre class="out">{typeof part.content === 'string' ? part.content : pretty(part.content)}</pre>
							</details>
						{/if}
					{/each}
				</div>
			{/each}
			{#if chat.error}
				<div class="error">
					<strong>Run failed:</strong>
					{chat.error.message}
					<div class="small">Check the agent is installed, its API key is set, and its API domain is allowed.</div>
				</div>
			{/if}
		</div>

		<form class="composer" onsubmit={send}>
			<textarea
				bind:value={input}
				rows="3"
				placeholder="Describe the task… (Enter to send, Shift+Enter for a new line)"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) send(e);
				}}
			></textarea>
			<div class="row">
				{#if chat.isLoading}
					<button type="button" class="danger" onclick={() => chat.stop()}>■ Stop</button>
				{:else}
					<button type="submit" class="primary" disabled={!input.trim()}>Send ▶</button>
				{/if}
			</div>
		</form>
	</section>

	<aside class="side">
		<AccessPanel report={data.access} compact />
		<a class="btn" href="/environments/{data.environment.id}/edit">Change access</a>
		<p class="small muted">Changes apply from the next message.</p>
	</aside>
</main>

<style>
	.chat-page {
		display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px;
		max-width: 1400px; margin: 0 auto; padding: 20px; height: calc(100vh - 62px);
	}
	@media (max-width: 960px) { .chat-page { grid-template-columns: 1fr; height: auto; } }
	.chat { display: flex; flex-direction: column; min-height: 0; }
	.chat-head { padding: 12px 16px; border-bottom: 2px solid var(--line); }
	.chat-head code { word-break: break-all; }
	.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; min-height: 320px; }
	.empty { margin: auto; text-align: center; max-width: 50ch; }
	.msg { border: 2px solid var(--line); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; max-width: 100%; }
	.msg.user { background: var(--accent); color: #111; align-self: flex-end; max-width: 80%; }
	.msg.assistant { background: var(--panel); }
	.who { font: 800 0.7rem var(--sans); text-transform: uppercase; }
	.text { white-space: pre-wrap; word-break: break-word; }
	.tool { border: 2px solid var(--line); background: var(--bg); }
	.tool summary { cursor: pointer; padding: 4px 8px; display: flex; gap: 8px; align-items: center; overflow: hidden; }
	.tool-arg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
	.tool pre { margin: 0; padding: 8px; border-top: 2px solid var(--line); font: 0.78rem var(--mono); white-space: pre-wrap; word-break: break-all; max-height: 300px; overflow: auto; }
	.tool pre.out { background: var(--panel); }
	.thinking summary { cursor: pointer; font-size: 0.8rem; color: var(--muted); }
	.composer { border-top: 2px solid var(--line); padding: 12px; display: flex; gap: 10px; align-items: flex-end; }
	.composer textarea { resize: vertical; font-family: var(--sans); }
	.side { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; min-height: 0; }
	.side p { margin: 0; }
</style>
