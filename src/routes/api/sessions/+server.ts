import { Effect } from 'effect';
import { api, requestJson } from '#lib/server/http.ts';
import { CreateSessionBody, decodeBody } from '#lib/server/schemas.ts';
import { Store } from '#lib/server/store.ts';

export const GET = () => api('api.sessions.list', Store.use((s) => s.listSessions));

export const POST = ({ request }) =>
	api(
		'api.sessions.create',
		Effect.gen(function* () {
			const store = yield* Store;
			const body = yield* requestJson(request).pipe(Effect.flatMap(decodeBody(CreateSessionBody)));
			const env = yield* store.getEnvironment(body.environmentId);
			return yield* store.createSession(env, body.title);
		}),
		201
	);
