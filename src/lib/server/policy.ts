// Turns an environment into (a) sandbox-runtime settings and (b) a plain-language access
// report. Both come from the same function so the UI can never drift from what is enforced.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Effect } from 'effect';
import type { AccessEntry, AccessReport } from '#lib/types.ts';
import { DATA_DIR } from './config.ts';
import { FileSystemError, SandboxBlocked } from './errors.ts';
import { getHarness, which } from './harnesses';
import type { StoredEnvironment } from './schemas.ts';
import { Store } from './store.ts';
import { expandHome, hashText, policyCandidates, resolvePolicyFile, workspacePath } from './policy-file.ts';

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

/** Private temp folder per environment, under the user's home (not a guessable shared /tmp path). */
export function tmpDirFor(envId: string) {
	return path.join(os.homedir(), '.cache', 'serebro', 'tmp', envId);
}

type FsEntry = string | { path: string; literal: true };

const entryPath = (e: unknown) => (typeof e === 'string' ? e : (e as { path?: string })?.path ?? '');
const asList = (v: unknown): FsEntry[] => (Array.isArray(v) ? (v as FsEntry[]) : []);

/** The policy files Serebro may read. The agent can never create or change them. */
function protectedPolicyFiles(env: StoredEnvironment): AccessEntry[] {
	return policyCandidates(env).map((c) => ({
		value: c.path,
		source: 'runtime',
		note: `Sandbox policy file (${c.source}) — the agent cannot change its own rules`
	}));
}

/**
 * Pure: the same environment and secrets always give the same settings and report.
 * (It does look at the disk to find policy files and installed binaries.)
 */
