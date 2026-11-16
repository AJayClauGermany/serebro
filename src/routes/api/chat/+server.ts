// Streams one agent turn as server-sent events. The chat's threadId is the Serebro session id.
import { chatParamsFromRequestBody, toServerSentEventsResponse } from '@tanstack/ai';
import { Effect } from 'effect';
import { InvalidInput } from '#lib/server/errors.ts';
import { api, requestJson } from '#lib/server/http.ts';
import { runAgent } from '#lib/server/runner.ts';
import { Store } from '#lib/server/store.ts';

export const POST = ({ request }) =>
	api(
		'api.chat',
		Effect.gen(function* () {
			const store = yield* Store;
			const body = yield* requestJson(request);
			const params = yield* Effect.tryPromise({
				try: () => chatParamsFromRequestBody(body as never),
				catch: (e) => new InvalidInput({ message: e instanceof Error ? e.message : String(e) })
			});
			const session = yield* store.getSession(params.threadId);
			const env = yield* store.getEnvironment(session.environmentId);

			const controller = new AbortController();
			request.signal.addEventListener('abort', () => controller.abort(), { once: true });
			const stream = yield* runAgent({ env, session, messages: params.messages as never, signal: controller.signal }).pipe(
				// Report setup problems (such as an invalid policy file) in the chat itself.
				Effect.catch((e) =>
					Effect.succeed(
						(async function* () {
							yield { type: 'RUN_ERROR', timestamp: Date.now(), message: e.message };
						})()
					)
				)
			);
			return toServerSentEventsResponse(stream as never, { abortController: controller });
		})
	);
