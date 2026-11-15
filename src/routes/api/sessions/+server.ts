import { json } from '@sveltejs/kit';
import { handle, notFound } from '#lib/server/http.ts';
import { createSession, getEnvironment, listSessions } from '#lib/server/store.ts';

export const GET = () => json(listSessions());

export const POST = async ({ request }) => {
	const body = await request.json();
	const env = getEnvironment(String(body.environmentId ?? ''));
	if (!env) return notFound('Environment');
	return handle(() => createSession(env, body.title), 201);
};
