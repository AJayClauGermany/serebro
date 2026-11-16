// The sandboxes Serebro can run an agent in, and how one is picked for an environment.
//
// srt is preferred wherever it can run. nono is the alternative for machines where srt's
// tools are missing or cannot work (for example containers without user namespaces).
// A sandbox that was asked for by name is never swapped for another one: if it cannot
// run, the environment is blocked.

import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Effect, Option } from 'effect';
import type { SandboxBackendId, SandboxBackendInfo, SandboxChoice, SystemCheck } from '#lib/types.ts';
import { serverConfig } from './config.ts';
import { which } from './harnesses.ts';

const require = createRequire(import.meta.url);

export const BACKEND_LABEL: Record<SandboxBackendId, string> = {
	srt: 'sandbox-runtime (srt)',
	nono: 'nono'
};

export function shellQuote(s: string) {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function srtBinary(): string {
	if (Option.isSome(serverConfig.srtBin)) return serverConfig.srtBin.value;
	const pkg = require.resolve('@anthropic-ai/sandbox-runtime/package.json');
	return path.join(path.dirname(pkg), 'dist', 'cli.js');
}

let nonoBin: { at: number; value: string | null } | null = null;

/** Where nono is. Cached briefly: every wrapped command asks, and `which` starts a process. */
export function nonoBinary(): string | null {
	if (Option.isSome(serverConfig.nonoBin)) return serverConfig.nonoBin.value;
	if (!nonoBin || Date.now() - nonoBin.at > 5000) nonoBin = { at: Date.now(), value: which('nono') };
	return nonoBin.value;
}

function srtChecks(platform: NodeJS.Platform): SystemCheck[] {
	const tool = (bin: string, why: string, fix: string): SystemCheck => {
		const at = which(bin);
		return { name: `${bin} (${why})`, ok: !!at, detail: at ?? 'not found', fix };
	};
	if (platform === 'linux') {
		const tools = (
			[
				['bwrap', 'bubblewrap', 'filesystem and process isolation'],
				['socat', 'socat', 'network proxy bridge'],
				['rg', 'ripgrep', 'scanning for protected files']
			] as const
		).map(([bin, pkg, why]) => tool(bin, why, `sudo apt-get install ${pkg}   # or your distro's equivalent`));
		// Installed is not the same as working: in a container without user namespaces bubblewrap
		// is on PATH and fails on every command.
		const bwrap = tools[0];
		if (bwrap.ok) {
			const refusal = bwrapRefusal(bwrap.detail, false);
			tools.push({
				name: 'bubblewrap can start a sandbox',
				ok: refusal === null,
				detail: refusal ?? 'yes',
				fix: 'Allow unprivileged user namespaces on this machine, or install nono and use that'
			});
		}
		return tools;
	}
	if (platform === 'darwin') {
		return [tool('sandbox-exec', 'Seatbelt', 'Built into macOS'), tool('rg', 'ripgrep', 'brew install ripgrep')];
	}
	return [{ name: 'Supported platform', ok: false, detail: platform, fix: 'sandbox-runtime supports Linux and macOS.' }];
}

const bwrapProbes = new Map<string, { at: number; refusal: string | null }>();

/**
 * Start an empty bubblewrap sandbox and return its complaint, or null when it works. Asked
 * once a minute. Without `withProc` this is the least sandbox-runtime ever asks for (its own
 * network and process namespaces). With it, a fresh /proc is mounted too, which srt does
 * unless a policy file sets `enableWeakerNestedSandbox`, and which unprivileged containers refuse.
 */
function bwrapRefusal(bwrap: string, withProc: boolean): string | null {
	const key = `${bwrap}\n${withProc}`;
	const cached = bwrapProbes.get(key);
	if (cached && Date.now() - cached.at < 60_000) return cached.refusal;
	const args = ['--unshare-net', '--unshare-pid', '--dev-bind', '/', '/', ...(withProc ? ['--proc', '/proc'] : []), 'true'];
	const r = spawnSync(bwrap, args, { timeout: 3000, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
	const refusal =
		r.error === undefined && r.status === 0
			? null
			: (r.stderr ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) || r.error?.message || `exit ${r.status}`;
	bwrapProbes.set(key, { at: Date.now(), refusal });
	return refusal;
}

/** Why sandbox-runtime only works in a reduced form here, if it does. */
function srtLimit(platform: NodeJS.Platform, checks: SystemCheck[]): string | undefined {
	if (platform !== 'linux' || !checks.every((c) => c.ok)) return undefined;
	const refusal = bwrapRefusal(checks[0].detail, true);
	return refusal === null
		? undefined
		: `bubblewrap cannot mount /proc on this machine (${refusal}). sandbox-runtime only works here with a policy file that sets enableWeakerNestedSandbox.`;
}

function nonoChecks(platform: NodeJS.Platform): SystemCheck[] {
	if (platform !== 'linux' && platform !== 'darwin') {
		return [{ name: 'Supported platform', ok: false, detail: platform, fix: 'nono supports Linux, macOS and WSL2.' }];
	}
	const at = nonoBinary();
	return [
		{
			name: 'nono (Landlock or Seatbelt sandbox)',
			ok: !!at,
			detail: at ?? 'not found',
			fix: 'brew install nono   # or see https://nono.sh/docs/cli/getting_started/installation, or set SEREBRO_NONO_BIN'
		}
	];
}

let cache: { at: number; value: SandboxBackendInfo[] } | null = null;

/** What each sandbox needs and whether it is installed. Cached briefly: it shells out to `which`. */
export function sandboxBackends(): SandboxBackendInfo[] {
	if (cache && Date.now() - cache.at < 5000) return cache.value;
	const platform = os.platform();
	const srt = srtChecks(platform);
	const list: SandboxBackendInfo[] = (
		[
			['srt', srt, srtLimit(platform, srt)],
			['nono', nonoChecks(platform), undefined]
		] as const
	).map(([id, checks, limited]) => ({
		id,
		label: BACKEND_LABEL[id],
		available: checks.every((c) => c.ok),
		preferred: false,
		...(limited ? { limited } : {}),
		checks: [...checks]
	}));
	preferBackend(list);
	cache = { at: Date.now(), value: list };
	return list;
}

/**
 * Mark the sandbox `auto` uses: srt first; nono when srt cannot run, or runs only in a
 * reduced form. With neither, srt's missing tools are what we show.
 */
export function preferBackend(list: SandboxBackendInfo[]) {
	for (const b of list) b.preferred = false;
	const usable = list.filter((b) => b.available);
	(usable.find((b) => !b.limited) ?? usable[0] ?? list[0]).preferred = true;
}

export interface ResolvedBackend {
	id: SandboxBackendId;
	label: string;
	reason: string;
	/** Set when the sandbox cannot run on this machine. */
	unavailable: string | null;
	/** Set when the sandbox runs only in a reduced form here. Shown as a warning. */
	limited?: string;
}

/** Pure: pick the sandbox for a choice, given what is installed. */
export function pickBackend(choice: SandboxChoice, backends: SandboxBackendInfo[]): ResolvedBackend {
	const picked = choice === 'auto' ? backends.find((b) => b.preferred)! : backends.find((b) => b.id === choice)!;
	const missing = picked.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}${c.fix ? ` (${c.fix})` : ''}`);
	const reason =
		choice !== 'auto'
			? 'chosen for this environment'
			: picked.id === 'srt'
				? 'automatic: sandbox-runtime is preferred'
				: backends.find((b) => b.id === 'srt')?.limited
					? 'automatic: sandbox-runtime cannot fully run on this machine'
					: 'automatic: sandbox-runtime cannot run on this machine';
	return {
		id: picked.id,
		label: picked.label,
		reason,
		...(picked.limited ? { limited: picked.limited } : {}),
		unavailable: picked.available ? null : `${picked.label} cannot run on this machine, so the sandbox will not start:\n${missing.join('\n')}`
	};
}

export const resolveBackend = (choice: SandboxChoice) => pickBackend(choice, sandboxBackends());

/** Which sandbox to launch and the settings file it reads. */
export interface WrapTarget {
	backend: SandboxBackendId;
	settingsFile: string;
	/** Where nono keeps its per-command session records, so they stay out of the user's home folder. */
	stateDir?: string;
}

/** The nono launcher, up to (not including) the command to run. */
function nonoLauncher(bin: string, profile: string, stateDir?: string) {
	// --silent: no banner and no prompts (nothing here is interactive).
	// No --allow-cwd: the profile grants the workspace by path, never by where a command starts.
	// Audit and rollback are nono's own session records; Serebro keeps the transcript.
	// XDG_STATE_HOME is for nono itself; the profile removes it from the agent's environment.
	const state = stateDir ? `env XDG_STATE_HOME=${shellQuote(stateDir)} ` : '';
	return `${state}${shellQuote(bin)} --silent run --no-audit --no-rollback --profile ${shellQuote(profile)} --`;
}

/** The shell command that runs `command` inside the sandbox. */
export function wrapCommand(target: WrapTarget, command: string, bin: string | null = nonoBinary()) {
	if (target.backend === 'nono') {
		// Unreachable in practice: an unavailable sandbox blocks the environment before any command is built.
		if (!bin) throw new Error('nono is not installed');
		return `${nonoLauncher(bin, target.settingsFile, target.stateDir)} /bin/sh -c ${shellQuote(command)}`;
	}
	return `${shellQuote(process.execPath)} ${shellQuote(srtBinary())} --settings ${shellQuote(target.settingsFile)} -c ${shellQuote(command)}`;
}

interface Preflight {
	at: number;
	result: Promise<string | null>;
	failed?: boolean;
}
const preflights = new Map<string, Preflight>();
/** A pass is trusted for a while. A refusal can depend on the machine, so it is asked again soon. */
const PREFLIGHT_OK_MS = 5 * 60 * 1000;
const PREFLIGHT_REFUSED_MS = 15 * 1000;

/** Exported for tests. */
export async function runPreflight(bin: string, text: string): Promise<string | null> {
	let dir: string | undefined;
	try {
		dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'serebro-nono-'));
		const file = path.join(dir, 'profile.json');
		await fs.promises.writeFile(file, text, { mode: 0o600 });
		const command = `${nonoLauncher(bin, file, path.join(dir, 'state'))} /bin/sh -c true`;
		return await new Promise<string | null>((resolve) => {
			execFile(
				'/bin/sh',
				['-c', command],
				{ cwd: dir, timeout: 15000, env: { PATH: process.env.PATH ?? '', HOME: os.homedir() } },
				(err, stdout, stderr) => {
					if (!err) return resolve(null);
					resolve(`${stdout}${stderr}`.trim().slice(-1500) || `nono did not start (${err.message})`);
				}
			);
		});
	} catch (e) {
		// A problem of the check itself (no temp folder, no shell) is a refusal like any other:
		// it blocks this environment, expires quickly, and never takes a page down.
		return `nono could not be checked: ${e instanceof Error ? e.message : String(e)}`;
	} finally {
		if (dir) await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * Ask nono itself whether it accepts a profile, by starting a sandbox that runs nothing.
 * nono has checks Serebro does not repeat (its own protected folders, kernel support for
 * what the profile asks). Running it here puts a refusal in the access panel instead of in
 * the middle of a chat. Succeeds with nono's message, or null when the profile starts.
 * Never blocks the server: only the request that needs the answer waits for it.
 */
export const nonoPreflight = (profile: Record<string, unknown>): Effect.Effect<string | null> =>
	Effect.promise(async () => {
		const bin = nonoBinary();
		if (!bin) return null; // Reported as "cannot run on this machine" by the caller.
		const key = `${bin}\n${JSON.stringify(profile)}`;
		const cached = preflights.get(key);
		if (cached && Date.now() - cached.at < (cached.failed ? PREFLIGHT_REFUSED_MS : PREFLIGHT_OK_MS)) return cached.result;
		if (preflights.size > 200) preflights.clear();
		const entry: Preflight = { at: Date.now(), result: runPreflight(bin, JSON.stringify(profile)) };
		preflights.set(key, entry);
		const result = await entry.result;
		entry.failed = result !== null;
		return result;
	});
