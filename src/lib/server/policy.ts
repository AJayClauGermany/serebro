// Turns an environment into (a) sandbox-runtime settings and (b) a plain-language access
// report. Both come from the same function so the UI can never drift from what is enforced.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccessEntry, AccessReport } from '#lib/types.ts';
import { getHarness, which } from './harnesses';
import { DATA_DIR, getSecrets, sandboxDir, type StoredEnvironment } from './store';

/** Folders that hold credentials on most machines. Pre-filled into new environments. */
export const RECOMMENDED_DENY_READ = [
	'~/.ssh',
	'~/.aws',
	'~/.gnupg',
	'~/.config/gcloud',
	'~/.azure',
	'~/.kube',
	'~/.docker',
	'~/.netrc',
	'~/.git-credentials',
	'~/.config/gh'
];

export const PACKAGE_MANAGER_DOMAINS = [
	'registry.npmjs.org',
	'registry.yarnpkg.com',
	'pypi.org',
	'files.pythonhosted.org',
	'crates.io',
	'index.crates.io',
	'static.crates.io',
	'proxy.golang.org',
	'sum.golang.org',
	'github.com',
	'codeload.github.com',
	'objects.githubusercontent.com',
	'raw.githubusercontent.com'
];

export interface CompiledPolicy {
	settings: Record<string, unknown>;
	report: AccessReport;
	/** Env vars to put in every sandboxed command (includes secret values; server only). */
	env: Record<string, string>;
	tmpDir: string;
}

