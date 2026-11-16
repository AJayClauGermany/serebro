// Checks that this machine can run a sandbox, in words a non-expert can act on.

import os from 'node:os';
import type { SystemCheck, SystemStatus } from '#lib/types.ts';
import { listHarnesses } from './harnesses';
import { DATA_DIR } from './config.ts';
import { sandboxBackends } from './sandbox-backends.ts';

export function systemStatus(): SystemStatus {
	const [major] = process.versions.node.split('.').map(Number);
	const node: SystemCheck = {
		name: 'Node.js 20+',
		ok: major >= 20,
		detail: `Node ${process.versions.node}`,
		fix: 'Install Node.js 20 or newer'
	};
	const sandboxes = sandboxBackends();
	// One working sandbox is enough. Show the checks of the one `auto` uses.
	const preferred = sandboxes.find((b) => b.preferred)!;
	const checks = [node, ...preferred.checks];
	return {
		platform: os.platform(),
		ready: checks.every((c) => c.ok),
		checks,
		sandboxes,
		harnesses: listHarnesses(),
		dataDir: DATA_DIR
	};
}
