import { Effect } from 'effect';
import { api, requestJson } from '#lib/server/http.ts';
import { decodeBody, SaveMessagesBody } from '#lib/server/schemas.ts';
import { Store } from '#lib/server/store.ts';

export const GET = ({ params }) =>
	api(
		'api.sessions.get',
		Effect.gen(function* () {
			const store = yield* Store;
			return { session: yield* store.getSession(params.id), messages: yield* store.getMessages(params.id) };
		})
	);

/** The browser saves the transcript after each turn. */
export const PUT = ({ params, request }) =>
	api(
		'api.sessions.saveMessages',
		Effect.gen(function* () {
			const store = yield* Store;
			const body = yield* requestJson(request).pipe(Effect.flatMap(decodeBody(SaveMessagesBody, 'Transcript')));
			yield* store.saveMessages(params.id, body.messages);
		})
	);

export const DELETE = ({ params }) =>
	api('api.sessions.delete', Store.use((s) => s.deleteSession(params.id)));
