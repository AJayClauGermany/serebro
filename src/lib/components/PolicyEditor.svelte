<script lang="ts">
	// View, create and edit the sandbox-runtime policy file used by an environment.
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PolicyFileSource, PolicyFileState } from '#lib/types.ts';

	let { envId }: { envId: string } = $props();

	let pf = $state<PolicyFileState | null>(null);
	let draft = $state('');
	let target = $state<PolicyFileSource>('project');
	let editing = $state(false);
	let saving = $state(false);
	let message = $state('');
	let errors = $state<string[]>([]);

	const LABEL: Record<PolicyFileSource, string> = {
		project: 'Project file',
		global: 'Global file (srt default)',
		custom: 'Custom file'
	};

	async function load() {
		const res = await fetch(`/api/environments/${envId}/policy`);
		if (!res.ok) return;
		pf = await res.json();
		if (!editing && pf) {
			draft = pf.active?.content ?? pf.starter;
			target = pf.active?.source ?? (pf.mode === 'custom' ? 'custom' : 'project');
		}
	}

	onMount(load);

	function startNew(t: PolicyFileSource) {
		target = t;
		draft = pf?.starter ?? '{}\n';
		editing = true;
		errors = [];
		message = '';
	}

	async function save() {
		saving = true;
		errors = [];
		message = '';
		const res = await fetch(`/api/environments/${envId}/policy`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ target, content: draft })
		});
		const body = await res.json();
		saving = false;
		if (!res.ok) {
			message = body.error ?? 'Save failed';
			errors = body.errors ?? [];
			return;
		}
		editing = false;
		message = 'Saved. The new rules apply to the next agent message and the next test run.';
		await load();
		await invalidateAll();
	}

	const pathOf = (t: PolicyFileSource) => pf?.candidates.find((c) => c.source === t)?.path ?? '';
	const dirty = $derived(editing && draft !== (pf?.active?.content ?? ''));
</script>

<section class="box pad stack">
	<div class="spread">
		<h2>Policy file</h2>
		<button class="ghost small" onclick={load}>↻ Reload from disk</button>
	</div>

	{#if !pf}
		<p class="muted">Loading…</p>
	{:else}
		{#if pf.mode === 'off'}
			<div class="notice small">
				Policy files are <strong>off</strong> for this environment. Turn them on under Edit → Policy file.
			</div>
		{/if}

		<table class="small">
			<tbody>
				{#each pf.candidates as c (c.source)}
					<tr class:active={pf.active?.path === c.path}>
						<td><strong>{LABEL[c.source]}</strong></td>
						<td><code>{c.path}</code></td>
						<td>
							{#if pf.active?.path === c.path}<span class="tag acc">in use</span>
							{:else if c.exists}<span class="tag">found</span>
							{:else}<span class="tag">none</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<p class="small muted">
			Lookup order: custom (if set), then project, then global. When no file is found the environment settings are used.
			The agent can never write these files.
		</p>

		{#if pf.active?.errors.length}
			<div class="error small">
				<strong>This file is invalid, so the sandbox will not start.</strong>
				<ul>{#each pf.active.errors as e}<li>{e}</li>{/each}</ul>
			</div>
		{/if}

		{#if pf.active || editing}
			<div class="spread">
				<span class="small">
					Editing <strong>{LABEL[target]}</strong>
					<code>{pathOf(target)}</code>
				</span>
				{#if dirty}<span class="tag acc">unsaved</span>{/if}
			</div>
			<textarea
				class="editor"
				bind:value={draft}
				oninput={() => (editing = true)}
				spellcheck="false"
				rows="18"
				aria-label="Policy file contents"
			></textarea>
			<div class="row">
				<button class="primary" onclick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Validate & save'}</button>
				{#if editing}
					<button onclick={() => { editing = false; load(); }}>Discard</button>
				{/if}
			</div>
		{:else if pf.mode !== 'off'}
			<p class="small">No policy file yet. Create one from this environment's current settings:</p>
			<div class="row">
				<button onclick={() => startNew('project')}>+ Project file (.srt-settings.json in workspace)</button>
				<button onclick={() => startNew('global')}>+ Global file (~/.srt-settings.json)</button>
				{#if pf.mode === 'custom'}<button onclick={() => startNew('custom')}>+ Custom file</button>{/if}
			</div>
		{/if}

		{#if message}<div class={errors.length ? 'error small' : 'notice small'}>{message}
				{#if errors.length}<ul>{#each errors as e}<li>{e}</li>{/each}</ul>{/if}</div>{/if}
		<p class="small muted">
			Format: <a href="https://github.com/anthropic-experimental/sandbox-runtime#configuration" target="_blank" rel="noreferrer">sandbox-runtime settings</a>.
			Edits made in your own editor are picked up too. Serebro checks the file before every run.
		</p>
	{/if}
</section>

<style>
	table { width: 100%; border-collapse: collapse; }
	td { border: 2px solid var(--line); padding: 4px 8px; word-break: break-all; vertical-align: top; }
	td:first-child { white-space: nowrap; word-break: normal; }
	tr.active td { background: var(--accent); color: #111; }
	.editor { font: 0.82rem/1.45 var(--mono); resize: vertical; tab-size: 2; }
	ul { margin: 6px 0 0; padding-left: 18px; }
	p { margin: 0; }
</style>
