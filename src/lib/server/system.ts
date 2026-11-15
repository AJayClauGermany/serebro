// Checks that this machine can run the sandbox, in words a non-expert can act on.

import os from 'node:os';
import type { SystemCheck, SystemStatus } from '#lib/types.ts';
import { listHarnesses, which } from './harnesses';
import { DATA_DIR } from './config.ts';

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
