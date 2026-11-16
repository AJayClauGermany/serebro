<script lang="ts">
	// Plain-language summary of what an agent can and cannot touch.
	import type { AccessEntry, AccessReport, AccessSource } from '#lib/types.ts';

	let { report, compact = false }: { report: AccessReport | null; compact?: boolean } = $props();
	let showRaw = $state(false);

	const SOURCE: Record<AccessSource, string> = {
		workspace: 'workspace',
		you: 'you',
		agent: 'agent',
		packages: 'packages',
		default: 'default',
		runtime: 'serebro',
		file: 'policy file'
	};
</script>

{#snippet entries(list: AccessEntry[], empty: string)}
	{#if list.length === 0}
		<li class="muted small">{empty}</li>
	{:else}
		{#each list as e (e.value)}
			<li>
				<code>{e.value}</code>
				<span class="src" title="Why this is here">{SOURCE[e.source]}</span>
				{#if e.note && !compact}<div class="note">{e.note}</div>{/if}
			</li>
		{/each}
	{/if}
{/snippet}

<section class="box access" aria-label="Access summary">
	<div class="head spread">
		<h2>What the agent can touch</h2>
	</div>

	{#if !report}
		<p class="pad muted">Fill in the form to see the effective access.</p>
	{:else}
		<div class="policy-src small">
			Enforced by: <strong>{report.sandbox.label}</strong> <span class="muted">({report.sandbox.reason})</span>
		</div>
		<div class="policy-src small">
			Rules from:
			{#if report.policy.source === 'form'}
				<strong>this environment's settings</strong>
			{:else}
				<strong>{report.policy.source} policy file</strong> <code>{report.policy.path}</code>
				{#if report.policy.otherKeys.length}
					<div class="muted">Also passed through from the file: {report.policy.otherKeys.join(', ')}</div>
				{/if}
			{/if}
		</div>
		{#if report.blocked}
			<div class="pad"><div class="error small blocked">{report.blocked}</div></div>
		{/if}
		{#if report.warnings.length}
			<div class="pad warnlist">
				{#each report.warnings as w}<div class="notice small">⚠ {w}</div>{/each}
			</div>
		{/if}

		<div class="group">
			<h3>Files</h3>
			<div class="label ok">Can read + write</div>
			<ul>{@render entries(report.filesystem.readWrite, 'Nothing')}</ul>
			{#if report.filesystem.readOnly.length}
				<div class="label ok">Can read</div>
				<ul>{@render entries(report.filesystem.readOnly, '')}</ul>
			{/if}
			<div class="label bad">Cannot read</div>
			<ul>
				{@render entries(
					report.filesystem.denyRead,
					report.sandbox.id === 'nono' ? 'Nothing extra' : 'Nothing hidden: the agent can read every file you can'
				)}
			</ul>
			{#if report.filesystem.allowRead.length}
				<div class="label ok">Re-allowed for reading</div>
				<ul>{@render entries(report.filesystem.allowRead, '')}</ul>
			{/if}
			<div class="label bad">Never writable</div>
			<ul>{@render entries(report.filesystem.denyWrite, 'Nothing extra')}</ul>
			<p class="small muted">
				{report.filesystem.readOnlyNote}
				{#if report.sandbox.id === 'srt'}Shell startup files and <code>.git/hooks</code> are always protected.{/if}
			</p>
		</div>

		<div class="group">
			<h3>Network</h3>
			<div class="label ok">Can connect to</div>
			<ul>{@render entries(report.network.allowed, 'Nothing: no network access')}</ul>
			{#if report.network.denied.length}
				<div class="label bad">Always blocked</div>
				<ul>{@render entries(report.network.denied, '')}</ul>
			{/if}
			<p class="small muted">
				{report.network.note}
				Local ports: <strong>{report.network.localBinding ? 'allowed' : 'blocked'}</strong>.
			</p>
		</div>

		<div class="group">
			<h3>Credentials</h3>
			<div class="label bad">Readable by the agent</div>
			<ul>{@render entries(report.credentials.direct, 'None')}</ul>
			<div class="label ok">Masked (placeholder only)</div>
			<ul>{@render entries(report.credentials.masked, 'None')}</ul>
			{#if report.credentials.missing.length}
				<div class="label">Not set</div>
				<ul>{@render entries(report.credentials.missing, '')}</ul>
			{/if}
			<p class="small muted">The agent gets no other environment variables from this machine.</p>
		</div>

		{#if !compact}
			<div class="group">
				<button class="ghost small" onclick={() => (showRaw = !showRaw)}>
					{showRaw ? '▾' : '▸'} Raw {report.sandbox.id === 'nono' ? 'nono profile' : 'sandbox-runtime settings'}
				</button>
				{#if showRaw}<pre class="raw">{JSON.stringify(report.rawSettings, null, 2)}</pre>{/if}
			</div>
		{/if}
	{/if}
</section>

<style>
	.access { display: flex; flex-direction: column; }
	.head { padding: 12px 16px; border-bottom: 2px solid var(--line); background: var(--accent); color: #111; }
	.group { padding: 12px 16px; border-bottom: 2px solid var(--line); }
	.group:last-child { border-bottom: 0; }
	.group h3 { margin-bottom: 8px; }
	.label { font: 800 0.72rem var(--sans); text-transform: uppercase; margin: 10px 0 4px; }
	.label.ok::before { content: '✔ '; color: var(--ok); }
	.label.bad::before { content: '✖ '; color: var(--bad); }
	ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	li { border-left: 4px solid var(--line); padding: 2px 8px; word-break: break-all; }
	.src { font: 700 0.65rem var(--sans); text-transform: uppercase; border: 1px solid var(--line); padding: 0 4px; margin-left: 6px; color: var(--muted); }
	.note { font-size: 0.8rem; color: var(--muted); word-break: normal; }
	.warnlist { display: flex; flex-direction: column; gap: 6px; border-bottom: 2px solid var(--line); }
	.policy-src { padding: 10px 16px; border-bottom: 2px solid var(--line); word-break: break-all; }
	.blocked { white-space: pre-wrap; }
	.raw { font: 0.75rem var(--mono); overflow: auto; max-height: 320px; background: var(--bg); border: 2px solid var(--line); padding: 8px; }
</style>
