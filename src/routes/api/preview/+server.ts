// Compile an unsaved environment form into its access report, for the live preview.
import { handle } from '#lib/server/http.ts';
import { compilePolicy } from '#lib/server/policy.ts';
import { getSecrets, type StoredEnvironment } from '#lib/server/store.ts';
import { parseEnvironmentInput } from '#lib/server/system.ts';

export const POST = async ({ request }) =>
	handle(async () => {
		const body = await request.json();
		const id = typeof body.id === 'string' && body.id ? body.id : 'draft';
		const input = parseEnvironmentInput({ ...body, name: body.name || 'draft', workspace: body.workspace || '/(workspace not set)' });
		const secrets = { ...(id === 'draft' ? {} : getSecrets(id)) };
		for (const c of input.credentials) if (c.value) secrets[c.name] = c.value;
		const env: StoredEnvironment = {
			...input,
			id,
			credentials: input.credentials.map(({ name, mode, injectHosts }) => ({ name, mode, injectHosts })),
			createdAt: '',
			updatedAt: ''
		};
		return compilePolicy(env, secrets).report;
	});
