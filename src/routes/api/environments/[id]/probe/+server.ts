import { json } from '@sveltejs/kit';
import { notFound } from '#lib/server/http.ts';
import { probeEnvironment } from '#lib/server/runner.ts';
import { getEnvironment } from '#lib/server/store.ts';

export const POST = async ({ params }) => {
	const env = getEnvironment(params.id);
	if (!env) return notFound('Environment');
	return json(await probeEnvironment(env));
};
