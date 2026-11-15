import { error } from '@sveltejs/kit';
import { compilePolicy } from '#lib/server/policy.ts';
import { getEnvironment, listSessions, toView } from '#lib/server/store.ts';
import { systemStatus } from '#lib/server/system.ts';

export const load = ({ params }) => {
	const env = getEnvironment(params.id);
	if (!env) error(404, 'Environment not found');
	return {
		environment: toView(env),
		access: compilePolicy(env).report,
		harness: systemStatus().harnesses.find((h) => h.id === env.harness)!,
		sessions: listSessions().filter((s) => s.environmentId === env.id)
	};
};
