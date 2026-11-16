import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit } from 'effect';
import { decodeEnvironmentInput } from './schemas.ts';

const valid = { name: ' Demo ', workspace: '~/code/demo', harness: 'claude-code' };

describe('decodeEnvironmentInput', () => {
	it.effect('fills defaults and normalises lists', () =>
		Effect.gen(function* () {
			const input = yield* decodeEnvironmentInput({
				...valid,
				filesystem: { denyRead: [' ~/.ssh ', '', '  '] },
				credentials: [{ name: 'ANTHROPIC_API_KEY', value: 'sk-1', injectHosts: [' api.anthropic.com '] }]
			});
			expect(input.name).toBe('Demo');
			expect(input.model).toBe('default');
			expect(input.filesystem).toEqual({ readWrite: [], denyRead: ['~/.ssh'], allowRead: [], denyWrite: [] });
			expect(input.network).toEqual({
				allowedDomains: [],
				deniedDomains: [],
				packageManagers: false,
				harnessDefaults: true,
				allowLocalBinding: false
			});
			expect(input.policyFile).toEqual({ mode: 'auto', path: '', addAgentNeeds: true });
			expect(input.credentials).toEqual([
				{ name: 'ANTHROPIC_API_KEY', mode: 'direct', injectHosts: ['api.anthropic.com'], value: 'sk-1' }
			]);
		})
	);

	const rejects = (body: unknown, message: RegExp) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(decodeEnvironmentInput(body));
			expect(Exit.isFailure(exit)).toBe(true);
			const error = yield* Effect.flip(decodeEnvironmentInput(body));
			expect(error._tag).toBe('InvalidInput');
			expect(error.message).toMatch(message);
		});

	it.effect('requires a name', () => rejects({ ...valid, name: '   ' }, /name: Name is required/));
	it.effect('requires an absolute workspace', () => rejects({ ...valid, workspace: 'code/demo' }, /absolute path/));
	it.effect('rejects an unknown agent', () => rejects({ ...valid, harness: 'gpt-pilot' }, /Pick a coding agent/));
	it.effect('rejects a bad variable name', () => rejects({ ...valid, credentials: [{ name: '1BAD' }] }, /not a valid environment variable name/));
	it.effect('requires a path for a custom policy file', () =>
		rejects({ ...valid, policyFile: { mode: 'custom' } }, /Enter the path of the custom policy file/)
	);
	it.effect('rejects wrong types instead of coercing them', () =>
		rejects({ ...valid, network: { packageManagers: 'yes' } }, /network\.packageManagers/)
	);
	it.effect('reports every problem at once', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(decodeEnvironmentInput({ workspace: 'x' }));
			expect(error.issues?.length).toBeGreaterThanOrEqual(3);
		})
	);
});
