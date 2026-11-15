import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { EnvironmentInput } from '#lib/types.ts';
import { DATA_DIR } from './config.ts';
import { Store } from './store.ts';

const input: EnvironmentInput = {
	name: 'Demo',
	workspace: '/tmp/demo',
	harness: 'claude-code',
	model: 'claude-sonnet-4-5',
	filesystem: { readWrite: [], denyRead: [], allowRead: [], denyWrite: [] },
	network: { allowedDomains: [], deniedDomains: [], packageManagers: false, harnessDefaults: true, allowLocalBinding: false },
	policyFile: { mode: 'off', path: '', addAgentNeeds: true },
	credentials: [{ name: 'ANTHROPIC_API_KEY', mode: 'direct', injectHosts: [], value: 'sk-secret-value' }]
};

const dataFile = (name: string) => path.join(DATA_DIR, name);

describe('Store', () => {
	beforeEach(() => {
		fs.rmSync(DATA_DIR, { recursive: true, force: true });
		fs.mkdirSync(DATA_DIR, { recursive: true });
	});

	it.layer(Store.layer, { buildPerTest: true })((it) => {
		it.effect('treats missing files as empty', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				expect(yield* store.listEnvironments).toEqual([]);
				expect(yield* store.listSessions).toEqual([]);
			})
		);

		it.effect('round-trips an environment and keeps secrets out of environments.json', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const env = yield* store.createEnvironment(input);
				expect(yield* store.getEnvironment(env.id)).toEqual(env);
				expect(yield* store.getSecrets(env.id)).toEqual({ ANTHROPIC_API_KEY: 'sk-secret-value' });
				expect(fs.readFileSync(dataFile('environments.json'), 'utf8')).not.toContain('sk-secret-value');
				const view = yield* store.toView(env);
				expect(view.credentials[0]).toMatchObject({ hasValue: true, hint: '…alue' });
			})
		);

		it.effect('fails with NotFound for unknown ids', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const e = yield* Effect.flip(store.getEnvironment('nope'));
				expect(e).toMatchObject({ _tag: 'NotFound', entity: 'Environment', id: 'nope' });
				expect((yield* Effect.flip(store.saveMessages('nope', []))).message).toBe('Session not found');
			})
		);

		it.effect('refuses to overwrite a corrupt data file', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const corrupt = '[{"id": "abc", "name": "half-written';
				fs.writeFileSync(dataFile('environments.json'), corrupt);
				const e = yield* Effect.flip(store.createEnvironment(input));
				expect(e._tag).toBe('StoreCorrupt');
				expect(fs.readFileSync(dataFile('environments.json'), 'utf8')).toBe(corrupt);
			})
		);

		it.effect('rejects data with the wrong shape', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				fs.writeFileSync(dataFile('sessions.json'), JSON.stringify([{ id: 1 }]));
				const e = yield* Effect.flip(store.listSessions);
				expect(e._tag).toBe('StoreCorrupt');
			})
		);

		it.effect('upgrades environments saved before policy files existed', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const { policyFile: _, ...legacy } = { ...input, id: 'old1', credentials: [], createdAt: '', updatedAt: '' };
				fs.writeFileSync(dataFile('environments.json'), JSON.stringify([legacy]));
				const env = yield* store.getEnvironment('old1');
				expect(env.policyFile).toEqual({ mode: 'auto', path: '', addAgentNeeds: true });
			})
		);

		it.effect('ignores deletes for unknown ids instead of building paths from them', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				yield* store.createEnvironment(input);
				yield* store.deleteEnvironment('..');
				yield* store.deleteSession('../environments');
				expect(fs.existsSync(dataFile('environments.json'))).toBe(true);
				expect((yield* store.listEnvironments).length).toBe(1);
			})
		);

		it.effect('does not lose concurrent writes', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const env = yield* store.createEnvironment(input);
				yield* Effect.forEach(Array.from({ length: 25 }, (_, i) => `chat ${i}`), (t) => store.createSession(env, t), {
					concurrency: 'unbounded'
				});
				expect((yield* store.listSessions).length).toBe(25);
			})
		);

		it.effect('deletes an environment with its chats', () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const env = yield* store.createEnvironment(input);
				const s = yield* store.createSession(env);
				yield* store.saveMessages(s.id, [{ role: 'user', parts: [] }]);
				expect(fs.existsSync(dataFile(`messages/${s.id}.json`))).toBe(true);
				yield* store.deleteEnvironment(env.id);
				expect(yield* store.listSessions).toEqual([]);
				expect(fs.existsSync(dataFile(`messages/${s.id}.json`))).toBe(false);
				expect(yield* store.getSecrets(env.id)).toEqual({});
			})
		);
	});
});
