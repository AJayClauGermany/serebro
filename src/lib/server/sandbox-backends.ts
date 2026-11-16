// The sandboxes Serebro can run an agent in, and how one is picked for an environment.
//
// srt is preferred wherever it can run. nono is the alternative for machines where srt's
// tools are missing or cannot work (for example containers without user namespaces).
// A sandbox that was asked for by name is never swapped for another one: if it cannot
// run, the environment is blocked.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Option } from 'effect';
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
		return (
			[
				['bwrap', 'bubblewrap', 'filesystem and process isolation'],
				['socat', 'socat', 'network proxy bridge'],
				['rg', 'ripgrep', 'scanning for protected files']
			] as const
		).map(([bin, pkg, why]) => tool(bin, why, `sudo apt-get install ${pkg}   # or your distro's equivalent`));
	}
	if (platform === 'darwin') {
		return [tool('sandbox-exec', 'Seatbelt', 'Built into macOS'), tool('rg', 'ripgrep', 'brew install ripgrep')];
	}
	return [{ name: 'Supported platform', ok: false, detail: platform, fix: 'sandbox-runtime supports Linux and macOS.' }];
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
	const list = (
		[
			['srt', srtChecks(platform)],
			['nono', nonoChecks(platform)]
		] as const
	).map(([id, checks]) => ({ id, label: BACKEND_LABEL[id], available: checks.every((c) => c.ok), preferred: false, checks }));
	// srt first; nono only when srt cannot run. With neither, srt's missing tools are what we show.
	(list.find((b) => b.available) ?? list[0]).preferred = true;
	cache = { at: Date.now(), value: list };
	return list;
}

export interface ResolvedBackend {
	id: SandboxBackendId;
	label: string;
	reason: string;
	/** Set when the sandbox cannot run on this machine. */
	unavailable: string | null;
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
				: 'automatic: sandbox-runtime cannot run on this machine';
	return {
		id: picked.id,
		label: picked.label,
		reason,
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

const preflightCache = new Map<string, string | null>();

/**
 * Ask nono itself whether it accepts a profile, by starting a sandbox that runs nothing.
 * nono has checks Serebro does not repeat (its own protected folders, kernel support for
 * what the profile asks). Running it here puts a refusal in the access panel instead of in
 * the middle of a chat. Returns nono's message, or null when the profile starts.
 */
export function nonoPreflight(profile: Record<string, unknown>): string | null {
	const bin = nonoBinary();
	if (!bin) return null; // Reported as "cannot run on this machine" by the caller.
	const text = JSON.stringify(profile);
	const cached = preflightCache.get(text);
	if (cached !== undefined) return cached;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serebro-nono-'));
	let result: string | null;
	try {
		const file = path.join(dir, 'profile.json');
		fs.writeFileSync(file, text, { mode: 0o600 });
		const r = spawnSync('/bin/sh', ['-c', `${nonoLauncher(bin, file, path.join(dir, 'state'))} /bin/sh -c true`], {
			cwd: dir,
			encoding: 'utf8',
			timeout: 15000,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { PATH: process.env.PATH ?? '', HOME: os.homedir() }
		});
		result = r.status === 0 ? null : (`${r.stdout}${r.stderr}`.trim().slice(-1500) || `nono did not start (${r.error?.message ?? `exit ${r.status}`})`);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	if (preflightCache.size > 200) preflightCache.clear();
	preflightCache.set(text, result);
	return result;
}
