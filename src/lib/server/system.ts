// Checks that this machine can run the sandbox, in words a non-expert can act on.

import os from 'node:os';
import type { EnvironmentInput, SystemCheck, SystemStatus } from '#lib/types.ts';
import { isHarnessId, listHarnesses, which } from './harnesses';
import { DATA_DIR } from './store';

export function systemStatus(): SystemStatus {
	const platform = os.platform();
	const checks: SystemCheck[] = [];
	const [major] = process.versions.node.split('.').map(Number);
	checks.push({
		name: 'Node.js 20+',
		ok: major >= 20,
		detail: `Node ${process.versions.node}`,
		fix: 'Install Node.js 20 or newer'
	});

	if (platform === 'linux') {
		for (const [bin, pkg, why] of [
			['bwrap', 'bubblewrap', 'filesystem and process isolation'],
			['socat', 'socat', 'network proxy bridge'],
			['rg', 'ripgrep', 'scanning for protected files']
		] as const) {
			const at = which(bin);
			checks.push({
				name: `${bin} (${why})`,
				ok: !!at,
				detail: at ?? 'not found',
				fix: `sudo apt-get install ${pkg}   # or your distro's equivalent`
			});
		}
	} else if (platform === 'darwin') {
		const at = which('sandbox-exec');
		checks.push({ name: 'sandbox-exec (Seatbelt)', ok: !!at, detail: at ?? 'not found', fix: 'Built into macOS' });
		const rg = which('rg');
		checks.push({ name: 'rg (ripgrep)', ok: !!rg, detail: rg ?? 'not found', fix: 'brew install ripgrep' });
	} else {
		checks.push({
			name: 'Supported platform',
			ok: false,
			detail: platform,
			fix: 'Serebro currently supports Linux and macOS (sandbox-runtime Windows support is alpha).'
		});
	}

	const harnesses = listHarnesses();
	return {
		platform,
		ready: checks.every((c) => c.ok),
		checks,
		harnesses,
		dataDir: DATA_DIR
	};
}

const list = (v: unknown) =>
	Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/** Validate and normalise an environment from the browser. Throws a readable message. */
export function parseEnvironmentInput(body: unknown): EnvironmentInput {
	const b = (body ?? {}) as Record<string, any>;
	const name = String(b.name ?? '').trim();
	const workspace = String(b.workspace ?? '').trim();
	if (!name) throw new Error('Name is required');
	if (!workspace) throw new Error('Workspace folder is required');
	if (!workspace.startsWith('/') && !workspace.startsWith('~')) throw new Error('Workspace must be an absolute path (or start with ~)');
	if (!isHarnessId(b.harness)) throw new Error('Pick a coding agent');
	if (b.policyFile?.mode === 'custom' && !String(b.policyFile?.path ?? '').trim())
		throw new Error('Enter the path of the custom policy file');
	const fsIn = b.filesystem ?? {};
	const net = b.network ?? {};
	const credentials = (Array.isArray(b.credentials) ? b.credentials : []).map((c: any) => {
		const n = String(c?.name ?? '').trim();
		if (n && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error(`"${n}" is not a valid environment variable name`);
		return {
			name: n,
			mode: c?.mode === 'masked' ? ('masked' as const) : ('direct' as const),
			injectHosts: list(c?.injectHosts),
			value: typeof c?.value === 'string' ? c.value : undefined
		};
	});
	return {
		name,
		workspace,
		harness: b.harness,
		model: String(b.model ?? '').trim() || 'default',
		filesystem: {
			readWrite: list(fsIn.readWrite),
			denyRead: list(fsIn.denyRead),
			allowRead: list(fsIn.allowRead),
			denyWrite: list(fsIn.denyWrite)
		},
		network: {
			allowedDomains: list(net.allowedDomains),
			deniedDomains: list(net.deniedDomains),
			packageManagers: !!net.packageManagers,
			harnessDefaults: net.harnessDefaults !== false,
			allowLocalBinding: !!net.allowLocalBinding
		},
		policyFile: {
			mode: ['auto', 'custom', 'off'].includes(b.policyFile?.mode) ? b.policyFile.mode : 'auto',
			path: String(b.policyFile?.path ?? '').trim(),
			addAgentNeeds: b.policyFile?.addAgentNeeds !== false
		},
		credentials
	};
}
