import { Effect } from 'effect';
import { api, requestJson } from '#lib/server/http.ts';
import { decodeEnvironmentInput } from '#lib/server/schemas.ts';
import { Store } from '#lib/server/store.ts';

export const GET = () =>
	api(
		'api.environments.list',
		Effect.gen(function* () {
			const store = yield* Store;
			return yield* Effect.forEach(yield* store.listEnvironments, store.toView);
		})
	);

export const POST = ({ request }) =>
	api(
		'api.environments.create',
		Effect.gen(function* () {
			const store = yield* Store;
			const input = yield* requestJson(request).pipe(Effect.flatMap(decodeEnvironmentInput));
			return yield* store.toView(yield* store.createEnvironment(input));
		}),
		201
	);
