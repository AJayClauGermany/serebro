// Turns an environment into (a) settings for its sandbox (sandbox-runtime or nono) and
// (b) a plain-language access report. Both come from the same function so the UI can
// never drift from what is enforced.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Effect } from 'effect';
import type { AccessEntry, AccessReport, SandboxBackendId } from '#lib/types.ts';
import { DATA_DIR } from './config.ts';
import { FileSystemError, SandboxBlocked } from './errors.ts';
import { getHarness, which, type HarnessDefinition } from './harnesses';
import { compileNonoProfile, proxyHostPort } from './nono-policy.ts';
import { nonoPreflight, resolveBackend, type ResolvedBackend } from './sandbox-backends.ts';
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
	backend: SandboxBackendId;
	/** srt settings or a nono profile, depending on `backend`. */
	settings: Record<string, unknown>;
	report: AccessReport;
	/** Env vars to put in every sandboxed command (includes secret values; server only). */
	env: Record<string, string>;
	tmpDir: string;
	/** Folders to create before a run (nono can only grant paths that exist). */
	createDirs: string[];
}

/** A missing path whose name has an extension (~/.claude.json) is a file, not a folder to create. */
const looksLikeFile = (p: string) => /\.[A-Za-z0-9]+$/.test(path.basename(p).replace(/^\./, ''));

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

const realpath = (p: string) => {
	try {
		return fs.realpathSync(p);
	} catch {
		return null;
	}
};

/**
 * The real location of a path that may not exist yet: follow symlinks in the part that
 * exists, then add the rest back. Rules and grants are compared in this form, so a
 * symlinked workspace and a rule written against its target are seen as the same place.
 */
export function canonicalPath(p: string): string {
	const abs = path.resolve(p);
	const rest: string[] = [];
	let cur = abs;
	for (;;) {
		const real = realpath(cur);
		if (real) return rest.length ? path.join(real, ...rest.reverse()) : real;
		const parent = path.dirname(cur);
		if (parent === cur) return abs;
		rest.push(path.basename(cur));
		cur = parent;
	}
}

const isDir = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

/**
 * What an agent must be able to read to start at all under nono, where reads are an
 * allow-list: its own program files, the Node.js install it runs on, and the machine's
 * CA bundle when a corporate proxy is in use. Each grant is as narrow as it can be: a
 * program that does not sit in an install folder of its own is granted as a single file,
 * never as the folder around it (which could be ~/.local or ~/bin).
 */
function nonoReadNeeds(harness: HarnessDefinition): AccessEntry[] {
	const out: AccessEntry[] = [];
	const add = (value: string, note: string) => out.push({ value, source: 'runtime', note });
	const node = realpath(which('node') ?? process.execPath);
	if (node) {
		// <prefix>/bin/node with <prefix>/lib/node_modules next to it is a Node.js install folder.
		const prefix = path.dirname(path.dirname(node));
		const isPrefix = path.basename(path.dirname(node)) === 'bin' && isDir(path.join(prefix, 'lib', 'node_modules'));
		if (isPrefix && path.dirname(prefix) !== prefix) add(prefix, 'Node.js install (agents run on it)');
		else add(node, 'Node.js program');
	}
	const bin = which(harness.binary);
	const real = bin && realpath(bin);
	if (real) {
		const dir = path.dirname(real);
		// A program inside a "bin" folder shares it with unrelated files: grant only the program.
		if (path.basename(dir) === 'bin' || dir === os.homedir() || path.dirname(dir) === dir) add(real, `${harness.label} program`);
		else add(dir, `${harness.label} program files`);
	}
	for (const k of ['SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_DIR']) {
		const v = process.env[k];
		if (v) add(v, `CA certificates from ${k}`);
	}
	return out;
}

/**
 * Pure: the same environment and secrets always give the same settings and report.
 * (It does look at the disk to find policy files and installed binaries.)
 */
