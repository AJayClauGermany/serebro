// Streams one agent turn as server-sent events. The chat's threadId is the Serebro session id.
import { json } from '@sveltejs/kit';
import { chatParamsFromRequestBody, toServerSentEventsResponse } from '@tanstack/ai';
import { runAgent } from '#lib/server/runner.ts';
import { getEnvironment, getSession } from '#lib/server/store.ts';

export const POST = async ({ request }) => {
	let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
	try {
		params = await chatParamsFromRequestBody(await request.json());
	} catch (e) {
		return json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
	}
	const session = getSession(params.threadId);
	if (!session) return json({ error: 'Session not found' }, { status: 404 });
	const env = getEnvironment(session.environmentId);
	if (!env) return json({ error: 'Environment not found' }, { status: 404 });

	const controller = new AbortController();
	request.signal.addEventListener('abort', () => controller.abort(), { once: true });
	let stream;
	try {
		stream = runAgent({ env, session, messages: params.messages as never, signal: controller.signal });
	} catch (e) {
		// Report setup problems (such as an invalid policy file) in the chat itself.
		const message = e instanceof Error ? e.message : String(e);
		stream = (async function* () {
			yield { type: 'RUN_ERROR', timestamp: Date.now(), message };
		})();
	}
	return toServerSentEventsResponse(stream as never, { abortController: controller });
};
