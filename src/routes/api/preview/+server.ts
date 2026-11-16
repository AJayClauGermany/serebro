// Compile an unsaved environment form into its access report, for the live preview.
import { Effect } from 'effect';
import { api, requestJson } from '#lib/server/http.ts';
import { compilePolicy } from '#lib/server/policy.ts';
import { decodeEnvironmentInput, type StoredEnvironment } from '#lib/server/schemas.ts';
import { Store } from '#lib/server/store.ts';

export const POST = ({ request }) =>
	api(
		'api.preview',
		Effect.gen(function* () {
			const store = yield* Store;
			const body = (yield* requestJson(request)) as Record<string, unknown> | null;
			const id = typeof body?.id === 'string' && body.id ? body.id : 'draft';
			const input = yield* decodeEnvironmentInput({
				...body,
				name: body?.name || 'draft',
				workspace: body?.workspace || '/(workspace not set)'
			});
			const secrets = { ...(id === 'draft' ? {} : yield* store.getSecrets(id)) };
			for (const c of input.credentials) if (c.value) secrets[c.name] = c.value;
			const env: StoredEnvironment = {
				...input,
				id,
				credentials: input.credentials.map(({ name, mode, injectHosts }) => ({ name, mode, injectHosts })),
				createdAt: '',
				updatedAt: ''
			};
			return compilePolicy(env, secrets).report;
		})
	);
