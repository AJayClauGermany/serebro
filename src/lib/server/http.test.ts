import { describe, expect, it } from '@effect/vitest';
import { isHttpError } from '@sveltejs/kit';
import { Effect } from 'effect';
import { InvalidInput, NotFound, PolicyInvalid } from './errors.ts';
import { api, page } from './http.ts';

describe('api()', () => {
	it('returns JSON with the success status', async () => {
		const res = await api('t', Effect.succeed({ a: 1 }), 201);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ a: 1 });
	});

	it('returns 204 for void', async () => {
		expect((await api('t', Effect.void)).status).toBe(204);
	});

	it('maps tagged errors to statuses', async () => {
		const nf = await api('t', Effect.fail(new NotFound({ entity: 'Session', id: 'x' })));
		expect(nf.status).toBe(404);
		expect(await nf.json()).toEqual({ error: 'Session not found' });

		const bad = await api('t', Effect.fail(new InvalidInput({ message: 'name: required', issues: ['name: required'] })));
		expect(bad.status).toBe(400);
		expect(await bad.json()).toEqual({ error: 'name: required', errors: ['name: required'] });

		const policy = await api('t', Effect.fail(new PolicyInvalid({ path: '/p', errors: ['network: Expected object'] })));
		expect(policy.status).toBe(422);
		expect(await policy.json()).toEqual({ error: 'The file was not saved.', errors: ['network: Expected object'] });
	});

	it('hides defects behind a generic 500', async () => {
		const res = await api(
			't',
			Effect.sync(() => {
				throw new Error('secret internals');
			})
		);
		expect(res.status).toBe(500);
		expect(JSON.stringify(await res.json())).not.toContain('secret internals');
	});
});

describe('page()', () => {
	it('turns NotFound into a 404 error page', async () => {
		const err = await page('t', Effect.fail(new NotFound({ entity: 'Environment', id: 'x' }))).catch((e) => e);
		expect(isHttpError(err, 404)).toBe(true);
		expect(err.body.message).toBe('Environment not found');
	});
});
