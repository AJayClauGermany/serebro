import { describe, expect, it } from 'vitest';
import { compilePolicy } from './policy.ts';
import type { ResolvedBackend } from './sandbox-backends.ts';
import type { StoredEnvironment } from './schemas.ts';

const SRT: ResolvedBackend = { id: 'srt', label: 'sandbox-runtime (srt)', reason: 'test', unavailable: null };
const NONO: ResolvedBackend = { id: 'nono', label: 'nono', reason: 'test', unavailable: null };

const noPreflight = () => null;

const env = (over: Partial<StoredEnvironment> = {}): StoredEnvironment => ({
	id: 'e1',
	name: 'Demo',
	workspace: '/work/serebro-policy-test',
	harness: 'claude-code',
	model: 'default',
	sandbox: 'auto',
	filesystem: { readWrite: [], denyRead: ['~/.ssh'], allowRead: [], denyWrite: [] },
	network: { allowedDomains: [], deniedDomains: [], packageManagers: false, harnessDefaults: true, allowLocalBinding: false },
	policyFile: { mode: 'off', path: '', addAgentNeeds: true },
	credentials: [],
	createdAt: '',
	updatedAt: '',
	...over
});

describe('compilePolicy', () => {
	it('builds sandbox-runtime settings for srt', () => {
		const c = compilePolicy(env(), {}, SRT, 'linux');
		expect(c.backend).toBe('srt');
		expect(c.report.blocked).toBeNull();
		expect(c.settings).toHaveProperty('filesystem.allowWrite');
		expect(c.report.filesystem.readOnly).toEqual([]);
	});

	it('builds a nono profile for nono', () => {
		const c = compilePolicy(env(), {}, NONO, 'linux', noPreflight);
		expect(c.backend).toBe('nono');
		expect(c.report.blocked).toBeNull();
		expect(c.settings).toMatchObject({ extends: 'default', network: { allow_domain: ['api.anthropic.com'] } });
		expect(c.report.sandbox.id).toBe('nono');
	});

	it('gives the two sandboxes different hashes, so open chats reload when it changes', () => {
		expect(compilePolicy(env(), {}, SRT, 'linux').report.hash).not.toBe(compilePolicy(env(), {}, NONO, 'linux', noPreflight).report.hash);
	});

	it('blocks nono while policy files are on', () => {
		const c = compilePolicy(env({ policyFile: { mode: 'auto', path: '', addAgentNeeds: true } }), {}, NONO, 'linux', noPreflight);
		expect(c.report.blocked).toMatch(/Set "Policy file" to Off/);
	});

	it('blocks nono on a rule it cannot enforce instead of dropping it', () => {
		const c = compilePolicy(
			env({ filesystem: { readWrite: [], denyRead: ['.env'], allowRead: [], denyWrite: ['.env.local'] } }),
			{},
			NONO,
			'linux',
			noPreflight
		);
		expect(c.report.blocked).toMatch(/"\.env" cannot be hidden/);
		expect(c.report.blocked).toMatch(/"\.env\.local" cannot be made read-only/);
	});

	it('blocks nono on a masked credential', () => {
		const c = compilePolicy(
			env({ credentials: [{ name: 'API_KEY', mode: 'masked', injectHosts: ['api.anthropic.com'] }] }),
			{ API_KEY: 'secret-value' },
			NONO,
			'linux',
			noPreflight
		);
		expect(c.report.blocked).toMatch(/API_KEY cannot be masked/);
	});

	it('blocks when nono itself refuses the profile', () => {
		const here = process.platform;
		const c = compilePolicy(env(), {}, NONO, here, () => 'overlaps protected nono state root');
		if (here === 'linux' || here === 'darwin') expect(c.report.blocked).toMatch(/nono refuses this environment[\s\S]*protected nono state root/);
	});

	it('gives local ports under nono a private loopback, not a port range', () => {
		const c = compilePolicy(
			env({ network: { allowedDomains: [], deniedDomains: [], packageManagers: false, harnessDefaults: true, allowLocalBinding: true } }),
			{},
			NONO,
			'linux',
			noPreflight
		);
		expect(c.settings).toMatchObject({ linux: { isolate: { network: true, loopback: true } } });
	});

	it('blocks when the sandbox cannot run', () => {
		const c = compilePolicy(env(), {}, { ...SRT, unavailable: 'sandbox-runtime (srt) cannot run on this machine' }, 'linux');
		expect(c.report.blocked).toMatch(/cannot run on this machine/);
	});
});