export function compilePolicy(env: StoredEnvironment, secrets: Record<string, string>): CompiledPolicy {
	const harness = getHarness(env.harness);
	const warnings: string[] = [];
	const tmpDir = tmpDirFor(env.id);
	const workspace = workspacePath(env);
	const resolved = resolvePolicyFile(env);
	const file = resolved.active;
	const fromFile = !!file;
	let blocked: string | null = null;
	if (file && !file.validation.ok) {
		blocked = `Policy file ${file.path} is invalid, so the sandbox will not start:\n${file.validation.errors.join('\n')}`;
	}
	const fileConfig: Record<string, any> = file?.validation.config ?? {};
	const addAgent = fromFile ? env.policyFile?.addAgentNeeds !== false : true;
	const src: AccessEntry['source'] = 'file';

	// Agent and Serebro additions, the same in both modes.
	const agentWrites = addAgent
		? harness.writePaths.map((v): AccessEntry => ({ value: v, source: 'agent', note: `${harness.label} config and session files` }))
		: [];
	const runtimeWrites: AccessEntry[] = [{ value: tmpDir, source: 'runtime', note: 'Private temp folder (TMPDIR)' }];
	const runtimeDenyRead: AccessEntry[] = [{ value: DATA_DIR, source: 'runtime', note: 'Serebro data folder (holds your stored keys)' }];
	const runtimeDenyWrite: AccessEntry[] = [
		{ value: DATA_DIR, source: 'runtime', note: 'Serebro data folder' },
		...protectedPolicyFiles(env)
	];
	const agentDomains =
		(fromFile ? addAgent : env.network.harnessDefaults)
			? harness.domains.map((v): AccessEntry => ({ value: v, source: 'agent', note: `${harness.label} model API` }))
			: [];

	// ---- filesystem + network: from the file, or from the form ----
	let readWrite: AccessEntry[], denyRead: AccessEntry[], allowRead: AccessEntry[], denyWrite: AccessEntry[];
	let allowed: AccessEntry[], denied: AccessEntry[], localBinding: boolean;
	const fsIn = fileConfig.filesystem ?? {};
	const netIn = fileConfig.network ?? {};
	if (fromFile) {
		const fromList = (v: unknown) => asList(v).map((e): AccessEntry => ({ value: entryPath(e), source: src }));
		readWrite = uniq([...fromList(fsIn.allowWrite), ...agentWrites, ...runtimeWrites]);
		denyRead = uniq([...fromList(fsIn.denyRead), ...runtimeDenyRead]);
		allowRead = uniq(fromList(fsIn.allowRead));
		denyWrite = uniq([...fromList(fsIn.denyWrite), ...runtimeDenyWrite]);
		allowed = uniq([...fromList(netIn.allowedDomains), ...agentDomains]);
		denied = uniq(fromList(netIn.deniedDomains));
		localBinding = !!netIn.allowLocalBinding;
		const writable = asList(fsIn.allowWrite).map((e) => path.resolve(workspace, expandHome(entryPath(e))));
		if (!writable.some((w) => workspace === w || workspace.startsWith(w + path.sep)))
			warnings.push('The policy file does not make the workspace writable (add "." to filesystem.allowWrite). The agent will not be able to edit files.');
	} else {
		readWrite = uniq([
			{ value: workspace, source: 'workspace', note: 'Project folder' },
			...env.filesystem.readWrite.map((v): AccessEntry => ({ value: v, source: 'you' })),
			...agentWrites,
			...runtimeWrites
		]);
		denyRead = uniq([
			...env.filesystem.denyRead.map(
				(v): AccessEntry => ({ value: v, source: RECOMMENDED_DENY_READ.includes(v) ? 'default' : 'you' })
			),
			...runtimeDenyRead
		]);
		allowRead = uniq(env.filesystem.allowRead.map((v): AccessEntry => ({ value: v, source: 'you' })));
		denyWrite = uniq([...env.filesystem.denyWrite.map((v): AccessEntry => ({ value: v, source: 'you' })), ...runtimeDenyWrite]);
		allowed = uniq([
			...env.network.allowedDomains.map((v): AccessEntry => ({ value: v, source: 'you' })),
			...agentDomains,
			...(env.network.packageManagers
				? PACKAGE_MANAGER_DOMAINS.map((v): AccessEntry => ({ value: v, source: 'packages' }))
				: [])
		]);
		denied = uniq(env.network.deniedDomains.map((v): AccessEntry => ({ value: v, source: 'you' })));
		localBinding = env.network.allowLocalBinding;
	}
	if (env.harness === 'opencode') localBinding = true;

	// ---- credentials (always from Serebro: keys do not belong in a policy file) ----
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
	const fileCreds = fileConfig.credentials ?? {};
	const fileMaskedEnv = asList(fileCreds.envVars) as unknown as Array<{ name: string }>;
	for (const v of fileMaskedEnv) masked.push({ value: v.name, source: 'file', note: 'Masked by the policy file' });

	// ---- warnings ----
	if (!fs.existsSync(workspace)) warnings.push(`Workspace folder does not exist: ${workspace}`);
	if (workspace === os.homedir() || workspace === path.parse(workspace).root)
		warnings.push(`The workspace is ${workspace}, so the agent can write almost everywhere. Pick a project folder instead.`);
	if (!which(harness.binary)) warnings.push(`${harness.label} is not installed (\`${harness.binary}\` not on PATH). Install: ${harness.installHint}`);
	if (env.harness === 'opencode' && os.platform() === 'linux')
		warnings.push('OpenCode needs host-to-sandbox networking, which the Linux sandbox does not provide yet.');
	if (!agentDomains.length && harness.domains.length && !harness.domains.every((d) => allowed.some((a) => a.value === d)))
		warnings.push(`Agent API domains are off. ${harness.label} cannot reach ${harness.domains.join(', ')} unless you add them.`);

	// ---- sandbox-runtime settings ----
	// Paths keep the file's original form (including { path, literal } entries); additions are appended.
	const keepOrAdd = (orig: unknown, entries: AccessEntry[]): FsEntry[] => {
		const out = fromFile ? [...asList(orig)] : [];
		const have = new Set(out.map(entryPath));
		for (const e of entries) if (!have.has(e.value)) out.push(e.value);
		return out;
	};
	const denyWriteOut = keepOrAdd(fsIn.denyWrite, denyWrite).map((e) =>
		typeof e === 'string' && runtimeDenyWrite.some((r) => r.value === e && r.note?.startsWith('Sandbox policy file'))
			? { path: e, literal: true as const }
			: e
	);
	const tlsNeeded = maskedEnvVars.length > 0;
	const { network: _n, filesystem: _f, credentials: _c, ...otherFileKeys } = fileConfig;
	const settings: Record<string, unknown> = {
		...otherFileKeys,
		network: {
			...netIn,
			allowedDomains: keepOrAdd(netIn.allowedDomains, allowed),
			deniedDomains: keepOrAdd(netIn.deniedDomains, denied),
			allowLocalBinding: localBinding,
			...(tlsNeeded && !netIn.tlsTerminate ? { tlsTerminate: {} } : {})
		},
		filesystem: {
			...fsIn,
			denyRead: keepOrAdd(fsIn.denyRead, denyRead),
			allowRead: keepOrAdd(fsIn.allowRead, allowRead),
			allowWrite: keepOrAdd(fsIn.allowWrite, readWrite),
			denyWrite: denyWriteOut
		},
		...(tlsNeeded || fileMaskedEnv.length
			? { credentials: { ...fileCreds, envVars: [...fileMaskedEnv, ...maskedEnvVars] } }
			: {})
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
		policy: file
			? { source: file.source, path: file.path, otherKeys: Object.keys(otherFileKeys) }
			: { source: 'form', otherKeys: [] },
		hash: hashText(JSON.stringify(settings) + (blocked ?? '')),
		blocked,
		srtSettings: settings,
		warnings
	};

	return { settings, report, env: childEnv, tmpDir };
}

