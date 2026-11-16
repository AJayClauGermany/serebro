import { describe, expect, it } from 'vitest';
import type { SandboxBackendInfo } from '#lib/types.ts';
import { pickBackend, wrapCommand } from './sandbox-backends.ts';

const backends = (srt: boolean, nono: boolean): SandboxBackendInfo[] => {
	const list = [
		{ id: 'srt' as const, label: 'sandbox-runtime (srt)', available: srt, preferred: false, checks: [{ name: 'bwrap', ok: srt, detail: srt ? '/usr/bin/bwrap' : 'not found' }] },
		{ id: 'nono' as const, label: 'nono', available: nono, preferred: false, checks: [{ name: 'nono', ok: nono, detail: nono ? '/usr/bin/nono' : 'not found' }] }
	];
	(list.find((b) => b.available) ?? list[0]).preferred = true;
	return list;
};

describe('pickBackend', () => {
	it('prefers sandbox-runtime when both can run', () => {
		expect(pickBackend('auto', backends(true, true))).toMatchObject({ id: 'srt', unavailable: null });
	});

	it('uses nono automatically only when sandbox-runtime cannot run', () => {
		expect(pickBackend('auto', backends(false, true))).toMatchObject({ id: 'nono', unavailable: null });
	});

	it('never swaps a sandbox that was asked for by name', () => {
		const r = pickBackend('srt', backends(false, true));
		expect(r.id).toBe('srt');
		expect(r.unavailable).toMatch(/cannot run on this machine[\s\S]*bwrap/);
		expect(pickBackend('nono', backends(true, false)).unavailable).toMatch(/nono cannot run/);
	});

	it('blocks when nothing can run', () => {
		expect(pickBackend('auto', backends(false, false))).toMatchObject({ id: 'srt' });
		expect(pickBackend('auto', backends(false, false)).unavailable).not.toBeNull();
	});
});

describe('wrapCommand', () => {
	it('quotes the command for sandbox-runtime', () => {
		const out = wrapCommand({ backend: 'srt', settingsFile: '/data/s.json' }, "echo 'hi'");
		expect(out).toContain(`--settings '/data/s.json' -c 'echo '\\''hi'\\'''`);
	});

	it('quotes the binary, profile, state folder and command for nono', () => {
		const out = wrapCommand(
			{ backend: 'nono', settingsFile: "/data dir/pro'file.json", stateDir: '/data dir/state' },
			'echo "$(id)" `x`',
			"/opt/no'no $(touch PWNED)"
		);
		expect(out).toBe(
			`env XDG_STATE_HOME='/data dir/state' '/opt/no'\\''no $(touch PWNED)' --silent run --no-audit --no-rollback --profile '/data dir/pro'\\''file.json' -- /bin/sh -c 'echo "$(id)" \`x\`'`
		);
	});

	it('refuses to build a nono command when nono is missing', () => {
		expect(() => wrapCommand({ backend: 'nono', settingsFile: '/p.json' }, 'true', null)).toThrow(/not installed/);
	});
});
