import { Effect } from 'effect';
import { api } from '#lib/server/http.ts';
import { probeEnvironment } from '#lib/server/runner.ts';
import { Store } from '#lib/server/store.ts';

export const POST = ({ params }) =>
	api(
		'api.environments.probe',
		Effect.gen(function* () {
			const env = yield* (yield* Store).getEnvironment(params.id);
			return yield* probeEnvironment(env);
		})
	);