export function compilePolicy(
	env: StoredEnvironment,
	secrets: Record<string, string>,
	backend: ResolvedBackend = resolveBackend(env.sandbox ?? 'auto'),
	platform: NodeJS.Platform = os.platform(),
	/** Asks nono whether it accepts the profile. Replaced in tests. */
	preflight: (profile: Record<string, unknown>) => string | null = nonoPreflight
): CompiledPolicy {
	const harness = getHarness(env.harness);
	const warnings: string[] = [];
	const tmpDir = tmpDirFor(env.id);
	const workspace = workspacePath(env);
	const nono = backend.id === 'nono';
	const resolved = resolvePolicyFile(env);
	// Policy files are sandbox-runtime files. nono never reads them (see the check below).
	const file = nono ? null : resolved.active;
	const fromFile = !!file;
	const blocks: string[] = [];
	if (backend.unavailable) blocks.push(backend.unavailable);
	if (file && !file.validation.ok) {
		blocks.push(`Policy file ${file.path} is invalid, so the sandbox will not start:\n${file.validation.errors.join('\n')}`);
	}
	if (nono && (env.policyFile?.mode ?? 'auto') !== 'off') {
		// Refusing (rather than ignoring the file) keeps two promises: rules are never silently
		// replaced, and a file the agent plants in the workspace can never become the policy if
		// this environment later runs on sandbox-runtime.
		blocks.push(
			'Policy files are sandbox-runtime files and nono cannot use them. Set "Policy file" to Off to run this environment with nono.'
		);
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
		// With nono, policy files are never read, so there is nothing to protect.
		...(nono ? [] : protectedPolicyFiles(env))
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
	if (env.harness === 'opencode' && platform === 'linux' && !nono)
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
	const srtSettings = (): Record<string, unknown> => ({
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
	});

	// ---- nono profile ----
	const readOnly: AccessEntry[] = nono ? uniq(nonoReadNeeds(harness)) : [];
	let settings: Record<string, unknown>;
	if (nono) {
		const toAbs = (p: string) => canonicalPath(path.resolve(workspace, expandHome(p)));
		const proxy = proxyHostPort(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy);
		if (proxy.hasCredentials)
			warnings.push('This machine\'s proxy needs a username and password, which nono cannot pass on. Allowed domains may be unreachable.');
		const compiled = compileNonoProfile({
			name: `serebro-${env.id}`,
			platform,
			readWrite: readWrite.map((e) => e.value),
			readOnly: readOnly.map((e) => e.value),
			denyRead,
			denyWrite,
			allowRead: allowRead.map((e) => e.value),
			allowedDomains: allowed.map((e) => e.value),
			deniedDomains: denied.map((e) => e.value),
			localBinding,
			upstreamProxy: proxy.hostPort,
			maskedCredentials: masked.map((e) => e.value),
			resolve: toAbs,
			isFile: (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false
		});
		settings = compiled.profile;
		if (compiled.unenforceable.length)
			blocks.push(
				`nono cannot enforce ${compiled.unenforceable.length === 1 ? 'this rule' : 'these rules'}, so the sandbox will not start:\n${compiled.unenforceable.join('\n')}\nRemove the rule, or switch the environment to sandbox-runtime.`
			);
		else if (!blocks.length && platform === os.platform()) {
			// Serebro's own checks passed. nono has more (its protected folders, kernel support).
			const refused = preflight(compiled.profile);
			if (refused) blocks.push(`nono refuses this environment, so the sandbox will not start:\n${refused}`);
		}
		// nono can only grant paths that exist. Serebro creates the agent's folders before a run, nothing else.
		const absent = readWrite
			.filter((e) => e.source === 'you' || e.source === 'workspace')
			.map((e) => e.value)
			.filter((v) => !fs.existsSync(toAbs(v)));
		if (absent.length)
			warnings.push(
				`${absent.join(', ')} ${absent.length === 1 ? 'does' : 'do'} not exist. nono can only grant paths that exist, so the agent will not be able to create ${absent.length === 1 ? 'it' : 'them'}.`
			);
		const missing = agentWrites.map((e) => e.value).filter((v) => looksLikeFile(v) && !fs.existsSync(toAbs(v)));
		if (missing.length)
			warnings.push(
				`${missing.join(', ')} ${missing.length === 1 ? 'does' : 'do'} not exist yet, and nono cannot let the agent create ${missing.length === 1 ? 'it' : 'them'}. Run ${harness.label} once outside Serebro first.`
			);
	} else {
		settings = srtSettings();
	}
	const blocked = blocks.length ? blocks.join('\n\n') : null;

	const report: AccessReport = {
		sandbox: { id: backend.id, label: backend.label, reason: backend.reason },
		filesystem: {
			readWrite,
			readOnly,
			readOnlyNote: nono
				? 'Apart from these paths the agent can read only system folders (programs, libraries, certificates); the contents of your home folder and the rest of this machine are hidden, and writing, deleting or renaming anywhere else is blocked. nono does not hide other running programs (their names and command lines are visible, and their environment too when Serebro runs as root), and it does not stop permission changes (chmod) on files you own.'
				: 'Everything else on this machine is read-only, except the paths listed under "Cannot read". Writes anywhere else are blocked.',
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
		hash: hashText(backend.id + JSON.stringify(settings) + (blocked ?? '')),
		blocked,
		rawSettings: settings,
		warnings
	};

	const createDirs = nono
		? agentWrites.map((e) => path.resolve(workspace, expandHome(e.value))).filter((p) => !looksLikeFile(p))
		: [];
	return { backend: backend.id, settings, report, env: childEnv, tmpDir, createDirs };
}

/** Policy files are sandbox-runtime files, so a starter is always written in srt's terms. */
const SRT_FOR_STARTER: ResolvedBackend = { id: 'srt', label: 'sandbox-runtime (srt)', reason: '', unavailable: null };

/**
 * A policy file built from the environment form, as a starting point. Serebro's own
 * additions (temp folder, data folder, agent paths) are left out: they are added at run time.
 */
export function starterPolicy(env: StoredEnvironment): string {
	const formEnv: StoredEnvironment = { ...env, policyFile: { ...env.policyFile, mode: 'off' } };
	const { report } = compilePolicy(formEnv, {}, SRT_FOR_STARTER);
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
 * Compile the policy, refuse to continue if it is blocked, and write the sandbox's settings
 * file. Returns the compiled policy and the settings file path.
 */
export const prepareSandbox = Effect.fn('prepareSandbox')(function* (env: StoredEnvironment) {
	const store = yield* Store;
	const compiled = yield* compileFor(env);
	if (compiled.report.blocked) return yield* new SandboxBlocked({ message: compiled.report.blocked });
	const sandboxDir = yield* store.sandboxDir(env.id);
	const settingsFile = path.join(sandboxDir, compiled.backend === 'nono' ? 'nono-profile.json' : 'srt-settings.json');
	// nono writes a small record per command. Keep them with the environment, and only the recent ones.
	const stateDir = compiled.backend === 'nono' ? path.join(sandboxDir, 'nono-state') : undefined;
	if (stateDir) yield* Effect.sync(() => pruneOlderThan(path.join(stateDir, 'nono', 'sessions'), 24 * 60 * 60 * 1000));
	yield* Effect.tryPromise({
		try: () => fs.promises.writeFile(settingsFile, JSON.stringify(compiled.settings, null, 2), { mode: 0o600 }),
		catch: (cause) => new FileSystemError({ op: 'write', path: settingsFile, cause })
	});
	// sandbox-runtime always allows writes to /tmp/claude but only binds it if it exists.
	const dirs: Array<readonly [string, number | undefined]> = [
		[compiled.tmpDir, 0o700],
		...(compiled.backend === 'srt' ? [['/tmp/claude', undefined] as const] : []),
		...compiled.createDirs.map((d) => [d, 0o700] as const)
	];
	for (const [dir, mode] of dirs) {
		yield* Effect.tryPromise({
			try: () => fs.promises.mkdir(dir, { recursive: true, mode }),
			catch: (cause) => new FileSystemError({ op: 'mkdir', path: dir, cause })
		});
	}
	return { compiled, settingsFile, stateDir };
});

/** Best effort: delete files in `dir` last changed more than `ms` ago. */
function pruneOlderThan(dir: string, ms: number) {
	try {
		for (const name of fs.readdirSync(dir)) {
			const file = path.join(dir, name);
			if (Date.now() - fs.statSync(file).mtimeMs > ms) fs.rmSync(file, { recursive: true, force: true });
		}
	} catch {
		// Nothing recorded yet.
	}
}
