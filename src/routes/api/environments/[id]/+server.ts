import { json } from '@sveltejs/kit';
import { handle, notFound } from '#lib/server/http.ts';
import { compilePolicy } from '#lib/server/policy.ts';
import { deleteEnvironment, getEnvironment, toView, updateEnvironment } from '#lib/server/store.ts';
import { parseEnvironmentInput } from '#lib/server/system.ts';

export const GET = ({ params }) => {
	const env = getEnvironment(params.id);
	if (!env) return notFound('Environment');
	return json({ environment: toView(env), access: compilePolicy(env).report });
};

export const PUT = async ({ params, request }) => {
	if (!getEnvironment(params.id)) return notFound('Environment');
	return handle(async () => toView(updateEnvironment(params.id, parseEnvironmentInput(await request.json()))!));
};

export const DELETE = ({ params }) => {
	deleteEnvironment(params.id);
	return new Response(null, { status: 204 });
};
