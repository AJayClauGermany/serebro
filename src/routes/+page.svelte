<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let starting = $state('');

	const envName = (id: string) => data.environments.find((e) => e.env.id === id)?.env.name ?? 'deleted';

	async function newChat(environmentId: string) {
		starting = environmentId;
		const res = await fetch('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ environmentId })
		});
		const s = await res.json();
		starting = '';
		if (res.ok) goto(`/sessions/${s.id}`);
	}
</script>

<main class="page stack">
	{#if !data.system.ready}
		<section class="box pad stack error-box">
			<h2>This machine is not ready to run the sandbox</h2>
			{#each data.system.checks.filter((c) => !c.ok) as c}
				<div><strong>{c.name}</strong>: {c.detail}. Fix: <code>{c.fix}</code></div>
			{/each}
			{#each data.system.sandboxes.filter((b) => !b.preferred && !b.available) as b}
				<div class="small muted">
					Or install {b.label} instead:
					{#each b.checks.filter((c) => !c.ok) as c}<code>{c.fix}</code>{/each}
				</div>
			{/each}
		</section>
	{/if}

	<div class="grid">
		<section class="stack">
			<div class="spread">
				<h1>Environments</h1>
				<a class="btn primary" href="/environments/new">+ New environment</a>
			</div>

			{#if data.environments.length === 0}
				<div class="box pad stack empty">
					<h2>No environments yet</h2>
					<p>
						An environment is a sandbox recipe: which folder the agent works in, which coding agent runs, and exactly
						which files, websites and keys it can use. Create one, test it, then start a chat.
					</p>
					<div><a class="btn primary" href="/environments/new">Create your first environment</a></div>
				</div>
			{/if}

			{#each data.environments as { env, access } (env.id)}
				{@const label = data.system.harnesses.find((h) => h.id === env.harness)?.label ?? env.harness}
				<article class="box env">
					<div class="env-head spread">
						<div>
							<h2><a href="/environments/{env.id}">{env.name}</a></h2>
							<code class="muted">{env.workspace}</code>
						</div>
						<span class="tag acc">{label}</span>
					</div>
					<div class="facts">
						<div><span class="n">{access.filesystem.readWrite.length}</span> writable paths</div>
						<div><span class="n">{access.filesystem.denyRead.length}</span> hidden paths</div>
						<div><span class="n">{access.network.allowed.length}</span> domains</div>
						<div><span class="n">{access.credentials.direct.length + access.credentials.masked.length}</span> credentials</div>
					</div>
					{#if access.warnings.length}
						<div class="notice small">⚠ {access.warnings[0]}{access.warnings.length > 1 ? ` (+${access.warnings.length - 1} more)` : ''}</div>
					{/if}
					<div class="row actions">
						<button class="primary" onclick={() => newChat(env.id)} disabled={starting === env.id}>▶ New chat</button>
						<a class="btn" href="/environments/{env.id}">Details &amp; test</a>
						<a class="btn" href="/environments/{env.id}/edit">Edit</a>
					</div>
				</article>
			{/each}
		</section>

		<aside class="stack">
			<h1>Recent chats</h1>
			<div class="box">
				{#if data.sessions.length === 0}
					<p class="pad muted">No chats yet.</p>
				{:else}
					<ul class="sessions">
						{#each data.sessions as s (s.id)}
							<li>
								<a href="/sessions/{s.id}">
									<strong>{s.title}</strong>
									<span class="small muted">{envName(s.environmentId)} · {s.harness} · {new Date(s.updatedAt).toLocaleString()}</span>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="box pad stack small">
				<h3>System</h3>
				{#each data.system.checks as c}
					<div class="row"><span class="tag {c.ok ? 'ok' : 'bad'}">{c.ok ? 'ok' : 'missing'}</span> {c.name}</div>
				{/each}
				{#each data.system.sandboxes as b}
					<div class="row">
						<span class="tag {b.available ? 'ok' : 'bad'}">{b.available ? 'ok' : 'missing'}</span>
						Sandbox: {b.label}{b.preferred ? ' (used by Automatic)' : ''}
					</div>
					{#if b.limited}<div class="muted">{b.limited}</div>{/if}
				{/each}
				<div class="muted">Data folder: <code>{data.system.dataDir}</code></div>
			</div>
		</aside>
	</div>
</main>

<style>
	.grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 24px; align-items: start; }
	@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
	.error-box { background: var(--bad-bg); }
	.empty p { margin: 0; max-width: 60ch; }
	.env { display: flex; flex-direction: column; }
	.env > * { padding: 12px 16px; }
	.env-head { border-bottom: 2px solid var(--line); }
	.env-head h2 a { text-decoration: none; }
	.env-head code { word-break: break-all; }
	.facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; padding: 0; border-bottom: 2px solid var(--line); }
	.facts > div { padding: 10px 16px; border-right: 2px solid var(--line); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; }
	.facts > div:last-child { border-right: 0; }
	@media (max-width: 640px) { .facts { grid-template-columns: repeat(2, 1fr); } .facts > div:nth-child(2) { border-right: 0; } .facts > div:nth-child(-n + 2) { border-bottom: 2px solid var(--line); } }
	.n { display: block; font: 900 1.4rem var(--mono); }
	.env .notice { margin: 12px 16px 0; }
	.sessions { list-style: none; margin: 0; padding: 0; }
	.sessions li { border-bottom: 2px solid var(--line); }
	.sessions li:last-child { border-bottom: 0; }
	.sessions a { display: flex; flex-direction: column; padding: 10px 14px; text-decoration: none; }
	.sessions a:hover { background: var(--accent); color: #111; }
	.sessions a:hover .muted { color: #333; }
</style>
