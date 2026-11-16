import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AccessEntry } from '#lib/types.ts';
import { compileNonoProfile, proxyHostPort, type NonoPolicyInput } from './nono-policy.ts';

const you = (value: string): AccessEntry => ({ value, source: 'you' });

const base: NonoPolicyInput = {
	name: 'serebro-test',
	platform: 'linux',
	readWrite: ['/work/app', '/home/me/.claude', '/home/me/.claude.json'],
	readOnly: ['/opt/node'],
	denyRead: [],
	denyWrite: [],
	allowRead: [],
	allowedDomains: ['api.anthropic.com'],
	deniedDomains: [],
	localBinding: false,
	maskedCredentials: [],
	resolve: (p) => path.resolve('/work/app', p.replace(/^~/, '/home/me')),
	isFile: (p) => p.endsWith('.json')
};

const compile = (over: Partial<NonoPolicyInput> = {}) => compileNonoProfile({ ...base, ...over });
const fsOf = (p: ReturnType<typeof compile>) => p.profile.filesystem as Record<string, string[]>;

describe('compileNonoProfile', () => {
	it('grants folders and files with the right keys and nothing by working directory', () => {
		const r = compile();
		expect(r.unenforceable).toEqual([]);
		expect(fsOf(r).allow).toEqual(expect.arrayContaining(['/work/app', '/home/me/.claude']));
		expect(fsOf(r).allow_file).toContain('/home/me/.claude.json');
		expect(fsOf(r).read).toEqual(['/opt/node']);
		expect(r.profile.workdir).toEqual({ access: 'none' });
	});

	it('does not open the shared temp folders', () => {
		const r = compile();
		expect((r.profile.groups as { exclude: string[] }).exclude).toEqual(['system_write_linux', 'system_write_macos']);
		expect(fsOf(r).allow).not.toContain('/tmp');
	});

	it('keeps a hidden path that is outside every grant', () => {
		const r = compile({ denyRead: [you('~/.ssh')] });
		expect(r.unenforceable).toEqual([]);
		expect(fsOf(r).deny).toEqual(['/home/me/.ssh']);
	});

	it('refuses to hide a path inside a granted folder on Linux', () => {
		const r = compile({ denyRead: [you('.env')] });
		expect(r.unenforceable).toHaveLength(1);
		expect(r.unenforceable[0]).toMatch(/"\.env" cannot be hidden.*\/work\/app/);
		expect(fsOf(r).deny).toEqual([]);
	});

	it('hides a path inside a granted folder on macOS, where Seatbelt can', () => {
		const r = compile({ platform: 'darwin', denyRead: [you('.env')] });
		expect(r.unenforceable).toEqual([]);
		expect(fsOf(r).deny).toEqual(['/work/app/.env']);
	});

	it('refuses a read-only rule inside a writable folder on every platform', () => {
		for (const platform of ['linux', 'darwin'] as const) {
			const r = compile({ platform, denyWrite: [you('.env')] });
			expect(r.unenforceable[0]).toMatch(/cannot be made read-only/);
		}
	});

	it('needs nothing for a read-only rule outside the writable folders', () => {
		expect(compile({ denyWrite: [you('/var/data')] }).unenforceable).toEqual([]);
	});

	it('does not treat a sibling with the same prefix as inside a grant', () => {
		expect(compile({ denyRead: [you('/work/app-secrets')] }).unenforceable).toEqual([]);
	});

	it('refuses masked credentials', () => {
		expect(compile({ maskedCredentials: ['API_KEY'] }).unenforceable[0]).toMatch(/API_KEY cannot be masked/);
	});

	it('re-allows a path for reading and lifts the built-in protection for it', () => {
		const r = compile({ denyRead: [you('~/.ssh')], allowRead: ['~/.ssh/known_hosts'] });
		expect(r.unenforceable).toEqual([]);
		expect(fsOf(r).read).toContain('/home/me/.ssh/known_hosts');
		expect(fsOf(r).bypass_protection).toEqual(['/home/me/.ssh/known_hosts']);
	});

	it('refuses a read-only rule that is a parent of a writable folder', () => {
		const r = compile({ denyWrite: [you('/work')] });
		expect(r.unenforceable[0]).toMatch(/"\/work" cannot be made read-only: \/work\/app is inside it/);
	});

	it('refuses to hide a folder that contains a grant on Linux', () => {
		expect(compile({ denyRead: [you('/home/me')] }).unenforceable[0]).toMatch(/cannot be hidden: \/home\/me\/\.claude is inside it/);
		// A re-allowed path inside a hidden folder is the intended exception.
		expect(compile({ denyRead: [you('~/.ssh')], allowRead: ['~/.ssh/known_hosts'] }).unenforceable).toEqual([]);
	});

	it('compares real locations, so a rule spelled through a symlink still matches', () => {
		// /work/link is a symlink to /work/app.
		const viaLink = (p: string) => base.resolve(p).replace(/^\/work\/link(?=\/|$)/, '/work/app');
		const r = compileNonoProfile({ ...base, readWrite: ['/work/link'], denyWrite: [you('/work/app/.env')], denyRead: [you('/work/app/secret')], resolve: viaLink });
		expect(r.unenforceable).toHaveLength(2);
		expect(fsOf(r).allow).toContain('/work/app');
	});

	it('blocks the network when no domain is allowed', () => {
		expect(compile({ allowedDomains: [] }).profile.network).toEqual({ block: true });
	});

	it('filters domains and chains the host proxy', () => {
		const r = compile({ deniedDomains: ['evil.example'], upstreamProxy: 'proxy:3128' });
		expect(r.profile.network).toEqual({ allow_domain: ['api.anthropic.com'], deny_domain: ['evil.example'], upstream_proxy: 'proxy:3128' });
		expect(r.profile).not.toHaveProperty('linux');
	});

	it('gives local ports a loopback of their own on Linux, never the machine\'s localhost', () => {
		const r = compile({ localBinding: true });
		expect(r.unenforceable).toEqual([]);
		expect(r.profile.linux).toEqual({ isolate: { network: true, loopback: true } });
		expect(JSON.stringify(r.profile)).not.toMatch(/open_port|listen_port|connect_port/);
	});

	it('refuses local ports on macOS, where only the machine\'s localhost can be opened', () => {
		const r = compile({ platform: 'darwin', localBinding: true });
		expect(r.unenforceable[0]).toMatch(/Local ports cannot be opened/);
		expect(JSON.stringify(r.profile)).not.toMatch(/open_port|listen_port|connect_port/);
	});

	it('keeps nono\'s state folder variable out of the agent\'s environment', () => {
		expect(compile().profile.environment).toEqual({ deny_vars: ['XDG_STATE_HOME'] });
	});
});

describe('proxyHostPort', () => {
	it('reads host and port and notices credentials', () => {
		expect(proxyHostPort('http://127.0.0.1:3128')).toEqual({ hostPort: '127.0.0.1:3128', hasCredentials: false });
		expect(proxyHostPort('http://u:p@proxy.corp')).toEqual({ hostPort: 'proxy.corp:80', hasCredentials: true });
		expect(proxyHostPort(undefined)).toEqual({ hasCredentials: false });
	});
});