function uniq(entries: AccessEntry[]): AccessEntry[] {
	const seen = new Set<string>();
	return entries.filter((e) => {
		const k = e.value.trim();
		if (!k || seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

function expandHome(p: string) {
	return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function tmpDirFor(envId: string) {
	return path.join(os.tmpdir(), `serebro-${envId}`);
}

export function compilePolicy(env: StoredEnvironment, secrets = getSecrets(env.id)): CompiledPolicy {
	const harness = getHarness(env.harness);
	const warnings: string[] = [];
	const tmpDir = tmpDirFor(env.id);
	const workspace = path.resolve(expandHome(env.workspace));

	// ---- filesystem ----
	const readWrite = uniq([
		{ value: workspace, source: 'workspace', note: 'Project folder' },
		...env.filesystem.readWrite.map((v): AccessEntry => ({ value: v, source: 'you' })),
		...harness.writePaths.map((v): AccessEntry => ({ value: v, source: 'agent', note: `${harness.label} config and session files` })),
		{ value: tmpDir, source: 'runtime', note: 'Private temp folder (TMPDIR)' }
	]);
	const denyRead = uniq([
		...env.filesystem.denyRead.map(
			(v): AccessEntry => ({ value: v, source: RECOMMENDED_DENY_READ.includes(v) ? 'default' : 'you' })
		),
		{ value: DATA_DIR, source: 'runtime', note: 'Serebro data folder (holds your stored keys)' }
	]);
	const allowRead = uniq(env.filesystem.allowRead.map((v): AccessEntry => ({ value: v, source: 'you' })));
	const denyWrite = uniq([
		...env.filesystem.denyWrite.map((v): AccessEntry => ({ value: v, source: 'you' })),
		{ value: DATA_DIR, source: 'runtime', note: 'Serebro data folder' }
	]);

	// ---- network ----
	const allowed = uniq([
		...env.network.allowedDomains.map((v): AccessEntry => ({ value: v, source: 'you' })),
		...(env.network.harnessDefaults
			? harness.domains.map((v): AccessEntry => ({ value: v, source: 'agent', note: `${harness.label} model API` }))
			: []),
		...(env.network.packageManagers
			? PACKAGE_MANAGER_DOMAINS.map((v): AccessEntry => ({ value: v, source: 'packages' }))
			: [])
	]);
	const denied = uniq(env.network.deniedDomains.map((v): AccessEntry => ({ value: v, source: 'you' })));
	const localBinding = env.network.allowLocalBinding || env.harness === 'opencode';

	// ---- credentials ----
	const childEnv: Record<string, string> = { ...harness.env, TMPDIR: tmpDir, TMP: tmpDir, TEMP: tmpDir };
	const direct: AccessEntry[] = [];
	const masked: AccessEntry[] = [];
	const missing: AccessEntry[] = [];
	const maskedEnvVars: Array<Record<string, unknown>> = [];
	for (const c of env.credentials) {
		const value = secrets[c.name];
		if (!value) {
			missing.push({ value: c.name, source: 'you', note: 'No value saved' });
			continue;
		}
		childEnv[c.name] = value;
		if (c.mode === 'masked') {
			const hosts = c.injectHosts.filter(Boolean);
			masked.push({
				value: c.name,
				source: 'you',
				note: `Agent sees a placeholder. Real value sent only to ${hosts.length ? hosts.join(', ') : 'allowed domains'}`
			});
			maskedEnvVars.push({ name: c.name, mode: 'mask', ...(hosts.length ? { injectHosts: hosts } : {}) });
			for (const h of hosts) {
				if (!allowed.some((a) => a.value === h)) warnings.push(`${c.name} is injected for ${h}, but ${h} is not an allowed domain.`);
			}
		} else {
			direct.push({ value: c.name, source: 'you', note: 'Agent can read the real value' });
		}
	}
	for (const name of harness.credentialEnv) {
		if (!env.credentials.some((c) => c.name === name)) {
			missing.push({ value: name, source: 'agent', note: `${harness.label} usually needs this` });
		}
	}

	// ---- warnings ----
	if (!fs.existsSync(workspace)) warnings.push(`Workspace folder does not exist: ${workspace}`);
	if (!which(harness.binary)) warnings.push(`${harness.label} is not installed (\`${harness.binary}\` not on PATH). Install: ${harness.installHint}`);
	if (env.harness === 'opencode' && os.platform() === 'linux')
		warnings.push('OpenCode needs host-to-sandbox networking, which the Linux sandbox does not provide yet.');
	if (!env.network.harnessDefaults && harness.domains.length)
		warnings.push(`Agent API domains are off. ${harness.label} cannot reach ${harness.domains.join(', ')} unless you add them.`);

	// ---- sandbox-runtime settings ----
	const settings: Record<string, unknown> = {
		network: {
			allowedDomains: allowed.map((e) => e.value),
			deniedDomains: denied.map((e) => e.value),
			allowLocalBinding: localBinding,
			...(maskedEnvVars.length ? { tlsTerminate: {} } : {})
		},
		filesystem: {
			denyRead: denyRead.map((e) => e.value),
			allowRead: allowRead.map((e) => e.value),
			allowWrite: readWrite.map((e) => e.value),
			denyWrite: denyWrite.map((e) => e.value)
		},
		...(maskedEnvVars.length ? { credentials: { envVars: maskedEnvVars } } : {})
	};

	const report: AccessReport = {
		filesystem: {
			readWrite,
			readOnlyNote:
				'Everything else on this machine is read-only, except the paths listed under "Cannot read". Writes anywhere else are blocked.',
			denyRead,
			allowRead,
			denyWrite
		},
		network: {
			allowed,
			denied,
			localBinding,
			note: 'All other network destinations are blocked. Traffic goes through a filtering proxy.'
		},
		credentials: { direct, masked, missing },
		srtSettings: settings,
		warnings
	};

	return { settings, report, env: childEnv, tmpDir };
}

/** Write the srt settings file for an environment and return its path. */
export function writeSettings(env: StoredEnvironment, compiled = compilePolicy(env)) {
	const dir = sandboxDir(env.id);
	const file = path.join(dir, 'srt-settings.json');
	fs.writeFileSync(file, JSON.stringify(compiled.settings, null, 2), { mode: 0o600 });
	fs.mkdirSync(compiled.tmpDir, { recursive: true, mode: 0o700 });
	// sandbox-runtime always allows writes to /tmp/claude but only binds it if it exists.
	fs.mkdirSync('/tmp/claude', { recursive: true });
	return file;
}
