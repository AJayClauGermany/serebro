// A TanStack AI sandbox provider backed by a local sandbox: Anthropic's sandbox-runtime
// (srt) or nono.
//
// It reuses the local-process handle (real host folder, real process tree) and wraps
// every command the harness runs in the sandbox's launcher (see `wrapCommand`). The
// sandbox applies the filesystem and network rules and routes traffic through its
// filtering proxy.
//
// File reads and writes that TanStack AI itself makes through `handle.fs` (for example
// writing a harness config file) run in this trusted server process, not in the sandbox.

import path from 'node:path';
import type {
	ProcessOptions,
	SandboxCapabilities,
	SandboxHandle,
	SandboxProvider
} from '@tanstack/ai-sandbox';
import { localProcessSandbox } from '@tanstack/ai-sandbox-local-process';
import { wrapCommand, type WrapTarget } from './sandbox-backends.ts';

/**
 * Host env vars the sandbox itself needs. srt routes allowed traffic through an upstream
 * proxy when one is set (corporate networks); for nono the same proxy is written into its
 * profile. Inside the sandbox these are replaced with the sandbox's own filtering proxy,
 * so the agent never talks to the upstream proxy directly.
 */
export const PROXY_ENV = [
	'HTTPS_PROXY',
	'HTTP_PROXY',
	'NO_PROXY',
	'https_proxy',
	'http_proxy',
	'no_proxy',
	'SSL_CERT_FILE',
	'NODE_EXTRA_CA_CERTS'
];

export function proxyEnv(): Record<string, string> {
	return Object.fromEntries(PROXY_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])));
}

export interface LocalSandboxConfig extends WrapTarget {
	/** Host folder the agent works in. */
	workspace: string;
	/** Env vars for every command (credentials, TMPDIR, harness flags). */
	env: Record<string, string>;
	/** Called with each wrapped command, for the activity log. */
	onCommand?: (command: string) => void;
}

const CAPS: SandboxCapabilities = {
	fs: true,
	exec: true,
	env: true,
	ports: true,
	backgroundProcesses: true,
	writableStdin: true,
	killableProcesses: true,
	snapshots: false,
	networkPolicy: true,
	durableFilesystem: true,
	fork: false
};

function wrapHandle(inner: SandboxHandle, config: LocalSandboxConfig): SandboxHandle {
	const wrap = (command: string, options?: ProcessOptions): [string, ProcessOptions] => {
		config.onCommand?.(command);
		return [wrapCommand(config, command), { ...options, env: { ...config.env, ...options?.env } }];
	};
	return {
		id: inner.id,
		provider: config.backend,
		workspaceRoot: path.resolve(config.workspace),
		capabilities: CAPS,
		fs: inner.fs,
		git: inner.git,
		ports: inner.ports,
		env: inner.env,
		process: {
			exec: (command, options) => inner.process.exec(...wrap(command, options)),
			spawn: (command, options) => inner.process.spawn(...wrap(command, options))
		},
		destroy: () => inner.destroy()
	};
}

export function localSandbox(config: LocalSandboxConfig): SandboxProvider {
	const local = localProcessSandbox({
		dir: config.workspace,
		removeOnDestroy: false,
		// Lets Node-based agents and git find the user's toolchain config without exposing secrets.
		passEnv: ['USER', 'SHELL', 'TERM', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', ...PROXY_ENV]
	});
	return {
		name: config.backend,
		capabilities: () => CAPS,
		create: async (input) => wrapHandle(await local.create(input), config),
		resume: async (input) => {
			const h = await local.resume(input);
			return h ? wrapHandle(h, config) : null;
		},
		destroy: (input) => local.destroy(input)
	};
}