/**
 * A policy file built from the environment form, as a starting point. Serebro's own
 * additions (temp folder, data folder, agent paths) are left out: they are added at run time.
 */
export function starterPolicy(env: StoredEnvironment): string {
	const formEnv: StoredEnvironment = { ...env, policyFile: { ...env.policyFile, mode: 'off' } };
	const { report } = compilePolicy(formEnv, {});
	const pick = (list: AccessEntry[], drop: AccessEntry['source'][] = ['runtime']) =>
		list.filter((e) => !drop.includes(e.source)).map((e) => (e.source === 'workspace' ? '.' : e.value));
	const config = {
		filesystem: {
			allowWrite: pick(report.filesystem.readWrite),
			denyRead: pick(report.filesystem.denyRead),
			allowRead: pick(report.filesystem.allowRead),
			denyWrite: pick(report.filesystem.denyWrite)
		},
		network: {
			allowedDomains: pick(report.network.allowed, ['runtime']),
			deniedDomains: pick(report.network.denied),
			allowLocalBinding: env.network.allowLocalBinding
		}
	};
	return JSON.stringify(config, null, 2) + '\n';
}

/** Load the environment's secrets and compile its policy. */
export const compileFor = (env: StoredEnvironment) =>
	Effect.gen(function* () {
		const store = yield* Store;
		return compilePolicy(env, yield* store.getSecrets(env.id));
	});

/**
 * Compile the policy, refuse to continue if it is blocked, and write the srt settings
 * file. Returns the compiled policy and the settings file path.
 */
export const prepareSandbox = Effect.fn('prepareSandbox')(function* (env: StoredEnvironment) {
	const store = yield* Store;
	const compiled = yield* compileFor(env);
	if (compiled.report.blocked) return yield* new SandboxBlocked({ message: compiled.report.blocked });
	const settingsFile = path.join(yield* store.sandboxDir(env.id), 'srt-settings.json');
	yield* Effect.tryPromise({
		try: () => fs.promises.writeFile(settingsFile, JSON.stringify(compiled.settings, null, 2), { mode: 0o600 }),
		catch: (cause) => new FileSystemError({ op: 'write', path: settingsFile, cause })
	});
	// sandbox-runtime always allows writes to /tmp/claude but only binds it if it exists.
	for (const [dir, mode] of [[compiled.tmpDir, 0o700], ['/tmp/claude', undefined]] as const) {
		yield* Effect.tryPromise({
			try: () => fs.promises.mkdir(dir, { recursive: true, mode }),
			catch: (cause) => new FileSystemError({ op: 'mkdir', path: dir, cause })
		});
	}
	return { compiled, settingsFile };
});
