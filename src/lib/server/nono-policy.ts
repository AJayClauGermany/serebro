// Turns Serebro's rules into a nono profile (https://github.com/nolabs-ai/nono).
//
// nono's model differs from sandbox-runtime in two ways that matter here:
//
//   1. Reads are an allow-list. The agent can read system folders and the paths granted
//      below, and nothing else. (srt lets it read everything except a deny-list.)
//   2. On Linux nono uses Landlock, which can only grant. It cannot hide or protect a
//      path inside a folder the agent was given. On macOS (Seatbelt) it can hide one,
//      but it still cannot make one read-only.
//
// A rule nono cannot enforce is never dropped: it is returned in `unenforceable`, and
// the environment is blocked until the rule or the sandbox is changed.

import path from 'node:path';
import type { AccessEntry } from '#lib/types.ts';

export interface NonoPolicyInput {
	name: string;
	platform: NodeJS.Platform;
	/** Folders and files the agent may read and write. */
	readWrite: string[];
	/** Paths the agent may read but not write. */
	readOnly: string[];
	/** "Cannot read" rules. */
	denyRead: AccessEntry[];
	/** "Never writable" rules. */
	denyWrite: AccessEntry[];
	/** Read grants that sit inside a denied region. */
	allowRead: string[];
	allowedDomains: string[];
	deniedDomains: string[];
	localBinding: boolean;
	/** `host:port` of the machine's own HTTP proxy, when it has one. */
	upstreamProxy?: string;
	/** Names of credentials the environment wants masked. */
	maskedCredentials: string[];
	/**
	 * The real location of a path: expands `~`, resolves against the workspace and follows
	 * symlinks. Rules and grants are compared by this, so two spellings of one place match.
	 */
	resolve: (p: string) => string;
	/** True for an existing regular file. nono grants files and folders with different keys. */
	isFile: (p: string) => boolean;
}

export interface NonoPolicy {
	profile: Record<string, unknown>;
	/** Rules this sandbox cannot enforce. Any entry here blocks the environment. */
	unenforceable: string[];
}

/** Device files a normal command line needs to write. Replaces nono's default group, which also opens the shared /tmp. */
const LINUX_DEVICE_FILES = ['/dev/null', '/dev/zero', '/dev/full', '/dev/tty'];
const LINUX_DEVICE_DIRS = ['/dev/pts', '/dev/fd', '/proc/self/fd'];

export const isInside = (child: string, parent: string) =>
	child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

const uniq = (list: string[]) => [...new Set(list)];

export function compileNonoProfile(input: NonoPolicyInput): NonoPolicy {
	const { platform, resolve, isFile } = input;
	const linux = platform === 'linux';
	const unenforceable: string[] = [];

	const readWrite = uniq(input.readWrite.map(resolve));
	const allowRead = uniq(input.allowRead.map(resolve));
	const readOnly = uniq(input.readOnly.map(resolve));
	const granted = [...readWrite, ...readOnly, ...allowRead];

	// ---- cannot read ----
	const deny: string[] = [];
	for (const e of input.denyRead) {
		const p = resolve(e.value);
		const parent = granted.find((g) => isInside(p, g));
		if (parent && linux) {
			unenforceable.push(
				`"${e.value}" cannot be hidden: it is inside ${parent}, which the agent may read. On Linux nono can only grant whole folders.`
			);
			continue;
		}
		// A grant below the hidden path would stay readable on Linux. Re-allowed paths are meant to.
		const child = [...readWrite, ...readOnly].find((g) => g !== p && isInside(g, p));
		if (child && linux) {
			unenforceable.push(`"${e.value}" cannot be hidden: ${child} is inside it and the agent may read that. On Linux nono cannot hide around a grant.`);
			continue;
		}
		// Outside every grant the path is unreadable anyway; the explicit deny also covers nono's own defaults.
		deny.push(p);
	}

	// ---- never writable ----
	for (const e of input.denyWrite) {
		const p = resolve(e.value);
		const parent = readWrite.find((g) => isInside(p, g));
		const child = readWrite.find((g) => isInside(g, p));
		if (parent) {
			unenforceable.push(`"${e.value}" cannot be made read-only: it is inside ${parent}, which the agent may write. nono has no write-only block.`);
		} else if (child) {
			unenforceable.push(`"${e.value}" cannot be made read-only: ${child} is inside it and the agent may write that. nono has no write-only block.`);
		}
		// Otherwise nothing in or around it is writable: writes are an allow-list.
	}

	// ---- credentials ----
	for (const name of input.maskedCredentials) {
		unenforceable.push(
			`${name} cannot be masked: Serebro does not support credential masking with nono yet. Use sandbox-runtime, or switch the credential to direct.`
		);
	}

	// ---- local ports ----
	// nono's port grants mean the *machine's* localhost: the agent could call every local
	// service, including Serebro's own API. Only a private network namespace (Linux) gives
	// the agent a loopback of its own, which is what srt does.
	if (input.localBinding && !linux) {
		unenforceable.push(
			'Local ports cannot be opened: on macOS nono can only open this machine\'s own localhost, which would let the agent reach other local services. Turn local ports off, or use sandbox-runtime.'
		);
	}

	const files = (list: string[]) => list.filter(isFile);
	const dirs = (list: string[]) => list.filter((p) => !isFile(p));
	const hasNetwork = input.allowedDomains.length > 0;
	const reads = uniq([...readOnly, ...allowRead]);

	const profile: Record<string, unknown> = {
		extends: 'default',
		meta: { name: input.name, description: 'Generated by Serebro. Do not edit: it is rewritten before every run.' },
		// git_config: read-only access to the user's git settings, so commits carry the right name.
		// nono's default write groups open the shared temp folders. The agent gets a private one instead.
		groups: { include: ['git_config'], exclude: ['system_write_linux', 'system_write_macos'] },
		// Nothing is granted because of where a command happens to start.
		workdir: { access: 'none' },
		filesystem: {
			allow: [...dirs(readWrite), ...(linux ? LINUX_DEVICE_DIRS : ['/dev'])],
			allow_file: [...files(readWrite), ...(linux ? LINUX_DEVICE_FILES : [])],
			read: dirs(reads),
			read_file: files(reads),
			deny,
			// Lets a re-allowed path through when it sits inside one of nono's built-in deny groups.
			bypass_protection: allowRead
		},
		network: hasNetwork
			? {
					allow_domain: input.allowedDomains,
					deny_domain: input.deniedDomains,
					...(input.upstreamProxy ? { upstream_proxy: input.upstreamProxy } : {})
				}
			: { block: true },
		// nono keeps its own session records under XDG_STATE_HOME, which Serebro points at its data
		// folder for the launcher. The agent must not inherit that.
		environment: { deny_vars: ['XDG_STATE_HOME'] },
		// A network namespace with its own loopback. Needs user namespaces; nono refuses to start without them.
		...(input.localBinding && linux ? { linux: { isolate: { network: true, loopback: true } } } : {})
	};

	return { profile, unenforceable };
}

/** `host:port` from a proxy URL such as http://user:pass@proxy:3128. */
export function proxyHostPort(url: string | undefined): { hostPort?: string; hasCredentials: boolean } {
	if (!url) return { hasCredentials: false };
	try {
		const u = new URL(url.includes('://') ? url : `http://${url}`);
		const port = u.port || (u.protocol === 'https:' ? '443' : '80');
		return { hostPort: `${u.hostname}:${port}`, hasCredentials: !!(u.username || u.password) };
	} catch {
		return { hasCredentials: false };
	}
}
