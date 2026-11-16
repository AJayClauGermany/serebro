<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import type {
		AccessReport,
		CredentialMode,
		EnvironmentView,
		HarnessId,
		HarnessInfo,
		SandboxBackendInfo,
		SandboxChoice
	} from '#lib/types.ts';
	import AccessPanel from './AccessPanel.svelte';
	import ListEditor from './ListEditor.svelte';
	import Section from './Section.svelte';

	let {
		harnesses,
		sandboxes,
		existing = null,
		defaults
	}: {
		harnesses: HarnessInfo[];
		sandboxes: SandboxBackendInfo[];
		existing?: EnvironmentView | null;
		defaults: { denyRead: string[]; packageDomains: string[] };
	} = $props();

	interface CredRow {
		name: string;
		mode: CredentialMode;
		injectHosts: string[];
		value: string;
		hasValue: boolean;
		hint: string;
	}

	// Form state, seeded once from the existing environment (or sensible defaults).
	const init = untrack(() => existing);
	const seedHarnesses = untrack(() => harnesses);
	const seedDefaults = untrack(() => defaults);
	let name = $state(init?.name ?? '');
	let workspace = $state(init?.workspace ?? '');
	let harness = $state<HarnessId>(init?.harness ?? 'claude-code');
	let model = $state(init?.model ?? seedHarnesses.find((h) => h.id === 'claude-code')?.defaultModel ?? '');
	let readWrite = $state<string[]>(init?.filesystem.readWrite ?? []);
	let denyRead = $state<string[]>(init?.filesystem.denyRead ?? [...seedDefaults.denyRead]);
	let allowRead = $state<string[]>(init?.filesystem.allowRead ?? []);
	// nono cannot protect a file inside the writable workspace, so a new environment that would
	// run on it does not start with rules that block it. (Adding one still blocks, by design.)
	const seedNono = untrack(() => sandboxes.find((b) => b.preferred)?.id === 'nono');
	let denyWrite = $state<string[]>(init?.filesystem.denyWrite ?? (seedNono ? [] : ['.env', '.env.local']));
	let allowedDomains = $state<string[]>(init?.network.allowedDomains ?? []);
	let deniedDomains = $state<string[]>(init?.network.deniedDomains ?? []);
	let packageManagers = $state(init?.network.packageManagers ?? false);
	let harnessDefaults = $state(init?.network.harnessDefaults ?? true);
	let allowLocalBinding = $state(init?.network.allowLocalBinding ?? false);
	let sandbox = $state<SandboxChoice>(init?.sandbox ?? 'auto');
	// The sandbox that will actually run: the chosen one, or the one "auto" picks on this machine.
	const backend = $derived(sandboxes.find((b) => (sandbox === 'auto' ? b.preferred : b.id === sandbox)) ?? sandboxes[0]);
	const usesNono = $derived(backend.id === 'nono');
	let policyMode = $state(init?.policyFile.mode ?? 'auto');
	let policyPath = $state(init?.policyFile.path ?? '');
	let addAgentNeeds = $state(init?.policyFile.addAgentNeeds ?? true);
	let credentials = $state<CredRow[]>(
		init?.credentials.map((c) => ({ ...c, value: '' })) ??
			[{ name: 'ANTHROPIC_API_KEY', mode: 'direct', injectHosts: [], value: '', hasValue: false, hint: '' }]
	);

	let saving = $state(false);
	let error = $state('');
	let report = $state<AccessReport | null>(null);
	let openSection = $state<Record<string, boolean>>({ policy: false, files: !init, network: false, creds: !init });
	const fileInUse = $derived(report && report.policy.source !== 'form' ? report.policy : null);

	const current = $derived(harnesses.find((h) => h.id === harness)!);

	function pickHarness(id: HarnessId) {
		const prev = current;
		harness = id;
		const next = harnesses.find((h) => h.id === id)!;
		if (!model || prev.models.includes(model) || model === prev.defaultModel) model = next.defaultModel;
		// Offer the agent's usual key if no credential rows match it yet.
		for (const env of next.credentialEnv) {
			if (!credentials.some((c) => c.name === env)) {
				const blank = credentials.findIndex((c) => !c.value && !c.hasValue && prev.credentialEnv.includes(c.name));
				const row: CredRow = { name: env, mode: 'direct', injectHosts: [], value: '', hasValue: false, hint: '' };
				if (blank >= 0) credentials[blank] = row;
				else credentials.push(row);
			}
		}
	}

	function payload() {
		return {
			id: existing?.id,
			name,
			workspace,
			harness,
			model,
			sandbox,
			filesystem: { readWrite, denyRead, allowRead, denyWrite },
			network: { allowedDomains, deniedDomains, packageManagers, harnessDefaults, allowLocalBinding },
			// Policy files are sandbox-runtime files. nono refuses to run unless they are off.
			policyFile: { mode: usesNono ? 'off' : policyMode, path: policyPath, addAgentNeeds },
			credentials: credentials.map((c) => ({
				name: c.name,
				mode: c.mode,
				injectHosts: c.injectHosts,
				value: c.value || undefined
			}))
		};
	}

	// Live preview: recompile the policy on the server whenever the form changes.
	$effect(() => {
		const body = JSON.stringify(payload());
		const t = setTimeout(async () => {
			const res = await fetch('/api/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
			if (res.ok) report = await res.json();
		}, 250);
		return () => clearTimeout(t);
	});

	async function save(e: SubmitEvent) {
		e.preventDefault();
		saving = true;
		error = '';
		try {
			const res = await fetch(existing ? `/api/environments/${existing.id}` : '/api/environments', {
				method: existing ? 'PUT' : 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload())
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? 'Save failed');
			await goto(`/environments/${data.id}`, { invalidateAll: true });
			for (const c of credentials) c.value = '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	const fsSummary = $derived(
		fileInUse
			? `From ${fileInUse.source} policy file`
			: `${1 + readWrite.length} writable · ${denyRead.length} hidden · ${denyWrite.length} protected`
	);
	const policySummary = $derived(
		policyMode === 'off'
			? 'Off · always use the settings below'
			: fileInUse
				? `Using ${fileInUse.path}`
				: policyMode === 'custom'
					? `Custom: ${policyPath || '(no path)'}`
					: 'Auto · no .srt-settings.json found, using the settings below'
	);
	const netCount = $derived(
		allowedDomains.length + (harnessDefaults ? current.domains.length : 0) + (packageManagers ? defaults.packageDomains.length : 0)
	);
	const netSummary = $derived(
		fileInUse ? `From ${fileInUse.source} policy file` : `Limited · ${netCount} domain${netCount === 1 ? '' : 's'} · package managers ${packageManagers ? 'on' : 'off'}`
	);
	const credSummary = $derived(
		credentials.filter((c) => c.name).length === 0
			? 'None'
			: credentials
					.filter((c) => c.name)
					.map((c) => `${c.name}${c.mode === 'masked' ? ' (masked)' : ''}${c.value || c.hasValue ? '' : ' — not set'}`)
					.join(' · ')
	);
</script>

<div class="layout">
	<form class="box pad stack form" onsubmit={save}>
		<h1>{existing ? 'Edit environment' : 'New environment'}</h1>

		<label class="field">
			Name
			<input bind:value={name} placeholder="My app" required />
		</label>

		<label class="field">
			Workspace folder
			<span class="hint">The project folder on this machine. The agent can read and write here, and starts here.</span>
			<input bind:value={workspace} placeholder="/home/you/code/my-app" required />
		</label>

		<fieldset class="field agents">
			<legend>Coding agent</legend>
			<div class="agent-grid">
				{#each harnesses as h (h.id)}
					<button
						type="button"
						class="agent"
						class:selected={harness === h.id}
						aria-pressed={harness === h.id}
						onclick={() => pickHarness(h.id)}
					>
						<strong>{h.label}</strong>
						<span class="small muted">{h.vendor}</span>
						<span class="tag {h.installed ? 'ok' : 'bad'}">{h.installed ? 'installed' : 'not installed'}</span>
					</button>
				{/each}
			</div>
			{#if !current.installed}
				<div class="notice small">
					<code>{current.binary}</code> was not found on this machine. Install it with:
					<pre class="mono">{current.installHint}</pre>
				</div>
			{/if}
			{#if current.notes}<div class="notice small">{current.notes}</div>{/if}
		</fieldset>

		<label class="field">
			Model
			<input bind:value={model} list="models" />
			<datalist id="models">
				{#each current.models as m}<option value={m}></option>{/each}
			</datalist>
		</label>

		<label class="field">
			Sandbox
			<span class="hint">
				What enforces the rules below. Automatic prefers sandbox-runtime and uses nono when sandbox-runtime cannot run on
				this machine.
			</span>
			<select bind:value={sandbox}>
				<option value="auto">Automatic (now: {sandboxes.find((b) => b.preferred)?.label})</option>
				{#each sandboxes as b (b.id)}
					<option value={b.id}>{b.label}{b.available ? '' : ' · not installed'}</option>
				{/each}
			</select>
		</label>
		{#if !backend.available}
			<div class="notice small">
				{backend.label} cannot run on this machine yet:
				{#each backend.checks.filter((c) => !c.ok) as c}
					<div><strong>{c.name}</strong>: {c.detail}. Fix: <code>{c.fix}</code></div>
				{/each}
			</div>
		{/if}
		{#if usesNono}
			<div class="notice small">
				With nono the agent can read only system folders and the paths you grant, not your whole machine. nono cannot
				hide or protect a path inside a folder the agent may use (on Linux), mask credentials, or read policy files. An
				environment with a rule nono cannot enforce will not start.
			</div>
		{/if}

		{#if !usesNono}
		<Section title="Policy file" summary={policySummary} bind:open={openSection.policy}>
			<div class="small muted">
				Already have a sandbox-runtime config? Serebro can use it instead of the Files and Network settings below.
				Credentials always come from this page.
			</div>
			<label class="check">
				<input type="radio" bind:group={policyMode} value="auto" />
				<span>
					<strong>Auto</strong>: use <code>.srt-settings.json</code> in the workspace, else <code>~/.srt-settings.json</code>,
					else the settings below
				</span>
			</label>
			<label class="check">
				<input type="radio" bind:group={policyMode} value="custom" />
				<span><strong>Custom file</strong>: always use a file you choose</span>
			</label>
			{#if policyMode === 'custom'}
				<input bind:value={policyPath} placeholder="~/policies/strict.json or sandbox/policy.json (relative to the workspace)" />
			{/if}
			<label class="check">
				<input type="radio" bind:group={policyMode} value="off" />
				<span><strong>Off</strong>: ignore policy files and use the settings below</span>
			</label>
			{#if policyMode !== 'off'}
				<label class="check">
					<input type="checkbox" bind:checked={addAgentNeeds} />
					<span>When a file is used, also allow what {current.label} needs: <code>{[...current.domains, ...current.writePaths].join(', ')}</code></span>
				</label>
			{/if}
			<div class="small muted">You can create and edit the file on the environment page after saving.</div>
		</Section>
		{/if}

		{#if fileInUse}
			<div class="notice small">
				Files and Network below are <strong>not used</strong>: the rules come from <code>{fileInUse.path}</code>.
			</div>
		{/if}

		<Section title="Files" summary={fsSummary} bind:open={openSection.files}>
			<div class="small muted">
				{#if usesNono}
					Reads are limited to system folders and the paths granted here. Writes are blocked everywhere except writable paths.
				{:else}
					Reads are allowed everywhere except hidden paths. Writes are blocked everywhere except writable paths.
				{/if}
				Use absolute paths or <code>~/…</code>.
			</div>
			<div class="field-block">
				<h3>Extra writable folders</h3>
				<p class="small muted">The workspace and the agent's own config folder are always writable.</p>
				<ListEditor bind:items={readWrite} placeholder="~/code/shared-lib" />
			</div>
			<div class="field-block">
				<h3>Hidden (cannot read)</h3>
				<p class="small muted">Pre-filled with folders that usually hold keys and logins.</p>
				<ListEditor bind:items={denyRead} placeholder="~/Documents" addLabel="Hide" />
			</div>
			<div class="field-block">
				<h3>Re-allow reading inside a hidden folder</h3>
				<ListEditor bind:items={allowRead} placeholder="~/Documents/specs" />
			</div>
			<div class="field-block">
				<h3>Never writable</h3>
				<p class="small muted">Blocks writes even inside writable folders. Relative paths are inside the workspace.</p>
				<ListEditor bind:items={denyWrite} placeholder=".env" addLabel="Protect" />
			</div>
		</Section>

		<Section title="Network access" summary={netSummary} bind:open={openSection.network}>
			<div class="small muted">Everything not listed is blocked. Wildcards like <code>*.example.com</code> work.</div>
			<label class="check">
				<input type="checkbox" bind:checked={harnessDefaults} />
				<span>Allow {current.label}'s model API <code>{current.domains.join(', ')}</code></span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={packageManagers} />
				<span>Allow package managers (npm, PyPI, crates.io, Go, GitHub)</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={allowLocalBinding} />
				<span>Allow local ports (for dev servers)</span>
			</label>
			<div class="field-block">
				<h3>Allowed domains</h3>
				<ListEditor bind:items={allowedDomains} placeholder="api.example.com" />
			</div>
			<div class="field-block">
				<h3>Always blocked</h3>
				<ListEditor bind:items={deniedDomains} placeholder="tracker.example.com" addLabel="Block" />
			</div>
		</Section>

		<Section title="Credentials" summary={credSummary} bind:open={openSection.creds}>
			<div class="small muted">
				Passed to the agent as environment variables. Values are stored on this server only and never shown again.
				<strong>Direct</strong>: the agent can read the real value. <strong>Masked</strong>: the agent sees a placeholder,
				and the sandbox swaps in the real value only on HTTPS requests to the hosts you list (experimental).
			</div>
			{#each credentials as c, i (i)}
				<div class="cred">
					<div class="cred-row">
						<input bind:value={c.name} placeholder="ENV_VAR_NAME" aria-label="Variable name" />
						<input
							type="password"
							bind:value={c.value}
							placeholder={c.hasValue ? `saved ${c.hint} — leave blank to keep` : 'value'}
							aria-label="Value for {c.name}"
							autocomplete="off"
						/>
						<select bind:value={c.mode} aria-label="Mode for {c.name}">
							<option value="direct">Direct</option>
							<option value="masked">Masked</option>
						</select>
						<button type="button" class="ghost" aria-label="Remove {c.name}" onclick={() => credentials.splice(i, 1)}>✕</button>
					</div>
					{#if c.mode === 'masked'}
						<div class="small">
							Send the real value only to:
							<ListEditor bind:items={c.injectHosts} placeholder={current.domains[0] ?? 'api.example.com'} addLabel="Host" />
						</div>
					{/if}
				</div>
			{/each}
			<div>
				<button
					type="button"
					onclick={() => credentials.push({ name: '', mode: 'direct', injectHosts: [], value: '', hasValue: false, hint: '' })}
				>+ Add credential</button>
			</div>
		</Section>

		{#if error}<div class="error">{error}</div>{/if}

		<div class="row actions">
			<a class="btn" href={existing ? `/environments/${existing.id}` : '/'}>Cancel</a>
			<button class="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save changes' : 'Add environment'}</button>
		</div>
	</form>

	<aside class="side">
		<AccessPanel {report} />
	</aside>
</div>

<style>
	.layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: 20px; align-items: start; }
	@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
	.side { position: sticky; top: 16px; }
	fieldset { border: 0; padding: 0; margin: 0; }
	legend { font-weight: 700; font-size: 0.85rem; text-transform: uppercase; margin-bottom: 6px; }
	.agents { display: flex; flex-direction: column; gap: 8px; }
	.agent-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
	.agent { flex-direction: column; align-items: flex-start; text-transform: none; gap: 4px; box-shadow: none; }
	.agent.selected { background: var(--accent); color: #111; box-shadow: 3px 3px 0 var(--line); }
	.agent.selected .muted { color: #333; }
	.notice pre { margin: 6px 0 0; white-space: pre-wrap; }
	.field-block { display: flex; flex-direction: column; gap: 6px; }
	.field-block p { margin: 0; }
	.check { display: flex; gap: 10px; align-items: flex-start; font-size: 0.92rem; }
	.check input { width: 18px; height: 18px; margin-top: 2px; flex: none; accent-color: #111; }
	.cred { border: 2px solid var(--line); padding: 8px; display: flex; flex-direction: column; gap: 8px; background: var(--bg); }
	.cred-row { display: grid; grid-template-columns: 1fr 1.3fr auto auto; gap: 6px; }
	@media (max-width: 640px) { .cred-row { grid-template-columns: 1fr; } }
	.cred-row select { width: auto; }
	.actions { justify-content: flex-end; }
</style>
