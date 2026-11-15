import { json } from '@sveltejs/kit';
import { handle } from '#lib/server/http.ts';
import { createEnvironment, listEnvironments, toView } from '#lib/server/store.ts';
import { parseEnvironmentInput } from '#lib/server/system.ts';

export const GET = () => json(listEnvironments().map(toView));

export const POST = async ({ request }) =>
	handle(async () => toView(createEnvironment(parseEnvironmentInput(await request.json()))), 201);
