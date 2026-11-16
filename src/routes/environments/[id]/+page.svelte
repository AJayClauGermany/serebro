<script lang="ts">
	import { goto } from '$app/navigation';
	import AccessPanel from '#lib/components/AccessPanel.svelte';
	import PolicyEditor from '#lib/components/PolicyEditor.svelte';
	import type { ProbeResult } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const env = $derived(data.environment);

	let probing = $state(false);
	let probes = $state<ProbeResult[] | null>(null);
	let probeError = $state('');

	async function runProbe() {
		probing = true;
		probeError = '';
		try {
			const res = await fetch(`/api/environments/${env.id}/probe`, { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Test failed');
			probes = body;
		} catch (e) {
			probeError = e instanceof Error ? e.message : String(e);
		} finally {
			probing = false;
		}
	}

	async function newChat() {
		const res = await fetch('/api/sessions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ environmentId: env.id })
		});
		const s = await res.json();
		if (res.ok) goto(`/sessions/${s.id}`);
	}

	async function remove() {
		if (!confirm(`Delete "${env.name}", its stored keys and its chats? Files in the workspace are not touched.`)) return;
		await fetch(`/api/environments/${env.id}`, { method: 'DELETE' });
		goto('/', { invalidateAll: true });
	}
</script>

<main class="page">
	<div class="layout">
		<div class="stack">
			<section class="box pad stack">
				<div class="spread">
					<h1>{env.name}</h1>
					<span class="tag acc">{data.harness.label}</span>
				</div>
				<dl>
					<dt>Workspace</dt><dd><code>{env.workspace}</code></dd>
					<dt>Agent</dt>
					<dd>
						{data.harness.label} · <code>{env.model}</code>
						<span class="tag {data.harness.installed ? 'ok' : 'bad'}">{data.harness.installed ? 'installed' : 'not installed'}</span>
					</dd>
					<dt>Sandbox</dt><dd>{data.access.sandbox.label} <span class="small muted">({data.access.sandbox.reason})</span></dd>
				</dl>
				<div class="row">
					<button class="primary" onclick={newChat}>▶ New chat</button>
					<a class="btn" href="/environments/{env.id}/edit">Edit</a>
					<button class="danger" onclick={remove}>Delete</button>
				</div>
			</section>

			<section class="box pad stack">
				<div class="spread">
					<h2>Test the sandbox</h2>
					<button onclick={runProbe} disabled={probing}>{probing ? 'Running…' : 'Run checks'}</button>
				</div>
				<p class="small muted">
					Runs a few harmless commands inside this sandbox and checks each one is allowed or blocked as configured.
				</p>
				{#if probeError}<div class="error">{probeError}</div>{/if}
				{#if probes}
					<table>
						<thead><tr><th>Check</th><th>Expected</th><th>Result</th></tr></thead>
						<tbody>
							{#each probes as p}
								<tr class:fail={!p.pass}>
									<td>
										{p.name}
										{#if p.output}<details><summary class="small muted">output</summary><pre>{p.output}</pre></details>{/if}
									</td>
									<td><span class="tag">{p.expect}</span></td>
									<td><span class="tag {p.pass ? 'ok' : 'bad'}">{p.pass ? 'pass' : 'FAIL'} · {p.outcome}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<!-- Policy files are sandbox-runtime files; nono environments have none. -->
			{#if data.access.sandbox.id === 'srt'}{#key env.id}<PolicyEditor envId={env.id} />{/key}{/if}

			<section class="box">
				<h2 class="pad">Chats</h2>
				{#if data.sessions.length === 0}
					<p class="pad muted">No chats yet.</p>
				{:else}
					<ul class="sessions">
						{#each data.sessions as s (s.id)}
							<li><a href="/sessions/{s.id}"><strong>{s.title}</strong> <span class="small muted">{new Date(s.updatedAt).toLocaleString()}</span></a></li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<aside class="side"><AccessPanel report={data.access} /></aside>
	</div>
</main>

<style>
	.layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: 20px; align-items: start; }
	@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
	dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
	dt { font-weight: 800; text-transform: uppercase; font-size: 0.8rem; }
	dd { margin: 0; word-break: break-all; }
	table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
	th, td { border: 2px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
	th { background: var(--bg); text-transform: uppercase; font-size: 0.75rem; }
	tr.fail td { background: var(--bad-bg); }
	pre { white-space: pre-wrap; word-break: break-all; font: 0.75rem var(--mono); margin: 4px 0 0; }
	.sessions { list-style: none; margin: 0; padding: 0; border-top: 2px solid var(--line); }
	.sessions li + li { border-top: 2px solid var(--line); }
	.sessions a { display: block; padding: 10px 16px; text-decoration: none; }
	.sessions a:hover { background: var(--accent); color: #111; }
	h2.pad { padding: 12px 16px; }
</style>
