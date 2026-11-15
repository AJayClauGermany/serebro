import { json } from '@sveltejs/kit';
import { notFound } from '#lib/server/http.ts';
import { deleteSession, getMessages, getSession, saveMessages } from '#lib/server/store.ts';

export const GET = ({ params }) => {
	const session = getSession(params.id);
	if (!session) return notFound('Session');
	return json({ session, messages: getMessages(params.id) });
};

/** The browser saves the transcript after each turn. */
export const PUT = async ({ params, request }) => {
	if (!getSession(params.id)) return notFound('Session');
	const body = await request.json();
	saveMessages(params.id, Array.isArray(body.messages) ? body.messages : []);
	return new Response(null, { status: 204 });
};

export const DELETE = ({ params }) => {
	deleteSession(params.id);
	return new Response(null, { status: 204 });
};
