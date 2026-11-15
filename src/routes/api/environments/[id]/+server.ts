import { Effect } from 'effect';
import { api, requestJson } from '#lib/server/http.ts';
import { compileFor } from '#lib/server/policy.ts';
import { decodeEnvironmentInput } from '#lib/server/schemas.ts';
import { Store } from '#lib/server/store.ts';

export const GET = ({ params }) =>
	api(
		'api.environments.get',
		Effect.gen(function* () {
			const store = yield* Store;
			const env = yield* store.getEnvironment(params.id);
			return { environment: yield* store.toView(env), access: (yield* compileFor(env)).report };
		})
	);

export const PUT = ({ params, request }) =>
	api(
		'api.environments.update',
		Effect.gen(function* () {
			const store = yield* Store;
			const input = yield* requestJson(request).pipe(Effect.flatMap(decodeEnvironmentInput));
			return yield* store.toView(yield* store.updateEnvironment(params.id, input));
		})
	);

export const DELETE = ({ params }) =>
	api('api.environments.delete', Store.use((s) => s.deleteEnvironment(params.id)));
